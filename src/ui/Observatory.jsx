import { useEffect, useState } from 'react'
import { BODIES } from '../sim/constants.js'
import { live } from '../sim/live.js'
import { RAILS } from '../sim/rails.js'
import { setUi, useUi } from '../sim/store.js'
import { LOOKS } from '../gfx/bodyLooks.js'
import { VIEW } from '../gfx/cosmicView.js'

const LIGHT = 299792458
const NOTES = {
  moon: 'LRO imagery · sub-map craters are synthetic. Tranquility ground uses measured terrain when loaded.',
  europa: 'Double ridges, chaos terrain and fine fractured ice · synthetic surface, not an image mosaic.',
  ganymede: 'Dark ancient terrain, grooved ice and frost caps · synthetic surface.',
  callisto: 'Valhalla rings and bright impact ice · synthetic surface.',
  pluto: 'Tombaugh Regio and fine frost relief · synthetic surface.',
  saturn: 'Cassini ring radii, optical gaps and analytic ring shadows.',
}
const WORLD = Object.fromEntries(RAILS.map((r) => [r.id, r]))

function read(id) {
  const at = id === 'moon' ? live.abs.moon : live.railPos[id]
  if (!at) return null
  const x = at.x + (id === 'moon' ? 0 : live.origin.x)
  const y = at.y + (id === 'moon' ? 0 : live.origin.y)
  const z = at.z + (id === 'moon' ? 0 : live.origin.z)
  const distance = Math.hypot(x - VIEW.abs.x, y - VIEW.abs.y, z - VIEW.abs.z)
  const radius = id === 'moon' ? BODIES.moon.radius : LOOKS[id].equatorial
  const sunDistance = Math.hypot(x - live.abs.sun.x, y - live.abs.sun.y, z - live.abs.sun.z)
  return { distance, radius, minutes: distance / LIGHT / 60, sunMinutes: sunDistance / LIGHT / 60,
    angle: 2 * Math.asin(Math.min(1, radius / Math.max(radius, distance))) * 180 / Math.PI }
}

export function Observatory() {
  const focus = useUi((s) => s.focus)
  const enabled = useUi((s) => s.observatory !== false)
  const hidden = useUi((s) => s.broadcast || s.photo || s.map)
  const id = focus === 'moon' || LOOKS[focus] ? focus : null
  const [sample, setSample] = useState(null)
  useEffect(() => {
    setSample(null)
    if (!id || !enabled || hidden) return
    const update = () => { if (!document.hidden) setSample(read(id)) }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [id, enabled, hidden])
  if (!id || !enabled || hidden || !sample) return null
  const world = WORLD[id]
  const neighbours = RAILS.filter((r) => r.parent === id || (world?.parent && r.id === world.parent))
  const km = (n) => (n / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return (
    <aside aria-label="Observatory" className="pointer-events-auto absolute bottom-20 right-4 hidden w-64 border border-hud/20 bg-black/85 p-4 text-hud lg:block">
      <div className="font-mono text-[9px] tracking-[0.24em] text-ember">OBSERVATORY · LIVE GEOMETRY</div>
      <h2 className="mt-2 font-display text-2xl">{id === 'moon' ? 'Luna' : world?.name}</h2>
      <dl className="mt-3 space-y-1 text-[10px]">
        {[['Diameter', `${km(sample.radius * 2)} km`], ['Camera range', `${km(sample.distance)} km`],
          ['Angular disc', `${sample.angle.toFixed(3)}°`], ['Light to camera', `${sample.minutes.toFixed(2)} min`],
          ['Sunlight travel', `${sample.sunMinutes.toFixed(2)} min`]].map(([label, value]) => (
          <div className="flex justify-between gap-2" key={label}><dt className="text-hud/45">{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <p className="mt-3 text-[10px] leading-relaxed text-hud/50">{NOTES[id] ?? 'True-scale body and rotational frame · procedural appearance, not a measured surface map.'}</p>
      <p className="mt-2 text-[9px] text-hud/40">Positions are current simulation time; this is not a retarded-light image.</p>
      {neighbours.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{neighbours.map((n) => (
        <button key={n.id} onClick={() => setUi({ focus: n.id })} className="control border border-hud/20 px-2 py-1 text-[10px] hover:text-ember">{n.name}</button>
      ))}</div>}
    </aside>
  )
}
