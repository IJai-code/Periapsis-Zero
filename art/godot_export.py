"""Re-save a shipped GLB as a plain one for the Godot project.

The web build's GLBs are Draco-compressed, which three.js reads and Godot does
not. Blender's importer decodes Draco, so each shipped file is read back and
written out uncompressed, keeping its baked texture atlas exactly:

    blender -b --factory-startup --python art/godot_export.py -- public/authored/game-kestrel.glb game/assets/models/game-kestrel.glb
"""
import sys
import bpy

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    export_yup=True,
    export_cameras=False,
    export_lights=False,
    export_extras=False,
    export_animations=True,
    export_image_format='AUTO',
)
