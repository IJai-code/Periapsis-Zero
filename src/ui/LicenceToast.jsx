import { useEffect, useRef, useState } from 'react'
import { subscribeStory } from '../sim/story.js'
import { subscribeLogbook } from '../sim/logbook.js'
import { LICENCES, earnedLicences } from '../game/core/pilot.js'

/**
 * The simulator's half of the shared career: when a flight here earns a
 * pilot licence for the game, say so once, and offer the way across.
 */
export function LicenceToast() {
  const known = useRef(null)
  const [fresh, setFresh] = useState(null)
  useEffect(() => {
    known.current = earnedLicences()
    const check = () => {
      const now = earnedLicences()
      const got = LICENCES.find((l) => now.has(l.id) && !known.current.has(l.id))
      known.current = now
      if (got) setFresh(got)
    }
    const a = subscribeStory(check), b = subscribeLogbook(check)
    return () => { a(); b() }
  }, [])
  useEffect(() => { if (!fresh) return; const t = setTimeout(() => setFresh(null), 12000); return () => clearTimeout(t) }, [fresh])
  if (!fresh) return null
  return <div className="licence-toast" role="status">
    <span>Pilot licence earned</span>
    <strong>{fresh.name}</strong>
    <p>In the game, your pilot now holds it: a new suit in the locker and ₡ {fresh.bonus.toLocaleString()} to claim.</p>
    <div><a href="#play">Play the game</a><button onClick={() => setFresh(null)}>Later</button></div>
  </div>
}
