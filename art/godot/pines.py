"""Pines from Poly Haven's scanned fir sapling (CC0).

    python3 <scratchpad>/phdl.py art/sources/polyhaven fir_sapling pine_sapling_small
    (and fir_sapling_twigs_alpha_1k.png into fir_sapling/textures: the 1K
    glTF leaves the twigs' cut-out out)
    blender -b --factory-startup --python art/godot/pines.py -- art/sources/polyhaven game/art/ph

The sapling is a hundred and fifty thousand triangles of real needles. It is
rendered twice into one sheet (game/art/ph/pine-cards.png): from above, a
star of boughs; from the side, a small fir. A tall pine is then a bark
trunk (the scanned pine's bark), a whorl of the top view every metre or so,
drooping from the trunk like real boughs, and a few side views crossed
through the crown for its silhouette: a few hundred triangles that read as
a fir from the path and from the air. Writes ph-pine_a/b/c.gltf (+ .bin), about 16,
19 and 13 m tall.
"""
import math
import os
import random
import shutil
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector as V

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)
SHEET = os.path.join(OUT, 'pine-cards.png')
BARK = os.path.join(OUT, 'pine-bark.jpg')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# --- The sheet ---------------------------------------------------------------

def render_sheet():
    reset()
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 48
    s.cycles.use_denoising = True
    s.render.film_transparent = True
    s.view_settings.view_transform = 'Standard'
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.render.resolution_x = 1024
    s.render.resolution_y = 512
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.9, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    s.world = w
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 2.4
    o = bpy.data.objects.new('sun', sun)
    s.collection.objects.link(o)
    o.rotation_euler = Euler((math.radians(-35), math.radians(20), 0))
    folder = os.path.join(SRC, 'fir_sapling')
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, next(f for f in os.listdir(folder) if f.endswith('.gltf'))))
    alpha = os.path.join(folder, 'textures', 'fir_sapling_twigs_alpha_1k.png')
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        for l in list(bsdf.inputs['Roughness'].links):
            nt.links.remove(l)
        bsdf.inputs['Roughness'].default_value = 0.85
        bsdf.inputs['Specular IOR Level'].default_value = 0.2
        if 'twig' in m.name and os.path.exists(alpha):
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(alpha)
            tex.image.colorspace_settings.name = 'Non-Color'
            src = bsdf.inputs['Base Color'].links[0].from_node.inputs['Vector']
            if src.links:
                nt.links.new(src.links[0].from_socket, tex.inputs['Vector'])
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Alpha'])
    keep = bpy.data.objects['fir_sapling_a']
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH' and ob != keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    keep.parent = None
    bpy.context.view_layer.update()
    pts = [keep.matrix_world @ v.co for v in keep.data.vertices]
    lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    # Its trunk is the middle of its box from above.
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    top = keep.copy()
    s.collection.objects.link(top)
    # Left tile (x 0..1): from above, the trunk in the middle, the widest
    # side filling the tile. Right tile (x 1..2): from the side, foot on the
    # bottom, the height filling it.
    span = max(hi.x - lo.x, hi.y - lo.y)
    top.matrix_world = Matrix.Translation(V((0.5, 0.5, 0.0))) @ Matrix.Scale(0.98 / span, 4) @ Matrix.Translation(V((-cx, -cy, -hi.z))) @ keep.matrix_world
    h = hi.z - lo.z
    keep.matrix_world = Matrix.Translation(V((1.5, 5.0, 0.0))) @ Matrix.Scale(0.98 / h, 4) @ Matrix.Translation(V((-cx, -cy, -lo.z))) @ keep.matrix_world
    # Two cameras would need two renders: one camera looking down a tilted
    # mirror is a trick too far. Render twice, paste side by side.
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = 1.0
    c = bpy.data.objects.new('cam', cam)
    s.collection.objects.link(c)
    s.camera = c
    s.render.resolution_x = 512
    s.render.resolution_y = 512
    keep.hide_render = True
    c.location = (0.5, 0.5, 10.0)
    c.rotation_euler = (0, 0, 0)
    s.render.filepath = SHEET + '.top.png'
    bpy.ops.render.render(write_still=True)
    keep.hide_render = False
    top.hide_render = True
    c.location = (1.5, -10.0, 0.5)
    c.rotation_euler = (math.radians(90), 0, 0)
    s.render.filepath = SHEET + '.side.png'
    bpy.ops.render.render(write_still=True)
    a = bpy.data.images.load(SHEET + '.top.png')
    b = bpy.data.images.load(SHEET + '.side.png')
    out = bpy.data.images.new('sheet', 1024, 512, alpha=True)
    pa, pb = list(a.pixels), list(b.pixels)
    px = [0.0] * (1024 * 512 * 4)
    for y in range(512):
        px[y * 4096: y * 4096 + 2048] = pa[y * 2048:(y + 1) * 2048]
        px[y * 4096 + 2048:(y + 1) * 4096] = pb[y * 2048:(y + 1) * 2048]
    out.pixels = px
    out.filepath_raw = SHEET
    out.file_format = 'PNG'
    out.save()
    os.remove(SHEET + '.top.png')
    os.remove(SHEET + '.side.png')
    shutil.copy(os.path.join(SRC, 'pine_sapling_small', 'textures', 'pine_sapling_small_bark_diff_1k.jpg'), BARK)


# --- The trees ---------------------------------------------------------------

def materials():
    bough = bpy.data.materials.new('pine_bough')
    bough.use_nodes = True
    nt = bough.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(SHEET)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.9
    bough.blend_method = 'CLIP' if hasattr(bough, 'blend_method') else None
    bough.use_backface_culling = False
    bark = bpy.data.materials.new('pine_bark')
    bark.use_nodes = True
    nt = bark.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(BARK)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.95
    return bough, bark


def tree(name, height, seed, girth=1.0):
    reset()
    bough, bark = materials()
    rng = random.Random(seed)
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(bark)
    me.materials.append(bough)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    # The trunk: eight sides, tapering to a point at the top, the bark
    # wrapped twice round and repeated every 2 m up.
    sides, rings = 8, 6
    r0 = 0.32 * girth * height / 16.0
    verts = []
    for j in range(rings + 1):
        t = j / rings
        z = t * height * 0.96
        r = r0 * (1.0 - t) ** 1.1 + 0.02
        ring = []
        for i in range(sides + 1):
            a = 2 * math.pi * i / sides
            ring.append((bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)), i / sides * 2.0, z / 2.0))
        verts.append(ring)
    for j in range(rings):
        for i in range(sides):
            a, b, c, d = verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]
            f = bm.faces.new((a[0], b[0], c[0], d[0]))
            f.material_index = 0
            for loop, v in zip(f.loops, (a, b, c, d)):
                loop[uv].uv = (v[1], v[2])
    # Whorls of boughs: the sapling from above, a fan round the trunk that
    # droops to its rim. Widest low down, a point at the top.
    z = height * 0.16
    crown = height * 0.84
    k = 0
    while z < height * 0.97:
        t = (z - height * 0.16) / crown
        radius = (1.0 - t) ** 0.85 * height * 0.24 + 0.5
        droop = radius * rng.uniform(0.28, 0.42)
        spin = rng.uniform(0, 2 * math.pi)
        segs = 10
        centre = bm.verts.new((0, 0, z + droop * 0.35))
        rim = []
        for i in range(segs):
            a = spin + 2 * math.pi * i / segs
            rr = radius * rng.uniform(0.85, 1.08)
            rim.append((bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z - droop * 0.65 + rng.uniform(-0.1, 0.1) * radius)), a))
        for i in range(segs):
            v0, a0 = rim[i]
            v1, a1 = rim[(i + 1) % segs]
            f = bm.faces.new((centre, v0, v1))
            f.material_index = 1
            # The left half of the sheet; the trunk at its middle.
            for loop, (vx, ang) in zip(f.loops, ((None, None), (v0, a0), (v1, a1))):
                if vx is None:
                    loop[uv].uv = (0.25, 0.5)
                else:
                    loop[uv].uv = (0.25 + math.cos(ang - spin) * 0.24, 0.5 + math.sin(ang - spin) * 0.48)
        step = rng.uniform(0.75, 1.05) * (1.15 - 0.5 * t)
        z += step
        k += 1
    # The silhouette: the sapling from the side, crossed through the crown
    # in three tiers, the lowest the widest.
    for tier, (z0, z1) in enumerate(((0.12, 0.62), (0.4, 0.86), (0.66, 1.02))):
        lo, hi = height * z0, height * z1
        half = (hi - lo) * 0.5 * (1.0 - 0.15 * tier)
        for p in range(2):
            a = rng.uniform(0, math.pi) + p * math.pi / 2
            dx, dy = math.cos(a) * half, math.sin(a) * half
            quad = [bm.verts.new((-dx, -dy, lo)), bm.verts.new((dx, dy, lo)), bm.verts.new((dx, dy, hi)), bm.verts.new((-dx, -dy, hi))]
            f = bm.faces.new(quad)
            f.material_index = 1
            for loop, c in zip(f.loops, ((0.5, 0.0), (1.0, 0.0), (1.0, 1.0), (0.5, 1.0))):
                loop[uv].uv = c
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    # glTF beside its textures (not a GLB with them inside): the three pines
    # share one bough sheet and one bark instead of carrying a copy each.
    path = os.path.join(OUT, f'ph-{name}.gltf')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLTF_SEPARATE', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_animations=False, export_image_format='AUTO')
    print(f'PINE {name}: {len(me.polygons)} faces, {os.path.getsize(path)//1024} KB')


if '--trees-only' not in args:
    render_sheet()
tree('pine_a', 16.0, 3)
tree('pine_b', 19.0, 7, girth=1.1)
tree('pine_c', 13.0, 11, girth=0.9)
