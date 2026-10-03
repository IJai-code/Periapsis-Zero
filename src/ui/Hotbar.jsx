import { setUi, useUi } from '../sim/store.js'
import { SHIP } from '../sim/constants.js'

/**
 * The view hotbar: the camera's number keys, out where a hand can see them.
 *
 * Ten keys have always cut between cameras, and until now nothing on screen
 * said so. `WalkHud` argues its own corner with exactly this admission: a
 * binding nobody can see is a feature nobody has. So the bindings become
 * slots: the game's hotbar at the foot of the frame, one quick-cut per
 * number, each slot wearing its key the way every control here wears the
 * shortcut it replaces.
 *
 * Clicking a slot is pressing its key, and the slot for the camera already on
 * screen is lit, so the bar also answers the question a cut just leaves
 * behind: what am I looking at now. The key map lives here rather than in the
 * keyboard handler because this bar is the bindings' public face; the handler
 * reads the same table, so the keys and the slots can never drift apart.
 *
 * It stays up on foot on purpose. Down there the keyboard belongs to the feet
 * and the rest of the cockpit folds away, which would leave a walker holding
 * WASD with no pointer path back to the sky. The bar is that path: one click
 * and the walk is behind you.
 */

/** The quick-cut slots, in the order of their keys. `id` is the camera lock. */
const SLOTS = [
  { key: '0', id: 'ground', name: 'Ground' },
  { key: '1', id: 'free', name: 'Free' },
  { key: '2', id: 'sun', name: 'Sol' },
  { key: '3', id: 'earth', name: 'Terra' },
  { key: '4', id: 'moon', name: 'Luna' },
  /*
   * Your own ship reads "Ship" in a slot, because the slot's business is
   * which camera, and the vessel's name is in the tooltip where a name
   * belongs. A slot whose label changes with the vessel is a slot the hand
   * cannot learn.
   */
  { key: '5', id: 'ship', name: 'Ship', title: SHIP.name },
  { key: '6', id: 'chase', name: 'Chase' },
  { key: '7', id: 'iss', name: 'ISS' },
  { key: '8', id: 'hubble', name: 'Hubble' },
  { key: '9', id: 'fly', name: 'Fly' },
]

/** The same table as a key map, which is what the keyboard handler reads. */
export const VIEW_KEYS = Object.fromEntries(SLOTS.map((s) => [s.key, s.id]))

export function Hotbar() {
  const focus = useUi((s) => s.focus)

  return (
    <div className="panel flex max-w-[calc(100vw-1.5rem)] items-center gap-1 overflow-x-auto rounded-sm px-3 py-2">
      <div className="rule shrink-0 pr-1.5">Views</div>
      {SLOTS.map((s) => {
        const on = focus === s.id
        return (
          <button
            key={s.id}
            onClick={() => setUi({ focus: s.id })}
            title={`${s.title ?? s.name} · key ${s.key}`}
            className={`control flex h-8 shrink-0 items-baseline gap-1.5 rounded-sm px-2.5 outline-none focus-visible:text-ember ${on ? 'lit text-ember' : 'text-hud/50 hover:text-ember'}`}
          >
            <span className="font-mono text-[8px] text-white/30">{s.key}</span>
            <span className="text-[9px] tracking-[0.2em] uppercase">{s.name}</span>
          </button>
        )
      })}
    </div>
  )
}
