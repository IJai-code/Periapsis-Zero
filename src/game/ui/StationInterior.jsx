import { useEffect, useMemo, useRef, useState } from 'react'
import { CHARACTERS } from '../core/story.js'

const STAFF = {
  hearth: [
    { id: 'mara', name: 'Mara Voss', role: 'Dockmaster', x: 73, y: 31, line: 'A berth, a working ship, and a clean manifest. Start with those, and this port will leave you alone.' },
    { id: 'control', name: 'Oren Vale', role: 'Traffic controller', x: 24, y: 35, line: 'Ore hauler is moving through the outer lane. Keep your nose clear when you leave.' },
  ],
  arbor: [
    { id: 'control', name: 'Tavi Sato', role: 'Garden steward', x: 74, y: 32, line: 'The ring is at spin. Outer path is for walking; the orchard beds are not a shortcut.' },
    { id: 'mara', name: 'Nia Bell', role: 'Habitat engineer', x: 25, y: 38, line: 'Air, water, light. We recycle all three, and none of them are free out here.' },
  ],
  vesper: [
    { id: 'renn', name: 'Renn Ayers', role: 'Second engineer, Aster', x: 73, y: 32, line: 'I signed the yard handover. The official ledger says the Aster never left its berth.' },
    { id: 'control', name: 'Yard control', role: 'Traffic desk', x: 25, y: 38, line: 'Cradle claims are public. Anything inside a sealed locker is not.' },
  ],
  citadel: [
    { id: 'sable', name: 'Adm. Imani Sable', role: 'Deep lanes command', x: 73, y: 32, line: 'Every arrival is logged. That is a safety measure, not an invitation to browse.' },
    { id: 'patrol', name: 'Lt. Dae', role: 'Compact watch', x: 25, y: 38, line: 'Keep to the marked concourse. Restricted doors are restricted for a reason.' },
  ],
}
const KIOSKS = [
  { tab: 'missions', name: 'Contacts', glyph: '01', x: 13 },
  { tab: 'jobs', name: 'Job board', glyph: '02', x: 25 },
  { tab: 'market', name: 'Market', glyph: '03', x: 37 },
  { tab: 'services', name: 'Services', glyph: '04', x: 50 },
  { tab: 'shipyard', name: 'Shipyard', glyph: '05', x: 63 },
  { tab: 'outfit', name: 'Outfitting', glyph: '06', x: 75 },
  { tab: 'pilot', name: 'Pilot record', glyph: '07', x: 87 },
]
const DIRECTIONS = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] }
const ACTIONS = Object.fromEntries(Object.entries(DIRECTIONS).map(([code]) => [code, true]))
const RANGE = 98

export function StationInterior({ station, touch, onClose, onService }) {
  const room = useRef(null), avatar = useRef(null), position = useRef({ x: 49, y: 51 })
  const held = useRef(new Set()), target = useRef(null), focus = useRef(null), lastNear = useRef('')
  const close = useRef(onClose), service = useRef(onService)
  close.current = onClose; service.current = onService
  const [near, setNear] = useState(null), [focusId, setFocusId] = useState(null), [message, setMessage] = useState(null)
  const staff = useMemo(() => STAFF[station.place] ?? [{ id: 'control', name: `${station.name} control`, role: 'Traffic desk', x: 73, y: 32, line: 'Welcome in. Berth assignments and departures are on the public board.' }], [station])
  const kiosks = useMemo(() => KIOSKS.filter((k) => k.tab === 'missions' || k.tab === 'pilot' || k.tab === 'services' || station.services.includes(k.tab)), [station])
  const points = useMemo(() => [...staff.map((p) => ({ ...p, kind: 'person' })), ...kiosks.map((k) => ({ ...k, id: `service:${k.tab}`, y: 77, kind: 'service' }))], [staff, kiosks])

  const interact = (id = focus.current) => {
    const point = points.find((p) => p.id === id)
    if (!point) return
    const p = position.current, rect = room.current?.getBoundingClientRect()
    const d = rect ? Math.hypot((p.x - point.x) * rect.width / 100, (p.y - point.y) * rect.height / 100) : Infinity
    if (d > RANGE) { setMessage(`Walk closer to ${point.name || CHARACTERS[point.id]?.name || point.id}, then interact.`); return }
    if (point.kind === 'service') { service.current(point.tab); return }
    const name = point.name ?? CHARACTERS[point.id]?.name ?? 'Station crew'
    setMessage(`${name}: ${point.line}`)
  }

  useEffect(() => {
    const keydown = (e) => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close.current(); return }
      if (ACTIONS[e.code]) { e.preventDefault(); e.stopImmediatePropagation(); held.current.add(e.code); return }
      if (e.code === 'KeyE' && !e.repeat && !(e.target instanceof HTMLElement && e.target.closest('button'))) {
        e.preventDefault(); e.stopImmediatePropagation(); interact()
      }
    }
    const keyup = (e) => { if (ACTIONS[e.code]) { e.preventDefault(); e.stopPropagation(); held.current.delete(e.code) } }
    const blur = () => { held.current.clear(); target.current = null }
    window.addEventListener('keydown', keydown, true)
    window.addEventListener('keyup', keyup, true)
    window.addEventListener('blur', blur)
    let frame = 0, previous = 0
    const tick = (now) => {
      const dt = previous ? Math.min(0.05, (now - previous) / 1000) : 0
      previous = now
      const v = position.current, destination = target.current
      let dx = 0, dy = 0
      for (const code of held.current) { dx += DIRECTIONS[code][0]; dy += DIRECTIONS[code][1] }
      if (destination) { dx += Math.sign(destination.x - v.x); dy += Math.sign(destination.y - v.y) }
      const n = Math.hypot(dx, dy)
      if (n > 0) {
        v.x = Math.max(7, Math.min(93, v.x + dx / n * 21 * dt))
        v.y = Math.max(18, Math.min(88, v.y + dy / n * 18 * dt))
        if (avatar.current) { avatar.current.style.left = `${v.x}%`; avatar.current.style.top = `${v.y}%` }
        if (destination && Math.hypot(destination.x - v.x, destination.y - v.y) < 2.5) target.current = null
      }
      const rect = room.current?.getBoundingClientRect()
      let best = null, bestDistance = RANGE
      if (rect) for (const point of points) {
        const d = Math.hypot((v.x - point.x) * rect.width / 100, (v.y - point.y) * rect.height / 100)
        if (d < bestDistance) { best = point; bestDistance = d }
      }
      const id = best?.id ?? ''
      if (id !== lastNear.current) { lastNear.current = id; setNear(best); if (best) { focus.current = best.id; setFocusId(best.id) } }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', keydown, true)
      window.removeEventListener('keyup', keyup, true)
      window.removeEventListener('blur', blur)
    }
  }, [points])

  const moveTo = (point) => {
    focus.current = point.id; setFocusId(point.id); target.current = { x: point.x, y: point.kind === 'service' ? 69 : point.y + 7 }; setMessage(`Walking to ${point.name ?? CHARACTERS[point.id]?.name ?? point.id}.`)
  }
  const clickFloor = (e) => {
    if (e.target.closest('button')) return
    const r = room.current.getBoundingClientRect()
    target.current = { x: Math.max(7, Math.min(93, (e.clientX - r.left) / r.width * 100)), y: Math.max(18, Math.min(88, (e.clientY - r.top) / r.height * 100)) }
    setMessage('Walking the concourse.')
  }
  const press = (code, down) => { if (down) held.current.add(code); else held.current.delete(code) }
  const actionLabel = near?.kind === 'person' ? `Talk to ${near.name}` : near?.name ? `Use ${near.name}` : focusId ? `Walk closer to ${points.find((p) => p.id === focusId)?.name ?? 'the marker'}` : 'Move near someone or a terminal'

  return <section className="concourse-root" role="dialog" aria-modal="true" aria-label={`${station.name} concourse`}>
    <header className="concourse-head"><div><span className="st-eyebrow">Public concourse · {station.faction === 'compact' ? 'Lunar Compact' : 'Open port'}</span><h1>{station.name} / concourse</h1></div><button className="concourse-close" onClick={onClose}>Return to berth</button></header>
    <p className="concourse-instructions">Walk with WASD or arrows. Click a person or terminal to approach; press E when close to interact.</p>
    <div className="concourse-room" ref={room} onPointerDown={clickFloor}>
      <div className="concourse-window"><i /><i /><i /><span>{station.place === 'arbor' ? 'L5 / garden ring' : station.place === 'vesper' ? 'Deep lanes / drydock' : station.place === 'citadel' ? 'Deep lanes / Compact space' : 'Earth-Moon frontier'}</span></div>
      <div className="concourse-arches" />
      <div className="concourse-floor"><div className="concourse-walkway" /><span>ARRIVALS</span><span>TRANSIT HALL</span></div>
      {staff.map((p) => <button key={p.id} className={`concourse-person ${focusId === p.id ? 'selected' : ''} ${near?.id === p.id ? 'near' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }} onClick={() => moveTo({ ...p, kind: 'person' })} aria-label={`Approach ${p.name}`}>
        <i className="concourse-figure"><b>{p.name.split(' ').map((s) => s[0]).join('').slice(0, 2)}</b></i><span><strong>{p.name}</strong><small>{p.role}</small></span>
      </button>)}
      {kiosks.map((k) => <button key={k.tab} className={`concourse-kiosk ${focusId === `service:${k.tab}` ? 'selected' : ''} ${near?.id === `service:${k.tab}` ? 'near' : ''}`} style={{ left: `${k.x}%`, top: '77%' }} onClick={() => moveTo({ ...k, id: `service:${k.tab}`, kind: 'service' })} aria-label={`Approach ${k.name} terminal`}>
        <i><b>{k.glyph}</b></i><span>{k.name}</span>
      </button>)}
      <div className="concourse-avatar" ref={avatar} style={{ left: '49%', top: '51%' }} aria-label="Your pilot"><i /><b>You</b></div>
    </div>
    <footer className="concourse-tools">
      <p role="status">{message ?? (near ? `${near.name} is close enough to interact.` : 'The concourse is open. Your ship and services are one short walk away.')}</p>
      <button className="st-primary concourse-interact" disabled={!near} onClick={() => interact(near?.id)}>{actionLabel}{!touch && <kbd className="gk">E</kbd>}</button>
      {touch && <div className="concourse-pad" aria-label="Walk controls">
        {[["ArrowUp", '↑'], ['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']].map(([code, label]) => <button key={code} aria-label={`Walk ${code.replace('Arrow', '').toLowerCase()}`} onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); press(code, true) }} onPointerUp={() => press(code, false)} onPointerCancel={() => press(code, false)}>{label}</button>)}
      </div>}
    </footer>
  </section>
}
