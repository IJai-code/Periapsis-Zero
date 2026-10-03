import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { StoryCampaign } from './ui/StoryCampaign.jsx'
import { Landing } from './ui/Landing.jsx'
import { createExpedition } from './sim/expedition.js'
import { experienceFromHash, expeditionHash } from './sim/experiences.js'

// Both of these carry three.js. Loading them from dynamic imports keeps the
// renderer out of the entry chunk: the interface paints on react alone and the
// scene arrives as its own download, shared with the simulator's lazy chunk.
const Simulator = lazy(() => import('./App.jsx'))
const Expedition = lazy(() => import('./ui/Expedition.jsx').then((m) => ({ default: m.Expedition })))
const ScenicBackdrop = lazy(() => import('./ui/ScenicBackdrop.jsx'))

export default function ExperienceApp() {
  const [experience, setExperience] = useState(() => experienceFromHash(window.location.hash))
  const [visible, setVisible] = useState(!document.hidden)
  const scenic = useRef(createExpedition('mars')).current
  const controls = useRef({})
  useEffect(() => {
    const onHash = () => setExperience(experienceFromHash(window.location.hash))
    const visibility = () => setVisible(!document.hidden)
    window.addEventListener('hashchange', onHash)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  const navigate = (hash) => { window.location.hash = hash; setExperience(experienceFromHash(hash)) }
  if (experience.mode === 'simulator') return <Suspense fallback={<div className="mode-loading">Preparing the simulator…</div>}><Simulator /></Suspense>
  if (experience.mode === 'expedition') return <Suspense fallback={<div className="mode-loading">Preparing the surface…</div>}><Expedition key={`${experience.id}/${experience.campaign}`} id={experience.id} campaign={experience.campaign} onExit={() => navigate(experience.campaign ? '#story' : '')} /></Suspense>
  return <div className="fixed inset-0 bg-black">
    <Suspense fallback={null}><ScenicBackdrop session={scenic} controls={controls} visible={visible} /></Suspense>
    {experience.mode === 'story' ? <StoryCampaign onHome={() => navigate('')} onBegin={(id) => navigate(expeditionHash(id, true))} /> : <Landing onEnter={() => navigate('#flight')} onStory={() => navigate('#story')} onExpedition={(id) => navigate(expeditionHash(id))} />}
  </div>
}
