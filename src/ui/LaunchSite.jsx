import {
  LAUNCH_SITES,
  activeSite,
  inclinationFor,
  rotationBonus,
  selectSite,
  siteDeflection,
  siteGravity,
} from '../sim/launchsite.js'
import { G0, SHIP } from '../sim/constants.js'
import { resetSimulation } from '../sim/live.js'
import { resetMission } from '../sim/mission.js'
import { setUi, useUi } from '../sim/store.js'

/**
 * The stack's liftoff mass and its thrust-to-weight, on standard gravity.
 *
 * Hoisted to module load rather than recomputed per render: the panel lists four
 * pads and each one's figure is this divided by that pad's own g, which is the
 * whole point of showing it. 1.166 is the number the vehicle is documented at,
 * and it is the number the panel is meant to be checked against.
 */
const LIFTOFF_MASS = SHIP.stages.reduce((m, s) => m + s.dryMass + s.propellant, 0)
const LIFTOFF_TW = SHIP.stages[0].thrust / (LIFTOFF_MASS * G0)

/**
 * Which pad the stack is standing on.
 *
 * Two numbers and a heading, and all three reach into the flight: latitude
 * fixes how much of the planet's rotation the vehicle starts with and the
 * lowest inclination it can reach, and the azimuth decides how much of that
 * rotation actually points downrange. Kourou hands over 463 m/s of the 463 it
 * has; Vandenberg, launching south, keeps 66 of its 382.
 *
 * Choosing one starts the flight over, because a vehicle is *clamped* to its
 * pad — there is no sense in which it can move to another one mid-ascent.
 */
export function LaunchSite() {
  const current = useUi((s) => s.site)

  const choose = (id) => {
    if (id === current) return
    selectSite(id)
    resetSimulation()
    resetMission()
    setUi({ site: id })
  }

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">Launch site</div>
      <div className="space-y-0.5">
        {Object.values(LAUNCH_SITES).map((site) => {
          const on = site.id === (current ?? activeSite().id)
          const downrange = rotationBonus(site) * Math.sin((site.azimuth * Math.PI) / 180)
          return (
            <button
              key={site.id}
              onClick={() => choose(site.id)}
              aria-pressed={on}
              className={`w-full rounded-[2px] px-1.5 py-1 text-left transition-colors ${
                on ? 'bg-hud/12' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-[11px] ${on ? 'text-hud' : 'text-white/70'}`}>
                  {site.name}
                </span>
                <span className="font-mono text-[9px] text-white/35">
                  {Math.abs(site.latitude).toFixed(1)}°{site.latitude >= 0 ? 'N' : 'S'}
                </span>
              </div>
              <div className="text-[9px] tracking-[0.1em] text-white/30 uppercase">
                {inclinationFor(site).toFixed(1)}° orbit · {downrange.toFixed(0)} m/s free
              </div>
              <div className="font-mono text-[9px] text-white/25">
                {siteGravity(site).toFixed(3)} m/s² · T/W{' '}
                {(LIFTOFF_TW * (G0 / siteGravity(site))).toFixed(3)}
              </div>
            </button>
          )
        })}
      </div>
      <div className="mt-2 border-t border-white/8 pt-2 text-[9px] leading-relaxed text-white/25">
        The stack is held to its pad, so choosing one starts the count again. The g is the pad's
        own, from Earth's interior rather than from 9.80665: a plumb line stands{' '}
        {Math.abs(siteDeflection(activeSite()) * (180 / Math.PI)).toFixed(2)}° off the
        geocentric radius here, so don't look for the tower to be radial.
      </div>
    </div>
  )
}
