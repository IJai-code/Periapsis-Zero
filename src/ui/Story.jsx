import { useSyncExternalStore } from 'react'
import { STORY, program } from '../sim/programs.js'
import { storyDone, storyState, subscribeStory } from '../sim/story.js'
import { beginDef } from './beginDef.js'

/**
 * The story board.
 *
 * Six chapters, flown in order; each unlocks the one after it by having been
 * *flown*, the record is written by `tickProgram` off the live objectives,
 * never by a button. The chapter flies with the Trainee wing so the computer
 * carries the book parts and the pilot carries the checklist; anyone who has
 * earned a freer wing can fly it their way through the planner.
 *
 * The board re-renders on three things, and only these: a chapter recorded
 * (the story store says so), a program armed or cleared (a store change
 * happened when it was armed), and the drawer opening (mount). It does not
 * tick, progress lives on the checklist riding the instruments, which is
 * where a pilot reads it, in the air.
 */
export function Story() {
  useSyncExternalStore(subscribeStory, storyState, storyState)
  const armedId = program.armed ? program.def?.id : null
  const doneCount = STORY.filter((c) => storyDone(c.id)).length

  return (
    <div className="panel w-48 rounded-sm p-3.5">
      <div className="rule mb-2.5 border-b border-white/10 pb-2">
        Flight school · {doneCount}/{STORY.length}
      </div>
      <p className="mb-2.5 text-[10px] leading-snug text-hud/45">
        Six orbital lessons, from the tower to the Moon. The new survey campaign is under Campaign in the menu.
      </p>
      <div className="space-y-2.5">
        {STORY.map((c, i) => {
          const done = storyDone(c.id)
          const unlocked = i === 0 || storyDone(STORY[i - 1].id)
          const armed = armedId === c.id
          return (
            <div key={c.id} className={armed ? 'border-l border-ember pl-2.5' : 'pl-2.5'}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[12px] ${armed ? 'text-ember' : done ? 'text-hud' : 'text-white/85'}`}>
                  <span className="mr-1.5 font-mono text-[9px] text-hud/40">{i + 1}</span>
                  {c.name}
                </span>
                {done && !armed && (
                  <span className="font-mono text-[9px] tracking-[0.14em] text-hud/45 uppercase">flown</span>
                )}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-hud/50">{c.brief}</p>
              <button
                onClick={() => unlocked && beginDef(c)}
                disabled={!unlocked}
                aria-disabled={!unlocked}
                className={`control mt-1.5 inline-flex min-h-9 w-full items-center justify-center border px-2 font-mono text-[9px] tracking-[0.18em] uppercase outline-none transition-colors duration-300 focus-visible:border-ember focus-visible:text-ember ${
                  armed
                    ? 'border-ember/60 text-ember'
                    : unlocked
                      ? 'border-hud/20 text-hud/60 hover:border-ember/70 hover:text-ember'
                      : 'cursor-default border-white/6 text-white/25'
                }`}
              >
                {armed ? 'On this flight' : done ? 'Fly it again' : unlocked ? 'Begin the lesson' : 'Fly the one before'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
