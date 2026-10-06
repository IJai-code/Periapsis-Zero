import { useEffect, useMemo, useRef } from 'react'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadPilot } from './models.js'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { STATIONS } from '../core/world.js'
import { BERTH, berthQuat } from '../core/game.js'
import { suitById } from '../core/pilot.js'
import { play } from '../audio.js'

/**
 * Boarding: the pilot walks the glass skywalk outside the station, the
 * stars and the station's hull beyond the glass, comes into the bay, and a
 * boarding bridge reaches out from the end of the skywalk to the cockpit.
 * They cross, climb in, the bridge draws back and the engines come alive.
 * Played when a new pilot starts and whenever they change suits.
 *
 * Positions are in the bay's frame: the ship at the origin, nose to -z out
 * of the door, deck at -keel. The skywalk (art/game-hangar) is in the
 * hangar model's own frame, which sits 6 - keel higher.
 */
// Walking pace, not running: about 2 m/s between cuts, easing in and out of each stretch.
export const BOARD_T = { outside: 4.6, inside: 4.4, bridge: 1.3, cross: 5.0, climb: 1.5, settle: 1.9 }
export const BOARD_DUR = Object.values(BOARD_T).reduce((a, b) => a + b, 0)
/** When the pilot is in the seat, s from the start. */
export const BOARD_SEATED = BOARD_T.outside + BOARD_T.inside + BOARD_T.bridge + BOARD_T.cross + BOARD_T.climb
/** Where each hull's seat is, in its own frame (art/lib/craft.py `pilot_seat`), and how far its keel hangs below its centre. */
export const COCKPIT = { kestrel: [0, 1.1, -4.7], lance: [0, 0.72, -3.0], mule: [0, 2.6, -13.2] }
export const KEEL = { kestrel: 2.9, mule: 3.0, lance: 1.2 }
const SKY = { z: -4.25, floor: -2.6, out0: 50, out1: 41.5, in0: 21, in1: 12.8, end: 12 }

const ease = (x) => { const f = Math.min(1, Math.max(0, x)); return f * f * (3 - 2 * f) }
/** A walk's distance over time: speeding up for the first fifth, steady, slowing for the last fifth. */
const stroll = (x) => { const f = Math.min(1, Math.max(0, x)), r = 0.2, v = 1 / (1 - r); return f < r ? v * f * f / (2 * r) : f > 1 - r ? 1 - v * (1 - f) ** 2 / (2 * r) : v * (f - r / 2) }
const _s = new THREE.Vector3(), _e = new THREE.Vector3()

/** The skywalk's end and the bridge's far end, in the bay's frame. */
export function bridgeEnds(hull, start, end) {
  const [cx, cy, cz] = COCKPIT[hull] ?? COCKPIT.kestrel
  const lift = 6 - (KEEL[hull] ?? 2.9)
  start.set(SKY.end, SKY.floor + lift, SKY.z)
  end.set(cx + (hull === 'mule' ? 2.2 : 1.5), cy - 0.25, cz)
  return [start, end]
}

/** The pilot's place, heading, gait and phase at time t, in the bay's frame. */
export function boardPose(hull, t, out) {
  const T = BOARD_T
  const [cx, cy, cz] = COCKPIT[hull] ?? COCKPIT.kestrel
  const floor = SKY.floor + 6 - (KEEL[hull] ?? 2.9)
  bridgeEnds(hull, _s, _e)
  out.hidden = false
  out.stride = 0
  out.walk = 0
  out.bridge = 0
  let k = t
  const walk = (a, b, dur, kk, steps) => {
    const s = stroll(kk / dur)
    out.pos.lerpVectors(a, b, s)
    out.heading = Math.atan2(b.x - a.x, b.z - a.z)
    out.walk = (kk / dur) * steps * Math.PI
    out.stride = Math.sin(Math.PI * Math.min(1, kk / dur)) ** 0.4
  }
  if (k < T.outside) { out.phase = 'outside'; walk(_v1.set(SKY.out0, floor, SKY.z), _v2.set(SKY.out1, floor, SKY.z), T.outside, k, 13); return out }
  k -= T.outside
  if (k < T.inside) { out.phase = 'inside'; walk(_v1.set(SKY.in0, floor, SKY.z), _v2.set(SKY.in1, floor, SKY.z), T.inside, k, 9); return out }
  k -= T.inside
  if (k < T.bridge) { out.phase = 'bridge'; out.pos.set(SKY.in1, floor, SKY.z); out.heading = Math.atan2(_e.x - _s.x, _e.z - _s.z) * ease(k / T.bridge) + (-Math.PI / 2) * (1 - ease(k / T.bridge)); out.bridge = ease(k / T.bridge); return out }
  k -= T.bridge
  out.bridge = 1
  if (k < T.cross) { out.phase = 'cross'; walk(_v1.set(SKY.in1, floor, SKY.z), _e, T.cross, k, 7); return out }
  k -= T.cross
  if (k < T.climb) {
    // Over the sill and down into the seat.
    out.phase = 'climb'
    const s = ease(k / T.climb)
    out.pos.set(_e.x + (cx - _e.x) * s, _e.y + (cy - 1.0 - _e.y) * s + Math.sin(Math.PI * s) * 0.7, _e.z + (cz - _e.z) * s)
    out.heading = Math.PI
    return out
  }
  k -= T.climb
  out.phase = 'settle'
  out.pos.set(cx, cy - 1.0, cz)
  out.hidden = true
  out.bridge = 1 - ease(k / (T.settle * 0.7))
  return out
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3()

/** The walking pilot and the boarding bridge, drawn while a boarding plays. */
export function Boarding({ game }) {
  const root = useRef()
  const { figure, parts, bridge, shadow } = useMemo(() => makeFigure(), [])
  const pose = useMemo(() => ({ pos: new THREE.Vector3() }), [])
  const ends = useMemo(() => [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], [])
  const state = useRef({ suit: null, cued: {}, last: new THREE.Vector3(), speed: 0, rig: null })
  // The rigged, animated pilot replaces the stand-in once it has loaded.
  useEffect(() => {
    let live = true
    loadPilot((p) => {
      if (!live || !p.scene) return
      const body = cloneSkinned(p.scene)
      const mixer = new THREE.AnimationMixer(body)
      const act = Object.fromEntries(p.clips.map((c) => [c.name, mixer.clipAction(c)]))
      for (const a of Object.values(act)) { a.play(); a.setEffectiveWeight(0) }
      act.sit?.setLoop(THREE.LoopOnce, 1)
      if (act.sit) act.sit.clampWhenFinished = true
      const mats = {}
      body.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.material = o.material.clone(); mats[o.material.name] = o.material } })
      state.current.rig = { body, mixer, act, mats }
      state.current.suit = null
      parts.body.visible = parts.legL.visible = parts.legR.visible = false
      figure.add(body)
    })
    return () => { live = false }
  }, [figure, parts])
  useFrame((_, dt) => {
    const g = game.current, r = root.current
    if (!g || !r) return
    const c = g.cine
    if (!c || c.kind !== 'board' || g.mode !== 'docked') { r.visible = false; return }
    r.visible = true
    const st = STATIONS[g.docked]
    r.position.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
    berthQuat(g, st, r.quaternion)
    const S = state.current, rig = S.rig
    if (S.suit !== g.pilot.suit) { S.suit = g.pilot.suit; dress(parts, suitById(g.pilot.suit), rig?.mats) }
    boardPose(g.ship.hull, c.t, pose)
    // Speed over the ground, smoothed: it sets the stride, so the feet do not slide.
    const v = dt > 0 ? pose.pos.distanceTo(S.last) / dt : 0
    S.last.copy(pose.pos)
    S.speed += (Math.min(4, v) - S.speed) * Math.min(1, dt * 8)
    figure.visible = !pose.hidden
    figure.position.copy(pose.pos)
    // Turn toward the heading at a walker's rate, not instantly.
    let dh = pose.heading - figure.rotation.y
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    figure.rotation.set(0, figure.rotation.y + dh * Math.min(1, dt * 7), 0)
    shadow.position.set(pose.pos.x, pose.pos.y + 0.02, pose.pos.z)
    shadow.visible = !pose.hidden && pose.phase !== 'climb'
    if (rig) {
      const seated = pose.phase === 'climb' || pose.phase === 'settle'
      const walking = seated ? 0 : Math.min(1, S.speed / 0.5)
      if (seated && !S.sat) { S.sat = true; rig.act.sit?.reset().play() }
      if (!seated) S.sat = false
      rig.act.walk?.setEffectiveWeight(walking).setEffectiveTimeScale(Math.max(0.4, S.speed / 1.5))
      rig.act.idle?.setEffectiveWeight(seated ? 0 : 1 - walking)
      rig.act.sit?.setEffectiveWeight(seated ? Math.min(1, (rig.act.sit.time ?? 0) * 3 + 0.2) : 0)
      rig.mixer.update(Math.min(dt, 0.05))
    } else {
      const sw = Math.sin(pose.walk) * 0.55 * pose.stride
      parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw
      parts.armL.rotation.x = -sw * 0.8; parts.armR.rotation.x = sw * 0.8
    }
    // The bridge: out from the skywalk's end toward the cockpit, as far as it has extended.
    const [s, e, d] = bridgeEnds(g.ship.hull, ends[0], ends[1]).concat(ends[2])
    d.copy(e).sub(s)
    const len = d.length()
    bridge.visible = pose.bridge > 0.001
    bridge.position.copy(s)
    bridge.quaternion.setFromUnitVectors(_x, d.normalize())
    bridge.scale.set(Math.max(0.001, len * pose.bridge), 1, 1)
    const cue = (at, fn) => { if (c.t >= at && !S.cued[at]) { S.cued[at] = true; fn() } }
    const T = BOARD_T
    if (c.t < 0.05) S.cued = {}
    cue(T.outside + T.inside, () => play('dock-start'))
    cue(BOARD_SEATED - 0.15, () => play('dock'))
    cue(BOARD_SEATED + 0.5, () => play('launch'))
  })
  return <group ref={root} visible={false}>
    <primitive object={figure} />
    <primitive object={shadow} />
    <primitive object={bridge} />
  </group>
}
const _x = new THREE.Vector3(1, 0, 0)

/** A suited figure from simple solids, about 1.85 m, pivoting at hips and shoulders; and the bridge, a unit long along x. */
function makeFigure() {
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, ...o })
  const suit = mat('#f4e8cf'), stripe = mat('#ff6b2c'), visor = mat('#ffb070', { metalness: 0.8, roughness: 0.06, emissive: '#ffb070', emissiveIntensity: 0.35 }), dark = mat('#2b2a33', { metalness: 0.6, roughness: 0.4 })
  const figure = new THREE.Group()
  const body = new THREE.Group(); body.position.y = 1.0; figure.add(body)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 6, 14), suit); torso.position.y = 0.2; body.add(torso)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.2), dark); pack.position.set(0, 0.28, -0.24); body.add(pack)
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: '#2fd3ff', toneMapped: false })); lamp.position.set(0, 0.48, -0.35); body.add(lamp)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 20), stripe); band.rotation.x = Math.PI / 2; band.position.y = 0.05; body.add(band)
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 20), dark); collar.rotation.x = Math.PI / 2; collar.position.y = 0.48; body.add(collar)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), suit); head.position.y = 0.68; body.add(head)
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.175, 24, 16, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.42), visor)
  face.position.set(0, 0.68, 0.05); body.add(face)
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.3), stripe); crest.position.set(0, 0.88, 0); body.add(crest)
  const limb = (r, len, m) => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m); c.position.y = -len / 2 - r; g.add(c); return g }
  const legL = limb(0.1, 0.62, suit), legR = limb(0.1, 0.62, suit)
  legL.position.set(-0.12, 1.0, 0); legR.position.set(0.12, 1.0, 0)
  for (const l of [legL, legR]) { const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.28), dark); boot.position.set(0, -0.92, 0.04); l.add(boot) }
  const armL = limb(0.075, 0.48, suit), armR = limb(0.075, 0.48, suit)
  armL.position.set(-0.32, 0.42, 0); armR.position.set(0.32, 0.42, 0)
  body.add(armL, armR)
  figure.add(legL, legR)
  // The bridge: a deck with rails and a lit edge, one metre long along +x (scaled to its length).
  const bridge = new THREE.Group()
  const bdark = mat('#25262d', { metalness: 0.7, roughness: 0.35 }), bgold = mat('#c9973c', { metalness: 0.6, roughness: 0.4 })
  const glow = new THREE.MeshBasicMaterial({ color: '#2fd3ff', toneMapped: false })
  const piece = (w, h, d, m, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(1, h, d), m); b.geometry.translate(0.5, 0, 0); b.position.set(0, y, z); b.scale.x = w; return b }
  bridge.add(piece(1, 0.12, 1.4, bdark, -0.06, 0))
  for (const s of [-1, 1]) { bridge.add(piece(1, 0.05, 0.06, glow, 0.02, s * 0.66)); bridge.add(piece(1, 0.06, 0.06, bgold, 1.0, s * 0.68)) }
  bridge.visible = false
  // A soft contact shadow under the feet: the figure stands on the deck instead of floating over it.
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  return { figure, bridge, shadow, parts: { body, legL, legR, armL, armR, suit, stripe, visor } }
}

function dress(parts, s, mats) {
  // A shade under the swatch: in full sunlight a pure white suit blooms into a blur.
  if (mats?.suit) mats.suit.color.set(s.suit).multiplyScalar(0.72)
  if (mats?.stripe) mats.stripe.color.set(s.stripe)
  if (mats?.visor) { mats.visor.color.set(s.visor); mats.visor.emissive?.set(s.visor).multiplyScalar(0.35) }
  parts.suit.color.set(s.suit).multiplyScalar(0.72)
  parts.stripe.color.set(s.stripe)
  parts.visor.color.set(s.visor)
  parts.visor.emissive.set(s.visor).multiplyScalar(0.5)
}
