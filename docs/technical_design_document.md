# Gatekeeper Viewer — Technical Design Document

> **Version:** 1.0  
> **Last Updated:** 2026-03-04  
> **Status:** Living Document

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Component Architecture](#4-component-architecture)
   - 4.1 [Backend (FastAPI)](#41-backend-fastapi)
   - 4.2 [Frontend (React + Vite)](#42-frontend-react--vite)
   - 4.3 [Copilot Session Fetcher (Standalone CLI)](#43-copilot-session-fetcher-standalone-cli)
5. [Data Flow & Sequence Diagrams](#5-data-flow--sequence-diagrams)
6. [API Specification](#6-api-specification)
7. [Data Models](#7-data-models)
8. [Authentication & Security](#8-authentication--security)
9. [External Integrations](#9-external-integrations)
10. [State Management](#10-state-management)
11. [Deployment Architecture](#11-deployment-architecture)
12. [Technology Stack](#12-technology-stack)
13. [Configuration & Environment](#13-configuration--environment)
14. [Error Handling Strategy](#14-error-handling-strategy)
15. [Appendix](#15-appendix)

---

## 1. Introduction

### 1.1 Purpose

Gatekeeper Viewer is a full-stack web application that provides a unified interface for browsing, inspecting, and analysing results from **Gatekeeper Analysis** and **Feature Requirement Analysis** GitHub Actions workflows. It also offers **Copilot CLI session** exploration and an **Agentic Analysis** feature powered by Azure AI.

### 1.2 Scope

This document covers the complete architectural design of the system including:

- Backend API server design and responsibilities
- Frontend SPA architecture and routing
- External service integrations (GitHub REST API, Copilot SDK, Azure AI)
- Deployment topology (Docker multi-stage build)
- Data models, state management, and security considerations

### 1.3 Intended Audience

Software engineers, architects, and DevOps personnel involved in development, maintenance, or extension of the Gatekeeper Viewer platform.

---

## 2. System Overview

Gatekeeper Viewer aggregates data from three distinct sources and presents them through a single-page application:

| Source | Protocol | Purpose |
|---|---|---|
| **GitHub Actions** | REST API (`api.github.com`) | Fetch workflow runs & download artifact ZIPs for Gatekeeper / FRD analysis |
| **Copilot CLI** | Copilot SDK (JSON-RPC) | Retrieve session metadata and event timelines |
| **Azure AI Agent** | Azure AI Projects SDK | Context-aware agentic queries over analysis and session data |

The application is designed as a **monolith-friendly deployment** — a single Docker container serves both the API and the pre-built static frontend on **port 8000**.

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        User Browser                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │           React SPA (Vite-built, static assets)        │  │
│  │  Pages: Landing │ Runs │ RunDetail │ FRDRunDetail │    │  │
│  │         Sessions │ SessionDetail │ AgenticAnalysis     │  │
│  └──────────────────────────┬─────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────┘
                              │  HTTP /api/*
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                     FastAPI Backend (:8000)                   │
│  ┌───────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │ GitHub    │  │ Copilot Session│  │   Azure AI Agent    │ │
│  │ Client    │  │ Fetcher        │  │   Integration       │ │
│  └─────┬─────┘  └───────┬────────┘  └──────────┬──────────┘ │
│        │                │                       │            │
│  In-Memory Session Store (dict)                 │            │
└────────┼────────────────┼───────────────────────┼────────────┘
         │                │                       │
         ▼                ▼                       ▼
   ┌──────────┐   ┌──────────────┐   ┌──────────────────────┐
   │ GitHub   │   │ Copilot CLI  │   │ Azure AI Projects    │
   │ REST API │   │ SDK (RPC)    │   │ (OpenAI / Agent)     │
   └──────────┘   └──────────────┘   └──────────────────────┘
```

---

## 4. Component Architecture

### 4.1 Backend (FastAPI)

**Location:** `backend/`

The backend is a Python FastAPI application responsible for:

1. **API gateway** — Proxying and transforming GitHub REST API requests
2. **Session management** — In-memory storage of Copilot session data
3. **Agent orchestration** — Forwarding context-rich queries to Azure AI
4. **Static file serving** — Serving the production-built React SPA

#### 4.1.1 Module Breakdown

| Module | Responsibility |
|---|---|
| `main.py` | FastAPI app instantiation, route definitions, CORS middleware, SPA catch-all, Azure AI agent integration |
| `github_client.py` | Async GitHub REST API wrapper (`GitHubClient` class) using `httpx` |
| `copilot_fetcher.py` | Async Copilot SDK integration for session/event retrieval |
| `requirements.txt` | Python dependency manifest |

#### 4.1.2 `GitHubClient` Class

A thin async wrapper around the GitHub REST API built on `httpx.AsyncClient`.

**Key design decisions:**

- **Token type auto-detection**: Distinguishes classic PATs (`ghp_*` → `token` prefix) from fine-grained PATs (`github_pat_*` → `Bearer` prefix) for the `Authorization` header.
- **Lifecycle management**: Each request handler creates a fresh `GitHubClient` instance and calls `close()` in a `finally` block — no shared connection pool.
- **Artifact extraction**: Downloads ZIP artifacts from GitHub Actions, extracts JSON payloads, and optionally merges `cast-impact-analysis` markdown files.

**Public methods:**

| Method | Description |
|---|---|
| `validate()` | Returns repository metadata; validates token + repo access |
| `get_workflow_id(name)` | Resolves a workflow file name to its numeric ID |
| `get_runs(workflow_id, per_page)` | Lists the latest completed runs for a workflow |
| `get_all_runs(per_page)` | Lists runs across all workflows |
| `get_artifact(run_id, artifact_name)` | Downloads a ZIP artifact, extracts and returns JSON content |

#### 4.1.3 `copilot_fetcher` Module

An async module that interfaces with the `@github/copilot` SDK via JSON-RPC.

- `_fetch_sessions(client)` — Calls `session.list` RPC, returns sorted session metadata
- `_fetch_session_events(client, session_id)` — Resumes a session then calls `session.getMessages`
- `fetch_copilot_sessions(token, limit, fetch_all)` — Orchestrates a full fetch cycle; returns `(sessions_list, session_data_map)`

#### 4.1.4 Azure AI Agent Integration

Embedded directly in `main.py` via the `_call_agent_sync()` function.

- **Authentication cascade**: `ClientSecretCredential` (service principal env vars) → `DefaultAzureCredential` (fallback for `az login`)
- **Execution model**: Synchronous Azure SDK calls wrapped with `asyncio.to_thread()` to avoid blocking the event loop
- **Agent reference**: Uses a named agent (`gatekeeper-agent`) deployed to an Azure AI project endpoint
- **Prompt construction**: Injects user-provided context between `=== CONTEXT START ===` / `=== CONTEXT END ===` markers

### 4.2 Frontend (React + Vite)

**Location:** `frontend/`

A single-page application built with React 18 and Vite 5.

#### 4.2.1 Routing Architecture

Client-side routing is handled by `react-router-dom` v6.

| Route | Component | Description |
|---|---|---|
| `/` | `LandingPage` | Repository connection form (URL + PAT) |
| `/runs` | `RunsPage` | Merged list of Gatekeeper + FRD workflow runs |
| `/runs/:runId` | `RunDetailPage` | Gatekeeper artifact JSON viewer |
| `/frd/runs/:runId` | `FRDRunDetailPage` | FRD artifact JSON viewer |
| `/sessions` | `SessionsPage` | Copilot session list with PAT fetch / folder upload |
| `/sessions/:sessionId` | `SessionDetailPage` | Session event timeline viewer |
| `/agentic` | `AgenticAnalysisPage` | Context builder + AI chat interface |

#### 4.2.2 State Management

The application uses **React local state** (`useState`) with prop-drilling for shared connection context:

- `connection` state (owner, repo, token, full_name) is lifted to `App.jsx` and passed to child routes via props.
- Session data is fetched server-side and stored in the backend's in-memory store; the frontend queries `/api/sessions` lazily.
- No external state management library (Redux, Zustand, etc.) is used.

#### 4.2.3 Build & Dev Server

| Mode | Port | Notes |
|---|---|---|
| **Development** | `3000` (Vite) | `/api` requests are proxied to `localhost:8000` via Vite's dev server proxy |
| **Production** | `8000` (FastAPI) | Vite builds static assets into `dist/`; FastAPI serves them via `StaticFiles` mount + SPA catch-all |

#### 4.2.4 Key Frontend Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.3.1 | UI library |
| `react-dom` | ^18.3.1 | DOM renderer |
| `react-router-dom` | ^6.26.0 | Client-side routing |
| `react-markdown` | ^9.0.1 | Markdown rendering (agent responses, analysis outputs) |
| `remark-gfm` | ^4.0.0 | GitHub Flavored Markdown support |
| `vite` | ^5.4.0 | Build toolchain & dev server |
| `@vitejs/plugin-react` | ^4.3.1 | React fast refresh & JSX transform |

### 4.3 Copilot Session Fetcher (Standalone CLI)

**Location:** `copilot_session_fetch.py` (project root)

A standalone Python CLI script that fetches Copilot sessions to disk (JSON files in `data/`). This is separate from the in-memory backend fetcher and is intended for offline or batch use.

**Token resolution order:**

1. `--token` CLI flag
2. `COPILOT_GITHUB_TOKEN` env var
3. `GH_TOKEN` env var
4. `GITHUB_TOKEN` env var
5. Local Copilot CLI stored credentials (fallback)

**Output structure:**

```
data/
├── sessions.json                    # Array of session metadata
└── sessions/
    ├── <session_id_1>.json          # Full event timeline per session
    └── <session_id_2>.json
```

---

## 5. Data Flow & Sequence Diagrams

### 5.1 Repository Connection Flow

```
Browser                  FastAPI              GitHub API
  │                        │                      │
  │  POST /api/connect     │                      │
  │  {github_url, token}   │                      │
  │───────────────────────>│                      │
  │                        │  GET /repos/:o/:r    │
  │                        │─────────────────────>│
  │                        │  200: repo metadata  │
  │                        │<─────────────────────│
  │  200: ConnectResponse  │                      │
  │<───────────────────────│                      │
  │                        │                      │
  │  (stores connection    │                      │
  │   in React state)      │                      │
```

### 5.2 Workflow Run & Artifact Retrieval Flow

```
Browser                  FastAPI              GitHub API
  │                        │                      │
  │  GET /api/runs?...     │                      │
  │───────────────────────>│                      │
  │                        │  GET workflows       │
  │                        │─────────────────────>│
  │                        │  GET workflow runs    │
  │                        │─────────────────────>│
  │  200: [RunSummary]     │                      │
  │<───────────────────────│                      │
  │                        │                      │
  │  GET /api/runs/:id/    │                      │
  │      artifact?...      │                      │
  │───────────────────────>│                      │
  │                        │  GET artifacts list  │
  │                        │─────────────────────>│
  │                        │  GET artifact ZIP    │
  │                        │─────────────────────>│
  │                        │  (extract JSON from  │
  │                        │   ZIP in-memory)     │
  │  200: artifact JSON    │                      │
  │<───────────────────────│                      │
```

### 5.3 Copilot Session Fetch Flow

```
Browser                  FastAPI              Copilot SDK
  │                        │                      │
  │  POST /api/sessions/   │                      │
  │       fetch {token}    │                      │
  │───────────────────────>│                      │
  │                        │  session.list (RPC)  │
  │                        │─────────────────────>│
  │                        │  session.getMessages │
  │                        │  (per session)       │
  │                        │─────────────────────>│
  │                        │                      │
  │                        │  (stores in          │
  │                        │   _session_store)    │
  │  200: {count, message} │                      │
  │<───────────────────────│                      │
  │                        │                      │
  │  GET /api/sessions     │                      │
  │───────────────────────>│                      │
  │  200: [sessions]       │                      │
  │  (from in-memory)      │                      │
  │<───────────────────────│                      │
```

### 5.4 Agentic Analysis Flow

```
Browser                  FastAPI              Azure AI
  │                        │                      │
  │  POST /api/agent/query │                      │
  │  {context, query}      │                      │
  │───────────────────────>│                      │
  │                        │  (authenticate with  │
  │                        │   SPN or DefaultCred)│
  │                        │                      │
  │                        │  agents.get(name)    │
  │                        │─────────────────────>│
  │                        │  responses.create()  │
  │                        │─────────────────────>│
  │                        │  agent response text │
  │                        │<─────────────────────│
  │  200: {response}       │                      │
  │<───────────────────────│                      │
```

---

## 6. API Specification

### 6.1 Endpoint Reference

| Method | Path | Request | Response | Description |
|---|---|---|---|---|
| `POST` | `/api/connect` | `ConnectRequest` body | `ConnectResponse` | Validate GitHub repo URL + token |
| `GET` | `/api/runs` | Query: `owner`, `repo`, `token`, `workflow_name?`, `per_page?` | `RunSummary[]` | List Gatekeeper workflow runs |
| `GET` | `/api/runs/{run_id}/artifact` | Query: `owner`, `repo`, `token`, `artifact_name?` | Artifact JSON | Download & extract GK artifact |
| `GET` | `/api/frd/runs` | Query: `owner`, `repo`, `token`, `workflow_name?`, `per_page?` | `RunSummary[]` | List FRD workflow runs |
| `GET` | `/api/frd/runs/{run_id}/artifact` | Query: `owner`, `repo`, `token`, `artifact_name?` | Artifact JSON | Download & extract FRD artifact |
| `POST` | `/api/sessions/fetch` | `SessionFetchRequest` body | `{count, message}` | Fetch Copilot sessions via SDK |
| `POST` | `/api/sessions/upload` | `SessionUploadRequest` body | `{count, details_count, message}` | Import sessions from client upload |
| `GET` | `/api/sessions` | — | `Session[]` | List in-memory sessions |
| `GET` | `/api/sessions/{session_id}` | — | Session detail with events | Get single session + event timeline |
| `POST` | `/api/agent/query` | `AgentQueryRequest` body | `{response}` | Query Azure AI agent |
| `GET` | `/{full_path:path}` | — | Static file / `index.html` | SPA catch-all (production only) |

### 6.2 Default Parameters

| Endpoint | Parameter | Default |
|---|---|---|
| `/api/runs` | `workflow_name` | `"Gatekeeper Analysis"` |
| `/api/runs` | `per_page` | `10` |
| `/api/runs/{id}/artifact` | `artifact_name` | `"gatekeeper-final-analysis"` |
| `/api/frd/runs` | `workflow_name` | `"Feature Requirement Analysis"` |
| `/api/frd/runs/{id}/artifact` | `artifact_name` | `"feature-requirement-analysis"` |
| `/api/sessions/fetch` | `limit` | `50` |
| `/api/sessions/fetch` | `fetch_all` | `false` |

---

## 7. Data Models

### 7.1 Request Models (Pydantic)

```python
class ConnectRequest(BaseModel):
    github_url: str          # Full GitHub repo URL
    token: str               # GitHub PAT

class SessionFetchRequest(BaseModel):
    token: str               # GitHub PAT with Copilot scope
    limit: int = 50          # Max sessions to fetch
    fetch_all: bool = False  # Override limit, fetch everything

class SessionUploadRequest(BaseModel):
    sessions: list[dict]           # Session metadata array
    session_data: dict[str, Any]   # session_id -> full session JSON

class AgentQueryRequest(BaseModel):
    context: str             # Assembled context (workflow outputs, sessions)
    query: str               # User's natural language question
```

### 7.2 Response Models

```python
class ConnectResponse(BaseModel):
    owner: str
    repo: str
    full_name: str
    description: str | None
    default_branch: str

class RunSummary(BaseModel):
    id: int
    status: str
    conclusion: str | None
    created_at: str
    updated_at: str
    html_url: str
    head_sha: str            # First 7 chars
    display_title: str
    run_number: int
    actor: str
    actor_avatar: str
```

### 7.3 In-Memory Session Store

```python
_session_store: dict[str, Any] = {
    "sessions": [],          # list[dict] — session metadata
    "session_data": {},      # dict[str, dict] — session_id -> {metadata + events}
}
```

This is a **module-level singleton dictionary** — not a database. Data is lost on process restart or redeployment.

### 7.4 Artifact JSON Structure

**Gatekeeper Analysis artifact** (from `gatekeeper-final-analysis` ZIP):

```
gatekeeper-consolidated.json or council-results.json
├── steps
│   └── <step_name>
│       ├── title: str
│       └── council_results
│           └── stage3
│               └── final_answer: str   (chairman output)
├── cast_impact_analysis: str           (optional, merged from .md file in ZIP)
```

**FRD Analysis artifact** (from `feature-requirement-analysis` ZIP):

```
<artifact>.json
├── stage3
│   └── final_answer: str               (chairman output)
```

---

## 8. Authentication & Security

### 8.1 GitHub API Authentication

- Tokens are passed **per-request** from the frontend as query parameters or request body fields.
- The backend **never persists** tokens — they live only in the HTTP request/response lifecycle.
- Token type is auto-detected by prefix:
  - `github_pat_*` → `Authorization: Bearer <token>`
  - `ghp_*` (classic) → `Authorization: token <token>`

### 8.2 Azure AI Authentication

Two-tier credential strategy:

| Priority | Credential Type | When Used |
|---|---|---|
| 1 | `ClientSecretCredential` | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` env vars are all set |
| 2 | `DefaultAzureCredential` | Fallback — works with `az login` locally; may fail in bare Docker containers |

### 8.3 CORS Policy

```python
CORSMiddleware(
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

> **Note:** This is a permissive policy suitable for development and internal tooling. For internet-facing deployments, origins should be restricted.

### 8.4 Security Considerations

- **Token exposure in URLs**: GitHub tokens are passed as query parameters on `GET` endpoints (e.g., `/api/runs?token=...`). This means tokens may appear in server access logs and browser history. Consider migrating to header-based or session-based token passing for improved security.
- **Error message sanitization**: The session fetch endpoint explicitly scrubs tokens from error messages before returning them to the client.
- **No persistent storage**: The application has no database — all data is ephemeral (in-memory Python dicts). There is no risk of data leakage from a compromised data store.
- **`.env` file in Docker image**: The Dockerfile copies `.env` into the image (`COPY .env* ./`). For production, prefer runtime injection via `--env-file` or platform-level secret management.

---

## 9. External Integrations

### 9.1 GitHub REST API

| Aspect | Detail |
|---|---|
| **Client library** | `httpx` (async) |
| **Base URL** | `https://api.github.com` |
| **API version header** | `X-GitHub-Api-Version: 2022-11-28` |
| **Timeout** | 60 seconds |
| **Required PAT scopes** | Classic: `repo`, `actions:read`; Fine-grained: `Actions: Read`, `Contents: Read` |

**Endpoints consumed:**

- `GET /repos/{owner}/{repo}` — Repo validation
- `GET /repos/{owner}/{repo}/actions/workflows` — Workflow discovery
- `GET /repos/{owner}/{repo}/actions/workflows/{id}/runs` — Run listing
- `GET /repos/{owner}/{repo}/actions/runs/{id}/artifacts` — Artifact metadata
- `GET /repos/{owner}/{repo}/actions/artifacts/{id}/zip` — Artifact download

### 9.2 Copilot CLI SDK

| Aspect | Detail |
|---|---|
| **Package** | `@github/copilot` (Node.js, via `github-copilot-sdk` Python bridge) |
| **Protocol** | JSON-RPC over stdio |
| **RPCs used** | `session.list`, `session.getMessages` |
| **Prerequisite** | `npm install -g @github/copilot` |

### 9.3 Azure AI Projects

| Aspect | Detail |
|---|---|
| **SDK** | `azure-ai-projects` (>=2.0.0b1) |
| **Auth SDK** | `azure-identity` |
| **Endpoint** | Configured via `AGENT_ENDPOINT` constant |
| **Agent** | Named agent (`gatekeeper-agent`) resolved by `agents.get(agent_name=...)` |
| **LLM call** | `openai_client.responses.create()` with `agent_reference` in `extra_body` |

---

## 10. State Management

### 10.1 Backend State

The backend is **stateless** with one exception — the in-memory session store (`_session_store`):

```
Process Memory
├── _session_store["sessions"]        → list[dict]
└── _session_store["session_data"]    → dict[str, dict]
```

- **Populated by**: `POST /api/sessions/fetch` or `POST /api/sessions/upload`
- **Read by**: `GET /api/sessions`, `GET /api/sessions/{id}`
- **Lifetime**: Single process lifetime (lost on restart)

All other data (GitHub runs, artifacts, agent responses) is fetched on-demand and never cached.

### 10.2 Frontend State

| State | Location | Persistence |
|---|---|---|
| `connection` (owner, repo, token, full_name) | `App.jsx` (`useState`) | Page session only |
| Workflow run lists | Page-level `useState` | Refetched on mount |
| Artifact data | Page-level `useState` | Refetched on navigation |
| Session list | `SessionsPage` `useState` | Refetched on mount |
| Agent chat messages | `AgenticAnalysisPage` `useState` | Lost on navigation |
| Agent context | `AgenticAnalysisPage` `useState` | Lost on navigation |

**No data is persisted to `localStorage`, `sessionStorage`, or `IndexedDB`.**

---

## 11. Deployment Architecture

### 11.1 Docker Multi-Stage Build

```dockerfile
# Stage 1: Frontend Build
FROM node:20-slim AS frontend-build
  → npm install
  → vite build → produces dist/

# Stage 2: Runtime
FROM python:3.12-slim
  → Install Node.js 20 (for Copilot CLI)
  → npm install -g @github/copilot
  → pip install -r requirements.txt
  → Copy backend source
  → Copy .env (Azure credentials)
  → Copy dist/ → backend/static/
  → EXPOSE 8000
  → CMD uvicorn backend.main:app
```

### 11.2 Production Serving Model

In production (Docker), FastAPI serves everything on a **single port (8000)**:

```
Port 8000
├── /api/*           → FastAPI route handlers
├── /assets/*        → StaticFiles mount (Vite-built JS/CSS)
└── /*               → SPA catch-all → index.html
```

No reverse proxy (Nginx, Caddy) is required — Uvicorn handles both API and static assets.

### 11.3 Local Development Model

```
Port 3000 (Vite dev server)
├── /*               → React HMR + fast refresh
└── /api/*           → Proxy → http://localhost:8000

Port 8000 (Uvicorn)
└── /api/*           → FastAPI route handlers
```

### 11.4 Runtime Dependencies

The Docker image bundles two runtimes:

| Runtime | Version | Purpose |
|---|---|---|
| Python | 3.12 | FastAPI server, Azure SDK, HTTP client |
| Node.js | 20.x | `@github/copilot` CLI (required by Copilot SDK) |

---

## 12. Technology Stack

### 12.1 Backend

| Technology | Version | Role |
|---|---|---|
| Python | 3.12 | Runtime |
| FastAPI | 0.115.0 | Web framework |
| Uvicorn | 0.30.0 | ASGI server |
| httpx | 0.27.0 | Async HTTP client (GitHub API) |
| python-dotenv | 1.0.1 | `.env` file loading |
| python-multipart | 0.0.9 | Form data parsing |
| azure-ai-projects | >=2.0.0b1 | Azure AI agent SDK |
| azure-identity | latest | Azure credential management |
| github-copilot-sdk | latest | Copilot CLI Python bridge |
| Pydantic | (bundled with FastAPI) | Request/response validation |

### 12.2 Frontend

| Technology | Version | Role |
|---|---|---|
| React | 18.3.1 | UI framework |
| React DOM | 18.3.1 | DOM rendering |
| React Router DOM | 6.26.0 | Client-side routing |
| react-markdown | 9.0.1 | Markdown rendering |
| remark-gfm | 4.0.0 | GitHub Flavored Markdown |
| Vite | 5.4.0 | Build tool & dev server |
| @vitejs/plugin-react | 4.3.1 | React plugin for Vite |

### 12.3 Infrastructure

| Technology | Role |
|---|---|
| Docker | Containerisation (multi-stage build) |
| Node.js 20 (in-container) | Copilot CLI runtime |

---

## 13. Configuration & Environment

### 13.1 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AZURE_TENANT_ID` | For Agentic Analysis | Azure AD tenant ID |
| `AZURE_CLIENT_ID` | For Agentic Analysis | Service principal app ID |
| `AZURE_CLIENT_SECRET` | For Agentic Analysis | Service principal secret |

These are loaded from a `.env` file at the project root via `python-dotenv`.

### 13.2 Hardcoded Configuration

| Constant | Value | Location |
|---|---|---|
| `AGENT_ENDPOINT` | `https://abpatra-7946-resource.services.ai.azure.com/api/projects/abpatra-7946` | `main.py` |
| `AGENT_NAME` | `gatekeeper-agent` | `main.py` |
| Default Gatekeeper workflow name | `Gatekeeper Analysis` | `main.py` |
| Default FRD workflow name | `Feature Requirement Analysis` | `main.py` |
| Default GK artifact name | `gatekeeper-final-analysis` | `main.py` |
| Default FRD artifact name | `feature-requirement-analysis` | `main.py` |
| Vite dev server port | `3000` | `vite.config.js` |
| Backend server port | `8000` | Dockerfile CMD / Uvicorn |

### 13.3 `.env` File Location

Resolved at startup:

```python
_env_path = Path(__file__).resolve().parent.parent / ".env"
```

This targets the **project root** regardless of whether the app is run from `backend/` directly or as `backend.main` from the root.

---

## 14. Error Handling Strategy

### 14.1 Backend Error Mapping

The backend translates domain exceptions to HTTP status codes:

| Exception | HTTP Status | Scenario |
|---|---|---|
| `ValueError` | 400 | Invalid GitHub URL format |
| `PermissionError` | 401 / 403 | Invalid or insufficient token |
| `LookupError` | 404 | Repository or workflow not found |
| `HTTPException(404)` | 404 | Artifact not found or session not fetched |
| `HTTPException(500)` | 500 | Azure AI agent call failure, Copilot SDK failure |

### 14.2 Token Scrubbing

When Copilot session fetch fails, the token is scrubbed from the error message before returning it to the client:

```python
err = str(exc).replace(body.token, "***")
```

### 14.3 Frontend Error Display

Each page component manages its own `error` state and renders an `error-banner` div when non-empty. Errors are caught at the `fetch()` call site and surfaced inline — no global error boundary is implemented.

---

## 15. Appendix

### 15.1 Artifact ZIP Extraction Logic

The artifact download pipeline in `GitHubClient.get_artifact()`:

1. **List artifacts** for the run via GitHub API
2. **Match by name** (e.g., `gatekeeper-final-analysis`)
3. **Download ZIP** with redirect following
4. **Extract JSON** by priority:
   - `gatekeeper-consolidated.json`
   - `council-results.json`
   - Any `.json` file (fallback)
5. **Merge CAST impact analysis** — if a `cast-impact-analysis*` file is found in the ZIP, its markdown content is added as `result["cast_impact_analysis"]`

### 15.2 Session Upload Flow

In addition to the SDK-based fetch, the frontend supports **folder upload** via `POST /api/sessions/upload`. This allows users to import a previously exported `data/` folder (from the standalone CLI script) directly through the browser.

### 15.3 Agentic Analysis Context Construction

The `AgenticAnalysisPage` builds context by:

1. Loading available sources (sessions + workflow runs)
2. User selects specific workflow runs and/or sessions
3. For each selected workflow run: fetches the artifact and extracts chairman final outputs
4. For each selected session: fetches session detail events
5. Assembles all extracted content into a single context string
6. Context + user query are sent to `POST /api/agent/query`

### 15.4 SPA Catch-All Routing

In production, FastAPI registers a wildcard route at the lowest priority:

```python
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    file = _STATIC_DIR / full_path
    if file.is_file():
        return FileResponse(file)
    return FileResponse(_STATIC_DIR / "index.html")
```

This ensures that deep-linked React Router paths (e.g., `/sessions/abc123`) return `index.html` and let the client-side router handle navigation.
