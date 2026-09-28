/**
 * verify-search — the search bar says the right one of four things.
 *
 * A search box is the only part of this simulator with no physics to be held
 * against, which makes it the easiest part to break silently: a scoring rule
 * tightened to stop one bad match will happily stop fifty good ones, and
 * nothing will crash. So the behaviour is pinned here instead, as the four
 * answers `sim/catalog.js` can give (see `lookup`):
 *
 *   1. A name it has, typed correctly, resolves to that thing first.
 *   2. A name it has, mistyped, still resolves to that thing — a slip of one
 *      or two keys, a transposition, a missing letter.
 *   3. A name it knows of but has not built says so: Ceres, Voyager 1, a
 *      constellation. Which matters most in the negative — a name the
 *      catalogue *does* own must never be answered this way, and "Andromeda"
 *      is the galaxy rather than the constellation of the same name.
 *   4. Nonsense is told it is nonsense, and does not quietly return the entry
 *      that happens to share the most letters.
 *
 * Run against the real catalogue, cosmos included, because the interesting
 * failures are collisions between entries and there are 200-odd of them.
 */
import assert from 'node:assert/strict'
import { CATALOG, NO_MATCH, lookup, normalise, rank, typoDistance } from '../src/sim/catalog.js'
import { COMING_SOON, FICTION, NOT_REAL } from '../src/sim/comingSoon.js'
import '../src/sim/cosmos.js'

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

/** The names a result went by, for a readable failure. */
const shown = (r) => (r.missing ? `${r.status}:${r.missing.name}` : `${r.status}:${r.results.map((e) => e.name).join(', ') || '—'}`)

/** The query resolves to this entry id, and it is the first result. */
function resolves(query, id) {
  const r = lookup(query, 6)
  assert.equal(r.status, 'ok', `"${query}" → ${shown(r)}, wanted ok:${id}`)
  assert.equal(r.results[0]?.id, id, `"${query}" → ${shown(r)}, wanted ${id} first`)
}

/** The query is recognised as something the simulator has not got. */
function absent(query, name, status = 'soon') {
  const r = lookup(query, 6)
  assert.equal(r.status, status, `"${query}" → ${shown(r)}, wanted ${status}:${name}`)
  assert.equal(r.missing.name, name, `"${query}" → ${shown(r)}, wanted ${name}`)
}

/* ---------------------------------------------------------------- *
 * 1. Normalising, and the distance the fuzzy matching is built on
 * ---------------------------------------------------------------- */

check('normalise strips case, accents, punctuation and a leading "the"', () => {
  assert.equal(normalise('  The  Pleiades!  '), 'pleiades')
  assert.equal(normalise('Barnard’s Star'), 'barnards star')
  assert.equal(normalise('Boötes'), 'bootes')
  assert.equal(normalise('TRAPPIST-1e'), 'trappist 1e')
  assert.equal(normalise('47 Tuc'), '47 tuc')
})

check('typoDistance counts edits, transpositions included, and caps', () => {
  assert.equal(typoDistance('saturn', 'saturn'), 0)
  assert.equal(typoDistance('satrun', 'saturn'), 1, 'a transposition is one edit')
  assert.equal(typoDistance('jupitor', 'jupiter'), 1)
  assert.equal(typoDistance('nepchune', 'neptune'), 2)
  assert.equal(typoDistance('mars', 'mars'), 0)
  // Beyond the cap it stops counting rather than returning a real distance.
  assert.ok(typoDistance('mercury', 'neptune', 3) > 3)
})

/* ---------------------------------------------------------------- *
 * 2. Names the simulator has
 * ---------------------------------------------------------------- */

check('every catalogue entry is found by its own name', () => {
  const missed = []
  for (const e of CATALOG) {
    const r = rank(e.name, 8)
    if (!r.some((x) => x.e.id === e.id)) missed.push(e.name)
  }
  assert.deepEqual(missed, [], 'entries that do not find themselves')
})

check('every alias finds the entry that claims it', () => {
  const missed = []
  for (const e of CATALOG) {
    for (const a of e.aliases ?? []) {
      const r = rank(a, 12)
      if (!r.some((x) => x.e.id === e.id)) missed.push(`${e.name} ← "${a}"`)
    }
  }
  assert.deepEqual(missed, [], 'aliases that do not find their entry')
})

check('the obvious queries land on the obvious thing', () => {
  for (const [q, id] of [
    ['sun', 'sun'],
    ['earth', 'earth'],
    ['moon', 'moon'],
    ['mars', 'mars'],
    ['jupiter', 'jupiter'],
    ['neptune', 'neptune'],
    ['pluto', 'pluto'],
    ['io', 'io'],
    ['titan', 'titan'],
    ['iss', 'iss'],
    ['hubble', 'hubble'],
    ['chase', 'chase'],
    ['ground view', 'ground'],
    ['sirius', 'sirius'],
    ['betelgeuse', 'betelgeuse'],
    ['polaris', 'polaris'],
    ['vega', 'vega'],
    ['alpha centauri', 'alpha-centauri'],
    ['proxima centauri', 'proxima'],
    ['orion nebula', 'orion-nebula'],
    ['pillars of creation', 'eagle-nebula'],
    ['crab nebula', 'crab-nebula'],
    ['pleiades', 'pleiades'],
    ['seven sisters', 'pleiades'],
    ['andromeda', 'andromeda'],
    ['andromeda galaxy', 'andromeda'],
    ['whirlpool', 'whirlpool'],
    ['sombrero', 'sombrero'],
    ['large magellanic cloud', 'lmc'],
    ['milky way', 'milky-way'],
    ['black hole', 'sagittarius-a'],
    ['galactic centre', 'sagittarius-a'],
    ['virgo cluster', 'virgo-cluster'],
    ['universe', 'observable-universe'],
    ['oort cloud', 'oort-cloud'],
    ['heliosphere', 'heliosphere'],
    ['local group', 'local-group'],
    ['m42', 'orion-nebula'],
    ['m13', 'hercules-cluster'],
    ['47 tuc', '47-tucanae'],
  ]) {
    resolves(q, id)
  }
})

/* ---------------------------------------------------------------- *
 * 3. Mistyped, and still found
 * ---------------------------------------------------------------- */

check('a slip of the keyboard still finds the place', () => {
  for (const [q, id] of [
    ['jupitor', 'jupiter'],
    ['jupyter', 'jupiter'],
    ['satrun', 'saturn'],
    ['saturm', 'saturn'],
    ['nepchune', 'neptune'],
    ['neptun', 'neptune'],
    ['mercuy', 'mercury'],
    ['uranas', 'uranus'],
    ['erth', 'earth'],
    ['mooon', 'moon'],
    ['plut', 'pluto'],
    ['titen', 'titan'],
    ['europah', 'europa'],
    ['ganymeade', 'ganymede'],
    ['callsto', 'callisto'],
    ['sirus', 'sirius'],
    ['betelguese', 'betelgeuse'],
    ['polaries', 'polaris'],
    ['proxma', 'proxima'],
    ['androemda', 'andromeda'],
    ['andromida', 'andromeda'],
    ['orian nebula', 'orion-nebula'],
    ['arion nebula', 'orion-nebula'],
    ['pliades', 'pleiades'],
    ['crab nebua', 'crab-nebula'],
    ['ring nebual', 'ring-nebula'],
    ['eagel nebula', 'eagle-nebula'],
    ['whirpool', 'whirlpool'],
    ['sombrerro', 'sombrero'],
    ['milkey way', 'milky-way'],
    ['univrse', 'observable-universe'],
    ['helosphere', 'heliosphere'],
    ['oort clowd', 'oort-cloud'],
    ['hubbel', 'hubble'],
    ['blackhole', 'sagittarius-a'],
    ['chas', 'chase'],
    ['groud', 'ground'],
    ['fley', 'fly'],
  ]) {
    resolves(q, id)
  }
})

check('every planet survives one deleted letter, wherever it falls', () => {
  for (const name of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    for (let i = 0; i < name.length; i++) {
      const q = name.slice(0, i) + name.slice(i + 1)
      const r = lookup(q, 6)
      assert.ok(
        r.results.some((e) => e.id === name),
        `"${q}" (${name}, letter ${i + 1} dropped) → ${shown(r)}`,
      )
    }
  }
})

/* ---------------------------------------------------------------- *
 * 4. Names it knows of and has not built
 * ---------------------------------------------------------------- */

check('the catalogue keeps every name it owns', () => {
  // The whole hazard of a coming-soon list: "Andromeda" is a constellation as
  // well as a galaxy, "Hercules" a constellation as well as a cluster, and the
  // thing the simulator can actually fly to must win every one of them.
  for (const [q, id] of [
    ['andromeda', 'andromeda'],
    ['orion', 'orion-nebula'],
    ['hercules', 'hercules-cluster'],
    ['sagittarius', 'sagittarius-a'],
    ['carina', 'carina-nebula'],
    ['draco', 'draco-dwarf'],
    ['virgo', 'virgo-cluster'],
    ['perseus', 'perseus-cluster'],
    ['tucana', '47-tucanae'],
    ['centaurus', 'centaurus-a'],
    ['sculptor', 'sculptor-dwarf'],
    ['fornax', 'fornax-cluster'],
    ['norma', 'norma-cluster'],
    ['triangulum', 'triangulum'],
  ]) {
    resolves(q, id)
  }
})

check('no unbuilt name shadows a catalogue entry', () => {
  // Every name and alias in the catalogue, asked for as typed, must come back
  // as something to fly to rather than as a promise.
  const shadowed = []
  for (const e of CATALOG) {
    for (const name of [e.name, ...(e.aliases ?? [])]) {
      const r = lookup(name, 6)
      if (r.status !== 'ok') shadowed.push(`"${name}" (${e.name}) → ${shown(r)}`)
    }
  }
  assert.deepEqual(shadowed, [], 'catalogue names answered as unbuilt')
})

check('an unbuilt name is recognised and named', () => {
  for (const [q, name] of [
    ['ceres', 'Ceres'],
    ['eris', 'Eris'],
    ['makemake', 'Makemake'],
    ['triton', 'Triton'],
    ['enceladus', 'Enceladus'],
    ['charon', 'Charon'],
    ['iapetus', 'Iapetus'],
    ['mimas', 'Mimas'],
    ['rhea', 'Rhea'],
    ['titania', 'Titania'],
    ['miranda', 'Miranda'],
    ['vesta', 'Vesta'],
    ['bennu', 'Bennu'],
    ['ryugu', 'Ryugu'],
    ['psyche', 'Psyche'],
    ['asteroid belt', 'Asteroid belt'],
    ['oumuamua', 'ʻOumuamua'],
    ['hale bopp', 'Hale–Bopp'],
    ['voyager', 'Voyager 1'],
    ['voyager 2', 'Voyager 2'],
    ['new horizons', 'New Horizons'],
    ['cassini', 'Cassini'],
    ['curiosity', 'Curiosity'],
    ['perseverance', 'Perseverance'],
    ['parker solar probe', 'Parker Solar Probe'],
    ['apollo 13', 'Apollo 13'],
    ['james webb', 'James Webb Space Telescope'],
    ['jwst', 'James Webb Space Telescope'],
    ['gaia', 'Gaia'],
    ['vera rubin', 'Vera Rubin Observatory'],
    ['sputnik', 'Sputnik 1'],
    ['skylab', 'Skylab'],
    ['tiangong', 'Tiangong'],
    ['starlink', 'Starlink'],
    ['proxima b', 'Proxima Centauri b'],
    ['trappist 1e', 'TRAPPIST-1e'],
    ['kepler 452b', 'Kepler-452b'],
    ['51 pegasi b', '51 Pegasi b'],
    ['sirius b', 'Sirius B'],
    ['tarantula nebula', 'Tarantula Nebula'],
    ['cats eye nebula', 'Cat’s Eye Nebula'],
    ['beehive', 'Beehive Cluster'],
    ['antennae', 'Antennae Galaxies'],
    ['stephans quintet', 'Stephan’s Quintet'],
    ['bootes void', 'Boötes Void'],
    ['cassiopeia', 'Cassiopeia'],
    ['ursa major', 'Ursa Major'],
    ['big dipper', 'Ursa Major'],
    ['wormhole', 'Wormhole'],
    ['dark matter', 'Dark matter'],
  ]) {
    absent(q, name)
  }
})

check('an unbuilt name survives a typo too', () => {
  for (const [q, name] of [
    ['enceladas', 'Enceladus'],
    ['voyger', 'Voyager 1'],
    ['curiousity', 'Curiosity'],
    ['tarantual nebula', 'Tarantula Nebula'],
    ['cerese', 'Ceres'],
    ['makemke', 'Makemake'],
  ]) {
    absent(q, name)
  }
})

check('the unbuilt list is well formed, and says which kind of answer it is', () => {
  const seen = new Set()
  for (const e of [...COMING_SOON, ...FICTION]) {
    assert.ok(e.name && e.name.length > 1, `a nameless entry: ${JSON.stringify(e)}`)
    assert.ok(e.hint && e.hint.length > 3, `${e.name} has no line to read`)
    assert.ok(['coming soon', 'not a place', 'not real'].includes(e.label), `${e.name}: label "${e.label}"`)
    assert.ok(Array.isArray(e.aliases), `${e.name}: aliases`)
    const key = normalise(e.name)
    assert.ok(!seen.has(key), `${e.name} is in the list twice`)
    seen.add(key)
  }
  assert.ok(COMING_SOON.length > 250, `only ${COMING_SOON.length} unbuilt names`)
})

check('every unbuilt name is recognised by its own name and aliases', () => {
  // A name in the list that the matcher cannot reach is worse than absent: it
  // reads as covered and behaves as nonsense.
  const unreachable = []
  for (const e of [...COMING_SOON, ...FICTION]) {
    for (const q of [e.name, ...e.aliases]) {
      const r = lookup(q, 6)
      if (r.status === 'ok') continue // the catalogue took it, which is allowed
      if (r.missing?.name !== e.name) unreachable.push(`"${q}" (${e.name}) → ${shown(r)}`)
    }
  }
  assert.deepEqual(unreachable, [], 'unbuilt names the matcher cannot reach')
})

check('invented places are answered as invented', () => {
  for (const [q, name] of [
    ['tatooine', 'Tatooine'],
    ['death star', 'Death Star'],
    ['millennium falcon', 'Millennium Falcon'],
    ['arrakis', 'Arrakis'],
    ['krypton', 'Krypton'],
    ['gargantua', 'Gargantua'],
    ['nibiru', 'Nibiru'],
    ['planet x', 'Nibiru'],
    ['ufo', 'Aliens'],
    ['warp drive', 'Hyperspace'],
  ]) {
    absent(q, name, 'fiction')
  }
  assert.equal(lookup('tatooine').missing.hint, NOT_REAL)
})

/* ---------------------------------------------------------------- *
 * 5. Nonsense
 * ---------------------------------------------------------------- */

check('nonsense is told so, rather than answered with the nearest letters', () => {
  for (const q of [
    'asdkjh',
    'zzzzz',
    'qwertyuiop',
    'xyzzy',
    'hjkl',
    'pizza',
    'minecraft',
    'xkcd7',
    '1234',
    '9999999',
    'aaaaaaaa',
    'ppppp',
    'wwwww',
  ]) {
    const r = lookup(q, 6)
    assert.equal(r.status, 'none', `"${q}" → ${shown(r)}`)
    assert.equal(r.note, NO_MATCH)
    assert.equal(r.results.length, 0)
  }
})

check('punctuation alone, and filler alone, are answered', () => {
  for (const q of ['!!!!', '...', '???', 'go to', 'show me', '   %  ']) {
    const r = lookup(q, 6)
    assert.equal(r.status, 'none', `"${q}" → ${shown(r)}`)
    assert.equal(r.note, NO_MATCH)
  }
})

check('an empty box is a blank slate, not a failure', () => {
  for (const q of ['', '   ']) {
    const r = lookup(q, 6)
    assert.equal(r.status, 'idle', `"${q}" → ${shown(r)}`)
    assert.equal(r.note, null)
  }
})

check('a random string of letters is almost never a place', () => {
  // The scoring is deliberately forgiving, so the question is how forgiving:
  // sample the space of plausible-looking nonsense and count what gets through.
  let seed = 20260927
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  let answered = 0
  const examples = []
  for (let i = 0; i < 600; i++) {
    let q = ''
    const len = 5 + Math.floor(rnd() * 5)
    for (let j = 0; j < len; j++) q += letters[Math.floor(rnd() * 26)]
    const r = lookup(q, 3)
    if (r.status !== 'none') {
      answered++
      if (examples.length < 8) examples.push(`${q} → ${shown(r)}`)
    }
  }
  assert.ok(answered <= 30, `${answered}/600 random strings matched something: ${examples.join('; ')}`)
})

/* ---------------------------------------------------------------- *
 * 6. Order
 * ---------------------------------------------------------------- */

check('a thing outranks the things that merely mention it', () => {
  resolves('pleiades', 'pleiades')
  resolves('alpha centauri', 'alpha-centauri')
  resolves('sagittarius a', 'sagittarius-a')
  // A short name is not buried by a long one that contains it.
  resolves('io', 'io')
  resolves('mars', 'mars')
  resolves('vega', 'vega')
})

check('a phrase beats its words', () => {
  resolves('moons of jupiter', 'io')
  resolves('red planet', 'mars')
  resolves('nearest star', 'proxima')
  resolves('ice giant', 'uranus')
})

console.log(`\n${n} checks pass — the search answers ${CATALOG.length} places, knows of ${COMING_SOON.length} more, and admits when it does not know.`)
