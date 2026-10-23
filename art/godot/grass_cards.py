"""Grass cards: Poly Haven's scanned grass and wildflowers (CC0), each clump
rendered side on into one sheet the game's grass is drawn from.

    python3 <scratchpad>/phdl.py art/sources/polyhaven grass_medium_01 grass_medium_02 dandelion_01 flower_ursinia
    blender -b --factory-startup --python art/godot/grass_cards.py -- art/sources/polyhaven game/art/grass

The scans are real blades, a few hundred to a few thousand triangles a
clump: too many to scatter ten thousand times in a browser. Rendered with
their own light and shade (the depth between the blades is real) into a
4 x 2 sheet of square tiles, each clump stood on the bottom of its tile, they
become three crossed cards a tuft (Grass), the way open-world games draw
fields. grass-cards.json gives each tile's size in metres.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector as V

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)

# Row 0: grass. Row 1: grass and flowers. (model, object name)
TILES = [
    ('grass_medium_01', 'grass_medium_01_tall_a_LOD0'),
    ('grass_medium_01', 'grass_medium_01_tall_b_LOD0'),
    ('grass_medium_01', 'grass_medium_01_mid_a_LOD0'),
    ('grass_medium_01', 'grass_medium_01_large_a_LOD0'),
    ('grass_medium_02', 'grass_medium_02_e'),
    ('grass_medium_02', 'grass_medium_02_d'),
    ('dandelion_01', 'dandelion_01_a_LOD0'),
    ('flower_ursinia', 'flower_ursinia_c_LOD0'),
]
COLS, ROWS, PX = 4, 2, 512

bpy.ops.wm.read_factory_settings(use_empty=True)
s = bpy.context.scene
s.render.engine = 'CYCLES'
s.cycles.device = 'CPU'
s.cycles.samples = 48
s.cycles.use_denoising = True
s.render.film_transparent = True
s.view_settings.view_transform = 'Standard'
s.render.image_settings.file_format = 'PNG'
s.render.image_settings.color_mode = 'RGBA'
s.render.resolution_x = COLS * PX
s.render.resolution_y = ROWS * PX
w = bpy.data.worlds.new('w')
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 0.9, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.1
s.world = w
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 2.6
sun.angle = math.radians(8)
o = bpy.data.objects.new('sun', sun)
s.collection.objects.link(o)
o.rotation_euler = Euler((math.radians(-40), math.radians(25), 0))

imported = {}
sizes = []
for i, (model, name) in enumerate(TILES):
    if model not in imported:
        folder = os.path.join(SRC, model)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(folder, next(f for f in os.listdir(folder) if f.endswith('.gltf'))))
        imported[model] = [ob for ob in bpy.data.objects if ob not in before]
        # The 1K glTF leaves out the alpha map (the blades' cut-out): it is
        # fetched alongside, <model>_alpha_1k.png, and wired in here. Matte,
        # as grass is: the scans' gloss read as wet plastic.
        alpha = os.path.join(folder, 'textures', f'{model}_alpha_1k.png')
        for ob in imported[model]:
            for slot in getattr(ob, 'material_slots', []):
                m = slot.material
                if not m or m.get('pz_done'):
                    continue
                m['pz_done'] = True
                nt = m.node_tree
                bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
                for l in list(bsdf.inputs['Roughness'].links):
                    nt.links.remove(l)
                bsdf.inputs['Roughness'].default_value = 0.85
                bsdf.inputs['Specular IOR Level'].default_value = 0.2
                if os.path.exists(alpha):
                    tex = nt.nodes.new('ShaderNodeTexImage')
                    tex.image = bpy.data.images.load(alpha)
                    tex.image.colorspace_settings.name = 'Non-Color'
                    uv = bsdf.inputs['Base Color'].links[0].from_node.inputs['Vector']
                    if uv.links:
                        nt.links.new(uv.links[0].from_socket, tex.inputs['Vector'])
                    nt.links.new(tex.outputs['Color'], bsdf.inputs['Alpha'])
                    m.blend_method = 'HASHED' if hasattr(m, 'blend_method') else None
    ob = bpy.data.objects[name].copy()
    ob.data = ob.data.copy()
    s.collection.objects.link(ob)
    ob.parent = None
    ob.matrix_world = bpy.data.objects[name].matrix_world.copy()
    bpy.context.view_layer.update()
    # Its own size, then stood in its cell: a cell is 1 x 1, the clump fills
    # 96% of it at its larger side, its foot on the cell's bottom.
    pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
    lo = V((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = V((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    span = max(hi.x - lo.x, hi.z - lo.z)
    k = 0.96 / span
    col, row = i % COLS, i // COLS
    cell = V((col + 0.5, 0.0, (ROWS - 1 - row)))
    mid = V(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    ob.matrix_world = (
        __import__('mathutils').Matrix.Translation(cell)
        @ __import__('mathutils').Matrix.Scale(k, 4)
        @ __import__('mathutils').Matrix.Translation(-mid)
        @ ob.matrix_world
    )
    # The tile's size in metres (the clump as scanned): what one card spans.
    sizes.append({'model': model, 'name': name, 'size': round(1.0 / k, 4)})
# The imported originals out of the picture.
for objs in imported.values():
    for ob in objs:
        bpy.data.objects.remove(ob, do_unlink=True)

cam = bpy.data.cameras.new('cam')
cam.type = 'ORTHO'
cam.ortho_scale = COLS
c = bpy.data.objects.new('cam', cam)
s.collection.objects.link(c)
c.location = (COLS / 2, -10.0, ROWS / 2)
c.rotation_euler = Euler((math.radians(90), 0, 0))
s.camera = c
s.render.filepath = os.path.join(OUT, 'grass-cards.png')
bpy.ops.render.render(write_still=True)
json.dump({'cols': COLS, 'rows': ROWS, 'tiles': sizes}, open(os.path.join(OUT, 'grass-cards.json'), 'w'), indent=1)
print('GRASS', sizes)
