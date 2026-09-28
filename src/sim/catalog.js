import { BODIES, SHIP, CRAFT, AU } from './constants.js'
import { RAILS } from './rails.js'
import { PRESETS, presetHref } from './presets.js'
import { ALL_SITES, activeSite } from './launchsite.js'
import { ACTIVE_VESSEL } from './vessels.js'
import { COMING_SOON, FICTION, NOT_REAL } from './comingSoon.js'

/**
 * Everything the search bar can take you to.
 *
 * One flat list, because a search does not care which part of the simulator a
 * name belongs to: "Io" is a moon on rails, "ISS" a test particle in the state
 * vector, "chase" a way of holding the camera, "Sirius" a star 8.6 light-years
 * out and "Apollo 11" a mission that reloads the page. Each entry says what it
 * is, gives a line to read beside it, and names what choosing it does:
 *
 *   { focus: id }     lock the camera onto it — the rig flies there
 *   { href: url }     a link: a mission, or a pad this page was not loaded at
 *
 * The solar system's entries are derived from the tables that already define
 * those bodies, so a moon added to `rails.js` is searchable without a second
 * list. The sky beyond the planets registers itself through `addEntries`.
 */

const fmtAU = (m) => {
  const au = m / AU
  return au < 0.1 ? `${(m / 1e9).toFixed(1)} million km` : `${au < 10 ? au.toFixed(2) : au.toFixed(1)} AU`
}

/** Kinds, in the order a tie is broken — and the glyph and label the list shows. */
export const KINDS = {
  star: { label: 'Star', rank: 9 },
  planet: { label: 'Planet', rank: 10 },
  dwarf: { label: 'Dwarf planet', rank: 7 },
  moon: { label: 'Moon', rank: 8 },
  comet: { label: 'Comet', rank: 6 },
  craft: { label: 'Spacecraft', rank: 8 },
  view: { label: 'Camera', rank: 7 },
  site: { label: 'Launch site', rank: 5 },
  mission: { label: 'Mission', rank: 6 },
  nebula: { label: 'Nebula', rank: 5 },
  cluster: { label: 'Star cluster', rank: 5 },
  galaxy: { label: 'Galaxy', rank: 6 },
  region: { label: 'Region', rank: 6 },
}

/** What kind of world each rail body is, and the line it gets. */
const RAIL_KIND = {
  mercury: ['planet', 'Innermost planet', ['first planet']],
  venus: ['planet', 'Cloud-wrapped, hotter than Mercury', ['evening star', 'morning star', 'second planet']],
  mars: ['planet', 'The red planet', ['red planet', 'fourth planet']],
  jupiter: ['planet', 'Gas giant · the Great Red Spot', ['gas giant', 'fifth planet', 'jove']],
  saturn: ['planet', 'Gas giant · the rings', ['rings', 'ringed planet', 'sixth planet']],
  uranus: ['planet', 'Ice giant on its side', ['ice giant', 'seventh planet']],
  neptune: ['planet', 'Ice giant · outermost planet', ['eighth planet', 'blue planet']],
  pluto: ['dwarf', 'Dwarf planet · the heart', ['dwarf planet', 'kuiper belt']],
  halley: ['comet', 'Period 75 years · next perihelion 2061', ['halley', 'halleys comet', 'comet']],
  phobos: ['moon', 'Inner moon of Mars', []],
  deimos: ['moon', 'Outer moon of Mars', []],
  io: ['moon', 'Jupiter · volcanic', ['galilean']],
  europa: ['moon', 'Jupiter · an ocean under ice', ['galilean']],
  ganymede: ['moon', 'Jupiter · largest moon in the system', ['galilean']],
  callisto: ['moon', 'Jupiter · the most cratered', ['galilean']],
  titan: ['moon', 'Saturn · a haze-wrapped world', []],
}

const base = [
  {
    id: 'sun',
    name: 'Sun',
    aliases: ['sol', 'the sun', 'star', 'our star'],
    kind: 'star',
    hint: 'G2V · 1.39 million km across',
    focus: 'sun',
    weight: 10,
  },
  {
    id: 'earth',
    name: 'Earth',
    aliases: ['terra', 'home', 'world', 'blue marble', 'third planet'],
    kind: 'planet',
    hint: 'Home · 1 AU',
    focus: 'earth',
    weight: 10,
  },
  {
    id: 'moon',
    name: 'Moon',
    aliases: ['luna', 'the moon', 'lunar'],
    kind: 'moon',
    hint: 'Earth · 384,400 km',
    focus: 'moon',
    weight: 10,
  },
  ...RAILS.map((p) => {
    const [kind, hint, aliases] = RAIL_KIND[p.id] ?? ['moon', '', []]
    const where = p.parent ? '' : ` · ${fmtAU(p.a[0] * AU)}`
    const parent = p.parent ? RAILS.find((r) => r.id === p.parent)?.name : null
    return {
      id: p.id,
      name: p.name,
      // A moon answers to its planet too: "moons of Jupiter", "mars moon".
      aliases: parent ? [...aliases, `${parent} moon`, `moon of ${parent}`] : aliases,
      kind,
      hint: `${hint}${kind === 'planet' || kind === 'dwarf' ? where : ''}`,
      focus: p.id,
      weight: kind === 'planet' ? 9 : 6,
    }
  }),
  {
    id: 'ship',
    name: SHIP.name,
    aliases: ['ship', 'vehicle', 'rocket', 'spacecraft', 'my ship', SHIP.lunar ? 'lm' : 'stack'],
    kind: 'craft',
    hint: 'The vehicle you are flying',
    focus: 'ship',
    weight: 9,
  },
  {
    id: 'iss',
    name: 'International Space Station',
    aliases: ['iss', 'space station', 'station'],
    kind: 'craft',
    hint: '400 km · 51.6°',
    focus: 'iss',
    weight: 8,
  },
  {
    id: 'hubble',
    name: 'Hubble Space Telescope',
    aliases: ['hubble', 'hst', 'telescope'],
    kind: 'craft',
    hint: '540 km · 28.5°',
    focus: 'hubble',
    weight: 8,
  },
  ...(CRAFT.target
    ? [
        {
          id: 'target',
          name: CRAFT.target.name,
          aliases: ['target', 'csm', 'command module'],
          kind: 'craft',
          hint: 'Waiting in lunar orbit',
          focus: 'target',
          weight: 8,
        },
      ]
    : []),

  /* Ways of holding the camera. */
  {
    id: 'chase',
    name: 'Chase camera',
    aliases: ['chase', 'hull', 'follow', 'behind'],
    kind: 'view',
    hint: 'Rides the hull',
    focus: 'chase',
    key: '6',
    weight: 7,
  },
  {
    id: 'ground',
    name: 'Ground view',
    aliases: ['ground', 'eye level', 'standing', 'surface', 'pad view'],
    kind: 'view',
    hint: SHIP.lunar ? 'Eye height · 30 m from the LM' : 'Eye height · 380 m from the pad',
    focus: 'ground',
    key: '0',
    weight: 7,
  },
  {
    id: 'pad',
    name: 'Tracking camera',
    aliases: ['pad', 'long lens', 'tracking', 'launch camera'],
    kind: 'view',
    hint: 'A long lens on the pad',
    focus: 'pad',
    weight: 5,
  },
  {
    id: 'fly',
    name: 'Fly freely',
    aliases: ['fly', 'free flight', 'wasd', 'explore'],
    kind: 'view',
    hint: 'WASD to move, drag to look',
    focus: 'fly',
    key: '9',
    weight: 6,
  },
  {
    id: 'free',
    name: 'Free orbit',
    aliases: ['free', 'unlocked', 'orbit camera'],
    kind: 'view',
    hint: 'Unlocked · drag to orbit, right-drag to pan',
    focus: 'free',
    key: '1',
    weight: 5,
  },

  /* The pads: the one this page stands on is a view; the others are links. */
  ...Object.values(ALL_SITES).map((s) => {
    const here = activeSite().id === s.id
    return {
      id: `site:${s.id}`,
      name: s.name,
      aliases: [s.id, s.body === 'moon' ? 'apollo 11 site' : 'launch pad', 'launch site'],
      kind: 'site',
      hint: here ? 'Where the vehicle stands · ground view' : `Open a flight from ${s.name}`,
      ...(here
        ? { focus: 'ground' }
        : {
            // A pad is where a vehicle stands, so the link brings one that
            // flies from there: the LM on the Moon, this vessel on Earth.
            href: `?site=${s.id}&vessel=${s.body === 'moon' ? 'apollo11' : SHIP.lunar ? 'apollo8' : ACTIVE_VESSEL}#flight`,
          }),
      weight: here ? 6 : 3,
    }
  }),

  /* The missions, by name — choosing one opens it. */
  ...PRESETS.map((p) => ({
    id: `mission:${p.id}`,
    name: p.title.replace(' · ', ' — '),
    aliases: [p.title, p.vessel, p.id.replace(/-/g, ' ')],
    kind: 'mission',
    hint: p.blurb,
    href: presetHref(p),
    weight: 5,
  })),
]

/** The whole catalogue. Appended to by the cosmos when it loads. */
export const CATALOG = [...base]

/** Register more places — the sky beyond the planets does, at load. */
export function addEntries(entries) {
  for (const e of entries) {
    if (!CATALOG.some((c) => c.id === e.id)) CATALOG.push(e)
  }
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/** Lower case, no accents, no punctuation, single spaces, no leading "the". */
export function normalise(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

/** Optimal-string-alignment distance (Damerau–Levenshtein without reuse), capped. */
export function typoDistance(a, b, cap = 3) {
  const n = a.length
  const m = b.length
  if (Math.abs(n - m) > cap) return cap + 1
  let prev2 = null
  let prev = Array.from({ length: m + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      cur[j] = v
      if (v < best) best = v
    }
    if (best > cap) return cap + 1
    prev2 = prev
    prev = cur
  }
  return prev[m]
}

/**
 * Whether q is s clipped: its letters in order, starting where a word does and
 * staying close together. Both conditions are load-bearing. Without the word
 * anchor, "ceres" finds Her**c**ul**es** Clust**er**; without the span limit,
 * "triton" finds the **I**nte**r**na**t**i**o**nal Space Statio**n**. Neither
 * is a name being shortened, which is the only thing this rule is for.
 */
function subsequence(q, s) {
  for (let start = 0; start + q.length <= s.length; start++) {
    if (s[start] !== q[0] || (start > 0 && s[start - 1] !== ' ')) continue
    let i = 1
    let j = start + 1
    for (; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++
    if (i === q.length && j - start <= q.length * 2 + 2) return true
  }
  return false
}

/** The first letters of s's words — what an initialism is made of. */
function initials(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) if (i === 0 || s[i - 1] === ' ') out += s[i]
  return out
}

/**
 * How well a query matches one name, 0 for not at all. In order: the whole
 * name, a prefix of it, a prefix of one of its words, a phrase inside it, a
 * word of it, its initials, a slip of the keyboard, a slip that took the first
 * letter with it, a substring beginning mid-word, and the letters merely
 * appearing in order. Within each, shorter names win, so "io" finds Io before
 * it finds Callisto.
 */
function scoreName(q, name) {
  const n = normalise(name)
  if (!n) return 0
  if (n === q) return 1000
  if (n.startsWith(q)) return 820 - Math.min(60, n.length - q.length)
  const words = n.split(' ')
  if (words.some((w) => w.startsWith(q))) return 700 - Math.min(60, n.length - q.length)
  if (q.includes(' ') && n.includes(q)) return 640
  if (n.includes(q)) {
    // Where the match begins matters. "Tucana" begins a word of "47 Tucanae"
    // and is that cluster; "taurus" only sits inside "Cen*taurus* A", which is
    // coincidence — and scoring the two alike hands the constellation's name to
    // a galaxy 12 million light-years outside it.
    let boundary = false
    for (let i = n.indexOf(q); i >= 0 && !boundary; i = n.indexOf(q, i + 1)) boundary = i === 0 || n[i - 1] === ' '
    return (boundary ? 520 : 240) - Math.min(60, n.length - q.length)
  }
  // An initialism, for a name long enough to have earned one: "vla", "lmc".
  if (q.length >= 2 && words.length >= q.length) {
    const ini = initials(n)
    if (ini === q) return 600
    if (ini.startsWith(q)) return 470
  }
  // A slip of the keyboard keeps the first letter far more often than not, and
  // requiring it is what stops "moon" finding Venus by way of "morning star".
  if (q.length >= 3 && q[0] === n[0]) {
    const cap = q.length >= 7 ? 2 : 1
    let best = cap + 1
    best = Math.min(best, typoDistance(q, n.slice(0, q.length), cap))
    best = Math.min(best, typoDistance(q, n, cap))
    for (const w of words) {
      if (w[0] !== q[0]) continue
      best = Math.min(best, typoDistance(q, w, cap), typoDistance(q, w.slice(0, q.length), cap))
    }
    if (best <= cap) return 420 - best * 70
  }
  // A long enough query may miss even its first letter — "arion" for Orion —
  // but scores below a match that got the letter right, so it never wins a tie.
  if (q.length >= 5 && q[0] !== n[0]) {
    let best = 3
    best = Math.min(best, typoDistance(q, n, 2))
    for (const w of words) best = Math.min(best, typoDistance(q, w, 2))
    if (best <= 2) return 300 - best * 60
  }
  if (q.length >= 2 && subsequence(q, n)) return 200 - Math.min(80, n.length - q.length)
  return 0
}

/** Words that carry no name of their own: "take me to mars" is "mars". */
const STOP = new Set(['of', 'a', 'an', 'to', 'in', 'at', 'and', 'on', 'for', 'go', 'show', 'me', 'take'])

/** How well a query matches one entry, ignoring how interesting the entry is. */
function scoreEntry(q, words, e) {
  const names = [e.name, ...(e.aliases ?? [])]
  // A thing's own name outranks the same words as someone else's alias:
  // "pleiades" is the cluster first, and its sisters, who answer to it, after.
  let s = scoreName(q, e.name) * 1.03
  for (let i = 1; i < names.length; i++) s = Math.max(s, scoreName(q, names[i]))
  if (s === 0 && words.length > 1) {
    // Every word matched something of this entry's — "red planet mars", "moon
    // jupiter". Every word, because a query is a description and a word of it
    // that describes nothing here describes something else: "arion nebula" is
    // a misspelt Orion, not the six nebulae whose second word also reads
    // "nebula".
    let sum = 0
    for (const w of words) {
      let best = 0
      for (const name of names) best = Math.max(best, scoreName(w, name))
      if (best === 0) {
        sum = 0
        break
      }
      sum += best
    }
    s = sum > 0 ? 300 + sum / (words.length * 10) : 0
  }
  return s
}

/**
 * The catalogue, scored and sorted: `raw` is how well the name matched, `s` the
 * same with the entry's own pull added. The two are kept apart because a
 * decision about whether the catalogue has the thing at all must not be swayed
 * by how interesting its nearest miss happens to be (see `lookup`).
 */
export function rank(query, limit = 8) {
  const q = normalise(query)
  if (!q) return []
  const words = q.split(' ').filter((w) => !STOP.has(w))
  if (!words.length) return []
  const scored = []
  for (const e of CATALOG) {
    const raw = scoreEntry(q, words, e)
    if (raw > 0) scored.push({ e, raw, s: raw + (e.weight ?? 5) * 4 + (KINDS[e.kind]?.rank ?? 0) })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit)
}

/** Search the catalogue. Returns up to `limit` entries, best first. */
export function search(query, limit = 8) {
  return rank(query, limit).map((x) => x.e)
}

/* ------------------------------------------------------------------ *
 * What to say when there is nothing to fly to
 * ------------------------------------------------------------------ */

/**
 * A substring match or better means the catalogue owns the word, and nothing
 * outside it gets a say: "Andromeda" is the galaxy however well the
 * constellation of that name would have scored.
 */
const OWNED = 460
/** A real match rather than a coincidence — worth showing as an alternative. */
const REAL = 280
/** How far ahead an unbuilt name must be before it displaces the catalogue. */
const MARGIN = 40

export const NO_MATCH = 'Try exploring something else'
export { NOT_REAL }

/** The nearest name the simulator knows of but has not got. */
function nearestMissing(q, words) {
  let best = null
  for (const [list, fiction] of [
    [COMING_SOON, false],
    [FICTION, true],
  ]) {
    for (const e of list) {
      const raw = scoreEntry(q, words, e)
      if (raw > (best?.raw ?? REAL - 1)) best = { e, raw, fiction }
    }
  }
  return best
}

/**
 * What the search should say about a query. One of four answers, and the
 * difference between them is the whole point:
 *
 *   ok      the simulator has these — fly to any of them
 *   soon    it knows the name and has not built it: Ceres, Voyager 1, Cassiopeia
 *   fiction the name is not of this universe
 *   none    nothing recognised it
 *
 * A typo lands in `ok` on its own: `scoreName` tolerates a slip of one or two
 * keys, so "nepchune" and "androemda" are simply matches. `soon` and `fiction`
 * are consulted only where the catalogue has nothing solid, so a name the
 * simulator gains later stops being "coming soon" the moment it is added,
 * without anything being deleted from `comingSoon.js`.
 */
export function lookup(query, limit = 9) {
  const q = normalise(query)
  const words = q ? q.split(' ').filter((w) => !STOP.has(w)) : []
  // Nothing typed is a blank slate; typed punctuation, or nothing but "go to",
  // is a question that was asked and deserves an answer.
  if (!words.length) {
    const asked = String(query).trim().length > 0
    return { status: asked ? 'none' : 'idle', results: [], missing: null, note: asked ? NO_MATCH : null }
  }
  const ranked = rank(query, limit)
  // The best *match*, not the best-ranked entry: whether the catalogue owns a
  // word is a question about the word, not about which entry is most worth
  // visiting, and the two orders differ wherever an entry's own pull decides it.
  let best = 0
  for (const r of ranked) best = Math.max(best, r.raw)
  if (best < OWNED) {
    const miss = nearestMissing(q, words)
    if (miss && miss.raw > best + MARGIN) {
      return {
        status: miss.fiction ? 'fiction' : 'soon',
        note: null,
        missing: miss.e,
        // Only genuine near-misses keep it company; a coincidence is noise.
        results: ranked.filter((r) => r.raw >= REAL).map((r) => r.e),
      }
    }
  }
  if (!ranked.length) return { status: 'none', results: [], missing: null, note: NO_MATCH }
  return { status: 'ok', results: ranked.map((r) => r.e), missing: null, note: null }
}

/** What the list shows before anything is typed: the places people go first. */
export const SUGGESTED = [
  'sun',
  'earth',
  'moon',
  'mars',
  'jupiter',
  'saturn',
  'ship',
  'iss',
  'chase',
  'ground',
]

export const entryById = (id) => CATALOG.find((e) => e.id === id) ?? null

/** Distances for the hint line, shared with the cosmos entries. */
export { fmtAU }
export const EARTH_RADIUS = BODIES.earth.radius
