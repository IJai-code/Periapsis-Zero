import { useEffect, useRef, useState } from 'react'

/**
 * The big words: mission passed and failed, wanted, ship destroyed, act
 * complete. Each holds for a few seconds; ship destroyed holds until you go.
 */
export function Banners({ game: g, touch, onRespawn }) {
  const [b, setB] = useState(null)
  const seen = useRef(g.evN)
  useEffect(() => {
    for (const ev of g.events) {
      if (ev.n <= seen.current) continue
      if (ev.type === 'mission-complete') setB({ kind: 'passed', title: ev.id === 'periapsis' ? 'Act one complete' : ev.id === 'apoapsis' ? 'The story is complete' : 'Mission passed', sub: ev.title, reward: rewardLine(ev.reward), epilogue: ev.epilogue, until: g.real + (ev.epilogue ? 9 : 5) })
      if (ev.type === 'mission-failed') setB({ kind: 'failed', title: 'Mission failed', sub: ev.title, reward: ev.reason, until: g.real + 5 })
      if (ev.type === 'heat' && ev.level >= 2 && ev.why !== 'cooling') setB({ kind: 'wanted', title: 'Wanted', sub: ev.why === 'contraband' ? 'Contraband found' : ev.why === 'ran' ? 'You ran from a hail' : ev.why === 'murder' ? 'They will not forget that' : 'You fired on the Compact', until: g.real + 3 })
      if (ev.type === 'heat' && ev.level === 0 && ev.why === 'lost') setB({ kind: 'clear', title: 'Lost them', sub: 'The Compact has stopped looking', until: g.real + 3 })
      if (ev.type === 'interdicted') setB({ kind: 'wanted', title: 'Interdicted', sub: 'The Hollow pulled you out of the drive', until: g.real + 3 })
    }
    seen.current = g.evN
    if (b && b.until && g.real > b.until) setB(null)
  })
  if (g.mode === 'dead') return <div className="gm-banner dead">
    <h1>Ship destroyed</h1>
    <p>The insurer will tow what is left to your last station, for ten percent of your credits.</p>
    <button className="st-primary" onClick={onRespawn}>Wake up at {g.home === 'shackle' ? 'the Shackle' : 'your berth'}{touch ? '' : ' (R)'}</button>
  </div>
  if (!b) return null
  return <div className={`gm-banner ${b.kind}`}>
    <h1>{b.title}</h1>
    {b.sub && <p className="sub">{b.sub}</p>}
    {b.reward && <p className="reward">{b.reward}</p>}
    {b.epilogue && <p className="epilogue">{b.epilogue}</p>}
  </div>
}
const rewardLine = (r = {}) => [r.credits && `+₡ ${r.credits.toLocaleString()}`, r.debt && `₡ ${r.debt.toLocaleString()} off your debt`, r.clearDebt && 'Debt cleared'].filter(Boolean).join('   ')
