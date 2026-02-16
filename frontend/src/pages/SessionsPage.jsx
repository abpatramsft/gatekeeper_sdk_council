import { useEffect, useState, useRef } from 'react'
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
  const [importMode, setImportMode] = useState('upload') // 'upload' or 'pat'
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const folderInputRef = useRef(null)
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
    setUploadProgress('')
  }

  /** Handle folder selection via webkitdirectory input */
  const handleFolderUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return

    setError('')
    setUploading(true)
    setUploadProgress('Reading files…')

    try {
      // Find sessions.json (metadata)
      const metadataFile = files.find(
        (f) => f.name === 'sessions.json' && !f.webkitRelativePath.includes('/sessions/')
      )
      if (!metadataFile) {
        throw new Error(
          'No sessions.json found in the selected folder. ' +
          'The folder should contain a sessions.json file and a sessions/ subfolder with individual session JSON files.'
        )
      }

      // Read sessions.json
      setUploadProgress('Parsing sessions.json…')
      const metadataText = await metadataFile.text()
      const sessionsMetadata = JSON.parse(metadataText)

      // Find individual session files (inside sessions/ subfolder)
      const sessionFiles = files.filter(
        (f) =>
          f.name.endsWith('.json') &&
          f.webkitRelativePath.includes('/sessions/') &&
          f.name !== 'sessions.json'
      )

      setUploadProgress(`Reading ${sessionFiles.length} session detail file(s)…`)

      // Read all session detail files in parallel
      const sessionData = {}
      await Promise.all(
        sessionFiles.map(async (file) => {
          const text = await file.text()
          try {
            const data = JSON.parse(text)
            const sessionId = data.sessionId || file.name.replace('.json', '')
            sessionData[sessionId] = data
          } catch {
            console.warn(`Skipping invalid JSON file: ${file.name}`)
          }
        })
      )

      setUploadProgress(`Uploading ${sessionsMetadata.length} session(s) to backend…`)

      // POST to backend
      const res = await fetch('/api/sessions/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessions: sessionsMetadata,
          session_data: sessionData,
        }),
      })

      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.detail || 'Upload failed')
      }

      const result = await res.json()

      // Reload sessions from backend
      const sessionsRes = await fetch('/api/sessions')
      if (!sessionsRes.ok) throw new Error('Failed to load sessions after upload')
      const data = await sessionsRes.json()
      setSessions(data)
      setShowTokenPrompt(false)
      setUploadProgress('')
    } catch (err) {
      setError(err.message)
      setUploadProgress('')
    } finally {
      setUploading(false)
      // Reset the file input so the same folder can be re-selected
      if (folderInputRef.current) folderInputRef.current.value = ''
    }
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

  // ── Import prompt view ────────────────────────────────────
  if (showTokenPrompt && sessions.length === 0) {
    return (
      <div className="sessions-page">
        <div className="landing">
          <div className="landing-card">
            <h2>📂 Import Copilot Sessions</h2>
            <p className="subtitle">
              Choose how to load your Copilot CLI sessions into the viewer.
            </p>

            {error && <div className="error-banner">{error}</div>}

            {/* Mode toggle */}
            <div style={{
              display: 'flex', gap: 0, marginBottom: 20, borderRadius: 8,
              overflow: 'hidden', border: '1px solid var(--border)'
            }}>
              <button
                onClick={() => setImportMode('upload')}
                style={{
                  flex: 1, padding: '10px 16px', cursor: 'pointer', fontSize: 14,
                  fontWeight: importMode === 'upload' ? 600 : 400,
                  background: importMode === 'upload' ? 'var(--accent)' : 'var(--card)',
                  color: importMode === 'upload' ? '#fff' : 'var(--text-muted)',
                  border: 'none', transition: 'all 0.15s',
                }}
              >
                📁 Upload Folder
              </button>
              <button
                onClick={() => setImportMode('pat')}
                style={{
                  flex: 1, padding: '10px 16px', cursor: 'pointer', fontSize: 14,
                  fontWeight: importMode === 'pat' ? 600 : 400,
                  background: importMode === 'pat' ? 'var(--accent)' : 'var(--card)',
                  color: importMode === 'pat' ? '#fff' : 'var(--text-muted)',
                  border: 'none', borderLeft: '1px solid var(--border)', transition: 'all 0.15s',
                }}
              >
                🔑 GitHub PAT
              </button>
            </div>

            {/* ── Upload Folder mode ──────────────────────── */}
            {importMode === 'upload' && (
              <div>
                <p className="subtitle" style={{ marginBottom: 16 }}>
                  Select a folder containing exported Copilot session data.
                  The folder should have a <code>sessions.json</code> metadata file and a{' '}
                  <code>sessions/</code> subfolder with individual session JSON files.
                </p>

                <div
                  style={{
                    border: '2px dashed var(--border)', borderRadius: 12,
                    padding: '32px 24px', textAlign: 'center', cursor: 'pointer',
                    background: 'rgba(99, 102, 241, 0.04)', transition: 'border-color 0.2s',
                  }}
                  onClick={() => folderInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
                  <p style={{ color: 'var(--text)', fontWeight: 500, marginBottom: 4 }}>
                    Click to select session folder
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    Folder must contain sessions.json + sessions/*.json
                  </p>
                  <input
                    ref={folderInputRef}
                    type="file"
                    /* @ts-ignore */
                    webkitdirectory=""
                    directory=""
                    multiple
                    onChange={handleFolderUpload}
                    style={{ display: 'none' }}
                  />
                </div>

                {uploading && (
                  <p className="subtitle" style={{ marginTop: 12 }}>
                    ⏳ {uploadProgress || 'Processing…'}
                  </p>
                )}

                <div style={{
                  marginTop: 20, padding: 14, borderRadius: 8,
                  background: 'rgba(99, 102, 241, 0.06)', fontSize: 13,
                  color: 'var(--text-muted)', lineHeight: 1.6
                }}>
                  <strong style={{ color: 'var(--text)' }}>Expected folder structure:</strong>
                  <pre style={{
                    margin: '8px 0 0', padding: 10, borderRadius: 6,
                    background: 'var(--bg)', fontSize: 12, overflow: 'auto',
                    color: 'var(--text-muted)'
                  }}>{`your-folder/
├── sessions.json          ← metadata (array of session summaries)
└── sessions/
    ├── <session-id-1>.json  ← full session with events
    ├── <session-id-2>.json
    └── ...`}</pre>
                </div>
              </div>
            )}

            {/* ── PAT mode ────────────────────────────────── */}
            {importMode === 'pat' && (
              <form onSubmit={handleFetchSessions}>
                <p className="subtitle" style={{ marginBottom: 16 }}>
                  Enter your GitHub Personal Access Token to fetch Copilot CLI sessions
                  on the fly. The token is used once to fetch sessions and is never stored.
                </p>
                <p className="subtitle" style={{ marginBottom: 16, color: 'var(--yellow, #f59e0b)' }}>
                  ⚠️ Note: PAT-based fetching only works when running locally (not in Docker/remote).
                </p>

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
            )}
          </div>
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
