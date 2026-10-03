import { armProgram } from '../sim/programs.js'
import { resetMission } from '../sim/mission.js'
import { selectSite } from '../sim/launchsite.js'
import { setUi, uiStore } from '../sim/store.js'

/**
 * Begin a planned flight: a story chapter or an Almanac briefing.
 *
 * One path for arming, wherever the flight was begun from, so the pad choice,
 * the fuel load, the checklist on the rail and the hand-off to the ground
 * camera all behave identically. The chapter flies from where it makes sense;
 * the pilot's chosen pad stands if the plan is indifferent to it. The setup
 * drawer closes and the checklist takes over: beginning a flight is the
 * moment the setup ends.
 */
export function beginDef(def, wing = def.wings?.[0] ?? 'trainee') {
  const current = uiStore.get().site
  selectSite(def.sites.includes(current) ? current : def.sites[0])
  armProgram(def, wing)
  resetMission()
  setUi({ paused: false, focus: 'ground', broadcast: false, panelOpen: false, setup: false, boards: null })
}
