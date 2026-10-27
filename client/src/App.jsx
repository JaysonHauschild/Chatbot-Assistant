/**
 * App.jsx - Root route shell for the OKSBDC Chatbot.
 */

import { Suspense, lazy, useEffect, useState } from 'react'
import ChatWidget from './ChatWidget.jsx'
import DashboardLoadBoundary from './components/DashboardLoadBoundary.jsx'
import { buildApiUrl, resolveApiBaseUrl } from './utils/api.js'
import './App.css'

const Dashboard = lazy(async () => {
  const module = await import('./Dashboard.jsx')
  if (!module.default) throw new Error('Dashboard module is missing its default export.')
  return module
})

function App() {
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem('chatbot_theme')
    if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  const normalizedPathname = window.location.pathname.replace(/\/+$/, '') || '/'
  const appBasePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
  const isDashboardPage = normalizedPathname === `${appBasePath}/dashboard`
  const apiBaseUrl = resolveApiBaseUrl()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('chatbot_theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))
  }

  if (isDashboardPage) {
    return (
      <DashboardLoadBoundary>
        <Suspense fallback={<main className="dashboard-shell" aria-busy="true"><p className="dashboard-load-state" role="status">Loading dashboard…</p></main>}>
          <Dashboard
            apiBaseUrl={apiBaseUrl}
            buildApiUrl={buildApiUrl}
            theme={theme}
            toggleTheme={toggleTheme}
          />
        </Suspense>
      </DashboardLoadBoundary>
    )
  }

  return (
    <ChatWidget
      apiBaseUrl={apiBaseUrl}
      buildApiUrl={buildApiUrl}
      theme={theme}
      toggleTheme={toggleTheme}
    />
  )
}

export default App
