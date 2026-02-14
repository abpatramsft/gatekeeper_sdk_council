import { useEffect, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function truncate(text, max = 80) {
  if (!text) return ''
  const clean = text.replace(/\n/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

/**
 * Extract chairman final output from a workflow artifact.
 * Gatekeeper format: steps -> {stepName} -> council_results -> stage3 -> final_answer
 * FRD format: stage3 -> final_answer
 */
function extractChairmanOutputs(artifact) {
  const outputs = []

  // Gatekeeper multi-step format
  if (artifact?.steps) {
    for (const [stepKey, stepData] of Object.entries(artifact.steps)) {
      const title = stepData?.title || stepKey
      const finalAnswer = stepData?.council_results?.stage3?.final_answer
      if (finalAnswer) {
        outputs.push({ stage: title, content: finalAnswer })
      }
    }
  }

  // FRD single-step format (stage3 at top level)
  if (artifact?.stage3?.final_answer) {
    outputs.push({ stage: 'Feature Requirement Analysis', content: artifact.stage3.final_answer })
  }

  return outputs
}

export default function AgenticAnalysisPage({ connection }) {
  // ── Context sources ──
  const [sessions, setSessions] = useState([])
  const [workflowRuns, setWorkflowRuns] = useState([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [sourcesLoaded, setSourcesLoaded] = useState(false)

  // ── Selections ──
  const [selectedWorkflows, setSelectedWorkflows] = useState([])
  const [selectedSessions, setSelectedSessions] = useState([])

  // ── Context building ──
  const [builtContext, setBuiltContext] = useState('')
  const [buildingContext, setBuildingContext] = useState(false)
  const [contextReady, setContextReady] = useState(false)
  const [contextStats, setContextStats] = useState(null)

  // ── Chat ──
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState([])
  const [querying, setQuerying] = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Load available sources ──
  const loadSources = async () => {
    setLoadingSources(true)
    try {
      // Fetch sessions (always available)
      const sessionsRes = await fetch('/api/sessions')
      if (sessionsRes.ok) {
        const data = await sessionsRes.json()
        setSessions(data)
      }

      // Fetch workflow runs if connected to GitHub
      if (connection) {
        const params = new URLSearchParams({
          owner: connection.owner,
          repo: connection.repo,
          token: connection.token,
        })

        const [gkRes, frdRes] = await Promise.all([
          fetch(`/api/runs?${params}`).then(r => r.ok ? r.json() : []).catch(() => []),
          fetch(`/api/frd/runs?${params}`).then(r => r.ok ? r.json() : []).catch(() => []),
        ])

        const merged = [
          ...gkRes.map(r => ({ ...r, _workflow: 'gatekeeper' })),
          ...frdRes.map(r => ({ ...r, _workflow: 'frd' })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        setWorkflowRuns(merged)
      }

      setSourcesLoaded(true)
    } catch (e) {
      console.error('Failed to load sources:', e)
    } finally {
      setLoadingSources(false)
    }
  }

  // ── Toggle selection ──
  const toggleWorkflow = (runId) => {
    setSelectedWorkflows(prev =>
      prev.includes(runId) ? prev.filter(id => id !== runId) : [...prev, runId]
    )
  }

  const toggleSession = (sessionId) => {
    setSelectedSessions(prev =>
      prev.includes(sessionId) ? prev.filter(id => id !== sessionId) : [...prev, sessionId]
    )
  }

  // ── Build context ──
  const buildContext = async () => {
    setBuildingContext(true)
    const parts = []
    let workflowCount = 0
    let sessionCount = 0

    try {
      // Fetch workflow artifacts and extract chairman outputs
      for (const runId of selectedWorkflows) {
        const run = workflowRuns.find(r => r.id === runId)
        if (!run || !connection) continue

        const params = new URLSearchParams({
          owner: connection.owner,
          repo: connection.repo,
          token: connection.token,
        })

        const endpoint = run._workflow === 'frd'
          ? `/api/frd/runs/${runId}/artifact?${params}`
          : `/api/runs/${runId}/artifact?${params}`

        try {
          const res = await fetch(endpoint)
          if (!res.ok) continue
          const artifact = await res.json()
          const outputs = extractChairmanOutputs(artifact)

          if (outputs.length > 0) {
            const wfLabel = run._workflow === 'frd' ? 'FRD' : 'Gatekeeper'
            parts.push(`\n${'='.repeat(60)}`)
            parts.push(`WORKFLOW: ${wfLabel} - ${run.display_title} (Run #${run.run_number})`)
            parts.push(`${'='.repeat(60)}`)

            for (const output of outputs) {
              parts.push(`\n--- Stage: ${output.stage} ---`)
              parts.push(output.content)
            }
            workflowCount++
          }
        } catch (e) {
          console.error(`Failed to fetch artifact for run ${runId}:`, e)
        }
      }

      // Fetch session data
      for (const sessionId of selectedSessions) {
        try {
          const res = await fetch(`/api/sessions/${sessionId}`)
          if (!res.ok) continue
          const sessionData = await res.json()
          const session = sessions.find(s => s.sessionId === sessionId)
          const label = session?.summary || sessionId

          parts.push(`\n${'='.repeat(60)}`)
          parts.push(`COPILOT SESSION: ${truncate(label, 100)}`)
          parts.push(`Session ID: ${sessionId}`)
          parts.push(`${'='.repeat(60)}`)
          parts.push(JSON.stringify(sessionData, null, 2))
          sessionCount++
        } catch (e) {
          console.error(`Failed to fetch session ${sessionId}:`, e)
        }
      }

      const fullContext = parts.join('\n')
      setBuiltContext(fullContext)
      setContextReady(fullContext.length > 0)
      setContextStats({
        workflows: workflowCount,
        sessions: sessionCount,
        chars: fullContext.length,
      })
    } catch (e) {
      console.error('Failed to build context:', e)
    } finally {
      setBuildingContext(false)
    }
  }

  // ── Send query ──
  const sendQuery = async () => {
    if (!query.trim() || !contextReady) return
    const q = query.trim()
    setQuery('')
    setMessages(prev => [...prev, { role: 'user', text: q }])
    setQuerying(true)

    try {
      const res = await fetch('/api/agent/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: builtContext, query: q }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
        setMessages(prev => [...prev, { role: 'error', text: err.detail || 'Request failed' }])
      } else {
        const data = await res.json()
        setMessages(prev => [...prev, { role: 'assistant', text: data.response }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'error', text: `Network error: ${e.message}` }])
    } finally {
      setQuerying(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendQuery()
    }
  }

  // ── Reset ──
  const resetContext = () => {
    setBuiltContext('')
    setContextReady(false)
    setContextStats(null)
    setMessages([])
    setSelectedWorkflows([])
    setSelectedSessions([])
  }

  return (
    <div className="agentic-page">
      <h2>🤖 Agentic Analysis</h2>
      <p className="subtitle">
        Ground your AI agent on workflow results and copilot sessions, then ask questions.
      </p>

      {/* ── Step 1: Load sources ── */}
      {!sourcesLoaded && (
        <div className="agentic-step-card">
          <h3>Step 1: Load Available Data Sources</h3>
          <p className="step-desc">
            Load workflow runs and copilot sessions to select which data to provide as context.
          </p>
          <button
            className="btn-primary"
            style={{ maxWidth: 240 }}
            onClick={loadSources}
            disabled={loadingSources}
          >
            {loadingSources ? 'Loading…' : '📂 Load Context Sources'}
          </button>
        </div>
      )}

      {/* ── Step 2: Select context ── */}
      {sourcesLoaded && !contextReady && (
        <div className="agentic-step-card">
          <h3>Step 2: Select Context Data</h3>
          <p className="step-desc">
            Select which workflow runs and copilot sessions to include as context for the agent.
          </p>

          <div className="context-selectors">
            {/* Workflows */}
            <div className="selector-section">
              <h4>📋 Workflow Runs {workflowRuns.length > 0 && <span className="count-badge">{workflowRuns.length}</span>}</h4>
              {workflowRuns.length === 0 ? (
                <p className="empty-hint">
                  {connection ? 'No workflow runs found.' : 'Connect to a GitHub repo (via Gatekeeper tab) to load workflows.'}
                </p>
              ) : (
                <div className="selector-list">
                  {workflowRuns.map(run => {
                    const isSelected = selectedWorkflows.includes(run.id)
                    const wfLabel = run._workflow === 'frd' ? 'FRD' : 'GK'
                    return (
                      <label key={run.id} className={`selector-item ${isSelected ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleWorkflow(run.id)}
                        />
                        <span className={`wf-tag wf-${run._workflow}`}>{wfLabel}</span>
                        <span className="selector-title">{truncate(run.display_title, 50)}</span>
                        <span className="selector-meta">#{run.run_number}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Sessions */}
            <div className="selector-section">
              <h4>💬 Copilot Sessions {sessions.length > 0 && <span className="count-badge">{sessions.length}</span>}</h4>
              {sessions.length === 0 ? (
                <p className="empty-hint">No sessions found.</p>
              ) : (
                <div className="selector-list">
                  {sessions.map(s => {
                    const isSelected = selectedSessions.includes(s.sessionId)
                    return (
                      <label key={s.sessionId} className={`selector-item ${isSelected ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSession(s.sessionId)}
                        />
                        <span className="selector-title">{truncate(s.summary || s.sessionId, 60)}</span>
                        <span className="selector-meta">{s.sessionId.slice(0, 8)}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="context-actions">
            <button
              className="btn-primary"
              style={{ maxWidth: 240 }}
              onClick={buildContext}
              disabled={buildingContext || (selectedWorkflows.length === 0 && selectedSessions.length === 0)}
            >
              {buildingContext ? 'Building Context…' : '🔧 Build Context'}
            </button>
            <span className="selection-summary">
              {selectedWorkflows.length} workflow(s), {selectedSessions.length} session(s) selected
            </span>
          </div>
        </div>
      )}

      {/* ── Context ready banner ── */}
      {contextReady && (
        <div className="context-banner">
          <div className="context-banner-info">
            <span className="context-check">✅</span>
            <div>
              <strong>Context Ready</strong>
              <span className="context-stats">
                {contextStats?.workflows} workflow(s), {contextStats?.sessions} session(s) •{' '}
                {(contextStats?.chars / 1024).toFixed(1)}KB
              </span>
            </div>
          </div>
          <button className="btn-small" onClick={resetContext}>Reset Context</button>
        </div>
      )}

      {/* ── Step 3: Chat ── */}
      {contextReady && (
        <div className="agentic-chat">
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Context loaded. Ask anything about your workflow results and copilot sessions!</p>
                <div className="chat-suggestions">
                  <button onClick={() => setQuery('Summarize the key findings from the loaded context')}>
                    Summarize key findings
                  </button>
                  <button onClick={() => setQuery('What are the main issues or gaps identified?')}>
                    Identify issues & gaps
                  </button>
                  <button onClick={() => setQuery('What recommendations were made and what are the priorities?')}>
                    List recommendations
                  </button>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                <div className="chat-msg-avatar">
                  {msg.role === 'user' ? '👤' : msg.role === 'error' ? '⚠️' : '🤖'}
                </div>
                <div className="chat-msg-content">
                  {msg.role === 'assistant' ? (
                    <div className="md-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <p>{msg.text}</p>
                  )}
                </div>
              </div>
            ))}

            {querying && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-avatar">🤖</div>
                <div className="chat-msg-content">
                  <div className="typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="chat-input-bar">
            <textarea
              className="chat-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your data…"
              rows={1}
              disabled={querying}
            />
            <button
              className="chat-send-btn"
              onClick={sendQuery}
              disabled={querying || !query.trim()}
              title="Send"
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
