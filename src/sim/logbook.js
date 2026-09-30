/**
 * The logbook: a record of what a visitor has actually done here.
 *
 * A simulator you can only watch is a place you visit once. The product already
 * flies fifteen real missions and hands out photographs and films — what it has
 * never done is *keep* anything. This is the keeping: the milestones a flight
 * reaches (liftoff, TLI, lunar orbit, docking, splashdown …), the plates taken,
 * the films recorded, the pads flown from — persisted in this browser, shown in
 * the HUD as they happen, and collected in a logbook drawer.
 *
 * Storage is localStorage, deliberately: the shelf's IndexedDB stores blobs the
 * size of films, and this stores a few hundred bytes of facts. Both can fail —
 * private browsing, quota, an embedded webview — so every read and write is
 * guarded and the product works with the logbook empty: nothing here is ever
 * load-bearing for the flight itself.
 *
 * The writes come from one place each: the mission sequencer's own transition
 * point for milestones, the photograph's completion for plates, the film's
 * shelf for films, and the launch-site registry for pads. Nothing polls, so a
 * frame that records nothing allocates nothing.
 */

/** The store key. Bump to start every logbook over. */
const KEY = 'periapsis.logbook.v1'

/**
 * The milestones, in the order the logbook tells the story: a launch from
 * Earth to the ocean, the halo coast the Artemis flight makes, then Eagle's
 * flight from the Moon to Columbia. `phase` is the mission phase whose *entry*
 * is the event; one phase may carry several — staging is one event, not five.
 *
 * The order is not decoration: the HUD's "next in this flight" scans this list
 * and keeps the first entry whose phase the sequencer has not passed, so each
 * track here must run in the machine's own order (`PHASE_IDS`). The tracks are
 * separated deliberately — the mission array lays the halo and lunar-ascent
 * branches out after the Apollo 8 return, and a single globally phase-sorted
 * list would offer a finished Apollo 8 flight "distant retrograde coast".
 * Label is written in the voice of a flight log — past tense, no exclamation.
 */
export const MILESTONES = [
  { phase: 'LIFTOFF', label: 'Liftoff', note: 'held down no longer' },
  { phase: 'STAGING', label: 'First stage away', note: 'the booster falls behind' },
  { phase: 'MECO', label: 'Main engine cutoff', note: 'orbital velocity' },
  { phase: 'CIRCULARISE', label: 'Parking orbit', note: 'a hundred nautical miles up' },
  { phase: 'TLI_BURN', label: 'Trans-lunar injection', note: 'committed to the Moon' },
  { phase: 'TRANS_LUNAR', label: 'Coast to the Moon', note: 'three days of falling' },
  { phase: 'LOI_BURN', label: 'Lunar orbit', note: 'braking behind the far side' },
  { phase: 'TEI_BURN', label: 'The burn for home', note: 'lit on the far side' },
  { phase: 'SM_SEP', label: 'Service module away', note: 'the heat shield faces the fire' },
  { phase: 'DROGUE', label: 'Drogues', note: 'first contact with the air' },
  { phase: 'MAIN_CHUTES', label: 'Main canopies', note: 'three sails of orange and white' },
  { phase: 'SPLASHDOWN', label: 'Splashdown', note: 'the mission comes home' },
  { phase: 'NRHO_COAST', label: 'Distant retrograde coast', note: 'the halo, flown' },
  { phase: 'LUNAR_LIFTOFF', label: 'Lunar liftoff', note: 'Eagle leaves the Moon' },
  { phase: 'LUNAR_INSERTION', label: 'Lunar insertion', note: 'an orbit of the Moon, made by hand' },
  { phase: 'LM_CSI', label: 'Rendezvous begun', note: 'the coelliptic sequence' },
  { phase: 'LM_DOCKING', label: 'Final approach', note: 'thirty metres of intuition' },
  { phase: 'DOCKED', label: 'Docked with Columbia', note: 'two craft, one vehicle' },
  { phase: 'LOST', label: 'Vehicle lost', note: 'the record keeps this too' },
]

/** Milestones by phase id, for the watcher. */
const BY_PHASE = new Map(MILESTONES.map((m) => [m.phase, m]))

/** The sites a launch can leave from — mirrors sim/launchsite.js ids. */
export const SITES = [
  { id: 'ksc', name: 'Kennedy LC-39B' },
  { id: 'vandenberg', name: 'Vandenberg SLC-6' },
  { id: 'kourou', name: 'Kourou ELA-3' },
  { id: 'tranquility', name: 'Tranquility Base' },
]

/* ---------------------------------------------------------------- *
 * The record
 * ---------------------------------------------------------------- */

/**
 * The shape on disk: `{ v, milestones: {phaseId: t}, plates: n, films:
 * {presetId: t}, pads: [siteId] }`. Milestones are keyed by phase and record
 * the mission time they were reached at; films by preset, same; pads is an
 * array of ids in first-flown order.
 */
let record = null

/** Read the record once, guarded. A locked or empty browser yields the empty shape. */
function load() {
  if (record) return record
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    record = raw ? JSON.parse(raw) : {}
  } catch {
    record = {}
  }
  if (typeof record !== 'object' || !record) record = {}
  if (!record.milestones || typeof record.milestones !== 'object') record.milestones = {}
  if (!Number.isFinite(record.plates)) record.plates = 0
  if (!record.films || typeof record.films !== 'object') record.films = {}
  if (!Array.isArray(record.pads)) record.pads = []
  return record
}

/** Persist, guarded. Failure is silent by design: the flight does not care. */
function save() {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(record))
  } catch {
    /* private mode or a full quota: the logbook simply does not persist */
  }
}

/* ---------------------------------------------------------------- *
 * Subscriptions — the store pattern, small, for the same reason:
 * React context does not cross the <Canvas> boundary, and the HUD's
 * progress strip lives beside components that render inside it.
 * ---------------------------------------------------------------- */

const listeners = new Set()

/** Subscribe to logbook changes; returns the unsubscribe function. */
export function subscribeLogbook(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Bump the listeners. Called once per user-visible change, never per frame. */
function emit() {
  record = { ...record }
  for (const l of listeners) l()
}

/**
 * The current record, read-only by convention. The UI re-renders through
 * `useLogbook()`; direct readers (the harness, the gates) use the accessors.
 */
export const logbookSnapshot = load

/* ---------------------------------------------------------------- *
 * The writers — one call site each, none on a per-frame path
 * ---------------------------------------------------------------- */

/**
 * A milestone reached: phase entry with the mission clock at that moment.
 * Records each phase once per browser — a flight flown again is flown again,
 * but the logbook is a record of the first time *you* saw each moment. True
 * when this call newly earned it, so the caller can toast.
 */
export function recordMilestone(phaseId, t) {
  const m = BY_PHASE.get(phaseId)
  if (!m) return false
  const rec = load()
  if (rec.milestones[phaseId] != null) return false
  rec.milestones[phaseId] = Number.isFinite(t) ? t : null
  save()
  emit()
  return true
}

/** A photograph taken. Returns the running count. */
export function recordPhotograph() {
  const rec = load()
  rec.plates += 1
  save()
  emit()
  return rec.plates
}

/** A film finished and was kept on the shelf. Returns true when newly earned. */
export function recordFilm(presetId) {
  const rec = load()
  if (rec.films[presetId] != null) return false
  rec.films[presetId] = Date.now()
  save()
  emit()
  return true
}

/** A pad flown from. Returns true when this site is newly visited. */
export function recordPad(siteId) {
  const rec = load()
  if (rec.pads.includes(siteId)) return false
  rec.pads.push(siteId)
  save()
  emit()
  return true
}

/* ---------------------------------------------------------------- *
 * The readers
 * ---------------------------------------------------------------- */

/** Milestones reached so far, in logbook order: `[{ label, note, t, phase }]`.
 *
 * The reach test is against `undefined`, not null: a milestone whose clock was
 * not finite is stored as null and is still *reached* — it happened, the record
 * just does not date it. Filtered on null it would be recorded and then
 * invisible everywhere, which is the worst kind of bug: silent, and only about
 * things that actually occurred.
 */
export function milestonesReached() {
  const rec = load()
  return MILESTONES.filter((m) => rec.milestones[m.phase] !== undefined).map((m) => ({
    phase: m.phase,
    label: m.label,
    note: m.note,
    t: rec.milestones[m.phase],
  }))
}

/** The next milestone not yet reached, or null when the log is complete. */
export function nextMilestone() {
  const rec = load()
  return MILESTONES.find((m) => rec.milestones[m.phase] === undefined) ?? null
}

/** The film kept for a preset, as a timestamp, or null. */
export const filmKeptAt = (presetId) => load().films[presetId] ?? null

/** Every film kept, keyed by preset id. */
export const filmsKept = () => ({ ...load().films })

/** The pads flown from, in first-flown order. */
export const padsFlown = () => [...load().pads]

/** The photograph count. */
export const platesTaken = () => load().plates

/** Has anything at all been done here? The landing page asks exactly this. */
export function hasFlown() {
  const rec = load()
  return rec.plates > 0 || rec.pads.length > 0 || Object.keys(rec.milestones).length > 0
}

/**
 * A short line for the landing page: what this browser has done, or null.
 * "First thing a returning visitor reads" — one line, no numbers but the
 * honest ones. Milestones lead (they are the flying), then the kept things.
 */
export function logbookLine() {
  const rec = load()
  const parts = []
  const reached = MILESTONES.filter((m) => rec.milestones[m.phase] != null)
  if (reached.length) {
    const asFarAs = reached[reached.length - 1].label.toLowerCase()
    parts.push(
      reached.length === 1
        ? `one milestone, as far as ${asFarAs}`
        : `${reached.length} milestones, as far as ${asFarAs}`,
    )
  }
  const films = Object.keys(rec.films).length
  if (films) parts.push(`${films} film${films === 1 ? '' : 's'} kept`)
  if (rec.plates) parts.push(`${rec.plates} plate${rec.plates === 1 ? '' : 's'} taken`)
  if (rec.pads.length > 1) parts.push(`${rec.pads.length} pads`)
  return parts.length ? parts.join(' · ') : null
}

/* ---------------------------------------------------------------- *
 * The harness hook — used by scripts, not by the product
 * ---------------------------------------------------------------- */

/**
 * A pristine logbook for a test browser, bypassing localStorage entirely.
 * The cache is dropped, not replaced with a bare object — a record only ever
 * comes from `load()`, which is where the shape is guaranteed. Returns a
 * `forget` that puts the previous record back.
 */
export function _installTestLogbook() {
  const previous = record
  record = null
  return () => {
    record = previous
  }
}
