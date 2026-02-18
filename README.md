# Gatekeeper Viewer

A web application to browse **Gatekeeper Analysis** and **Feature Requirement Analysis** workflow results from GitHub Actions, inspect **Copilot CLI sessions**, and run **agentic analysis** via Azure AI.

## Architecture

```
gatekeeper-viewer/
├── Dockerfile              # Multi-stage Docker build
├── .dockerignore
├── copilot_session_fetch.py  # Standalone Copilot session fetcher
├── backend/                # FastAPI server
│   ├── main.py             # API endpoints + SPA static serving
│   ├── github_client.py    # GitHub REST API wrapper
│   ├── copilot_fetcher.py  # In-memory Copilot session fetcher
│   └── requirements.txt
└── frontend/               # React + Vite UI
    ├── src/
    │   ├── App.jsx
    │   └── pages/
    │       ├── LandingPage.jsx        # Connect to repo
    │       ├── RunsPage.jsx           # Gatekeeper workflow runs
    │       ├── RunDetailPage.jsx      # Gatekeeper artifact viewer
    │       ├── FRDRunsPage.jsx        # Feature Requirement Analysis runs
    │       ├── FRDRunDetailPage.jsx   # FRD artifact viewer
    │       ├── SessionsPage.jsx       # Copilot CLI sessions list
    │       ├── SessionDetailPage.jsx  # Session event timeline
    │       └── AgenticAnalysisPage.jsx # Azure AI agentic queries
    └── package.json
```

## Environment Setup

Before running the app, create a **`.env`** file in the project root with the following variables:

```env
# Azure Service Principal — required for Agentic Analysis feature
AZURE_TENANT_ID=<your-azure-tenant-id>
AZURE_CLIENT_ID=<your-azure-client-id>
AZURE_CLIENT_SECRET=<your-azure-client-secret>
```

> **Where to get these values:**
> 1. Go to the [Azure Portal → Microsoft Entra ID → App registrations](https://portal.azure.com/#view/Microsoft_AAD_IAM/ActiveDirectoryMenuBlade/~/RegisteredApps).
> 2. Select your app registration (or create one).
> 3. Copy the **Application (client) ID** → `AZURE_CLIENT_ID`
> 4. Copy the **Directory (tenant) ID** → `AZURE_TENANT_ID`
> 5. Under **Certificates & secrets**, create a new client secret → `AZURE_CLIENT_SECRET`
>
> The service principal must have the necessary role assignments on your Azure AI project resource.

If the `.env` file is missing or incomplete, the Agentic Analysis feature will fall back to `DefaultAzureCredential` (works with `az login` locally but will fail inside Docker).

## Quick Start

### Option A: Docker (recommended)

```bash
docker build -t gatekeeper-viewer .
docker run -p 8000:8000 gatekeeper-viewer
```

> The `.env` file is automatically copied into the image. Alternatively, you can skip the file and pass env vars at runtime:
> ```bash
> docker run --env-file .env -p 8000:8000 gatekeeper-viewer
> ```

Open **http://localhost:8000** — the entire app (API + UI) is served on a single port.

### Option B: Local development

#### 1. Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

> **Note:** The Copilot session features require the Copilot CLI:
> ```bash
> npm install -g @github/copilot
> ```

#### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** — Vite proxies `/api` requests to the backend on port 8000.

## Features

1. **Landing page** — Enter a GitHub repo URL and a Personal Access Token (PAT) with `actions:read` scope.
2. **Gatekeeper runs** — Browse the latest completed *Gatekeeper Analysis* workflow runs and inspect full artifact JSON (Requirement Drift, Technical Excellence, Unit Test Coverage, Production Readiness).
3. **FRD runs** — Browse *Feature Requirement Analysis* workflow runs and their artifacts.
4. **Copilot sessions** — Fetch and explore Copilot CLI session metadata and event timelines (requires a PAT with Copilot scope).
5. **Agentic analysis** — Send context from any of the above to an Azure AI agent for deeper analysis.

## API Endpoints

| Method | Path                              | Description                                  |
|--------|-----------------------------------|----------------------------------------------|
| POST   | `/api/connect`                    | Validate repo URL + token                    |
| GET    | `/api/runs`                       | List latest Gatekeeper workflow runs         |
| GET    | `/api/runs/{run_id}/artifact`     | Download & return Gatekeeper artifact JSON   |
| GET    | `/api/frd/runs`                   | List latest FRD workflow runs                |
| GET    | `/api/frd/runs/{run_id}/artifact` | Download & return FRD artifact JSON          |
| POST   | `/api/sessions/fetch`             | Fetch Copilot sessions (body: `token`)       |
| GET    | `/api/sessions`                   | List fetched sessions from memory            |
| GET    | `/api/sessions/{session_id}`      | Get session detail with events               |
| POST   | `/api/agent/query`                | Query Azure AI agent with context            |

## Docker Details

The [Dockerfile](Dockerfile) uses a **multi-stage build**:

1. **Stage 1** (`node:20-slim`) — Installs frontend dependencies and runs `vite build`.
2. **Stage 2** (`python:3.12-slim`) — Installs Node.js 20 (for `@github/copilot` CLI), Python dependencies, copies backend source, and serves the built frontend as static files through FastAPI.

The final image serves everything on **port 8000** with no external web server required.


## Required additional package installation

This application fetches and visualises the gatekeeper runs in your project. It uses these following runs:
- Feature requirement Analysis workflow run (pre dev)
- Gatekeeper Analysis workflow run (post dev)

For your existing project on your local simply install [gatekeeper-dev-kit](https://github.com/abpatramsft/gatekeeper_dev_kit) and initialise your project with gatekeeper-dev-kit that adds the required packages to your project codebase.
