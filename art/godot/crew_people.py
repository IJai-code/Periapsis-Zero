"""The Reach's people, from Quaternius's Universal Base Characters and
Universal Animation Library (CC0, quaternius.com): a body, a hairstyle and
a beard, the library's animations renamed to what the game plays (idle,
talk, walk, run, sit, crouch...), and a mask painted into the vertex
colours so the game can dress each in their own flight suit (Person):
R is how much of a vertex is suit (not skin), G how much is boot.

    blender -b --factory-startup --python art/godot/crew_people.py -- art/sources/quaternius game/art/people

Writes game/art/people/q-<name>.gltf (+ .bin), sharing textures in tex/.
"""
import os
import sys

import bmesh
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
os.makedirs(OUT, exist_ok=True)
UBC = os.path.join(SRC, 'ubc', 'Universal Base Characters[Standard]')
BODY = os.path.join(UBC, 'Base Characters', 'Godot - UE')
HAIR = os.path.join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)')
UAL = os.path.join(SRC, 'ual', 'Animation Library[Standard]', 'Godot', 'AnimationLibrary_Godot_Standard.glb')

# Game name <- library animation.
ANIMS = {
    'idle': 'Idle_Loop', 'talk': 'Idle_Talking_Loop', 'walk': 'Walk_Loop', 'run': 'Jog_Fwd_Loop',
    'sprint': 'Sprint_Loop', 'crouch': 'Crouch_Idle_Loop', 'crouch_walk': 'Crouch_Fwd_Loop',
    'sit': 'Sitting_Idle_Loop', 'sit_talk': 'Sitting_Talking_Loop', 'jump': 'Jump_Loop',
    'swim': 'Swim_Fwd_Loop', 'swim_idle': 'Swim_Idle_Loop', 'work': 'Fixing_Kneeling',
    'interact': 'Interact', 'pickup': 'PickUp_Table', 'dance': 'Dance_Loop', 'climb': 'Push_Loop',
}
OUTFITS = os.path.join(SRC, 'outfits', 'Modular Character Outfits - Fantasy[Standard]', 'Exports', 'glTF (Godot-Unreal)', 'Outfits')
# name: (body, skin texture, [hair pieces], outfit)
PEOPLE = {
    'mara': ('Female', None, ['Hair_Buns', 'Eyebrows_Female'], 'Peasant'),
    'okafor': ('Male', None, ['Hair_Buzzed', 'Hair_Beard', 'Eyebrows_Regular'], 'Peasant'),
    'fen': ('Female', 'T_Superhero_Female_Light_BaseColor.png', ['Hair_Long', 'Eyebrows_Female'], 'Peasant'),
    'tull': ('Male', 'T_Superhero_Male_Ligh.png', ['Hair_Beard', 'Hair_Buzzed', 'Eyebrows_Regular'], 'Peasant'),
    'isa': ('Female', None, ['Hair_BuzzedFemale', 'Eyebrows_Female'], 'Ranger'),
    'renn': ('Female', 'T_Superhero_Female_Light_BaseColor.png', ['Hair_SimpleParted', 'Eyebrows_Female'], 'Ranger'),
    'vex': ('Female', 'T_Superhero_Female_Light_BaseColor.png', ['Hair_BuzzedFemale', 'Eyebrows_Female'], 'Ranger'),
    'pilot': ('Male', 'T_Superhero_Male_Ligh.png', ['Hair_SimpleParted', 'Eyebrows_Regular'], 'Ranger'),
    'hale': ('Male', 'T_Superhero_Male_Ligh.png', ['Hair_Beard', 'Hair_SimpleParted', 'Eyebrows_Regular'], 'Ranger'),
    'warden': ('Male', None, ['Hair_Buzzed', 'Eyebrows_Regular'], 'Peasant'),
}
# The library's rig (Rigify names) -> the body's (Unreal names).
MAP = {'DEF-hips': 'pelvis', 'DEF-spine.001': 'spine_01', 'DEF-spine.002': 'spine_02', 'DEF-spine.003': 'spine_03',
       'DEF-neck': 'neck_01', 'DEF-head': 'Head'}
for side, s in (('L', 'l'), ('R', 'r')):
    MAP.update({f'DEF-shoulder.{side}': f'clavicle_{s}', f'DEF-upper_arm.{side}': f'upperarm_{s}',
                f'DEF-forearm.{side}': f'lowerarm_{s}', f'DEF-hand.{side}': f'hand_{s}', f'DEF-thigh.{side}': f'thigh_{s}',
                f'DEF-shin.{side}': f'calf_{s}', f'DEF-foot.{side}': f'foot_{s}', f'DEF-toe.{side}': f'ball_{s}'})
    for f in ('index', 'middle', 'pinky', 'ring'):
        for k in (1, 2, 3):
            MAP[f'DEF-f_{f}.0{k}.{side}'] = f'{f}_0{k}_{s}'
    for k in (1, 2, 3):
        MAP[f'DEF-thumb.0{k}.{side}'] = f'thumb_0{k}_{s}'
SKIN = {'Head', 'neck_01', 'hand_l', 'hand_r'}
FINGERS = ('index_', 'middle_', 'pinky_', 'ring_', 'thumb_')
BOOT = {'foot_l', 'foot_r', 'ball_l', 'ball_r'}


def gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def retarget(src, tgt, action, name):
    """Bake `action` (on the library's rig `src`) onto `tgt`, bone by bone:
    each mapped bone takes the source bone's orientation in the world,
    corrected by the difference of the two rigs' rest poses; the hips also
    take its height, scaled to the body (and no drift across the ground)."""
    from mathutils import Matrix
    sc = bpy.context.scene
    src.animation_data_create()
    src.animation_data.action = action
    if hasattr(src.animation_data, 'action_slot') and action.slots:
        src.animation_data.action_slot = action.slots[0]
    f0, f1 = (int(round(x)) for x in action.frame_range)
    inv_map = {v: k for k, v in MAP.items()}
    sw, tw = src.matrix_world, tgt.matrix_world
    # Rest poses, world space; and the scale between the two hips.
    srest = {b.name: sw @ b.matrix_local for b in src.data.bones}
    trest = {b.name: tw @ b.matrix_local for b in tgt.data.bones}
    hs = srest['DEF-hips'].translation.z
    ht = trest['pelvis'].translation.z
    k = ht / hs if hs > 1e-4 else 1.0
    order = []
    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)
    for b in tgt.data.bones:
        if b.parent is None:
            walk(b)
    keys = {}
    hips = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        se = src.evaluated_get(dg)
        spose = {pb.name: sw @ pb.matrix for pb in se.pose.bones}
        tpose = {}
        for b in order:
            parent_rest = (tw @ b.parent.matrix_local) if b.parent else tw
            rest = trest[b.name]
            parent_pose = tpose[b.parent.name] if b.parent else tw
            rel = parent_rest.inverted() @ rest
            if b.name in inv_map and inv_map[b.name] in spose:
                sname = inv_map[b.name]
                want = spose[sname] @ (srest[sname].inverted() @ rest)
                basis = rel.inverted() @ parent_pose.inverted() @ want
                loc, rot, _ = basis.decompose()
                if b.name == 'pelvis':
                    hips.append((f, loc * k, rot))
                    basis = Matrix.Translation(loc * k) @ rot.to_matrix().to_4x4()
                else:
                    basis = rot.to_matrix().to_4x4()
                keys.setdefault(b.name, []).append((f, rot))
            else:
                basis = Matrix.Identity(4)
            tpose[b.name] = parent_pose @ rel @ basis
    act = bpy.data.actions.new(name)
    tgt.animation_data_create()
    tgt.animation_data.action = act
    for bname, frames in keys.items():
        pb = tgt.pose.bones[bname]
        pb.rotation_mode = 'QUATERNION'
        prev = None
        for f, q in frames:
            if prev is not None and prev.dot(q) < 0:
                q = -q
            prev = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f)
    # The hips: their path, less any drift from first frame to last.
    if hips:
        (fa, la, _), (fb, lb, _) = hips[0], hips[-1]
        pb = tgt.pose.bones['pelvis']
        for f, loc, _ in hips:
            t = (f - fa) / max(fb - fa, 1)
            drift = (lb - la) * t
            pb.location = loc - drift
            pb.keyframe_insert('location', frame=f)
    act.use_fake_user = True
    tgt.animation_data.action = None
    return act


def build(name, spec):
    body, skin_tex, pieces, outfit = spec
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # The outfit (with its hands) on its own rig: that rig is the person's.
    objs = gltf(os.path.join(OUTFITS, f'{body}_{outfit}.gltf'))
    arm = next(o for o in objs if o.type == 'ARMATURE')
    for o in objs:
        # (The ranger's hood hides the face and the hair: left off.)
        if o.type == 'MESH' and (o.name.startswith('Icosphere') or 'Hood' in o.name):
            bpy.data.objects.remove(o, do_unlink=True)
    head_at = (arm.matrix_world @ arm.data.bones['Head'].head_local)
    # The base body: only its head and neck, moved onto this rig's neck.
    bobjs = gltf(os.path.join(BODY, f'Superhero_{body}_FullBody.gltf'))
    barm = next(o for o in bobjs if o.type == 'ARMATURE')
    bhead = (barm.matrix_world @ barm.data.bones['Head'].head_local)
    shift = head_at - bhead
    for o in bobjs:
        if o.type != 'MESH':
            continue
        if o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        if len(o.data.polygons) > 5000:
            # The skin: keep what is the head's and the neck's.
            gn = {g.index: g.name for g in o.vertex_groups}
            bm = bmesh.new()
            bm.from_mesh(o.data)
            dl = bm.verts.layers.deform.active
            cut = []
            for v in bm.verts:
                w = {gn.get(k, ''): x for k, x in v[dl].items()}
                keep = w.get('Head', 0) + w.get('neck_01', 0)
                if keep < 0.5:
                    cut.append(v)
            bmesh.ops.delete(bm, geom=cut, context='VERTS')
            bm.to_mesh(o.data)
            bm.free()
            if skin_tex:
                for m in o.data.materials:
                    for nd in m.node_tree.nodes:
                        if nd.type == 'TEX_IMAGE' and nd.image and ('BaseColor' in nd.image.name or 'Dark' in nd.image.name):
                            nd.image = bpy.data.images.load(os.path.join(UBC, 'Base Characters', 'Textures', skin_tex))
        mw = o.matrix_world.copy()
        o.parent = arm
        o.matrix_world = mw
        o.location = o.location + (arm.matrix_world.inverted().to_3x3() @ shift)
        for mod in o.modifiers:
            if mod.type == 'ARMATURE':
                mod.object = arm
    bpy.data.objects.remove(barm, do_unlink=True)
    # Hair, beard, brows: rigged to the head, moved with it.
    for p in pieces:
        for o in gltf(os.path.join(HAIR, f'{p}.gltf')):
            if o.type == 'ARMATURE':
                for c in list(o.children):
                    if c.type == 'MESH':
                        mw = c.matrix_world.copy()
                        c.parent = arm
                        c.matrix_world = mw
                        c.location = c.location + (arm.matrix_world.inverted().to_3x3() @ shift)
                        for mod in c.modifiers:
                            if mod.type == 'ARMATURE':
                                mod.object = arm
                bpy.data.objects.remove(o, do_unlink=True)
    # The animations: the library's, baked onto this body's own rig.
    lib = gltf(UAL)
    src = next(o for o in lib if o.type == 'ARMATURE')
    lib_actions = {a.name: a for a in bpy.data.actions}
    keep = []
    for game, srcname in ANIMS.items():
        act = lib_actions.get(srcname) or next((a for n, a in lib_actions.items() if n.startswith(srcname)), None)
        if act is None:
            print('MISSING', srcname)
            continue
        keep.append(retarget(src, arm, act, game))
    for o in lib:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a not in keep:
            bpy.data.actions.remove(a)
    arm.animation_data_create()
    for a in keep:
        tr = arm.animation_data.nla_tracks.new()
        tr.name = a.name
        tr.strips.new(a.name, 0, a)
    arm.animation_data.action = None
    # Textures at 1K (a browser's share), written once beside all of them.
    for img in bpy.data.images:
        if img.size[0] > 1024:
            img.scale(1024, 1024 * img.size[1] // img.size[0])
    path = os.path.join(OUT, f'q-{name}.gltf')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLTF_SEPARATE', export_texture_dir='tex', export_yup=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_cameras=False, export_lights=False,
                              export_vertex_color='ACTIVE')
    print(f'PERSON {name}: {os.path.getsize(path) // 1024} KB, {len(keep)} animations')


for n, sp in PEOPLE.items():
    if len(args) > 2 and n not in args[2:]:
        continue
    build(n, sp)
