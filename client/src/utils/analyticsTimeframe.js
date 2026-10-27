const storageKey = (username) => `dashboard_analytics_timeframe:${encodeURIComponent(username.trim().toLowerCase())}`
const isMonth = (value) => typeof value === 'string' && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(value)
const monthIndex = (value) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5))

function isValidRange(range) {
  return isMonth(range?.startMonth) && isMonth(range?.endMonth) &&
    range.startMonth <= range.endMonth && monthIndex(range.endMonth) - monthIndex(range.startMonth) < 60
}

function defaultRange() {
  const end = new Date()
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
  return { startMonth: start.toISOString().slice(0, 7), endMonth: end.toISOString().slice(0, 7) }
}

export function readAnalyticsTimeframe(username) {
  try {
    if (username?.trim()) {
      const range = JSON.parse(localStorage.getItem(storageKey(username)))
      if (isValidRange(range)) return { startMonth: range.startMonth, endMonth: range.endMonth }
    }
  } catch {
    // Use the usual range if browser storage is unavailable or corrupt.
  }
  return defaultRange()
}

export function saveAnalyticsTimeframe(username, range) {
  try {
    if (username?.trim() && isValidRange(range)) {
      localStorage.setItem(storageKey(username), JSON.stringify({ startMonth: range.startMonth, endMonth: range.endMonth }))
    }
  } catch {
    // Reports remain usable when the browser blocks persistent storage.
  }
}
