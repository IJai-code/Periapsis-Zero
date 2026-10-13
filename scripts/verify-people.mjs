import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const art = process.argv[2] ?? new URL('../game/art/', import.meta.url).pathname
const required = ['idle', 'talk', 'walk', 'run', 'crouch', 'crouch_walk', 'jump', 'sit']

function decode(file) {
  const bytes = readFileSync(file)
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF')
  assert.equal(bytes.readUInt32LE(4), 2)
  const size = bytes.readUInt32LE(12)
  return { doc: JSON.parse(bytes.subarray(20, 20 + size)), bin: bytes.subarray(28 + size) }
}

function values({ doc, bin }, index) {
  const a = doc.accessors[index]
  const view = doc.bufferViews[a.bufferView]
  const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]
  assert.equal(a.componentType, 5126, 'animation keys must be floats')
  assert(width && !a.sparse, 'unsupported animation accessor')
  return Array.from({ length: a.count }, (_, i) => Array.from({ length: width }, (_, k) =>
    bin.readFloatLE((view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? width * 4) + k * 4)))
}

function continuous(first, last, rotation) {
  if (rotation) {
    const norm = Math.hypot(...first) * Math.hypot(...last)
    const dot = Math.abs(first.reduce((s, x, i) => s + x * last[i], 0)) / norm
    assert(2 * Math.acos(Math.min(1, dot)) < Math.PI / 180, 'loop rotation jumps more than one degree')
  } else {
    assert(Math.hypot(...first.map((x, i) => x - last[i])) < 0.001, 'loop position jumps more than one millimetre')
  }
}

// Positive controls: a broken clip must fail; equivalent quaternion signs pass.
assert.throws(() => continuous([0, 0, 0, 1], [1, 0, 0, 0], true))
assert.throws(() => continuous([0, 0, 0], [0, 0.01, 0], false))
continuous([0, 0, 0, 1], [0, 0, 0, -1], true)

let clips = 0
for (const file of readdirSync(art).filter(f => /^person-.*\.glb$/.test(f))) {
  const glb = decode(join(art, file))
  const mobile = /person-(pilot|crowd[123])(?:_hd)?\.glb/.test(file)
  for (const name of mobile ? required : required.slice(0, 2)) {
    const animation = glb.doc.animations.find(a => a.name === name)
    assert(animation, `${file} lacks ${name}`)
    for (const channel of animation.channels) {
      if (!['rotation', 'translation'].includes(channel.target.path)) continue
      const sampler = animation.samplers[channel.sampler]
      const interpolation = sampler.interpolation ?? 'LINEAR'
      assert(['LINEAR', 'STEP'].includes(interpolation), 'unsupported clip interpolation')
      const time = values(glb, sampler.input)
      assert(time.length >= 2 && time.at(-1)[0] > 0, `${file}/${name} has no duration`)
      const keys = values(glb, sampler.output)
      // Blender emits STEP for constant bones, retaining tiny float noise.
      // Apply the same physical discontinuity limits to every such sample.
      if (interpolation === 'STEP') for (const key of keys) continuous(keys[0], key, channel.target.path === 'rotation')
      try { continuous(keys[0], keys.at(-1), channel.target.path === 'rotation') }
      catch (error) { throw new Error(`${file}/${name}/${glb.doc.nodes[channel.target.node].name}: ${error.message}`) }
    }
    clips++
  }
  assert(glb.doc.meshes.length > 0, `${file} lost its meshes`)
  console.log(`✓ ${file}: required clips have seamless endpoints`)
}
assert(clips >= 38, 'human asset catalogue is incomplete')
console.log(`Verified ${clips} human animation loops, including rejection controls.`)
