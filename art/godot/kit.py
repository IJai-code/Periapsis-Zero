"""A small hard-surface kit for building ships in Blender from code.

Blender is Z-up; ships point their nose along +Y, which Godot reads as -Z.
Every object is one part with one material name: Godot turns the names into
real materials (game/scripts/art/surfaces.gd) and can fling the parts apart
when a ship is destroyed. Parts are never joined across materials.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

V = Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


_mats = {}


def material(name):
    if name not in _mats:
        _mats[name] = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    return _mats[name]


def part(name, bm, mat, bevel=0.0, segments=2, angle=35.0, parent=None):
    """Turn a bmesh into an object: one material, bevelled edges, crisp normals."""
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for m in (mat if isinstance(mat, (list, tuple)) else [mat]):
        me.materials.append(material(m))
    if bevel > 0.0:
        m = o.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = segments
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(angle)
        m.harden_normals = True
    w = o.modifiers.new('normals', 'WEIGHTED_NORMAL')
    w.keep_sharp = True
    for p in me.polygons:
        p.use_smooth = True
    if parent is not None:
        o.parent = parent
    return o


def apply_all(o):
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


def loft(bm, sections, cap_start=True, cap_end=True):
    """Bridge rings of points (all the same count, in order) into a skin."""
    rings = [[bm.verts.new(V(p)) for p in ring] for ring in sections]
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_start:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return rings


def lathe(bm, profile, segments=32, at=V((0, 0, 0)), axis='Y', cap_start=True, cap_end=True):
    """Spin a profile of (radius, along) points round an axis through `at`."""
    rings = []
    for r, t in profile:
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments
            c, s = math.cos(a) * r, math.sin(a) * r
            if axis == 'Y':
                ring.append(at + V((c, t, s)))
            elif axis == 'X':
                ring.append(at + V((t, c, s)))
            else:
                ring.append(at + V((c, s, t)))
        rings.append(ring)
    return loft(bm, rings, cap_start, cap_end)


def box(bm, centre, size, rot=None):
    r = bmesh.ops.create_cube(bm, size=1.0)
    m = Matrix.Translation(V(centre)) @ (rot or Matrix.Identity(3)).to_4x4() @ Matrix.Diagonal((*size, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    return r['verts']


def cylinder(bm, a, b, r, segments=16, r2=None):
    a, b = V(a), V(b)
    d = b - a
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=res['verts'])
    return res['verts']


def sphere(bm, centre, r, segments=16, scale=(1, 1, 1)):
    res = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(6, segments // 2), radius=r)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(V(centre)) @ Matrix.Diagonal((*scale, 1.0)), verts=res['verts'])
    return res['verts']


def facet(w, h, top=0.36, shoulder=0.22, belly=0.34, z=0.0, keel=0.0):
    """A faceted fuselage section (x, z), eight points: flat-ish belly, angled
    flanks, a narrow spine. `keel` drops the belly's centre for a V hull."""
    return [(-belly * w, z - h / 2), (belly * w, z - h / 2 - keel * 0), (w / 2, z - h * 0.12), (w * 0.44, z + h * shoulder),
            (top * w / 2, z + h / 2), (-top * w / 2, z + h / 2), (-w * 0.44, z + h * shoulder), (-w / 2, z - h * 0.12)]


def ring_y(points, y):
    return [V((x, y, z)) for x, z in points]


def chamfer_rect(w, h, c, z=0.0):
    return [(-w / 2 + c, z - h / 2), (w / 2 - c, z - h / 2), (w / 2, z - h / 2 + c), (w / 2, z + h / 2 - c),
            (w / 2 - c, z + h / 2), (-w / 2 + c, z + h / 2), (-w / 2, z + h / 2 - c), (-w / 2, z - h / 2 + c)]


class Surface:
    """Ray-cast onto finished parts, to stand details on their skin."""

    def __init__(self, objects):
        dg = bpy.context.evaluated_depsgraph_get()
        self.trees = []
        for o in objects:
            e = o.evaluated_get(dg)
            me = e.to_mesh()
            bm = bmesh.new()
            bm.from_mesh(me)
            bm.transform(o.matrix_world)
            self.trees.append(BVHTree.FromBMesh(bm))
            bm.free()
            e.to_mesh_clear()

    def hit(self, origin, direction):
        best = None
        for t in self.trees:
            loc, nrm, _, dist = t.ray_cast(V(origin), V(direction).normalized())
            if loc is not None and (best is None or dist < best[2]):
                best = (loc, nrm, dist)
        return best


def frame_from_normal(n, forward=V((0, 1, 0))):
    """A rotation whose Z is the surface normal and whose Y leans forward."""
    n = V(n).normalized()
    x = forward.cross(n)
    if x.length < 1e-4:
        x = V((1, 0, 0))
    x.normalize()
    y = n.cross(x).normalized()
    return Matrix((x, y, n)).transposed()


def plates(bm, surf, points, size, lift=0.012, thick=0.05, direction=None):
    """Armour plates stood on the skin at each (x, y, z) ray origin, cast
    toward `direction` (or the hull's axis)."""
    for p in points:
        o = V(p)
        d = V(direction) if direction else V((-o.x, 0, -o.z))
        h = surf.hit(o, d)
        if not h:
            continue
        loc, nrm, _ = h
        rot = frame_from_normal(nrm)
        box(bm, loc + nrm * (lift + thick / 2), (size[0], size[1], thick), rot)


def greeble(bm, surf, origin, direction, kind, scale=1.0, rng=random):
    """One small machine on the skin: a vent, a box, a dome or an antenna."""
    h = surf.hit(origin, direction)
    if not h:
        return
    loc, nrm, _ = h
    rot = frame_from_normal(nrm)
    s = scale
    if kind == 'vent':
        box(bm, loc + nrm * 0.03 * s, (0.5 * s, 0.7 * s, 0.06 * s), rot)
        for k in range(5):
            box(bm, loc + nrm * 0.07 * s + rot @ V((0, (-0.28 + k * 0.14) * s, 0)), (0.44 * s, 0.05 * s, 0.04 * s), rot)
    elif kind == 'box':
        box(bm, loc + nrm * 0.08 * s, (rng.uniform(0.2, 0.5) * s, rng.uniform(0.2, 0.6) * s, 0.16 * s), rot)
    elif kind == 'dome':
        sphere(bm, loc, 0.16 * s, 12, (1, 1, 0.7))
    elif kind == 'antenna':
        cylinder(bm, loc, loc + nrm * 0.9 * s, 0.012 * s, 6)
        sphere(bm, loc + nrm * 0.9 * s, 0.025 * s, 6)
    elif kind == 'pipe':
        a = loc + nrm * 0.06 * s
        cylinder(bm, a - rot @ V((0, 0.6 * s, 0)), a + rot @ V((0, 0.6 * s, 0)), 0.04 * s, 8)


def mirror_copy(o, name):
    """A separate mirrored twin (left from right), its own part."""
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    bpy.context.collection.objects.link(c)
    c.data.transform(Matrix.Scale(-1, 4, V((1, 0, 0))))
    c.data.flip_normals()
    return c


def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_extras=False, export_animations=False)


def panel_skin(bm, surf, origins, size, gap=0.05, thick=0.04, lift=0.004):
    """Cover a part in plates with real gaps between them: each origin casts at
    the hull's axis (or straight down/up for flat parts) and lays one plate
    `size` minus the gap. The dark part beneath shows in the seams."""
    for o, d in origins:
        h = surf.hit(o, d)
        if not h:
            continue
        loc, nrm, _ = h
        rot = frame_from_normal(nrm)
        box(bm, loc + nrm * (lift + thick / 2), (size[0] - gap, size[1] - gap, thick), rot)


def around(y_values, angles_deg, radius=6.0, zc=0.3):
    """Ray origins circling the Y axis, aimed at it: for panelling a fuselage."""
    out = []
    for y in y_values:
        for a in angles_deg:
            r = math.radians(a)
            o = V((math.sin(r) * radius, y, zc + math.cos(r) * radius))
            out.append((o, V((-math.sin(r), 0, -math.cos(r)))))
    return out


def frange(a, b, step):
    out = []
    x = a
    while (step > 0 and x <= b + 1e-6) or (step < 0 and x >= b - 1e-6):
        out.append(x)
        x += step
    return out


def densify(points, step):
    """A closed polygon with extra points so no edge is longer than `step`."""
    out = []
    n = len(points)
    for i in range(n):
        a, b = V(points[i]), V(points[(i + 1) % n])
        k = max(1, int(math.ceil((b - a).length / step)))
        for j in range(k):
            out.append(tuple(a.lerp(b, j / k)))
    return out


def stations(keys, step):
    """Key stations (y, *params), linearly filled in every `step` along y."""
    out = []
    for a, b in zip(keys, keys[1:]):
        k = max(1, int(math.ceil(abs(b[0] - a[0]) / step)))
        for j in range(k):
            t = j / k
            out.append(tuple(x + (y - x) * t for x, y in zip(a, b)))
    out.append(keys[-1])
    return out


def panelize(bm, inset=0.035, depth=-0.018, seam=1, alt=None, alt_ratio=0.0, rng=None, skip=None, paint=None):
    """Cut panel seams into a skin: every face becomes a panel, inset and
    with its border sunk, the border on material `seam`. Some panels can
    take material `alt` for a two-tone, worked look."""
    faces = [f for f in bm.faces if not (skip and skip(f))]
    res = bmesh.ops.inset_individual(bm, faces=faces, thickness=inset, depth=depth, use_even_offset=True)
    for f in res['faces']:
        f.material_index = seam
    if paint is not None:
        # A livery: the panel's material from where it is (centre and normal).
        for f in faces:
            f.material_index = paint(f.calc_center_median(), f.normal)
    elif alt is not None and rng is not None:
        for f in faces:
            if rng.random() < alt_ratio:
                f.material_index = alt
