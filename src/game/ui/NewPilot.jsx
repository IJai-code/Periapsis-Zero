import { useState } from 'react'
import { startSound } from '../audio.js'

/** A new game: who you are, and the one paragraph you need to know. */
export function NewPilot({ onBegin, onExit }) {
  const [name, setName] = useState('')
  const [step, setStep] = useState(0)
  const go = () => { startSound(); setStep(1) }
  return <div className="np-root">
    <div className="np-art" />
    {step === 0 && <section className="np-card">
      <span className="st-eyebrow">New game</span>
      <h1>Who is flying?</h1>
      <input autoFocus maxLength={24} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} />
      <div className="np-actions"><button className="st-primary" onClick={go}>Continue</button><button className="st-ghost" onClick={onExit}>Back</button></div>
    </section>}
    {step === 1 && <section className="np-crawl" onClick={() => onBegin(name.trim() || 'Pilot')}>
      <p className="np-year">2091</p>
      <p>The Moon is the frontier. The Lagrange point between it and the Earth is the boomtown, and every ship that matters passes through Hearth Station.</p>
      <p>You arrive with a tired Kestrel, a pilot's licence, and forty thousand credits owed to a man called Rook.</p>
      <p>Pay it off honestly. Or don't.</p>
      <button className="st-primary" onClick={() => onBegin(name.trim() || 'Pilot')}>Dock at Hearth</button>
    </section>}
  </div>
}
