import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * Which code this page is actually running.
 *
 * `globalThis.__SPXSIM_BUILD__` is the newest mtime among the modules that have
 * executed — see the stamp plugin in vite.config.js. Reported on a timeout
 * rather than inline because module bodies all run before any task does, and
 * the maximum is only complete once they have.
 *
 * Compare it against the file you just edited. If the page is older, the page is
 * not running your code, and no amount of reading the source will show why.
 * `npm run predev` clears the cache that usually causes it.
 */
if (import.meta.env.DEV) {
  setTimeout(() => {
    const stamp = globalThis.__SPXSIM_BUILD__
    console.info(`spxsim running code as of ${stamp ? new Date(stamp).toLocaleString() : 'unknown'}`)
  }, 0)
}
