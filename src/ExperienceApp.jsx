import { lazy, Suspense, useEffect, useState } from 'react'
import { Title } from './ui/Title.jsx'
import { experienceFromHash } from './sim/experiences.js'

// Each of these carries three.js and arrives as its own download: the title
// paints on React alone.
const Simulator = lazy(() => import('./App.jsx'))
const Game = lazy(() => import('./game/GameApp.jsx'))
const Squadron = lazy(() => import('./game/SquadronApp.jsx'))
const NEW_GAME = 'pz-game-new'

/**
 * Warm the modes the visitor is about to open, while the page is idle.
 *
 * The three modes are separate downloads and two of them carry three.js, so
 * the first click on the title used to spend its first seconds on a spinner.
 * Warming them behind the reading moves that wait to where nobody is looking.
 * It is a guess about intent, so it stays cheap and it stays polite: nothing
 * is fetched on a metered or slow connection, and the game — which a phone is
 * told not to expect — is not fetched at phone width.
 */
function warmModes() {
  const conn = navigator.connection
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return
  import('./App.jsx')
  if (!window.matchMedia('(max-width: 760px)').matches) import('./game/GameApp.jsx')
}

export default function ExperienceApp() {
  const [experience, setExperience] = useState(() => experienceFromHash(window.location.hash))
  useEffect(() => {
    // An old address is rewritten to its new one, so a shared link stays tidy.
    if (['#story', '#campaign'].includes(window.location.hash) || /^#expedition\//.test(window.location.hash)) {
      const e = experienceFromHash(window.location.hash)
      history.replaceState(null, '', e.mode === 'play' ? '#play' : e.mode === 'land' ? `#land/${e.id}` : '#')
    }
    const onHash = () => setExperience(experienceFromHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const navigate = (hash) => { window.location.hash = hash; setExperience(experienceFromHash(hash)) }
  useEffect(() => {
    if (experience.mode !== 'home') return
    // requestIdleCallback's timeout is the floor, not the ceiling: a page whose
    // animations never let the browser idle still warms the modes.
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(warmModes, { timeout: 4000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = setTimeout(warmModes, 2500)
    return () => clearTimeout(timer)
  }, [experience.mode])
  if (experience.mode === 'play') {
    return <Suspense fallback={<div className="mode-loading">Periapsis Zero</div>}><Game fresh={sessionStorage.getItem(NEW_GAME) === '1'} onFresh={() => sessionStorage.removeItem(NEW_GAME)} onExit={() => navigate('')} /></Suspense>
  }
  if (experience.mode === 'squadron') {
    return <Suspense fallback={<div className="mode-loading">Squadron</div>}><Squadron joinCode={experience.code} onExit={() => navigate('')} /></Suspense>
  }
  if (experience.mode !== 'home') {
    return <Suspense fallback={<div className="mode-loading">Preparing the solar system…</div>}><Simulator /></Suspense>
  }
  return <Title key={experience.training ? 'training' : 'home'} training={experience.training} onPlay={() => navigate('#play')} onNew={() => { sessionStorage.setItem(NEW_GAME, '1'); navigate('#play') }} onSimulator={() => navigate('#sim')} onSquadron={() => navigate('#squadron')} onLand={(id) => navigate(`#land/${id}`)} />
}
