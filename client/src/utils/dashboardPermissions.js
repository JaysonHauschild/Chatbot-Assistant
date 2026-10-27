// This is a UI hint from the signed session, not an authorization check.
// Dashboard APIs independently verify the token and reject read-only writes.
export function isReadonlyDashboardToken(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).role === 'readonly'
  } catch {
    return false
  }
}

export function isAdminDashboardToken(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).role === 'admin'
  } catch {
    return false
  }
}
