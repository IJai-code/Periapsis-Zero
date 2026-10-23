"""Poly Haven's photo-scanned models (CC0, polyhaven.com), made fit for the
game: each joined into one mesh, decimated to a triangle budget a browser
can draw, stood on its base (origin at the middle of its foot), and written
as one GLB with its 1K textures.

    python3 <scratchpad>/phdl.py art/sources/polyhaven <ids...>     (download)
    blender -b --factory-startup --python art/godot/polyhaven.py -- art/sources/polyhaven game/art/ph id:tris ...
"""
import os
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)

for spec in args[2:]:
    mid, tris = spec.split(':')
    tris = int(tris)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = os.path.join(SRC, mid)
    gltf = next(f for f in os.listdir(folder) if f.endswith('.gltf'))
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    # Unparent (keep where it is), apply every transform.
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    before = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if before > tris:
        mod = o.modifiers.new('decimate', 'DECIMATE')
        mod.ratio = tris / before
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    after = sum(len(p.vertices) - 2 for p in o.data.polygons)
    # Its foot at the origin: the middle of the bottom of its box.
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    cx, cy, z0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
    for v in o.data.vertices:
        v.co.x -= cx
        v.co.y -= cy
        v.co.z -= z0
    for p in o.data.polygons:
        p.use_smooth = True
    o.name = mid
    for obj in list(bpy.context.scene.objects):
        if obj != o:
            bpy.data.objects.remove(obj, do_unlink=True)
    path = os.path.join(OUT, f'ph-{mid}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_animations=False)
    print(f'PH {mid}: {before} -> {after} tris, size {max(xs)-min(xs):.2f} x {max(ys)-min(ys):.2f} x {max(zs)-min(zs):.2f} m, {os.path.getsize(path)//1024} KB')
