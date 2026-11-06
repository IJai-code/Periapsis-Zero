import { useEffect, useRef, useState } from 'react'
import { Mark } from './Mark.jsx'

// --- LORE & MATHEMATICAL CONSTANTS DERIVED DIRECTLY FROM GAME FILES ---
// (Sources: reach_system.gd, orbit.gd, reach_map.gd, docs/reach.md)
const STAR_GM = 7.87e6
const STAR_RADIUS = 600.0
const LOOP_DURATION = 1320.0 // Exactly 22 minutes

class OrbitDef {
  constructor(gm, a, e = 0.0, m0 = 0.0, peri = 0.0, inc = 0.0, node = 0.0) {
    this.gm = gm
    this.a = a
    this.e = e
    this.m0 = m0
    this.peri = peri
    this.inc = inc
    this.node = node
  }

  period() {
    return 2 * Math.PI * Math.sqrt((this.a ** 3) / this.gm)
  }

  meanMotion() {
    return Math.sqrt(this.gm / (this.a ** 3))
  }

  solveEccentric(m) {
    m = ((m + Math.PI) % (2 * Math.PI)) - Math.PI
    let ea = this.e < 0.8 ? m : Math.PI * Math.sign(m)
    for (let i = 0; i < 30; i++) {
      const f = ea - this.e * Math.sin(ea) - m
      const d = 1.0 - this.e * Math.cos(ea)
      const step = f / d
      ea -= step
      if (Math.abs(step) < 1e-9) break
    }
    return ea
  }

  position(t) {
    const ea = this.solveEccentric(this.m0 + this.meanMotion() * t)
    const x = this.a * (Math.cos(ea) - this.e)
    const y = this.a * Math.sqrt(Math.max(0, 1.0 - this.e * this.e)) * Math.sin(ea)

    const cosP = Math.cos(this.peri + this.node)
    const sinP = Math.sin(this.peri + this.node)
    const cosI = Math.cos(this.inc)

    const rx = x * cosP - y * sinP * cosI
    const rz = -(x * sinP + y * cosP * cosI)
    return { x: rx, z: rz }
  }

  velocity(t) {
    const n = this.meanMotion()
    const ea = this.solveEccentric(this.m0 + n * t)
    const de = n / (1.0 - this.e * Math.cos(ea))
    const vx = -this.a * Math.sin(ea) * de
    const vy = this.a * Math.sqrt(Math.max(0, 1.0 - this.e * this.e)) * Math.cos(ea) * de
    return Math.hypot(vx, vy)
  }

  points(count = 140) {
    const pts = []
    const cosP = Math.cos(this.peri + this.node)
    const sinP = Math.sin(this.peri + this.node)
    const cosI = Math.cos(this.inc)

    for (let i = 0; i <= count; i++) {
      const ea = (2 * Math.PI * i) / count
      const x = this.a * (Math.cos(ea) - this.e)
      const y = this.a * Math.sqrt(Math.max(0, 1.0 - this.e * this.e)) * Math.sin(ea)
      pts.push({
        x: x * cosP - y * sinP * cosI,
        z: -(x * sinP + y * cosP * cosI),
      })
    }
    return pts
  }
}

const wandererPeri = 1150.0
const wandererApo = 13500.0
const wandererA = (wandererPeri + wandererApo) / 2.0
const wandererE = (wandererApo - wandererPeri) / (wandererApo + wandererPeri)
const wandererN = Math.sqrt(STAR_GM / (wandererA ** 3))

const BODIES = {
  lantern: {
    key: 'lantern',
    name: 'The Lantern',
    class: 'DYING STAR // BARYCENTER',
    radius: 600,
    gravity: 14.2,
    color: '#ff6b2c',
    glow: '#ffa366',
    special: 'Collapses every 22m into Periapsis Zero. Spacetime curvature spikes near deadline.',
    orbit: null,
    currentPos: { x: 0, z: 0 },
    currentSpeed: 0,
  },
  phantom: {
    key: 'phantom',
    name: 'The Phantom',
    class: 'QUANTUM MOONLET',
    radius: 70,
    gravity: 2.0,
    color: '#a795e6',
    glow: '#cfc4f5',
    special: 'Macroscopic quantum object. Teleports when not directly observed or radar-locked.',
    orbit: new OrbitDef(STAR_GM, 2900.0, 0.0, 1.0, 0.0, 0.05),
    quantumPhaseOffset: 0,
    currentPos: { x: 0, z: 0 },
    currentSpeed: 0,
  },
  hearthstone: {
    key: 'hearthstone',
    name: 'Hearthstone',
    class: 'HOME VILLAGE & CRATER',
    radius: 280,
    gravity: 8.5,
    color: '#2fd3ff',
    glow: '#8ae6ff',
    special: "Campfire, stilt cabins, launch tower, Isa's ring run. Mara plays banjo.",
    orbit: new OrbitDef(STAR_GM, 4600.0, 0.02, 0.0, 0.0, 0.0),
    currentPos: { x: 0, z: 0 },
    currentSpeed: 0,
  },
  ashfall: {
    key: 'ashfall',
    name: 'Ashfall',
    class: 'VOLCANIC CRATER MOON',
    radius: 170,
    gravity: 4.5,
    color: '#a3a7ad',
    glow: '#d2d5d8',
    special: "Aster convoy crash site. Captain Hale's crash recorder & Rook's hunter drones.",
    orbit: new OrbitDef(STAR_GM, 7300.0, 0.05, 2.4, 0.6, 0.04),
    currentPos: { x: 0, z: 0 },
    currentSpeed: 0,
  },
  verdance: {
    key: 'verdance',
    name: 'Verdance',
    class: 'SANDSTONE JUNGLE WORLD',
    radius: 440,
    gravity: 9.0,
    color: '#4dd280',
    glow: '#92eeb4',
    special: 'Pillars, waterfalls, floating stones. Renn Ayers hiding with her harmonica.',
    orbit: new OrbitDef(STAR_GM, 10800.0, 0.03, 4.2, 1.1, -0.03),
    currentPos: { x: 0, z: 0 },
    currentSpeed: 0,
  },
  wanderer: {
    key: 'wanderer',
    name: 'The Wanderer',
    class: 'ANCIENT COMET // CHOIR ENGINE',
    radius: 90,
    gravity: 1.5,
    color: '#b3e5fc',
    glow: '#e1f5fe',
    special: 'Grazes the Lantern at 20:30 (1230s). The Choir Engine vault door unseals only at periapsis.',
    orbit: new OrbitDef(STAR_GM, wandererA, wandererE, -wandererN * 1230.0, 2.2, 0.12, 0.4),
    currentPos: { x: 0, z: 0 },
    currentSpeed: 0,
  },
}

for (const k in BODIES) {
  if (BODIES[k].orbit) {
    BODIES[k].cachedPath = BODIES[k].orbit.points(160)
  }
}

const SIGNALS = {
  distress: {
    name: 'DISTRESS (ASTER CRASH)',
    desc: "\"Captain Elias Hale's transponder loop repeat: 'They knew our route. Kestrel, they knew exactly wh...'\"",
    bearing: '074°',
    db: '-18.4 dB',
    freqKhz: 121.5,
  },
  recordings: {
    name: 'FOUNDERS (HEARTH RECORDERS)',
    desc: "\"First expedition memory core: 'We broke through the Fold. The Lantern was burning purple back then.'\"",
    bearing: '142°',
    db: '-24.1 dB',
    freqKhz: 243.0,
  },
  hollow: {
    name: 'HOLLOW CHATTER (ROOK)',
    desc: "\"Rook's encrypted frequency: 'Mara thinks she found a pilot. Keep the drones close to Ashfall.'\"",
    bearing: '298°',
    db: '-12.8 dB',
    freqKhz: 406.1,
  },
  quantum: {
    name: 'QUANTUM HARMONICS (PHANTOM)',
    desc: "\"Superposition tone: The Phantom's probability wave singing across space when unseen.\"",
    bearing: '018°',
    db: '-31.0 dB',
    freqKhz: 550.0,
  },
  travellers: {
    name: 'TRAVELLERS CONCERT',
    desc: "\"Polyphonic acoustic broadcast: Mara's banjo, Okafor's flute, and Renn's harmonica in synchrony.\"",
    bearing: '180°',
    db: '-06.2 dB',
    freqKhz: 88.3,
  },
}

export default function TerminalView({ onExit }) {
  const canvasRef = useRef(null)
  const scopeRef = useRef(null)
  const [simTime, setSimTime] = useState(0.0)
  const [timeWarp, setTimeWarp] = useState(1.0)
  const [isPaused, setIsPaused] = useState(false)
  const [activeMode, setActiveMode] = useState('orrery') // 'orrery' | 'avionics' | 'signals'
  const [targetKey, setTargetKey] = useState('hearthstone')
  const [cameraFocus, setCameraFocus] = useState('lantern')
  const [zoomLevel, setZoomLevel] = useState(0.032)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isGlitching, setIsGlitching] = useState(false)
  const [flightAssist, setFlightAssist] = useState(true)
  const [throttle, setThrottle] = useState(45)
  const [activeFreq, setActiveFreq] = useState('distress')
  const [audioOn, setAudioOn] = useState(false)

  const audioStateRef = useRef({ ctx: null, masterGain: null, drone: null })
  const simRef = useRef({
    simTime: 0.0,
    timeWarp: 1.0,
    isPaused: false,
    targetKey: 'hearthstone',
    cameraFocus: 'lantern',
    zoomLevel: 0.032,
    panOffset: { x: 0, y: 0 },
    activeMode: 'orrery',
    activeFreq: 'distress',
    isCollapsing: false,
  })

  // Synchronize refs for 60 FPS animation loop
  useEffect(() => {
    simRef.current.timeWarp = timeWarp
    simRef.current.isPaused = isPaused
    simRef.current.targetKey = targetKey
    simRef.current.cameraFocus = cameraFocus
    simRef.current.zoomLevel = zoomLevel
    simRef.current.panOffset = panOffset
    simRef.current.activeMode = activeMode
    simRef.current.activeFreq = activeFreq
  }, [timeWarp, isPaused, targetKey, cameraFocus, zoomLevel, panOffset, activeMode, activeFreq])

  const initAudio = () => {
    if (audioStateRef.current.ctx) return
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext
      const ctx = new AudioClass()
      const master = ctx.createGain()
      master.gain.setValueAtTime(0.08, ctx.currentTime)
      master.connect(ctx.destination)

      const drone = ctx.createOscillator()
      drone.type = 'sawtooth'
      drone.frequency.setValueAtTime(55, ctx.currentTime)

      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(220, ctx.currentTime)

      drone.connect(filter)
      filter.connect(master)
      drone.start()

      audioStateRef.current = { ctx, masterGain: master, drone }
      setAudioOn(true)
    } catch {}
  }

  const triggerCollapse = () => {
    initAudio()
    setIsGlitching(true)
    simRef.current.isCollapsing = true
    if (audioStateRef.current.drone && audioStateRef.current.ctx) {
      audioStateRef.current.drone.frequency.exponentialRampToValueAtTime(880, audioStateRef.current.ctx.currentTime + 1.2)
    }
    setTimeout(() => {
      simRef.current.simTime = 0.0
      setSimTime(0.0)
      simRef.current.isCollapsing = false
      setIsGlitching(false)
      if (audioStateRef.current.drone && audioStateRef.current.ctx) {
        audioStateRef.current.drone.frequency.setValueAtTime(55, audioStateRef.current.ctx.currentTime)
      }
    }, 1600)
  }

  // Master Canvas Animation Loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    let animationFrameId
    let lastTime = performance.now()
    let lastUiSync = 0

    function updateBodyPositions(t) {
      for (const k in BODIES) {
        const b = BODIES[k]
        if (b.orbit) {
          let tEval = t
          if (k === 'phantom') {
            tEval += (b.quantumPhaseOffset || 0) * (b.orbit.period() / (2 * Math.PI))
          }
          b.currentPos = b.orbit.position(tEval)
          b.currentSpeed = b.orbit.velocity(tEval)
        } else {
          b.currentPos = { x: 0, z: 0 }
          b.currentSpeed = 0
        }
      }
    }

    function render(now) {
      const dt = (now - lastTime) / 1000
      lastTime = now

      const s = simRef.current
      if (!s.isPaused && !s.isCollapsing) {
        s.simTime += dt * s.timeWarp
        if (s.simTime >= LOOP_DURATION) {
          triggerCollapse()
        }
      }

      if (now - lastUiSync > 100) {
        lastUiSync = now
        setSimTime(s.simTime)
      }

      if (s.targetKey !== 'phantom' && Math.random() < 0.003) {
        BODIES.phantom.quantumPhaseOffset = (BODIES.phantom.quantumPhaseOffset + (Math.PI / 3) * (Math.random() > 0.5 ? 1 : -1)) % (2 * Math.PI)
      }

      updateBodyPositions(s.simTime)

      const w = canvas.width
      const h = canvas.height
      ctx.fillStyle = '#120b22'
      ctx.fillRect(0, 0, w, h)

      const worldToScreen = (pos) => {
        const cx = w / 2
        const cy = h / 2
        const focusPos = BODIES[s.cameraFocus]?.currentPos || { x: 0, z: 0 }
        const relX = pos.x - focusPos.x
        const relZ = pos.z - focusPos.z
        return {
          x: cx + relX * s.zoomLevel + s.panOffset.x,
          y: cy + relZ * s.zoomLevel + s.panOffset.y,
        }
      }

      // 1. Grid
      ctx.strokeStyle = 'rgba(43, 23, 64, 0.5)'
      ctx.lineWidth = 1
      const gridSize = 2000 * s.zoomLevel
      const startX = (w / 2 + s.panOffset.x) % gridSize
      const startY = (h / 2 + s.panOffset.y) % gridSize

      ctx.beginPath()
      for (let x = startX - gridSize; x < w + gridSize; x += gridSize) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
      }
      for (let y = startY - gridSize; y < h + gridSize; y += gridSize) {
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
      }
      ctx.stroke()

      // Range rings
      const lanternScreen = worldToScreen({ x: 0, z: 0 })
      ctx.strokeStyle = 'rgba(244, 232, 207, 0.08)'
      for (const rM of [2000, 5000, 10000, 15000]) {
        const rPix = rM * s.zoomLevel
        ctx.beginPath()
        ctx.arc(lanternScreen.x, lanternScreen.y, rPix, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(244, 232, 207, 0.3)'
        ctx.font = '9px "Space Mono", monospace'
        ctx.fillText(`${rM / 1000} km`, lanternScreen.x + rPix + 4, lanternScreen.y - 2)
      }

      // 2. Orbits
      for (const k in BODIES) {
        const b = BODIES[k]
        if (!b.cachedPath) continue

        ctx.beginPath()
        ctx.strokeStyle = k === s.targetKey ? b.color : 'rgba(244, 232, 207, 0.18)'
        ctx.lineWidth = k === s.targetKey ? 1.5 : 1.0
        if (k === 'wanderer') {
          ctx.setLineDash([6, 3])
          ctx.strokeStyle = 'rgba(179, 229, 252, 0.65)'
        } else {
          ctx.setLineDash([])
        }

        const pts = b.cachedPath
        for (let i = 0; i < pts.length; i++) {
          const sp = worldToScreen(pts[i])
          if (i === 0) ctx.moveTo(sp.x, sp.y)
          else ctx.lineTo(sp.x, sp.y)
        }
        ctx.stroke()
        ctx.setLineDash([])

        if (k === 'wanderer') {
          const spQ = worldToScreen(pts[0])
          ctx.fillStyle = '#ff6b2c'
          ctx.font = '10px "Space Mono", monospace'
          ctx.fillText('q [PERIAPSIS ZERO // 20:30]', spQ.x + 8, spQ.y + 3)
          ctx.beginPath()
          ctx.arc(spQ.x, spQ.y, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // 3. Spheres of Influence
      for (const k in BODIES) {
        const b = BODIES[k]
        if (k === 'lantern') continue
        const sp = worldToScreen(b.currentPos)
        const soiPix = b.radius * 3.5 * s.zoomLevel
        ctx.strokeStyle = k === s.targetKey ? 'rgba(47, 211, 255, 0.4)' : 'rgba(244, 232, 207, 0.08)'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, soiPix, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // 4. The Lantern Star
      const starScreen = worldToScreen({ x: 0, z: 0 })
      const starRadiusPix = Math.max(8, BODIES.lantern.radius * s.zoomLevel)
      const timeInstability = Math.max(0, (s.simTime - 900) / 420)
      const flarePulse = 1.0 + Math.sin(now * 0.008) * (0.05 + timeInstability * 0.25)

      const flareGrad = ctx.createRadialGradient(
        starScreen.x, starScreen.y, starRadiusPix * 0.4,
        starScreen.x, starScreen.y, starRadiusPix * (1.8 + timeInstability * 2.0) * flarePulse
      )
      flareGrad.addColorStop(0, 'rgba(255, 157, 102, 0.9)')
      flareGrad.addColorStop(0.4, 'rgba(255, 107, 44, 0.5)')
      flareGrad.addColorStop(1, 'rgba(18, 11, 34, 0)')

      ctx.fillStyle = flareGrad
      ctx.beginPath()
      ctx.arc(starScreen.x, starScreen.y, starRadiusPix * 2.5 * flarePulse, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#f4e8cf'
      ctx.beginPath()
      ctx.arc(starScreen.x, starScreen.y, starRadiusPix * 0.65, 0, Math.PI * 2)
      ctx.fill()

      // 5. Celestial Bodies
      for (const k in BODIES) {
        if (k === 'lantern') continue
        const b = BODIES[k]
        const sp = worldToScreen(b.currentPos)
        const rPix = Math.max(4, b.radius * s.zoomLevel)

        ctx.fillStyle = b.color
        ctx.beginPath()
        ctx.arc(sp.x, sp.y, rPix, 0, Math.PI * 2)
        ctx.fill()

        if (k === s.targetKey) {
          ctx.strokeStyle = '#2fd3ff'
          ctx.lineWidth = 1.5
          const chSize = rPix + 6
          ctx.strokeRect(sp.x - chSize, sp.y - chSize, chSize * 2, chSize * 2)

          const velAngle = Math.atan2(b.currentPos.z, b.currentPos.x) + Math.PI / 2
          ctx.beginPath()
          ctx.moveTo(sp.x, sp.y)
          ctx.lineTo(sp.x + Math.cos(velAngle) * 22, sp.y + Math.sin(velAngle) * 22)
          ctx.stroke()
        }

        ctx.fillStyle = '#f4e8cf'
        ctx.font = '11px "Space Mono", monospace'
        ctx.fillText(b.name, sp.x + rPix + 7, sp.y + 4)

        ctx.fillStyle = 'rgba(203, 184, 148, 0.7)'
        ctx.font = '9px "Space Mono", monospace'
        ctx.fillText(`${Math.round(b.currentSpeed)} m/s`, sp.x + rPix + 7, sp.y + 15)
      }

      animationFrameId = requestAnimationFrame(render)
    }

    const resize = () => {
      if (!canvas) return
      canvas.width = canvas.parentElement.clientWidth
      canvas.height = canvas.parentElement.clientHeight
    }
    resize()
    window.addEventListener('resize', resize)
    animationFrameId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  // Scope canvas animation when in signals mode
  useEffect(() => {
    if (activeMode !== 'signals') return
    const canvas = scopeRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let frameId

    function renderScope(now) {
      ctx.fillStyle = 'rgba(8, 4, 16, 0.35)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.strokeStyle = '#2fd3ff'
      ctx.lineWidth = 1.5

      const sw = canvas.width
      const sh = canvas.height
      const midY = sh / 2
      const time = now * 0.001

      for (let x = 0; x < sw; x++) {
        const tVal = x * 0.06 + time * 6
        let y = midY
        if (activeFreq === 'distress') {
          y += Math.sin(tVal) * Math.sin(tVal * 0.25) * 22
        } else if (activeFreq === 'travellers') {
          y += (Math.sin(tVal) + Math.sin(tVal * 1.5) + Math.sin(tVal * 2.0)) * 8
        } else if (activeFreq === 'quantum') {
          y += (Math.sin(tVal * 3) * Math.cos(tVal * 2.4) + (Math.random() - 0.5) * 6) * 11
        } else {
          y += Math.sin(tVal + Math.sin(tVal * 0.3) * 3) * 20
        }
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      frameId = requestAnimationFrame(renderScope)
    }

    frameId = requestAnimationFrame(renderScope)
    return () => cancelAnimationFrame(frameId)
  }, [activeMode, activeFreq])

  const fmtClock = (seconds) => {
    const remaining = Math.max(0, LOOP_DURATION - seconds)
    const m = Math.floor(remaining / 60)
    const s = Math.floor(remaining % 60)
    const ms = Math.floor((remaining % 1) * 10)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
  }

  const activeBody = BODIES[targetKey]
  const currentSig = SIGNALS[activeFreq]

  return (
    <div className={`fixed inset-0 z-50 flex flex-col bg-[#120b22] text-[#f4e8cf] select-none overflow-hidden font-sans ${isGlitching ? 'glitching' : ''}`}>
      {/* Top Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#2b1740] bg-[#0d071a] px-3 font-mono text-xs z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 border border-[#cbb894]/30 bg-[#2b1740]/60 px-2.5 py-1 text-[#f4e8cf] text-[11px] uppercase tracking-wider hover:border-[#ff6b2c] hover:text-[#ff6b2c] active:translate-y-0.5"
            title="Return to Game/Title"
          >
            ← Exit Terminal
          </button>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#ff6b2c] shadow-[0_0_8px_#ff6b2c]" />
            <span className="font-display text-sm tracking-wider text-[#f4e8cf]">PERIAPSIS ZERO</span>
            <span className="rounded border border-[#2fd3ff]/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[#2fd3ff]">
              REACH OBS-TERM // 3091
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[9px] uppercase tracking-widest text-[#cbb894]">Lantern Collapse In</span>
            <div className="flex items-baseline gap-1 text-base font-bold text-[#ff6b2c]">
              <span>{fmtClock(simTime)}</span>
              <span className="text-[10px] font-normal text-[#cbb894]">/ 22m loop</span>
            </div>
          </div>
          <button
            onClick={triggerCollapse}
            className="flex items-center gap-1 border border-[#ff6b2c]/60 bg-[#ff6b2c]/20 px-3 py-1 font-bold text-[#ff6b2c] text-xs uppercase tracking-wider hover:bg-[#ff6b2c] hover:text-black active:translate-y-0.5"
          >
            Collapse
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-[radial-gradient(circle_at_50%_50%,#170d2c_0%,#120b22_65%,#080410_100%)]">
        {/* CRT Scanlines Overlay */}
        <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(rgba(18,11,34,0)_50%,rgba(0,0,0,0.4)_50%)] bg-[length:100%_4px]" />
        <div className="pointer-events-none absolute inset-0 z-10 shadow-[inset_0_0_80px_rgba(0,0,0,0.85)]" />

        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-crosshair z-0" />

        {/* Top-Left Mode & Telemetry HUD */}
        <div className="pointer-events-none absolute top-3 left-3 z-20 flex flex-col gap-2 max-w-[280px]">
          <div className="pointer-events-auto flex border border-[#2b1740] bg-[#0d071a]/90 p-1 font-mono text-[10px]">
            <button
              onClick={() => setActiveMode('orrery')}
              className={`flex-1 py-1 text-center uppercase tracking-wider ${activeMode === 'orrery' ? 'bg-[#2fd3ff]/25 border border-[#2fd3ff] text-[#f4e8cf]' : 'text-[#cbb894] hover:text-[#2fd3ff]'}`}
            >
              Orrery [M]
            </button>
            <button
              onClick={() => setActiveMode('avionics')}
              className={`flex-1 py-1 text-center uppercase tracking-wider ${activeMode === 'avionics' ? 'bg-[#2fd3ff]/25 border border-[#2fd3ff] text-[#f4e8cf]' : 'text-[#cbb894] hover:text-[#2fd3ff]'}`}
            >
              Avionics [H]
            </button>
            <button
              onClick={() => setActiveMode('signals')}
              className={`flex-1 py-1 text-center uppercase tracking-wider ${activeMode === 'signals' ? 'bg-[#2fd3ff]/25 border border-[#2fd3ff] text-[#f4e8cf]' : 'text-[#cbb894] hover:text-[#2fd3ff]'}`}
            >
              Signals [X]
            </button>
          </div>

          <div className="pointer-events-auto border-l-2 border-[#2fd3ff] border-y border-r border-[#2b1740] bg-[#120b22]/95 p-3 font-mono text-xs backdrop-blur-md">
            <div className="mb-2 flex items-baseline justify-between border-b border-[#2b1740] pb-1">
              <span className="font-bold text-sm tracking-wide text-[#f4e8cf]">{activeBody?.name}</span>
              <span className="text-[9px] uppercase tracking-wider text-[#2fd3ff]">{activeBody?.class}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-[#cbb894]">
              <div>Radius: <span className="text-[#f4e8cf]">{activeBody?.radius} m</span></div>
              <div>Gravity: <span className="text-[#f4e8cf]">{activeBody?.gravity} m/s²</span></div>
              <div>Distance: <span className="text-[#2fd3ff]">{Math.round(Math.hypot(activeBody?.currentPos?.x || 0, activeBody?.currentPos?.z || 0)).toLocaleString()} m</span></div>
              <div>Speed: <span className="text-[#2fd3ff]">{Math.round(activeBody?.currentSpeed || 0)} m/s</span></div>
            </div>
            <p className="mt-2 border-t border-[#2b1740] pt-1.5 text-[10px] leading-relaxed text-[#ff6b2c]">
              {activeBody?.special}
            </p>
          </div>
        </div>

        {/* Top-Right Target & Time Controls */}
        <div className="pointer-events-none absolute top-3 right-3 z-20 flex flex-col items-end gap-2 font-mono text-xs">
          <div className="pointer-events-auto flex flex-col items-end border border-[#2b1740] bg-[#120b22]/95 p-2 backdrop-blur-md">
            <div className="mb-1.5 flex w-full justify-between gap-4 border-b border-[#2b1740] pb-1 text-[9px] text-[#cbb894] uppercase tracking-wider">
              <span>Time Warp</span>
              <span className="font-bold text-[#2fd3ff]">{isPaused ? 'PAUSED' : `${timeWarp}x`}</span>
            </div>
            <div className="flex gap-1 text-[10px]">
              {[1, 5, 20, 60].map((w) => (
                <button
                  key={w}
                  onClick={() => { setTimeWarp(w); setIsPaused(false) }}
                  className={`border px-2 py-0.5 ${timeWarp === w && !isPaused ? 'border-[#2fd3ff] bg-[#2fd3ff]/25 text-[#f4e8cf]' : 'border-[#cbb894]/25 text-[#cbb894] hover:text-[#2fd3ff]'}`}
                >
                  {w}x
                </button>
              ))}
              <button
                onClick={() => setIsPaused((p) => !p)}
                className={`border px-2 py-0.5 ${isPaused ? 'border-[#ff6b2c] bg-[#ff6b2c]/25 text-[#ff6b2c]' : 'border-[#cbb894]/25 text-[#cbb894]'}`}
              >
                {isPaused ? 'Play' : 'Pause'}
              </button>
            </div>
          </div>

          <div className="pointer-events-auto flex flex-col border border-[#2b1740] bg-[#120b22]/95 p-2 backdrop-blur-md max-w-[210px]">
            <div className="mb-1.5 flex justify-between text-[9px] uppercase tracking-wider text-[#cbb894] border-b border-[#2b1740] pb-1">
              <span>Focus Target</span>
              <span>[T]</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.keys(BODIES).map((k) => (
                <button
                  key={k}
                  onClick={() => { setTargetKey(k); setCameraFocus(k) }}
                  className={`border px-1.5 py-0.5 text-[9px] uppercase ${targetKey === k ? 'border-[#2fd3ff] bg-[#2fd3ff]/25 text-[#f4e8cf]' : 'border-[#cbb894]/25 text-[#cbb894] hover:text-[#2fd3ff]'}`}
                >
                  {BODIES[k].name.replace('The ', '')}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setPanOffset({ x: 0, y: 0 }); setZoomLevel(0.032) }}
              className="mt-2 border border-[#cbb894]/25 py-1 text-[10px] text-center uppercase text-[#cbb894] hover:border-[#2fd3ff] hover:text-[#2fd3ff]"
            >
              Center View [C]
            </button>
          </div>
        </div>

        {/* Avionics Overlay */}
        {activeMode === 'avionics' && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-6">
            <div className="flex justify-between items-start">
              <div className="pointer-events-auto border border-[#2b1740] bg-[#120b22]/95 p-3 font-mono text-xs w-56 backdrop-blur-md">
                <div className="mb-2 border-b border-[#2b1740] pb-1 font-bold text-[#2fd3ff] flex justify-between text-[11px]">
                  <span>PROPULSION & RCS</span>
                  <span className="text-[#f4e8cf]">KESTREL MK-IV</span>
                </div>
                <div className="space-y-1.5 text-[11px] text-[#cbb894]">
                  <div className="flex justify-between items-center">
                    <span>FLIGHT ASSIST:</span>
                    <button
                      onClick={() => setFlightAssist((a) => !a)}
                      className={`border px-1.5 py-0.5 text-[10px] ${flightAssist ? 'border-[#2fd3ff] text-[#2fd3ff]' : 'border-[#ff6b2c] text-[#ff6b2c]'}`}
                    >
                      {flightAssist ? 'FA ON' : 'FA DRIFT'}
                    </button>
                  </div>
                  <div className="flex justify-between">
                    <span>TORCH DRIVE:</span>
                    <span className="text-[#2fd3ff]">0.30 g BRACHISTO</span>
                  </div>
                  <div className="flex justify-between">
                    <span>STOPPING DIST:</span>
                    <span className="text-[#ff6b2c]">{Math.round((throttle * 1.8) ** 2 / (2 * 8.5 * 0.6))} m</span>
                  </div>
                </div>
              </div>

              {/* Vector Horizon Reticle */}
              <div className="relative h-44 w-44 rounded-full border border-[#2fd3ff]/40 bg-[#0d071a]/40 backdrop-blur-[2px] flex items-center justify-center">
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 200">
                  <line x1="30" y1="100" x2="80" y2="100" stroke="#2fd3ff" strokeWidth="2" />
                  <line x1="120" y1="100" x2="170" y2="100" stroke="#2fd3ff" strokeWidth="2" />
                  <circle cx="100" cy="100" r="3" fill="#2fd3ff" />
                  <polygon points="100,56 106,62 100,68 94,62" fill="none" stroke="#ff6b2c" strokeWidth="1.5" />
                </svg>
                <div className="absolute bottom-2 border border-[#2b1740] bg-[#120b22]/90 px-2 py-0.5 font-mono text-[9px] text-[#f4e8cf]">
                  PITCH +02° // BANK 00°
                </div>
              </div>

              {/* Gauges */}
              <div className="pointer-events-auto border border-[#2b1740] bg-[#120b22]/95 p-3 font-mono text-xs w-56 backdrop-blur-md">
                <div className="mb-2 border-b border-[#2b1740] pb-1 font-bold text-[#ff6b2c] flex justify-between text-[11px]">
                  <span>RESERVES</span>
                  <span className="text-[#cbb894]">TELEMETRY</span>
                </div>
                <div className="flex justify-around items-center py-1">
                  <div className="flex flex-col items-center">
                    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(47,211,255,0.2)" strokeWidth="3.5" />
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#2fd3ff" strokeWidth="3.5" strokeDasharray="100" strokeDashoffset="15" />
                    </svg>
                    <span className="text-[9px] font-bold text-[#2fd3ff] mt-1">SHIELD</span>
                    <span className="text-[11px] text-[#f4e8cf]">85%</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <svg className="w-14 h-14 -rotate-90" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,107,44,0.2)" strokeWidth="3.5" />
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#ff6b2c" strokeWidth="3.5" strokeDasharray="100" strokeDashoffset="35" />
                    </svg>
                    <span className="text-[9px] font-bold text-[#ff6b2c] mt-1">FUEL</span>
                    <span className="text-[11px] text-[#f4e8cf]">65%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Signals Overlay */}
        {activeMode === 'signals' && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-between p-6">
            <div className="pointer-events-auto flex flex-col gap-2 max-w-lg w-full border border-[#2b1740] border-t-2 border-t-[#2fd3ff] bg-[#120b22]/95 p-3 font-mono text-xs backdrop-blur-md">
              <div className="flex justify-between items-center border-b border-[#2b1740] pb-1.5">
                <span className="font-bold text-[#2fd3ff] tracking-wider uppercase">Signalscope Receiver</span>
                <span className="font-bold text-[#ff6b2c]">{currentSig?.name}</span>
              </div>
              <div className="flex gap-1">
                {Object.keys(SIGNALS).map((f) => (
                  <button
                    key={f}
                    onClick={() => setActiveFreq(f)}
                    className={`flex-1 py-1 text-[9px] border uppercase ${activeFreq === f ? 'border-[#ff6b2c] bg-[#ff6b2c]/20 text-[#ff6b2c]' : 'border-[#cbb894]/25 text-[#cbb894] hover:text-[#2fd3ff]'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 border border-[#2b1740] bg-[#080410] p-2">
                <canvas ref={scopeRef} width="280" height="75" className="border border-[#2fd3ff]/30" />
                <div className="flex flex-col text-[10px] text-[#cbb894] gap-1">
                  <div>SIGNAL: <span className="text-[#2fd3ff] font-bold">{currentSig?.db}</span></div>
                  <div>BEARING: <span className="text-[#f4e8cf]">{currentSig?.bearing} RAD</span></div>
                  <div>STATUS: <span className="text-[#ff6b2c] font-bold">HARMONIC LOCK</span></div>
                </div>
              </div>
              <p className="border-t border-[#2b1740] pt-1.5 text-[10px] text-[#f4e8cf] leading-relaxed">
                {currentSig?.desc}
              </p>
            </div>
          </div>
        )}

        {/* Bottom Loop Timeline Scrubber */}
        <div className="pointer-events-auto absolute bottom-3 inset-x-3 z-30 flex flex-col gap-1.5 border border-[#2b1740] border-l-2 border-l-[#ff6b2c] bg-[#120b22]/95 p-2.5 font-mono text-xs backdrop-blur-md">
          <div className="flex justify-between text-[10px] text-[#cbb894]">
            <span>● 00:00 WAKE (HEARTH)</span>
            <span className="hidden sm:inline text-[#2fd3ff]">12:00 HEARTHSTONE ORBIT</span>
            <span className="font-bold text-[#ff6b2c]">● 20:30 WANDERER PERIAPSIS ZERO</span>
            <span className="hidden sm:inline">21:00 FLARE CASCADE</span>
            <span className="text-[#ff6b2c]">● 22:00 COLLAPSE</span>
          </div>

          <input
            type="range"
            min="0"
            max="1320"
            step="0.1"
            value={simTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              simRef.current.simTime = val
              setSimTime(val)
            }}
            className="w-full accent-[#ff6b2c] cursor-pointer"
          />

          <div className="flex justify-between text-[10px] text-[#cbb894]">
            <div>
              <span>T = <span className="font-bold text-[#2fd3ff]">{simTime.toFixed(1)}</span> s</span>
              <span className="ml-3">PHASE: <span className="text-[#f4e8cf]">{simTime < 300 ? 'EARLY MORNING' : simTime < 1200 ? 'MID-LOOP' : 'COLLAPSE IMMINENT'}</span></span>
            </div>
            <div className="font-bold text-[#ff6b2c]">
              {Math.floor(Math.max(0, LOOP_DURATION - simTime) / 60)}m {Math.floor(Math.max(0, LOOP_DURATION - simTime) % 60)}s remaining
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
