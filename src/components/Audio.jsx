import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { setAudioEnabled, unlockAudio, updateAudio } from '../sfx/engine.js'
import { musicTick } from '../sfx/music.js'
import { uiStore, useUi } from '../sim/store.js'

/**
 * The engine's ear on the frame loop.
 *
 * Runs at priority -1: after the physics (-3) and the bodies (-2), so the
 * thrust and altitude it reads are this frame's, and before the render. It
 * reads the pause flag straight off the store rather than through a hook, so
 * the frame callback closes over nothing that changes and allocates nothing.
 *
 * The unlock listeners are the fallback for a page that skips the front door
 * — a preset link lands directly in `#flight`, where nobody clicks "Begin
 * flight". The first pointer or key does the same job and then the listeners
 * are gone.
 */
export function Audio() {
  const enabled = useUi((s) => s.audio)

  useEffect(() => {
    setAudioEnabled(enabled)
  }, [enabled])

  useEffect(() => {
    const off = () => {
      window.removeEventListener('pointerdown', once)
      window.removeEventListener('keydown', once)
    }
    const once = () => {
      unlockAudio()
      off()
    }
    window.addEventListener('pointerdown', once)
    window.addEventListener('keydown', once)
    return off
  }, [])

  useFrame((_, delta) => {
    updateAudio(uiStore.get().paused ? 0 : 1)
    /**
     * The score rides the same loop, at the same priority — after the physics,
     * before the render. It follows the sound toggle rather than the pause
     * flag: the mission intro is paused by design and is exactly when the score
     * is most wanted. `musicTick` is a no-op until `startMusic`, so this costs
     * a boolean test on every other frame of the product.
     */
    musicTick(Math.min(delta, 1 / 20), uiStore.get().audio ? 1 : 0)
  }, -1)

  return null
}
