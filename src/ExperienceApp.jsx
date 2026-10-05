import { lazy, Suspense, useEffect, useState } from 'react'
import { Title } from './ui/Title.jsx'
import { experienceFromHash } from './sim/experiences.js'

// Each of these carries three.js and arrives as its own download: the title
// paints on React alone.
const Simulator = lazy(() => import('./App.jsx'))
const Game = lazy(() => import('./game/GameApp.jsx'))
const NEW_GAME = 'pz-game-new'

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
  if (experience.mode === 'play') {
    return <Suspense fallback={<div className="mode-loading">Periapsis Zero</div>}><Game fresh={sessionStorage.getItem(NEW_GAME) === '1'} onFresh={() => sessionStorage.removeItem(NEW_GAME)} onExit={() => navigate('')} /></Suspense>
  }
  if (experience.mode !== 'home') {
    return <Suspense fallback={<div className="mode-loading">Preparing the solar system…</div>}><Simulator /></Suspense>
  }
  return <Title onPlay={() => navigate('#play')} onNew={() => { sessionStorage.setItem(NEW_GAME, '1'); navigate('#play') }} onSimulator={() => navigate('#sim')} />
}
