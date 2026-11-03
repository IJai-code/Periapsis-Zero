import { useEffect, useState } from 'react'
import { connectRoom } from '../game/net/realtime.js'

/*
 * The game's season on the front page: its name, the countdown to the live
 * event that ends it, and how many travellers are in the Reach right now
 * (the game's lobby room, game/scripts/reach/echoes.gd, watched without
 * joining its count). The dates match game/scripts/reach/season.gd.
 */
export const SEASONS = [
  { n: 1, name: 'Embers', start: Date.UTC(2026, 10, 2), event: Date.UTC(2027, 0, 23, 19), eventName: 'The Homecoming' },
  { n: 2, name: 'Homecoming', start: Date.UTC(2027, 0, 23, 19), event: Date.UTC(2027, 3, 24, 19), eventName: 'the season finale' },
]

const URL_ = ((import.meta.env?.VITE_SUPABASE_URL ?? '').match(/https:\/\/[^\s\])]+/)?.[0] ?? '').replace(/[./]+$/, '')
const KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''

export function currentSeason(now = Date.now()) {
  return SEASONS.reduce((pick, s) => (now >= s.start ? s : pick), SEASONS[0])
}

function span(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return d > 0 ? `${d}d ${h}h ${String(m).padStart(2, '0')}m` : `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`
}

/** How many are in the Reach now: null until the room answers (an empty
 * room sends no presence at all, so joining it means nobody is there). */
function useTravellers() {
  const [n, setN] = useState(null)
  useEffect(() => {
    if (!URL_ || !KEY || typeof WebSocket === 'undefined') return
    const room = connectRoom({ url: URL_, key: KEY, room: 'pz-reach', id: `web-${Math.random().toString(36).slice(2)}`, track: false, onPresence: (r) => setN(r.size), onStatus: (st) => { if (st === 'joined') setN((x) => x ?? 0) } })
    return () => room.close()
  }, [])
  return n
}

export function SeasonBadge({ href }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const s = currentSeason(now)
  const left = s.event - now
  const live = now >= SEASONS[0].event && now < SEASONS[0].event + 20 * 60 * 1000
  const n = useTravellers()
  const week = Math.floor((now - s.start) / (7 * 86400 * 1000)) + 1
  return <a className={`lp-season${live ? ' live' : ''}`} href={href}>
    <span className="lp-season-kicker">Season {s.n} · week {week}</span>
    <strong>{s.name}</strong>
    <span className="lp-season-count">{live ? 'The Homecoming is happening now. Get in.' : `${s.eventName[0].toUpperCase() + s.eventName.slice(1)} in ${span(left)}`}</span>
    {n !== null && <span className="lp-season-live"><i aria-hidden />{n === 0 ? 'Nobody in the Reach right now. Be the first.' : `${n} ${n === 1 ? 'traveller' : 'travellers'} in the Reach right now`}</span>}
  </a>
}
