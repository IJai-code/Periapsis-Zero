/**
 * What each vehicle is, section by section.
 *
 * The catalogue has one launch vehicle in it — a Saturn V, as a single mesh of
 * the whole stack whose body is one primitive running the full 12.99 units from
 * engine bells to escape tower. So it cannot be cut into stages by hiding parts
 * of it, and binding it to three different stages is what produced the thing
 * this replaces: a complete Saturn V, escape tower and all, squeezed to 81.6 m
 * after first separation and to 35.1 m after second. There is no SLS and no
 * Orion in the catalogue at all, and the ISS exists only as loose modules.
 *
 * So the vehicles are built here instead, from published dimensions. A section
 * is a real piece of a real rocket — a tank, an interstage, an adapter, a
 * capsule — and a *stage* is the sum of the sections still attached. That makes
 * staging a change of which sections are drawn rather than a change of scale,
 * which is the whole of what was wrong.
 *
 * Diameters are the vehicles' own, not derived from `drag.area`: that works for
 * the rocket stages, where the area *is* the cross-section (S-IC's 80 m^2 gives
 * 10.09 m against a real 10.1), and fails for the capsules, where vessels.js
 * says in as many words that the area was chosen to hold the ballistic
 * coefficient rather than the diameter — Orion's 7.385 m^2 would draw a 3.07 m
 * capsule against a real 5.02.
 */

/**
 * Metres. Sections run base-first, so index 0 is what lifts off and the last
 * entry is the nose. `stage` is the stage index a section belongs to: it is
 * drawn while the vehicle is flying that stage or any stage below it.
 *
 * `kind` picks the shape:
 *   tank        a cylinder, optionally with engine bells beneath it
 *   interstage  a cylinder joining two diameters, or a taper when they differ
 *   capsule     a truncated cone, blunt end down, with a heat shield
 *   tower       the escape tower's lattice and its solid motor
 *   boosters    strap-on solids beside the section they are attached to
 */
export const SECTIONS = {
  apollo8: [
    {
      name: 'S-IC',
      stage: 0,
      kind: 'tank',
      length: 42.1,
      diameter: 10.1,
      engines: 5,
      bell: 3.7,
      fins: 4,
      colour: '#e8eaed',
      band: '#1f2430',
    },
    { name: 'S-IC/S-II interstage', stage: 0, kind: 'interstage', length: 5.5, diameter: 10.1 },
    {
      name: 'S-II',
      stage: 1,
      kind: 'tank',
      length: 24.9,
      diameter: 10.1,
      engines: 5,
      bell: 2.1,
      colour: '#e8eaed',
      band: '#1f2430',
    },
    { name: 'S-II/S-IVB interstage', stage: 1, kind: 'interstage', length: 5.2, diameter: 10.1, to: 6.6 },
    {
      name: 'S-IVB',
      stage: 2,
      kind: 'tank',
      length: 17.8,
      diameter: 6.6,
      engines: 1,
      bell: 2.0,
      colour: '#e8eaed',
      band: '#1f2430',
    },
    { name: 'Instrument unit', stage: 2, kind: 'interstage', length: 0.9, diameter: 6.6, colour: '#2b3242' },
    { name: 'Lunar module adapter', stage: 2, kind: 'interstage', length: 8.5, diameter: 6.6, to: 3.9 },
    {
      name: 'Service module',
      stage: 3,
      kind: 'tank',
      length: 7.5,
      diameter: 3.9,
      engines: 1,
      bell: 2.5,
      radiators: true,
      colour: '#b9c0c9',
    },
    { name: 'Command module', stage: 4, kind: 'capsule', length: 3.47, diameter: 3.9, to: 1.4 },
    { name: 'Launch escape system', stage: 0, kind: 'tower', length: 10.0, diameter: 0.66 },
  ],
  artemis: [
    {
      name: 'Core stage',
      stage: 1,
      kind: 'tank',
      length: 64.6,
      diameter: 8.4,
      engines: 4,
      bell: 2.4,
      colour: '#c8783c',
    },
    {
      name: 'Solid rocket boosters',
      stage: 0,
      kind: 'boosters',
      length: 54.0,
      diameter: 3.71,
      count: 2,
      bell: 3.8,
      colour: '#e8eaed',
    },
    { name: 'Launch vehicle stage adapter', stage: 2, kind: 'interstage', length: 8.4, diameter: 8.4, to: 5.0 },
    {
      name: 'ICPS',
      stage: 2,
      kind: 'tank',
      length: 13.7,
      diameter: 5.0,
      engines: 1,
      bell: 2.1,
      colour: '#d8dbe0',
    },
    { name: 'Orion stage adapter', stage: 2, kind: 'interstage', length: 1.5, diameter: 5.0 },
    {
      name: 'European service module',
      stage: 3,
      kind: 'tank',
      length: 4.8,
      diameter: 4.1,
      engines: 1,
      bell: 1.6,
      wings: 4,
      colour: '#b9c0c9',
    },
    { name: 'Orion crew module', stage: 4, kind: 'capsule', length: 3.3, diameter: 5.02, to: 1.6 },
    { name: 'Launch abort system', stage: 0, kind: 'tower', length: 13.7, diameter: 1.0 },
  ],
}

/** The sections still attached while flying a given stage. */
export const stageSections = (vessel, stage) =>
  (SECTIONS[vessel] ?? []).filter((s) => s.stage >= stage)

/** Their stacked height, unscaled. Boosters sit beside the stack, so they add none. */
export function sectionHeight(vessel, stage) {
  let total = 0
  for (const s of SECTIONS[vessel] ?? []) {
    if (s.kind !== 'boosters' && s.stage >= stage) total += s.length
  }
  return total
}

/**
 * One scale per vehicle, anchored on the height it is known by.
 *
 * Published section heights double-count the interstages — the S-IC's 42.1 m
 * and the S-II's 24.8 m both include the 5.5 m between them — so they sum 13.8%
 * over a Saturn V's documented 110.6. Rather than pick which source to trim,
 * every section of a vehicle is scaled by the one factor that makes the full
 * stack come out at the height the rest of the simulator uses. Proportions are
 * preserved exactly and stage 0 is unchanged; it is only the stages *below* the
 * full stack that move, and those were the ones that were wrong.
 *
 * Lengths only. Diameters are left alone — see Hull.jsx.
 */
export const vehicleScale = (vessel, stackHeight) => {
  const raw = sectionHeight(vessel, 0)
  return raw > 0 ? stackHeight / raw : 1
}

/**
 * How long the vehicle is while flying each stage, metres.
 *
 * This is what the hull is drawn from *and* what every camera frames it by, so
 * the two cannot disagree. It replaces a hand-written figure per stage, two of
 * which were wrong: Apollo's second stage was recorded at 81.6 m against the
 * 60.0 its own sections come to, and Artemis' at 65.0 m — which quietly treats
 * two strap-on boosters as though they were a stage underneath the core, when
 * dropping them takes nothing at all off the vehicle's height.
 */
export function stageLengths(vessel, stackHeight) {
  const all = SECTIONS[vessel]
  if (!all) return null
  const scale = vehicleScale(vessel, stackHeight)
  const stages = Math.max(...all.map((s) => s.stage)) + 1
  return Float64Array.from({ length: stages }, (_, i) => sectionHeight(vessel, i) * scale)
}
