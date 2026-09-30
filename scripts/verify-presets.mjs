import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const childId = process.argv[2]
if (!childId) {
  const { PRESETS } = await import('../src/sim/presets.js')
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length)
  for (const p of PRESETS) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), p.id], {
      env: { ...process.env, PERIAPSIS_VESSEL: p.vessel, PERIAPSIS_SITE: p.site },
      encoding: 'utf8', timeout: 30000,
    })
    assert.equal(run.status, 0, `${p.id}: ${run.stdout}\n${run.stderr}`)
    console.log(run.stdout.trim())
  }
  console.log(`\nverify-presets: ${PRESETS.length} real mission starts pass`)
} else {
  const THREE = await import('three')
  const { PRESETS, startPreset, presetHref } = await import('../src/sim/presets.js')
  const { DOSSIERS, INTRO, introStart, introStep, introTarget } = await import('../src/gfx/introFlights.js')
  const { live } = await import('../src/sim/live.js')
  const { BODIES } = await import('../src/sim/constants.js')
  const { RAILS } = await import('../src/sim/rails.js')
  const { mission } = await import('../src/sim/mission.js')
  const p = PRESETS.find((p) => p.id === childId)
  assert.ok(p)
  assert.ok(DOSSIERS[p.id], `${p.id} lacks an intro`)
  const href = new URL(presetHref(p), 'https://example.test')
  assert.equal(href.searchParams.get('vessel'), p.vessel)
  assert.equal(href.searchParams.get('site'), p.site)
  const run = startPreset(p)
  assert.equal(run.arrived, true)
  if (p.fromPad) { assert.equal(run.phase, p.site === 'tranquility' ? 'LUNAR_PRE_LAUNCH' : 'PRE_LAUNCH'); assert.equal(mission.t, -60) }
  else if (typeof p.until === 'string') assert.equal(run.phase, p.until)
  assert.ok(live.sim.state.every(Number.isFinite))
  assert.ok(run.ms < 5000, `fast-forward stalled for ${run.ms} ms`)
  const camera = new THREE.PerspectiveCamera()
  introStart(p.id, run.focus)
  const target = introTarget()
  const bodies = ['sun', 'earth', 'moon'].map((id) => ({ id, pos: live.abs[id], radius: BODIES[id].radius }))
  for (const r of RAILS) bodies.push({ id: r.id, pos: live.railPos[r.id].clone().add(live.origin), radius: r.radius })
  const absolute = new THREE.Vector3()
  for (let t = 0; t <= 40.1 && INTRO.active; t += 1 / 60) {
    introStep(camera, 1 / 60)
    absolute.copy(camera.position).add(live.origin)
    for (const b of bodies) assert.ok(absolute.distanceTo(b.pos) > b.radius, `${p.id}: intro inside ${b.id} at ${t.toFixed(2)} s`)
  }
  assert.equal(INTRO.active, false)
  assert.ok(camera.position.clone().add(live.origin).distanceTo(target.cam) < 0.001)
  assert.ok(Math.abs(camera.fov - target.fov) < 0.01)
  console.log(`  ✓ ${p.id}: ${run.phase}, ${run.focus}, ${run.ms.toFixed(0)} ms; intro lands on actual hand-over`)
}
