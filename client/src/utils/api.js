const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])
const SERVER_ROUTE_PREFIX = '/chatbot'
const API_PREFIX = '/api'

const normalizeBaseUrl = (value) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.replace(/\/+$/, '')
}

const normalizeAbsoluteBaseUrl = (value) => {
  const text = normalizeBaseUrl(value)
  if (!text) return ''
  if (/^https?:\/\//i.test(text)) return text
  if (text.startsWith('//')) return `${window.location.protocol}${text}`
  return `https://${text.replace(/^\/+/, '')}`
}

export const isTruthyEnvValue = (value) => TRUE_ENV_VALUES.has(String(value || '').trim().toLowerCase())

export const isEmbeddedContext = () => {
  if (isTruthyEnvValue(import.meta.env.VITE_EMBEDDED)) return true
  if (typeof window === 'undefined') return false

  try {
    return window.self !== window.top
  } catch {
    // Cross-origin frame access can throw in older browsers. If it does, this
    // client is necessarily running inside a frame.
    return true
  }
}

export const resolveApiBaseUrl = () => {
  const configuredBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)
  const embeddedBaseUrl = normalizeBaseUrl(import.meta.env.VITE_EMBED_API_BASE_URL)

  if (isEmbeddedContext()) {
    return normalizeAbsoluteBaseUrl(embeddedBaseUrl || configuredBaseUrl || window.location.origin)
  }

  return configuredBaseUrl
}

export const buildApiUrl = (baseUrl, apiPath) => {
  const rawPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  const base = normalizeBaseUrl(baseUrl)

  try {
    const requested = new URL(rawPath, window.location.origin)
    const requestedApiPath = requested.pathname.startsWith(`${SERVER_ROUTE_PREFIX}/`)
      ? requested.pathname.slice(SERVER_ROUTE_PREFIX.length)
      : requested.pathname

    if (!base) {
      return `${SERVER_ROUTE_PREFIX}${requestedApiPath}${requested.search}${requested.hash}`
    }

    const url = new URL(base, window.location.origin)
    const basePath = url.pathname.replace(/\/+$/, '')

    if (
      basePath.endsWith(`${SERVER_ROUTE_PREFIX}${API_PREFIX}`) &&
      requestedApiPath.startsWith(`${API_PREFIX}/`)
    ) {
      url.pathname = `${basePath}${requestedApiPath.slice(API_PREFIX.length)}`
    } else if (basePath.endsWith(SERVER_ROUTE_PREFIX)) {
      url.pathname = `${basePath}${requestedApiPath}`
    } else if (basePath.endsWith(API_PREFIX) && requestedApiPath.startsWith(`${API_PREFIX}/`)) {
      url.pathname = `${basePath.slice(0, -API_PREFIX.length)}${SERVER_ROUTE_PREFIX}${requestedApiPath}`
    } else {
      url.pathname = `${basePath}${SERVER_ROUTE_PREFIX}${requestedApiPath}`
    }

    url.search = requested.search
    url.hash = requested.hash
    return url.toString()
  } catch {
    return `${base}${SERVER_ROUTE_PREFIX}${rawPath}`
  }
}
