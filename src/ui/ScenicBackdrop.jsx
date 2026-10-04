import { useEffect, useSyncExternalStore } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { ExpeditionScene } from '../components/ExpeditionScene.jsx'
import { subscribeSurfaceQuality, surfaceQuality } from '../gfx/surfaceQuality.js'

/**
 * The live scene behind Landing and Story.
 *
 * Extracted so the entry can load it from a dynamic import: the interface
 * itself paints on react alone, and the renderer arrives a moment later
 * instead of gating first paint on three.js. Same camera, same scene, same
 * paused session it has always had, only the ownership of the import moved.
 */
/*
 * The backdrop is a still: a fixed camera on a paused scene. It used to be
 * redrawn sixty times a second anyway, which on a slow laptop made the front
 * page itself the slowest thing on the site (3 frames a second measured on a
 * software renderer, with every scroll and click waiting on it). It is now
 * drawn on demand: a few frames while the ground and sky settle, then again
 * only when the window changes size.
 */
function Settle() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let n = 0
    const timer = setInterval(() => { invalidate(); if (++n > 12) clearInterval(timer) }, 250)
    return () => clearInterval(timer)
  }, [invalidate])
  return null
}

export default function ScenicBackdrop({ session, controls, visible }) {
  const quality = useSyncExternalStore(subscribeSurfaceQuality, surfaceQuality)
  return <Canvas shadows frameloop={visible ? 'demand' : 'never'} dpr={Math.min(window.devicePixelRatio || 1, quality.dpr)} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }} camera={{ position: [360, 110, 370], fov: 55, near: 0.1, far: 90000 }}>
    <ExpeditionScene session={session} controls={controls} paused scenic />
    <Settle />
  </Canvas>
}
