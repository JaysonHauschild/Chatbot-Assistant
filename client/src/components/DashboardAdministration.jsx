import UnsavedChangesIndicator from './UnsavedChangesIndicator.jsx'
import { useUnsavedForm } from '../hooks/useUnsavedForm.js'
import { useEffect, useRef, useState } from 'react'
import DashboardHelp from './DashboardHelp.jsx'
import DashboardSubtabs from './DashboardSubtabs.jsx'
import DashboardAuditLog from './DashboardAuditLog.jsx'
import './DashboardAdministration.css'

const roles = [['readonly', 'Read-only'], ['dashboard', 'Editor'], ['admin', 'Administrator']]
const roleLabel = (role) => roles.find(([value]) => value === role)?.[1] || role

export default function DashboardAdministration({ apiBaseUrl, buildApiUrl, authToken, onUnauthorized, activeTab, onSelectTab }) {
  const [users, setUsers] = useState([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('readonly')
  const [drafts, setDrafts] = useState({})
  const [created, setCreated] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState('')
  const [confirmReset, setConfirmReset] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState('')
  const [busy, setBusy] = useState(false)
  const [auditRevision, setAuditRevision] = useState(0)
  const pending = useRef(false)
  const createDirty = Boolean(username || role !== 'readonly')
  const rolesDirty = users.some((user) => drafts[user.id] && drafts[user.id] !== user.role)
  const createFormRef = useUnsavedForm('administration-users', 'New dashboard user', createDirty)
  const rolesFormRef = useUnsavedForm('administration-users', 'User role changes', rolesDirty)

  async function request(path = '', options = {}) {
    const response = await fetch(buildApiUrl(apiBaseUrl, `/api/dashboard/users${path}`), {
      ...options, headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    })
    if (response.status === 401) { onUnauthorized(); throw new Error('Your session expired. Please log in again.') }
    const data = response.status === 204 ? {} : await response.json()
    if (!response.ok) throw new Error(data.error || 'Unable to manage dashboard users.')
    return data
  }

  useEffect(() => {
    const controller = new AbortController()
    fetch(buildApiUrl(apiBaseUrl, '/api/dashboard/users'), {
      headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) { onUnauthorized(); return }
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load dashboard users.')
      if (controller.signal.aborted) return
      setUsers(data.users)
      setCurrentUserId(data.currentUserId)
      setStatus('ready')
    }).catch((failure) => { if (!controller.signal.aborted) { setError(failure.message); setStatus('error') } })
    return () => controller.abort()
  }, [apiBaseUrl, buildApiUrl, authToken, onUnauthorized])

  useEffect(() => {
    if (!created?.isReset) return
    const timeout = window.setTimeout(() => setCreated(null), 60_000)
    return () => window.clearTimeout(timeout)
  }, [created])

  async function mutate(action) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try { await action(); setAuditRevision((value) => value + 1) }
    catch (failure) { setError(failure.message) }
    finally { pending.current = false; setBusy(false) }
  }

  function createUser(event) {
    event.preventDefault()
    void mutate(async () => {
      const data = await request('', { method: 'POST', body: JSON.stringify({ username: username.trim(), role }) })
      setUsers((current) => [...current, data.user])
      setCreated(data)
      setUsername('')
      setRole('readonly')
      setMessage(`Created ${data.user.username}.`)
    })
  }

  function changeRole(user) {
    void mutate(async () => {
      const data = await request(`/${encodeURIComponent(user.id)}/role`, { method: 'PUT', body: JSON.stringify({ role: drafts[user.id] }) })
      setUsers((current) => current.map((item) => item.id === user.id ? data.user : item))
      setDrafts((current) => { const next = { ...current }; delete next[user.id]; return next })
      setMessage(`Updated ${user.username} to ${roleLabel(data.user.role)}.`)
    })
  }

  function deleteUser(user) {
    void mutate(async () => {
      await request(`/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      setUsers((current) => current.filter((item) => item.id !== user.id))
      setConfirmDelete('')
      if (created?.user.id === user.id) setCreated(null)
      setMessage(`Deleted ${user.username}.`)
    })
  }

  function resetPassword(user) {
    void mutate(async () => {
      const data = await request(`/${encodeURIComponent(user.id)}/reset-password`, { method: 'POST' })
      setUsers((current) => current.map((item) => item.id === user.id ? data.user : item))
      setCreated({ ...data, isReset: true })
      setConfirmReset('')
      setMessage(`Reset the password for ${user.username}.`)
    })
  }

  function toggleLock(user) {
    void mutate(async () => {
      const data = await request(`/${encodeURIComponent(user.id)}/lock`, { method: 'PUT', body: JSON.stringify({ locked: !user.locked }) })
      setUsers((current) => current.map((item) => item.id === user.id ? data.user : item))
      setMessage(`${data.user.locked ? 'Locked' : 'Unlocked'} ${user.username}. Existing sessions were kept.`)
    })
  }

  function revokeSessions(user) {
    void mutate(async () => {
      const data = await request(`/${encodeURIComponent(user.id)}/revoke-sessions`, { method: 'POST' })
      setUsers((current) => current.map((item) => item.id === user.id ? data.user : item))
      setConfirmRevoke('')
      setMessage(`Revoked all active sessions for ${user.username}.`)
      if (user.id === currentUserId) onUnauthorized()
    })
  }

  return <section className="dashboard-administration" aria-label="User administration">
    <h2 aria-label="Administration">Administration<DashboardHelp label="About user administration">
      Administrators can manage users and all dashboard settings. Editors can change chatbot settings and review data.
      Read-only users can view conversations and analytics. Deleting a user or changing their role invalidates existing sessions.
      You cannot delete your own account or change your own role.
      Locks prevent new logins while preserving existing sessions. Password resets and session revocation invalidate all existing sessions.
    </DashboardHelp></h2>
    <DashboardSubtabs idPrefix="administration" label="Administration areas" activeTab={activeTab} onSelect={onSelectTab} tabs={[
      { id: 'users', label: 'Users & access', content: <>
        {status === 'loading' && <p role="status">Loading dashboard users…</p>}
        {error && <p role="alert" className="dashboard-message error">{error}</p>}
        {message && <p role="status">{message}</p>}
        {status === 'ready' && <>
          <form ref={createFormRef} className="administration-create-form" onSubmit={createUser} aria-label="Create dashboard user">
            <UnsavedChangesIndicator dirty={createDirty} />
            <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={80} required disabled={busy} autoComplete="off" /></label>
            <label>Role<select value={role} onChange={(event) => setRole(event.target.value)} disabled={busy}>
              {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <button type="submit" className="conversation-search-button" disabled={busy || !username.trim()}>Create user</button>
          </form>
          {created && <section className="administration-credentials" aria-label="New user credentials">
            <h3>Credentials for {created.user.username}</h3>
            <p>Temporary password: <code>{created.temporaryPassword}</code></p>
            <p className="history-meta">Share these credentials privately. The user must choose a new password on login. This password is shown only here.{created.isReset && ' It hides automatically after one minute.'}</p>
            <button type="button" className="conversation-search-button" onClick={() => setCreated(null)}>Dismiss credentials</button>
          </section>}
          <div ref={rolesFormRef}>
          <UnsavedChangesIndicator dirty={rolesDirty} />
          <div className="analytics-table-scroll" tabIndex="0" role="region" aria-label="Dashboard users">
            <table><thead><tr>{['User', 'Profile', 'Status', 'Role', 'Actions'].map((label) => <th scope="col" key={label}>{label}{label === 'Actions' && <DashboardHelp label="About account access controls">
              Reset password replaces the password and signs out existing sessions; the temporary password hides after one minute. Lock blocks new logins but keeps active sessions valid. Revoke sessions signs out all existing sessions without changing the password or lock status.
            </DashboardHelp>}</th>)}</tr></thead>
              <tbody>{users.map((user) => <tr key={user.id}>
                <th scope="row">{user.username}{user.id === currentUserId ? ' (you)' : ''}</th>
                <td>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Not provided'}{user.email && <span className="administration-email">{user.email}</span>}</td>
                <td>{!user.active ? 'Disabled' : user.locked ? 'Locked' : user.onboardingRequired ? 'First login pending' : user.passwordResetRequired ? 'Password change required' : 'Active'}</td>
                <td>{user.id === currentUserId ? roleLabel(user.role) : <select aria-label={`Role for ${user.username}`}
                  value={drafts[user.id] || user.role} disabled={busy} onChange={(event) => setDrafts((current) => ({ ...current, [user.id]: event.target.value }))}>
                  {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>}</td>
                <td><div className="administration-user-actions">
                  {user.id !== currentUserId && <>
                    <button type="button" className="conversation-search-button" aria-label={`Save role for ${user.username}`} disabled={busy || !drafts[user.id] || drafts[user.id] === user.role} onClick={() => changeRole(user)}>Save role</button>
                    {confirmReset === user.id ? <>
                      <span>Reset password for {user.username} and sign out existing sessions?</span>
                      <button type="button" className="conversation-search-button" aria-label={`Confirm reset password for ${user.username}`} disabled={busy} onClick={() => resetPassword(user)}>Confirm reset</button>
                      <button type="button" className="conversation-search-button" disabled={busy} onClick={() => setConfirmReset('')}>Cancel reset</button>
                    </> : <button type="button" className="conversation-search-button" aria-label={`Reset password for ${user.username}`} disabled={busy} onClick={() => setConfirmReset(user.id)}>Reset password</button>}
                  </>}
                  {(user.id !== currentUserId || user.locked) && <button type="button" className="conversation-search-button" aria-label={`${user.locked ? 'Unlock' : 'Lock'} ${user.username}`} disabled={busy || !user.active} onClick={() => toggleLock(user)}>{user.locked ? 'Unlock' : 'Lock'}</button>}
                  {confirmRevoke === user.id ? <>
                    <span>Sign out all sessions for {user.username}?</span>
                    <button type="button" className="conversation-search-button" aria-label={`Confirm revoke sessions for ${user.username}`} disabled={busy} onClick={() => revokeSessions(user)}>Confirm revoke</button>
                    <button type="button" className="conversation-search-button" disabled={busy} onClick={() => setConfirmRevoke('')}>Cancel revoke</button>
                  </> : <button type="button" className="conversation-search-button" aria-label={`Revoke sessions for ${user.username}`} disabled={busy} onClick={() => setConfirmRevoke(user.id)}>Revoke sessions</button>}
                  {user.id !== currentUserId && (confirmDelete === user.id ? <>
                    <span>Delete {user.username}?</span>
                    <button type="button" className="conversation-search-button administration-delete" aria-label={`Confirm delete ${user.username}`} disabled={busy} onClick={() => deleteUser(user)}>Confirm delete</button>
                    <button type="button" className="conversation-search-button" disabled={busy} onClick={() => setConfirmDelete('')}>Cancel</button>
                  </> : <button type="button" className="conversation-search-button administration-delete" aria-label={`Delete ${user.username}`} disabled={busy} onClick={() => setConfirmDelete(user.id)}>Delete</button>)}
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>
          </div>
        </>}
      </> },
      { id: 'audit', label: 'Audit log', content: <DashboardAuditLog apiBaseUrl={apiBaseUrl} buildApiUrl={buildApiUrl} authToken={authToken} onUnauthorized={onUnauthorized} refreshKey={auditRevision} /> },
    ]} />
  </section>
}
