/**
 * What the simulator is running on, asked rather than sniffed.
 *
 * The same scene has to hold sixty frames a second on a desktop graphics card
 * and on a phone's integrated one, and the honest way to know which of those a
 * visitor has is to ask them once. A user agent can say "iPad" while reporting
 * itself as a Mac, a touch laptop is not a tablet, and a phone in landscape is
 * wider than some laptops — every heuristic below is a *suggestion* shown on the
 * first screen, and the answer the visitor gives is the one kept.
 *
 * The answer chooses two things. The **quality tier** — how many pixels are
 * drawn, how deep the procedural surfaces go, how many trees stand round a pad —
 * and the **layout**: thumb-sized controls and a collapsed instrument rail on a
 * phone, the tablet's middle ground, the full cockpit on a computer.
 *
 * The tier is read when things are *built*, not every frame, so it is a plain
 * object that `chooseDevice` updates in place before the scene mounts. Changing
 * it later reloads the page: a WebGL context's antialiasing is fixed when it is
 * created, and a forest is generated once.
 */

const KEY = 'pz-device'

/** The three answers, in the order the prompt shows them. */
export const DEVICE_IDS = ['phone', 'tablet', 'desktop']

/**
 * Quality tiers.
 *
 * `dpr` is the device-pixel-ratio range handed to the canvas: a phone's panel
 * is 3x and drawing every one of those pixels through an atmosphere shader is
 * nine times the fill of a 1x screen, so phones draw at up to 1.5 and let the
 * panel upscale. `octaves` bounds the procedural surface detail each planet's
 * shader adds as the camera closes in; `trees` and `grass` size the vegetation
 * round a pad; `stars` is the faintest Hipparcos magnitude loaded; `segments`
 * the tessellation of a planet's sphere; `shadow` the ground beam's shadow map.
 * The sky beyond the planets is ray-marched: `volumeScale` is the fraction of
 * the drawing buffer the galaxies and nebulae are marched at (and upscaled
 * from — they are soft), `volumeSteps` the most steps a ray takes, and
 * `skyCube`/`skySteps` the face size and step budget of the Milky Way seen from
 * inside, which is marched once into a cube map and kept — `skyTile` texels
 * square at a time, one tile a frame, so the march never costs a frame more
 * than a millisecond or two (measured: a 256-texel tile at 240 steps was 50 ms,
 * and the first sky took eleven seconds of 15 fps to finish).
 */
export const TIERS = {
  phone: {
    dpr: [1, 1.5],
    antialias: false,
    octaves: 4,
    segments: 64,
    stars: 8.5,
    trees: 5000,
    grass: 0,
    shadow: 1024,
    bloom: true,
    galaxyStars: 40000,
    clouds: 'low',
    volumeScale: 0.4,
    volumeSteps: 28,
    skyCube: 512,
    skySteps: 112,
    skyTile: 64,
  },
  tablet: {
    dpr: [1, 1.75],
    antialias: true,
    octaves: 6,
    segments: 96,
    stars: 10,
    trees: 14000,
    grass: 0.5,
    shadow: 2048,
    bloom: true,
    galaxyStars: 90000,
    clouds: 'high',
    volumeScale: 0.5,
    volumeSteps: 40,
    skyCube: 768,
    skySteps: 144,
    skyTile: 48,
  },
  desktop: {
    dpr: [1, 2],
    antialias: true,
    octaves: 8,
    segments: 160,
    stars: 11,
    trees: 36000,
    grass: 1,
    shadow: 4096,
    bloom: true,
    galaxyStars: 180000,
    clouds: 'high',
    volumeScale: 0.5,
    volumeSteps: 56,
    skyCube: 1024,
    skySteps: 176,
    skyTile: 64,
  },
}

/** What the prompt says about each, beside the button. */
export const DEVICE_COPY = {
  phone: {
    label: 'Phone',
    note: 'Thumb-sized controls, one column of instruments, a lighter scene that stays smooth.',
  },
  tablet: {
    label: 'iPad or tablet',
    note: 'Touch controls with room for the panels, and most of the detail.',
  },
  desktop: {
    label: 'Computer',
    note: 'Mouse and keyboard, the full cockpit, and every tree on the pad.',
  },
}

const read = () => {
  try {
    const v = globalThis.localStorage?.getItem(KEY)
    return DEVICE_IDS.includes(v) ? v : null
  } catch {
    return null
  }
}

/**
 * The best guess, for the prompt to highlight — never applied without asking.
 *
 * iPadOS reports a desktop Safari user agent, so a "Macintosh" with a touch
 * screen is an iPad; nothing Apple ships as a Mac has one.
 */
export function guessDevice() {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  const touch = (navigator.maxTouchPoints ?? 0) > 1
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Macintosh/i.test(ua) && touch) return 'tablet'
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet'
  if (/iPhone|iPod|Android.*Mobile|Windows Phone|Mobile/i.test(ua)) return 'phone'
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  if (coarse && typeof screen !== 'undefined') {
    return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet'
  }
  return 'desktop'
}

/** The stored answer, or null on a first visit. */
export const storedDevice = read

/**
 * The device the page is running as. Until the visitor answers, the guess —
 * which is only ever used by code that runs before the prompt, and nothing that
 * builds the scene does.
 */
export let DEVICE = read() ?? guessDevice()

/** The tier in force, mutated in place so every importer sees the answer. */
export const QUALITY = { ...TIERS[DEVICE] }

/** Whether the layout is a touch one. */
export const isTouchLayout = () => DEVICE !== 'desktop'

/**
 * Record the answer. Returns true when the page must reload for it to take —
 * that is, when the scene was already built for a different tier.
 */
export function chooseDevice(id, { built = false } = {}) {
  if (!DEVICE_IDS.includes(id)) throw new Error(`unknown device "${id}"`)
  try {
    globalThis.localStorage?.setItem(KEY, id)
  } catch {
    /* private mode: the answer holds for this visit */
  }
  const changed = id !== DEVICE
  DEVICE = id
  Object.assign(QUALITY, TIERS[id])
  return built && changed
}

/** Forget the answer, so the next load asks again. */
export function forgetDevice() {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    /* nothing stored */
  }
}
