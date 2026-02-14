# Gatekeeper Viewer

A web application to browse **Gatekeeper Analysis** workflow results from GitHub Actions.

## Architecture

```
gatekeeper-viewer/
├── backend/           # FastAPI server (proxies GitHub API)
│   ├── main.py        # API endpoints
│   ├── github_client.py   # GitHub REST API wrapper
│   └── requirements.txt
└── frontend/          # React + Vite UI
    ├── src/
    │   ├── App.jsx
    │   └── pages/
    │       ├── LandingPage.jsx    # Connect to repo
    │       ├── RunsPage.jsx       # List last 10 runs
    │       └── RunDetailPage.jsx  # Full artifact viewer
    └── package.json
```

## Quick Start

### 1. Backend

```bash
cd gatekeeper-viewer/backend
python -m venv .venv
venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd gatekeeper-viewer/frontend
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

## How It Works

1. **Landing page** — Enter a GitHub repo URL and a Personal Access Token (PAT) with `actions:read` scope.
2. **Runs page** — Displays the last 10 completed *Gatekeeper Analysis* workflow runs.
3. **Detail page** — Click any run to download and render the full artifact JSON:
   - Tabs for each step (Requirement Drift, Technical Excellence, Unit Test Coverage, Production Readiness)
   - Accordion sections for Stage 1 (individual model responses), Stage 2 (peer rankings), and Stage 3 (chairman's final answer)
   - Markdown rendered with tables, code blocks, etc.

## API Endpoints

| Method | Path                           | Description                        |
|--------|--------------------------------|------------------------------------|
| POST   | `/api/connect`                 | Validate repo URL + token          |
| GET    | `/api/runs`                    | List latest 10 workflow runs       |
| GET    | `/api/runs/{run_id}/artifact`  | Download & return artifact JSON    |

All endpoints accept `owner`, `repo`, `token` as query params (except `/api/connect` which takes them in the body).
