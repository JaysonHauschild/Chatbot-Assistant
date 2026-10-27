import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isEmbeddedContext } from './utils/api.js'

const normalizedPathname = window.location.pathname.replace(/\/+$/, '') || '/'
const appBasePath = import.meta.env.BASE_URL.replace(/\/+$/, '')
const isDashboardPage = normalizedPathname === `${appBasePath}/dashboard`

// Set this before React renders so an iframe never paints the standalone page
// background around the widget. Dashboard pages retain their normal backdrop.
if (isEmbeddedContext() && !isDashboardPage) {
  document.documentElement.setAttribute('data-embedded', '')
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
