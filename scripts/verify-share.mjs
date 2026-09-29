/**
 * verify-share — a link to a place opens at that place.
 *
 * The search reaches two hundred-odd destinations and the only way to tell
 * someone about one of them used to be to describe the route. A link is worth
 * having only if it is exact: one that silently lands somewhere else teaches
 * people not to trust the next one, which is worse than not having them.
 *
 * So this holds the round trip — every place the search can reach produces an
 * address, and that address names that place back — and the two ways it can be
 * wrong. A link must not lose the flight it was taken during, because the same
 * view of a pad means nothing without the vehicle standing on it. And a name
 * this build does not know must not be obeyed: an address is something a person
 * was sent or typed, and a warning with the default beats a blank page.
 *
 * `window` is stubbed rather than mocked away, because what is under test is
 * how these functions read and write a real address.
 */
import assert from 'node:assert/strict'

/** A page at a given address, for functions that read `window.location`. */
function at(href) {
  const url = new URL(href)
  globalThis.window = { location: { href: url.href, search: url.search } }
}
at('https://periapsiszero.dev/?preset=apollo8-launch&vessel=apollo8&site=ksc#flight')

const { CATALOG } = await import('../src/sim/catalog.js')
await import('../src/sim/cosmos.js')
const { requestedFocus, viewHref, viewName } = await import('../src/sim/shareView.js')

let n = 0
const check = (label, fn) => {
  fn()
  n++
  console.log(`  ✓ ${label}`)
}

/** Everywhere the camera can actually be sent. */
const places = CATALOG.filter((e) => e.focus && !e.href)

check('there are places worth linking to', () => {
  assert.ok(places.length > 120, `only ${places.length} places take a camera`)
})

check('a link carries the flight it was taken during', () => {
  at('https://periapsiszero.dev/?preset=apollo8-launch&vessel=apollo8&site=ksc#flight')
  const href = viewHref('moon')
  const u = new URL(href)
  assert.equal(u.searchParams.get('preset'), 'apollo8-launch')
  assert.equal(u.searchParams.get('vessel'), 'apollo8')
  assert.equal(u.searchParams.get('site'), 'ksc')
  assert.equal(u.searchParams.get('focus'), 'moon')
  assert.equal(u.hash, '#flight', 'a link to a view is a link to a flight')
})

check('a link is absolute, so it survives being pasted anywhere', () => {
  at('https://periapsiszero.dev/?preset=apollo8-launch&vessel=apollo8&site=ksc#flight')
  const href = viewHref('mars')
  assert.match(href, /^https:\/\/periapsiszero\.dev\//, href)
})

check('the hash is added when the address arrived without one', () => {
  at('https://periapsiszero.dev/')
  assert.equal(new URL(viewHref('saturn')).hash, '#flight')
})

check('every place the camera can reach round-trips through an address', () => {
  const broken = []
  for (const e of places) {
    at('https://periapsiszero.dev/?preset=apollo8-launch&vessel=apollo8&site=ksc#flight')
    const href = viewHref(e.focus)
    at(href)
    const back = requestedFocus()
    if (back !== e.focus) broken.push(`${e.name}: wrote ${e.focus}, read back ${back}`)
  }
  assert.deepEqual(broken, [], 'places whose link does not name them back')
})

check('a name this build does not know is refused, not obeyed', () => {
  for (const bad of ['not-a-real-place', 'DROP TABLE', '../../etc', '', '   ', 'andromeda-galaxy-x']) {
    at(`https://periapsiszero.dev/?focus=${encodeURIComponent(bad)}#flight`)
    assert.equal(requestedFocus(), null, `"${bad}" was accepted`)
  }
})

check('an address with no place in it asks for nothing', () => {
  at('https://periapsiszero.dev/?preset=apollo8-launch#flight')
  assert.equal(requestedFocus(), null)
})

check('a link that is a link to a mission is never offered as a place', () => {
  // Missions reload the page; they are `href` entries and must not be written
  // into a `focus` parameter, which would name a camera target that is a link.
  at('https://periapsiszero.dev/#flight')
  for (const e of CATALOG.filter((x) => x.href)) {
    if (!e.focus) continue
    assert.fail(`${e.name} is both a link and a camera target`)
  }
})

check('a copied link can say what it is a link to', () => {
  for (const id of ['moon', 'mars', 'sagittarius-a', 'andromeda']) {
    const name = viewName(id)
    assert.ok(name && name.length > 1, `${id} has no name to confirm with`)
  }
  assert.equal(viewName('not-a-real-place'), null)
})

console.log(`\n${n} checks pass — all ${places.length} places round-trip, and an unknown one is refused.`)
