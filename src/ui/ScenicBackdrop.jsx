import { Canvas } from '@react-three/fiber'
import { ACESFilmicToneMapping } from 'three'
import { ExpeditionScene } from '../components/ExpeditionScene.jsx'

/**
 * The live scene behind Landing and Story.
 *
 * Extracted so the entry can load it from a dynamic import: the interface
 * itself paints on react alone, and the renderer arrives a moment later
 * instead of gating first paint on three.js. Same camera, same scene, same
 * paused session it has always had, only the ownership of the import moved.
 */
export default function ScenicBackdrop({ session, controls, visible }) {
  return <Canvas shadows frameloop={visible ? 'always' : 'never'} dpr={[1, 1.5]} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, powerPreference: 'high-performance' }} camera={{ position: [360, 110, 370], fov: 55, near: 0.1, far: 90000 }}>
    <ExpeditionScene session={session} controls={controls} paused scenic />
  </Canvas>
}
