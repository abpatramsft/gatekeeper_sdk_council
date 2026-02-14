"""
In-memory Copilot session fetcher.

Connects to the Copilot SDK with a PAT, fetches session metadata + events,
and returns everything as plain dicts — no disk I/O.
"""

from __future__ import annotations

import asyncio
from typing import Any

from copilot import CopilotClient


async def _fetch_sessions(client: CopilotClient) -> list[dict]:
    """Fetch all sessions via the session.list RPC."""
    response = await client._client.request("session.list", {})
    sessions = response if isinstance(response, list) else response.get("sessions", [])
    sessions.sort(key=lambda s: s.get("startTime", ""), reverse=True)
    return sessions


async def _fetch_session_events(client: CopilotClient, session_id: str) -> list[dict]:
    """Fetch the full event timeline for a single session."""
    try:
        await client.resume_session(session_id)
        result = await client._client.request(
            "session.getMessages", {"sessionId": session_id}
        )
        return result.get("events", [])
    except Exception:
        return []


async def fetch_copilot_sessions(
    token: str,
    limit: int = 50,
    fetch_all: bool = False,
) -> tuple[list[dict], dict[str, dict]]:
    """
    Fetch Copilot sessions and their events purely in-memory.

    Returns:
        (sessions_list, session_data_map)
        - sessions_list: list of session metadata dicts
        - session_data_map: { session_id: { ...metadata, events: [...] } }
    """
    client = CopilotClient({
        "github_token": token,
        "use_logged_in_user": False,
    })
    await client.start()

    try:
        sessions = await _fetch_sessions(client)

        cap = None if fetch_all else limit
        sessions = sessions[:cap] if cap else sessions

        session_data: dict[str, dict] = {}
        for s in sessions:
            sid = s.get("sessionId")
            if not sid:
                continue
            events = await _fetch_session_events(client, sid)
            session_data[sid] = {**s, "events": events}

        return sessions, session_data
    finally:
        await client.stop()
