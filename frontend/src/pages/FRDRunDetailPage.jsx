import { useEffect, useState } from 'react'
import { useParams, Navigate, Link, useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const STAGE_LABELS = {
  stage1: '🤖 Stage 1 — Individual Model Responses',
  stage2: '⚖️  Stage 2 — Peer Rankings',
  stage3: '📝 Stage 3 — Chairman\u2019s Final Answer',
}

const NO_DATA_CONCLUSIONS = ['skipped', 'cancelled']

export default function FRDRunDetailPage({ connection }) {
  const { runId } = useParams()
  const location = useLocation()
  const runConclusion = location.state?.conclusion
  const runTitle = location.state?.display_title
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isNoData = NO_DATA_CONCLUSIONS.includes(runConclusion)

  useEffect(() => {
    if (!connection) return
    if (isNoData) { setLoading(false); return }
    const params = new URLSearchParams({
      owner: connection.owner,
      repo: connection.repo,
      token: connection.token,
    })
    fetch(`/api/frd/runs/${runId}/artifact?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json()
          throw new Error(typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail))
        }
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [connection, runId])

  if (!connection) return <Navigate to="/" replace />

  if (loading) return <div className="spinner" style={{ padding: '100px 0' }}>Loading artifact…</div>
  if (isNoData) return (
    <div className="detail-page">
      <Link to="/runs" className="back-link">← Back to runs</Link>
      <div className="no-data-banner">
        <div className="no-data-icon">🚫</div>
        <h3>No Data Available</h3>
        <p>This workflow run was <strong>{runConclusion}</strong>{runTitle ? ` (${runTitle})` : ''} and did not produce any artifacts.</p>
      </div>
    </div>
  )
  if (error) return (
    <div className="detail-page">
      <Link to="/frd/runs" className="back-link">← Back to FRD runs</Link>
      <div className="error-banner">{error}</div>
    </div>
  )
  if (!data) return null

  return (
    <div className="detail-page">
      <Link to="/frd/runs" className="back-link">← Back to FRD runs</Link>

      <div className="detail-header">
        <h2>Feature Requirement Analysis — Run #{runId}</h2>
      </div>

      {/* Query / prompt input */}
      {data.query && (
        <QueryBox query={data.query} />
      )}

      {/* Council results — flat structure */}
      <FRDCouncilPanel data={data} />
    </div>
  )
}


/* ── Query box ──────────────────────────────────────────────── */

function QueryBox({ query }) {
  const [expanded, setExpanded] = useState(false)

  // Truncate long queries
  const isLong = query.length > 400
  const displayText = expanded || !isLong ? query : query.slice(0, 400) + '…'

  return (
    <div className="frd-box">
      <h3>Analysis Prompt / Query</h3>
      <pre style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 13,
        lineHeight: 1.5,
        maxHeight: expanded ? 'none' : 200,
        overflow: 'hidden',
        color: 'var(--text)',
        background: 'var(--surface)',
        padding: 12,
        borderRadius: 6,
      }}>
        {displayText}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: 'none', border: 'none', color: 'var(--accent)',
            cursor: 'pointer', fontSize: 13, padding: '4px 0', marginTop: 4,
          }}
        >
          {expanded ? 'Show less' : 'Show full query'}
        </button>
      )}
    </div>
  )
}


/* ── FRD Council Panel (flat structure) ────────────────────── */

function FRDCouncilPanel({ data }) {
  const [openStage, setOpenStage] = useState('stage3')

  const models = data.models || {}

  return (
    <div className="step-panel">
      {/* meta bar */}
      <div className="council-meta">
        <span>Council:</span>
        {(models.council || []).map((m) => <span key={m} className="tag">{m}</span>)}
        <span style={{ marginLeft: 8 }}>Chairman:</span>
        <span className="tag">{models.chairman}</span>
      </div>

      {/* stage 3 first (most important) */}
      <StageSection
        label={STAGE_LABELS.stage3}
        isOpen={openStage === 'stage3'}
        onToggle={() => setOpenStage(openStage === 'stage3' ? null : 'stage3')}
      >
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
          Chairman model: <strong>{data.stage3?.chairman_model}</strong>
        </p>
        <MarkdownBlock text={data.stage3?.final_answer} />
      </StageSection>

      {/* aggregate rankings */}
      {data.aggregate_rankings?.length > 0 && (
        <StageSection
          label="📊 Aggregate Peer Rankings"
          isOpen={openStage === 'rankings'}
          onToggle={() => setOpenStage(openStage === 'rankings' ? null : 'rankings')}
        >
          <div className="rankings">
            {data.aggregate_rankings.map((r, i) => (
              <div key={r.model} className="rank-card">
                <div className="rank">#{i + 1}</div>
                <div className="model-name">{r.model}</div>
                <div className="avg">avg rank: {r.avg_rank} ({r.votes} votes)</div>
              </div>
            ))}
          </div>
        </StageSection>
      )}

      {/* stage 1 */}
      <StageSection
        label={STAGE_LABELS.stage1}
        isOpen={openStage === 'stage1'}
        onToggle={() => setOpenStage(openStage === 'stage1' ? null : 'stage1')}
      >
        <ModelTabs models={data.stage1} />
      </StageSection>

      {/* stage 2 */}
      <StageSection
        label={STAGE_LABELS.stage2}
        isOpen={openStage === 'stage2'}
        onToggle={() => setOpenStage(openStage === 'stage2' ? null : 'stage2')}
      >
        <ModelTabs models={data.stage2} />
      </StageSection>
    </div>
  )
}


/* ── reusable pieces ──────────────────────────────────────── */

function StageSection({ label, isOpen, onToggle, children }) {
  return (
    <div className="stage-section">
      <button className="stage-header" onClick={onToggle}>
        <span className={`chevron ${isOpen ? 'open' : ''}`}>▶</span>
        <span className="stage-label">{label}</span>
      </button>
      {isOpen && <div className="stage-body">{children}</div>}
    </div>
  )
}


function ModelTabs({ models }) {
  const keys = Object.keys(models || {})
  const [active, setActive] = useState(keys[0] || '')

  if (!keys.length) return <p style={{ color: 'var(--text-muted)' }}>No data.</p>

  return (
    <>
      <div className="model-tabs">
        {keys.map((k) => (
          <button
            key={k}
            className={`model-tab ${active === k ? 'active' : ''}`}
            onClick={() => setActive(k)}
          >
            {k}
          </button>
        ))}
      </div>
      <MarkdownBlock text={models[active]} />
    </>
  )
}


function MarkdownBlock({ text }) {
  if (!text) return <p style={{ color: 'var(--text-muted)' }}>No content available.</p>

  return (
    <div className="md-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
