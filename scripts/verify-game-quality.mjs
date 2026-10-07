/**
 * The quality gate: a machine is only ever degraded on evidence.
 *
 * The game now decides how much picture to draw from three kinds of evidence
 * — what the browser says about the device before a frame is drawn, what the
 * opening film's own frames measured, and one checkpoint a few seconds into
 * play — and this gate holds all three to the promises their comments make.
 *
 * The guess must never fire without a signal: a machine that reports nothing
 * is High, because quietly shipping a soft picture to someone who never said
 * they were slow is the worse of the two mistakes. It must fire on the
 * signals that mean something, including the one that is easy to get wrong —
 * a real phone GPU reports through ANGLE with Google as the vendor, exactly
 * like the software rasteriser does, so only the explicit software markers
 * may count.
 *
 * The film's learner must ignore the seconds it spends decoding its own
 * models, must ignore a stall rather than read it as a pace, must condemn a
 * machine at most once, and must never overwrite a choice the player made.
 * The checkpoint must stay out of the player's way, remember a downgrade and
 * not remember a lift, and refuse to lift a machine the film already taught.
 *
 * Then the wiring, because every one of those decisions is worth nothing if
 * the canvas never hears it: the film's tier reaches its own canvas and its
 * draw calls, the game's reaches the canvas, the sky table and the bay's
 * environment, and the shared sampler is fed by the loop the checkpoint reads.
 *
 * The store double is the same pattern the frame-stats and detail-budget
 * gates use for their DOM surfaces: a real module, a stubbed browser.
 */

import { readFileSync } from 'node:fs'
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
const check = (name, ok) => (ok ? pass(name) : fail(name))

/* A browser the module can believe in: localStorage is the only thing the
   store helpers touch, and they read it at call time and not at import. */
const store = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
})

const q = await import(join(ROOT, 'src/game/core/quality.js'))

/* 1. The table: what Fast gives up, and what it does not. */
{
  const high = q.TIERS.high
  const low = q.TIERS.low
  check('two tiers, both named', Object.keys(q.TIERS).length === 2 && high.name === 'High' && low.name === 'Fast')
  check('Fast gives up bloom, shadows, antialiasing and the bay panorama',
    !low.bloom && !low.shadows && !low.antialias && !low.environment && high.bloom && high.shadows && high.antialias && high.environment)
  check('Fast opens with fewer pixels, a shallower star catalogue and fewer noise octaves',
    low.dpr[1] < high.dpr[1] && low.filmDpr[1] < high.filmDpr[1] && low.stars < high.stars && low.octaves < high.octaves)
  check('Fast still draws a real wreck field and a real resolution',
    low.debris > 24 && low.debris < high.debris && low.dpr[0] > 0.4 && low.dpr[0] <= low.dpr[1])
  check('Fast spends the distant bodies too, at a silhouette no camera can see',
    low.segments[0] < high.segments[0] && low.segments[1] < high.segments[1] && low.segments[0] >= 64)
  check('a laptop is not asked for the discrete GPU to draw Fast', low.power === 'default' && high.power === 'high-performance')
  check('an unknown tier name is High, never something in between', q.tierOf('ultra') === high && q.tierOf(undefined) === high && q.tierOf('low') === low)
}

/* 2. The guess: no evidence is not a reason to degrade. */
{
  const blank = { renderer: '', software: false, cores: 0, memory: 0, screenPixels: 0, coarse: false }
  check('nothing known: High', q.deviceTier(blank) === 'high')
  check('no probe at all: High', q.deviceTier(null) === 'high' && q.deviceTier(undefined) === 'high')
  check('a software rasteriser: Fast', q.deviceTier({ ...blank, software: true }) === 'low')
  check('four cores: Fast', q.deviceTier({ ...blank, cores: 4 }) === 'low')
  check('four gigabytes: Fast', q.deviceTier({ ...blank, memory: 4 }) === 'low')
  check('a phone-sized screen at three device pixels: Fast',
    q.deviceTier({ ...blank, coarse: true, screenPixels: 2.9e6 }) === 'low')
  check('a small screen on a touch device stays High',
    q.deviceTier({ ...blank, coarse: true, screenPixels: 0.5e6, cores: 8, memory: 8 }) === 'high')
  check('eight cores and sixteen gigabytes: High', q.deviceTier({ ...blank, cores: 8, memory: 16 }) === 'high')
}

/* 3. The probe: it reads a renderer, and it does not read a real phone as
      software. ANGLE is how Mali and Adreno report, with Google as vendor. */
{
  const fake = (renderer) => ({
    getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
    getParameter: () => renderer,
  })
  const software = q.probeDevice(fake('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'))
  check('SwiftShader is read as software', software.software === true && q.deviceTier(software) === 'low')
  const phone = q.probeDevice(fake('ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2 V@0530.0)'))
  check('an Adreno phone is not software', phone.software === false && phone.renderer.includes('Adreno'))
  const desktop = q.probeDevice(fake('Apple M2 Pro'))
  check('an Apple GPU is not software', desktop.software === false)
  check('llvmpipe is read as software', q.probeDevice(fake('llvmpipe (LLVM 17.0, 128 bits)')).software === true)
  let lost = 0
  const borrowed = { getExtension: (n) => { if (n === 'WEBGL_lose_context') lost++; return null }, getParameter: () => 'x' }
  q.probeDevice(borrowed)
  check("a probe does not drop a context it did not make", lost === 0)
  check('a probe with no browser at all still answers', typeof q.probeDevice().software === 'boolean')
}

/* 4. The store: a choice beats a lesson, and a lesson beats a guess. */
{
  store.clear()
  check('with nothing stored, the first answer is the guess', q.initialQuality({ software: true }) === 'low' && q.initialQuality({ software: false }) === 'high')
  q.rememberTier('low')
  check('a lesson is used when no choice has been made', q.initialQuality({ software: false }) === 'low')
  check('the lesson is readable, and is the one the checkpoint is given', q.readTier() === 'low' && q.readChoice() === null)
  q.writeChoice('high')
  check("the player's own choice outranks the lesson", q.initialQuality({ software: true }) === 'high' && q.readChoice() === 'high')
  check('a junk value in storage is not a choice', (store.set(q.CHOICE_KEY, 'ultra'), q.readChoice() === null))
  check('a junk value in storage is not a lesson', (store.set(q.TIER_KEY, 'yes'), q.readTier() === null))
  store.clear()
}

/* 5. The film's learner: the models' seconds do not count, a stall is not a
      pace, and the verdict is spoken once.

      The settle window is 2.5 s of the film's own clock, not a count of
      frames, so the feeder below spends it at the pace it is about to test
      and leaves the window boundary exactly where a full window starts. */
{
  const feed = (n, ms) => { let told = false; for (let i = 0; i < n; i++) told = q.noteFilmFrame(ms) || told; return told }
  // Past the settle window, with no frame of the test's pace counted yet.
  const startFilm = (ms) => { q.resetFilmLearner(); feed(Math.ceil(2500 / ms), ms) }

  q.resetFilmLearner()
  check('the film is not judged while it is decoding its own models', feed(55, 45) === false)
  check('55 slow frames in: no window closed, so no verdict and no pace', q.filmPace() === 0 && store.get(q.TIER_KEY) === undefined)
  check('a stall is ignored rather than averaged in', q.noteFilmFrame(600) === false)
  const n = q.WINDOW - 1
  feed(n, 45)
  check('and a window is not closed early', q.filmPace() === 0)

  // The bug a live run found: on a first visit the film is still reading four
  // megabytes of ships and decoding its sky while it plays, and a cold cache
  // puts very long frames into an otherwise perfect window. A mean carried
  // them into the verdict and condemned a machine that was drawing at sixty
  // frames a second at the time. Three things now stand in the way: the film
  // is not measured at all until its own models have arrived, the middle of a
  // window is read instead of its mean, and an isolated long frame is treated
  // as an event and restarts the settle window.
  q.resetFilmLearner()
  for (let i = 0; i < 400; i++) q.noteFilmFrame(16.7, !q.filmModelsReady((k) => k !== 'raider'))
  check('nothing is measured at all while the models are still arriving', q.filmPace() === 0 && store.get(q.TIER_KEY) === undefined)
  const cool = (k) => q.filmModelsReady((kind) => k.includes(kind))
  check('the film is settled only with all four of its models in hand', cool(['freighter', 'kestrel', 'hearth']) === false && cool(['freighter', 'kestrel', 'hearth', 'raider']) === true)
  q.resetFilmLearner()
  feed(Math.ceil(2500 / 16.7) + 1, 16.7)
  for (let i = 0; i < q.WINDOW - 12; i++) q.noteFilmFrame(16.7)
  check('a dozen cold-cache hitches in a fast window condemn nothing', feed(12, 120) === false && store.get(q.TIER_KEY) === undefined)
  check('and each of them restarts the settle window rather than being judged', q.filmPace() === 0 && q.noteFilmFrame(900) === false)
  feed(Math.ceil(2500 / 16.7) + 1, 16.7)
  feed(q.WINDOW, 16.7)
  check('after the hitches, a clean run is judged normally and read as fast', q.filmPace() > 16 && q.filmPace() < 17 && store.get(q.TIER_KEY) === undefined)
  check('a single long frame does not condemn anything on its own', store.get(q.TIER_KEY) === undefined)

  store.clear()
  startFilm(16.7)
  feed(q.WINDOW, 16.7)
  check('a comfortable window is reported and the machine kept', q.filmPace() > 16 && q.filmPace() < 17 && store.get(q.TIER_KEY) === undefined)

  // The film's trend: three windows slow in a row is a pace, one or two is a
  // stumble, and a comfortable window in between starts the count over.
  startFilm(45)
  check('one slow window is one slow window', feed(q.WINDOW, 45) === false && q.filmSlowRun() === 1)
  check('and two is not yet a pace', feed(q.WINDOW, 45) === false && q.filmSlowRun() === 2)
  check('three in a row is', feed(q.WINDOW, 45) === true && q.filmPace() > 44 && q.filmSlowRun() >= q.FILM_NEED)
  startFilm(45)
  feed(q.WINDOW * 2, 45)
  check('a stumble in the middle of a slow stretch starts it over', (feed(q.WINDOW, 16.7), q.filmSlowRun() === 0))
  check('and the count resumes from one', feed(q.WINDOW, 45) === false && q.filmSlowRun() === 1)
  // A machine drawing at ten frames a second is caught too, even though every
  // one of its frames is long enough to look like an event on its own.
  startFilm(150)
  check('a machine whose every frame is an event still shows a slow pace', feed((q.WINDOW + 4) * q.FILM_NEED, 150) === true && q.filmPace() > 100)

  // The claim that matters most here, and the one a live run argued for: the
  // film tunes itself and says nothing about the game. Its canvas runs at 26
  // to 33 ms where the game canvas holds 16.7 ms on the same machine, so a
  // lesson from it would have quietly dropped a capable machine to Fast.
  store.clear()
  q.resetFilmLearner()
  feed(3000, 90)
  check('a film that is slow from end to end writes nothing at all', store.get(q.TIER_KEY) === undefined && q.readTier() === null)
  q.writeChoice('high')
  feed(3000, 90)
  check('and it never touches a choice the player made', q.readChoice() === 'high')
  store.clear()
  q.resetFilmLearner()
  check('a replay measures again', q.filmPace() === 0)
  startFilm(16.7)
  feed(q.WINDOW, 16.7)
  check('and after the reset a fast window is reported, not remembered', q.filmPace() > 16 && store.get(q.TIER_KEY) === undefined)
  store.clear()
}

/* 6. The film's last rung: spent only on a sustained pace, only at the pixel
      floor, and only once. */
{
  check('a fast film never spends the last rung', q.filmDegrade(0, 0.6, false) === null)
  check('one slow window is not enough to spend it', q.filmDegrade(1, 0.7, false) === null && q.filmDegrade(q.FILM_NEED - 1, 0.7, false) === null)
  check('a sustained slow film at the pixel floor spends it', q.filmDegrade(q.FILM_NEED, 0.7, false) === 'low' && q.filmDegrade(9, 0.5, false) === 'low')
  check('a slow film with pixels still to give does not spend it either', q.filmDegrade(9, 1.3, false) === null)
  check('and it is a one-way door: already Fast, nothing more to spend', q.filmDegrade(9, 0.6, true) === null)
}

/* 7. The checkpoint: the player wins, a downgrade is a fact, a lift is an
      experiment, and a machine the film taught is not argued with. */
{
  const fast = { explicit: false, learned: null, measured: true }
  check('a slow machine is dropped and the downgrade is remembered',
    JSON.stringify(q.checkpointTier('high', 40, fast)) === JSON.stringify({ tier: 'low', remember: true, reason: 'slow' }))
  check('comfortable frames change nothing',
    q.checkpointTier('high', 16.7, fast).tier === 'high' && q.checkpointTier('high', 16.7, fast).reason === 'none')
  check('the comfortable band is left alone', q.checkpointTier('high', 22, fast).tier === 'high')
  check('a machine guessed Fast that plainly has headroom is lifted, for this session only',
    JSON.stringify(q.checkpointTier('low', 16.7, fast)) === JSON.stringify({ tier: 'high', remember: false, reason: 'headroom' }))
  check('a machine the film taught Fast is not lifted by cheap Fast frames',
    q.checkpointTier('low', 16.7, { explicit: false, learned: 'low', measured: true }).tier === 'low')
  check('slow on Fast changes nothing and remembers nothing',
    q.checkpointTier('low', 40, fast).tier === 'low' && q.checkpointTier('low', 40, fast).remember === false)
  check("the player's own choice is never argued with, in either direction",
    q.checkpointTier('high', 40, { explicit: true, learned: null, measured: true }).tier === 'high' &&
    q.checkpointTier('low', 16.7, { explicit: true, learned: null, measured: true }).tier === 'low')
  check('nothing measured yet: nothing decided',
    q.checkpointTier('high', 0, { explicit: false, learned: null, measured: false }).tier === 'high' &&
    q.checkpointTier('high', 0, { explicit: false, learned: null, measured: false }).reason === 'none')
  check('the drop threshold means between 25 and 34 frames a second', 1000 / q.DROP_MS >= 25 && 1000 / q.DROP_MS <= 34)
  check('an event is longer than a merely slow frame', q.EVENT_MS > q.DROP_MS && q.EVENT_MS > q.STALL_MS)
  check('a display capped at 30 Hz is not read as a slow machine', 1000 / 33.3 < q.DROP_MS)
}

/* 8. The wiring: every decision above has to reach a canvas. */
{
  const src = (f) => readFileSync(join(ROOT, f), 'utf8')
  const scene = src('src/game/scene/PrologueScene.jsx')
  const game = src('src/game/scene/GameScene.jsx')
  const app = src('src/game/GameApp.jsx')
  const sky = src('src/game/scene/Sky.jsx')
  const props = src('src/game/scene/Props.jsx')
  const film = src('src/game/ui/Prologue.jsx')

  const wiring = [
    [scene, 'tierOf(tier)', 'the film canvas takes its settings from the tier table'],
    [scene, 'noteFilmFrame(ms, !filmModelsReady(hasAuthored))', 'the film measures its own frames, and holds off while they are still arriving'],
    [scene, 'filmDegrade(filmSlowRun(), r.dpr, spent)', 'and can spend its own last rung'],
    [scene, 'spent={cfg === TIERS.low}', 'but never spends it twice'],
    [scene, "frameloop={stopped ? 'never' : 'always'}", 'a paused or hidden film stops drawing altogether'],
    [scene, 'budget={cfg.debris}', 'Fast draws a smaller wreck field'],
    [scene, '<Sky game={game} quality={', 'and a shallower sky'],
    [film, 'onComplete(initialQuality())', 'the film hands its verdict to the game'],
    [film, 'stopped={paused || brief || hidden}', 'the film canvas is told when nothing is moving'],
    [film, 'resetFilmLearner()', 'a replay is a fresh measurement'],
    [app, 'initialQuality()', 'the game opens at the tier the evidence argues for'],
    [app, 'readChoice()', 'the checkpoint knows whether the player has chosen'],
    [app, 'rememberTier(d.tier)', 'a downgrade is kept'],
    [app, 'summarizeFrameTimes()', 'the checkpoint reads the shared summary'],
    [app, 'summary?.p50', 'and decides on the middle of the ring, not its mean'],
    [game, 'pushFrameTime(ms)', 'and the game loop feeds it'],
    [game, 'tierOf(quality)', 'the game canvas takes its settings from the tier table'],
    [game, 'minDpr={cfg.dpr[0]}', 'the resolution governor knows the tier floor'],
    [game, 'quality={quality} />\n    <BayEnvironment quality={quality} />', 'the bay environment is told the tier'],
    [sky, 'tierOf(quality)', 'the sky reads its own numbers from the same table'],
    [props, "quality === 'low'", 'the bay spends less on a machine that asked for Fast'],
    [props, 'compileAsync', 'models are still compiled ahead of time'],
  ]
  for (const [text, needle, why] of wiring) check(`${why}`, text.includes(needle))

  // The film must not be a different film at a lower tier: all six shots and
  // every camera move stay, at every setting.
  const shots = ['earth', 'convoy', 'wreck', 'rescue', 'station']
  check('the six shots survive both tiers', shots.every((s) => scene.includes(`case '${s}'`)) && scene.includes('default: position.set'))
  check('the film keeps its depth buffer and its exposure at both tiers', scene.includes('logarithmicDepthBuffer: true') && scene.includes('ACESFilmicToneMapping'))
  check('the film draws no shadows at all: it is sunlight in vacuum', !scene.includes('shadows={'))
}

console.log(failures ? `\n  ${failures} failure${failures === 1 ? '' : 's'}` : '\n  PASS')
process.exit(failures ? 1 : 0)
