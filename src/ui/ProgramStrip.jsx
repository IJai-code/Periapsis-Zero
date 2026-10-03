import { useEffect, useRef, useSyncExternalStore } from 'react'
import { subscribeUiTick } from './uiClock.js'
import { program, STORY } from '../sim/programs.js'
import { storyDone, storyState, subscribeStory } from '../sim/story.js'
import { beginDef } from './beginDef.js'

/**
 * The program checklist, live.
 *
 * A pilot flying their own mission needs one thing the presets never had to
 * provide: to know where they are in *their own* plan. This strip is that.
 * It reads the program's objectives, each one evaluated from the
 * simulation, never from a UI flag, and draws them as a flight plan is
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
  /*
   * Re-render only when a chapter is recorded. The tick below writes the
   * marks and bars straight to the DOM; this subscription exists so the one
   * moment that changes the panel's *shape* (a chapter flown, and the next
   * chapter offered) happens the tick it is true, by the same record that
   * unlocks the board.
   */
  useSyncExternalStore(subscribeStory, storyState, storyState)

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

  if (!armed || !program.def) {
    /*
     * Nothing armed, and the tracker becomes the story's standing rather than
     * disappearing. A checklist that vanishes when the flight has no plan is
     * correct and useless: the first question a new pilot has is "what is
     * there to do", and the answer is the chapter the story is waiting on.
     * The first chapter not yet flown is always the unlocked one, by the same
     * rule the board applies.
     */
    const doneCount = STORY.filter((c) => storyDone(c.id)).length
    const nextIndex = STORY.findIndex((c) => !storyDone(c.id))
    const next = nextIndex >= 0 ? STORY[nextIndex] : null
    return (
      <div className="panel w-52 rounded-sm p-3.5">
        <div className="rule mb-2.5 border-b border-white/10 pb-2">
          The story · {doneCount}/{STORY.length}
        </div>
        {next ? (
          <>
            <div className="font-mono text-[9px] tracking-[0.24em] text-ember uppercase">
              Chapter {nextIndex + 1} of {STORY.length}
            </div>
            <div className="mt-1 text-[12px] text-white/85">{next.name}</div>
            <p className="mt-1 text-[10px] leading-snug text-hud/50">{next.brief}</p>
            <button
              onClick={() => beginDef(next)}
              className="control mt-2 w-full border border-hud/20 px-2 py-1.5 font-mono text-[9px] tracking-[0.18em] text-hud/60 uppercase outline-none transition-colors duration-300 hover:border-ember/70 hover:text-ember focus-visible:border-ember focus-visible:text-ember"
            >
              Begin the chapter
            </button>
          </>
        ) : (
          <p className="text-[10px] leading-snug text-hud/50">
            All six flown. The sky writes more in the Almanac.
          </p>
        )}
      </div>
    )
  }

  /*
   * A story chapter rides the same strip as any program, the machinery is
   * identical, but it carries its number and its brief, because a chapter
   * is a place in a sequence and the pilot should feel where they stand.
   */
  const chapter = program.def.story ? STORY.findIndex((c) => c.id === program.def.id) + 1 : 0
  const flown = chapter > 0 && program.objectives.length > 0 && program.objectives.every((o) => o.done)
  const nextChapter = chapter > 0 ? (STORY[chapter] ?? null) : null

  return (
    <div ref={root} className="panel w-52 rounded-sm p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between border-b border-white/10 pb-2">
        <span className="rule">{program.def.name}</span>
        <span data-done className="font-mono text-[9.5px] text-hud/50 tabular-nums">
          ·
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
      {flown && (
        <div className="mt-2.5 border-t border-white/10 pt-2">
          <div className="rule mb-1.5">Chapter flown</div>
          {nextChapter ? (
            <button
              onClick={() => beginDef(nextChapter)}
              className="control w-full border border-ember/60 px-2 py-1.5 font-mono text-[9px] tracking-[0.18em] text-ember uppercase outline-none transition-colors duration-300 focus-visible:border-ember"
            >
              Begin {nextChapter.name} →
            </button>
          ) : (
            <p className="text-[10px] leading-snug text-hud/50">
              All six flown. The sky writes more in the Almanac.
            </p>
          )}
        </div>
      )}
      <div className="mt-2.5 border-t border-white/10 pt-2 font-mono text-[9px] tracking-[0.18em] text-white/25 uppercase">
        {program.wing?.name} wings · flown by you
      </div>
    </div>
  )
}
