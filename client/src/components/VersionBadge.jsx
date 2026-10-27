import { useEffect, useState } from 'react'
import release from '../../../release.json'
import { buildApiUrl, resolveApiBaseUrl } from '../utils/api.js'

export default function VersionBadge({ className = '', version }) {
  const [liveVersion, setLiveVersion] = useState(release.version)
  useEffect(() => {
    if (version) return
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch(buildApiUrl(resolveApiBaseUrl(), '/api/health/live'), { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        if (!controller.signal.aborted && typeof data.version === 'string') setLiveVersion(data.version)
      } catch { /* Keep the bundled version when the API is unavailable. */ }
    }
    void refresh()
    const interval = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => {
      controller.abort()
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [version])
  return <span className={`release-version ${className}`.trim()}>v{version || liveVersion}</span>
}
