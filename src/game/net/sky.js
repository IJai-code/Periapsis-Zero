import * as THREE from 'three'
import { makeShip } from '../core/flight.js'
import { shipStats } from '../core/ships.js'
import { setNet, shipState } from './puppet.js'

/**
 * The shared sky: everyone playing the story flies in the same Earth-Moon
 * system at the same time. Around Hearth you see the other pilots at Hearth,
 * by name and in their suits; at Harbor, those at Harbor. Nobody can shoot
 * anybody (bolts pass through other pilots, and nothing they do changes your
 * game); you can hail them.
 *
 * One Realtime room per place, `pz-sky-<place>`: each pilot in flight sends
 * their ship five times a second, in the place's own frame, so the numbers
 * mean the same on every machine. A room is left on transfer and the next
 * place's joined on arrival. `pz-online` carries presence only, for the
 * "pilots flying now" count on the front page.
 *
 * `open(room, opts)` is how a room is made: the Realtime client in the
 * browser, a loopback in the gate.
 */
const SEND = 1 / 5
const STALE = 4
export const HAILS = ['o7', 'Fly safe.', 'Race you to the Moon.', 'Nice ship.', 'Watch out for the Hollow.']
const SKY_PLACES = new Set(['hearth', 'harbor', 'drift', 'gateway', 'shackleton'])

export function createSky({ open, me, name, suit }) {
  return { open, me, name, suit, place: null, room: null, others: new Map(), sendAt: 0, hailAt: -99, online: null }
}

/** Keep the sky in step with the game: the right room, our ship sent, theirs kept. Call a few times a second or more. */
export function syncSky(g, sky, dt) {
  const here = g.mode === 'flight' || g.mode === 'docking' || g.mode === 'launch' || g.mode === 'docked' ? g.place : null
  const want = SKY_PLACES.has(here) ? here : null
  if (want !== sky.place) {
    sky.room?.close?.()
    sky.room = null
    for (const o of sky.others.values()) o.ship.alive = false
    sky.others.clear()
    sky.place = want
    if (want) {
      sky.room = sky.open(`pz-sky-${want}`, { meta: { name: sky.name } })
      sky.room.onMessage = (ev, msg) => receive(g, sky, ev, msg)
    }
  }
  if (!sky.room) return
  sky.name = g.pilot.name; sky.suit = g.pilot.suit ?? 'hearth'
  sky.sendAt -= dt
  const flying = g.mode === 'flight' || g.mode === 'docking' || g.mode === 'launch'
  if (sky.sendAt <= 0 && flying) {
    sky.sendAt = SEND
    sky.room.broadcast('s', { id: sky.me, n: sky.name, su: sky.suit, hu: g.ship.hull, s: shipState(g.player) })
  }
  // Pilots who have gone quiet have docked, transferred or closed the tab.
  for (const [id, o] of sky.others) {
    if (g.real - o.at > STALE) { o.ship.alive = false; sky.others.delete(id) }
    else if (!g.ships.includes(o.ship)) g.ships.push(o.ship)
  }
}

/** Wave at everyone near you. */
export function hail(g, sky) {
  if (!sky?.room || g.real - sky.hailAt < 3) return false
  sky.hailAt = g.real
  const t = HAILS[Math.floor(Math.random() * HAILS.length)]
  sky.room.broadcast('hail', { id: sky.me, n: sky.name, t })
  g.emit({ type: 'toast', text: `You hailed the pilots near ${g.placeDef?.name ?? 'you'}: "${t}"` })
  return true
}

function receive(g, sky, ev, m) {
  if (!m || m.id === sky.me) return
  if (ev === 's') {
    let o = sky.others.get(m.id)
    if (!o || o.hull !== m.hu) {
      if (o) o.ship.alive = false
      const ship = makeShip(m.hu ?? 'kestrel', 'pilot', shipStats(m.hu ?? 'kestrel'), new THREE.Vector3(m.s[0], m.s[1], m.s[2]))
      ship.puppet = true; ship.remote = true
      const fresh = !o
      o = { ship, hull: m.hu, at: g.real }
      sky.others.set(m.id, o)
      g.ships.push(ship)
      if (fresh) g.emit({ type: 'toast', text: `${String(m.n).slice(0, 24)} is flying here` })
    }
    o.at = g.real
    o.ship.label = String(m.n ?? 'Pilot').slice(0, 24)
    o.ship.suit = m.su
    setNet(o.ship, m.s, g.real)
  }
  if (ev === 'hail') g.say(String(m.n ?? 'Pilot').slice(0, 24), String(m.t ?? 'o7').slice(0, 60), 4)
}

/** Leave every room. */
export function closeSky(sky) {
  sky?.room?.close?.()
  if (sky) sky.room = null
}
