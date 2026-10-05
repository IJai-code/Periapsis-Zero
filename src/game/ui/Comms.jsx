import { CHARACTERS } from '../core/story.js'

/** Whoever is talking: portrait, name, and the line, one at a time. */
export function Comms({ game: g }) {
  const c = g.comms[0]
  if (!c) return null
  const who = CHARACTERS[c.who] ?? { name: c.who, role: '' }
  const shown = Math.min(c.text.length, Math.floor(((g.real - (c.at ?? g.real)) * 55)))
  return <div className={`gm-comms ${who.tone ?? ''}`} onClick={() => { g.comms.shift() }} role="status" aria-live="polite">
    <span className={`portrait ${c.who}`} aria-hidden><img src={`${import.meta.env.BASE_URL}game/portrait-${c.who}.webp`} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /><b>{who.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</b></span>
    <div>
      <strong>{who.name}</strong><small>{who.role}</small>
      <p>{c.text.slice(0, shown)}<span className="gm-caret">{shown < c.text.length ? '▍' : ''}</span></p>
    </div>
    {g.comms.length > 1 && <em>{g.comms.length - 1} more</em>}
  </div>
}
