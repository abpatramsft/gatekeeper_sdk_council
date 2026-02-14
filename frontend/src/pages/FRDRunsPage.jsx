import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function duration(start, end) {
  const ms = new Date(end) - new Date(start)
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m ${s}s`
}

export default function FRDRunsPage({ connection }) {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!connection) return
    const params = new URLSearchParams({
      owner: connection.owner,
      repo: connection.repo,
      token: connection.token,
    })
    fetch(`/api/frd/runs?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json()
          throw new Error(d.detail || 'Failed to fetch FRD runs')
        }
        return r.json()
      })
      .then(setRuns)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [connection])

  if (!connection) return <Navigate to="/" replace />

  return (
    <div className="runs-page">
      <h2>Feature Requirement Analysis Runs</h2>
      <p className="subtitle">
        Showing the last 10 completed runs for <strong>{connection.full_name}</strong>
      </p>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="spinner">Loading workflow runs…</div>
      ) : runs.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>
          No completed Feature Requirement Analysis runs found.
        </p>
      ) : (
        runs.map((run) => {
          const isNoData = run.conclusion === 'skipped' || run.conclusion === 'cancelled'
          return (
          <div
            key={run.id}
            className={`run-card ${isNoData ? 'run-card--no-data' : ''}`}
            onClick={() => navigate(`/frd/runs/${run.id}`, { state: { conclusion: run.conclusion, display_title: run.display_title } })}
          >
            <div className={`run-status ${run.conclusion || 'cancelled'}`} />
            <div className="run-info">
              <div className="run-title">{run.display_title}</div>
              <div className="run-meta">
                <span>{run.conclusion}</span>
                <span title={run.created_at}>{timeAgo(run.created_at)}</span>
                <span>{duration(run.created_at, run.updated_at)}</span>
                <span>sha: {run.head_sha}</span>
                <span>by {run.actor}</span>
              </div>
            </div>
            <span className="run-number">#{run.run_number}</span>
            <span className="run-arrow">›</span>
          </div>
          )
        })
      )}
    </div>
  )
}
