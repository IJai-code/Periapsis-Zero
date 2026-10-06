import { useMemo, useState } from 'react'
import { startSound, play } from '../audio.js'
import { SUITS, LICENCES, earnedLicences, suitUnlocked } from '../core/pilot.js'

/** A new game: who you are, what you wear, and the one paragraph you need to know. */
export function NewPilot({ onBegin, onExit }) {
  const [name, setName] = useState('')
  const [suit, setSuit] = useState('hearth')
  const [step, setStep] = useState(0)
  const earned = useMemo(() => earnedLicences(), [])
  const go = (n) => { startSound(); play('click'); setStep(n) }
  const begin = () => onBegin(name.trim() || 'Pilot', suit)
  return <div className="np-root">
    <div className="np-art" />
    {step === 0 && <section className="np-card np-suits" key="suit">
      <span className="st-eyebrow">New game · 1 of 2</span>
      <h1>Choose your suit</h1>
      <p className="np-sub">You will see it on the walk to your ship, and through the canopy in flight. Change it any time in the Pilot tab.</p>
      <div className="np-grid">
        {SUITS.map((s) => {
          const open = suitUnlocked(s, earned)
          const lic = LICENCES.find((l) => l.id === s.licence)
          return <button key={s.id} className={`np-suit ${suit === s.id ? 'on' : ''} ${open ? '' : 'locked'}`} disabled={!open} onClick={() => { setSuit(s.id); play('click') }} title={open ? s.note : lic?.earn}>
            <SuitArt suit={s} />
            <strong>{s.name}</strong>
            <small>{open ? s.note : `${lic?.name} licence`}</small>
          </button>
        })}
      </div>
      <p className="np-licence">Locked suits come with pilot licences, earned in the <a href="#sim" target="_blank" rel="noreferrer">Simulator</a>: make orbit, cross to the Moon, dock, land, come home. Each licence also pays a signing bonus here.</p>
      <div className="np-actions"><button className="st-primary" onClick={() => go(1)}>Suit up</button><button className="st-ghost" onClick={onExit}>Back</button></div>
    </section>}
    {step === 1 && <section className="np-card np-name" key="name">
      <span className="st-eyebrow">New game · 2 of 2</span>
      <div className="np-who"><SuitArt suit={SUITS.find((x) => x.id === suit) ?? SUITS[0]} size={72} /><h1>Who is wearing it?</h1></div>
      <input autoFocus maxLength={24} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(2) }} />
      <div className="np-actions"><button className="st-primary" onClick={() => go(2)}>Continue</button><button className="st-ghost" onClick={() => go(0)}>Back</button></div>
    </section>}
    {step === 2 && <section className="np-crawl" onClick={begin}>
      <p className="np-year">2091</p>
      <p>The Moon is the frontier. The Lagrange point between it and the Earth is the boomtown, and every ship that matters passes through Hearth Station.</p>
      <p>You arrive with a tired Kestrel, a pilot's licence, and forty thousand credits owed to a man called Rook.</p>
      <p>Pay it off honestly. Or don't.</p>
      <button className="st-primary" onClick={begin}>Board your ship</button>
    </section>}
  </div>
}

/** A helmet and shoulders in a suit's colours: the same shapes as the pilot in the game. */
export function SuitArt({ suit, size = 84 }) {
  const id = `v-${suit.id}`
  return <svg className="suit-art" width={size} height={size} viewBox="0 0 100 100" aria-hidden>
    <defs>
      <radialGradient id={id} cx="38%" cy="35%" r="70%"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset=".25" stopColor={suit.visor} /><stop offset="1" stopColor="#120b22" /></radialGradient>
    </defs>
    <path d="M12 100 C14 74 28 66 50 66 C72 66 86 74 88 100 Z" fill={suit.suit} />
    <path d="M44 66 L56 66 L58 100 L42 100 Z" fill={suit.stripe} opacity=".9" />
    <rect x="30" y="62" width="40" height="8" rx="4" fill="#2b2a33" />
    <circle cx="50" cy="38" r="27" fill={suit.suit} />
    <rect x="47" y="10" width="6" height="22" rx="3" fill={suit.stripe} />
    <path d="M30 36 C30 26 70 26 70 36 L70 44 C70 54 30 54 30 44 Z" fill={`url(#${id})`} />
    <circle cx="24" cy="40" r="5" fill="#2b2a33" /><circle cx="76" cy="40" r="5" fill="#2b2a33" />
  </svg>
}
