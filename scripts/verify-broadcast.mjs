/**
 * The broadcast, held to what it says about the flight.
 *
 * The feed is presentation, but it makes claims, and each is one a viewer
 * would take at face value: that this picture was a camera and that one a
 * simulation, that the clock reads what Apollo's did, that the spacecraft is
 * behind the Moon when the caption says the signal is lost, that a reply from
 * the Moon waits for light, that the count is read on its second, that the
 * rumble from a pad arrives late and low by the physics of sound in air. None
 * of them needs a browser to check, so all of them are checked here.
 *
 *   node --expose-gc scripts/verify-broadcast.mjs
 */
import { Vector3 } from 'three'
import { FEEDS, LOOKS, APOLLO11_LIFTOFF_GET, cameraSource, eventCaption, formatCount, formatGet, formatMet, missionClock, roundTrip, signalLost, LIGHT_SPEED } from '../src/sim/broadcast.js'
import { SCRIPT, lineSeconds, radio, radioTick, resetRadio } from '../src/sim/radio.js'
import { PHASE_IDS, mission } from '../src/sim/mission.js'
import { live } from '../src/sim/live.js'
import { INDEX } from '../src/sim/system.js'
import { BODIES } from '../src/sim/constants.js'
import { ALL_SITES } from '../src/sim/launchsite.js'
import { LOOK_PROFILES, FilmLookEffect } from '../src/gfx/filmLook.js'
import { SOUND_SPEED, REFERENCE_RANGE, listen, listenerState } from '../src/sfx/listener.js'
import { hearing } from '../src/sfx/engine.js'
import { flight, frame, loadSnapshot, LUNAR_ORBIT_FIXTURE, WARP } from './flight.mjs'
import { allocatesNothing, bytesPerCall, knownAllocation, sampleText, seesAllocation, SMALLEST_OBJECT } from './allocation.mjs'

const checks = []
const check = (label, ok) => checks.push([label, Boolean(ok)])

/* ------------------------------------------------------------------ *
 * 1. the pictures: which views were cameras
 * ------------------------------------------------------------------ */
const FOCI = ['free', 'fly', 'sun', 'earth', 'moon', 'ship', 'chase', 'ground', 'pad', 'iss', 'hubble', 'node', 'cinematic', 'intro']
let every = true
let camerasApollo8 = new Set()
const sites = { apollo8: ALL_SITES.ksc, apollo11: ALL_SITES.tranquility, artemis: ALL_SITES.ksc }
for (const [id, feed] of Object.entries(FEEDS)) {
  for (const focus of FOCI) {
    for (const phase of PHASE_IDS) {
      const src = cameraSource(focus, phase, feed, sites[id])
      if (focus === 'cinematic' || focus === 'intro') {
        if (src !== null) every = false
        continue
      }
      if (!src || typeof src.label !== 'string' || !src.label.length || !LOOKS.includes(src.look)) every = false
      if (id === 'apollo8' && src?.camera) camerasApollo8.add(`${focus}`)
    }
  }
}
const a8chaseInSpace = cameraSource('chase', 'TLI_BURN', FEEDS.apollo8, sites.apollo8)
const overShoulder = cameraSource('chase', 'LM_DOCKING', FEEDS.apollo11, sites.apollo11)
const eagleAscent = cameraSource('chase', 'LUNAR_ASCENT', FEEDS.apollo11, sites.apollo11)
const surfaceTv = cameraSource('ground', 'LUNAR_PRE_LAUNCH', FEEDS.apollo11, sites.apollo11)
const orionWing = cameraSource('chase', 'HALO_CAPTURE', FEEDS.artemis, sites.artemis)
console.log('=== the pictures ===')
console.log(`  Apollo 8 views that are cameras   ${[...camerasApollo8].join(', ')}`)
console.log(`  Apollo 8 on the hull at TLI       ${a8chaseInSpace.label} (${a8chaseInSpace.look})`)
console.log(`  Eagle docking, over its shoulder  ${overShoulder.label} (${overShoulder.look})`)
console.log(`  Eagle climbing                    ${eagleAscent.label} (${eagleAscent.look})`)
console.log(`  Tranquility Base, ground          ${surfaceTv.label} (${surfaceTv.look})`)
console.log(`  Orion on the hull                 ${orionWing.label} (${orionWing.look})`)
check('every view in every phase of every mission is captioned, and the film and intro are not', every)
check('only the ground and pad cameras are cameras on Apollo 8', [...camerasApollo8].sort().join() === 'ground,pad')
check('a view of Apollo 8 from outside it is captioned SIMULATION, as the networks did', !a8chaseInSpace.camera && /simulation/i.test(a8chaseInSpace.label))
check("and seen over Eagle's shoulder, where no camera was, is a simulation", !overShoulder.camera)
check("and its ascent, which nobody filmed from outside, is a simulation", !eagleAscent.camera)
check('the lunar surface camera is television', surfaceTv.camera && surfaceTv.look === 'tv')
check("Orion's hull view is the wing camera it carries, in HD", orionWing.camera && orionWing.look === 'hd')

/* ------------------------------------------------------------------ *
 * 2. the clock
 * ------------------------------------------------------------------ */
console.log('\n=== the clock ===')
const g0 = formatGet(0)
const gLift = formatGet(APOLLO11_LIFTOFF_GET)
const met = formatMet(3 * 86400 + 6 * 3600 + 12 * 60 + 34)
const count = formatCount(45.2)
const eagleAtLiftoff = missionClock(0, FEEDS.apollo11).main
console.log(`  GET at zero ${g0}, at Eagle's liftoff ${gLift}; MET ${met}; count ${count}; Eagle's clock at liftoff ${eagleAtLiftoff}`)
check('GET reads hhh:mm:ss from zero', g0 === '000:00:00')
check("Eagle's liftoff reads the GET it happened at, 124:22:00", gLift === '124:22:00' && eagleAtLiftoff === 'GET 124:22:00')
check('MET reads d/hh:mm:ss', met === '3/06:12:34')
check('the count rounds up, so it reads T-1 until it reads zero', count === 'T–00:00:46' && formatCount(0.2) === 'T–00:00:01')

/* ------------------------------------------------------------------ *
 * 3. lower thirds
 * ------------------------------------------------------------------ */
let captionsOk = true
let captioned = 0
for (const id of PHASE_IDS) {
  try {
    const c = eventCaption(id)
    if (c) {
      captioned++
      if (!c.title || typeof c.title !== 'string') captionsOk = false
    }
  } catch (e) {
    captionsOk = false
    console.log(`  caption for ${id} threw: ${e.message}`)
  }
}
console.log(`\n=== lower thirds ===\n  ${captioned} of ${PHASE_IDS.length} phases carry one`)
check('every lower third evaluates, with a title', captionsOk && captioned > 20)

/* ------------------------------------------------------------------ *
 * 4. the far side
 * ------------------------------------------------------------------ */
const s = live.sim.state
const o = INDEX.ship * 6
const e = INDEX.earth * 6
const m = INDEX.moon * 6
const R = BODIES.moon.radius
function placeShip(x, y, z) {
  s[o] = x
  s[o + 1] = y
  s[o + 2] = z
}
// A synthetic geometry first: Earth at the origin, the Moon on +x.
const saved = Float64Array.from(s)
s.fill(0)
s[m] = 384_400e3
placeShip(384_400e3 + 3e6, 0, 0)
const behind = signalLost()
placeShip(384_400e3 - 3e6, 0, 0)
const nearSide = signalLost()
placeShip(384_400e3 + 3e6, R * 1.02, 0)
const pastLimb = signalLost()
placeShip(384_400e3 + 3e6, R * 0.98, 0)
const insideLimb = signalLost()
placeShip(384_400e3 - 1e6, 0, 0)
const trip = roundTrip()
s.set(saved)
console.log('\n=== the far side ===')
console.log(`  behind ${behind}, near side ${nearSide}, 2% past the limb ${pastLimb}, 2% inside it ${insideLimb}`)
console.log(`  round trip from 383,400 km  ${trip.toFixed(4)} s (2r/c = ${((2 * 383_400e3) / LIGHT_SPEED).toFixed(4)})`)
check('the signal is lost behind the Moon and nowhere else', behind && !nearSide && !pastLimb && insideLimb)
check('the round trip is 2r/c', Math.abs(trip - (2 * 383_400e3) / LIGHT_SPEED) < 1e-9)

/*
 * And on a flown orbit: the fraction of each revolution spent behind the Moon,
 * against the geometry. For a circular orbit of radius r with the Earth at
 * elevation b above its plane, the vehicle is hidden while it is within the
 * Moon's shadow cylinder on the far side:
 *
 *   fraction = acos( sqrt(1 - R^2/r^2) / cos b ) / pi
 *
 * Measured on the fixture's orbit and compared with that fraction at the mean
 * radius and mean elevation over the same revolutions.
 */
loadSnapshot(LUNAR_ORBIT_FIXTURE)
flight.warp = WARP.m1
flight.pilotWarp = WARP.m1
let hidden = 0
let samples = 0
let radius = 0
let elevation = 0
let independentAgrees = 0
for (let i = 0; i < 16_000 && samples < 4 * 7200; i++) {
  frame(1 / 60)
  const rx = s[o] - s[m]
  const ry = s[o + 1] - s[m + 1]
  const rz = s[o + 2] - s[m + 2]
  const r = Math.hypot(rx, ry, rz)
  // The Earth's elevation above the orbit plane: angle between the Earth
  // direction and the plane whose normal is r × v.
  const vx = s[o + 3] - s[m + 3]
  const vy = s[o + 4] - s[m + 4]
  const vz = s[o + 5] - s[m + 5]
  const nx = ry * vz - rz * vy
  const ny = rz * vx - rx * vz
  const nz = rx * vy - ry * vx
  const nn = Math.hypot(nx, ny, nz)
  const ex = s[e] - s[m]
  const ey = s[e + 1] - s[m + 1]
  const ez = s[e + 2] - s[m + 2]
  const en = Math.hypot(ex, ey, ez)
  elevation += Math.asin(Math.abs(nx * ex + ny * ey + nz * ez) / (nn * en))
  radius += r
  const lost = signalLost()
  if (lost) hidden++
  // Independently: the Moon's limb against the Earth's direction, seen from the ship.
  const sx = s[e] - s[o]
  const sy = s[e + 1] - s[o + 1]
  const sz = s[e + 2] - s[o + 2]
  const mx = s[m] - s[o]
  const my = s[m + 1] - s[o + 1]
  const mz = s[m + 2] - s[o + 2]
  const dm = Math.hypot(mx, my, mz)
  const angle = Math.acos((sx * mx + sy * my + sz * mz) / (Math.hypot(sx, sy, sz) * dm))
  const covered = angle < Math.asin(R / dm)
  if (covered === lost) independentAgrees++
  samples++
}
const meanR = radius / samples
const meanB = elevation / samples
const measured = hidden / samples
const predicted = Math.acos(Math.min(1, Math.sqrt(1 - (R * R) / (meanR * meanR)) / Math.cos(meanB))) / Math.PI
console.log(`  flown: ${samples} s of lunar orbit at ${((meanR - R) / 1e3).toFixed(1)} km mean altitude, Earth ${((meanB * 180) / Math.PI).toFixed(1)}° off the plane`)
console.log(`  hidden ${(measured * 100).toFixed(1)}% of the time; the geometry says ${(predicted * 100).toFixed(1)}%`)
console.log(`  the limb test agrees on ${independentAgrees} of ${samples} samples`)
check('on a flown orbit the signal is lost for the fraction the geometry predicts, to 2%', Math.abs(measured - predicted) < 0.02)
check('and agrees sample for sample with the limb seen from the vehicle', independentAgrees >= samples - 2)

/* ------------------------------------------------------------------ *
 * 5. the loop
 * ------------------------------------------------------------------ */
const WHO = new Set(['ground', 'crew', 'partner', 'pao'])
let scriptOk = true
for (const entry of SCRIPT) {
  if (entry.phase !== undefined && !PHASE_IDS.includes(entry.phase)) scriptOk = false
  if (entry.T !== undefined && !(entry.T >= -60 && entry.T <= 0)) scriptOk = false
  for (const [who, text] of entry.lines) {
    if (!WHO.has(who)) scriptOk = false
    const said = typeof text === 'function' ? text() : text
    if (typeof said !== 'string' || said.length < 2) scriptOk = false
  }
}
check('every scripted line names a real phase or a point in the count, a real speaker, and says something', scriptOk)

// The count, played against a mission clock running at real time.
const PRE = PHASE_IDS.indexOf('PRE_LAUNCH')
const LIFT = PHASE_IDS.indexOf('LIFTOFF')
resetRadio()
const started = []
radio.onTransmit = (kind, tx) => {
  if (kind === 'start') started.push({ at: mission.t, tx })
}
mission.running = true
for (let k = 0; k <= 650; k++) {
  const t = -60 + k * 0.1
  mission.index = t < 0 ? PRE : LIFT
  mission.t = t
  mission.phaseT = t < 0 ? t + 60 : t
  radioTick(100 + k * 0.1, 1)
}
const calls = started.filter((x) => x.tx.urgent)
const worst = calls.reduce((w, x) => Math.max(w, Math.abs(x.at - Math.round(x.at))), 0)
const tenToFour = ['Ten,', 'Nine,', 'Eight,', 'Seven,', 'Six,', 'Five,', 'Four,'].every((n) => calls.some((x) => x.tx.text === n))
const liftoffLine = started.find((x) => /liftoff of/i.test(x.tx.text))
console.log('\n=== the loop ===')
console.log(`  the count: ${calls.length} call-outs, the worst ${worst.toFixed(2)} s off its second; liftoff called at T+${liftoffLine?.at.toFixed(1)}`)
check('every count call-out is read within 0.15 s of its second, ten to four all present', worst <= 0.15 && tenToFour)
check('the liftoff is called within a second of the phase asking for it', liftoffLine && liftoffLine.at < 2.6)

// A reply from the Moon waits for light.
resetRadio()
started.length = 0
const saved2 = Float64Array.from(s)
s.fill(0)
s[m] = 384_400e3
placeShip(384_400e3 - 2e6, 0, 0)
const rtlt = roundTrip()
const ORBIT = PHASE_IDS.indexOf('LUNAR_ORBIT')
mission.index = ORBIT
mission.t = 300_000
mission.phaseT = 0
radio.queue.push({ who: 'ground', text: 'Apollo 8, Houston. Over.', speaker: 'Houston', reply: false, deadline: Infinity, urgent: false })
radio.queue.push({ who: 'crew', text: 'Go ahead, Houston.', speaker: 'Apollo 8', reply: true, deadline: Infinity, urgent: false })
let endOfQuestion = null
radio.onTransmit = (kind, tx) => {
  if (kind === 'start') started.push({ at: now, tx })
  if (kind === 'end' && tx.who === 'ground') endOfQuestion = now
}
let now = 500
for (let k = 0; k < 200; k++) {
  now = 500 + k * 0.05
  radioTick(now, 1)
}
const answer = started.find((x) => x.tx.who === 'crew')
const pause = answer && endOfQuestion !== null ? answer.at - endOfQuestion : NaN
console.log(`  a reply from ${((384_400e3 - 2e6) / 1e3).toFixed(0)} km: ${pause.toFixed(2)} s after the question, against a round trip of ${rtlt.toFixed(2)} s`)
check('the reply waits a round trip of light, to a tick', pause >= rtlt - 1e-9 && pause < rtlt + 0.06)

// Behind the Moon: the loop holds, the narration does not, and the queue plays at AOS.
resetRadio()
started.length = 0
radio.onTransmit = (kind, tx) => {
  if (kind === 'start') started.push({ at: now, tx, lost: signalLost() })
}
placeShip(384_400e3 + 2e6, 0, 0)
radio.queue.push({ who: 'ground', text: 'Apollo 8, Houston.', speaker: 'Houston', reply: false, deadline: Infinity, urgent: false })
for (let k = 0; k < 100; k++) {
  now = 600 + k * 0.1
  radioTick(now, 1)
}
const heardBehind = started.filter((x) => x.lost && x.tx.who !== 'pao').length
const announcedLos = started.some((x) => /loss of signal/i.test(x.tx.text))
placeShip(384_400e3 - 2e6, 0, 0)
for (let k = 0; k < 150; k++) {
  now = 700 + k * 0.1
  radioTick(now, 1)
}
const heardAfter = started.some((x) => x.tx.who === 'ground' && !x.lost)
const announcedAos = started.some((x) => /acquisition of signal/i.test(x.tx.text))
s.set(saved2)
console.log(`  behind the Moon: ${heardBehind} transmissions got through; LOS announced ${announcedLos}, AOS ${announcedAos}, held call played after ${heardAfter}`)
check('nothing on the air-to-ground loop gets through from behind the Moon', heardBehind === 0 && announcedLos)
check('and what was held plays out at acquisition of signal', heardAfter && announcedAos)

// A coast crossed at speed says nothing about it.
resetRadio()
started.length = 0
mission.index = PHASE_IDS.indexOf('TLI_ALIGN')
mission.phaseT = 0
for (let k = 0; k < 100; k++) {
  mission.phaseT = k * 60
  radioTick(800 + k * 0.1, 3600)
}
check('a phase crossed at an hour a second is not read out in a burst', started.length === 0)
radio.onTransmit = null

/* ------------------------------------------------------------------ *
 * 6. the picture's medium
 * ------------------------------------------------------------------ */
const KEYS = Object.keys(LOOK_PROFILES.film)
let profilesOk = LOOKS.every((l) => LOOK_PROFILES[l])
for (const [name, p] of Object.entries(LOOK_PROFILES)) {
  for (const k of KEYS) {
    const v = p[k]
    if (Array.isArray(v) ? v.length !== 3 || !v.every(Number.isFinite) : !Number.isFinite(v)) profilesOk = false
  }
  if (name === 'clean' && p.amount !== 0) profilesOk = false
}
let effectOk = true
try {
  const fx = new FilmLookEffect()
  for (const l of LOOKS) fx.setLook(l, 2)
  fx.setLook('nonsense')
  effectOk = fx.look === 'clean' && fx.uniforms.get('amount').value === 0
} catch (err) {
  effectOk = false
  console.log(`  the effect threw: ${err.message}`)
}
check('every look is complete and finite, and an unknown one falls back to a clean picture', profilesOk && effectOk)

/* ------------------------------------------------------------------ *
 * 7. the sound of a launch from the ground
 * ------------------------------------------------------------------ */
const cam = new Vector3(0, 0, 0)
live.pos.ship.set(REFERENCE_RANGE, 0, 0)
listenerState.fill(0)
listenerState[2] = 1 / 60
listen(cam, 'ground', false)
const standing = hearing[0]
const standingLevel = hearing[1]
// Recede at 100 m/s for half a minute from a kilometre out: 4 km at the end,
// a delay well inside what the line holds.
const V = 100
const FRAMES = 1800
live.pos.ship.set(1000, 0, 0)
listenerState.fill(0)
listenerState[2] = 1 / 60
const delays = []
for (let k = 0; k < FRAMES; k++) {
  live.pos.ship.x += V / 60
  listen(cam, 'ground', false)
  delays.push(hearing[0])
}
const r = live.pos.ship.x
const retarded = r / (SOUND_SPEED + V)
const rate = (delays[FRAMES - 1] - delays[FRAMES - 61]) / 1
const pitch = 1 - rate
listen(cam, 'chase', false)
const riding = hearing[0] === 0 && hearing[1] === 1
listen(cam, 'ground', true)
const moon = hearing[0] === 0 && hearing[1] === 1
console.log('\n=== sound from the pad ===')
console.log(`  at ${REFERENCE_RANGE} m, standing: ${standing.toFixed(3)} s late (r/c = ${(REFERENCE_RANGE / SOUND_SPEED).toFixed(3)}), level ${standingLevel.toFixed(2)}`)
console.log(`  receding at ${V} m/s from ${(r / 1e3).toFixed(2)} km: ${hearing[0] === 0 ? '' : ''}delay ${delays[FRAMES - 1].toFixed(3)} s (r/(c+v) = ${retarded.toFixed(3)}), heard at ${pitch.toFixed(4)} of pitch (c/(c+v) = ${(SOUND_SPEED / (SOUND_SPEED + V)).toFixed(4)})`)
check('the sound from a vehicle on the pad arrives r/c late, at full level', Math.abs(standing - REFERENCE_RANGE / SOUND_SPEED) < 1e-9 && standingLevel === 1)
check('from a receding vehicle it arrives at the retarded delay, to 0.1%', Math.abs(delays[FRAMES - 1] - retarded) / retarded < 1e-3)
check('which lowers its pitch to c/(c+v), the Doppler shift of a receding source, to 0.5%', Math.abs(pitch - SOUND_SPEED / (SOUND_SPEED + V)) < 0.005)
check('a view riding the vehicle, and the Moon, hear it as before', riding && moon)

/* ------------------------------------------------------------------ *
 * 8. allocation
 * ------------------------------------------------------------------ */
const control = await knownAllocation()
loadSnapshot(LUNAR_ORBIT_FIXTURE)
const lostBytes = await bytesPerCall(() => {
  signalLost()
}, { calls: 20000, warm: 20000 })
listenerState[2] = 1 / 60
let wobble = 0
const listenBytes = await bytesPerCall(() => {
  live.pos.ship.x = REFERENCE_RANGE + (wobble++ & 1023)
  listen(cam, 'ground', false)
}, { calls: 20000, warm: 20000 })
console.log('\n=== allocation ===')
console.log(`  signalLost   ${sampleText(lostBytes)}`)
console.log(`  listen       ${sampleText(listenBytes)}`)
console.log(`  control      ${sampleText(control)}`)
checks.push(seesAllocation('the allocation measurement can see an allocation', control))
checks.push(allocatesNothing('the far-side test allocates nothing', lostBytes, SMALLEST_OBJECT / 2))
checks.push(allocatesNothing('nor does the listener the frame loop runs', listenBytes, SMALLEST_OBJECT / 2))

/* ------------------------------------------------------------------ *
 * verdict
 * ------------------------------------------------------------------ */
console.log('\n=== what this establishes ===')
let pass = true
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) pass = false
}
console.log(`\n  ${pass ? 'PASS' : 'FAIL'}`)
process.exit(pass ? 0 : 1)
