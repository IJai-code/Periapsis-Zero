/**
 * What the two tiers actually cost, measured on a device that cannot hide it.
 *
 * The quality policy has its own gate (`verify-game-quality`), and that gate
 * holds the arithmetic: what the browser tells us about a machine, what the
 * film's own frames teach it, when the checkpoint is allowed to move. What no
 * pure gate can hold is the thing the player feels, because on this Mac every
 * setting looks identical: both tiers sit at 60 frames a second against a
 * 16.7 ms vsync, and "Fast" is free. A measurement taken there would prove
 * nothing and would let a tier that costs more than it saves ship unnoticed.
 *
 * So this runs the same two minutes of film twice — once at High, once at
 * Fast — in a Chrome whose only GPU is SwiftShader, and reports what each
 * cost. Software rasterisation is not a weak phone; it is *the* weak device,
 * a floor under anything anyone will play this on, and it is the only machine
 * this repository can construct that is slow enough to show the difference.
 *
 * It asserts the two things that matter: the film honours the tier it was
 * given, and Fast buys real frames. The numbers it prints are the claim; the
 * run is not part of `verify:all` because it needs a browser and about two
 * minutes, the same reason the other `check-*` scripts are not.
 *
 *   node scripts/check-game-quality.mjs          [PZ_URL default: dev 5174]
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, wait } from './lib/chrome.mjs'

const url = process.env.PZ_URL ?? 'http://127.0.0.1:5174'
const out = process.env.PZ_SHOTS ?? '.freebuff/quality-ab'
mkdirSync(out, { recursive: true })
// The whole point: a GPU that is only just fast enough to be a floor.
process.env.PZ_SOFTWARE_GL = '1'

const report = { url, tiers: {}, errors: [] }

/**
 * Run the film once at `tier` and time it.
 *
 * The page is given the tier as the player's own choice, which is deliberate:
 * it is the only way to hold the tier still while it is measured. Left to
 * itself the game chooses, and the film can spend its last rung mid-shot,
 * which would mean measuring two settings and calling them one.
 */
async function measure(tier) {
  const p = await launch({ width: 1280, height: 800 })
  try {
    await p.goto(`${url}/`, 2500)
    await p.evaluate(`localStorage.removeItem('pz-game-v1'); localStorage.removeItem('pz-game-tier'); localStorage.setItem('pz-game-quality','${tier}'); localStorage.setItem('pz-sky','off')`)
    await p.goto(`${url}/#play`, 2500)
    const click = async (label) => {
      const point = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(label)})); if(!b)throw Error('Missing button: '+${JSON.stringify(label)}); const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await p.mouse('mousePressed', point.x, point.y, { clickCount: 1 })
      await p.mouse('mouseReleased', point.x, point.y, { clickCount: 1 })
    }
    await click('Suit up'); await wait(400); await click('Watch the prologue')
    // The film says something about this machine within a few seconds.
    let film = null
    for (let i = 0; i < 40 && !(film?.pace > 0); i++) {
      film = await p.evaluate('window.__pzFilm ? {tier:__pzFilm.tier,fast:__pzFilm.fast,dpr:__pzFilm.dpr,pace:__pzFilm.pace,frames:__pzFilm.frames} : null')
      if (!(film?.pace > 0)) await wait(500)
    }
    assert.ok(film, 'the film must expose its tier and pace in development')
    assert.equal(film.tier, tier, `the film drew at ${film.tier}, not the ${tier} it was told to use`)
    const before = film.frames
    // Bounded by wall clock, not by a count: at ten frames a second a 400-frame
    // window is forty seconds, and on the High tier of a software rasteriser it
    // is longer than the DevTools call that asked for it is willing to wait.
    // Fifteen seconds is the same measurement on every machine.
    const stats = await p.evaluate(`new Promise(resolve=>{const a=[];let prev=performance.now(),t0=prev;function f(t){a.push(t-prev);prev=t;if(t-t0<15000)requestAnimationFrame(f);else{a.sort((x,y)=>x-y);resolve({median:a[Math.floor(a.length/2)],p95:a[Math.floor(a.length*0.95)],samples:a.length})}}requestAnimationFrame(f)})`)
    const after = (await p.evaluate('window.__pzFilm.frames')) - before
    const seen = await p.evaluate("document.querySelector('.film-chapter h1')?.textContent")
    const errors = p.logs().filter((l) => /^error/.test(l))
    report.errors.push(...errors.map((e) => `${tier}: ${e}`))
    return { ...film, ...stats, drawn: after, chapter: seen, errors: errors.length }
  } finally { p.close() }
}

for (const tier of ['high', 'low']) {
  const r = await measure(tier)
  report.tiers[tier] = r
  console.log(`  ${tier.padEnd(5)} ${String(Math.round(1000 / r.median)).padStart(3)} fps   median ${r.median.toFixed(1)} ms   p95 ${r.p95.toFixed(1)} ms   dpr ${r.dpr}   frames drawn ${r.drawn}`)
}

/* The claims. */
const high = report.tiers.high
const low = report.tiers.low
assert.equal(low.tier, 'low', 'the film honoured the Fast tier')
assert.ok(low.fast === false, 'and did not have to spend its own last rung on top of it')
assert.ok(low.median < high.median, `Fast is not slower than High (${low.median.toFixed(1)} ms against ${high.median.toFixed(1)} ms)`)
assert.ok(high.drawn > 0 && low.drawn > 0, 'both runs drew frames')
report.ratio = high.median / low.median
report.saving = `${Math.round((1 - low.median / high.median) * 100)}% off the frame time`
assert.deepEqual(report.errors, [])

console.log(`\n  Fast costs ${low.median.toFixed(1)} ms a frame where High costs ${high.median.toFixed(1)} ms: ${report.saving} on a software rasteriser.`)
console.log(`  ${Math.round(1000 / high.median)} fps at High, ${Math.round(1000 / low.median)} fps at Fast, ${(low.dpr)} device pixels per CSS pixel.`)
writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2))
