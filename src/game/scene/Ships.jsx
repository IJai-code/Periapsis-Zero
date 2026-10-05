import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { instance, onModelsChange, preload } from './models.js'

/**
 * Every ship in the sky, drawn from the game's list each frame. A ship's
 * scene object is made when it first appears and dropped when it leaves;
 * the frame itself only copies transforms and sizes the engine plumes.
 */
const PLUME_COLOURS = { player: '#ffb070', ally: '#7fe2ff', compact: '#7fe2ff', hollow: '#ff5a3a', civil: '#ffd2a0', drone: '#ffb070' }

export function Ships({ game }) {
  const root = useRef()
  const live = useRef(new Map())
  // A cone with its wide end at the nozzle and its tip a unit behind (+z).
  const plumeGeo = useMemo(() => { const g = new THREE.ConeGeometry(1, 1, 16, 1, true); g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2); return g }, [])
  const plumeMats = useMemo(() => Object.fromEntries(Object.entries(PLUME_COLOURS).map(([k, c]) => [k, plumeMaterial(c)])), [])
  const boostMat = useMemo(() => plumeMaterial('#9fe9ff'), [])

  useEffect(() => {
    preload(['kestrel', 'mule', 'lance', 'raider', 'warden', 'cutter', 'wing', 'freighter'])
    // A model that arrives late replaces its stand-in on every ship that wears it.
    return onModelsChange((kind) => {
      for (const [id, s] of live.current) if (s.kind === kind) { root.current?.remove(s.group); live.current.delete(id) }
    })
  }, [])

  useFrame((state) => {
    const g = game.current
    if (!g || !root.current) return
    const seen = new Set()
    const t = state.clock.elapsedTime
    for (const e of g.ships) {
      if (!e.alive) continue
      seen.add(e.id)
      let s = live.current.get(e.id)
      const kind = e.kind === 'player' ? g.ship.hull : e.kind
      if (!s || s.kind !== kind) {
        if (s) root.current.remove(s.group)
        s = make(kind, e, plumeGeo, plumeMats)
        live.current.set(e.id, s)
        root.current.add(s.group)
      }
      s.group.position.copy(e.pos)
      s.group.quaternion.copy(e.q)
      s.group.visible = !(e.kind === 'player' && g.mode === 'docked' && g.hideShip)
      // Plumes: length by thrust, a flicker, and blue-white on boost.
      const transfer = e.kind === 'player' && g.mode === 'transfer'
      const thrust = transfer ? 1.8 : Math.min(1.5, (e.thrust ?? 0) * 1.2 + (e.ctrl.throttle > 0 ? 0.15 : 0))
      const flick = 0.9 + 0.1 * Math.sin(t * 40 + e.id)
      for (const p of s.plumes) {
        const len = (transfer ? 70 : 4 + 14 * thrust) * (e.boosting ? 1.7 : 1) * flick * s.scale
        p.scale.set(s.nozzleR * (e.boosting || transfer ? 1.3 : 1), s.nozzleR * (e.boosting || transfer ? 1.3 : 1), Math.max(0.01, len))
        p.material = e.boosting || transfer ? boostMat : s.plumeMat
        p.visible = thrust > 0.04 || transfer
      }
    }
    for (const [id, s] of live.current) if (!seen.has(id)) { root.current.remove(s.group); live.current.delete(id) }
  })
  return <group ref={root} />
}

function make(kind, e, plumeGeo, plumeMats) {
  const { object, nozzles } = instance(kind)
  const group = new THREE.Group()
  group.add(object)
  const plumeMat = plumeMats[e.team] ?? plumeMats.civil
  const scale = e.radius / 9
  const plumes = nozzles.map((n) => { const m = new THREE.Mesh(plumeGeo, plumeMat); m.position.set(...n); m.renderOrder = 5; group.add(m); return m })
  return { kind, group, plumes, plumeMat, scale, nozzleR: Math.max(0.6, e.radius * 0.11) }
}

function plumeMaterial(colour) {
  return new THREE.ShaderMaterial({
    uniforms: { uColour: { value: new THREE.Color(colour) } },
    vertexShader: `varying float vZ; varying vec3 vN; varying vec3 vV;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() { vZ = position.z; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying float vZ; varying vec3 vN; varying vec3 vV; uniform vec3 uColour;
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float along = clamp(1.0 - vZ, 0.0, 1.0);
        vec3 core = mix(uColour, vec3(1.0), pow(along, 3.0) * 0.8);
        gl_FragColor = vec4(core * edge * along * 2.2, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  })
}
