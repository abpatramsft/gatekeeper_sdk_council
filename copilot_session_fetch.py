"""
Fetch Copilot CLI sessions and dump them as JSON to the data folder.

Authentication (in priority order):
  1. --token flag           (explicit PAT)
  2. COPILOT_GITHUB_TOKEN   env var
  3. GH_TOKEN               env var
  4. GITHUB_TOKEN           env var
  5. Local Copilot CLI auth (fallback — uses stored credentials from `copilot` login)

Supported token types:
  - github_pat_*  (fine-grained PAT)
  - gho_*         (OAuth user access token)
  - ghu_*         (GitHub App user access token)

Usage:
    python copilot_session_fetch.py                          # Local CLI auth or env var
    python copilot_session_fetch.py --token github_pat_xx    # Explicit PAT
    python copilot_session_fetch.py --all                    # Fetch ALL sessions
    python copilot_session_fetch.py --limit 50               # Fetch 50 most recent
    python copilot_session_fetch.py --list-only              # Only dump sessions.json

Output:
    data/sessions.json                             # Array of session metadata
    data/sessions/<session_id>.json                # Full event timeline per session
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from copilot import CopilotClient

# Output directory (relative to this script)
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SESSIONS_DIR = os.path.join(DATA_DIR, "sessions")


def ensure_dirs():
    os.makedirs(SESSIONS_DIR, exist_ok=True)


def parse_time(iso_str: str) -> str:
    """Convert ISO timestamp to a human-readable local time string."""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        local_dt = dt.astimezone()
        return local_dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return iso_str


async def fetch_sessions(client: CopilotClient) -> list:
    """Fetch all sessions from the Copilot CLI via the session.list RPC."""
    response = await client._client.request("session.list", {})
    sessions = response if isinstance(response, list) else response.get("sessions", [])
    sessions.sort(key=lambda s: s.get("startTime", ""), reverse=True)
    return sessions


async def fetch_session_events(client: CopilotClient, session_id: str) -> list:
    """Fetch the full event timeline for a single session."""
    try:
        await client.resume_session(session_id)
        result = await client._client.request(
            "session.getMessages", {"sessionId": session_id}
        )
        return result.get("events", [])
    except Exception as e:
        print(f"  [WARN] Could not fetch events for {session_id}: {e}")
        return []


def dump_json(path: str, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str, ensure_ascii=False)


async def main():
    parser = argparse.ArgumentParser(
        description="Fetch Copilot CLI sessions and dump to data folder"
    )
    parser.add_argument("--all", action="store_true", help="Fetch all sessions")
    parser.add_argument("--limit", type=int, default=50, help="Max sessions (default: 50)")
    parser.add_argument(
        "--list-only", action="store_true",
        help="Only dump sessions.json, skip per-session event files",
    )
    parser.add_argument(
        "--token", type=str, default=None,
        help="GitHub PAT (defaults to GITHUB_TOKEN env var)",
    )
    args = parser.parse_args()

    # Resolve token: --token flag > COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN > local CLI auth
    github_token = (
        args.token
        or os.environ.get("COPILOT_GITHUB_TOKEN")
        or os.environ.get("GH_TOKEN")
        or os.environ.get("GITHUB_TOKEN")
    )

    ensure_dirs()

    if github_token:
        print(f"Using explicit token ({github_token[:8]}...)")
        client = CopilotClient({
            "github_token": github_token,
            "use_logged_in_user": False,
        })
    else:
        print("No token provided, falling back to local Copilot CLI auth...")
        client = CopilotClient()
    await client.start()

    try:
        print("Fetching sessions...")
        sessions = await fetch_sessions(client)

        total = len(sessions)
        limit = None if args.all else args.limit
        display = sessions[:limit] if limit else sessions
        print(f"Found {total} session(s), processing {len(display)}.")

        # ── Write sessions.json ──────────────────────────────
        sessions_path = os.path.join(DATA_DIR, "sessions.json")
        dump_json(sessions_path, display)
        print(f"[OK] Wrote {sessions_path} ({len(display)} sessions)")

        # ── Write individual session event files ─────────────
        if not args.list_only:
            for i, s in enumerate(display, 1):
                sid = s.get("sessionId", "unknown")
                print(f"  [{i}/{len(display)}] Fetching events for {sid}...")
                events = await fetch_session_events(client, sid)
                session_data = {
                    **s,
                    "events": events,
                }
                out_path = os.path.join(SESSIONS_DIR, f"{sid}.json")
                dump_json(out_path, session_data)
        print(f"    [OK] {len(events)} events -> {out_path}")

        print("\nDone!")

    finally:
        await client.stop()


if __name__ == "__main__":
    asyncio.run(main())
