import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bindDesktop, createControls, isTouch } from './ui/controls.js'
import { duck, engineLevel, pauseSound, play, startSound } from './audio.js'
import { Hud } from './ui/Hud.jsx'
import { Comms } from './ui/Comms.jsx'
import { Touch } from './ui/Touch.jsx'
import { Pause } from './ui/Pause.jsx'
import { SuitArt } from './ui/NewPilot.jsx'
import { updateMarkers } from './ui/markers.js'
import { createSkirmish, ARENAS, LIVES, SQUAD, bestRuns } from './core/skirmish.js'
import { SUITS, earnedLicences, suitUnlocked } from './core/pilot.js'
import { HULLS } from './core/ships.js'
import { loadSave } from './core/game.js'
import { connectRoom } from './net/realtime.js'
import { realtimeConfig } from '../sim/account.js'
import { sound } from './GameApp.jsx'
import './ui/game.css'

const GameScene = lazy(() => import('./scene/GameScene.jsx'))
const PREFS = 'pz-squadron-v1'
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 5 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('')
const linkFor = (code) => `${window.location.origin}${window.location.pathname}#squadron/${code}`

/**
 * Squadron: the battle mode. A lobby (who you are, what you fly, where), a
 * room for a code (who is in it), and the fight. Solo needs nothing; a
 * squadron needs the site's Realtime project, the same one accounts use.
 */
export default function SquadronApp({ joinCode = null, onExit }) {
  const prefs = useMemo(() => { try { return JSON.parse(localStorage.getItem(PREFS) ?? 'null') ?? {} } catch { return {} } }, [])
  const saved = useMemo(() => loadSave(), [])
  const [me] = useState(() => prefs.id ?? `p${Math.random().toString(36).slice(2, 10)}`)
  const [name, setName] = useState(prefs.name ?? saved?.pilot?.name ?? '')
  const [suit, setSuit] = useState(prefs.suit ?? saved?.pilot?.suit ?? 'hearth')
  const [hull, setHull] = useState(prefs.hull ?? 'kestrel')
  const [arena, setArena] = useState(prefs.arena ?? 'drift')
  const [phase, setPhase] = useState(joinCode ? 'joining' : 'lobby')
  const [code, setCode] = useState(joinCode)
  const [typed, setTyped] = useState('')
  const [roster, setRoster] = useState(new Map())
  const [error, setError] = useState(null)
  const net = useRef(null)
  const game = useRef(null)
  const [, setTick] = useState(0)
  const online = Boolean(realtimeConfig())
  const earned = useMemo(() => earnedLicences(), [])

  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ id: me, name, suit, hull, arena })) } catch { /* fine */ } }, [me, name, suit, hull, arena])
  useEffect(() => () => net.current?.close(), [])

  const pilotName = name.trim() || 'Pilot'
  const fly = useCallback((opts) => {
    startSound()
    game.current = createSkirmish({ name: pilotName, suit, hull, me, ...opts })
    // For the browser checks in scripts/: the running squadron, in development only.
    if (import.meta.env.DEV) window.__sq = game.current
    setPhase('play')
  }, [pilotName, suit, hull, me])

  /** Open (or join) the room for a code. */
  const openRoom = useCallback((c, host) => {
    const cfg = realtimeConfig()
    if (!cfg) { setError('Squadrons need the online service, which this copy of the site was built without. Fly with AI wingmates instead.'); return }
    net.current?.close()
    setError(null)
    setCode(c)
    setPhase('room')
    const room = connectRoom({
      url: cfg.url, key: cfg.key, room: `pz-sq-${c}`, id: me, meta: { name: pilotName, suit, hull, host },
      onStatus: (s, why) => { if (s === 'error') setError(`Could not reach the squadron service (${why}).`) },
    })
    room.onPresence = (r) => setRoster(r)
    // In the room, wait for the host's word; a squadron already flying lets you straight in.
    room.onMessage = (ev, p) => {
      if (game.current) return
      if (ev === 'start' || ev === 'snap') fly({ arena: p.ar ?? p.arena ?? 'drift', net: room, host: false, code: c })
    }
    net.current = room
    if (!host) window.history.replaceState(null, '', `#squadron/${c}`)
  }, [me, pilotName, suit, hull, fly])

  // A link with a code joins at once if we already know who you are; otherwise you type a callsign first.
  const knownName = useRef(Boolean(name.trim()))
  useEffect(() => { if (phase === 'joining' && joinCode && knownName.current) { knownName.current = false; openRoom(joinCode.toUpperCase(), false) } }, [phase, joinCode, openRoom])

  const launchSquad = () => {
    net.current?.broadcast('start', { arena })
    fly({ arena, net: net.current, host: true, code })
  }
  const leave = () => { net.current?.close(); net.current = null; game.current = null; onExit?.() }

  if (phase === 'play' && game.current) return <Battle game={game} onLeave={leave} onRestart={(ar) => { const sk = game.current.skirmish; fly({ arena: ar, net: sk.net, host: false, code: sk.code }); setTick((n) => n + 1) }} onAgain={() => {
    const sk = game.current.skirmish
    if (sk.net && !sk.host) return
    if (sk.net) sk.net.broadcast('start', { arena: sk.arena })
    fly({ arena: sk.arena, net: sk.net, host: true, code: sk.code })
    setTick((n) => n + 1)
  }} />

  const hosting = phase === 'room' && [...roster.values()].find((m) => m.id === me)?.host
  const best = bestRuns()
  return <div className="sq-root">
    <div className="np-art" />
    <section className="sq-card">
      <header className="sq-head">
        <span className="st-eyebrow">Squadron</span>
        <h1>{phase === 'room' ? `Squadron ${code}` : phase === 'joining' ? `Joining ${joinCode?.toUpperCase()}` : 'Hold the sky'}</h1>
        <p>{phase === 'room' ? 'Share the code or the link. Up to four pilots; AI wingmates fill the empty seats.' : 'Waves of raiders, four ships against them, six ships in reserve. Fly with AI wingmates, or share a code and friends take their seats.'}</p>
      </header>
      {error && <p className="sq-error">{error}</p>}

      {(phase === 'lobby' || phase === 'joining') && <>
        <div className="sq-row">
          <label className="sq-field"><span>Callsign</span><input maxLength={24} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="sq-field"><span>Ship</span><div className="sq-seg">{['kestrel', 'lance', 'mule'].map((h) => <button key={h} className={hull === h ? 'on' : ''} onClick={() => { setHull(h); play('click') }}>{HULLS[h].name}<small>{HULLS[h].role}</small></button>)}</div></div>
        </div>
        <div className="sq-field"><span>Suit</span><div className="sq-suits">{SUITS.filter((s) => suitUnlocked(s, earned)).map((s) => <button key={s.id} className={`np-suit ${suit === s.id ? 'on' : ''}`} onClick={() => { setSuit(s.id); play('click') }} title={s.name}><SuitArt suit={s} size={48} /></button>)}</div></div>
        {phase === 'lobby' && <div className="sq-field"><span>Battlefield</span><div className="sq-arenas">{Object.entries(ARENAS).map(([id, a]) => <button key={id} className={`sq-arena ${arena === id ? 'on' : ''}`} onClick={() => { setArena(id); play('click') }}>
          <strong>{a.name}</strong><small>{a.blurb}</small>{best[id] && <em>Best: wave {best[id].wave}, {best[id].score.toLocaleString()}</em>}
        </button>)}</div></div>}
        {phase === 'lobby' && <div className="sq-actions">
          <button className="st-primary sq-go" onClick={() => fly({ arena })}>Fly with AI wingmates</button>
          <button className="st-ghost" disabled={!online} onClick={() => openRoom(newCode(), true)} title={online ? '' : 'Needs the online service'}>Create a squadron</button>
          <span className="sq-join"><input maxLength={5} placeholder="CODE" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && typed.length === 5) openRoom(typed, false) }} /><button className="st-ghost" disabled={!online || typed.length !== 5} onClick={() => openRoom(typed, false)}>Join</button></span>
        </div>}
        {phase === 'joining' && <div className="sq-actions"><button className="st-primary sq-go" disabled={!name.trim()} onClick={() => openRoom(joinCode.toUpperCase(), false)}>Join squadron {joinCode?.toUpperCase()}</button><button className="st-ghost" onClick={leave}>Back</button></div>}
        <button className="sq-back" onClick={leave}>Back to the title</button>
      </>}

      {phase === 'room' && <>
        <div className="sq-code"><b>{code}</b><button className="st-ghost" onClick={() => { navigator.clipboard?.writeText(linkFor(code)); play('click') }}>Copy invite link</button></div>
        <ul className="sq-roster">
          {[...roster.values()].map((m) => { const s = SUITS.find((x) => x.id === m.suit) ?? SUITS[0]; return <li key={m.id}><SuitArt suit={s} size={40} /><span><strong>{m.name}</strong><small>{HULLS[m.hull]?.name ?? 'Kestrel'}{m.host ? ' · host' : ''}{m.id === me ? ' · you' : ''}</small></span></li> })}
          {Array.from({ length: Math.max(0, SQUAD - roster.size) }, (_, i) => <li key={`b${i}`} className="bot"><i /><span><strong>AI wingmate</strong><small>until someone joins</small></span></li>)}
        </ul>
        <div className="sq-actions">
          {hosting ? <button className="st-primary sq-go" onClick={launchSquad}>Launch the squadron</button> : <p className="sq-wait">Waiting for the host to launch.</p>}
          <button className="st-ghost" onClick={leave}>Leave</button>
        </div>
      </>}
    </section>
  </div>
}

/** The fight: the game's scene, HUD and controls, and the squadron's own panels. */
function Battle({ game, onLeave, onAgain, onRestart }) {
  const controls = useRef(createControls())
  const [touch] = useState(isTouch)
  const [overlay, setOverlay] = useState(null)
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay
  const [, setTick] = useState(0)
  const markers = useRef(null)
  const seen = useRef(0)
  const [quality, setQuality] = useState(() => { try { return localStorage.getItem('pz-game-quality') ?? 'high' } catch { return 'high' } })

  useEffect(() => {
    const c = controls.current
    c.wantLock = () => !overlayRef.current && game.current?.mode === 'flight' && game.current?.skirmish.state !== 'over' && !touch
    const onUi = (what) => {
      if (what === 'unlocked') { if (game.current?.mode === 'flight' && !overlayRef.current) setOverlay('pause'); return }
      if (what === 'pause') setOverlay((o) => (o ? null : 'pause'))
      if (what === 'help') { document.exitPointerLock?.(); setOverlay('help') }
    }
    return bindDesktop(c, c.canvas ?? document.querySelector('canvas') ?? document.body, onUi)
  }, [game, touch])

  useEffect(() => {
    const id = setInterval(() => {
      const g = game.current
      if (!g) return
      setTick((n) => n + 1)
      for (const ev of g.events) if (ev.n > seen.current) sound(g, ev)
      seen.current = g.evN
      duck(g.comms.length > 0)
      engineLevel(g.player.thrust ?? 0, g.player.boosting, g.mode === 'flight')
      if (g.skirmish.state === 'over') document.exitPointerLock?.()
      if (g.skirmish.restart) onRestart(g.skirmish.restart)
    }, 100)
    return () => clearInterval(id)
  }, [game, onRestart])
  useEffect(() => { pauseSound(false) }, [])

  const onFrame = useCallback((g, camera) => { if (markers.current) updateMarkers(markers.current, g, camera, controls.current) }, [])
  const g = game.current
  const sk = g.skirmish
  // A squadron keeps flying while you read the menu: there is no pausing other people.
  const paused = !sk.net && (overlay === 'pause' || overlay === 'help')
  const squad = [{ name: `${sk.name} (you)`, alive: g.mode !== 'dead', hull: g.player.hull / g.player.stats.hull }, ...[...sk.remote.values()].map((r) => ({ name: r.name, alive: r.alive, hull: r.hull ?? 1 })), ...g.ships.filter((e) => e.alive && e.team === 'ally' && !e.remote).map((e) => ({ name: e.label, alive: true, hull: e.hull / e.stats.hull, bot: true }))]
  return <div className={`gm-root ${touch ? 'is-touch' : ''}`}>
    <Suspense fallback={<div className="gm-loading">Forming up</div>}>
      <GameScene game={game} controls={controls} quality={quality} placeKey={sk.arena} paused={paused} onFrame={onFrame} />
    </Suspense>
    <div className="gm-markers" ref={markers} />
    <Hud game={g} touch={touch} controls={controls.current} onOverlay={setOverlay} />
    <Comms game={g} />
    <aside className="sq-panel">
      <div className="sq-wave"><span>Wave</span><b key={sk.wave}>{sk.wave}</b></div>
      <div className="sq-lives">{Array.from({ length: LIVES }, (_, i) => <i key={i} className={i < sk.lives ? 'on' : ''} />)}</div>
      <ul>{squad.map((m, i) => <li key={i} className={m.alive ? '' : 'down'}><span>{m.name}</span><b><i style={{ width: `${Math.max(0, Math.min(1, m.hull)) * 100}%` }} /></b></li>)}</ul>
      {sk.code && <p className="sq-share">Code <b>{sk.code}</b></p>}
    </aside>
    {sk.state === 'break' && sk.wave > 0 && <div className="sq-banner" key={`clear${sk.wave}`}><span>Wave {sk.wave} cleared</span><b>{Math.max(0, Math.ceil(sk.breakUntil - g.time))}</b></div>}
    {g.mode === 'dead' && sk.state !== 'over' && <div className="sq-banner down"><span>Ship lost</span><b>Back in {Math.max(0, Math.ceil(sk.deadUntil - g.real))}</b></div>}
    {touch && g.mode === 'flight' && !overlay && <Touch controls={controls.current} game={g} onOverlay={setOverlay} />}
    {(overlay === 'pause' || overlay === 'help') && <Pause game={g} touch={touch} help={overlay === 'help'} quality={quality} setQuality={(q) => { setQuality(q); try { localStorage.setItem('pz-game-quality', q) } catch { /* fine */ } }} controls={controls.current}
      onResume={() => setOverlay(null)} onQuit={onLeave} />}
    {sk.state === 'over' && <div className="sq-over">
      <section>
        <span className="st-eyebrow">{sk.over?.why ?? 'The squadron is out of ships'}</span>
        <h1>Wave {sk.over?.wave ?? sk.wave}</h1>
        <dl><div><dt>Score</dt><dd>{(sk.over?.score ?? sk.score).toLocaleString()}</dd></div><div><dt>Your kills</dt><dd>{sk.myKills}</dd></div><div><dt>Battlefield</dt><dd>{ARENAS[sk.arena].name}</dd></div></dl>
        <div className="sq-actions">{(!sk.net || sk.host) && <button className="st-primary" onClick={onAgain}>Fly again</button>}{sk.net && !sk.host && <p className="sq-wait">The host can start another.</p>}<button className="st-ghost" onClick={onLeave}>Leave</button></div>
      </section>
    </div>}
    {g.mode === 'flight' && !touch && !controls.current.mouse.locked && !overlay && sk.state !== 'over' && <div className="gm-takestick">Click the view to take the stick</div>}
  </div>
}
