import { useEffect, useRef } from 'react'
import { subscribeUiTick } from './uiClock.js'
import { program, STORY } from '../sim/programs.js'

/**
 * The program checklist, live.
 *
 * A pilot flying their own mission needs one thing the presets never had to
 * provide: to know where they are in *their own* plan. This strip is that.
 * It reads the program's objectives — each one evaluated from the
 * simulation, never from a UI flag — and draws them as a flight plan is
 * drawn on a checklist: done, or not, with the current leg's progress
 * bar moving under it.
 *
 * It renders on the pulse, not on React state: the objectives' progress
 * values move every frame the sim does, and re-rendering a tree to move a
 * bar would be the HUD paying for its own enthusiasm. The DOM writes are
 * the same pattern every live readout in this panel uses.
 */
export function ProgramStrip() {
  const armed = program.armed
  const root = useRef(null)

  useEffect(() => {
    if (!program.armed) return
    const tick = () => {
      const el = root.current
      if (!el) return
      for (const o of program.objectives) {
        const row = el.querySelector(`[data-obj="${o.id}"]`)
        if (!row) continue
        row.querySelector('[data-mark]').textContent = o.done ? '✓' : '·'
        row.classList.toggle('text-hud', o.done)
        row.classList.toggle('text-white/40', !o.done)
        const bar = row.querySelector('[data-bar]')
        if (bar) bar.style.width = `${Math.round((o.progress ?? 0) * 100)}%`
      }
      const done = el.querySelector('[data-done]')
      if (done) done.textContent = `${program.objectives.filter((o) => o.done).length}/${program.objectives.length}`
    }
    tick()
    return subscribeUiTick(tick, 1)
  }, [program.armed, program.def?.id])

  if (!armed || !program.def) return null

  /*
   * A story chapter rides the same strip as any program — the machinery is
   * identical — but it carries its number and its brief, because a chapter
   * is a place in a sequence and the pilot should feel where they stand.
   */
  const chapter = program.def.story ? STORY.findIndex((c) => c.id === program.def.id) + 1 : 0

  return (
    <div ref={root} className="panel w-52 rounded-sm p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between border-b border-white/10 pb-2">
        <span className="rule">{program.def.name}</span>
        <span data-done className="font-mono text-[9.5px] text-hud/50 tabular-nums">
          —
        </span>
      </div>
      {chapter > 0 && (
        <div className="mb-2">
          <div className="font-mono text-[9px] tracking-[0.24em] text-ember uppercase">
            Chapter {chapter} of {STORY.length}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-hud/50">{program.def.brief}</p>
        </div>
      )}
      <div className="space-y-2">
        {program.objectives.map((o) => (
          <div key={o.id} data-obj={o.id} className="text-[11px] text-white/40 transition-colors">
            <div className="flex items-baseline gap-2">
              <span data-mark className="w-2 shrink-0 font-mono text-ember">
                ·
              </span>
              <span className="leading-snug">{o.label}</span>
            </div>
            <div className="mt-1 ml-4 h-px w-full bg-white/8">
              <div data-bar className="h-full bg-ember/70 transition-[width] duration-500" style={{ width: '0%' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 border-t border-white/10 pt-2 font-mono text-[9px] tracking-[0.18em] text-white/25 uppercase">
        {program.wing?.name} wings · flown by you
      </div>
    </div>
  )
}
