import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { STATIONS } from '../core/world.js'
import { BERTH, berthQuat } from '../core/game.js'
import { suitById } from '../core/pilot.js'
import { play } from '../audio.js'

/**
 * Boarding: the pilot walks across the bay in the suit they chose, rides
 * the lift up to the cockpit and climbs in, and the engines come alive.
 * Played when a new pilot starts and whenever they change suits.
 *
 * Everything is in the bay's frame (the ship at the origin, nose to -z out
 * of the door, deck at -keel). `boardPose` is shared with the camera, so
 * the shot always knows where the pilot is.
 */
export const BOARD_T = { walk: 4.2, turn: 0.5, lift: 2.0, climb: 1.3, settle: 1.6 }
export const BOARD_DUR = Object.values(BOARD_T).reduce((a, b) => a + b, 0)
/** Where each hull's seat is, in its own frame (art/lib/craft.py `pilot_seat`), and how far its keel hangs below its centre. */
export const COCKPIT = { kestrel: [0, 1.1, -4.7], lance: [0, 0.72, -3.0], mule: [0, 2.6, -13.2] }
export const KEEL = { kestrel: 2.9, mule: 3.0, lance: 1.2 }

const ease = (x) => { const f = Math.min(1, Math.max(0, x)); return f * f * (3 - 2 * f) }

/** The pilot's place, heading and gait at time t, in the bay's frame. */
export function boardPose(hull, t, out) {
  const [cx, cy, cz] = COCKPIT[hull] ?? COCKPIT.kestrel
  const floor = -(KEEL[hull] ?? 2.9)
  const side = 4.4 + (hull === 'mule' ? 2.6 : 0)
  const T = BOARD_T
  const start = out.start ?? (out.start = new THREE.Vector3())
  start.set(20, floor, 12)
  const beside = out.beside ?? (out.beside = new THREE.Vector3())
  beside.set(side, floor, cz + 0.6)
  out.lift = floor
  out.walk = 0
  out.hidden = false
  let k = t
  if (k < T.walk) {
    const s = ease(k / T.walk)
    out.pos.lerpVectors(start, beside, s)
    out.heading = Math.atan2(beside.x - start.x, beside.z - start.z)
    // The stride: quickest in the middle of the walk, stopping at its ends.
    out.walk = (k / T.walk) * 9.5 * Math.PI
    out.stride = Math.sin(Math.PI * Math.min(1, k / T.walk)) ** 0.5
    return out
  }
  k -= T.walk
  out.stride = 0
  const face = -Math.PI / 2
  if (k < T.turn) {
    out.pos.copy(beside)
    const h0 = Math.atan2(beside.x - start.x, beside.z - start.z)
    out.heading = h0 + (face - h0) * ease(k / T.turn)
    return out
  }
  k -= T.turn
  out.heading = face
  const sill = cy + 0.25
  if (k < T.lift) {
    out.lift = floor + (sill - floor) * ease(k / T.lift)
    out.pos.set(beside.x, out.lift, beside.z)
    return out
  }
  k -= T.lift
  out.lift = sill
  if (k < T.climb) {
    // Over the sill and down into the seat: an arc.
    const s = ease(k / T.climb)
    out.pos.set(beside.x + (cx - beside.x) * s, sill + Math.sin(Math.PI * s) * 0.9 - 0.35 * s, beside.z + (cz - beside.z) * s)
    return out
  }
  out.pos.set(cx, cy, cz)
  out.hidden = true
  return out
}

/** The walking pilot and the lift, drawn while a boarding plays. */
export function Boarding({ game }) {
  const root = useRef()
  const { figure, parts, lift } = useMemo(() => makeFigure(), [])
  const pose = useMemo(() => ({ pos: new THREE.Vector3() }), [])
  const state = useRef({ suit: null, cued: {} })
  useFrame(() => {
    const g = game.current, r = root.current
    if (!g || !r) return
    const c = g.cine
    if (!c || c.kind !== 'board' || g.mode !== 'docked') { r.visible = false; return }
    r.visible = true
    const st = STATIONS[g.docked]
    r.position.copy(st.port.at).addScaledVector(st.port.axis, BERTH)
    berthQuat(g, st, r.quaternion)
    if (state.current.suit !== g.pilot.suit) { state.current.suit = g.pilot.suit; dress(parts, suitById(g.pilot.suit)) }
    boardPose(g.ship.hull, c.t, pose)
    figure.visible = !pose.hidden
    figure.position.copy(pose.pos)
    figure.rotation.set(0, pose.heading, 0)
    // The gait: legs and arms swing opposite, the body rises at each step.
    const sw = Math.sin(pose.walk) * 0.55 * (pose.stride ?? 0)
    parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw
    parts.armL.rotation.x = -sw * 0.8; parts.armR.rotation.x = sw * 0.8
    parts.body.position.y = 1.0 + Math.abs(Math.cos(pose.walk)) * 0.05 * (pose.stride ?? 0)
    lift.position.set(pose.beside?.x ?? 4.4, pose.lift - 0.1, pose.beside?.z ?? -4)
    // Sounds on their cues, once each.
    const cue = (at, fn) => { if (c.t >= at && !state.current.cued[at]) { state.current.cued[at] = true; fn() } }
    const T = BOARD_T
    if (c.t < 0.05) state.current.cued = {}
    cue(T.walk + T.turn, () => play('dock-start'))
    cue(T.walk + T.turn + T.lift + T.climb - 0.2, () => play('dock'))
    cue(T.walk + T.turn + T.lift + T.climb + 0.3, () => play('launch'))
  })
  return <group ref={root} visible={false}>
    <primitive object={figure} />
    <primitive object={lift} />
  </group>
}

/** A suited figure from simple solids, about 1.85 m, pivoting at hips and shoulders. */
function makeFigure() {
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.15, ...o })
  const suit = mat('#f4e8cf'), stripe = mat('#ff6b2c'), visor = mat('#ffb070', { metalness: 0.7, roughness: 0.08, emissive: '#ffb070', emissiveIntensity: 0.3 }), dark = mat('#2b2a33')
  const figure = new THREE.Group()
  const body = new THREE.Group(); body.position.y = 1.0; figure.add(body)
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.42, 6, 12), suit); torso.position.y = 0.2; body.add(torso)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.2), dark); pack.position.set(0, 0.28, -0.24); body.add(pack)
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 20), stripe); band.rotation.x = Math.PI / 2; band.position.y = 0.05; body.add(band)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), suit); head.position.y = 0.66; body.add(head)
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.42), visor)
  face.position.set(0, 0.66, 0.05); body.add(face)
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.3), stripe); crest.position.set(0, 0.86, 0); body.add(crest)
  const limb = (r, len, m) => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m); c.position.y = -len / 2 - r; g.add(c); return g }
  const legL = limb(0.1, 0.62, suit), legR = limb(0.1, 0.62, suit)
  legL.position.set(-0.12, 1.0, 0); legR.position.set(0.12, 1.0, 0)
  const armL = limb(0.075, 0.48, suit), armR = limb(0.075, 0.48, suit)
  armL.position.set(-0.32, 0.42, 0); armR.position.set(0.32, 0.42, 0)
  body.add(armL, armR)
  figure.add(legL, legR)
  // The lift: a disc with a lit rim on a post.
  const lift = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 28), dark); lift.add(disc)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.04, 6, 32), new THREE.MeshBasicMaterial({ color: '#ff6b2c', toneMapped: false })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.07; lift.add(rim)
  return { figure, lift, parts: { body, legL, legR, armL, armR, suit, stripe, visor } }
}

function dress(parts, s) {
  parts.suit.color.set(s.suit)
  parts.stripe.color.set(s.stripe)
  parts.visor.color.set(s.visor)
  parts.visor.emissive.set(s.visor)
}
