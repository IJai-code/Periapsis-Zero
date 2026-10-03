import { useEffect, useState } from 'react'
import { BODIES } from '../sim/constants.js'
import { live } from '../sim/live.js'
import { COSMIC } from '../sim/cosmic.js'
import { RAILS } from '../sim/rails.js'
import { entryById } from '../sim/catalog.js'
import { setUi, useUi } from '../sim/store.js'
import { LOOKS } from '../gfx/bodyLooks.js'
import { VIEW } from '../gfx/cosmicView.js'

const LIGHT = 299792458
const AU = 1.495978707e11
const LY = 9.4607e15
const NOTES = {
  moon: 'LRO imagery · sub-map craters are synthetic. Tranquility ground uses measured terrain when loaded.',
  europa: 'Double ridges, chaos terrain and fine fractured ice · synthetic surface, not an image mosaic.',
  ganymede: 'Dark ancient terrain, grooved ice and frost caps · synthetic surface.',
  callisto: 'Valhalla rings and bright impact ice · synthetic surface.',
  pluto: 'Tombaugh Regio and fine frost relief · synthetic surface.',
  saturn: 'Cassini ring radii, optical gaps and analytic ring shadows.',
}
const WORLD = Object.fromEntries(RAILS.map((r) => [r.id, r]))

/**
 * A length at the scales the deep sky lives at. Planetary distances read in
 * AU; beyond a twentieth of a light-year the light-year takes over, then its
 * thousands and millions, the units a catalogue speaks, not a fixed prefix.
 */
function span(n) {
  if (n < 0.05 * LY) return `${(n / AU).toLocaleString('en-US', { maximumFractionDigits: 1 })} AU`
  if (n < 1_000 * LY) return `${(n / LY).toLocaleString('en-US', { maximumFractionDigits: 1 })} ly`
  if (n < 1e6 * LY) return `${(n / (1_000 * LY)).toLocaleString('en-US', { maximumFractionDigits: 1 })} thousand ly`
  return `${(n / (1e6 * LY)).toLocaleString('en-US', { maximumFractionDigits: 1 })} million ly`
}

/** How long light takes over a distance, in the unit the distance earns. */
function lightTime(n) {
  const s = n / LIGHT
  if (s < 120) return `${s.toFixed(1)} s`
  if (s < 5400) return `${(s / 60).toFixed(1)} min`
  if (s < 3600 * 48) return `${(s / 3600).toFixed(1)} h`
  const y = n / LY
  if (y < 1) return `${(y * 365.25).toFixed(1)} days`
  if (y < 1e6) return `${y.toLocaleString('en-US', { maximumFractionDigits: 1 })} years`
  return `${(y / 1e6).toPrecision(3)} million years`
}

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

/**
 * The same card for a place beyond the planets. Everything here is read live
 *, the camera's range off the object moves as the pilot flies it, and the
 * one number no planet card can offer sits at the foot: how long the object's
 * light was in the air before it reached the camera. That is the arrival
 * fact, the reason these places are worth flying to.
 */
function readCosmic(id) {
  const c = COSMIC[id]
  if (!c) return null
  const distance = Math.hypot(VIEW.abs.x - c.abs.x, VIEW.abs.y - c.abs.y, VIEW.abs.z - c.abs.z)
  const fromEarth = c.abs.length()
  return { distance, radius: c.radius, fromEarth, lightLeft: fromEarth / LIGHT }
}

export function Observatory() {
  const focus = useUi((s) => s.focus)
  const enabled = useUi((s) => s.observatory !== false)
  const hidden = useUi((s) => s.broadcast || s.photo || s.map)
  const cosmic = COSMIC[focus] ? focus : null
  const id = focus === 'moon' || LOOKS[focus] || cosmic ? focus : null
  const [sample, setSample] = useState(null)
  useEffect(() => {
    setSample(null)
    if (!id || !enabled || hidden) return
    const update = () => { if (!document.hidden) setSample(cosmic ? readCosmic(id) : read(id)) }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [id, enabled, hidden, cosmic])
  if (!id || !enabled || hidden || !sample) return null

  if (cosmic) {
    const entry = entryById(id)
    const km = (n) => (n / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })
    return (
      <aside aria-label="Observatory" className="pointer-events-auto absolute bottom-20 right-4 hidden w-64 border border-hud/20 bg-black/85 p-4 text-hud lg:block">
        <div className="font-mono text-[9px] tracking-[0.24em] text-ember">OBSERVATORY · DEEP SKY</div>
        <h2 className="mt-2 font-display text-2xl">{entry?.name ?? id}</h2>
        <p className="mt-1.5 text-[10px] leading-relaxed text-hud/55">{entry?.hint}</p>
        <dl className="mt-3 space-y-1 text-[10px]">
          {[['Diameter', span(sample.radius * 2)], ['Camera range', span(sample.distance)],
            ['Light to camera', lightTime(sample.distance)], ['Light from Earth', lightTime(sample.fromEarth)],
            ['Distance from Earth', span(sample.fromEarth)]].map(([label, value]) => (
            <div className="flex justify-between gap-2" key={label}><dt className="text-hud/45">{label}</dt><dd className="text-right">{value}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-[10px] leading-relaxed text-hud/50">
          Arrived, not travelled: intergalactic space is past every warp rung, so a
          choice from the search lands the camera in range. Orbit and zoom are yours. The `min` mark is a fiftieth of the object's radius on the galaxies.
        </p>
        <p className="mt-2 text-[9px] text-hud/40">The view here is the view every photograph was taken from: the Sun's side, turned a little off dead-on.</p>
      </aside>
    )
  }

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
