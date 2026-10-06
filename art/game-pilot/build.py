"""The pilot, rigged and animated: a suited figure for the boarding walk.

    npm run art:build -- game-pilot

A skeleton (hips, spine, chest, neck, head, arms, legs, feet) under a
segmented suit: each piece is rigidly bound to its bone, the way a hard
suit's plates move, so there is no weight painting to drift. Three actions:
`walk` (a one-second gait cycle, about 1.5 m a stride pair), `idle`
(breathing, weight shifting) and `sit` (into a seat). The game plays them
with three.js's AnimationMixer and recolours the materials `suit`, `stripe`
and `visor` to the player's choice.

Blender frame: Z up, the figure faces -Y (the runtime's +Z), feet at z = 0.
"""
import math
import os
import sys

import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
import pz  # noqa: E402

a = pz.cli()
pz.reset_scene()
pz._materials.clear()
M = {
    'suit': pz.material('suit', '#eeeae2', roughness=0.55),
    'stripe': pz.material('stripe', '#ff6b2c', roughness=0.5),
    'visor': pz.material('visor', '#ffb070', metallic=0.85, roughness=0.06),
    'dark': pz.material('dark', '#2b2a33', metallic=0.5, roughness=0.45),
}

# ---------------------------------------------------------------- skeleton
BONES = [
    # name, head, tail, parent
    ('hips', (0, 0, 0.98), (0, 0, 1.12), None),
    ('spine', (0, 0, 1.12), (0, 0, 1.36), 'hips'),
    ('chest', (0, 0, 1.36), (0, 0, 1.56), 'spine'),
    ('neck', (0, 0, 1.56), (0, 0, 1.64), 'chest'),
    ('head', (0, 0, 1.64), (0, 0, 1.9), 'neck'),
]
for s, n in ((1, 'L'), (-1, 'R')):
    BONES += [
        (f'thigh.{n}', (s * 0.1, 0, 0.98), (s * 0.1, 0, 0.55), 'hips'),
        (f'shin.{n}', (s * 0.1, 0, 0.55), (s * 0.1, 0.01, 0.1), f'thigh.{n}'),
        (f'foot.{n}', (s * 0.1, 0.01, 0.1), (s * 0.1, -0.15, 0.03), f'shin.{n}'),
        (f'upperarm.{n}', (s * 0.21, 0, 1.5), (s * 0.24, 0.0, 1.22), 'chest'),
        (f'forearm.{n}', (s * 0.24, 0.0, 1.22), (s * 0.26, -0.03, 0.97), f'upperarm.{n}'),
        (f'hand.{n}', (s * 0.26, -0.03, 0.97), (s * 0.27, -0.04, 0.87), f'forearm.{n}'),
    ]
arm_data = bpy.data.armatures.new('pilot_rig')
rig = bpy.data.objects.new('pilot_rig', arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, parent in BONES:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail, b.roll = Vector(h), Vector(t), 0.0
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- the suit
parts = []
def ellipsoid(name, bone, centre, radii, mat, axis=None, segs=(20, 12)):
    """A smooth ellipsoid, its long axis along `axis` (a direction), bound to `bone`."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs[0], ring_count=segs[1], radius=1, location=centre)
    o = bpy.context.active_object
    o.name = name
    o.scale = radii
    if axis is not None:
        o.rotation_euler = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_euler()
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(M[mat])
    o['bone'] = bone
    parts.append(o)
    return o

def along(name, bone, h, t, r, mat, cap=1.0):
    h, t = Vector(h), Vector(t)
    return ellipsoid(name, bone, (h + t) / 2, (r, r, (t - h).length / 2 * cap), mat, axis=t - h)

ellipsoid('belt', 'hips', (0, 0, 1.1), (0.195, 0.15, 0.035), 'dark')
ellipsoid('chestplate', 'chest', (0, -0.11, 1.45), (0.12, 0.05, 0.08), 'stripe')
ellipsoid('pack', 'chest', (0, 0.17, 1.4), (0.15, 0.08, 0.2), 'dark')
ellipsoid('packlamp', 'chest', (0, 0.245, 1.52), (0.08, 0.01, 0.012), 'stripe')
ellipsoid('collar', 'neck', (0, 0, 1.6), (0.11, 0.1, 0.045), 'dark')
ellipsoid('helmet', 'head', (0, 0.01, 1.76), (0.16, 0.17, 0.17), 'suit', segs=(28, 18))
ellipsoid('visor', 'head', (0, -0.075, 1.765), (0.125, 0.11, 0.09), 'visor', segs=(28, 16))
ellipsoid('crest', 'head', (0, 0.02, 1.915), (0.025, 0.12, 0.02), 'stripe')
for s, n in ((1, 'L'), (-1, 'R')):
    ellipsoid(f'knee{n}', f'shin.{n}', (s * 0.1, -0.06, 0.55), (0.06, 0.04, 0.06), 'stripe')
    ellipsoid(f'boot{n}', f'foot.{n}', (s * 0.1, -0.05, 0.06), (0.08, 0.14, 0.065), 'dark')
    ellipsoid(f'glove{n}', f'hand.{n}', (s * 0.265, -0.035, 0.92), (0.045, 0.04, 0.06), 'dark')

# The suit itself: one continuous body grown along the joints with a Skin
# modifier, smoothed, and weighted to the rig automatically (bone heat), so
# it bends like padded fabric at hip, knee, shoulder and elbow. The hard
# parts above (helmet, pack, boots, gloves, pads) stay rigid.
J = {'pelvis': ((0, 0, 1.0), (0.17, 0.13)), 'waist': ((0, 0, 1.18), (0.155, 0.12)), 'chest': ((0, 0, 1.4), (0.205, 0.15)), 'neck': ((0, 0, 1.58), (0.085, 0.085))}
for s_, n in ((1, 'L'), (-1, 'R')):
    J.update({f'hip{n}': ((s_ * 0.1, 0, 0.94), (0.105, 0.105)), f'knee{n}': ((s_ * 0.1, 0, 0.55), (0.082, 0.085)), f'ankle{n}': ((s_ * 0.1, 0.01, 0.14), (0.066, 0.07)),
              f'shoulder{n}': ((s_ * 0.2, 0, 1.47), (0.085, 0.085)), f'elbow{n}': ((s_ * 0.24, 0, 1.22), (0.062, 0.062)), f'wrist{n}': ((s_ * 0.26, -0.03, 0.99), (0.052, 0.052))})
names = list(J)
EDGES = [('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'neck')]
for n in ('L', 'R'):
    EDGES += [('pelvis', f'hip{n}'), (f'hip{n}', f'knee{n}'), (f'knee{n}', f'ankle{n}'), ('chest', f'shoulder{n}'), (f'shoulder{n}', f'elbow{n}'), (f'elbow{n}', f'wrist{n}')]
me = bpy.data.meshes.new('suitbody')
me.from_pydata([J[k][0] for k in names], [(names.index(a_), names.index(b_)) for a_, b_ in EDGES], [])
suitbody = bpy.data.objects.new('suitbody', me)
bpy.context.scene.collection.objects.link(suitbody)
sk = suitbody.modifiers.new('skin', 'SKIN')
sub = suitbody.modifiers.new('smooth', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
for i, k in enumerate(names):
    me.skin_vertices[0].data[i].radius = J[k][1]
me.skin_vertices[0].data[0].use_root = True
bpy.context.view_layer.objects.active = suitbody
for o in bpy.context.selected_objects:
    o.select_set(False)
suitbody.select_set(True)
for m_ in list(suitbody.modifiers):
    bpy.ops.object.modifier_apply(modifier=m_.name)
for p_ in suitbody.data.polygons:
    p_.use_smooth = True
suitbody.data.materials.append(M['suit'])
# Bone heat: select the body, then the rig (active), parent with automatic weights.
bpy.ops.object.select_all(action='DESELECT')
suitbody.select_set(True); rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for m_ in list(suitbody.modifiers):
    suitbody.modifiers.remove(m_)
mw = suitbody.matrix_world.copy(); suitbody.parent = None; suitbody.matrix_world = mw
print('PZ-SKIN groups', len(suitbody.vertex_groups), 'verts', len(suitbody.data.vertices))

# Each piece entirely in its bone's vertex group; joined; bound to the rig.
for o in parts:
    vg = o.vertex_groups.new(name=o['bone'])
    vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
suitbody.select_set(True)
bpy.ops.object.join()
body = bpy.context.active_object
body.name = 'pilot'
mod = body.modifiers.new('rig', 'ARMATURE')
mod.object = rig
body.parent = rig

# ---------------------------------------------------------------- actions
bpy.context.scene.render.fps = 30
pb = rig.pose.bones
for b in pb:
    b.rotation_mode = 'XYZ'

def calibrate(name):
    """Which sign of a rotation about the bone's X axis moves its tail forward (-Y)."""
    b = pb[name]
    b.rotation_euler = (0, 0, 0); bpy.context.view_layer.update()
    y0 = (rig.matrix_world @ b.tail).y
    b.rotation_euler = (0.3, 0, 0); bpy.context.view_layer.update()
    y1 = (rig.matrix_world @ b.tail).y
    b.rotation_euler = (0, 0, 0)
    return -1.0 if y1 > y0 else 1.0

SIGN = {b.name: calibrate(b.name) for b in pb}
D = math.radians

def pose(frame, spec):
    """spec: bone -> (forward pitch in degrees, yaw, roll) and 'loc' for the hips offset."""
    for b in pb:
        pitch, yaw, roll = spec.get(b.name, (0, 0, 0))
        b.rotation_euler = (SIGN[b.name] * D(pitch), D(yaw), D(roll))
        b.keyframe_insert('rotation_euler', frame=frame)
    loc = spec.get('loc', (0, 0, 0))
    pb['hips'].location = loc
    pb['hips'].keyframe_insert('location', frame=frame)

def action(name, frames, fn, cyclic=True):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    for f in frames:
        pose(f, fn(f))
    # Looping is the player's job (three.js loops a clip); a cycle's first and last keys match.
    return act

def walk(f):
    # One stride cycle in 30 frames; phase 0 is the left heel striking.
    ph = (f % 30) / 30 * math.tau
    c, s = math.cos(ph), math.sin(ph)
    swingL = max(0.0, math.sin(ph - math.pi))   # left leg swinging through (second half)
    swingR = max(0.0, math.sin(ph))
    # Bone-local Y runs along each bone; local "pitch" is forward swing.
    return {
        'thigh.L': (24 * c, 0, 0), 'thigh.R': (-24 * c, 0, 0),
        'shin.L': (-(6 + 52 * swingL), 0, 0), 'shin.R': (-(6 + 52 * swingR), 0, 0),
        'foot.L': (-14 * c + 18 * swingL, 0, 0), 'foot.R': (14 * c + 18 * swingR, 0, 0),
        'hips': (0, 0, 5 * c), 'spine': (5, 0, -3 * c), 'chest': (2, 0, -6 * c), 'head': (-4, 0, 4 * c),
        'upperarm.L': (-18 * c, 0, 4), 'upperarm.R': (18 * c, 0, -4),
        'forearm.L': (14 + 12 * max(0, -c), 0, 0), 'forearm.R': (14 + 12 * max(0, c), 0, 0),
        'loc': (0.02 * s, -0.025 * math.cos(2 * ph) - 0.01, 0),
    }

def idle(f):
    ph = (f % 60) / 60 * math.tau
    return {'chest': (1.5 * math.sin(ph), 0, 0), 'head': (-1, 2 * math.sin(ph * 0.5), 0), 'spine': (1, 0, 0),
            'upperarm.L': (2, 0, 6), 'upperarm.R': (2, 0, -6), 'forearm.L': (10, 0, 0), 'forearm.R': (10, 0, 0),
            'thigh.L': (0, 0, 1.5), 'thigh.R': (0, 0, -1.5), 'loc': (0.012 * math.sin(ph), 0, 0)}

def sit(f):
    k = min(1.0, f / 24)
    k = k * k * (3 - 2 * k)
    return {'thigh.L': (85 * k, 0, 0), 'thigh.R': (85 * k, 0, 0), 'shin.L': (-88 * k, 0, 0), 'shin.R': (-88 * k, 0, 0),
            'foot.L': (10 * k, 0, 0), 'foot.R': (10 * k, 0, 0), 'spine': (-6 * k, 0, 0), 'head': (4 * k, 0, 0),
            'upperarm.L': (30 * k, 0, 8), 'upperarm.R': (30 * k, 0, -8), 'forearm.L': (40 * k, 0, 0), 'forearm.R': (40 * k, 0, 0),
            'loc': (0, -0.42 * k, 0.12 * k)}

action('walk', range(0, 31, 3), walk)
action('idle', range(0, 61, 10), idle)
action('sit', range(0, 31, 6), sit, cyclic=False)
rig.animation_data.action = bpy.data.actions['idle']

if a['preview']:
    import surfacing as sf
    rig.animation_data.action = bpy.data.actions['walk']
    bpy.context.scene.frame_set(int(os.environ.get('PZ_FRAME', '8')))
    sf.preview(a['preview'], [body], size=(700, 700), samples=24, ground='#15131c', azimuth=float(os.environ.get('PZ_AZ', '-70')), elevation=6, distance=4.2)
if a['out']:
    bpy.ops.export_scene.gltf(filepath=a['out'], export_format='GLB', export_yup=True, export_apply=False, export_cameras=False, export_lights=False,
                              export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_def_bones=False, export_optimize_animation_size=True)
    print(f'PZ-WROTE {a["out"]}')
