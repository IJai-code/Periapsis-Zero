"""The Aster's crew corridor, deck 2: the first place a player stands.

    blender -b --factory-startup --python art/godot/aster_corridor.py -- game/art/aster_corridor.glb

A freighter corridor built like one: a chamfered pressure hull, structural
frames every two metres, wall and ceiling panels set between them, pipe runs
in the upper corners, handrails, a deck of grating over a lit service trench,
bulkheads at both ends and one window on the port side looking at Earth.

No UVs and no textures: every surface is named for a material
(game/scripts/art/surfaces.gd), which Godot draws triplanar from ambientCG's
CC0 maps, so texel density is the same everywhere without unwrapping.
Blender is Z-up and the corridor runs along +Y; in Godot it runs along -Z.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index('--') + 1]

W = 1.4            # half width
H = 2.9            # floor of the trench to the ceiling
TOP = 0.55         # upper chamfer
LOW = 0.3          # lower chamfer
BAY = 2.0          # frame spacing
BAYS = 8
LEN = BAY * BAYS
DECK = 0.25        # walking surface above the trench floor
WINDOW_BAY = 5     # port-side window, counted from the start

PROFILE = [(-W, LOW), (-W + LOW, 0.0), (W - LOW, 0.0), (W, LOW), (W, H - TOP), (W - TOP, H), (-W + TOP, H), (-W, H - TOP)]
CENTRE = Vector((0.0, H / 2))

bpy.ops.wm.read_factory_settings(use_empty=True)
mats = {}


def mat(name):
    if name not in mats:
        mats[name] = bpy.data.materials.new(name)
    return mats[name]


def obj(name, bm, material, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(mat(material))
    for p in me.polygons:
        p.use_smooth = False
    if bevel:
        m = o.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
        m.harden_normals = True
    return o


def inset(poly, d):
    """Offset a convex polygon (x, z) inward by d."""
    n = len(poly)
    lines = []
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))
        if nrm.dot(CENTRE - (a + b) / 2) < 0:
            nrm = -nrm
        lines.append((a + nrm * d, t))
    out = []
    for i in range(n):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        # p1 + s t1 = p2 + u t2
        det = t1.x * (-t2.y) - t1.y * (-t2.x)
        s = ((p2.x - p1.x) * (-t2.y) - (p2.y - p1.y) * (-t2.x)) / det
        out.append(tuple(p1 + t1 * s))
    return out


def v3(p, y):
    return Vector((p[0], y, p[1]))


def face_inward(bm):
    for f in bm.faces:
        c = f.calc_center_median()
        to_axis = Vector((0.0, c.y, CENTRE.y)) - c
        to_axis.y = 0.0
        if f.normal.dot(to_axis) < 0:
            f.normal_flip()


def box(bm, centre, size, basis=Matrix.Identity(3)):
    """Add a box to bm: size in the basis' own axes, then rotated and placed."""
    r = bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Translation(centre) @ basis.to_4x4() @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])


def cylinder(bm, a, b, r, segments=16):
    d = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r, depth=d.length)
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=res['verts'])


def edge_frame(i, poly=PROFILE):
    """Basis for profile edge i: along the edge, along the corridor, inward."""
    a, b = Vector(poly[i]), Vector(poly[(i + 1) % len(poly)])
    t = (b - a)
    nrm = Vector((-t.y, t.x)).normalized()
    if nrm.dot(CENTRE - (a + b) / 2) < 0:
        nrm = -nrm
    along = Vector((t.x, 0.0, t.y)).normalized()
    inward = Vector((nrm.x, 0.0, nrm.y))
    basis = Matrix((along, Vector((0.0, 1.0, 0.0)), inward)).transposed()
    return a, b, t.length, inward, basis


# The pressure hull: one surface, facing in, with the window cut out of it.
bm = bmesh.new()
loops = []
for k in range(BAYS + 1):
    loops.append([bm.verts.new(v3(p, k * BAY)) for p in PROFILE])
for k in range(BAYS):
    for i in range(len(PROFILE)):
        j = (i + 1) % len(PROFILE)
        bm.faces.new((loops[k][i], loops[k][j], loops[k + 1][j], loops[k + 1][i]))
face_inward(bm)
hull = obj('hull', bm, 'hull')

win_y = (WINDOW_BAY + 0.5) * BAY
cut = bmesh.new()
box(cut, Vector((-W, win_y, 1.55)), (0.6, 1.3, 1.0))
cutter = obj('cut', cut, 'hull')
b = hull.modifiers.new('window', 'BOOLEAN')
b.object = cutter
b.operation = 'DIFFERENCE'
b.solver = 'EXACT'
with bpy.context.temp_override(object=hull, active_object=hull):
    bpy.ops.object.modifier_apply(modifier='window')
bpy.data.objects.remove(cutter)

# Frames: a ring at every bay boundary, 14 cm deep into the corridor.
inner = inset(PROFILE, 0.14)
bm = bmesh.new()
for k in range(BAYS + 1):
    y = k * BAY
    o0 = [bm.verts.new(v3(p, y - 0.13)) for p in PROFILE]
    i0 = [bm.verts.new(v3(p, y - 0.13)) for p in inner]
    o1 = [bm.verts.new(v3(p, y + 0.13)) for p in PROFILE]
    i1 = [bm.verts.new(v3(p, y + 0.13)) for p in inner]
    n = len(PROFILE)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((o0[i], o0[j], i0[j], i0[i]))
        bm.faces.new((o1[j], o1[i], i1[i], i1[j]))
        bm.faces.new((i0[i], i0[j], i1[j], i1[i]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
obj('frames', bm, 'frame', bevel=0.02)

# Panels between the frames: plated walls, pale ceiling panels, the window
# bay left open. Profile edges: 0 lower-left chamfer, 1 trench floor,
# 2 lower-right chamfer, 3 right wall, 4 upper-right chamfer, 5 ceiling,
# 6 upper-left chamfer, 7 left wall.
walls, ceiling = bmesh.new(), bmesh.new()
for k in range(BAYS):
    y = (k + 0.5) * BAY
    for i in (3, 4, 6, 7):
        if i == 7 and k == WINDOW_BAY:
            continue
        a, bb, length, inward, basis = edge_frame(i)
        mid = v3(tuple((a + bb) / 2), y) + inward * 0.03
        target = walls if i in (3, 7) else ceiling
        # Walls are two panels, upper and lower; chamfers one.
        if i in (3, 7):
            lo = DECK + 0.05
            for z0, z1 in ((lo, 1.0), (1.1, H - TOP - 0.05)):
                c = Vector((mid.x, y, (z0 + z1) / 2))
                box(target, c, (z1 - z0, BAY - 0.4, 0.04), basis)
        else:
            box(target, mid, (length - 0.12, BAY - 0.4, 0.04), basis)
    # The ceiling: a light strip down the middle between two pale panels.
    a, bb, length, inward, basis = edge_frame(5)
    for x in (-0.55, 0.55):
        box(ceiling, Vector((x, y, H - 0.03)), (0.55, BAY - 0.4, 0.04), basis)
obj('walls', walls, 'wall', bevel=0.012)
obj('ceiling', ceiling, 'panel', bevel=0.012)

lights = bmesh.new()
for k in range(BAYS):
    box(lights, Vector((0.0, (k + 0.5) * BAY, H - 0.06)), (0.32, BAY - 0.7, 0.05))
obj('lights', lights, 'light', bevel=0.01)

# The window: a heavy frame around the opening, and the pane.
fr = bmesh.new()
for dz, sz in ((1.05 - 0.06, 0.12), (2.05 + 0.06, 0.12)):
    box(fr, Vector((-W + 0.05, win_y, dz)), (0.16, 1.54, sz))
for dy in (-0.71, 0.71):
    box(fr, Vector((-W + 0.05, win_y + dy, 1.55)), (0.16, 0.12, 1.24))
obj('window_frame', fr, 'frame', bevel=0.015)
gl = bmesh.new()
box(gl, Vector((-W - 0.02, win_y, 1.55)), (0.02, 1.32, 1.02))
obj('window_glass', gl, 'glass')

# Pipe runs in both upper chamfers, clamped at every frame.
pipes = {'pipe_ember': bmesh.new(), 'pipe_steel': bmesh.new(), 'pipe_ion': bmesh.new()}
clamps = bmesh.new()
for side in (-1, 1):
    a, bb, length, inward, basis = edge_frame(4 if side > 0 else 6)
    mid = (a + bb) / 2
    for off, r, name in ((-0.16, 0.055, 'pipe_steel'), (0.0, 0.04, 'pipe_ember' if side < 0 else 'pipe_ion'), (0.15, 0.06, 'pipe_steel')):
        along = (bb - a).normalized()
        p = mid + along * off
        pos = Vector((p.x, 0.0, p.y)) + inward * (0.06 + r)
        cylinder(pipes[name], Vector((pos.x, 0.05, pos.z)), Vector((pos.x, LEN - 0.05, pos.z)), r)
    for k in range(BAYS + 1):
        c = Vector((mid.x, k * BAY, mid.y)) + inward * 0.1
        box(clamps, c, (length - 0.1, 0.06, 0.05), basis)
for name, bmp in pipes.items():
    obj(name, bmp, name)
obj('clamps', clamps, 'trim', bevel=0.008)

# Handrails at hip height, on brackets at every frame.
rails = bmesh.new()
for side in (-1, 1):
    x = side * (W - 0.12)
    cylinder(rails, Vector((x, 0.1, 1.05)), Vector((x, LEN - 0.1, 1.05)), 0.024)
    for k in range(BAYS + 1):
        box(rails, Vector((side * (W - 0.07), k * BAY, 1.05)), (0.1, 0.04, 0.04))
obj('rails', rails, 'trim')

# The deck: grating over the trench in the middle, plate either side.
deck, grate = bmesh.new(), bmesh.new()
for k in range(BAYS):
    y = (k + 0.5) * BAY
    box(grate, Vector((0.0, y, DECK)), (1.5, BAY - 0.02, 0.03))
    for side in (-1, 1):
        box(deck, Vector((side * 1.05, y, DECK - 0.01)), (0.6, BAY - 0.02, 0.05))
obj('deck', deck, 'floor', bevel=0.006)
obj('grate', grate, 'grate')

trench = bmesh.new()
for x in (-0.35, 0.2):
    cylinder(trench, Vector((x, 0.05, 0.1)), Vector((x, LEN - 0.05, 0.1)), 0.07)
obj('trench_pipes', trench, 'pipe_steel')
tl = bmesh.new()
box(tl, Vector((0.0, LEN / 2, 0.015)), (0.08, LEN - 0.2, 0.02))
obj('trench_light', tl, 'light_floor')

# Bulkheads at both ends: a plate with a door, the door in hazard trim.
for y, name in ((0.0, 'aft'), (LEN, 'fore')):
    bm = bmesh.new()
    verts = [bm.verts.new(v3(p, y)) for p in PROFILE]
    bm.faces.new(verts if name == 'fore' else list(reversed(verts)))
    o = obj(f'bulkhead_{name}', bm, 'hull')
    door = bmesh.new()
    sign = -1 if name == 'fore' else 1
    box(door, Vector((0.0, y + sign * 0.06, DECK + 1.05)), (1.1, 0.1, 2.1))
    obj(f'door_{name}', door, 'door', bevel=0.02)
    trim = bmesh.new()
    for x in (-0.65, 0.65):
        box(trim, Vector((x, y + sign * 0.1, DECK + 1.1)), (0.18, 0.16, 2.3))
    box(trim, Vector((0.0, y + sign * 0.1, DECK + 2.3)), (1.48, 0.16, 0.18))
    obj(f'doorframe_{name}', trim, 'hazard', bevel=0.015)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True,
                          export_cameras=False, export_lights=False, export_extras=False, export_animations=False)
print('corridor:', OUT, len(bpy.data.objects), 'objects')
