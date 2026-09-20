import { useMemo } from 'react'
import { Plume } from './Plume.jsx'
import { SECTIONS, bellSeats, sectionHeight } from '../gfx/hulls.js'

/**
 * A launch vehicle, drawn from the sections still attached to it.
 *
 * Nose along +Z, matching the flight model's thrust axis and the convention the
 * downloaded meshes are held to. Sections stack base-first from -L/2, so the
 * craft's origin is the middle of whatever is still flying — which is where the
 * integrator says the vehicle is, and what the camera frames.
 *
 * Staging is a change of *which sections are drawn*, not of scale. That is the
 * whole point: a Saturn V second stage is a 10.1 m tank with five J-2 bells
 * under it, not a complete Saturn V at three quarters size.
 */

const SHELL = { metalness: 0.42, roughness: 0.38 }
const DARK = { color: '#2a2f38', metalness: 0.6, roughness: 0.5 }
const BELL = { color: '#4a4038', metalness: 0.85, roughness: 0.35 }
const PANEL = { color: '#16233f', metalness: 0.35, roughness: 0.28 }

/**
 * The engine bells under one section, and the plume when that stage is burning.
 *
 * The plume itself is `Plume.jsx`, because the same exhaust has to be drawn for
 * a stage whose hull is a glTF rather than these sections — see the note there.
 */
function Engines({ count, bell, radius, z, stage }) {
  const spread = count > 1 ? radius * 0.55 : 0
  const seats = useMemo(() => bellSeats(count, spread), [count, spread])
  return (
    <group position={[0, 0, z]}>
      {seats.map(([x, y], i) => (
        <mesh key={i} position={[x, y, -bell / 2]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <coneGeometry args={[bell * 0.42, bell, 14, 1, true]} />
          <meshStandardMaterial {...BELL} side={2} />
        </mesh>
      ))}
      <Plume stage={stage} seats={seats} bell={bell} z={-bell} />
    </group>
  )
}

/** One section, drawn at its place in the stack. `z` is its base. */
/**
 * `scale` reaches lengths and nothing else.
 *
 * Published section heights overlap at the interstages and sum a few percent
 * over the documented stack, so the stack is normalised to the length the rest
 * of the simulator frames it by. Diameters are not normalised, because they are
 * measurements in their own right and normalising them drew an S-II 12.07 m
 * across — wider than the S-IC beneath it, and a vehicle that visibly fattened
 * at separation.
 */
function Section({ s, z, scale }) {
  const L = s.length * scale
  const r = s.diameter / 2
  const rTop = (s.to ?? s.diameter) / 2
  const mid = z + L / 2

  if (s.kind === 'capsule') {
    // Blunt end down: the heat shield faces the direction of travel on entry,
    // which is backwards along the thrust axis.
    return (
      <group>
        <mesh position={[0, 0, mid]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[rTop, r, L, 20]} />
          <meshStandardMaterial color="#d8dce2" {...SHELL} />
        </mesh>
        <mesh position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <sphereGeometry args={[r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.6]} />
          <meshStandardMaterial color="#3a3026" metalness={0.3} roughness={0.8} side={2} />
        </mesh>
      </group>
    )
  }

  if (s.kind === 'tower') {
    // Lattice plus its solid motor, on the nose.
    const strut = r * 0.18
    return (
      <group position={[0, 0, z]}>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, L * 0.34]}
              rotation={[0, 0, 0]}
            >
              <boxGeometry args={[strut, strut, L * 0.68]} />
              <meshStandardMaterial {...DARK} />
            </mesh>
          )
        })}
        <mesh position={[0, 0, L * 0.82]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[r * 0.8, r * 0.8, L * 0.3, 12]} />
          <meshStandardMaterial color="#b0342c" metalness={0.4} roughness={0.5} />
        </mesh>
      </group>
    )
  }

  if (s.kind === 'boosters') {
    // Beside the stack, not under it — which is why a booster separation takes
    // nothing off the vehicle's length.
    const count = s.count ?? 2
    const core = (SECTIONS.artemis?.[0]?.diameter ?? 8.4) * 0.5
    return (
      <group>
        {Array.from({ length: count }, (_, i) => {
          const a = (i / count) * Math.PI * 2
          const x = Math.cos(a) * (core + r)
          const y = Math.sin(a) * (core + r)
          return (
            <group key={i} position={[x, y, 0]}>
              <mesh position={[0, 0, mid]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[r, r, L, 16]} />
                <meshStandardMaterial color={s.colour ?? '#e8eaed'} {...SHELL} />
              </mesh>
              <mesh position={[0, 0, z + L + r * 1.6]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
                <coneGeometry args={[r, r * 3.2, 16]} />
                <meshStandardMaterial color={s.colour ?? '#e8eaed'} {...SHELL} />
              </mesh>
              <Engines count={1} bell={s.bell ?? 3} radius={r} z={z} stage={s.stage} />
            </group>
          )
        })}
      </group>
    )
  }

  // tank and interstage: a cylinder, tapering when the diameters differ.
  return (
    <group>
      <mesh position={[0, 0, mid]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[rTop, r, L, 24]} />
        <meshStandardMaterial
          color={s.colour ?? (s.kind === 'interstage' ? '#9aa2ad' : '#e8eaed')}
          {...SHELL}
        />
      </mesh>
      {s.band && (
        <mesh position={[0, 0, z + L * 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r * 1.004, r * 1.004, L * 0.1, 24]} />
          <meshStandardMaterial color={s.band} metalness={0.3} roughness={0.7} />
        </mesh>
      )}
      {s.fins > 0 &&
        Array.from({ length: s.fins }, (_, i) => {
          const a = (i / s.fins) * Math.PI * 2 + Math.PI / 4
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2, z + L * 0.07]}
              rotation={[0, 0, a]}
              castShadow
            >
              <boxGeometry args={[r * 0.9, r * 0.1, L * 0.14]} />
              <meshStandardMaterial {...DARK} />
            </mesh>
          )
        })}
      {s.radiators && (
        <mesh position={[0, 0, mid]} rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r * 1.02, r * 1.02, L * 0.55, 24, 1, true]} />
          <meshStandardMaterial color="#8d949c" metalness={0.7} roughness={0.25} side={2} />
        </mesh>
      )}
      {s.wings > 0 &&
        Array.from({ length: s.wings }, (_, i) => {
          const a = (i / s.wings) * Math.PI * 2
          return (
            <mesh
              key={i}
              position={[Math.cos(a) * r * 2.4, Math.sin(a) * r * 2.4, mid]}
              rotation={[0, 0, a]}
              castShadow
            >
              <boxGeometry args={[r * 3.4, r * 0.04, L * 0.5]} />
              <meshStandardMaterial {...PANEL} />
            </mesh>
          )
        })}
      {s.engines > 0 && (
        <Engines count={s.engines} bell={s.bell ?? 2} radius={r} z={z} stage={s.stage} />
      )}
    </group>
  )
}

/**
 * The vehicle as it stands now.
 *
 * `size` is what the caller wants the stack to measure, so the sections are
 * scaled to it — published section heights overlap at the interstages and sum a
 * few percent over the documented stack height, and normalising here keeps the
 * proportions while making the total exactly the length every camera frames it
 * by.
 */
export function Hull({ vessel, stage, size }) {
  const parts = useMemo(() => {
    const all = SECTIONS[vessel]
    if (!all) return null
    const raw = sectionHeight(vessel, stage)
    if (!(raw > 0)) return null
    const scale = size / raw
    const drawn = all.filter((s) => s.stage >= stage)
    // Stack the ones that carry height; the rest hang off the side.
    let z = -size / 2
    const placed = []
    for (const s of drawn) {
      if (s.kind === 'boosters') {
        placed.push({ s, z: -size / 2 })
        continue
      }
      placed.push({ s, z })
      z += s.length * scale
    }
    return { placed, scale }
  }, [vessel, stage, size])

  if (!parts) return null
  return (
    <group>
      {parts.placed.map(({ s, z }, i) => (
        <Section key={`${s.name}-${i}`} s={s} z={z} scale={parts.scale} />
      ))}
    </group>
  )
}
