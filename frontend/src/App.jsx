import { Routes, Route, useNavigate, useLocation, Link } from 'react-router-dom'
import { useState, useCallback } from 'react'
import LandingPage from './pages/LandingPage'
import RunsPage from './pages/RunsPage'
import RunDetailPage from './pages/RunDetailPage'
import FRDRunDetailPage from './pages/FRDRunDetailPage'
import SessionsPage from './pages/SessionsPage'
import SessionDetailPage from './pages/SessionDetailPage'
import AgenticAnalysisPage from './pages/AgenticAnalysisPage'

export default function App() {
  const [connection, setConnection] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()

  const handleConnect = useCallback((conn) => {
    setConnection(conn)
    navigate('/runs')
  }, [navigate])

  const handleDisconnect = useCallback(() => {
    setConnection(null)
    navigate('/')
  }, [navigate])

  const isSessionsArea = location.pathname.startsWith('/sessions')
  const isAgenticArea = location.pathname.startsWith('/agentic')

  return (
    <>
      <header className="app-header">
        <div className="inner">
          <span className="logo">🛡️</span>
          <h1>Gatekeeper Viewer</h1>

          {/* top-level navigation tabs */}
          <nav className="header-nav">
            <Link
              to={connection ? '/runs' : '/'}
              className={`header-tab ${!isSessionsArea && !isAgenticArea ? 'active' : ''}`}
            >
              Gatekeeper
            </Link>
            <Link
              to="/sessions"
              className={`header-tab ${isSessionsArea ? 'active' : ''}`}
            >
              Copilot Sessions
            </Link>
            <Link
              to="/agentic"
              className={`header-tab ${isAgenticArea ? 'active' : ''}`}
            >
              Agentic Analysis
            </Link>
          </nav>

          {connection && (
            <>
              <span className="repo-badge">{connection.full_name}</span>
              <button
                onClick={handleDisconnect}
                style={{
                  background: 'none', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', padding: '4px 12px',
                  borderRadius: 6, cursor: 'pointer', fontSize: 12
                }}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route
            path="/"
            element={<LandingPage onConnect={handleConnect} />}
          />
          <Route
            path="/runs"
            element={<RunsPage connection={connection} />}
          />
          <Route
            path="/runs/:runId"
            element={<RunDetailPage connection={connection} />}
          />
          <Route
            path="/frd/runs/:runId"
            element={<FRDRunDetailPage connection={connection} />}
          />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          <Route path="/agentic" element={<AgenticAnalysisPage connection={connection} />} />
        </Routes>
      </main>
    </>
  )
}
