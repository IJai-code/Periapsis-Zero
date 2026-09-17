import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { currentPhase, mission } from '../sim/mission.js'
import { activeStage, ship, totalMass } from '../sim/ship.js'
import { live } from '../sim/live.js'
import { G0 } from '../sim/constants.js'
import { INDEX } from '../sim/system.js'
import { dominantBody } from '../sim/soi.js'
import { nodeBasis } from '../sim/nodes.js'

const _p = new Vector3()
const _n = new Vector3()
const _o = new Vector3()
const BODY_NAME = { sun: 'Sol', earth: 'Terra', moon: 'Luna' }

/** What is left of a burn that cuts off on mass: exact, from the rocket equation, on one stage. */
function remainingByMass(targetMass) {
  const stage = activeStage()
  const m = totalMass()
  if (!stage || !(targetMass > 0) || !(m > targetMass)) return 0
  return stage.isp * G0 * Math.log(m / targetMass)
}

/** A planned burn named for what planned it, where something did. */
function nodeName() {
  const id = mission.node.active?.id
  const c = mission.capture
  if (id > 0 && c.planned) {
    if (id === c.nodes.capture) return 'Halo capture'
    if (id === c.nodes.plane) return 'Plane change'
    if (id === c.nodes.correction) return 'Transfer correction'
    if (id === c.nodes.insertion) return 'Halo insertion'
  }
  const lo = mission.tli.loiter
  if (id > 0 && (id === lo.node1 || id === lo.node2)) return 'Loiter raise'
  return 'Planned burn'
}

/**
 * Every burn the flight computer flies, and how to read it.
 *
 * `delivered` where the sequencer integrates it, `remaining` where the burn cuts
 * off on a mass — either way the other follows from the target. The cutoff is
 * each burn's own criterion as its phase states it: only the planned and mass
 * burns stop on a delta-v; injection stops on apoapsis, capture on the
 * eccentricity minimum, departure on characteristic energy.
 */
const MCC = {
  name: () => 'Mid-course correction',
  target: () => mission.mcc.magnitude,
  remaining: () => remainingByMass(mission.mcc.targetMass),
  pointing: () => ship.forward.angleTo(mission.mcc.direction),
  cutoff: 'on delivered Δv',
}
const LOI = {
  name: () => 'Lunar orbit insertion',
  target: () => mission.loi.deltaVEstimate,
  delivered: () => mission.loi.deltaVDelivered,
  pointing: () => mission.loi.pointingError,
  cutoff: 'at the eccentricity minimum',
}
const TEI = {
  name: () => 'Trans-Earth injection',
  target: () => mission.tei.deltaVEstimate,
  delivered: () => mission.tei.deltaVDelivered,
  pointing: () => mission.tei.pointingError,
  cutoff: 'on characteristic energy',
}
const EI = {
  name: () => 'Corridor trim',
  target: () => mission.ei.magnitude,
  remaining: () => remainingByMass(mission.ei.targetMass),
  pointing: () => mission.ei.pointingError,
  cutoff: 'on delivered Δv',
}
const NODE = {
  name: nodeName,
  target: () => mission.node.target,
  delivered: () => mission.node.delivered,
  pointing: () => mission.node.pointingError,
  cutoff: 'on delivered Δv',
}
const BURNS = {
  TLI_BURN: {
    name: () => 'Trans-lunar injection',
    target: () => mission.tli.deltaV,
    cutoff: "when apoapsis reaches the Moon's distance",
  },
  MCC_SOLVE: MCC,
  MCC_BURN: MCC,
  LOI_ALIGN: LOI,
  LOI_BURN: LOI,
  TEI_ALIGN: TEI,
  TEI_BURN: TEI,
  EI_SOLVE: EI,
  EI_BURN: EI,
  NODE_ALIGN: NODE,
  NODE_BURN: NODE,
  NRHO_STATION_KEEP: {
    name: () => 'Halo maintenance',
    target: () => mission.nrho.deltaV,
    remaining: () => remainingByMass(mission.nrho.targetMass),
    pointing: () => mission.nrho.pointingError,
    cutoff: 'on delivered Δv',
    active: () => mission.nrho.converged && mission.nrho.deltaV > 1e-6 && !mission.nrho.burnt,
  },
}

const ms = (dv) => (dv >= 100 ? dv.toFixed(0) : dv >= 1 ? dv.toFixed(1) : dv.toFixed(3))
const seconds = (s) => (s >= 90 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`)
const signed = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`

/**
 * The burn being flown: what it is asked for, how much is left, when it stops,
 * and where the thrust axis points against the orbit it is changing.
 *
 * Written into the DOM on the HUD's own clock, like the instruments beside it.
 * Outside the panel toggle, because a burn is the one moment nobody should have
 * to go looking for its numbers.
 */
export function BurnPanel() {
  const [kind, setKind] = useState(null)
  const refs = {
    chip: useRef(),
    dv: useRef(),
    togo: useRef(),
    when: useRef(),
    axis: useRef(),
  }
  const tliStart = useRef(0)

  useEffect(() => {
    const tick = () => {
      const id = currentPhase().id
      const burn = BURNS[id]
      const live_ = burn && (!burn.active || burn.active()) ? id : null
      setKind(live_)
      if (id !== 'TLI_BURN') tliStart.current = 0
      if (!live_) return

      const lit = ship.thrust > 0
      const target = burn.target() || 0
      let delivered
      let remaining
      if (burn.delivered) {
        delivered = burn.delivered()
        remaining = Math.max(0, target - delivered)
      } else if (burn.remaining) {
        remaining = burn.remaining()
        delivered = Math.max(0, target - remaining)
      } else {
        // Injection keeps no tally of its own; measured from the mass at the
        // first sample of the burn, a tenth of a second late at worst.
        if (!tliStart.current) tliStart.current = totalMass()
        const stage = activeStage()
        delivered = stage ? stage.isp * G0 * Math.log(tliStart.current / totalMass()) : 0
        remaining = Math.max(0, target - delivered)
      }

      const set = (ref, text) => {
        if (ref.current && ref.current.textContent !== text) ref.current.textContent = text
      }
      set(refs.chip, lit ? 'Lit' : 'Aligning')
      set(refs.dv, `${ms(delivered)} of ${ms(target)} m/s`)
      set(refs.togo, `${ms(remaining)} m/s to go`)
      const acceleration = ship.mass > 0 ? ship.thrust / ship.mass : 0
      if (lit && acceleration > 0) {
        set(refs.when, `cutoff ${burn.cutoff}${burn.delivered || burn.remaining ? `, about ${seconds(remaining / acceleration)}` : ''}`)
      } else if (burn.pointing) {
        set(refs.when, `pointing ${((burn.pointing() * 180) / Math.PI).toFixed(1)}° off the burn axis`)
      } else {
        set(refs.when, `cutoff ${burn.cutoff}`)
      }

      const body = dominantBody(live.sim, 'ship') ?? 'earth'
      if (nodeBasis(live.sim.state, INDEX.ship * 6, INDEX[body] * 6, _p, _n, _o)) {
        const f = ship.forward
        set(
          refs.axis,
          `prograde ${signed(f.dot(_p))} · normal ${signed(f.dot(_n))} · radial ${signed(f.dot(_o))} · about ${BODY_NAME[body] ?? body}`,
        )
      }
    }
    tick()
    const timer = setInterval(tick, 110)
    return () => clearInterval(timer)
  }, [])

  if (!kind) return null
  const burn = BURNS[kind]
  return (
    <div className="panel pointer-events-none w-[min(26rem,90vw)] rounded-sm px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-1.5">
        <span className="font-display text-[12px] tracking-[0.18em] text-white/85 uppercase">{burn.name()}</span>
        <span
          ref={refs.chip}
          className="rounded-[2px] bg-hud/15 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.18em] text-hud uppercase"
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px] text-white/75">
        <span ref={refs.dv} />
        <span ref={refs.togo} className="text-white/50" />
      </div>
      <div ref={refs.when} className="mt-0.5 text-[10px] text-white/45" />
      <div ref={refs.axis} className="mt-1 font-mono text-[9px] tracking-[0.06em] text-white/35" />
    </div>
  )
}
