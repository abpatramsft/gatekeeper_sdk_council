# Feedback: Copilot CLI SDK — Sessions Are Local-Only, No Cloud API

## Summary

The Copilot CLI SDK's `session.list` RPC returns sessions stored **only on the local filesystem** (`~/.copilot/`). There is no cloud-backed API to retrieve a user's Copilot CLI session history remotely. This makes it impossible to build production-deployed applications that display a user's Copilot sessions without requiring local filesystem access.

## Problem

When building a web application that fetches and displays Copilot CLI sessions using the Python SDK (`github-copilot-sdk`), the `session.list` RPC works perfectly in local development — because the user's machine has session JSONL files stored under `~/.copilot/`. However, when the same application is deployed inside a Docker container (or any remote server), `session.list` returns **zero sessions**, even though authentication succeeds.

## Reproduction

### Local (works)

```bash
cd backend
pip install github-copilot-sdk
uvicorn main:app --reload --port 8000
# POST /api/sessions/fetch with a valid PAT → returns 50 sessions ✅
```

### Docker (fails)

```bash
docker build -t gatekeeper-viewer .
docker run -p 8000:8000 --env-file .env gatekeeper-viewer
# POST /api/sessions/fetch with the same valid PAT → returns 0 sessions ❌
```

## Root Cause

Confirmed via CLI debug logs inside the container:

```
[DEBUG] Received session.list request
[DEBUG] Found 0 JSONL sessions and 0 legacy sessions
```

The Copilot CLI stores sessions as **local JSONL files** under `~/.copilot/`. The `session.list` RPC simply enumerates these local files — it does **not** call any GitHub cloud API to fetch session history.

### Key evidence

1. `session.list` reads from the local `~/.copilot/` directory.
2. Authentication is confirmed working (`isAuthenticated=True`, `authType='token'`).
3. The CLI binary runs correctly inside the container (verified with `copilot --version`).
4. Even creating a session inside Docker and then immediately calling `session.list` returns 0 (sessions exist only in the CLI process memory during the session lifetime, and the JSONL file is written to `~/.copilot/` only after the session ends).

## Impact

- **Cannot build cloud-deployed Copilot session viewers** — Any application that wants to display a user's Copilot CLI sessions must run on the same machine where the sessions were created.
- **No multi-device access** — Users cannot view their session history from a different machine.
- **No team/org visibility** — Organizations cannot build dashboards to review Copilot CLI usage across their teams.
- **Docker/container deployment blocked** — The primary modern deployment model is completely unsupported for session listing.

## Feature Request

Provide a **cloud-backed API** (either as a GitHub REST API endpoint or as an additional RPC method in the Copilot CLI SDK) that allows authenticated users to retrieve their Copilot CLI session history from GitHub's servers, similar to how Copilot Chat sessions in VS Code are synced to the cloud.

### Suggested API

```
GET /user/copilot/sessions
Authorization: Bearer <PAT>
```

Or as an SDK RPC:

```
session.listRemote({ token: "..." }) → { sessions: [...] }
```

This would enable:
- Production-deployed web apps that display session history
- Cross-device session access
- Organization-level session dashboards
- CI/CD pipeline integration for session analysis

## Workaround (Current)

The only workaround is to run the session fetch **locally** (where `~/.copilot/` exists), export the data to a JSON file, and then import it into the deployed application. This adds friction and breaks the real-time experience. It also requires end users to have the Copilot CLI installed locally and run an export script, which is not viable for a production application.

## Environment

- **Copilot CLI version**: 0.0.403 (SDK-bundled), 0.0.410 (npm-installed)
- **Python SDK**: `github-copilot-sdk` (latest)
- **Docker base image**: `python:3.12-slim` with Node.js 20
- **OS**: Windows 11 (local), Debian (container)
- **Architecture**: ARM64 (aarch64)
