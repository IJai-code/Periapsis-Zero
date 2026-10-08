import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { experienceFromHash } from '../src/sim/experiences.js'
const sky = readFileSync('src/game/scene/Sky.jsx', 'utf8')
const milky = sky.slice(sky.indexOf('function milkyWay()'), sky.indexOf('const LOG_V'))
assert.doesNotMatch(milky, /logdepthbuf/, 'background must not interpolate scene log depth')
assert.match(milky, /depthTest: false, depthWrite: false/)
assert.match(milky, /transparent: false/, 'background belongs before opaque bodies, not the transparent pass')
assert.match(milky, /clip\.w \* 0\.9999/, 'background must remain within the far clip plane')
assert.doesNotMatch(milky, /pow\(lat|pow\(broad/, 'signed latitude must not reach undefined pow')
assert.doesNotMatch(sky, /smoothstep\(0\.5, 0\.0|smoothstep\(0\.3, -0\.1|smoothstep\(0\.35, -0\.05/)
assert.deepEqual(experienceFromHash('#training'), { mode: 'home', training: true })
assert.deepEqual(experienceFromHash('#flight'), { mode: 'simulator' })
const audio = readFileSync('src/game/audio.js', 'utf8')
const storage = new Map()
let sources = 0, effects = 0
const track = { paused: true, currentTime: 0, readyState: 4, play() { this.paused = false; return Promise.resolve() }, pause() { this.paused = true } }
const functions = new Function('window', 'localStorage', 'Audio', 'setAmbience', audio
  .replace(/import \{ setAmbience \} from '[^']+'/, '')
  .replaceAll('import.meta.env.BASE_URL', "'/'")
  .replaceAll('import.meta.env?.DEV', 'false')
  .replaceAll('export ', '') + '\nreturn {startSound,stopSound,play,engineLevel,soundDebug,setMusic,setMuted};')
const api = functions({}, { getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v) }, function(src) { sources++; track.src = src; return track }, () => { effects++ })
api.startSound(); api.startSound()
assert.equal(sources, 1)
assert.equal(track.src, '/audio/monume-space-ambient.mp3')
assert.equal(track.loop, true)
api.play('explode'); api.engineLevel(1, true, true)
assert.equal(sources, 1)
assert.equal(effects, 2, 'only ambience handoff, no generated audio')
api.setMusic(0.2); assert.equal(track.volume, 0.2)
api.setMuted(true); assert.equal(track.volume, 0)
api.stopSound(); assert.equal(track.paused, true)
console.log('Product remake: stable background policy, shader math, training route, music-only playback and cleanup pass.')
