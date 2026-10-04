/**
 * The art gate: an authored asset is held to the numbers it was drawn for.
 *
 * Every asset under `art/` is built by a script that drives Blender (AGENT.md,
 * section 4), and every one carries a `spec.json` of the dimensions the
 * simulation and the cameras depend on, in the runtime's own coordinates. This
 * reads the *shipped* file, `public/authored/<id>.glb`, and checks it against
 * that spec — so a model cannot quietly drift from the physics it stands in
 * for. A lander drawn 10% tall is a physics bug on screen.
 *
 * What it reads is the glTF itself: the container, the node tree with its
 * transforms, each primitive's POSITION bounds and index count, the materials,
 * and the named empties. It does not decode the Draco geometry; the accessor
 * bounds glTF requires on POSITION are what bounds checks need, and decoding
 * is the browser's job, checked in a real page. It needs no Blender either, so
 * it runs in CI: rebuilding from the script and comparing bytes is
 * `npm run art:build -- <id> --check`, on a machine that has Blender.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROVER, VEHICLE } from '../src/sim/expedition.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let checks = 0
const check = (label, fn) => { fn(); checks++; console.log(`  ✓ ${label}`) }

/** The two chunks of a GLB, and the container's own consistency. */
function readGlb(path) {
  const b = readFileSync(path)
  assert.equal(b.toString('ascii', 0, 4), 'glTF', `${path}: not a GLB`)
  assert.equal(b.readUInt32LE(4), 2, `${path}: not glTF 2`)
  assert.equal(b.readUInt32LE(8), b.length, `${path}: header length disagrees with the file`)
  const jsonLength = b.readUInt32LE(12)
  assert.equal(b.toString('ascii', 16, 20), 'JSON')
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLength))
  const binAt = 20 + jsonLength
  if (binAt < b.length) assert.equal(b.toString('ascii', binAt + 4, binAt + 8), 'BIN\0')
  return { bytes: b.length, json }
}

/* ---- the smallest matrix kit the node tree needs: column-major 4x4 ---- */
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function multiply(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
function local(node) {
  if (node.matrix) return node.matrix.slice()
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]
}
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]

/** World bounds, triangles and named points, walked from the default scene. */
function survey(json) {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  const points = {}
  const nodes = {}
  let triangles = 0
  const visit = (index, parent) => {
    const node = json.nodes[index]
    const world = multiply(parent, local(node))
    if (node.name) nodes[node.name] = apply(world, [0, 0, 0])
    if (node.mesh !== undefined) {
      for (const prim of json.meshes[node.mesh].primitives) {
        assert.ok((prim.mode ?? 4) === 4, 'only triangle lists are drawn')
        const acc = json.accessors[prim.attributes.POSITION]
        assert.ok(acc.min && acc.max, 'glTF requires POSITION bounds')
        for (const cx of [acc.min[0], acc.max[0]]) for (const cy of [acc.min[1], acc.max[1]]) for (const cz of [acc.min[2], acc.max[2]]) {
          const p = apply(world, [cx, cy, cz])
          for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]) }
        }
        triangles += prim.indices !== undefined ? json.accessors[prim.indices].count / 3 : acc.count / 3
      }
    } else if (node.name) {
      points[node.name] = apply(world, [0, 0, 0])
    }
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, identity())
  return { lo, hi, points, nodes, triangles }
}

const assets = readdirSync(join(ROOT, 'art')).filter((d) => existsSync(join(ROOT, 'art', d, 'spec.json')))
assert.ok(assets.length > 0, 'no authored assets found under art/')

for (const id of assets) {
  const spec = JSON.parse(readFileSync(join(ROOT, 'art', id, 'spec.json'), 'utf8'))
  const file = join(ROOT, 'public', 'authored', `${id}.glb`)
  assert.ok(existsSync(file), `${id}: public/authored/${id}.glb has not been built (npm run art:build -- ${id})`)
  assert.ok(existsSync(join(ROOT, 'art', id, 'build.py')), `${id}: no build script; the script is the source`)
  const { bytes, json } = readGlb(file)
  const { lo, hi, points, nodes, triangles } = survey(json)

  check(`${id}: a valid GLB inside its budget (${triangles.toLocaleString()} triangles, ${(bytes / 1024).toFixed(0)} kB)`, () => {
    assert.ok(triangles <= spec.budget.triangles, `${triangles} triangles against a budget of ${spec.budget.triangles}`)
    assert.ok(bytes <= spec.budget.bytes, `${bytes} bytes against a budget of ${spec.budget.bytes}`)
    // Draco because the runtime already ships the decoder; nothing else
    // required, so nothing else needs a loader the page does not have.
    for (const ext of json.extensionsRequired ?? []) assert.equal(ext, 'KHR_draco_mesh_compression', `requires ${ext}`)
  })

  check(`${id}: bounds ${spec.boundsMode === 'within' ? 'inside the spec envelope' : 'match the spec within 1% of each extent'}`, () => {
    for (let i = 0; i < 3; i++) {
      if (spec.boundsMode === 'within') {
        assert.ok(lo[i] >= spec.bounds.min[i] - 1e-3 && hi[i] <= spec.bounds.max[i] + 1e-3,
          `axis ${'xyz'[i]} spans ${lo[i].toFixed(3)}..${hi[i].toFixed(3)}, outside ${spec.bounds.min[i]}..${spec.bounds.max[i]}`)
        continue
      }
      const extent = spec.bounds.max[i] - spec.bounds.min[i]
      const tol = extent * 0.01
      assert.ok(Math.abs(lo[i] - spec.bounds.min[i]) <= tol, `axis ${'xyz'[i]} min ${lo[i].toFixed(3)} vs spec ${spec.bounds.min[i]}`)
      assert.ok(Math.abs(hi[i] - spec.bounds.max[i]) <= tol, `axis ${'xyz'[i]} max ${hi[i].toFixed(3)} vs spec ${spec.bounds.max[i]}`)
    }
  })

  check(`${id}: every named point and part the runtime reads is present`, () => {
    for (const name of spec.requiredEmpties ?? []) assert.ok(points[name], `missing empty ${name}`)
    for (const name of spec.requiredNodes ?? []) assert.ok(nodes[name], `missing node ${name}`)
  })

  check(`${id}: only open shells are double-sided`, () => {
    const two = (json.materials ?? []).filter((m) => m.doubleSided).map((m) => m.name).sort()
    assert.deepEqual(two, [...(spec.doubleSided ?? [])].sort(),
      'a closed panel exported double-sided draws its hidden inside for nothing (Blender 5 defaults materials that way)')
  })

  if (id === 'survey-lander') {
    check('survey-lander: it stands where the physics says it stands', () => {
      // The spec and the simulation agree on how high the origin rides…
      assert.equal(spec.originAboveGround, VEHICLE.clearance)
      // …the lowest point of the model is the footpad soles…
      assert.ok(Math.abs(lo[1] - spec.footpadSoleY) <= 0.02, `lowest point ${lo[1].toFixed(3)}, soles at ${spec.footpadSoleY}`)
      // …and the soles are on the ground at rest: no more than 10 cm into it,
      // never above it.
      assert.ok(spec.footpadSoleY <= -VEHICLE.clearance + 0.1 && spec.footpadSoleY >= -VEHICLE.clearance - 0.0001 - 0.1)
      const pads = [0, 1, 2, 3].map((k) => points[`footpad_${k}`])
      for (const p of pads) assert.ok(Math.abs(p[1] - spec.footpadSoleY) <= 0.02, `footpad at y ${p[1]}`)
      for (const [x, z] of spec.footpads) {
        assert.ok(pads.some((p) => Math.hypot(p[0] - x, p[2] - z) <= 0.02), `no footpad at (${x}, ${z})`)
      }
    })
    check('survey-lander: the engine exits where the plume is drawn from', () => {
      const n = points.nozzle_0
      assert.ok(Math.abs(n[1] - spec.nozzleExitY) <= 0.01 && Math.hypot(n[0], n[2]) <= 0.01, `nozzle_0 at ${n.map((v) => v.toFixed(3))}`)
    })
    check('survey-lander: the hatch and ladder are on the side the EVA starts from', () => {
      // The camera behind a landed vehicle sits on +Z; the crew climbs down there.
      assert.ok(points.hatch[2] > 1.5 && points.ladder_base[2] > 1.5)
      assert.ok(Math.abs(points.ladder_base[1] - spec.footpadSoleY) <= 0.05, 'the ladder reaches the ground plane')
    })
  }

  if (id === 'survey-rover') {
    check('survey-rover: six wheels where ROVER puts them, on the ground', () => {
      // The spec restates nothing the simulation already says.
      assert.equal(spec.track, ROVER.track)
      assert.equal(spec.wheelbase, ROVER.wheelbase)
      assert.equal(spec.clearance, ROVER.clearance)
      const hubs = [0, 1, 2, 3, 4, 5].map((k) => nodes[`wheel_${k}`])
      for (const sx of [-1, 1]) for (const z of [-ROVER.wheelbase / 2, 0, ROVER.wheelbase / 2]) {
        const want = [sx * ROVER.track / 2, spec.wheelRadius, z]
        assert.ok(hubs.some((h) => Math.hypot(h[0] - want[0], h[1] - want[1], h[2] - want[2]) <= 0.01),
          `no wheel hub at (${want.map((v) => v.toFixed(2))})`)
      }
      // The lowest point of the model is a wheel touching the ground.
      assert.ok(Math.abs(lo[1]) <= 0.01, `lowest point ${lo[1].toFixed(3)} m, not the ground plane`)
      // The mast camera is at the front, which is -Z in the runtime.
      assert.ok(points.mast_camera[2] < -0.5)
    })
  }

  if (id === 'survey-kit') {
    check('survey-kit: every prop stands on its own origin, on the ground', () => {
      for (const name of spec.requiredNodes) assert.ok(Math.abs(nodes[name][1]) <= 1e-6, `${name} origin is ${nodes[name][1]} m off the ground`)
      const statusMaterials = (json.materials ?? []).filter((m) => m.name === 'status')
      assert.equal(statusMaterials.length, 1, 'one material named status, for the game to recolour')
    })
  }
}

check('the runtime loads authored art lazily, with the primitive model as its fallback', () => {
  const scene = readFileSync(join(ROOT, 'src/components/ExpeditionScene.jsx'), 'utf8')
  assert.ok(/useAuthored\('survey-lander'/.test(scene), 'ExpeditionScene does not load the authored lander')
  assert.ok(/<SurveyLander\s*\/>/.test(scene), 'the primitive lander is gone; it is the fallback while loading and on failure')
  assert.ok(scene.includes('nozzle_0'), 'the plume is not placed from the nozzle empty')
  // First paint must not pay for it: nothing on the eager path imports the loader.
  for (const eager of ['src/main.jsx', 'src/ExperienceApp.jsx', 'src/ui/Landing.jsx', 'src/ui/StoryCampaign.jsx']) {
    assert.ok(!readFileSync(join(ROOT, eager), 'utf8').includes('gfx/authored'), `${eager} imports the authored-art loader`)
  }
})

console.log(`\nverify-art: ${checks} checks passed`)
