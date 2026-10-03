import { Presets } from './Presets.jsx'
import { Contracts } from './Contracts.jsx'
import { LaunchSite } from './LaunchSite.jsx'
import { Geophysics } from './Geophysics.jsx'
import { ModelSelector } from './ModelSelector.jsx'
import { Toggles } from './Toggles.jsx'
import { Story } from './Story.jsx'
import { Briefings } from './Briefings.jsx'
import { SHIP } from '../sim/constants.js'

/**
 * The flight setup drawer.
 *
 * Six panels used to ride the left rail side by side, missions, contracts,
 * the launch site, the planet's interior, the craft catalogue, the display
 * switches, and the rail measured as a filing cabinet: nothing in it was
 * wrong, and all of it was on screen at once. But the panels share one
 * character: they are things a pilot sets *around* a flight, not instruments
 * read *during* one. So they share a drawer, behind one key (S) and one
 * button, and the rail they used to own belongs to the flight again.
 *
 * Composition, not re-implementation: each panel stays the panel it was —
 * its own header, its own rules, testable in its own right, and the drawer
 * is the shelf it sits on. Two panels have opinions about when they appear:
 * the launch site and the planet's interior say nothing when the vessel is
 * already on the Moon, and the story leads the stack because it is the one
 * thing here that knows what to do next.
 */
export function SetupDrawer() {
  return (
    <div className="pointer-events-auto w-[13.5rem] [&>div]:w-full" data-testid="setup-drawer">
      <Briefings />
      <Story />
      <Presets />
      <Contracts />
      {!SHIP.lunar && <LaunchSite />}
      <ModelSelector />
      {!SHIP.lunar && <Geophysics />}
      <Toggles />
    </div>
  )
}
