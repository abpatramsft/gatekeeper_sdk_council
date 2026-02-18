"""GitHub API client for fetching workflow runs and artifacts."""

import io
import json
import zipfile
from typing import Any

import httpx


class GitHubClient:
    """Thin wrapper around the GitHub REST API."""

    BASE = "https://api.github.com"

    def __init__(self, token: str, owner: str, repo: str) -> None:
        self.owner = owner
        self.repo = repo
        # Use 'token' prefix for classic PATs (ghp_), 'Bearer' for fine-grained (github_pat_)
        prefix = "Bearer" if token.startswith("github_pat_") else "token"
        self.headers = {
            "Authorization": f"{prefix} {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self._client = httpx.AsyncClient(
            base_url=self.BASE,
            headers=self.headers,
            timeout=60.0,
        )

    async def close(self) -> None:
        await self._client.aclose()

    # ── helpers ──────────────────────────────────────────────

    def _repo_prefix(self) -> str:
        return f"/repos/{self.owner}/{self.repo}"

    async def _get_json(self, path: str, params: dict | None = None) -> Any:
        r = await self._client.get(path, params=params)
        if r.status_code == 401:
            raise PermissionError("Invalid token — check that your PAT is correct and not expired.")
        if r.status_code == 403:
            raise PermissionError(
                "Access denied (403). Your token may lack the required scope. "
                "Classic PATs need 'repo' scope; fine-grained PATs need "
                "'Actions: Read' and 'Contents: Read' permissions for this repository."
            )
        if r.status_code == 404:
            raise LookupError(
                f"Repository not found or not accessible with this token."
            )
        r.raise_for_status()
        return r.json()

    # ── public API ───────────────────────────────────────────

    async def validate(self) -> dict:
        """Return basic repo info (validates token + repo access)."""
        return await self._get_json(f"{self._repo_prefix()}")

    async def get_workflow_id(self, workflow_name: str = "Gatekeeper Analysis") -> int | None:
        """Find the workflow ID by name."""
        data = await self._get_json(f"{self._repo_prefix()}/actions/workflows")
        for wf in data.get("workflows", []):
            if wf["name"] == workflow_name:
                return wf["id"]
        return None

    async def get_runs(
        self,
        workflow_id: int,
        per_page: int = 10,
    ) -> list[dict]:
        """Return the latest *per_page* completed runs."""
        data = await self._get_json(
            f"{self._repo_prefix()}/actions/workflows/{workflow_id}/runs",
            params={"per_page": per_page, "status": "completed"},
        )
        runs = data.get("workflow_runs", [])
        return [
            {
                "id": r["id"],
                "status": r["status"],
                "conclusion": r["conclusion"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "html_url": r["html_url"],
                "head_sha": r["head_sha"][:7],
                "display_title": r["display_title"],
                "run_number": r["run_number"],
                "actor": r.get("actor", {}).get("login", "unknown"),
                "actor_avatar": r.get("actor", {}).get("avatar_url", ""),
            }
            for r in runs
        ]

    async def get_all_runs(self, per_page: int = 10) -> list[dict]:
        """Return latest runs for ALL workflow types, not just Gatekeeper Analysis."""
        data = await self._get_json(
            f"{self._repo_prefix()}/actions/runs",
            params={"per_page": per_page},
        )
        runs = data.get("workflow_runs", [])
        return [
            {
                "id": r["id"],
                "status": r["status"],
                "conclusion": r["conclusion"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
                "html_url": r["html_url"],
                "head_sha": r["head_sha"][:7],
                "display_title": r["display_title"],
                "run_number": r["run_number"],
                "workflow_name": r.get("name", "Unknown"),
                "actor": r.get("actor", {}).get("login", "unknown"),
                "actor_avatar": r.get("actor", {}).get("avatar_url", ""),
            }
            for r in runs
        ]

    async def get_artifact(
        self,
        run_id: int,
        artifact_name: str = "gatekeeper-final-analysis",
    ) -> dict | None:
        """Download the ZIP artifact and extract the consolidated JSON."""
        # 1. list artifacts for the run
        data = await self._get_json(
            f"{self._repo_prefix()}/actions/runs/{run_id}/artifacts"
        )
        artifact_id: int | None = None
        available: list[str] = []
        for a in data.get("artifacts", []):
            available.append(a["name"])
            if a["name"] == artifact_name:
                artifact_id = a["id"]
                break

        if artifact_id is None:
            return {"error": f"Artifact '{artifact_name}' not found", "available": available}

        # 2. download zip
        r = await self._client.get(
            f"{self._repo_prefix()}/actions/artifacts/{artifact_id}/zip",
            follow_redirects=True,
        )
        r.raise_for_status()

        # 3. extract JSON from zip
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        json_candidates = ["gatekeeper-consolidated.json", "council-results.json"]

        for candidate in json_candidates:
            # search flat & nested
            for name in zf.namelist():
                if name.endswith(candidate):
                    result = json.loads(zf.read(name))
                    # Also look for cast-impact-analysis markdown and merge it in
                    result = self._merge_cast_impact(zf, result)
                    return result

        # fallback: any .json
        for name in zf.namelist():
            if name.endswith(".json"):
                result = json.loads(zf.read(name))
                result = self._merge_cast_impact(zf, result)
                return result

        return {"error": "No JSON found in artifact"}

    @staticmethod
    def _merge_cast_impact(zf: zipfile.ZipFile, result: dict) -> dict:
        """If the zip contains a cast-impact-analysis file, merge its markdown content into the result dict."""
        for name in zf.namelist():
            basename = name.rsplit("/", 1)[-1] if "/" in name else name
            if basename.startswith("cast-impact-analysis"):
                try:
                    content = zf.read(name).decode("utf-8", errors="replace")
                    result["cast_impact_analysis"] = content
                except Exception:
                    pass
                break
        return result
