/**
 * A choice made from outside the app, before anything is built from it.
 *
 * Under Node that is an environment variable, so the headless harness can fly
 * any vessel from any pad without editing source —
 * `PERIAPSIS_VESSEL=artemis PERIAPSIS_SITE=kourou node scripts/flight.mjs`. In a
 * browser it is the page's query string, `?vessel=artemis&site=kourou`, which is
 * what makes a link to a particular flight possible.
 *
 * The two fail differently on purpose. An unknown name in the environment
 * throws: it is a developer's typo, and letting it resolve to `undefined` would
 * fail a hundred frames later inside the flight model instead of here. An
 * unknown name in an address does not throw: it is a link someone typed or was
 * sent, and a blank page is a worse answer to that than the default with a
 * warning.
 *
 * A worker has a `location` of its own — the worker script's, with none of the
 * page's query — so the address is read from `window` only, and a worker gets the
 * default. Nothing the capture worker computes depends on the vessel or the pad.
 */
export function requested(envKey, param, known, fallback, what) {
  const fromEnv = typeof process !== 'undefined' && process.env ? process.env[envKey] : undefined
  if (fromEnv) {
    if (!known[fromEnv]) {
      throw new Error(`unknown ${what} "${fromEnv}" — known: ${Object.keys(known).join(', ')}`)
    }
    return fromEnv
  }
  const search = typeof window !== 'undefined' && window.location ? window.location.search : ''
  const fromUrl = search ? new URLSearchParams(search).get(param) : null
  if (!fromUrl) return fallback
  if (known[fromUrl]) return fromUrl
  console.warn(
    `[periapsis] unknown ${what} "${fromUrl}" in the address; using ${fallback}. Known: ${Object.keys(known).join(', ')}`,
  )
  return fallback
}
