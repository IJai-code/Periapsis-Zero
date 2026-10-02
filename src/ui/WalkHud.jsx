import { useEffect, useRef } from 'react'
import { subscribeUiTick } from './uiClock.js'
import { live } from '../sim/live.js'
import { mission } from '../sim/mission.js'
import { activeSite } from '../sim/launchsite.js'
import { useUi } from '../sim/store.js'
import { jumpHeight, jumpTime, surfaceGravity, walkSpeed } from '../sim/walk.js'

/**
 * What it is like to stand here.
 *
 * The walk's whole argument is that no number in it was chosen to make walking
 * feel a particular way — there are four measurements about a human being and
 * the gravity of whatever is underfoot, and everything else follows. That
 * argument is invisible unless the panel says it, so the panel says it: the
 * world, its gravity, the speed the walking gait breaks at here, and what a
 * standing jump does. Read once when the boots go on, because none of it
 * changes while they are on; only the two live readouts are on the clock.
 *
 * The gait number is the one worth looking at. In a walking stride the body
 * vaults over a straight leg and stays on the ground only while v² / L is
 * under g, so the fastest walk is sqrt(gL) — 2.97 m/s on Earth and **1.21 on
 * the Moon**. That is not a rule this simulator invented. It is why the Apollo
 * crews stopped walking and hopped, and it comes out of two measurements and a
 * square root.
 */

const KEYS = [
  ['W A S D', 'walk'],
  ['space', 'jump'],
  ['mouse', 'look'],
  ['G', 'stand down'],
]

export function WalkHud() {
  const walking = useUi((s) => s.focus === 'walk')
  const root = useRef(null)

  useEffect(() => {
    if (!walking) return
    const speed = root.current?.querySelector('[data-field="speed"]')
    const air = root.current?.querySelector('[data-field="air"]')
    const tick = () => {
      if (speed) speed.textContent = `${live.walkSpeed.toFixed(2)} m/s`
      if (air) {
        air.textContent = live.walkGround ? 'on the ground' : `${live.walkHeight.toFixed(2)} m up`
        air.style.color = live.walkGround ? '' : 'var(--color-ember)'
      }
    }
    tick()
    return subscribeUiTick(tick, 1)
  }, [walking])

  if (!walking) return null

  const site = mission.site ?? activeSite()
  const body = site.body === 'moon' ? 'moon' : 'earth'
  const name = site.body === 'moon' ? 'The Moon' : 'Earth'
  const g = surfaceGravity(body)
  const gait = walkSpeed(g)

  const rows = [
    ['Standing on', name],
    ['Gravity', `${g.toFixed(3)} m/s²`],
    ['Walk breaks at', `${gait.toFixed(2)} m/s`],
    ['A jump reaches', `${jumpHeight(g).toFixed(2)} m, ${jumpTime(g).toFixed(1)} s up`],
  ]

  return (
    <div ref={root} className="panel pointer-events-none w-56 rounded-sm p-3.5">
      <div className="rule mb-2.5 flex items-baseline justify-between border-b border-white/10 pb-2">
        <span>On foot</span>
        <span className="text-white/25">G</span>
      </div>

      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[10px] text-white/35">Speed</span>
        <span data-field="speed" className="tabular-nums text-[13px] text-hud">
          —
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] text-white/35">Feet</span>
        <span data-field="air" className="tabular-nums text-[11px] text-white/85">
          on the ground
        </span>
      </div>

      <dl className="mt-3 space-y-1 border-t border-white/10 pt-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-[9px] text-white/30">{k}</dt>
            <dd className="tabular-nums text-[9.5px] text-white/55">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5">
        {KEYS.map(([k, what]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <kbd className="rounded-[2px] border border-white/10 px-1 text-[9px] text-white/40">
              {k}
            </kbd>
            <span className="text-[9px] text-white/30">{what}</span>
          </div>
        ))}
      </div>

      <p className="mt-2.5 border-t border-white/10 pt-2 text-[9px] leading-relaxed text-white/25">
        {body === 'moon'
          ? 'A sixth of the grip, so you start slowly and cannot stop quickly. Above the gait speed a walk has to become a hop — which is what the crews found.'
          : 'The complex is graded flat, and the boots stay on the ground that is drawn rather than wandering onto relief that is not.'}
      </p>
    </div>
  )
}

/**
 * How anyone finds out the walk exists.
 *
 * Cameras in this simulator are on the number keys and nothing on screen lists
 * them, which is fine for a camera — they are alternatives to each other, and
 * a viewer who never presses 4 has still seen the Moon. The walk is not an
 * alternative to anything; it is the only way to be *in* the scene rather than
 * looking at it, and a mode nobody presses a key for is a mode nobody has. So
 * the one view it follows from — the person standing on the ground — carries
 * one line offering it, and only that view, so it is an invitation in the one
 * place it makes sense rather than a permanent label.
 */
export function WalkPrompt() {
  const onGround = useUi((s) => s.focus === 'ground')
  if (!onGround) return null
  return (
    <div className="panel pointer-events-none rounded-sm px-3 py-2">
      <span className="text-[10px] text-white/45">
        <kbd className="mr-1.5 rounded-[2px] border border-white/15 px-1 text-[9px] text-hud/70">G</kbd>
        step out and walk
      </span>
    </div>
  )
}
