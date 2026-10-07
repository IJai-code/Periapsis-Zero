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
import { BOARD_T, BOARD_DUR, BOARD_SEATED, COCKPIT, KEEL, boardPose, bridgeEnds } from '../core/boarding.js'
export { BOARD_T, BOARD_DUR, BOARD_SEATED, COCKPIT, KEEL, boardPose, bridgeEnds } from '../core/boarding.js'
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
      body.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.material = o.material.clone(); mats[o.material.name] = o.material } })
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
    // Ignore the deliberate camera cut between outside and inside, rather
    // than interpreting it as a 20-metre running stride.
    const cut = S.phase !== pose.phase
    if (cut) S.last.copy(pose.pos)
    S.phase = pose.phase
    const frame = Math.max(0, Math.min(0.1, c.t - (S.time ?? c.t)))
    S.time = c.t
    const v = frame > 0 ? pose.pos.distanceTo(S.last) / frame : 0
    S.last.copy(pose.pos)
    S.speed += (Math.min(4, v) - S.speed) * Math.min(1, frame * 8)
    figure.visible = !pose.hidden
    figure.position.copy(pose.pos)
    // Turn toward the heading at a walker's rate, not instantly.
    let dh = pose.heading - figure.rotation.y
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    figure.rotation.set(0, figure.rotation.y + dh * Math.min(1, frame * 7), 0)
    shadow.position.set(pose.pos.x, pose.pos.y + 0.02, pose.pos.z)
    shadow.visible = !pose.hidden && pose.phase !== 'climb'
    if (rig) {
      const seated = pose.phase === 'climb' || pose.phase === 'settle'
      const walking = seated ? 0 : Math.min(1, S.speed / 0.5)
      if (seated && !S.sat) { S.sat = true; rig.act.sit?.reset().play() }
      if (!seated) S.sat = false
      rig.act.walk?.setEffectiveWeight(walking).setEffectiveTimeScale(Math.max(0.4, S.speed / 1.5))
      rig.act.idle?.setEffectiveWeight(seated ? 0 : 1 - walking)
      rig.act.sit?.setEffectiveWeight(seated ? 1 : 0)
      rig.mixer.update(Math.min(frame, 0.05))
      // Choreography controls the sit clip, so pause and low frame rates
      // cannot leave the actor standing as the root enters the cockpit.
      if (seated && rig.act.sit) { rig.act.sit.time = pose.entry * rig.act.sit.getClip().duration; rig.mixer.update(0) }
    } else {
      const sw = Math.sin(pose.walk) * 0.55 * pose.stride
      parts.legL.rotation.x = sw; parts.legR.rotation.x = -sw
      parts.armL.rotation.x = -sw * 0.8; parts.armR.rotation.x = sw * 0.8
    }
    // The bridge: out from the skywalk's end toward the cockpit, as far as it has extended.
    bridgeEnds(g.ship.hull, ends[0], ends[1])
    const [s, e, d] = ends
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
  for (const s of [-1, 1]) {
    bridge.add(piece(1, 0.025, 0.035, glow, 0.02, s * 0.66)); bridge.add(piece(1, 0.045, 0.045, bgold, 1.0, s * 0.68))
    for (let i = 0; i < 10; i++) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.96, 0.04), bdark); post.position.set((i + 0.5) / 10, 0.48, s * 0.68); bridge.add(post) }
  }
  for (let i = 0; i < 24; i++) { const tread = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.016, 1.15), bgold); tread.position.set((i + 0.5) / 24, 0.014, 0); bridge.add(tread) }
  bridge.traverse((o) => { if (o.isMesh) o.castShadow = true })
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
