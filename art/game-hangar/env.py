"""The bay's reflections: a panorama of the hangar itself, rendered in Cycles.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \\
      --python art/game-hangar/env.py -- --out public/game/bay-env.hdr

An equirectangular HDR from where a docked ship sits (the hangar model's own
frame, 3.1 m below its origin), lit by the hangar's own emissive panels and
strips plus lamps where the game puts them. The game uses it as the scene's
environment inside the bay, rotated with the bay, so a hull reflects the
lamps, panels and pad that are really around it.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))
os.environ['PZ_NOBAKE'] = '1'
import bpy  # noqa: E402
import pz  # noqa: E402
import craft  # noqa: E402
import surfacing as sf  # noqa: E402

out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(HERE, '..', '..', 'public', 'game', 'bay-env.hdr')
sys.argv = ['blender', '--']
craft.build('hangar')
scene = bpy.context.scene
world = scene.world or bpy.data.worlds.new('w'); scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.002, 0.002, 0.004, 1)
# The game's lamps (src/game/scene/Props.jsx), in the hangar model's frame (the bay frame is 3.1 m lower).
for name, at, power, colour in [('key', (0, 18 - 3.1, 6), 52000, (1, 0.94, 0.85)), ('fillA', (-22, 12 - 3.1, -24), 17000, (1, 0.84, 0.66)),
                                ('fillB', (22, 12 - 3.1, 26), 17000, (1, 0.84, 0.66)), ('rim', (-30, 3 - 3.1, 0), 11000, (0.18, 0.83, 1))]:
    L = bpy.data.lights.new(name, 'POINT'); L.energy = power; L.color = colour; L.shadow_soft_size = 0.6
    o = bpy.data.objects.new(name, L); o.location = pz.from_three(*at); scene.collection.objects.link(o)
cam = bpy.data.cameras.new('pano')
cam.type = 'PANO'
cam.panorama_type = 'EQUIRECTANGULAR'
co = bpy.data.objects.new('pano', cam); scene.collection.objects.link(co)
co.location = pz.from_three(0, -3.1, 0)
# Facing +X with Z up: the centre of the image is the runtime's +X, which is where three.js puts an equirectangular map's centre.
co.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
scene.camera = co
sf._cycles(96, device='GPU')
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1024, 512
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'HDR'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('PZ-WROTE', out)
