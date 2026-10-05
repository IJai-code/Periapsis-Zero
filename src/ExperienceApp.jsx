import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Landing } from './ui/Landing.jsx'
import { createExpedition } from './sim/expedition.js'
import { experienceFromHash } from './sim/experiences.js'

// Both of these carry three.js. Loading them from dynamic imports keeps the
// renderer out of the entry chunk: the interface paints on react alone and the
// scene arrives as its own download, shared with the simulator's lazy chunk.
const Simulator = lazy(() => import('./App.jsx'))
const ScenicBackdrop = lazy(() => import('./ui/ScenicBackdrop.jsx'))

export default function ExperienceApp() {
  const [experience, setExperience] = useState(() => experienceFromHash(window.location.hash))
  const [visible, setVisible] = useState(!document.hidden)
  const scenic = useRef(createExpedition('mars')).current
  const controls = useRef({})
  useEffect(() => {
    // An old address is rewritten to its new one, so a shared link stays tidy.
    if (window.location.hash === '#story' || /^#expedition\//.test(window.location.hash)) {
      const e = experienceFromHash(window.location.hash)
      history.replaceState(null, '', e.mode === 'campaign' ? '#campaign' : e.mode === 'land' ? `#land/${e.id}` : '#')
    }
    const onHash = () => setExperience(experienceFromHash(window.location.hash))
    const visibility = () => setVisible(!document.hidden)
    window.addEventListener('hashchange', onHash)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  const navigate = (hash) => { window.location.hash = hash; setExperience(experienceFromHash(hash)) }
  if (experience.mode !== 'home') {
    // One simulator for all three: keyed so that switching between free flight
    // and the campaign remounts its interface, not its solar system.
    return <Suspense fallback={<div className="mode-loading">{experience.mode === 'campaign' ? 'Station Zero: preparing the solar system…' : 'Preparing the solar system…'}</div>}><Simulator key={experience.mode === 'campaign' ? 'campaign' : 'free'} campaign={experience.mode === 'campaign'} /></Suspense>
  }
  return <div className="fixed inset-0 bg-black">
    <Suspense fallback={null}><ScenicBackdrop session={scenic} controls={controls} visible={visible} /></Suspense>
    <Landing onCampaign={() => navigate('#campaign')} onSimulator={() => navigate('#flight')} onLand={(id) => navigate(`#land/${id}`)} />
  </div>
}
