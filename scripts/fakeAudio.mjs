/**
 * A Web Audio API shaped enough like the real one to build this project's
 * graphs in Node, and to say afterwards whether they are wired.
 *
 * The audio gate measured the arithmetic that drives the graph and never built
 * the graph itself, because building one needs a browser. So when `build()`
 * started returning a node it no longer declared, nothing here could see it:
 * the ReferenceError was thrown inside `unlockAudio`'s try, the catch put the
 * context back to null, and the product was silent — engine, pad, one-shots and
 * the score, which builds on the same context — while every gate stayed green.
 *
 * This is not an audio engine. It renders nothing. It records what was created
 * and what was connected to what, which is the part that can be wrong in code
 * and cannot be wrong in a browser that works: a node that is never declared,
 * a voice that is built and never reaches the speakers, a parameter written
 * that does not exist. Anything the real API would throw on, this throws on.
 */

class FakeParam {
  constructor(value = 0) {
    this.value = value
    this.events = 0
  }
  setTargetAtTime(v) {
    if (!Number.isFinite(v)) throw new TypeError(`setTargetAtTime: non-finite target ${v}`)
    this.value = v
    this.events++
    return this
  }
  setValueAtTime(v) {
    if (!Number.isFinite(v)) throw new TypeError(`setValueAtTime: non-finite value ${v}`)
    this.value = v
    this.events++
    return this
  }
  linearRampToValueAtTime(v) {
    if (!Number.isFinite(v)) throw new TypeError(`linearRampToValueAtTime: non-finite value ${v}`)
    this.value = v
    this.events++
    return this
  }
  exponentialRampToValueAtTime(v) {
    // The real API throws on a zero or sign-changing exponential target.
    if (!(v > 0) && !(v < 0)) throw new RangeError(`exponentialRampToValueAtTime: target ${v}`)
    this.value = v
    this.events++
    return this
  }
  cancelScheduledValues() {
    return this
  }
}

class FakeNode {
  constructor(ctx, kind) {
    this.context = ctx
    this.kind = kind
    this.outputs = []
    ctx.nodes.push(this)
  }
  connect(dest) {
    if (!dest) throw new TypeError(`${this.kind}.connect: no destination`)
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) {
      throw new TypeError(`${this.kind}.connect: not a node or a parameter`)
    }
    this.outputs.push(dest)
    return dest
  }
  disconnect() {
    this.outputs.length = 0
  }
}

class FakeSource extends FakeNode {
  constructor(ctx, kind) {
    super(ctx, kind)
    this.started = false
    this.stopped = false
    this.onended = null
  }
  start() {
    if (this.started) throw new Error(`${this.kind}.start called twice`)
    this.started = true
  }
  stop() {
    this.stopped = true
  }
}

class FakeBuffer {
  constructor(channels, length, sampleRate) {
    if (!(length > 0)) throw new RangeError(`createBuffer: length ${length}`)
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.duration = length / sampleRate
    this.data = Array.from({ length: channels }, () => new Float32Array(length))
  }
  getChannelData(c) {
    if (c >= this.numberOfChannels) throw new RangeError(`getChannelData(${c})`)
    return this.data[c]
  }
}

export class FakeAudioContext {
  constructor() {
    this.sampleRate = 48000
    this.currentTime = 0
    this.state = 'running'
    this.nodes = []
    this.destination = new FakeNode(this, 'destination')
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
  createGain() {
    const n = new FakeNode(this, 'gain')
    n.gain = new FakeParam(1)
    return n
  }
  createBiquadFilter() {
    const n = new FakeNode(this, 'biquad')
    n.type = 'lowpass'
    n.frequency = new FakeParam(350)
    n.Q = new FakeParam(1)
    n.gain = new FakeParam(0)
    n.detune = new FakeParam(0)
    return n
  }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor')
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(0)
    return n
  }
  createConvolver() {
    const n = new FakeNode(this, 'convolver')
    n.buffer = null
    n.normalize = true
    return n
  }
  createDelay(max = 1) {
    const n = new FakeNode(this, 'delay')
    n.maxDelayTime = max
    n.delayTime = new FakeParam(0)
    return n
  }
  createStereoPanner() {
    const n = new FakeNode(this, 'panner')
    n.pan = new FakeParam(0)
    return n
  }
  createWaveShaper() {
    const n = new FakeNode(this, 'waveshaper')
    n.curve = null
    n.oversample = 'none'
    return n
  }
  createAnalyser() {
    const n = new FakeNode(this, 'analyser')
    n.fftSize = 2048
    n.getFloatTimeDomainData = (a) => a.fill(0)
    return n
  }
  createOscillator() {
    const n = new FakeSource(this, 'oscillator')
    n.type = 'sine'
    n.frequency = new FakeParam(440)
    n.detune = new FakeParam(0)
    return n
  }
  createBufferSource() {
    const n = new FakeSource(this, 'buffer-source')
    n.buffer = null
    n.loop = false
    n.playbackRate = new FakeParam(1)
    return n
  }
  createBuffer(channels, length, sampleRate) {
    return new FakeBuffer(channels, length, sampleRate)
  }
}

/** Whether `node` has a path to the context's destination, through nodes only. */
export function reachesDestination(node) {
  const dest = node.context.destination
  const seen = new Set()
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (n === dest) return true
    if (seen.has(n)) continue
    seen.add(n)
    for (const o of n.outputs ?? []) if (o instanceof FakeNode) stack.push(o)
  }
  return false
}

/** Every source that was started, and whether each is heard. */
export function sources(ctx) {
  return ctx.nodes.filter((n) => n instanceof FakeSource)
}

/**
 * Install the fake as the page's audio API, for code that reads it off
 * `window` the way the engine does. Returns the handle the code will build on.
 */
export function installFakeAudio() {
  // A bare object rather than globalThis itself: other modules test for a
  // browser with `typeof window`, and should keep finding only what this adds.
  if (typeof globalThis.window === 'undefined') globalThis.window = {}
  globalThis.window.AudioContext = FakeAudioContext
  return FakeAudioContext
}
