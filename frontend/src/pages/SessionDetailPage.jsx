import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

/* ── helpers ──────────────────────────────────────────────── */

function formatTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function shortTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

function truncate(text, max = 120) {
  if (!text) return ''
  const clean = text.replace(/\n/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/* ── event type config ────────────────────────────────────── */

const EVENT_CONFIG = {
  'session.start':              { icon: '🚀', label: 'Session Start',     color: 'var(--green)' },
  'session.resume':             { icon: '▶️',  label: 'Session Resume',    color: 'var(--accent)' },
  'user.message':               { icon: '👤', label: 'User Message',      color: 'var(--accent)' },
  'assistant.message':          { icon: '🤖', label: 'Assistant Message', color: 'var(--purple)' },
  'tool.execution_start':       { icon: '🔧', label: 'Tool Start',       color: 'var(--yellow)' },
  'tool.execution_complete':    { icon: '✅', label: 'Tool Done',         color: 'var(--green)' },
  'assistant.turn_start':       { icon: '↩️',  label: 'Turn Start',       color: 'var(--text-muted)' },
  'assistant.turn_end':         { icon: '↪️',  label: 'Turn End',         color: 'var(--text-muted)' },
}

function getEventConfig(type) {
  return EVENT_CONFIG[type] || { icon: '📌', label: type, color: 'var(--text-muted)' }
}

/* ── event body renderers ─────────────────────────────────── */

function SessionStartBody({ data }) {
  const ctx = data.context || {}
  return (
    <div className="event-detail-grid">
      {data.copilotVersion && <DetailRow label="Copilot Version" value={`v${data.copilotVersion}`} />}
      {ctx.cwd && <DetailRow label="Working Dir" value={ctx.cwd} />}
      {ctx.gitRoot && <DetailRow label="Git Root" value={ctx.gitRoot} />}
      {ctx.repository && <DetailRow label="Repository" value={ctx.repository} />}
      {ctx.branch && <DetailRow label="Branch" value={ctx.branch} />}
    </div>
  )
}

function UserMessageBody({ data }) {
  return (
    <div className="event-body-content">
      {data.agentMode && (
        <span className="event-tag">agent: {data.agentMode}</span>
      )}
      <pre className="event-text-block">{data.content || '(empty)'}</pre>
    </div>
  )
}

function AssistantMessageBody({ data }) {
  const toolReqs = data.toolRequests || []
  return (
    <div className="event-body-content">
      {data.content && (
        <pre className="event-text-block">{data.content}</pre>
      )}
      {toolReqs.length > 0 && (
        <div className="tool-requests">
          <span className="event-label">Tools requested:</span>
          <div className="tool-tags">
            {toolReqs.map((tr, i) => (
              <span key={i} className="event-tag">{tr.name || '?'}</span>
            ))}
          </div>
        </div>
      )}
      {!data.content && toolReqs.length === 0 && (
        <span className="text-muted">(empty message)</span>
      )}
    </div>
  )
}

function ToolStartBody({ data }) {
  return (
    <div className="event-body-content">
      <DetailRow label="Tool" value={data.toolName || '?'} />
      {data.arguments && Object.keys(data.arguments).length > 0 && (
        <div className="event-args">
          <span className="event-label">Arguments:</span>
          <pre className="event-json">{JSON.stringify(data.arguments, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function ToolCompleteBody({ data }) {
  const success = data.success
  return (
    <div className="event-body-content">
      <DetailRow
        label="Status"
        value={
          <span style={{ color: success ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
            {success ? 'SUCCESS' : 'FAILED'}
          </span>
        }
      />
      {data.result && (
        <div className="event-args">
          <span className="event-label">Result:</span>
          <pre className="event-json">
            {typeof data.result === 'string'
              ? data.result
              : JSON.stringify(data.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function GenericEventBody({ data }) {
  if (!data || Object.keys(data).length === 0) return null
  return (
    <div className="event-body-content">
      <pre className="event-json">{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  )
}

/* ── single event component ───────────────────────────────── */

function EventItem({ event, index }) {
  const [open, setOpen] = useState(false)
  const type = event.type || ''
  const data = event.data || {}
  const config = getEventConfig(type)
  const ts = shortTime(event.timestamp)

  // Auto-expand user messages
  const isUserMsg = type === 'user.message'

  function renderBody() {
    switch (type) {
      case 'session.start':           return <SessionStartBody data={data} />
      case 'session.resume':          return <GenericEventBody data={data} />
      case 'user.message':            return <UserMessageBody data={data} />
      case 'assistant.message':       return <AssistantMessageBody data={data} />
      case 'tool.execution_start':    return <ToolStartBody data={data} />
      case 'tool.execution_complete': return <ToolCompleteBody data={data} />
      default:                        return <GenericEventBody data={data} />
    }
  }

  const preview = type === 'user.message'
    ? truncate(data.content, 80)
    : type === 'assistant.message'
    ? (data.content ? truncate(data.content, 80) : `(${(data.toolRequests || []).length} tool calls)`)
    : type === 'tool.execution_start'
    ? data.toolName || ''
    : type === 'tool.execution_complete'
    ? (data.success ? 'OK' : 'FAILED')
    : ''

  const isOpen = open || (isUserMsg && open !== false)
  const actualOpen = open !== undefined ? open : isUserMsg

  return (
    <div className={`event-item ${actualOpen ? 'expanded' : ''}`}>
      <button
        className="event-header"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="event-index">#{index + 1}</span>
        <span className="event-icon">{config.icon}</span>
        <span className="event-type" style={{ color: config.color }}>
          {config.label}
        </span>
        {preview && (
          <span className="event-preview">{preview}</span>
        )}
        <span className="event-time">{ts}</span>
        <span className={`chevron ${actualOpen ? 'open' : ''}`}>▶</span>
      </button>
      {actualOpen && (
        <div className="event-body">
          {renderBody()}
        </div>
      )}
    </div>
  )
}

/* ── main page ────────────────────────────────────────────── */

export default function SessionDetailPage() {
  const { sessionId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandAll, setExpandAll] = useState(false)
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json()
          throw new Error(d.detail || 'Failed to fetch session')
        }
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading)
    return <div className="spinner" style={{ padding: '100px 0' }}>Loading session…</div>

  if (error)
    return (
      <div className="detail-page">
        <Link to="/sessions" className="back-link">← Back to sessions</Link>
        <div className="error-banner">{error}</div>
      </div>
    )

  if (!data) return null

  const events = data.events || []
  const ctx = data.context || {}

  // Unique event types for filter
  const eventTypes = [...new Set(events.map((e) => e.type || 'unknown'))]

  const filteredEvents =
    typeFilter === 'all'
      ? events
      : events.filter((e) => e.type === typeFilter)

  // Count by type
  const typeCounts = {}
  events.forEach((e) => {
    const t = e.type || 'unknown'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  })

  return (
    <div className="detail-page session-detail">
      <Link to="/sessions" className="back-link">← Back to sessions</Link>

      {/* session metadata */}
      <div className="session-detail-header">
        <h2>Session Details</h2>
        <span className="session-id-full">{data.sessionId}</span>
      </div>

      <div className="session-meta-grid">
        {data.startTime && <MetaItem label="Started" value={formatTime(data.startTime)} />}
        {data.modifiedTime && <MetaItem label="Last Modified" value={formatTime(data.modifiedTime)} />}
        {ctx.cwd && <MetaItem label="Working Dir" value={ctx.cwd} />}
        {ctx.repository && <MetaItem label="Repository" value={ctx.repository} />}
        {ctx.branch && <MetaItem label="Branch" value={ctx.branch} />}
        {ctx.gitRoot && <MetaItem label="Git Root" value={ctx.gitRoot} />}
        {data.isRemote !== undefined && <MetaItem label="Remote" value={data.isRemote ? 'Yes' : 'No'} />}
      </div>

      {data.summary && (
        <div className="session-summary-box">
          <h3>Summary</h3>
          <p>{data.summary}</p>
        </div>
      )}

      {/* event stats & controls */}
      <div className="events-toolbar">
        <div className="events-stats">
          <span className="events-total">{events.length} events</span>
          {Object.entries(typeCounts).map(([t, c]) => (
            <span key={t} className="type-count" style={{ color: getEventConfig(t).color }}>
              {getEventConfig(t).icon} {c}
            </span>
          ))}
        </div>
        <div className="events-controls">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="event-filter-select"
          >
            <option value="all">All types</option>
            {eventTypes.map((t) => (
              <option key={t} value={t}>
                {getEventConfig(t).label} ({typeCounts[t]})
              </option>
            ))}
          </select>
          <button
            className="btn-small"
            onClick={() => setExpandAll((v) => !v)}
          >
            {expandAll ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      </div>

      {/* event timeline */}
      <div className="events-timeline">
        {filteredEvents.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>
            No events to display.
          </p>
        ) : (
          filteredEvents.map((event, i) => (
            <EventItemControlled
              key={i}
              event={event}
              index={events.indexOf(event)}
              forceOpen={expandAll}
            />
          ))
        )}
      </div>
    </div>
  )
}

/* Wrapper that respects expandAll */
function EventItemControlled({ event, index, forceOpen }) {
  const [userToggled, setUserToggled] = useState(null) // null = not overridden
  const type = event.type || ''
  const data = event.data || {}
  const config = getEventConfig(type)
  const ts = shortTime(event.timestamp)

  const isOpen = forceOpen || (userToggled !== null ? userToggled : false)

  const preview = type === 'user.message'
    ? truncate(data.content, 80)
    : type === 'assistant.message'
    ? (data.content ? truncate(data.content, 80) : `(${(data.toolRequests || []).length} tool calls)`)
    : type === 'tool.execution_start'
    ? data.toolName || ''
    : type === 'tool.execution_complete'
    ? (data.success ? 'OK' : 'FAILED')
    : ''

  function renderBody() {
    switch (type) {
      case 'session.start':           return <SessionStartBody data={data} />
      case 'session.resume':          return <GenericEventBody data={data} />
      case 'user.message':            return <UserMessageBody data={data} />
      case 'assistant.message':       return <AssistantMessageBody data={data} />
      case 'tool.execution_start':    return <ToolStartBody data={data} />
      case 'tool.execution_complete': return <ToolCompleteBody data={data} />
      default:                        return <GenericEventBody data={data} />
    }
  }

  return (
    <div className={`event-item ${isOpen ? 'expanded' : ''}`}>
      <button
        className="event-header"
        onClick={() => setUserToggled((prev) => (prev === null ? !forceOpen : !prev))}
      >
        <span className="event-index">#{index + 1}</span>
        <span className="event-icon">{config.icon}</span>
        <span className="event-type" style={{ color: config.color }}>
          {config.label}
        </span>
        {preview && (
          <span className="event-preview">{preview}</span>
        )}
        <span className="event-time">{ts}</span>
        <span className={`chevron ${isOpen ? 'open' : ''}`}>▶</span>
      </button>
      {isOpen && (
        <div className="event-body">
          {renderBody()}
        </div>
      )}
    </div>
  )
}

function MetaItem({ label, value }) {
  return (
    <div className="meta-item">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  )
}
