import * as THREE from 'three'

/**
 * The game's world: the real Earth-Moon system, frozen in a frame that turns
 * with the Moon (x from Earth to Moon, y north, z completing it), and the
 * places in it.
 *
 * Positions are metres, as JavaScript doubles: 384,400 km to a millimetre.
 * Each place is an anchor, and everything near it (stations, rocks, rings)
 * is placed relative to it, so local flight works in small numbers and the
 * renderer subtracts the camera's anchor before anything reaches the GPU.
 */
const V = (x, y, z) => new THREE.Vector3(x, y, z)

export const EARTH = { id: 'earth', name: 'Earth', radius: 6371e3, mu: 3.986004418e14, position: V(0, 0, 0) }
export const MOON = { id: 'moon', name: 'Moon', radius: 1737.4e3, mu: 4.9048695e12, position: V(384400e3, 0, 0) }
export const BODIES = [EARTH, MOON]
/**
 * Toward the Sun. Fixed: both worlds near quarter phase, so every view has a
 * terminator, and a little south of the Moon's equator, so the south pole
 * (Shackleton) is in the low, grazing light it really gets.
 */
export const SUN_DIR = V(0.25, -0.14, 1).normalize()

/**
 * Earth-Moon L1, from the Earth: where the two pulls and the frame's rotation
 * balance. Solved, not looked up (326,400 km or so).
 */
export const L1 = (() => {
  const D = MOON.position.x, w2 = (EARTH.mu + MOON.mu) / D ** 3, bary = D * MOON.mu / (EARTH.mu + MOON.mu)
  const f = (r) => EARTH.mu / r ** 2 - MOON.mu / (D - r) ** 2 - w2 * (r - bary)
  let lo = D * 0.7, hi = D * 0.95
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m }
  return (lo + hi) / 2
})()

const harborDir = V(0.55, 0.12, 0.83).normalize()

/**
 * The places you can travel to. `region` is how far local flight reaches
 * from the anchor before you are out in the dark (metres).
 */
export const PLACES = {
  hearth: {
    id: 'hearth', name: 'Hearth Station', where: 'Earth-Moon L1', anchor: V(L1, 0, 0), region: 30e3,
    blurb: 'The boomtown at L1, halfway to everywhere. Free port, cheap berths, no questions until there are.',
  },
  harbor: {
    id: 'harbor', name: 'Harbor', where: '420 km above Earth', anchor: harborDir.clone().multiplyScalar(EARTH.radius + 420e3), region: 30e3,
    blurb: 'The respectable end of the business: shipyards, insurers, and the Harbor Loop race.',
  },
  drift: {
    id: 'drift', name: 'The Drift', where: '2,400 km from Hearth', anchor: V(L1 + 1.1e6, 0.35e6, 2.1e6), region: 30e3,
    blurb: 'What is left of the Kessler Mining venture: a slow cloud of rock and wreckage. Salvage, and the Hollow.',
  },
  gateway: {
    id: 'gateway', name: 'Gateway', where: 'Lunar halo orbit', anchor: MOON.position.clone().add(V(-3.0e6, 8.0e6, 3.0e6)), region: 30e3,
    blurb: 'The Lunar Compact\'s patrol command, swinging over the Moon\'s north pole.',
  },
  shackleton: {
    id: 'shackleton', name: 'Shackleton', where: '60 km over the lunar south pole', anchor: MOON.position.clone().add(V(0, -(MOON.radius + 60e3), 0)), region: 30e3,
    blurb: 'The ice mines at the south pole. Everything here is a landing.',
  },
  // The deep lanes: past the Earth-Moon system, where the drive is the only
  // road and a full tank is a round trip. L5 first, then the far dark.
  arbor: {
    id: 'arbor', name: 'The Arbor', where: 'Earth-Moon L5', anchor: V(MOON.position.x * 0.5, 0, -MOON.position.x * Math.sqrt(3) / 2), region: 30e3,
    blurb: 'An L5 habitat that turns for its gravity and grows its own air. Neutral ground, and the quiet end of everywhere.',
  },
  vesper: {
    id: 'vesper', name: 'Vesper Yards', where: '600 million km from Earth, on the far lanes', anchor: V(620e6, 60e6, -520e6), region: 30e3,
    blurb: 'The construction yards that built the deep fleet, gone quiet overnight. Salvage rights are posted at the cradles.',
  },
  citadel: {
    id: 'citadel', name: 'Citadel', where: '1,100 million km from Earth, deep lanes command', anchor: V(-420e6, -140e6, -800e6), region: 30e3,
    blurb: 'The Lunar Compact\'s deep lanes command: a station that logs every arrival and answers to nobody on the radio.',
  },
}
export const PLACE_ORDER = ['hearth', 'harbor', 'drift', 'gateway', 'shackleton', 'arbor', 'vesper', 'citadel']

/**
 * Stations: what you dock with. Local position in the place's frame (m),
 * the docking port, and who runs it. `law` stations turn you away when hot.
 */
export const STATIONS = {
  hearth: {
    id: 'hearth', place: 'hearth', name: 'Hearth Station', model: 'hearth', at: V(0, 0, 0), radius: 420,
    port: { at: V(0, 0, 200), axis: V(0, 0, 1) }, faction: 'free', law: 3,
    services: ['jobs', 'market', 'shipyard', 'outfit', 'repair'],
  },
  harbor: {
    id: 'harbor', place: 'harbor', name: 'Harbor', model: 'harbor', at: V(0, 0, 0), radius: 380,
    port: { at: V(0, 0, 420), axis: V(0, 0, 1) }, faction: 'compact', law: 2,
    services: ['jobs', 'market', 'shipyard', 'outfit', 'repair'],
  },
  shackle: {
    id: 'shackle', place: 'drift', name: 'The Shackle', model: 'shackle', at: V(5200, 600, -3800), radius: 520,
    port: { at: V(5200, 600, -3170), axis: V(0, 0, 1) }, faction: 'hollow', law: 9,
    services: ['jobs', 'market', 'outfit', 'repair', 'fence'],
  },
  gateway: {
    id: 'gateway', place: 'gateway', name: 'Gateway', model: 'gateway', at: V(0, 0, 0), radius: 260,
    port: { at: V(0, 0, 270), axis: V(0, 0, 1) }, faction: 'compact', law: 1,
    services: ['jobs', 'market', 'repair', 'fines'],
  },
  arbor: {
    id: 'arbor', place: 'arbor', name: 'The Arbor', model: 'arbor', at: V(0, 0, 0), radius: 360,
    port: { at: V(0, 0, 400), axis: V(0, 0, 1) }, faction: 'free', law: 2,
    services: ['jobs', 'market', 'outfit', 'repair'],
  },
  vesper: {
    id: 'vesper', place: 'vesper', name: 'Vesper Yards', model: 'vesper', at: V(5200, 600, -3800), radius: 520,
    port: { at: V(5200, 600, -3170), axis: V(0, 0, 1) }, faction: 'free', law: 4,
    services: ['jobs', 'market', 'shipyard', 'outfit', 'repair', 'fence'],
  },
  citadel: {
    id: 'citadel', place: 'citadel', name: 'Citadel', model: 'citadel', at: V(0, 0, 0), radius: 300,
    port: { at: V(0, 0, 310), axis: V(0, 0, 1) }, faction: 'compact', law: 1,
    services: ['jobs', 'market', 'outfit', 'repair', 'fines'],
  },
}

/** Where on arrival from a transfer the ship drops in, relative to the anchor. */
export const ARRIVAL = V(0, 300, 4200)

/** The Harbor Loop: eight rings round the station, flown in order. */
export const RACE_RINGS = [
  V(0, 200, 2600), V(1800, 600, 1200), V(2600, 1100, -1400), V(800, 400, -3200),
  V(-1600, -400, -2400), V(-2800, -200, -200), V(-1700, 300, 1900), V(0, 200, 2600),
]

/** The Drift's rocks: positions and radii, from a seed, the same every visit. */
export function driftRocks() {
  let s = 91
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const rocks = []
  for (let i = 0; i < 70; i++) {
    const r = 2500 + rnd() * 11000, a = rnd() * Math.PI * 2, y = (rnd() - 0.5) * 3000
    const p = V(Math.cos(a) * r, y, Math.sin(a) * r)
    if (p.distanceTo(STATIONS.shackle.at) < 1400) continue
    rocks.push({ at: p, radius: 40 + rnd() ** 3 * 420, spin: rnd() * 0.02, seed: i })
  }
  return rocks
}

/** Distance between two places' anchors, m. */
export const placeDistance = (a, b) => PLACES[a].anchor.distanceTo(PLACES[b].anchor)

/**
 * The open channels, per place: who is talking and what they say. Flown as
 * background radio while you are out and about with nothing on the comms,
 * the way a city sounds like itself whether or not you are in a hurry.
 */
export const RADIO = {
  hearth: [
    ['control', 'Hearth control: berths nine through twelve are open. Mind the ore hauler on the way in.'],
    ['mara', 'Dockmaster to all berths: the fuel barge is on the port side tonight. Plan your departures.'],
    ['control', 'Hearth traffic: keep your transponder on and your questions to yourself.'],
  ],
  harbor: [
    ['control', 'Harbor control: Loop traffic has right of way through the ring corridor.'],
    ['control', 'Harbor insurers: hull surveys by appointment. Fly carefully; premiums are watching.'],
    ['control', 'Courier tender Indus, requesting departure clearance to the deep lanes. Granted, Indus.'],
  ],
  drift: [
    ['control', 'Open channel: rock and salvage claims in the Drift are first come, first served.'],
    ['hollow', 'The Drift is ours, little bird. Keep your scoops to yourself.'],
    ['control', 'Freighter Tycho Maru, two days late and short one thruster. As usual.'],
  ],
  gateway: [
    ['patrol', 'Gateway patrol: transponder checks in effect on all approaches.'],
    ['control', 'Compact dispatch: the deep lanes are open to licensed traffic. Fly the corridor.'],
  ],
  shackleton: [
    ['control', 'Shackleton descent: corridor is clear. The ice does not care how good you are.'],
    ['control', 'Consortium hauler: loading water at pad three. Watch your plume.'],
  ],
  arbor: [
    ['control', 'Arbor habitat: the ring is spinning for gravity today. Dock at the axis, legs first.'],
    ['control', 'Arbor garden: visitors are welcome on the ring. No boots in the orchard.'],
    ['control', 'L5 is the quiet end of everywhere. That is the whole point of it.'],
  ],
  vesper: [
    ['control', 'Vesper Yards: salvage rights are posted at the cradles. Read them before you cut.'],
    ['control', 'The forge is cold and the cradles are empty. Somebody left here in a hurry.'],
    ['control', 'Vesper traffic: one ship in the pattern. Be about your business.'],
  ],
  citadel: [
    ['control', 'Citadel control: all arrivals are logged. All of them.'],
    ['patrol', 'Compact deep lanes command: state your business and hold your course.'],
    ['control', 'Citadel dispatch: the lanes are secure. Continue about your lawful work.'],
  ],
}
