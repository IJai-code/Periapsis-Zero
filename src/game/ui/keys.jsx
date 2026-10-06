/**
 * Control hints in mission text: `[thrust]` and friends, drawn as the right
 * key on a computer and the right button on a tablet.
 */
const DESKTOP = {
  aim: 'Mouse', thrust: 'W', brake: 'S', boost: 'Shift', fa: 'Z', stop: 'X', dock: 'F', target: 'T', fire: 'Left click', map: 'M', transfer: 'J',
  launch: 'Enter', strafe: 'A D', roll: 'Q E', barrel: 'double-tap A or D', pause: 'Esc', log: 'Tab', help: 'H',
}
const TOUCH = {
  aim: 'the stick', thrust: 'the throttle', brake: 'the throttle', boost: 'Boost', fa: 'Assist', stop: 'Stop', dock: 'the action button', target: 'Target', fire: 'Fire', map: 'Map', transfer: 'the action button',
  launch: 'Launch', strafe: 'the stick', roll: 'the stick', barrel: 'Roll', pause: 'Menu', log: 'Jobs', help: 'Help',
}
export const keyName = (k, touch) => (touch ? TOUCH : DESKTOP)[k] ?? k

/** Render a string with [tokens] as key caps. */
export function Hint({ text, touch }) {
  if (!text) return null
  const parts = String(text).split(/(\[[a-z]+\])/g)
  return <>{parts.map((p, i) => {
    const m = /^\[([a-z]+)\]$/.exec(p)
    if (!m) return p
    return <kbd key={i} className={`gk ${touch ? 'touch' : ''}`}>{keyName(m[1], touch)}</kbd>
  })}</>
}

/** The full controls card, for help and the first launch. */
export const CONTROL_LIST = [
  ['Aim and steer', 'Mouse (click the view to take the stick)', 'Left stick'],
  ['Throttle up / down', 'W / S', 'Throttle slider'],
  ['Stop', 'X', 'Stop'],
  ['Strafe', 'A / D, Space / C', '(assist handles it)'],
  ['Roll', 'Q / E', '(automatic)'],
  ['Barrel roll (dodge)', 'Double-tap A / D or Q / E', 'Roll buttons'],
  ['Boost', 'Shift (hold)', 'Boost (hold)'],
  ['Fire', 'Left click (hold)', 'Fire (hold)'],
  ['Target next', 'T or right click', 'Target'],
  ['Flight assist on / off', 'Z', 'Assist'],
  ['Dock / land / interact', 'F', 'Action button'],
  ['Map and destinations', 'M', 'Map'],
  ['Transfer to destination', 'J', 'Action button'],
  ['Jobs and missions', 'Tab', 'Jobs'],
  ['Hail the pilots near you', 'G', 'Wave'],
  ['Pause, settings, help', 'Esc', 'Menu'],
]
