/**
 * The logbook gate: the record keeps what happened, once, and survives the
 * browser.
 *
 * The logbook is small and that is exactly why it needs a gate: every claim it
 * makes — "recorded once", "works when storage is locked", "the milestones are
 * in the machine's own order" — is cheap to check directly, and the module is
 * imported by the mission sequencer itself, so a shape error here is a flight
 * error. Everything below runs against the real module with a localStorage
 * double installed first, the same doubles-over-ESM pattern the render-budget
 * gate uses; nothing here touches a real browser profile.
 *
 * The two structural checks are the ones the UI depends on and cannot assert
 * for itself. `MILESTONES` promises to be in flight order, and the logbook
 * strip's "next in this flight" is only honest if that order is the sequencer's
 * own — so the gate compares the milestone phases against `PHASE_IDS`, the
 * array whose layout *is* the machine's control flow. And the wiring greps pin
 * the four call sites: a refactor that renames `setPhase` should have to break
 * this gate on its way to silently unhooking the record.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..')
let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  FAIL  ${msg}`)
}
const pass = (msg) => console.log(`  ok    ${msg}`)

/* 1. The module imports clean, under a storage double. */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
let lb
try {
  lb = await import(join(ROOT, 'src/sim/logbook.js'))
  pass('logbook.js imports clean')
} catch (e) {
  fail(`logbook.js does not import: ${e.message}`)
  console.log(`\n  ${failures} failure${failures === 1 ? '' : 's'}`)
  process.exit(1)
}

const forget = lb._installTestLogbook()

/* 2. The empty record says nothing has happened, and never lies about it. */
if (!lb.hasFlown()) pass('empty record: hasFlown false')
else fail('empty record claims work was done')
if (lb.logbookLine() === null) pass('empty record: logbookLine null')
else fail(`empty logbookLine: ${JSON.stringify(lb.logbookLine())}`)
if (lb.milestonesReached().length === 0 && lb.platesTaken() === 0 && lb.padsFlown().length === 0)
  pass('empty record: readers all zero')
else fail('empty record readers not zero')

/* 3. Milestones record once, by phase, and unknown phases say so. */
if (lb.recordMilestone('NOT_A_PHASE', 1) === false) pass('unknown phase: refused')
else fail('unknown phase recorded')
if (lb.recordMilestone('LIFTOFF', -5) === true) pass('LIFTOFF recorded')
else fail('LIFTOFF not recorded')
if (lb.recordMilestone('LIFTOFF', 99) === false) pass('LIFTOFF idempotent')
else fail('LIFTOFF recorded twice')
if (lb.recordMilestone('MECO', NaN) === true) pass('NaN clock: recorded without a time')
else fail('NaN clock refused the milestone')
const reached = lb.milestonesReached()
const liftoff = reached.find((m) => m.phase === 'LIFTOFF')
const meco = reached.find((m) => m.phase === 'MECO')
if (liftoff?.t === -5) pass('milestone keeps the mission clock it was reached at')
else fail(`LIFTOFF clock wrong: ${liftoff?.t}`)
if (meco && meco.t === null) pass('non-finite clock stored as null, not NaN text')
else fail(`MECO clock wrong: ${meco?.t}`)

/* 4. The other three kinds of kept thing. */
if (lb.recordFilm('apollo8-tli') === true && lb.recordFilm('apollo8-tli') === false)
  pass('films record once per preset')
else fail('film recording not idempotent')
if (lb.recordPad('ksc') === true && lb.recordPad('ksc') === false)
  pass('pads record once per site')
else fail('pad recording not idempotent')
if (lb.recordPhotograph() === 1 && lb.recordPhotograph() === 2)
  pass('plates count')
else fail('plate counting wrong')

/* 5. The landing line, composed from the record. */
const line = lb.logbookLine()
if (
  typeof line === 'string' &&
  /milestones?/.test(line) &&
  line.includes('film') &&
  line.includes('plates')
)
  pass(`logbookLine composes: "${line}"`)
else fail(`logbookLine wrong: ${JSON.stringify(line)}`)

/* 6. The record survives the process — the promise "in this browser" makes. */
const childA = spawnSync(
  process.execPath,
  [
    '-e',
    `
    const store = new Map();
    globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const m = await import(process.argv[1]);
    m.recordMilestone('TLI_BURN', 1234.5);
    m.recordPad('tranquility');
    process.stdout.write(JSON.stringify([...store.entries()]));
  `,
    join(ROOT, 'src/sim/logbook.js'),
  ],
  { cwd: ROOT, encoding: 'utf8' },
)
if (childA.status !== 0) {
  fail(`persistence writer exited ${childA.status}: ${childA.stderr}`)
} else {
  const handed = childA.stdout.trim()
  const childB = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const seeded = new Map(JSON.parse(process.argv[2]));
    globalThis.localStorage = { getItem: k => seeded.get(k) ?? null, setItem: (k,v) => seeded.set(k, String(v)), removeItem: k => seeded.delete(k) };
    const m = await import(process.argv[1]);
    const r = m.milestonesReached().find(x => x.phase === 'TLI_BURN');
    console.log(JSON.stringify({ t: r?.t, pad: m.padsFlown().includes('tranquility'), flown: m.hasFlown() }));
  `,
      join(ROOT, 'src/sim/logbook.js'),
      handed,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (childB.status !== 0) {
    fail(`persistence reader exited ${childB.status}: ${childB.stderr}`)
  } else {
    try {
      const out = JSON.parse(childB.stdout.trim())
      if (out.t === 1234.5 && out.pad && out.flown)
        pass('a fresh process reads the record a previous one wrote')
      else fail(`persistence readback wrong: ${childB.stdout.trim()}`)
    } catch (e) {
      fail(`persistence readback unparseable: ${e.message} — ${childB.stdout.trim()}`)
    }
  }
}

/* 7. Subscriptions fire on writes and stop on unsubscribe. */
forget()
let hits = 0
const un = lb.subscribeLogbook(() => hits++)
lb.recordMilestone('CIRCULARISE', 500)
lb.recordMilestone('CIRCULARISE', 501) // refused: no second emit
un()
lb.recordMilestone('TLI_BURN', 600)
if (hits === 1) pass('subscribers hear a change, exactly once, until they leave')
else fail(`subscription hits = ${hits}, want 1`)

/* 7b. Personal bests: first, beaten, refused, and formatted. */
forget()
if (lb.recordBest('touchdown-vertical', 6.5, { label: 'Touchdown', unit: 'm/s', missionT: 111 }) === 'first')
  pass('a first record says so')
else fail('first record not reported')
if (lb.recordBest('touchdown-vertical', 3.2) === 'beaten') pass('a better record says beaten')
else fail('better record not reported')
if (lb.recordBest('touchdown-vertical', 9.9) === false) pass('a worse attempt is refused and changes nothing')
else fail('worse attempt overwrote the record')
if (lb.recordBest('touchdown-vertical', 3.20001) === false) pass('an equal value is refused (no chatter)')
else fail('equal value re-recorded')
if (lb.recordBest('entry-peak-g', 4.8, { lowerIsBetter: false, unit: 'g' }) === 'first')
  pass('higher-is-better records work')
else fail('higher-is-better record failed')
if (lb.recordBest('entry-peak-g', 5.1, { lowerIsBetter: false }) === 'beaten')
  pass('a higher value beats a higher-is-better record')
else fail('higher-is-better comparison wrong')
if (lb.recordBest('bogus', NaN) === false && lb.recordBest('', 1) === false)
  pass('non-finite and unnamed records are refused')
else fail('garbage record accepted')
{
  const held = lb.bestsHeld()
  // Membership, not order: these writes land inside one millisecond, and a
  // tie broken by insertion order is not a promise worth making.
  if (held.length === 2 && held.some((b) => b.id === 'touchdown-vertical') && held.some((b) => b.id === 'entry-peak-g'))
    pass(`both records held (${held.map((b) => b.id).join(', ')})`)
  else fail(`bests list wrong: ${JSON.stringify(held.map((b) => b.id))}`)
  const td = held.find((b) => b.id === 'touchdown-vertical')
  if (td?.v === 3.2 && td?.missionT === 111 && td?.label === 'Touchdown')
    pass('a record keeps its value, mission clock and label')
  else fail(`record fields wrong: ${JSON.stringify(td)}`)
  if (lb.formatBest(td) === '3.20 m/s') pass(`formatBest: two decimals under ten (${lb.formatBest(td)})`)
  else fail(`formatBest wrong: ${lb.formatBest(td)}`)
  const g = held.find((b) => b.id === 'entry-peak-g')
  if (lb.formatBest(g) === '5.10 g') pass(`formatBest: two decimals under ten, unit carried (${lb.formatBest(g)})`)
  else fail(`formatBest g wrong: ${lb.formatBest(g)}`)
  if (lb.formatBest({ v: 382911, unit: 'km' }) === '382,911 km')
    pass('formatBest: kilometres round and group')
  else fail('formatBest km wrong')
  if (lb.hasFlown()) pass('a record alone counts as having flown')
  else fail('records invisible to hasFlown')
}

/* 7c. Records survive the process, like milestones do. */
{
  const child = spawnSync(
    process.execPath,
    ['-e', `
      const store = new Map();
      globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
      const m = await import(process.argv[1]);
      m.recordBest('touchdown-vertical', 4.4, { label: 'Touchdown', unit: 'm/s', missionT: 555 });
      process.stdout.write(JSON.stringify([...store.entries()]));
    `, join(ROOT, 'src/sim/logbook.js')],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const handed = child.status === 0 ? child.stdout.trim() : null
  const child2 = handed && spawnSync(
    process.execPath,
    ['-e', `
      const seeded = new Map(JSON.parse(process.argv[2]));
      globalThis.localStorage = { getItem: k => seeded.get(k) ?? null, setItem: (k,v) => seeded.set(k, String(v)), removeItem: k => seeded.delete(k) };
      const m = await import(process.argv[1]);
      const b = m.bestsHeld().find(x => x.id === 'touchdown-vertical');
      console.log(JSON.stringify({ v: b?.v, t: b?.missionT }));
    `, join(ROOT, 'src/sim/logbook.js'), handed],
    { cwd: ROOT, encoding: 'utf8' },
  )
  let ok = child.status === 0 && child2?.status === 0
  let out = {}
  try { out = JSON.parse(child2?.stdout.trim() ?? '{}') } catch { ok = false }
  if (ok && out.v === 4.4 && out.t === 555) pass('a record written in one process is read in the next')
  else fail(`record persistence wrong: ${child.stderr || child2?.stderr || JSON.stringify(out)}`)
}

/* 8. The structural claim: milestones are in the machine's own order. */
forget()
const mission = await import(join(ROOT, 'src/sim/mission.js')).catch(() => null)
const PHASE_IDS = mission?.PHASE_IDS
if (!PHASE_IDS) {
  fail('PHASE_IDS unavailable — the mission engine should import headless')
} else {
  const order = lb.MILESTONES.map((m) => PHASE_IDS.indexOf(m.phase))
  if (order.some((i) => i < 0)) fail(`milestone phases not in PHASE_IDS: ${lb.MILESTONES.filter((_, i) => order[i] < 0).map((m) => m.phase).join(', ')}`)
  else {
    let sorted = true
    for (let i = 1; i < order.length; i++) if (order[i] <= order[i - 1]) sorted = false
    if (sorted) pass(`all ${order.length} milestone phases exist and are in flight order`)
    else fail('milestone list is not in flight order: ' + order.join(','))

    // The strip's "next in this flight" is this same selection; prove it from
    // both ends of the machine. Eagle's rendezvous must not be advertised as
    // Liftoff, and a finished Apollo 8 flight must name its own last moment.
    const firstAfter = (phaseId) =>
      lb.MILESTONES.find(
        (m) => PHASE_IDS.indexOf(m.phase) >= PHASE_IDS.indexOf(phaseId),
      )?.label
    if (firstAfter('LM_CSI') === 'Rendezvous begun')
      pass('a lunar flight is offered its own next moment, not Liftoff')
    else fail(`LM_CSI next: ${firstAfter('LM_CSI')}`)
    if (firstAfter('SPLASHDOWN') === 'Splashdown')
      pass('the end of the flight is still an offer while it is the current phase')
    else fail(`SPLASHDOWN next: ${firstAfter('SPLASHDOWN')}`)
  }
}

/* 9. The wiring: one call site each, still hooked. */
const wiring = [
  ['src/sim/mission.js', 'recordMilestone(PHASES[next].id', 'the phase transition feeds the log'],
  ['src/sim/mission.js', 'recordPad(activeSite().id', 'resetMission names the pad'],
  ['src/sim/mission.js', "recordBest('touchdown-vertical'", 'splashdown gentleness is a record'],
  ['src/sim/mission.js', "recordBest('entry-peak-g'", 'the entry peak is a record'],
  ['src/sim/mission.js', "recordBest('lunar-closest'", 'the crossing answer is a record'],
  ['src/components/Photograph.jsx', 'recordPhotograph()', 'a captured plate is counted'],
  ['src/components/Photograph.jsx', 'plateSave(', 'a captured plate is shelved'],
  ['src/ui/MissionIntro.jsx', 'recordFilm(preset.id)', 'a kept film is counted'],
  ['src/ui/Hud.jsx', '<Logbook open={logbook}', 'the drawer is reachable from the HUD'],
  ['src/ui/Title.jsx', 'logbookLine()', 'the front door greets the returning visitor'],
  ['src/ui/Logbook.jsx', 'plateAll()', 'the gallery reads the shelf'],
]
for (const [file, needle, why] of wiring) {
  const text = readFileSync(join(ROOT, file), 'utf8')
  if (text.includes(needle)) pass(`${file}: ${why}`)
  else fail(`${file} lost its hook (${needle})`)
}

/* 10. The mark: 16 px must still read as the thing it names. */
function decodePng(path) {
  const b = readFileSync(path)
  let off = 8
  let w = 0
  let h = 0
  const idat = []
  while (off < b.length) {
    const len = b.readUInt32BE(off)
    const type = b.toString('ascii', off + 4, off + 8)
    const data = b.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
    }
    if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  /*
   * Reverse the row filters, all five of them.
   *
   * This used to copy each row straight out and drop the filter byte, which is
   * only a decoder if every row happens to carry filter 0 — an assumption
   * about the *encoder* that was never written down anywhere. The day
   * make-favicon started choosing a filter per row (it now does, which is how
   * a 1 MB icon became 55 kB) this gate reported stray pixels in a margin that
   * had not changed and stars that had not come back. A decoder that cannot
   * decode is worse than no decoder, because it fails as a false positive.
   */
  const stride = w * 4
  const bpp = 4
  const px = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    const type = raw[y * (stride + 1)]
    const from = y * (stride + 1) + 1
    for (let i = 0; i < stride; i++) {
      const x = raw[from + i]
      const a = i >= bpp ? px[y * stride + i - bpp] : 0
      const b = y > 0 ? px[(y - 1) * stride + i] : 0
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0
      let v
      if (type === 0) v = x
      else if (type === 1) v = x + a
      else if (type === 2) v = x + b
      else if (type === 3) v = x + ((a + b) >> 1)
      else if (type === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      } else throw new Error(`unknown PNG filter ${type} on row ${y}`)
      px[y * stride + i] = v & 0xff
    }
  }
  return { w, h, px }
}
try {
  const { w, h, px } = await decodePng(join(ROOT, 'public/icons/favicon-16.png'))
  let lit = 0
  let ember = 0
  let margin = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const r = px[o]
      const g = px[o + 1]
      const bl = px[o + 2]
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl
      if (lum > 60) lit++
      if (r > 120 && r > g + 50 && r > bl + 70) ember++
      // The top margin: nothing in the composition reaches rows 0–1 — the
      // orbit crests at row 2. A tripwire for gross drawing changes.
      if (y < 2 && lum > 18) margin++
    }
  }
  if (lit >= 40) pass(`16 px mark: the world and its arc carry ${lit} lit pixels`)
  else fail(`16 px mark too faint: ${lit} lit pixels`)
  if (ember >= 3 && ember <= 60) pass(`16 px mark: the periapsis point reads (${ember} px of ember)`)
  else fail(`16 px ember wrong: ${ember}`)
  if (margin === 0) pass('16 px top margin clean')
  else fail(`16 px top margin carries ${margin} stray pixels`)
} catch (e) {
  fail(`favicon-16.png unreadable: ${e.message}`)
}

/*
 * The stars must stop below 128 px, where they are sub-pixel. At 16 the
 * sub-pixel radii paint nothing at all, so the observable is the 32: the
 * drawing's two top stars sit at (0.145, 0.155) and (0.845, 0.115) of the
 * frame — squares around those spots that nothing else in the composition
 * reaches (the halo's falloff there is under the paint threshold, the orbit's
 * crest is rows below). Empty when the rule holds; speckled when it doesn't.
 */
try {
  const { w, px } = await decodePng(join(ROOT, 'public/icons/favicon-32.png'))
  const starDust = (x0, x1, y0, y1) => {
    let n = 0
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const o = (y * w + x) * 4
        const lum = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]
        if (lum > 18) n++
      }
    return n
  }
  const dust = starDust(4, 6, 3, 5) + starDust(26, 28, 3, 5)
  if (dust === 0) pass('32 px star spots clean: the field stops below 128 px')
  else fail(`32 px star spots carry ${dust} pixels — the sub-pixel stars are back`)
} catch (e) {
  fail(`favicon-32.png unreadable: ${e.message}`)
}
try {
  const svg = readFileSync(join(ROOT, 'public/icons/mark.svg'), 'utf8')
  const starCircles = (svg.match(/opacity="0\.\d+"/g) ?? []).length
  if (starCircles >= 6) pass('mark.svg keeps its field of stars at 512')
  else fail(`mark.svg stars missing: ${starCircles} candidates`)
} catch (e) {
  fail(`mark.svg unreadable: ${e.message}`)
}

/*
 * The greeting and the predicate behind it must agree.
 *
 * The front door asks `hasFlown()` whether a returning visitor has a logbook
 * and then prints `logbookLine()`. Those were two different definitions of
 * "has flown": the predicate counted one pad and one personal best, the line
 * counted pads only from the second and bests not at all. A browser holding
 * exactly one pad therefore read, in ember, on the live site: **"Your
 * logbook: null"**. Anything `hasFlown` counts must be something the line can
 * say, and the cheapest way to hold that is to build each of those states and
 * check both answers together.
 */
{
  const states = [
    ['nothing at all', () => {}],
    ['one pad, and nothing else', (m) => m.recordPad('ksc')],
    ['one personal best, and nothing else', (m) => m.recordBest('touchdown-vertical', 4, { unit: 'm/s' })],
    ['one plate, and nothing else', (m) => m.recordPhotograph()],
    ['one film, and nothing else', (m) => m.recordFilm('apollo8-tli')],
    ['one milestone, and nothing else', (m) => m.recordMilestone('LIFTOFF', 0)],
  ]
  for (const [what, make] of states) {
    // `_installTestLogbook` drops the in-memory record; the *store* is what
    // `load()` reads next, so a genuinely pristine state needs both cleared.
    const back = lb._installTestLogbook()
    globalThis.localStorage?.removeItem?.('periapsis.logbook.v1')
    make(lb)
    const flown = lb.hasFlown()
    const line = lb.logbookLine()
    if (flown && !line) fail(`${what}: hasFlown() is true but logbookLine() is null — the front door prints "null"`)
    else if (!flown && line) fail(`${what}: logbookLine() has something to say but hasFlown() hides it`)
    else pass(`${what}: hasFlown()=${flown}, line=${JSON.stringify(line)}`)
    back()
  }
  globalThis.localStorage?.removeItem?.('periapsis.logbook.v1')
}

/* And the front door must not print a line it has not checked. */
{
  const landing = readFileSync(join(ROOT, 'src/ui/Title.jsx'), 'utf8')
  if (/hasFlown\(\)\s*\?\s*`Your logbook: \$\{logbookLine\(\)\}`/.test(landing))
    fail('Title.jsx interpolates logbookLine() without checking it for null')
  else pass('Title.jsx checks the line before printing it')
}

console.log(failures ? `\n  ${failures} failure${failures === 1 ? '' : 's'}` : '\n  PASS')
process.exit(failures ? 1 : 0)
