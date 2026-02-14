import { useState } from 'react'

export default function LandingPage({ onConnect }) {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: url, token }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Connection failed')
      }
      const data = await res.json()
      onConnect({ ...data, token })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing">
      <form className="landing-card" onSubmit={handleSubmit}>
        <h2>Connect to Repository</h2>
        <p className="subtitle">
          Enter a GitHub repository URL and a personal access token to view
          Gatekeeper Analysis results.
        </p>

        {error && <div className="error-banner">{error}</div>}

        <div className="form-group">
          <label htmlFor="github-url">GitHub Repository URL</label>
          <input
            id="github-url"
            type="url"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <p className="hint">e.g. https://github.com/octocat/hello-world</p>
        </div>

        <div className="form-group">
          <label htmlFor="token">Personal Access Token</label>
          <input
            id="token"
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <p className="hint">
            Needs <code>actions:read</code> scope. Token is only used in-memory
            and never stored.
          </p>
        </div>

        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? 'Connecting...' : 'Initialize Repo for Analysis'}
        </button>
      </form>
    </div>
  )
}
