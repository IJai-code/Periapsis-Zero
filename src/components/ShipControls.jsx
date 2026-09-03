import { useEffect } from 'react'
import { input, separate, ship } from '../sim/ship.js'
import { setUi } from '../sim/store.js'

/**
 * Keyboard bindings for the craft.
 *
 * Held keys are tracked in a Set and folded down into the axis values on every
 * transition, so opposing keys cancel and releasing one while the other is
 * still down does the right thing. Keyed on `event.code` rather than `key`, so
 * the layout stays under the pilot's fingers on non-QWERTY keyboards.
 */
/**
 * `code` is the right key to bind to — it survives non-QWERTY layouts. But not
 * every source populates it (virtual keyboards, some automation), so fall back
 * to synthesising the equivalent name from `key`.
 */
const keyId = (e) => {
  if (e.code && e.code !== 'Unidentified') return e.code
  const k = e.key
  return k && k.length === 1 ? `Key${k.toUpperCase()}` : k
}

const AXES = [
  ['pitch', 'KeyI', 'KeyK'],
  ['yaw', 'KeyJ', 'KeyL'],
  ['roll', 'KeyQ', 'KeyE'],
]

export function ShipControls() {
  useEffect(() => {
    const held = new Set()

    const refresh = () => {
      for (const [axis, neg, pos] of AXES) {
        input[axis] = (held.has(neg) ? -1 : 0) + (held.has(pos) ? 1 : 0)
      }
      input.throttleUp = held.has('KeyW')
      input.throttleDown = held.has('KeyS')
    }

    const onDown = (e) => {
      if (e.repeat) return
      const id = keyId(e)
      if (id === 'KeyX') ship.throttle = 0
      if (id === 'KeyZ') ship.throttle = 1
      if (id === 'KeyT') setUi((s) => ({ assist: !s.assist }))
      if (id === 'Enter') separate()
      held.add(id)
      refresh()
    }
    const onUp = (e) => {
      held.delete(keyId(e))
      refresh()
    }
    // Losing focus mid-input would otherwise leave a key stuck down forever.
    const onBlur = () => {
      held.clear()
      refresh()
    }

    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      onBlur()
    }
  }, [])

  return null
}
