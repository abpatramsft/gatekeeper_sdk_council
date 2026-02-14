import { useEffect, useState } from 'react'
import { useParams, Navigate, Link, useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const STEP_LABELS = {
  'step1-requirement-drift':   '📋 Requirement Drift',
  'step2-technical-excellence': '🏗️ Technical Excellence',
  'step3-unit-test-coverage':   '🧪 Unit Test Coverage',
  'step4-production-readiness': '🎯 Production Readiness',
}

const STAGE_LABELS = {
  stage1: '🤖 Stage 1 — Individual Model Responses',
  stage2: '⚖️  Stage 2 — Peer Rankings',
  stage3: '📝 Stage 3 — Chairman\u2019s Final Answer',
}

const NO_DATA_CONCLUSIONS = ['skipped', 'cancelled']

export default function RunDetailPage({ connection }) {
  const { runId } = useParams()
  const location = useLocation()
  const runConclusion = location.state?.conclusion
  const runTitle = location.state?.display_title
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeStep, setActiveStep] = useState(null)

  const isNoData = NO_DATA_CONCLUSIONS.includes(runConclusion)

  useEffect(() => {
    if (!connection) return
    if (isNoData) { setLoading(false); return }
    const params = new URLSearchParams({
      owner: connection.owner,
      repo: connection.repo,
      token: connection.token,
    })
    fetch(`/api/runs/${runId}/artifact?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json()
          throw new Error(typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail))
        }
        return r.json()
      })
      .then((d) => {
        setData(d)
        const steps = Object.keys(d.steps || {})
        if (steps.length) setActiveStep(steps[steps.length - 1])
      })
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
      <Link to="/runs" className="back-link">← Back to runs</Link>
      <div className="error-banner">{error}</div>
    </div>
  )
  if (!data) return null

  const stepKeys = Object.keys(data.steps || {})
  const currentStep = data.steps?.[activeStep]
  const council = currentStep?.council_results

  return (
    <div className="detail-page">
      <Link to="/runs" className="back-link">← Back to runs</Link>

      <div className="detail-header">
        <h2>Run #{runId}</h2>
      </div>

      <div className="detail-meta">
        <span>Generated: {new Date(data.generated_at).toLocaleString()}</span>
      </div>

      {data.frd_input && (
        <div className="frd-box">
          <h3>Feature Requirement Document Input</h3>
          <p>{data.frd_input}</p>
        </div>
      )}

      {/* step tabs */}
      <div className="step-tabs">
        {stepKeys.map((key) => (
          <button
            key={key}
            className={`step-tab ${activeStep === key ? 'active' : ''}`}
            onClick={() => setActiveStep(key)}
          >
            {STEP_LABELS[key] || data.steps[key]?.title || key}
          </button>
        ))}
      </div>

      {/* step content */}
      {council ? (
        <CouncilPanel council={council} />
      ) : (
        <div className="step-panel" style={{ padding: 20 }}>
          <p style={{ color: 'var(--text-muted)' }}>No council results for this step.</p>
        </div>
      )}
    </div>
  )
}


/* ── Council Panel ──────────────────────────────────────────── */

function CouncilPanel({ council }) {
  const [openStage, setOpenStage] = useState('stage3')

  const models = council.models || {}

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
          Chairman model: <strong>{council.stage3?.chairman_model}</strong>
        </p>
        <MarkdownBlock text={council.stage3?.final_answer} />
      </StageSection>

      {/* aggregate rankings */}
      {council.aggregate_rankings?.length > 0 && (
        <StageSection
          label="📊 Aggregate Peer Rankings"
          isOpen={openStage === 'rankings'}
          onToggle={() => setOpenStage(openStage === 'rankings' ? null : 'rankings')}
        >
          <div className="rankings">
            {council.aggregate_rankings.map((r, i) => (
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
        <ModelTabs models={council.stage1} />
      </StageSection>

      {/* stage 2 */}
      <StageSection
        label={STAGE_LABELS.stage2}
        isOpen={openStage === 'stage2'}
        onToggle={() => setOpenStage(openStage === 'stage2' ? null : 'stage2')}
      >
        <ModelTabs models={council.stage2} />
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
