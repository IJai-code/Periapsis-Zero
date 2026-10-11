"""Periapsis Zero's people, built with MakeHuman's MPFB add-on for Blender.

    blender -b --python art/godot/people.py -- <who> <out.glb> [--hd]

MPFB (extensions.blender.org) and its CC0 asset packs (MakeHuman system
assets, skins01, skins02; art/sources/makehuman) must be installed. Each
person is a body with skin, eyes, brows, lashes, teeth, hair and clothes,
on MPFB's game-engine rig, exported with the actions made here: a relaxed
idle that breathes and shifts its weight, and a talking loop with the
head and a hand. Nothing is joined; Godot plays the actions on the rig.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService
from bl_ext.blender_org.mpfb.services.locationservice import LocationService

args = sys.argv[sys.argv.index('--') + 1:]
WHO, OUT = args[0], args[1]

PEOPLE = {
    # The Aster's captain: fifties, solid, tired, kind.
    'hale': {
        'phenotype': {'gender': 1.0, 'age': 0.8, 'muscle': 0.56, 'weight': 0.62, 'proportions': 0.55, 'height': 0.58,
                      'cupsize': 0.5, 'firmness': 0.5, 'race': {'asian': 0.05, 'caucasian': 0.75, 'african': 0.2}},
        'skin': 'middleage_caucasian_male/middleage_caucasian_male.mhmat',
        'hair': 'short01/short01.mhclo', 'eyebrows': 'eyebrow003/eyebrow003.mhclo',
        'clothes': ['male_elegantsuit01/male_elegantsuit01.mhclo', 'shoes02/shoes02.mhclo'],
    },
    # Renn Ayers, second engineer: young, quick, wiry.
    'renn': {
        'phenotype': {'gender': 0.0, 'age': 0.42, 'muscle': 0.55, 'weight': 0.42, 'proportions': 0.6, 'height': 0.45,
                      'cupsize': 0.45, 'firmness': 0.6, 'race': {'asian': 0.8, 'caucasian': 0.2, 'african': 0.0}},
        'skin': 'young_asian_female/young_asian_female.mhmat',
        'hair': 'ponytail01/ponytail01.mhclo', 'eyebrows': 'eyebrow010/eyebrow010.mhclo',
        'clothes': ['male_worksuit01/male_worksuit01.mhclo', 'shoes01/shoes01.mhclo'],
    },
    # The pilot, played in third person: thirties, fit, in a flight coverall
    # (MakeHuman's work suit, darkened to olive in Godot).
    'pilot': {
        'phenotype': {'gender': 0.85, 'age': 0.55, 'muscle': 0.62, 'weight': 0.5, 'proportions': 0.6, 'height': 0.55,
                      'cupsize': 0.5, 'firmness': 0.5, 'race': {'asian': 0.25, 'caucasian': 0.45, 'african': 0.3}},
        'skin': 'young_caucasian_male/young_caucasian_male.mhmat',
        'hair': 'short02/short02.mhclo', 'eyebrows': 'eyebrow001/eyebrow001.mhclo',
        'clothes': ['male_worksuit01/male_worksuit01.mhclo', 'shoes05/shoes05.mhclo'],
        'walks': True,
    },
    # Mara Voss, Hearth's dockmaster: forties, steady, sees everything.
    'mara': {
        'phenotype': {'gender': 0.0, 'age': 0.68, 'muscle': 0.6, 'weight': 0.55, 'proportions': 0.55, 'height': 0.56,
                      'cupsize': 0.5, 'firmness': 0.5, 'race': {'asian': 0.0, 'caucasian': 0.35, 'african': 0.65}},
        'skin': 'middleage_african_female/middleage_african_female.mhmat',
        'hair': 'braid01/braid01.mhclo', 'eyebrows': 'eyebrow005/eyebrow005.mhclo',
        'clothes': ['male_casualsuit05/male_casualsuit05.mhclo', 'shoes03/shoes03.mhclo'],
    },
}


def build(spec):
    info = HumanService._create_default_human_info_dict()
    info['phenotype'] = spec['phenotype']
    info['rig'] = 'game_engine'
    info['eyes'] = 'high-poly/high-poly.mhclo'
    info['eyebrows'] = spec['eyebrows']
    info['eyelashes'] = 'eyelashes01/eyelashes01.mhclo'
    info['teeth'] = 'teeth_base/teeth_base.mhclo'
    info['tongue'] = 'tongue01/tongue01.mhclo'
    info['hair'] = spec['hair']
    info['clothes'] = spec['clothes']
    info['skin_mhmat'] = spec['skin']
    info['skin_material_type'] = 'GAMEENGINE'
    info['eyes_material_type'] = 'MAKESKIN'
    info['clothes_material_type'] = 'MAKESKIN'
    info['alternative_materials'] = {}
    settings = HumanService.get_default_deserialization_settings()
    settings['subdiv_levels'] = 0
    settings['material_instances'] = 'NEVER'
    return HumanService.deserialize_from_dict(info, settings)


# --- The face: expression shape keys for blinking and talking. -----------

# Godot drives these by name (game/scripts/people/person.gd). Each is one of
# MakeHuman's CC0 expression units, shipped inside MPFB.
FACE = {
    'blink_l': 'eye-left-closure', 'blink_r': 'eye-right-closure',
    'mouth_open': 'mouth-open', 'smile': 'mouth-corner-puller', 'purse': 'mouth-pursing',
    'brow_l': 'eyebrows-left-inner-up', 'brow_r': 'eyebrows-right-inner-up',
}


def face(basemesh, race):
    """Bake the body's proportions into the mesh, drop the helper geometry,
    add the expression keys, and give the eyelashes, brows, teeth and tongue
    the same keys so they move with the face."""
    TargetService.bake_targets(basemesh)
    # Expression targets are written against MakeHuman's full vertex list,
    # so they go on before anything is removed.
    units = LocationService.get_mpfb_data('targets') + f'/expression/units/{race}'
    if basemesh.data.shape_keys is None:
        basemesh.shape_key_add(name='Basis', from_mix=False)
    for key, unit in FACE.items():
        TargetService.load_target(basemesh, f'{units}/{unit}.target.gz', weight=0.0, name=key)
    # MakeHuman's mouth units describe one side of the face; the expression
    # system mirrors them. Without that only half the mouth moves.
    for key in ('mouth_open', 'smile', 'purse'):
        TargetService.symmetrize_shape_key(basemesh, key, copy_left_to_right=True)
    # Now drop what the masks hide (helpers, skin under clothes), deleting
    # the vertices directly so the shape keys come through.
    doomed = set()
    for m in [m for m in basemesh.modifiers if m.type == 'MASK']:
        vg = basemesh.vertex_groups.get(m.vertex_group)
        members = set()
        if vg:
            for v in basemesh.data.vertices:
                for g in v.groups:
                    if g.group == vg.index and g.weight > m.threshold:
                        members.add(v.index)
        everyone = set(range(len(basemesh.data.vertices)))
        doomed |= members if m.invert_vertex_group else (everyone - members)
    bm = bmesh.new()
    bm.from_mesh(basemesh.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in sorted(doomed)], context='VERTS')
    bm.to_mesh(basemesh.data)
    bm.free()
    for m in [m for m in basemesh.modifiers if m.type == 'MASK']:
        basemesh.modifiers.remove(m)
    keys = basemesh.data.shape_keys.key_blocks
    # Lashes and brows ride the face (bound to its surface).
    parts = [o for o in bpy.data.objects if o.type == 'MESH' and any(t in o.name for t in ('eyelash', 'eyebrow'))]
    for part in parts:
        sd = part.modifiers.new('follow', 'SURFACE_DEFORM')
        sd.target = basemesh
        with bpy.context.temp_override(object=part, active_object=part):
            bpy.ops.object.surfacedeform_bind(modifier=sd.name)
        part.shape_key_add(name='Basis', from_mix=False)
        for key in FACE:
            for k in keys:
                k.value = 0.0
            keys[key].value = 1.0
            bpy.context.view_layer.update()
            ev = part.evaluated_get(bpy.context.evaluated_depsgraph_get())
            co = [v.co.copy() for v in ev.to_mesh().vertices]
            ev.to_mesh_clear()
            sk = part.shape_key_add(name=key, from_mix=False)
            for i, c in enumerate(co):
                sk.data[i].co = c
        part.modifiers.remove(sd)
    # Teeth and tongue are rigid: the upper teeth stay, the lower teeth and
    # the tongue drop with the jaw. How far the jaw drops is read from the
    # chin's travel in the face's own mouth-open key.
    basis = keys['Basis'].data
    opened = keys['mouth_open'].data
    jaw = max((opened[i].co - basis[i].co for i in range(len(basis))), key=lambda d: d.length)
    for part in [o for o in bpy.data.objects if o.type == 'MESH' and any(t in o.name for t in ('teeth', 'tongue'))]:
        part.shape_key_add(name='Basis', from_mix=False)
        zs = [v.co.z for v in part.data.vertices]
        mid = (min(zs) + max(zs)) / 2.0
        for key in FACE:
            sk = part.shape_key_add(name=key, from_mix=False)
            if key != 'mouth_open':
                continue
            for i, v in enumerate(part.data.vertices):
                if 'tongue' in part.name:
                    sk.data[i].co = v.co + jaw * 0.55
                elif v.co.z < mid:
                    sk.data[i].co = v.co + jaw * 0.8
    for k in keys:
        k.value = 0.0


def smooth(basemesh, levels=1):
    """Subdivide the body once for smooth skin, keeping its expression keys:
    each key is captured through the same subdivision on a throwaway copy,
    then laid back onto the subdivided body. Vertex weights come through
    the subdivision, so the rig still drives it."""
    keys = [k.name for k in basemesh.data.shape_keys.key_blocks[1:]]
    captured = {}
    for key in keys:
        for k in basemesh.data.shape_keys.key_blocks:
            k.value = 1.0 if k.name == key else 0.0
        tmp = basemesh.copy()
        tmp.data = basemesh.data.copy()
        bpy.context.collection.objects.link(tmp)
        with bpy.context.temp_override(object=tmp, active_object=tmp, selected_objects=[tmp]):
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
            for m in list(tmp.modifiers):
                tmp.modifiers.remove(m)
            sub = tmp.modifiers.new('sub', 'SUBSURF')
            sub.levels = levels
            bpy.ops.object.modifier_apply(modifier=sub.name)
        captured[key] = [v.co.copy() for v in tmp.data.vertices]
        bpy.data.objects.remove(tmp)
    for k in basemesh.data.shape_keys.key_blocks:
        k.value = 0.0
    with bpy.context.temp_override(object=basemesh, active_object=basemesh, selected_objects=[basemesh]):
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
        sub = basemesh.modifiers.new('sub', 'SUBSURF')
        sub.levels = levels
        bpy.ops.object.modifier_apply(modifier=sub.name)
    basemesh.shape_key_add(name='Basis', from_mix=False)
    for key in keys:
        sk = basemesh.shape_key_add(name=key, from_mix=False)
        for i, c in enumerate(captured[key]):
            sk.data[i].co = c
    # Clothes and hair get the same smoothing, applied on export.
    for o in bpy.data.objects:
        if o.type == 'MESH' and o is not basemesh and not any(t in o.name for t in ('eyelash', 'eyebrow', 'teeth', 'tongue', 'high-poly')):
            if not o.data.shape_keys:
                m = o.modifiers.new('sub', 'SUBSURF')
                m.levels = 1


# --- Posing in world space, so the rig's own bone axes do not matter. -------

def rotate(arm, name, axis, degrees):
    pb = arm.pose.bones[name]
    m = arm.matrix_world @ pb.matrix
    head = m.translation.copy()
    r = Matrix.Translation(head) @ Matrix.Rotation(math.radians(degrees), 4, Vector(axis)) @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ (r @ m)
    bpy.context.view_layer.update()


def aim(arm, name, direction):
    """Turn a bone about its head so it points along `direction` (world)."""
    pb = arm.pose.bones[name]
    cur = (arm.matrix_world @ pb.tail) - (arm.matrix_world @ pb.head)
    q = cur.normalized().rotation_difference(Vector(direction).normalized())
    m = arm.matrix_world @ pb.matrix
    head = m.translation.copy()
    r = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ (r @ m)
    bpy.context.view_layer.update()


def relaxed(arm, t=0.0, talk=0.0):
    """A standing pose out of the T: arms down, a little bend everywhere,
    with breathing, a weight shift and (for talking) head and hand moving.
    `t` is the time in seconds; all motion loops every 4 seconds."""
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    w = 2 * math.pi * t / 4.0
    breath = math.sin(w)
    sway = math.sin(w * 0.5)
    # Arms: hanging at the sides (the rest pose has them out, forearms
    # forward); a soft elbow, hands following, fingers curled. Mirrored on x.
    for s in ('l', 'r'):
        sg = 1.0 if s == 'l' else -1.0
        aim(arm, f'upperarm_{s}', (sg * 0.2, -0.04 + breath * 0.01, -0.98))
        aim(arm, f'lowerarm_{s}', (sg * 0.1, -0.24, -0.96))
        aim(arm, f'hand_{s}', (sg * 0.04, -0.14, -0.99))
        for f in ('index', 'middle', 'ring', 'pinky'):
            for k in ('01', '02', '03'):
                rotate(arm, f'{f}_{k}_{s}', (0, 1, 0), sg * (16 if k == '01' else 22))
    # The body: a slow weight shift and breathing in the chest.
    rotate(arm, 'pelvis', (0, 1, 0), sway * 1.5)
    rotate(arm, 'spine_02', (1, 0, 0), -breath * 1.0)
    rotate(arm, 'spine_03', (1, 0, 0), -breath * 0.8)
    rotate(arm, 'thigh_l', (0, 1, 0), -sway * 1.5)
    rotate(arm, 'thigh_r', (0, 1, 0), -sway * 1.5)
    rotate(arm, 'neck_01', (1, 0, 0), 3)
    # Talking: the head nods and turns a little, the right hand comes up.
    if talk:
        rotate(arm, 'head', (1, 0, 0), math.sin(w * 2.0) * 3.0 * talk)
        rotate(arm, 'head', (0, 0, 1), math.sin(w * 0.75) * 6.0 * talk)
        g = (0.5 + 0.5 * math.sin(w)) * talk
        aim(arm, 'upperarm_r', Vector((-0.2, -0.04, -0.98)).lerp(Vector((-0.22, -0.35, -0.9)), g))
        aim(arm, 'lowerarm_r', Vector((-0.1, -0.24, -0.96)).lerp(Vector((-0.1, -0.9, -0.2)), g))
        aim(arm, 'hand_r', Vector((-0.04, -0.14, -0.99)).lerp(Vector((-0.05, -0.95, 0.1)), g))
    else:
        rotate(arm, 'head', (0, 0, 1), math.sin(w * 0.5) * 4.0)


def stride(arm, t, period, run):
    """One moment of a walk (run=0) or a run (run=1) cycle of `period`
    seconds. The figure faces -Y: a leg swings forward with a negative turn
    about X. Arms counter-swing, the hips twist and the chest twists back."""
    relaxed(arm, 0.0, 0.0)
    ph = 2 * math.pi * t / period
    swing = 24.0 + 18.0 * run
    for s, sgn in (('l', 1.0), ('r', -1.0)):
        f = math.sin(ph) * sgn                      # +1: this leg fully forward
        lift = max(0.0, math.cos(ph) * sgn)        # swinging through
        rotate(arm, f'thigh_{s}', (1, 0, 0), -swing * f - (10.0 * run) * lift)
        rotate(arm, f'calf_{s}', (1, 0, 0), 6.0 + (38.0 + 42.0 * run) * lift)
        rotate(arm, f'foot_{s}', (1, 0, 0), -8.0 * lift + 6.0 * f)
        # The opposite arm swings with this leg.
        rotate(arm, f'upperarm_{s}', (1, 0, 0), swing * 0.75 * f)
        rotate(arm, f'lowerarm_{s}', (1, 0, 0), -(12.0 + 55.0 * run) - 10.0 * max(0.0, -f))
    rotate(arm, 'pelvis', (0, 0, 1), math.sin(ph) * (5.0 + 3.0 * run))
    rotate(arm, 'spine_02', (0, 0, 1), -math.sin(ph) * (6.0 + 4.0 * run))
    rotate(arm, 'spine_01', (1, 0, 0), -4.0 - 8.0 * run)
    rotate(arm, 'neck_01', (1, 0, 0), 2.0 + 5.0 * run)
    # The body rises over each step, twice a cycle.
    arm.pose.bones['pelvis'].location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    pb = arm.pose.bones['pelvis']
    m = arm.matrix_world @ pb.matrix
    m.translation.z += (0.025 + 0.03 * run) * (abs(math.cos(ph)) - 0.5)
    pb.matrix = arm.matrix_world.inverted() @ m
    bpy.context.view_layer.update()


def bake_stride(arm, name, period, run, fps=24):
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    frames = int(round(period * fps))
    for f in range(0, frames + 1, 2):
        stride(arm, f / fps, period, run)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
            pb.keyframe_insert('location', frame=f)
    action.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    arm.animation_data.action = None


def bake(arm, name, talk, frames=96, fps=24):
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    for f in range(0, frames + 1, 4):
        relaxed(arm, f / fps, talk)
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if pb.name in ('pelvis', 'Root'):
                pb.keyframe_insert('location', frame=f)
    # Keep the action when it is no longer the active one.
    action.use_fake_user = True
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    arm.animation_data.action = None


bpy.ops.wm.read_homefile(use_empty=True)
basemesh = build(PEOPLE[WHO])
race = max(PEOPLE[WHO]['phenotype']['race'].items(), key=lambda kv: kv[1])[0]
face(basemesh, race)
# `--hd`: the subdivided body for the desktop build (person-<who>_hd.glb);
# the browser build loads the plain one, at a quarter of the vertices.
if '--hd' in args:
    smooth(basemesh)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bpy.context.scene.render.fps = 24
bake(arm, 'idle', 0.0)
bake(arm, 'talk', 1.0)
if PEOPLE[WHO].get('walks'):
    bake_stride(arm, 'walk', 1.05, 0.0)
    bake_stride(arm, 'run', 0.7, 1.0)
# Textures: the skin at 2K for close-ups, everything else at 1K.
for img in bpy.data.images:
    if img.size[0] == 0:
        continue
    limit = 2048 if 'skin' in img.name.lower() or 'male_diffuse' in img.name.lower() else 1024
    if max(img.size) > limit:
        k = limit / max(img.size)
        img.scale(int(img.size[0] * k), int(img.size[1] * k))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_cameras=False, export_lights=False,
                          export_image_format='JPEG', export_jpeg_quality=86, export_morph=True,
                          export_morph_normal=False)
eyes = next((o for o in bpy.data.objects if 'eye' in o.name.lower() and o.type == 'MESH'), None)
print('person:', WHO, OUT, [o.name for o in bpy.data.objects])
print('facing check: head', arm.matrix_world @ arm.pose.bones['head'].head, 'eyes', eyes and eyes.matrix_world @ Vector(eyes.bound_box[0]))
