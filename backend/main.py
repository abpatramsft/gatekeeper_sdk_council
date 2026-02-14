"""FastAPI backend for Gatekeeper Viewer."""

from __future__ import annotations

import asyncio
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from github_client import GitHubClient
from copilot_fetcher import fetch_copilot_sessions

app = FastAPI(title="Gatekeeper Viewer API", version="1.0.0")

# ── in-memory session store (populated via /api/sessions/fetch) ──
_session_store: dict[str, Any] = {
    "sessions": [],       # list of session metadata
    "session_data": {},   # session_id -> full session data with events
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── request / response models ───────────────────────────────

class ConnectRequest(BaseModel):
    github_url: str
    token: str


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
    head_sha: str
    display_title: str
    run_number: int
    actor: str
    actor_avatar: str


# ── helpers ──────────────────────────────────────────────────

_GITHUB_URL_RE = re.compile(
    r"(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:\.git)?/?$"
)


def parse_github_url(url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a GitHub URL."""
    m = _GITHUB_URL_RE.match(url.strip())
    if not m:
        raise ValueError(f"Invalid GitHub URL: {url}")
    return m.group(1), m.group(2)


def _make_client(owner: str, repo: str, token: str) -> GitHubClient:
    return GitHubClient(token=token, owner=owner, repo=repo)


# ── endpoints ────────────────────────────────────────────────

@app.post("/api/connect", response_model=ConnectResponse)
async def connect(body: ConnectRequest) -> Any:
    """Validate GitHub URL + token and return repo metadata."""
    try:
        owner, repo = parse_github_url(body.github_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    client = _make_client(owner, repo, body.token)
    try:
        info = await client.validate()
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"GitHub API error: {exc}")
    finally:
        await client.close()

    return ConnectResponse(
        owner=owner,
        repo=repo,
        full_name=info.get("full_name", f"{owner}/{repo}"),
        description=info.get("description"),
        default_branch=info.get("default_branch", "main"),
    )


@app.get("/api/runs")
async def list_runs(
    owner: str,
    repo: str,
    token: str,
    workflow_name: str = "Gatekeeper Analysis",
    per_page: int = 10,
) -> list[dict]:
    """Return the latest workflow runs for the given workflow name."""
    client = _make_client(owner, repo, token)
    try:
        wf_id = await client.get_workflow_id(workflow_name)
        if wf_id is None:
            raise HTTPException(
                status_code=404,
                detail=f"Workflow '{workflow_name}' not found in {owner}/{repo}",
            )
        return await client.get_runs(wf_id, per_page=per_page)
    finally:
        await client.close()


@app.get("/api/runs/{run_id}/artifact")
async def get_run_artifact(
    run_id: int,
    owner: str,
    repo: str,
    token: str,
    artifact_name: str = "gatekeeper-final-analysis",
) -> Any:
    """Download and return the JSON artifact for a specific run."""
    client = _make_client(owner, repo, token)
    try:
        result = await client.get_artifact(run_id, artifact_name)
        if result is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        if "error" in result and "available" in result:
            raise HTTPException(status_code=404, detail=result)
        return result
    finally:
        await client.close()


# ── Feature Requirement Analysis (FRD) endpoints ────────────

@app.get("/api/frd/runs")
async def list_frd_runs(
    owner: str,
    repo: str,
    token: str,
    workflow_name: str = "Feature Requirement Analysis",
    per_page: int = 10,
) -> list[dict]:
    """Return the latest workflow runs for the Feature Requirement Analysis workflow."""
    client = _make_client(owner, repo, token)
    try:
        wf_id = await client.get_workflow_id(workflow_name)
        if wf_id is None:
            raise HTTPException(
                status_code=404,
                detail=f"Workflow '{workflow_name}' not found in {owner}/{repo}",
            )
        return await client.get_runs(wf_id, per_page=per_page)
    finally:
        await client.close()


@app.get("/api/frd/runs/{run_id}/artifact")
async def get_frd_run_artifact(
    run_id: int,
    owner: str,
    repo: str,
    token: str,
    artifact_name: str = "feature-requirement-analysis",
) -> Any:
    """Download and return the JSON artifact for a Feature Requirement Analysis run."""
    client = _make_client(owner, repo, token)
    try:
        result = await client.get_artifact(run_id, artifact_name)
        if result is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        if "error" in result and "available" in result:
            raise HTTPException(status_code=404, detail=result)
        return result
    finally:
        await client.close()


# ── Copilot session endpoints ────────────────────────────────

class SessionFetchRequest(BaseModel):
    token: str
    limit: int = 50
    fetch_all: bool = False


@app.post("/api/sessions/fetch")
async def fetch_sessions_endpoint(body: SessionFetchRequest) -> dict:
    """Fetch Copilot sessions using the supplied PAT — purely in-memory, no disk I/O."""
    try:
        sessions, session_data = await fetch_copilot_sessions(
            token=body.token,
            limit=body.limit,
            fetch_all=body.fetch_all,
        )
    except Exception as exc:
        # Scrub the token from error messages
        err = str(exc).replace(body.token, "***")
        raise HTTPException(status_code=500, detail=f"Fetch failed: {err}")

    _session_store["sessions"] = sessions
    _session_store["session_data"] = session_data

    return {
        "count": len(sessions),
        "message": f"Fetched {len(sessions)} session(s) successfully",
    }


@app.get("/api/sessions")
async def list_sessions() -> list[dict]:
    """Return all Copilot sessions from the in-memory store."""
    return _session_store["sessions"]


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str) -> dict:
    """Return full session data including events for a specific session."""
    data = _session_store["session_data"].get(session_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found. Fetch sessions first.")
    return data


# ── Agentic Analysis endpoints ───────────────────────────────

AGENT_ENDPOINT = "https://abpatra-7946-resource.services.ai.azure.com/api/projects/abpatra-7946"
AGENT_NAME = "gatekeeper-agent"


class AgentQueryRequest(BaseModel):
    context: str
    query: str


def _call_agent_sync(context: str, query: str) -> str:
    """Synchronous call to the Azure AI agent (runs in thread pool)."""
    from azure.identity import DefaultAzureCredential
    from azure.ai.projects import AIProjectClient

    project_client = AIProjectClient(
        endpoint=AGENT_ENDPOINT,
        credential=DefaultAzureCredential(),
    )

    agent = project_client.agents.get(agent_name=AGENT_NAME)
    openai_client = project_client.get_openai_client()

    user_message = f"""You are provided with context data from workflow analyses and copilot sessions.
Use this context to answer the user's question accurately.

=== CONTEXT START ===
{context}
=== CONTEXT END ===

User Question: {query}"""

    response = openai_client.responses.create(
        input=[{"role": "user", "content": user_message}],
        extra_body={"agent": {"name": agent.name, "type": "agent_reference"}},
    )

    return response.output_text


@app.post("/api/agent/query")
async def agent_query(body: AgentQueryRequest) -> dict:
    """Send a query to the Azure AI agent with the provided context."""
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    if not body.context.strip():
        raise HTTPException(status_code=400, detail="Context cannot be empty. Please load context first.")

    try:
        result = await asyncio.to_thread(_call_agent_sync, body.context, body.query)
        return {"response": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent call failed: {exc}")
