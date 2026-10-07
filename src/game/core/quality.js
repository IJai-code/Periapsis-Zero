/**
 * How much of the game a machine is asked to draw, and the evidence for it.
 *
 * There are two ways of drawing it. `high` keeps bloom, shadow mapping, the
 * full star catalogue and six octaves of noise in the Earth's air and cloud;
 * `low` gives those up and takes a lower pixel ceiling instead. Nothing else
 * changes: the ships, the bay, the film's six shots, the simulation and the
 * whole campaign are identical. This is a picture dial, never a content
 * switch, and the campaign is gated on the same physics at both settings.
 *
 * Which one a machine got used to be decided once, four seconds into the
 * first flight, by a private frame counter in the interface. That was too
 * late and too narrow. The film runs before it, two minutes every player
 * watches on the device in their hands; the bay is drawn before it; and a
 * machine that had to be rescued was measured only after it had already
 * shown the player a stutter. So the evidence is gathered where it actually
 * exists:
 *
 *   Before a frame. `probeDevice` asks the browser what the machine is — a
 *   software rasteriser, four cores, four gigabytes, a phone-sized screen at
 *   three device pixels each — and `deviceTier` turns that into a first
 *   guess. A guess, because all of it is a proxy, and a guess only: the
 *   player can overrule it, and the game measures afterwards anyway. Where
 *   there is no evidence the guess is `high`, because quietly degrading a
 *   machine that never said it was slow is the worse mistake of the two.
 *
 *   During the film. Every frame of the film is timed, once its own ships
 *   have arrived from the wire and a couple of seconds have passed without a
 *   stall, and a film that cannot hold any of it spends its own last rung:
 *   bloom and the extra sky detail go, one way, and the pixels are already at
 *   their floor. What the film does *not* do is say anything about the game.
 *   Measured on one machine, the film's windows run at 26 to 33 ms where the
 *   game canvas holds 16.7 ms, because the film is two full-screen six-octave
 *   Earth shaders and a bloom pass and the game is hulls in a bay.
 *
 *   During play. One checkpoint a few seconds in, reading the same frame
 *   sampler the resolution governor steers by, on the canvas that is actually
 *   being played. Slow drops to Fast and remembers; comfortable lifts a
 *   machine that was guessed Fast back to High for this session, so a bad
 *   guess costs a few seconds and never a permanent downgrade.
 *
 * The player's own choice in Settings lives under its own key and outranks
 * all of it, forever. The learned value only ever answers "no choice yet".
 */

/** The player's choice ('high' | 'low'), written by Settings. */
export const CHOICE_KEY = 'pz-game-quality'
/** What the frames taught us ('high' | 'low'), written by the learners below. */
export const TIER_KEY = 'pz-game-tier'

/**
 * What each tier means. One table, read by the game canvas, the film canvas
 * and the sky, because three private copies of "what does Fast give up" is
 * three chances to disagree about it.
 *
 * `dpr` and `filmDpr` are the *ceilings* the canvas opens with; both scenes
 * measure their own frames and move the ratio from there, so a tier is a
 * starting point and not a sentence. Their floors are the rescue: a machine
 * is only ever held at 0.5 device pixels per CSS pixel after six seconds of
 * frames that were long at 0.7, which is a machine being rescued and not one
 * being punished. `segments` is the sphere both the sky and the film draws
 * the Earth with; a coarser one costs vertices on every distant body at once
 * and is invisible at the distances those bodies are seen from. `power` is
 * the context's power preference: asking a laptop for the discrete GPU to
 * draw a film with no bloom in it is battery spent for nothing.
 */
export const TIERS = {
  high: {
    name: 'High', bloom: true, shadows: true, antialias: true, environment: true,
    dpr: [1, 1.75], filmDpr: [0.8, 1.3], debris: 100, stars: 7.8, octaves: 6, segments: [128, 96], power: 'high-performance',
  },
  low: {
    name: 'Fast', bloom: false, shadows: false, antialias: false, environment: false,
    dpr: [0.5, 1], filmDpr: [0.5, 1], debris: 40, stars: 6.5, octaves: 3, segments: [96, 64], power: 'default',
  },
}

/** The table row for a tier name; anything unknown is High. */
export const tierOf = (q) => TIERS[q] ?? TIERS.high

/**
 * Below this many milliseconds a frame (about 29 fps) the extra picture is not
 * worth it. It sits under 33 ms deliberately: a display locked to 30 Hz reports
 * a 33.3 ms frame, which is a capped machine and not a slow one, and quietly
 * dropping it to Fast would be a wrong answer to a question it did not ask.
 */
export const DROP_MS = 34
/** Slower than this and the film spends its own last rung: a stall, not a pace. */
export const STALL_MS = 40
/**
 * Longer than this and a frame is an *event*: a shader compiling, a texture
 * decoding, four megabytes of ships being parsed, a collection. Twelve of them
 * spread through a first visit are a cold cache and not a machine's pace, so
 * one on its own is ignored and restarts the settle window. Three in a row
 * are not an event at all: they are a machine drawing at ten frames a second,
 * and they count.
 */
export const EVENT_MS = 100
/** The film's first seconds pay for decoding its models; nothing is decided before this. */
const FILM_SETTLE_MS = 2500
/** Frames per decision window, in both the film and the checkpoint. */
export const WINDOW = 60

const STORE = { CHOICE_KEY, TIER_KEY }

const read = (key) => {
  try {
    const v = localStorage.getItem(key)
    return v === 'high' || v === 'low' ? v : null
  } catch { return null }
}
const write = (key, value) => { try { localStorage.setItem(key, value) } catch { /* private mode */ } }

export const readChoice = () => read(STORE.CHOICE_KEY)
export const readTier = () => read(STORE.TIER_KEY)
/** Remember a lesson from the frames. */
export const rememberTier = (q) => write(STORE.TIER_KEY, q)
/** Remember the player's own choice; this one wins over every lesson. */
export const writeChoice = (q) => write(STORE.CHOICE_KEY, q)

/**
 * What the game should draw first: a choice beats a lesson, and a lesson
 * beats a guess.
 */
export function initialQuality(probe) {
  return readChoice() ?? readTier() ?? deviceTier(probe ?? probeDevice())
}

/* ------------------------------------------------------------------ *
 * The guess, before a frame has been drawn
 * ------------------------------------------------------------------ */

/**
 * What the browser will say about this machine, synchronously, using its own
 * WebGL context. The context is dropped on the way out: a probe must not cost
 * the machine a second one, and browsers cap how many exist.
 *
 * `screenPixels` counts *device* pixels of the window, because that is what
 * the canvas asks for: a phone with a 390 x 844 CSS viewport at ratio 3 is
 * drawing 2.9 megapixels, more than a 1080p monitor, and it is doing it on a
 * battery in a hand.
 */
export function probeDevice(gl) {
  const nav = typeof navigator === 'undefined' ? {} : navigator
  const win = typeof window === 'undefined' ? {} : window
  let renderer = ''
  let context = gl ?? null
  const owned = !context && typeof document !== 'undefined'
  if (owned) {
    try { context = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl') } catch { context = null }
  }
  if (context) {
    try {
      const dbg = context.getExtension('WEBGL_debug_renderer_info')
      renderer = String((dbg ? context.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER)) ?? '')
    } catch { renderer = '' }
  }
  if (owned && context) { try { context.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* fine */ } }
  const media = win.matchMedia ? (q) => { try { return win.matchMedia(q).matches } catch { return false } } : () => false
  const dpr = win.devicePixelRatio || 1
  return {
    renderer,
    // Only explicit software markers. "ANGLE (Google, ...)" is *not* one: real
    // Mali and Adreno phones report through ANGLE too, and reading their vendor
    // as software would downgrade most of the phones the game should serve.
    software: /swiftshader|llvmpipe|softpipe|software rasterizer|basic render|microsoft basic|mesa offscreen/i.test(renderer),
    cores: nav.hardwareConcurrency || 0,
    memory: nav.deviceMemory || 0,
    screenPixels: (win.innerWidth || 0) * (win.innerHeight || 0) * dpr * dpr,
    coarse: media('(pointer: coarse)'),
    reduced: media('(prefers-reduced-motion: reduce)'),
  }
}

/**
 * The guess itself, pure so the gate can hold it. Every rule is a proxy, and
 * every one of them is overrulable by the player or by measured frames, so
 * the cost of a wrong guess is bounded at a few seconds of Fast.
 */
export function deviceTier(probe) {
  if (!probe) return 'high'
  if (probe.software) return 'low'
  if (probe.cores && probe.cores <= 4) return 'low'
  if (probe.memory && probe.memory <= 4) return 'low'
  if (probe.coarse && probe.screenPixels >= 2.0e6) return 'low'
  return 'high'
}

/* ------------------------------------------------------------------ *
 * The film's lesson
 * ------------------------------------------------------------------ */

/**
 * The film's learner: one window of frames in, "this machine is slow" out,
 * decided at most once and remembered. Allocation-free and called from the
 * frame path, so it is two number writes and a comparison.
 *
 * Frames longer than a quarter second are stalls, not pace — a shader
 * compiling, a model arriving, a tab returning — and are ignored: a film
 * that loads 2 MB of ships during its first seconds must not condemn the
 * machine that drew them.
 */
/**
 * How many windows in a row have to be slow before the film spends its own
 * last rung.
 *
 * One is not enough: a window can catch the tail of a texture decode, a
 * screenshot, or a collection. Three in a row is 180 frames — six seconds of
 * a film running at thirty — which is a pace and not a stumble. It is the
 * same discipline the surface governor uses for a merely slow window.
 *
 * Note what this no longer buys: the film's verdict is not written to storage
 * and the game does not inherit it. Measured on one machine, the film's own
 * windows run at 26 to 33 ms while the game canvas on the same machine holds
 * 16.7 ms, because the film is two full-screen six-octave Earth shaders and a
 * bloom pass and the game is hulls in a bay. A heavier canvas cannot be the
 * benchmark for a lighter one, so the game is judged by its own frames, at
 * the checkpoint, and the film only ever tunes itself.
 */
export const FILM_NEED = 3

const FILM_MODELS = ['freighter', 'kestrel', 'hearth', 'raider']
const film = { buf: new Float32Array(WINDOW), n: 0, settle: FILM_SETTLE_MS, long: 0, decided: false, pace: 0, slow: 0, windows: 0 }

/**
 * The middle of a window, in place and allocating nothing.
 *
 * A window's *mean* is the wrong statistic here, and a live run proved it: on
 * a first visit the film is still downloading four megabytes of ships and
 * textures while it plays, and a cold cache puts a minority of very long
 * frames into an otherwise perfect window. A mean carries those straight into
 * the verdict and condemned a machine that was drawing 60 frames a second; a
 * median ignores them, because they are not the majority of the frames.
 */
function medianInPlace(b, n) {
  for (let i = 1; i < n; i++) {
    const v = b[i]
    let j = i - 1
    while (j >= 0 && b[j] > v) { b[j + 1] = b[j]; j-- }
    b[j + 1] = v
  }
  return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2
}

/**
 * Record one film frame. Returns true the moment the machine is condemned.
 *
 * `settling` is the caller's answer to a question the learner cannot ask:
 * are the film's own ships and worlds still arriving? Nothing is measured
 * while they are, and the settle window starts again when they land, because
 * a machine is not slow for reading a file.
 */
export function noteFilmFrame(ms, settling = false) {
  if (film.decided || !(ms > 0)) return false
  if (ms > EVENT_MS) {
    if (++film.long < 3) { film.settle = FILM_SETTLE_MS; return false }
    ms = Math.min(ms, 1000)
  } else film.long = 0
  if (settling) { film.n = 0; film.settle = FILM_SETTLE_MS; return false }
  if (film.settle > 0) { film.settle -= ms; return false }
  film.buf[film.n++] = ms
  if (film.n < WINDOW) return false
  const middle = medianInPlace(film.buf, WINDOW)
  film.n = 0
  film.windows++
  film.pace = middle
  // The film's running trend, and the whole of its verdict: nothing here
  // reaches storage, and the game is never told about it.
  film.slow = middle <= DROP_MS ? 0 : film.slow + 1
  return film.slow >= FILM_NEED
}

/** Windows slower than the budget in a row; the film's running verdict. */
export const filmSlowRun = () => film.slow
/** How many windows the film has judged at all. */
export const filmWindowCount = () => film.windows

/** Whether the film has all of its own ships and worlds in hand yet. */
export const filmModelsReady = (has) => FILM_MODELS.every(has)

/** The film's last measured pace in ms a frame, or 0 before a window has closed. */
export const filmPace = () => film.pace

/** Forget the film's learner: a replay is a fresh measurement. */
export function resetFilmLearner() {
  film.n = 0; film.long = 0; film.settle = FILM_SETTLE_MS; film.decided = false; film.pace = 0; film.slow = 0; film.windows = 0
}

/* ------------------------------------------------------------------ *
 * The film's own last rung
 * ------------------------------------------------------------------ */

/**
 * Whether the film should give up bloom and the extra sky detail mid-shot,
 * pure so the gate can hold it: FILM_NEED windows slow in a row, and the
 * pixels already at their floor, and nothing spent before.
 *
 * One-way on purpose. The film's resolution governor already moves pixels,
 * and it is the right first answer: a softer picture beats a stuttering one.
 * This fires only when the pixels are at the floor and the frames are still
 * long, and there is no path back up, because a film that changes its mind
 * about how it is drawn twice in two minutes is worse than either answer.
 */
export function filmDegrade(slowWindows, dpr, spent) {
  return !spent && slowWindows >= FILM_NEED && dpr <= 0.72 ? 'low' : null
}

/* ------------------------------------------------------------------ *
 * The checkpoint during play
 * ------------------------------------------------------------------ */

/**
 * The one decision the game makes about itself, pure so the gate can hold it:
 * a few seconds of measured play go in, the tier to use comes out.
 *
 * `explicit` is the player's own choice: when it is set the game does not
 * argue, ever. `learned` is a lesson already in storage, from the film or a
 * previous session; a machine that was *taught* Fast is not lifted back to
 * High by a few cheap frames of Fast flight, because those frames are exactly
 * what Fast is made of.
 *
 * `remember` is only ever true for a downgrade. A downgrade is a fact about
 * the hardware and belongs in storage; a lift is an experiment for this
 * session, and an experiment that fails should not be remembered as one that
 * worked.
 */
export function checkpointTier(current, meanMs, { explicit = false, learned = null, measured = true } = {}) {
  if (explicit) return { tier: current, remember: false, reason: 'chosen' }
  if (!measured) return { tier: current, remember: false, reason: 'none' }
  if (meanMs > DROP_MS) {
    return current === 'low' ? { tier: 'low', remember: false, reason: 'none' } : { tier: 'low', remember: true, reason: 'slow' }
  }
  if (meanMs < 17.2 && current === 'low' && !learned) return { tier: 'high', remember: false, reason: 'headroom' }
  return { tier: current, remember: false, reason: 'none' }
}
