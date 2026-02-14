import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 0) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function truncate(text, max = 80) {
  if (!text) return ''
  const clean = text.replace(/\n/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [token, setToken] = useState('')
  const [showTokenPrompt, setShowTokenPrompt] = useState(true)
  const [limit, setLimit] = useState(50)
  const navigate = useNavigate()

  // Try loading existing sessions on mount (in case backend has them in memory already)
  useEffect(() => {
    fetch('/api/sessions')
      .then(async (r) => {
        if (!r.ok) return []
        return r.json()
      })
      .then((data) => {
        if (data && data.length > 0) {
          setSessions(data)
          setShowTokenPrompt(false)
        }
      })
      .catch(() => {})
  }, [])

  const handleFetchSessions = async (e) => {
    e.preventDefault()
    if (!token.trim()) {
      setError('Please enter a GitHub PAT')
      return
    }
    setError('')
    setFetching(true)

    try {
      // Step 1: Trigger fetch with the PAT
      const fetchRes = await fetch('/api/sessions/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), limit }),
      })
      if (!fetchRes.ok) {
        const d = await fetchRes.json()
        throw new Error(d.detail || 'Failed to fetch sessions from Copilot')
      }

      // Step 2: Load sessions from the backend
      const sessionsRes = await fetch('/api/sessions')
      if (!sessionsRes.ok) {
        throw new Error('Failed to load sessions after fetch')
      }
      const data = await sessionsRes.json()
      setSessions(data)
      setShowTokenPrompt(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setFetching(false)
    }
  }

  const handleRefresh = () => {
    setShowTokenPrompt(true)
    setError('')
  }

  const filtered = sessions.filter((s) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      (s.sessionId || '').toLowerCase().includes(q) ||
      (s.summary || '').toLowerCase().includes(q) ||
      (s.context?.repository || '').toLowerCase().includes(q) ||
      (s.context?.branch || '').toLowerCase().includes(q)
    )
  })

  // ── PAT prompt view ──────────────────────────────────────
  if (showTokenPrompt && sessions.length === 0) {
    return (
      <div className="sessions-page">
        <div className="landing">
          <form className="landing-card" onSubmit={handleFetchSessions}>
            <h2>🔑 Connect to Copilot Sessions</h2>
            <p className="subtitle">
              Enter your GitHub Personal Access Token to fetch Copilot CLI sessions
              on the fly. The token is used once to fetch sessions and is never stored.
            </p>

            {error && <div className="error-banner">{error}</div>}

            <div className="form-group">
              <label htmlFor="pat-token">GitHub Personal Access Token</label>
              <input
                id="pat-token"
                type="password"
                placeholder="github_pat_xxxxxxxxxxxx or ghp_xxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
                autoFocus
              />
              <p className="hint">
                Supports fine-grained PATs (github_pat_*), classic PATs (ghp_*),
                and OAuth tokens (gho_*).
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="session-limit">Max sessions to fetch</label>
              <input
                id="session-limit"
                type="number"
                min="1"
                max="500"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 50)}
                style={{ width: 100 }}
              />
            </div>

            <button className="btn-primary" type="submit" disabled={fetching}>
              {fetching ? 'Fetching sessions…' : 'Fetch Copilot Sessions'}
            </button>

            {fetching && (
              <p className="subtitle" style={{ marginTop: 12 }}>
                ⏳ This may take a minute depending on the number of sessions…
              </p>
            )}
          </form>
        </div>
      </div>
    )
  }

  // ── Sessions list view ───────────────────────────────────
  return (
    <div className="sessions-page">
      <div className="sessions-header">
        <div>
          <h2>Copilot Sessions</h2>
          <p className="subtitle">
            {sessions.length} session(s) fetched
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="sessions-search"
            placeholder="Filter by ID, summary, repo, branch…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="btn-primary"
            onClick={handleRefresh}
            style={{ whiteSpace: 'nowrap', fontSize: 13, padding: '6px 14px' }}
            title="Re-fetch sessions with a new token"
          >
            🔄 Re-fetch
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="spinner">Loading sessions…</div>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>
          {sessions.length === 0
            ? 'No sessions found.'
            : 'No sessions match the filter.'}
        </p>
      ) : (
        <div className="sessions-list">
          {filtered.map((s) => {
            const sid = s.sessionId || '???'
            const ctx = s.context || {}
            return (
              <div
                key={sid}
                className="session-card"
                onClick={() => navigate(`/sessions/${sid}`)}
              >
                <div className="session-icon">💬</div>
                <div className="session-info">
                  <div className="session-summary">
                    {truncate(s.summary || '(no summary)', 90)}
                  </div>
                  <div className="session-meta">
                    <span className="session-id" title={sid}>
                      {sid.slice(0, 8)}…
                    </span>
                    {s.startTime && (
                      <span title={formatTime(s.startTime)}>
                        {timeAgo(s.startTime)}
                      </span>
                    )}
                    {ctx.repository && <span>📁 {ctx.repository}</span>}
                    {ctx.branch && <span>🌿 {ctx.branch}</span>}
                    {s.isRemote && <span className="tag-remote">remote</span>}
                  </div>
                </div>
                <span className="session-arrow">›</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
