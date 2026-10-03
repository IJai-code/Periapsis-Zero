import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { Expedition } from './ui/Expedition.jsx'
import { StoryCampaign } from './ui/StoryCampaign.jsx'
import { Landing } from './ui/Landing.jsx'
import { ExpeditionScene } from './components/ExpeditionScene.jsx'
import { createExpedition } from './sim/expedition.js'
import { experienceFromHash, expeditionHash } from './sim/experiences.js'

const Simulator = lazy(() => import('./App.jsx'))

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
  if (experience.mode === 'expedition') return <Expedition key={`${experience.id}/${experience.campaign}`} id={experience.id} campaign={experience.campaign} onExit={() => navigate(experience.campaign ? '#story' : '')} />
  return <div className="fixed inset-0 bg-black">
    <Canvas shadows frameloop={visible ? 'always' : 'never'} dpr={[1, 1.5]} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }} camera={{ position: [360, 110, 370], fov: 55, near: 0.1, far: 90000 }}>
      <ExpeditionScene session={scenic} controls={controls} paused scenic />
    </Canvas>
    {experience.mode === 'story' ? <StoryCampaign onHome={() => navigate('')} onBegin={(id) => navigate(expeditionHash(id, true))} /> : <Landing onEnter={() => navigate('#flight')} onStory={() => navigate('#story')} onExpedition={(id) => navigate(expeditionHash(id))} />}
  </div>
}
