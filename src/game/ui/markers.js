import * as THREE from 'three'
import { leadPoint } from '../core/combat.js'
import { hostile } from '../core/ai.js'

/**
 * Screen markers, written straight into the DOM every frame: no React, and
 * no new elements once the pool is warm. Positions come from projecting the
 * game's local coordinates through the camera.
 */
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3(), _lead = new THREE.Vector3()

function pool(root) {
  if (root.__m) return root.__m
  const make = (cls, html = '') => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; root.appendChild(e); return e }
  root.__m = {
    nose: make('mk-nose'),
    lead: make('mk-lead'),
    target: make('mk-target', '<i></i><i></i><i></i><i></i><span class="mk-label"></span><b class="mk-bars"><em class="s"></em><em class="h"></em></b>'),
    obj: make('mk-obj', '<span class="mk-diamond"></span><span class="mk-dist"></span>'),
    tags: [],
    W: 0, H: 0,
  }
  return root.__m
}

/** Project a local point; returns false if behind the camera. */
function project(p, cam, W, H, out) {
  _d.copy(p).sub(cam.position)
  cam.getWorldDirection(_f)
  const ahead = _d.dot(_f) > 0
  _v.copy(p).project(cam)
  out.x = (_v.x + 1) / 2 * W
  out.y = (1 - _v.y) / 2 * H
  out.ahead = ahead
  out.dist = _d.length()
  return ahead
}
const S = { x: 0, y: 0, ahead: true, dist: 0 }
const place = (el, x, y) => { el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)` }
const fmt = (m) => (m < 1000 ? `${Math.round(m)} m` : m < 100000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`)

export function updateMarkers(root, g, cam, c) {
  const m = pool(root)
  const W = root.clientWidth || window.innerWidth, H = root.clientHeight || window.innerHeight
  const flying = g.mode === 'flight'
  root.style.display = flying ? '' : 'none'
  if (!flying) return
  const p = g.player

  // Where the nose actually points (the ship lags the aim).
  _f.set(0, 0, -1).applyQuaternion(p.q).multiplyScalar(900).add(p.pos)
  if (project(_f, cam, W, H, S)) { m.nose.style.display = ''; place(m.nose, S.x, S.y) } else m.nose.style.display = 'none'

  // The target: brackets, name, range, shield and hull; and its lead point.
  const t = g.byId(g.target)
  if (t && t.alive && project(t.pos, cam, W, H, S)) {
    const px = Math.max(26, Math.min(220, t.radius / S.dist * H * 1.6))
    m.target.style.display = ''
    place(m.target, S.x, S.y)
    m.target.style.width = m.target.style.height = `${px}px`
    const hostileNow = hostile(g, t, p)
    m.target.classList.toggle('hostile', hostileNow)
    const label = m.target.querySelector('.mk-label')
    const text = `${t.label} · ${fmt(S.dist)}`
    if (label.textContent !== text) label.textContent = text
    const bars = m.target.querySelectorAll('.mk-bars em')
    bars[0].style.width = `${Math.max(0, t.shield / t.stats.shield) * 100}%`
    bars[1].style.width = `${Math.max(0, t.hull / t.stats.hull) * 100}%`
    if (leadPoint(p, t, _lead) && S.dist < 4000 && project(_lead, cam, W, H, S)) { m.lead.style.display = ''; place(m.lead, S.x, S.y) } else m.lead.style.display = 'none'
  } else { m.target.style.display = 'none'; m.lead.style.display = 'none' }

  // The objective: a diamond with a range, clamped to the screen edge when off it.
  const o = g.objective
  let at = null
  if (o?.ship) { const e = g.byId(o.ship); if (e && e.alive && e.id !== g.target) at = e.pos }
  if (!at && o?.at) at = o.at
  if (at) {
    const ahead = project(at, cam, W, H, S)
    let x = S.x, y = S.y
    const pad = 46
    const off = !ahead || x < pad || x > W - pad || y < pad || y > H - pad
    if (off) {
      // Point toward it from the centre, round the edge.
      let dx = x - W / 2, dy = y - H / 2
      if (!ahead) { dx = -dx; dy = -dy }
      const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6))
      x = W / 2 + dx * k; y = H / 2 + dy * k
    }
    m.obj.style.display = ''
    m.obj.classList.toggle('off', off)
    place(m.obj, x, y)
    const d = m.obj.querySelector('.mk-dist')
    const txt = fmt(p.pos.distanceTo(at))
    if (d.textContent !== txt) d.textContent = txt
  } else m.obj.style.display = 'none'

  // Small tags: hostiles in range, salvage, and stations.
  let n = 0
  const tag = (pos, cls, label) => {
    if (!project(pos, cam, W, H, S)) return
    let e = m.tags[n]
    if (!e) { e = document.createElement('div'); e.innerHTML = '<span></span>'; root.appendChild(e); m.tags.push(e) }
    if (e.className !== cls) e.className = cls
    e.style.display = ''
    place(e, S.x, S.y)
    const s = e.firstChild
    const txt = label ? `${label} · ${fmt(S.dist)}` : ''
    if (s.textContent !== txt) s.textContent = txt
    n++
  }
  for (const e of g.ships) {
    if (e === p || !e.alive || e.id === g.target) continue
    const d = e.pos.distanceTo(p.pos)
    if (d > 7000) continue
    const cls = hostile(g, e, p) ? 'mk-tag hostile' : e.team === 'pilot' ? 'mk-tag pilot' : e.team === 'ally' ? 'mk-tag ally' : e.team === 'compact' ? 'mk-tag law' : 'mk-tag civil'
    // Other players are named at any range: they are why you came.
    tag(e.pos, cls, d < 2500 || e.team === 'pilot' ? e.label : '')
  }
  for (const k of g.canisters) if (!k.taken && k.at.distanceTo(p.pos) < 4000) tag(k.at, 'mk-tag loot', '')
  for (const st of g.stations) tag(st.port.at, 'mk-tag station', st.name)
  for (let i = n; i < m.tags.length; i++) m.tags[i].style.display = 'none'
}
