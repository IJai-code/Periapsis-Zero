import { useEffect } from 'react'
import { input, separate, ship } from '../sim/ship.js'
import { setUi, uiStore } from '../sim/store.js'

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
      /**
       * W and S belong to the free-flight camera while it is active.
       *
       * That camera translates in the view frame and needs the whole WASD
       * cluster; A, D, R and F are unclaimed, so W and S are the only overlap.
       * Yielding them is better than binding the camera to something else,
       * because the pair a hand reaches for is the pair a hand reaches for —
       * and a detached observer is not flying the vehicle anyway.
       */
      const flying = uiStore.get().focus === 'fly'
      input.throttleUp = !flying && held.has('KeyW')
      input.throttleDown = !flying && held.has('KeyS')
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
    // Entering or leaving free flight mid-hold has to re-fold the axes, or a
    // throttle key held across the change stays applied with nothing reading it.
    const unsubscribe = uiStore.subscribe(refresh)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      unsubscribe()
      onBlur()
    }
  }, [])

  return null
}
