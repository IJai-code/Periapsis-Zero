import { EPOCH, FLIP_WINDOW, setDestination, cycleTarget } from '../core/game.js'
import { PLACES } from '../core/world.js'
import { hostile } from '../core/ai.js'
import { inhibited } from '../core/heat.js'
import { Hint } from './keys.jsx'
import { play } from '../audio.js'

/** The flight HUD. Re-rendered ten times a second from the game object. */
export function Hud({ game: g, touch, onOverlay }) {
  const p = g.player
  const place = g.deep ?? PLACES[g.place] ?? g.placeDef
  return <div className="gm-hud">
    <header className="hud-where">
      <h1>{place?.name ?? 'Deep space'}</h1>
      <p>{g.skirmish ? `Skirmish${g.skirmish.code ? ` · squadron ${g.skirmish.code}` : ' · with AI wingmates'}` : `${place?.where} · ${clock(g.time)}`}</p>
      {g.skyOnline > 1 && !g.skirmish && <p className="hud-online"><b>{g.skyOnline - 1}</b> other {g.skyOnline === 2 ? 'pilot' : 'pilots'} online · <kbd className="gk">G</kbd> hail</p>}
      <Heat g={g} />
    </header>
    <Objective g={g} touch={touch} />
    {g.skirmish ? <div className="hud-money"><strong>{g.skirmish.score.toLocaleString()}</strong><small>Wave {g.skirmish.wave} · {g.skirmish.lives} ships in reserve</small></div>
      : <div className="hud-money"><strong>₡ {Math.round(g.credits).toLocaleString()}</strong>{g.debt > 0 && <small>Debt ₡ {g.debt.toLocaleString()}</small>}</div>}
    {g.mode === 'flight' && <Tactical g={g} />}
    {g.mode === 'flight' && <Cluster g={g} p={p} />}
    {(g.mode === 'transfer' || g.mode === 'align') && <Transfer g={g} touch={touch} />}
    {g.mode === 'flight' && g.prompt && <div className={`hud-prompt ${g.prompt.blocked ? 'blocked' : ''}`}>{!g.prompt.blocked && <kbd className="gk">{touch ? 'Action' : g.prompt.key}</kbd>}<span>{g.prompt.text}</span></div>}
    <Toasts g={g} />
    {!touch && <nav className="hud-keys">
      {!g.skirmish && <button onClick={() => onOverlay('map')}><kbd className="gk">M</kbd>Map</button>}
      {!g.skirmish && <button onClick={() => onOverlay('log')}><kbd className="gk">Tab</kbd>Jobs</button>}
      <button onClick={() => onOverlay('help')}><kbd className="gk">H</kbd>Controls</button>
      <button onClick={() => onOverlay('pause')}><kbd className="gk">Esc</kbd>Menu</button>
    </nav>}
  </div>
}

export function clock(t) {
  const d = new Date(EPOCH + t * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function Heat({ g }) {
  const h = g.heat
  if (!h.level) return null
  return <div className={`hud-heat lvl${h.level} ${h.seen ? 'seen' : 'hidden'}`} aria-label={`Wanted level ${h.level}`}>
    {[1, 2, 3, 4, 5].map((k) => <i key={k} className={k <= h.level ? 'on' : ''} />)}
    <span>{h.seen ? (h.level === 1 ? 'Patrol hailing' : 'Patrol pursuing') : h.cold ? 'Running cold: lost them' : 'Out of sight'}</span>
  </div>
}

function Objective({ g, touch }) {
  const o = g.objective
  if (!o) {
    const nextUp = g.story.active ? null : g.jobs.length ? null : 'Open the map to pick a destination, or dock and take a job.'
    return nextUp && g.mode === 'flight' ? <div className="hud-objective quiet"><p><Hint text={nextUp} touch={touch} /></p></div> : null
  }
  return <div className="hud-objective">
    {o.mission && <span className="hud-mission">{o.mission}</span>}
    <p><Hint text={o.text} touch={touch} /></p>
  </div>
}

/** Every ship nearby, nearest first; click one to target it. */
function Tactical({ g }) {
  const p = g.player
  const list = g.ships.filter((e) => e !== p && e.alive).map((e) => ({ e, d: e.pos.distanceTo(p.pos), h: hostile(g, e, p) })).sort((a, b) => (b.h - a.h) || a.d - b.d).slice(0, 7)
  const stations = g.stations.map((st) => ({ st, d: st.port.at.distanceTo(p.pos) }))
  if (!list.length && !stations.length) return null
  return <aside className="hud-tactical" aria-label="Contacts">
    <h2>Contacts</h2>
    <ul>
      {stations.map(({ st, d }) => <li key={st.id} className="station"><i />{st.name}<span>{fmt(d)}</span></li>)}
      {list.map(({ e, d, h }) => <li key={e.id} className={`${h ? 'hostile' : e.team} ${g.target === e.id ? 'on' : ''}`} onClick={() => { g.target = e.id; play('target') }}>
        <i />{e.label}<span>{fmt(d)}</span>
      </li>)}
    </ul>
  </aside>
}

function Cluster({ g, p }) {
  const s = p.stats
  const speed = p.vel.length()
  const cap = s.maxSpeed * (p.boosting ? s.boost : 1)
  const frac = Math.min(1, speed / (s.maxSpeed * s.boost))
  const arc = 2 * Math.PI * 54 * 0.75
  return <div className="hud-cluster">
    <div className="hud-bars left">
      <Bar label="Shield" v={p.shield / s.shield} cls="ion" />
      <Bar label="Hull" v={p.hull / s.hull} cls={p.hull / s.hull < 0.3 ? 'warn' : 'bone'} />
      <span className="hud-stop">Brake distance ≈ {fmt(speed * speed / (2 * s.accel * 0.6))}</span>
    </div>
    <div className="hud-speed">
      <svg viewBox="0 0 120 120" aria-hidden>
        <circle cx="60" cy="60" r="54" className="track" strokeDasharray={`${arc} 999`} transform="rotate(135 60 60)" />
        <circle cx="60" cy="60" r="54" className={`fill ${p.boosting ? 'boost' : ''}`} strokeDasharray={`${arc * frac} 999`} transform="rotate(135 60 60)" />
        <circle cx="60" cy="60" r="46" className="throttle" strokeDasharray={`${arc * 0.85 * Math.max(0, p.ctrl.throttle)} 999`} transform="rotate(135 60 60)" />
      </svg>
      <strong>{Math.round(speed)}</strong><small>m/s</small>
      <em className={p.ctrl.fa ? '' : 'off'}>{p.ctrl.fa ? 'ASSIST' : 'ASSIST OFF'}</em>
      {speed > cap * 1.02 && <em className="over">DRIFT</em>}
    </div>
    <div className="hud-bars right">
      <Bar label="Boost" v={p.boost} cls="ember" />
      <Bar label="Propellant" v={g.ship.prop / (s.tank ?? 1)} cls="bone" />
      {inhibited(g) && <span className="hud-flag">Drive inhibited</span>}
      {g.heat.level > 0 && g.heat.cold && <span className="hud-flag cold">Running cold</span>}
    </div>
  </div>
}
const Bar = ({ label, v, cls }) => <div className={`hud-bar ${cls}`}><span>{label}</span><b><i style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} /></b></div>

function Transfer({ g, touch }) {
  const tr = g.transfer
  if (!tr) return null
  const f = Math.min(1, tr.t), tau = f * tr.T
  const v = tau < tr.T / 2 ? tr.a * tau : tr.a * (tr.T - tau)
  const s = tau < tr.T / 2 ? 0.5 * tr.a * tau * tau : tr.D - 0.5 * tr.a * (tr.T - tau) ** 2
  const flipped = tr.flipAt != null
  const inWindow = !flipped && f >= FLIP_WINDOW[0]
  const phase = g.mode === 'align' ? 'Aligning' : inWindow ? 'Flip now' : !flipped ? 'Burn' : f - tr.flipAt < 0.05 ? 'Flipping' : 'Brake'
  const k = tr.trim ?? { x: 0, y: 0 }
  const off = Math.hypot(k.x, k.y)
  const h = (x) => `${Math.floor(x / 3600)}h ${String(Math.floor(x % 3600 / 60)).padStart(2, '0')}m`
  return <div className="hud-transfer">
    <span className="hud-mission">Transfer to {PLACES[tr.dest].name}</span>
    <h2 className={inWindow ? 'flip' : ''}>{phase}</h2>
    {g.mode === 'transfer' && !(flipped && f - tr.flipAt < 0.05) && <div className="hud-burn">
      <div className={`hud-trim ${off < 0.25 ? 'good' : off < 0.6 ? 'ok' : 'bad'}`}><i style={{ transform: `translate(${k.x * 34}px, ${-k.y * 34}px)` }} /></div>
      <p>{inWindow ? <>Flip with <Hint text="[dock]" touch={touch} />: the closer to halfway, the better.</> : <>Hold the thrust line: steer toward the dot with <Hint text={touch ? '[aim]' : 'the mouse or W A S D'} touch={touch} />.</>}</p>
    </div>}
    <div className="hud-progress"><em style={{ left: `${FLIP_WINDOW[0] * 100}%`, width: `${(FLIP_WINDOW[1] - FLIP_WINDOW[0]) * 100}%` }} /><i style={{ width: `${f * 100}%` }} /><b style={{ left: '50%' }} /></div>
    <dl>
      <div><dt>Velocity</dt><dd>{(v / 1000).toFixed(1)} km/s</dd></div>
      <div><dt>Remaining</dt><dd>{Math.round((tr.D - s) / 1000).toLocaleString()} km</dd></div>
      <div><dt>Ship time</dt><dd>{h(tau)} of {h(tr.T)}</dd></div>
      <div><dt>Thrust</dt><dd>{(tr.a / 9.80665).toFixed(2)} g</dd></div>
    </dl>
  </div>
}

/** Recent short messages: payments, pickups, warnings. */
function Toasts({ g }) {
  const now = g.time
  const list = g.events.filter((e) => now - e.t < 4 && (e.type === 'toast' || e.type === 'paid' || e.type === 'pickup' || e.type === 'denied' || e.type === 'fined' || e.type === 'interdicted' || e.type === 'race-done' || e.type === 'ring' || e.type === 'burn-rated')).slice(-4)
  if (!list.length) return null
  return <div className="hud-toasts">{list.map((e) => <p key={e.n} className={e.type}>{toastText(e)}</p>)}</div>
}
function toastText(e) {
  switch (e.type) {
    case 'paid': return `+₡ ${e.amount.toLocaleString()} · ${e.why}`
    case 'pickup': return 'Canister scooped'
    case 'burn-rated': return `Burn rated ${e.grade}${e.back > 0 ? `: ${e.pct}% of the propellant back` : ''}${e.auto ? ' (computer flip)' : ''}`
    case 'denied': return e.why ?? 'Refused'
    case 'fined': return `Fined ₡ ${e.amount.toLocaleString()}`
    case 'interdicted': return 'Pulled out of the drive: Hollow interdiction'
    case 'race-done': return `Harbor Loop: ${e.time.toFixed(1)} s`
    case 'ring': return `Ring ${e.n}`
    default: return e.text
  }
}
const fmt = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)
export { setDestination, cycleTarget }
