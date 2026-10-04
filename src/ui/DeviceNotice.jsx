import { DEVICE_COPY, DEVICE_IDS, chooseDevice } from '../sim/device.js'
import { setUi, useUi } from '../sim/store.js'

/**
 * The device question, asked after the first frame instead of before it.
 *
 * The simulator used to block on a full-screen "What are you flying on?"
 * before drawing anything. It now starts with the detected device and says so
 * here, once, with the other two a click away. Changing reloads the page,
 * because antialiasing and the pad's forest are fixed when the scene is built.
 */
export function DeviceNotice() {
  const shown = useUi((s) => s.deviceGuessed)
  const device = useUi((s) => s.device)
  if (!shown) return null
  const dismiss = () => setUi({ deviceGuessed: false })
  const switchTo = (id) => {
    if (chooseDevice(id, { built: true })) window.location.reload()
    else dismiss()
  }
  return (
    <div className="panel pointer-events-auto max-w-72 rounded-sm px-3 py-2.5 text-[11px] text-hud/70">
      <div className="flex items-baseline justify-between gap-3">
        <span>Set up for a {DEVICE_COPY[device]?.label.toLowerCase() ?? 'computer'}.</span>
        <button onClick={dismiss} aria-label="Dismiss" className="control px-1 text-hud/40 hover:text-ember">×</button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="text-hud/45">Not right?</span>
        {DEVICE_IDS.filter((id) => id !== device).map((id) => (
          <button key={id} onClick={() => switchTo(id)} className="control border border-hud/20 px-2 py-0.5 text-hud/70 hover:border-ember hover:text-ember">
            {DEVICE_COPY[id].label}
          </button>
        ))}
      </div>
    </div>
  )
}
