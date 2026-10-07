import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { Sky } from './Sky.jsx'
import { instance, onModelsChange, preload } from './models.js'
import { PLACES, SUN_DIR } from '../core/world.js'
import { prologueAt } from '../core/prologue.js'
import { TIERS, filmDegrade, filmPace, noteFilmFrame, tierOf } from '../core/quality.js'

/**
 * A film rendered from the game's own ships and worlds, not a slideshow.
 *
 * The film is the first two minutes of the game for every player, on whatever
 * device they are holding, so it is also the first place the machine's pace
 * is known. It carries the same discipline the game canvas does: a tier that
 * decides what the picture costs, a resolution governor that moves its own
 * pixels when frames run long, and a last rung — bloom and the extra sky
 * detail — spent only when the pixels are already at the floor. Where the
 * film differs from the game is that it draws no shadows at all: its light is
 * the Sun in vacuum, there is nothing behind the ships to cast onto, and a
 * shadow map would be bought at the price of the picture it is not in.
 *
 * Nothing here is a different film at a lower tier. The six shots, the
 * camera moves, the timing and the captions are identical; only the cost of
 * drawing them moves.
 */
export default function PrologueScene({ clock, reduced, tier = 'high', stopped = false }) {
  const game = useRef({ anchor: PLACES.harbor.anchor.clone(), time: 0 })
  const [fast, setFast] = useState(false)
  const cfg = fast ? TIERS.low : tierOf(tier)
  const dbg = useRef({ tier, fast: false, dpr: Math.min(cfg.filmDpr[1], (typeof window !== 'undefined' && window.devicePixelRatio) || 1), pace: 0, frames: 0 })
  dbg.current.tier = tier
  dbg.current.fast = fast
  useEffect(() => {
    // Development only: what the film decided about this machine, for scripts/.
    if (import.meta.env.DEV) window.__pzFilm = dbg.current
  }, [])
  return <Canvas
    frameloop={stopped ? 'never' : 'always'}
    dpr={cfg.filmDpr}
    gl={{ antialias: cfg.antialias, logarithmicDepthBuffer: true, powerPreference: cfg.power, toneMapping: THREE.ACESFilmicToneMapping }}
    camera={{ fov: 42, near: 0.25, far: 4.5e6 }}>
    <ambientLight intensity={0.12} />
    <directionalLight position={SUN_DIR.clone().multiplyScalar(10000)} intensity={3.2} color="#fff4e2" />
    <directionalLight position={[-2000, 4000, -3000]} intensity={0.6} color="#9dc9ff" />
    <Suspense fallback={null}><Sky game={game} quality={fast ? 'low' : tier} /></Suspense>
    <Shots clock={clock} game={game} reduced={reduced} budget={cfg.debris} />
    {/* `spent` is true when there is nothing left to spend: the tier is already
        Fast, or the film has already spent its own last rung. A second spend
        would be a no-op reported as a decision. */}
    <Pace cfg={cfg} spent={cfg === TIERS.low} onSlow={() => setFast(true)} dbg={dbg} />
    {cfg.bloom && <EffectComposer disableNormalPass multisampling={0}><Bloom mipmapBlur intensity={0.35} luminanceThreshold={1.2} /><Vignette darkness={0.45} offset={0.25} /></EffectComposer>}
  </Canvas>
}

/**
 * The film's pace, measured where the frames are: this canvas's own loop.
 *
 * Two jobs. It moves the pixel ratio the way the game's governor does — down
 * a step when frames run long, back up when there is room, checked every
 * 1.5 s and never while nothing is moving. And it feeds the film's frame
 * learner, which is the measurement the whole game inherits: a machine that
 * cannot hold the film at its lowest rung is remembered as one that should
 * begin Fast. Both are numbers on the frame path, nothing allocated.
 */
function Pace({ cfg, spent, onSlow, dbg }) {
  const { setDpr } = useThree()
  const res = useRef(null)
  if (!res.current) {
    const max = Math.min(cfg.filmDpr[1], (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    res.current = { ema: 1 / 60, at: 0, dpr: Math.max(cfg.filmDpr[0], max) }
  }
  useFrame(({ clock: c }, delta) => {
    const r = res.current
    // A frame was drawn. This runs inside the canvas's own loop, so it stops
    // when the loop stops: it is the honest measure of what a paused film costs.
    dbg.current.frames++
    const ms = Math.min(delta, 0.25) * 1000
    r.ema += (Math.min(delta, 0.25) - r.ema) * 0.05
    noteFilmFrame(ms)
    const pace = filmPace()
    if (pace) dbg.current.pace = pace
    if (c.elapsedTime - r.at > 1.5) {
      r.at = c.elapsedTime
      const top = Math.min(cfg.filmDpr[1], window.devicePixelRatio || 1)
      const next = r.ema > 1 / 45 ? Math.max(cfg.filmDpr[0], r.dpr - 0.15) : r.ema < 1 / 57 ? Math.min(top, r.dpr + 0.1) : r.dpr
      if (Math.abs(next - r.dpr) > 0.01) { r.dpr = next; setDpr(next) }
      dbg.current.dpr = r.dpr
      // The last rung, one-way: only from a measured pace, and only once the
      // pixels are already at their floor.
      if (pace && filmDegrade(pace, r.dpr, spent)) onSlow()
    }
  }, -1)
  return null
}

function Shots({ clock, game, reduced, budget }) {
  const root = useRef()
  const [version, setVersion] = useState(0)
  useEffect(() => { preload(['freighter', 'kestrel', 'hearth', 'raider']); return onModelsChange(() => setVersion((n) => n + 1)) }, [])
  const art = useMemo(() => {
    const g = new THREE.Group()
    const ship = instance('kestrel').object, station = instance('hearth').object
    g.add(ship, station)
    const convoy = Array.from({ length: 6 }, () => instance('freighter').object)
    const attackers = Array.from({ length: 2 }, () => instance('raider').object)
    g.add(...convoy, ...attackers)
    // Recognisable torn plates, struts and tanks, drawn in one instanced call.
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#545962', metalness: 0.8, roughness: 0.65 }), 100)
    const o = new THREE.Object3D()
    for (let i = 0; i < 100; i++) {
      o.position.set(Math.sin(i * 17.1) * 200, Math.cos(i * 7.9) * 90, Math.sin(i * 11.7) * 260)
      o.rotation.set(i * 1.4, i * 0.6, i * 2.1)
      o.scale.set(0.4 + i % 4, 0.2 + i % 3 * 0.4, 1 + i % 7)
      o.updateMatrix(); debris.setMatrixAt(i, o.matrix)
    }
    g.add(debris)
    return { group: g, ship, station, convoy, attackers, debris }
  }, [version])
  // The wreck is the shot a weak machine pays most for; a smaller field of it
  // is still a field. `count` is free to move at any time on an instanced mesh.
  useEffect(() => { art.debris.count = Math.min(100, budget) }, [art, budget])
  useEffect(() => () => { art.debris.geometry.dispose(); art.debris.material.dispose() }, [art])
  const position = useMemo(() => new THREE.Vector3(), [])
  const target = useMemo(() => new THREE.Vector3(), [])
  const limbAxis = useMemo(() => PLACES.harbor.anchor.clone().normalize().cross(new THREE.Vector3(0, 1, 0)).normalize(), [])
  useFrame(({ camera }) => {
    const t = clock.current.time, { chapter, local } = prologueAt(t)
    const f = reduced ? 0.5 : local / (chapter.end - chapter.start)
    const a = art
    game.current.anchor.copy(chapter.shot === 'earth' ? PLACES.harbor.anchor : PLACES.hearth.anchor)
    if (chapter.shot === 'earth') game.current.anchor.set(0.9, 0.2, -0.4).normalize().multiplyScalar(17e6)
    game.current.time = 0
    a.ship.visible = chapter.shot !== 'earth'
    a.station.visible = chapter.shot === 'station' || chapter.shot === 'kestrel'
    a.debris.visible = chapter.shot === 'wreck' || chapter.shot === 'rescue'
    for (let i = 0; i < a.convoy.length; i++) {
      const s = a.convoy[i]; s.visible = ['convoy', 'wreck', 'rescue'].includes(chapter.shot)
      s.position.set(-150 + (i % 3) * 150, Math.floor(i / 3) * 80 - 15, -230 - Math.floor(i / 3) * 240 + f * 30)
      s.rotation.set(chapter.shot === 'wreck' ? 0.45 + i * 0.3 : 0, 0.12, chapter.shot === 'wreck' ? i * 0.6 : 0)
    }
    for (let i = 0; i < a.attackers.length; i++) {
      const s = a.attackers[i]; s.visible = chapter.shot === 'convoy' && local > 11
      s.position.set(160 - i * 400, 80, -420 + f * 260); s.rotation.y = Math.PI
    }
    a.station.position.set(0, 0, -650)
    a.ship.position.set(0, 0, 0); a.ship.rotation.set(0.06, -0.3, 0)
    a.debris.rotation.y = reduced ? 0 : local * 0.004
    camera.up.set(0, 1, 0)
    switch (chapter.shot) {
      case 'earth':
        position.set(0, 100, 0)
        // A grazing orbital view, not a straight-down magnification of the
        // cloud map. Centre just beyond the limb so Earth and black sky share the shot.
        target.copy(game.current.anchor).negate().normalize().applyAxisAngle(limbAxis, 0.12 + f * 0.03).multiplyScalar(1e6)
        camera.up.set(0, 1, 0); break
      case 'convoy': position.set(130 - f * 80, 45, 180 - f * 110); target.set(-20, 0, -280); break
      case 'wreck': position.set(-85 + f * 90, 22, 80); target.set(0, 0, -180); break
      case 'rescue': position.set(42 - f * 15, 12, 38); target.set(0, 0, -4); break
      case 'station': position.set(620 - f * 180, 220 - f * 80, 350 - f * 160); target.set(0, 0, -650); break
      default: position.set(24 - f * 10, 7 - f * 2, 22); target.set(0, 0, -3)
    }
    camera.position.copy(position); camera.lookAt(target)
  })
  return <group ref={root}><primitive object={art.group} /></group>
}
