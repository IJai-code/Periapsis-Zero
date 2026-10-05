/**
 * A scripted player for the surface game, for the gates: it flies, drives or
 * hops a whole mission on any world the way a careful person would, steering
 * round boulders, scanning in search zones, and stopping to investigate.
 */
import { createExpedition, stepExpedition, nextTarget, interact, scan, launch, hop, rockField, here, objectives, REACH, STEP, WORLDS } from '../../src/sim/expedition.js'

export function playMission(id, { upgrades = {}, anomaly = true, maxMinutes = 30, manualLanding = false } = {}) {
  const s = createExpedition(id, { mode: 'free', upgrades })
  const keys = {}
  const step = (n = 1) => { for (let i = 0; i < n; i++) stepExpedition(s, keys) }
  const limit = 120 * 60 * maxMinutes
  if (manualLanding) s.assist = false
  while (s.landedAt === null && s.mode !== 'crashed' && s.steps < limit) step()
  if (s.mode === 'crashed') return { s, why: s.message }
  const out = [0, 0]
  const f = rockField(id)
  const hopper = Boolean(WORLDS[id].hopper)
  while (s.mode !== 'complete' && s.mode !== 'crashed' && s.steps < limit) {
    const kind = nextTarget(s, out)
    if (!kind) { step(12); continue }
    const o = objectives(s)
    if (!anomaly && o.ready && (kind === 'zone' || kind === 'anomaly')) { aboard(); continue }
    const p = here(s)
    const d = Math.hypot(out[0] - p.x, out[1] - p.z)
    if (kind === 'lander') { aboard(); continue }
    if (kind === 'zone') {
      const zone = s.pois.find((q) => q === nextTargetPoi())?.zone
      if (zone && d < zone.r * 0.5 && s.time - s.scan.at > 2.6) { stop(); scan(s); continue }
    }
    if (kind === 'anomaly' && d < 10) { stop(); step(120); continue }
    if ((kind === 'sample' || kind === 'station') && d < (hopper ? REACH.hop : s.mode === 'rover' ? REACH.rover : REACH.eva) - 0.5) { stop(); interact(s); continue }
    if (hopper) { if (s.landed) { if (!hop(s)) { stop(); step(30) } } ; while (!s.landed && s.mode === 'flight' && s.steps < limit) step(); continue }
    drive(out[0], out[1])
    step(12)
  }
  return { s, why: s.mode === 'complete' ? null : s.message }

  function nextTargetPoi() { const o2 = [0, 0]; nextTarget(s, o2); return s.pois.find((q) => !q.done && ((q.found && q.x === o2[0] && q.z === o2[1]) || (!q.found && q.zone.x === o2[0] && q.zone.z === o2[1]))) }
  function stop() { keys.forward = keys.back = keys.left = keys.right = false }
  function aboard() {
    stop()
    if (s.mode === 'rover' || s.mode === 'eva') {
      const p = here(s)
      if (Math.hypot(p.x - s.x, p.z - s.z) > 9) { drive(s.x, s.z); step(12); return }
      interact(s)
      return
    }
    if (s.mode === 'flight' && s.landed) { launch(s); return }
    step()
  }
  function drive(tx, tz) {
    const r = s.rover
    let ax = tx - r.x, az = tz - r.z
    const n = Math.hypot(ax, az) || 1
    ax /= n; az /= n
    for (let k = 0; k < f.n; k++) {
      if (f.height[k] <= STEP.rover) continue
      const ox = r.x - f.x[k], oz = r.z - f.z[k], dd = Math.hypot(ox, oz) - f.radius[k]
      if (dd > 9 || (ox * ax + oz * az) > 0) continue
      const w = 1.6 / Math.max(dd, 0.5)
      ax += (ox / Math.hypot(ox, oz)) * w; az += (oz / Math.hypot(ox, oz)) * w
    }
    // And round the lander, which is the biggest thing on the field.
    if (s.landed) {
      const ox = r.x - s.x, oz = r.z - s.z, dd = Math.hypot(ox, oz) - 4.5
      if (dd < 10 && (ox * ax + oz * az) < 0) { const w = 3 / Math.max(dd, 0.4); ax += (ox / Math.hypot(ox, oz)) * w + (-oz / Math.hypot(ox, oz)) * w; az += (oz / Math.hypot(ox, oz)) * w + (ox / Math.hypot(ox, oz)) * w }
    }
    let err = Math.atan2(ax, -az) - r.yaw
    while (err > Math.PI) err -= Math.PI * 2
    while (err < -Math.PI) err += Math.PI * 2
    keys.left = err > 0.06; keys.right = err < -0.06
    keys.forward = Math.abs(err) < 1.2
    keys.back = false
  }
}
