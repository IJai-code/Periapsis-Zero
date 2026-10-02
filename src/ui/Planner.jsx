import { useMemo, useState } from 'react'
import { PROGRAMS, WINGS, stackDeltaV, disarmProgram, armProgram } from '../sim/programs.js'
import { VESSELS } from '../sim/vessels.js'
import { LAUNCH_SITES, selectSite } from '../sim/launchsite.js'
import { setUi, uiStore } from '../sim/store.js'
import { resetMission } from '../sim/mission.js'

/**
 * The planner: where a flight is made before it is flown.
 *
 * ── what the pilot actually decides ──────────────────────────────────
 *
 * Four decisions, in the order they bind: the program (where the route
 * goes), the wing (how much of it is yours), the fuel load (how much
 * margin you carry), and the pad (which latitude the plane starts from).
 * Everything else — the Δv budget, the leg list, whether the plan closes —
 * is *derived*, and shown as derived: the rocket equation on the vessel's
 * own published numbers, against the route's priced cost, with the margin
 * in ember when it goes negative. Nothing here is a difficulty slider in
 * disguise; the wings change who holds the stick, not what the physics is.
 *
 * ── why planning is a screen and not a drawer ────────────────────────
 *
 * The presets already exist and stay: they are the missions as flown, for
 * the visitor who came to watch. The planner is for the visitor who came
 * to *fly* — and flying starts before the count, with the two minutes of
 * arithmetic every real crew runs the night before. The planner is that
 * arithmetic, on one page, with the honest numbers the sim itself will
 * use. Choosing a site here writes the same `launchsite.js` state the
 * pad-select drawer does; arming a program resets the mission with the
 * load already set, so the count begins on the planned vehicle.
 */

/** Route costs per program, in m/s, priced against the Apollo 8 stack. */
const PROGRAM_DV = (def) => def.legs.reduce((s, l) => s + l.dv, 0)

const SITE_LABEL = {
  ksc: 'Kennedy LC-39B · 28.6°',
  vandenberg: 'Vandenberg SLC-6 · 34.7°',
  kourou: 'Kourou ELA-3 · 5.2°',
  baikonur: 'Baikonur · 45.9°',
  tranquility: 'Tranquility Base · the Moon',
}

export function Planner({ onClose }) {
  const [picked, setPicked] = useState(PROGRAMS[0].id)
  const [wing, setWing] = useState('trainee')
  const [site, setSite] = useState(() => uiStore.get().site)

  const def = PROGRAMS.find((p) => p.id === picked)
  const vessel = VESSELS[def.vessel]
  const karman = wing === 'karman'
  const budget = useMemo(() => stackDeltaV(vessel, karman ? 0.84 : 1), [vessel, karman])
  const cost = PROGRAM_DV(def)
  const margin = budget - cost
  const siteOptions = Object.values(LAUNCH_SITES).filter((s) => def.sites.includes(s.id))

  const launch = () => {
    disarmProgram()
    selectSite(site)
    // The scaler is a no-op on purpose: resetMission itself drains the load
    // once the program is armed (it reads the wing off the armed program),
    // and armProgram re-applies it after for the arm-after-reset path. The
    // fraction lives in one place — programs.js — and not in two closures.
    armProgram(def, WINGS[wing] ? wing : 'trainee')
    resetMission()
    onClose()
    setUi({ paused: false, focus: 'ground', broadcast: false, panelOpen: true })
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-obsidian/92 backdrop-blur-[6px]">
      <div className="mx-auto max-w-4xl px-6 py-10 sm:px-10">
        {/* Masthead — same register as the front door, because this is the
            front door's other half: the room where a flight is made. */}
        <div className="flex items-baseline justify-between gap-6 border-b border-hud/12 pb-5">
          <div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-ember/80 uppercase">
              Flight planning
            </div>
            <h1 className="mt-2 font-display text-3xl font-light tracking-[0.04em] text-hud">
              Plan the mission
            </h1>
          </div>
          <button
            onClick={onClose}
            className="control min-h-9 border border-hud/20 px-4 py-1.5 font-mono text-[10px] tracking-[0.22em] text-hud/70 uppercase transition-colors duration-300 hover:border-ember hover:text-ember lg:min-h-0"
          >
            Close
          </button>
        </div>

        {/* The route */}
        <section className="mt-8">
          <div className="rule mb-3 font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
            1 · The route
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROGRAMS.map((p) => {
              const on = p.id === picked
              const reachable = stackDeltaV(VESSELS[p.vessel]) >= PROGRAM_DV(p)
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setPicked(p.id)
                    // A program the current wing cannot fly moves the wing
                    // rather than refusing: the wings are an offer, not a
                    // gate, and the cheapest correction is the honest one.
                    if (!p.wings.includes(wing)) setWing(p.wings[0])
                  }}
                  className={`control border px-4 py-3 text-left transition-colors duration-300 outline-none focus-visible:border-ember ${
                    on ? 'border-ember bg-ember/10' : 'border-hud/15 hover:border-hud/40'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`text-[13px] ${on ? 'text-ember' : 'text-hud/90'}`}>
                      {p.name}
                    </span>
                    <span className="font-mono text-[9px] tracking-[0.2em] text-hud/40 uppercase">
                      {p.group}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-hud/55">{p.blurb}</p>
                  <div className="mt-2 font-mono text-[9.5px] text-hud/40 tabular-nums">
                    {p.legs.length} burns · {(PROGRAM_DV(p) / 1000).toFixed(1)} km/s priced
                  </div>
                  {!reachable && (
                    <div className="mt-1 font-mono text-[9.5px] text-ember/80">
                      Beyond this vehicle's Δv — see the budget below
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {/* The wings */}
        <section className="mt-8">
          <div className="rule mb-3 font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
            2 · Your wings — who holds the stick
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {def.wings.map((w) => {
              const spec = WINGS[w]
              const on = w === wing
              return (
                <button
                  key={w}
                  onClick={() => setWing(w)}
                  className={`control border px-3 py-2.5 text-left transition-colors duration-300 outline-none focus-visible:border-ember ${
                    on ? 'border-ember bg-ember/10' : 'border-hud/15 hover:border-hud/40'
                  }`}
                >
                  <div className={`text-[12px] ${on ? 'text-ember' : 'text-hud/90'}`}>
                    {spec.name}
                  </div>
                  <div className="mt-1 text-[10px] leading-snug text-hud/50">
                    {spec.tagline}
                  </div>
                </button>
              )
            })}
          </div>
          {/* What the wing changes, in machine terms the pilot can hold. */}
          <div className="mt-2.5 text-[11px] leading-relaxed text-hud/45">
            {wing === 'trainee' &&
              'The flight computer flies the ascent and inserts you. From the parking orbit, the spacecraft is yours.'}
            {wing === 'aviator' &&
              'You fly the ascent from the pitch kick — throttle, attitude, the lot. The computer takes nothing back until MECO.'}
            {wing === 'aldrin' &&
              'After the count, nothing flies for you. Every burn is yours to plan; the powered-warp ceiling is yours to respect.'}
            {karman &&
              'As Aldrin, with 84% of the fuel. The margin is real: the budget below is the load you actually carry.'}
          </div>
        </section>

        {/* The budget — the one honest number on the page */}
        <section className="mt-8">
          <div className="rule mb-3 font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
            3 · The budget
          </div>
          <div className="border border-hud/15 px-4 py-3.5">
            <div className="flex items-baseline justify-between font-mono text-[11px] tabular-nums">
              <span className="text-hud/60">Route, priced ({def.legs.length} burns)</span>
              <span className="text-hud/85">{(cost / 1000).toFixed(2)} km/s</span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px] tabular-nums">
              <span className="text-hud/60">
                {vessel.name} stack, {karman ? '84% load' : 'full load'}
              </span>
              <span className="text-hud/85">{(budget / 1000).toFixed(2)} km/s</span>
            </div>
            <div className="mt-3 h-px bg-hud/12" />
            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="font-mono text-[10px] tracking-[0.2em] text-hud/50 uppercase">
                Margin
              </span>
              <span
                className={`font-mono text-[15px] tabular-nums ${
                  margin >= 0 ? 'text-hud' : 'text-ember'
                }`}
              >
                {margin >= 0 ? '+' : '−'}
                {(Math.abs(margin) / 1000).toFixed(2)} km/s
              </span>
            </div>
            {/* The route drawn as the bar it is: priced cost against what the
                stack delivers, at the load actually carried. */}
            <div className="mt-3 h-1.5 w-full bg-white/8">
              <div
                className={`h-full transition-all duration-500 ${
                  margin >= 0 ? 'bg-hud/60' : 'bg-ember'
                }`}
                style={{ width: `${Math.min(100, (cost / budget) * 100)}%` }}
              />
            </div>
            <div className="mt-3 text-[11px] leading-relaxed text-hud/45">
              Priced from the vehicle's own stages — dry mass, exhaust velocity,
              the lot — by the same rocket equation the flight computer flies.
              A negative margin is a plan that fails before the count: pick a
              shorter route or a fuller tank.
            </div>
          </div>
        </section>

        {/* The pad */}
        <section className="mt-8">
          <div className="rule mb-3 font-mono text-[10px] tracking-[0.26em] text-hud/45 uppercase">
            4 · The pad
          </div>
          <div className="flex flex-wrap gap-2">
            {siteOptions.map((s) => {
              const on = s.id === site
              return (
                <button
                  key={s.id}
                  onClick={() => setSite(s.id)}
                  className={`control border px-3.5 py-2 text-left transition-colors duration-300 outline-none focus-visible:border-ember ${
                    on ? 'border-ember bg-ember/10 text-ember' : 'border-hud/15 text-hud/85 hover:border-hud/40'
                  }`}
                >
                  <div className="text-[12px]">{s.name}</div>
                  <div className="font-mono text-[9.5px] text-hud/40">{SITE_LABEL[s.id]}</div>
                </button>
              )
            })}
          </div>
          <div className="mt-2.5 text-[11px] leading-relaxed text-hud/45">
            The pad sets the plane you climb out of: latitude is the cheapest
            inclination there is. Kourou throws east over the ocean; Vandenberg
            launches south for the polar orbits. The Moon is reached from any
            of them — the transfer solves for the date.
          </div>
        </section>

        {/* Go */}
        <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-hud/12 pt-6">
          <button
            onClick={launch}
            className="control border border-hud/45 px-10 py-4 font-sans text-[11px] font-medium tracking-[0.22em] text-hud uppercase transition-colors duration-300 outline-none hover:border-ember hover:bg-ember hover:text-obsidian focus-visible:border-ember"
          >
            To the pad · begin the count
          </button>
          <div className="font-mono text-[10px] tracking-[0.18em] text-hud/40 uppercase">
            {def.name} · {WINGS[wing].name} · {SITE_LABEL[site] ?? site}
          </div>
        </div>

        {/* The objectives, so the pilot knows what they agreed to. */}
        <div className="mt-6 mb-4 text-[11px] leading-relaxed text-hud/55">
          <span className="text-hud/50">Objectives: </span>
          {def.objectives.map((o) => o.label).join(' · ')}
        </div>
      </div>
    </div>
  )
}
