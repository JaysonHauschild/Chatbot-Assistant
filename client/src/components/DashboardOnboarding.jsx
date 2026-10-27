import UnsavedChangesIndicator from './UnsavedChangesIndicator.jsx'
import { useUnsavedChanges, useUnsavedForm } from '../hooks/useUnsavedForm.js'
import { useState } from 'react'

export default function DashboardOnboarding({ apiBaseUrl, buildApiUrl, token, username, onComplete, onSignOut, resetOnly = false }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const { confirmNavigation } = useUnsavedChanges()
  const dirty = Boolean(firstName || lastName || email || password || confirmation)
  const formRef = useUnsavedForm('account-setup', resetOnly ? 'Password change' : 'Account setup', dirty)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (password !== confirmation) {
      setError('Passwords do not match. Enter the same new password in both fields.')
      return
    }
    setStatus('saving')
    try {
      const response = await fetch(buildApiUrl(apiBaseUrl, '/api/auth/onboarding'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(resetOnly ? { password } : { firstName, lastName, email, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setStatus(response.status === 401 || response.status === 403 ? 'expired' : 'idle')
        setError(data.error || 'Unable to save your account. Please try again.')
        return
      }
      onComplete(data)
    } catch {
      setStatus('idle')
      setError('Unable to reach the server. Please try again. If setup already completed, return to login and use your new password.')
    }
  }

  const busy = status === 'saving'
  return (
    <main className="dashboard-shell">
      <section className="dashboard-card login-card" aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">{resetOnly ? 'Choose a new password' : 'Set up your account'}</h1>
        <p>{resetOnly ? `${username}, replace your temporary password to access the dashboard.` : `Welcome, ${username}. Enter your details and choose a new password to access the dashboard.`}</p>
        <form ref={formRef} className="dashboard-form" onSubmit={submit} aria-busy={busy}>
          <UnsavedChangesIndicator dirty={dirty} />
          {!resetOnly && <>
          <label htmlFor="onboardingFirstName">First name</label>
          <input id="onboardingFirstName" type="text" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={100} disabled={busy} />
          <label htmlFor="onboardingLastName">Last name</label>
          <input id="onboardingLastName" type="text" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={100} disabled={busy} />
          <label htmlFor="onboardingEmail">Email</label>
          <input id="onboardingEmail" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} aria-describedby="onboardingEmailHelp" disabled={busy} />
          <p id="onboardingEmailHelp" className="dashboard-blocked-description">Use your work email. We will email you if the chatbot needs attention.</p>
          </>}
          <label htmlFor="onboardingPassword">New password</label>
          <input id="onboardingPassword" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={1024} aria-describedby="onboardingPasswordHelp" disabled={busy} />
          <p id="onboardingPasswordHelp" className="dashboard-blocked-description">Use at least 12 characters and choose a password different from your temporary password.</p>
          <label htmlFor="onboardingConfirmation">Confirm new password</label>
          <input id="onboardingConfirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={12} maxLength={1024} disabled={busy} />
          {error && <p className="dashboard-message error" role="alert">{error}</p>}
          <div className="dashboard-actions">
            <button type="submit" disabled={busy || status === 'expired'}>{busy ? 'Saving account...' : resetOnly ? 'Save new password' : 'Complete account setup'}</button>
            <button type="button" onClick={() => { if (confirmNavigation(null)) onSignOut() }} disabled={busy}>Return to login</button>
          </div>
        </form>
      </section>
    </main>
  )
}
