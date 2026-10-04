"""
The surface rock set: six broken stones, high detail baked onto low meshes.

    npm run art:build -- rocks

The expeditions scatter about thirteen hundred rocks around the landing site
as instanced meshes, so each rock has to be cheap: 320 triangles. What makes
a stone read as stone is smaller than that, the fracture faces, the pitting
and the dust settled in it, so each rock is built twice from one shape
function: once at 82,000 faces with all of that in the geometry, and once at
320. Cycles bakes the first onto the second as a normal map, a colour map
and ambient occlusion, all six into one 1024 px atlas.

The colour is neutral and normalised to a mean of 0.5 linear; each world tints
its rocks per instance (ROCK_TINT in src/gfx/expeditionTerrain.js) and the
runtime doubles the material colour to undo the normalisation.

Nodes rock_0 .. rock_5, each at the origin, about a metre across, with a flat
underside at z = -0.28 (three.js y = -0.28) so they sit on the ground.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

import pz  # noqa: E402
import surfacing as sf  # noqa: E402

COUNT = 6
FLOOR = -0.28


def shape(p, seed):
    """Radius factor for a direction: lumps, fracture planes, pits. Same for every resolution."""
    off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))
    k = 0.8 + 0.26 * noise.noise(p * 1.3 + off) + 0.1 * noise.noise(p * 3.1 + off)
    # Fracture planes: four per stone, each flattening the cap it cuts off.
    for a in range(4):
        n = Vector((math.sin(seed * 2.3 + a * 1.9), math.cos(seed * 1.1 + a * 2.7), math.sin(seed * 0.7 + a * 1.3) * 0.8))
        n.normalize()
        d = 0.5 + 0.08 * math.sin(seed + a)
        if p.dot(n) * k > d:
            k = d / max(p.dot(n), 1e-3)
    return k


def detail(p, seed):
    """What only the high mesh carries: chips, pitting and a fine grain."""
    off = Vector((seed * 5.1, seed * 3.3, seed * 1.9))
    pits = noise.voronoi(p * 9.0 + off)[0][0]
    chips = noise.ridged_multi_fractal(p * 4.0 + off, 0.9, 2.0, 4, 1.0, 2.0)
    return 0.012 * (chips - 1.0) - 0.01 * max(0.0, 0.12 - pits) / 0.12 + 0.004 * noise.noise(p * 40.0 + off)


def build(name, seed, subdivisions, fine):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    for v in bm.verts:
        p = v.co.normalized()
        r = shape(p, seed)
        if fine:
            r += detail(p, seed)
        q = p * r
        q.z = max(q.z, FLOOR)
        v.co = q
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def stone_material():
    m = bpy.data.materials.new('stone')
    g = sf.Graph(m)
    v = g.coords()
    grains = g.noise(v, 30.0, detail=6.0, rough=0.6)
    veins = g.remap(g.voronoi(v, 3.0, 'DISTANCE_TO_EDGE', 'Distance'), 0.0, 0.03, 1.0, 0.0)
    base = g.mixc((0.30, 0.29, 0.28, 1.0), (0.55, 0.54, 0.52, 1.0), g.remap(grains, 0.3, 0.7))
    base = g.mixc(base, (0.62, 0.6, 0.57, 1.0), g.mul(veins, 0.4))
    # Fines settled on whatever faces up.
    up = g.xyz(g.node('ShaderNodeNewGeometry').outputs['Normal'])[2]
    base = g.mixc(base, (0.5, 0.48, 0.45, 1.0), g.mul(g.remap(up, 0.55, 1.0), 0.5))
    sf._finish(g, base, 0.0, 0.88, None, None, None)
    return m


def main():
    a = pz.cli()
    pz.reset_scene()
    size = 512 if a['fast'] else 1024
    lows, highs = [], []
    mat = stone_material()
    for k in range(COUNT):
        seed = 17 + k * 29
        low = build(f'rock_{k}', seed, 3, False)
        high = build(f'rock_{k}_high', seed, 7 if not a['fast'] else 6, True)
        low.data.materials.append(mat)
        high.data.materials.append(mat)
        # Side by side while baking, so no stone's rays find its neighbour.
        low.location = high.location = (k * 3.0, 0.0, 0.0)
        lows.append(low)
        highs.append(high)
    print(f'PZ-TRIANGLES {sum(pz.triangle_count(o) for o in lows)}')

    sf.unwrap(lows, margin=0.01)
    sf._cycles(4 if a['fast'] else 16)
    scene = bpy.context.scene
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.08
    scene.render.bake.max_ray_distance = 0.25
    scene.world.light_settings.distance = 0.2

    # The low meshes bake into images; the high ones are only sources.
    target = bpy.data.materials.new('stone_target')
    target.use_nodes = True
    for low in lows:
        low.data.materials.clear()
        low.data.materials.append(target)
    colour = sf._image('rocks_colour', size, data=False)
    normal = sf._image('rocks_normal', size, data=True)
    ao = sf._image('rocks_ao', size, data=True)

    def bake(kind, img, **kw):
        nodes = target.node_tree.nodes
        node = nodes.get('pz_bake') or nodes.new('ShaderNodeTexImage')
        node.name = 'pz_bake'
        node.image = img
        nodes.active = node
        for i, (low, high) in enumerate(zip(lows, highs)):
            for o in scene.objects:
                o.select_set(False)
            high.select_set(True)
            low.select_set(True)
            bpy.context.view_layer.objects.active = low
            bpy.ops.object.bake(type=kind, use_clear=(i == 0), margin=6, **kw)

    undo = sf._to_emission([mat], 'Base Color')
    bake('EMIT', colour)
    sf._restore(undo)
    bake('NORMAL', normal, normal_space='TANGENT')
    scene.cycles.samples = 24 if a['fast'] else 96
    bake('AO', ao)

    # Colour normalised to a 0.5 linear mean (the runtime doubles it), and the
    # occlusion packed with a constant roughness the glTF way.
    c = sf._pixels(colour)[:, :3]
    covered = c.sum(axis=1) > 0.0
    c = np.clip(c / c[covered].mean(axis=0) * 0.5, 0.0, 1.0)
    px = np.ones((size * size, 4), dtype=np.float32)
    px[:, :3] = c
    base = sf._image('rocks_base', size, data=False)
    base.pixels.foreach_set(px.ravel())
    orm = sf._image('rocks_orm', size, data=True)
    px = np.ones((size * size, 4), dtype=np.float32)
    px[:, 0] = sf._pixels(ao)[:, 0]
    px[:, 1] = 0.9
    px[:, 2] = 0.0
    orm.pixels.foreach_set(px.ravel())
    for img in (base, orm, normal):
        img.update()
        img.pack()

    final = sf._gltf_material('rock', base, orm, normal, double_sided=False)
    for low in lows:
        low.data.materials.clear()
        low.data.materials.append(final)
        low.location = (0.0, 0.0, 0.0)
    for high in highs:
        bpy.data.objects.remove(high)
    for img in (colour, ao):
        bpy.data.images.remove(img)

    if a['preview']:
        for k, low in enumerate(lows):
            low.location = ((k % 3) * 2.4 - 2.4, (k // 3) * 2.4, 0.0)
        sf.preview(a['preview'], lows, ground='#77726a', elevation=22)
        for low in lows:
            low.location = (0.0, 0.0, 0.0)
    if a['blend']:
        pz.save_blend(a['blend'])
    if a['out']:
        pz.export_glb(a['out'])
        print(f'PZ-WROTE {a["out"]}')


main()
