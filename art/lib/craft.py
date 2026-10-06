"""
The game's ships and stations, built from code.

    npm run art:build -- game-kestrel      (and game-mule, game-lance, ...)

Every builder works in the runtime's frame (three.js: metres, Y up, the nose
toward -Z) through `T()`, so the numbers here are the numbers the game uses:
a Kestrel's radius in src/game/core/ships.js is 9 m and it is 18 m long here.
Hulls are lofted from chamfered sections, the way a hard-surface modeller
blocks one out; wings and fins are extruded planforms; engines are lathed.
Materials are the procedural recipes in surfacing.py, baked to one atlas per
model, except lights and engine glow, which stay emissive so they shine.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pz  # noqa: E402
import surfacing as sf  # noqa: E402

T = pz.from_three


# --------------------------------------------------------------------------
# Geometry in the runtime's frame
# --------------------------------------------------------------------------

def _finish(obj, smooth=None):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    if smooth is not None:
        for p in obj.data.polygons:
            p.use_smooth = True
        obj.data.set_sharp_from_angle(angle=math.radians(smooth))
    return obj


def section(z, w, h, c=0.0, cx=0.0, cy=0.0):
    """A chamfered rectangle across the hull at station z: eight points."""
    c = min(c, w / 2 - 1e-3, h / 2 - 1e-3)
    hw, hh = w / 2, h / 2
    pts = [(-hw + c, hh), (hw - c, hh), (hw, hh - c), (hw, -hh + c), (hw - c, -hh), (-hw + c, -hh), (-hw, -hh + c), (-hw, hh - c)]
    return [(cx + x, cy + y, z) for x, y in pts]


def soften(obj, levels=1):
    """Subdivide once: a hull of chamfered sections becomes a curved one,
    and the ends stay where they were (the cage keeps its corners)."""
    mod = obj.modifiers.new('soft', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(50))
    return obj


def loft(name, secs, mat, smooth=38, cap=True, soft=False):
    """A hull through a list of (z, w, h, chamfer, cx, cy) sections, nose to tail.
    `soft` subdivides it into a curved surface."""
    rings = [section(*s) for s in secs]
    n = len(rings[0])
    verts = [T(*p) for r in rings for p in r]
    faces = []
    for j in range(len(rings) - 1):
        for i in range(n):
            a, b = j * n + i, j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap:
        faces.append(tuple(range(n)))
        faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    obj = _finish(pz._object(name, verts, faces, mat), smooth)
    return soften(obj) if soft else obj


def vent(m, name, x, y, z, w, length, slats=5, up=True):
    """A grille: a dark recess with metal slats across it."""
    box(f'{name}_well', (w, 0.12, length), (x, y, z), m['dark'])
    for i in range(slats):
        box(f'{name}_slat{i}', (w * 0.92, 0.1, length / slats * 0.35), (x, y + (0.08 if up else -0.08), z - length / 2 + (i + 0.5) * length / slats), m['metal'])


def dome(m, name, at, r):
    """A sensor dome."""
    x, y, z = at
    return pz.sphere(name, tuple(T(x, y, z)), r, m['glass'], segments=16, rings=8, z_cut=0.0)


def hatch(m, name, x, y, z, w, length):
    """A raised hatch plate with a seam."""
    box(f'{name}', (w, 0.08, length), (x, y, z), m['trim'], chamfer=0.03)


def slab(name, plan, y, thick, mat, smooth=None, taper=1.0):
    """A wing, fin or plate: a planform of (x, z) points extruded thick in Y.
    `taper` thins the far edge (the last half of the points) for a wing's edge."""
    n = len(plan)
    top = [T(x, y + thick / 2 * (taper if i >= n // 2 else 1), z) for i, (x, z) in enumerate(plan)]
    bot = [T(x, y - thick / 2 * (taper if i >= n // 2 else 1), z) for i, (x, z) in enumerate(plan)]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return _finish(pz._object(name, top + bot, faces, mat), smooth)


def fin(name, plan_yz, x, thick, mat):
    """A vertical fin: a planform of (y, z) points extruded thick in X."""
    n = len(plan_yz)
    a = [T(x - thick / 2, y, z) for y, z in plan_yz]
    b = [T(x + thick / 2, y, z) for y, z in plan_yz]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return _finish(pz._object(name, a + b, faces, mat))


def lathe_z(name, profile, mat, x=0.0, y=0.0, seg=24, cap0=False, cap1=False, smooth=40):
    """Revolve (radius, z) pairs about a line parallel to the runtime's Z axis."""
    verts = []
    for r, z in profile:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(T(x + r * math.cos(a), y + r * math.sin(a), z))
    faces = []
    for j in range(len(profile) - 1):
        for i in range(seg):
            a, b = j * seg + i, j * seg + (i + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    if cap0:
        faces.append(tuple(range(seg)))
    if cap1:
        faces.append(tuple(range((len(profile) - 1) * seg, len(profile) * seg)))
    return _finish(pz._object(name, verts, faces, mat), smooth)


def lathe_y(name, profile, mat, x=0.0, y=0.0, z=0.0, seg=24, smooth=40):
    """Revolve (radius, height) pairs about a vertical line through (x, z), from height y."""
    verts = []
    for r, h in profile:
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(T(x + r * math.cos(a), y + h, z + r * math.sin(a)))
    faces = []
    for j in range(len(profile) - 1):
        for i in range(seg):
            a, b = j * seg + i, j * seg + (i + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    return _finish(pz._object(name, verts, faces, mat), smooth)


def box(name, size, centre, mat, chamfer=0.0):
    """An axis-aligned box in the runtime's frame."""
    sx, sy, sz = size
    return pz.box(name, (sx, sz, sy), tuple(T(*centre)), mat, chamfer=chamfer)


def tube(name, a, b, r, mat, seg=10):
    return pz.tube(name, tuple(T(*a)), tuple(T(*b)), r, mat, segments=seg)


def torus(name, R, r, mat, z=0.0, seg=96, rseg=20, smooth=60):
    """A ring about the runtime's Z axis."""
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            rr = R + r * math.cos(b)
            verts.append(T(rr * math.cos(a), rr * math.sin(a), z + r * math.sin(b)))
    faces = []
    for i in range(seg):
        for j in range(rseg):
            a = i * rseg + j
            b = i * rseg + (j + 1) % rseg
            c = ((i + 1) % seg) * rseg + (j + 1) % rseg
            d = ((i + 1) % seg) * rseg + j
            faces.append((a, b, c, d))
    return _finish(pz._object(name, verts, faces, mat), smooth)


def nozzle(m, name, x, y, z, r, length):
    """An engine: a lathed bell opening toward +Z, a glowing throat inside."""
    lathe_z(name, [(r * 0.55, z), (r * 0.6, z + length * 0.25), (r * 0.8, z + length * 0.6), (r, z + length)], m['nozzle'], x, y, seg=24)
    lathe_z(f'{name}_glow', [(0.0, z + length * 0.15), (r * 0.55, z + length * 0.16)], m['glow'], x, y, seg=24)
    lathe_z(f'{name}_collar', [(r * 0.62, z - length * 0.35), (r * 0.7, z - length * 0.3), (r * 0.7, z), (r * 0.58, z + 0.02)], m['dark'], x, y, seg=24, cap0=True)
    return (x, y, z + length)


def light(m, name, at, size=0.25, kind='lights'):
    return box(name, (size, size, size), at, m[kind])


def emissive(name, hex_colour, strength):
    mat = pz.material(name, hex_colour, roughness=0.4)
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    h = hex_colour.lstrip('#')
    rgb = [pz._srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    bsdf.inputs['Emission Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Emission Strength'].default_value = strength
    return mat


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

def palette(hull, trim, accent, dark='#2b2a33', glow='#ffb070', lights='#fff1d8'):
    m = {
        'hull': pz.material('hull', hull, roughness=0.5), 'trim': pz.material('trim', trim, roughness=0.45),
        'accent': pz.material('accent', accent, roughness=0.5), 'dark': pz.material('dark', dark, metallic=0.6, roughness=0.45),
        'metal': pz.material('metal', '#9a9ea3', metallic=0.9, roughness=0.32), 'glass': pz.material('glass', '#0c1822', metallic=0.3, roughness=0.06),
        'nozzle': pz.material('nozzle', '#4a4744', metallic=0.85, roughness=0.42, double_sided=True),
        'foil': pz.material('foil', '#c9973c', metallic=0.85, roughness=0.35), 'solar': pz.material('solar', '#1d2a4a', metallic=0.5, roughness=0.25),
        'glow': emissive('glow', glow, 6.0), 'lights': emissive('lights', lights, 8.0),
        'red': emissive('navred', '#ff3b2c', 6.0), 'green': emissive('navgreen', '#3bff8a', 6.0), 'ion': emissive('ion', '#2fd3ff', 5.0),
    }
    m['_spec'] = (hull, trim, accent, dark)
    return m


def surfaces(m, panel=1.1, dust=None):
    hull, trim, accent, dark = m['_spec']
    if m.get('_rock'):
        sf.surface(m['hull'], 'anodised', colour=hull)
    else:
        sf.surface(m['hull'], 'paint', colour=hull, panel=panel, rough=0.5)
    sf.surface(m['trim'], 'paint', colour=trim, panel=panel * 0.8, rough=0.42)
    sf.surface(m['accent'], 'paint', colour=accent, panel=panel * 1.4, rough=0.55)
    sf.surface(m['dark'], 'anodised', colour=dark)
    sf.surface(m['metal'], 'metal', colour='#a3a5a8', rough=0.32)
    sf.surface(m['glass'], 'glass')
    sf.surface(m['nozzle'], 'metal', colour='#55504a', rough=0.45)
    sf.surface(m['foil'], 'foil', colour='#c9973c')
    sf.surface(m['solar'], 'solar', cell=0.5 * panel)


KEEP = ('glow', 'lights', 'navred', 'navgreen', 'ion', 'pilotsuit', 'pilotvisor', 'pilotstripe', 'canopy', 'skyglass')


# --------------------------------------------------------------------------
# Detail: what makes a hull read as a machine up close
# --------------------------------------------------------------------------

def decal(m, name, text, at, size, side, mat='dark', depth=0.02):
    """Painted lettering on a side wall facing +x (side 1) or -x (side -1),
    reading forward on the right and aft on the left, as on an aircraft."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.extrude = depth
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = T(*at)
    ob.rotation_euler = (math.radians(90), 0, math.radians(90 if side > 0 else -90))
    with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
        bpy.ops.object.convert(target='MESH')
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ob = bpy.context.scene.objects[name]
    ob.data.materials.clear()
    ob.data.materials.append(m[mat])
    return ob


def greebles(m, name, x0, x1, y, z0, z1, n, seed=1, up=True):
    """Small machinery scattered over a flat patch: boxes, caps and pipes."""
    import random
    rnd = random.Random(seed)
    keys = ['metal', 'dark', 'trim', 'metal']
    for i in range(n):
        x = rnd.uniform(x0, x1); z = rnd.uniform(z0, z1)
        w = rnd.uniform(0.12, 0.45); d = rnd.uniform(0.15, 0.7); h = rnd.uniform(0.06, 0.22)
        mat = m[keys[i % len(keys)]]
        if i % 5 == 4:
            lathe_y(f'{name}{i}', [(0, h), (w * 0.5, h), (w * 0.5, 0)], mat, x, y if up else y - h, z, seg=10)
        else:
            box(f'{name}{i}', (w, h, d), (x, y + (h / 2 if up else -h / 2), z), mat, chamfer=min(w, h) * 0.2)


def rcs_quad(m, name, at, side):
    """A reaction-control block: four small bells, up, down, out and fore."""
    x, y, z = at
    box(f'{name}', (0.42, 0.42, 0.42), at, m['dark'], chamfer=0.06)
    for k, (dx, dy, dz) in enumerate([(side, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, -1)]):
        tube(f'{name}n{k}', (x + dx * 0.18, y + dy * 0.18, z + dz * 0.18), (x + dx * 0.36, y + dy * 0.36, z + dz * 0.36), 0.08, m['metal'], seg=8)


def pilot_seat(m, name, at, scale=1.0):
    """A pilot in the cockpit: seat, console, and a suited figure whose suit
    and visor keep their own materials, so the game can paint them in the
    colours the player chose."""
    x, y, z = at
    k = scale
    box(f'{name}seat', (0.7 * k, 0.12 * k, 0.7 * k), (x, y - 0.45 * k, z), m['dark'], chamfer=0.05)
    box(f'{name}back', (0.7 * k, 0.9 * k, 0.14 * k), (x, y, z + 0.38 * k), m['dark'], chamfer=0.05)
    box(f'{name}console', (1.1 * k, 0.3 * k, 0.5 * k), (x, y - 0.15 * k, z - 0.9 * k), m['dark'], chamfer=0.05)
    for i, kind in enumerate(('ion', 'lights', 'ion')):
        box(f'{name}screen{i}', (0.26 * k, 0.16 * k, 0.03 * k), (x + (i - 1) * 0.34 * k, y + 0.02 * k, z - 0.86 * k), m[kind])
    box(f'{name}torso', (0.55 * k, 0.55 * k, 0.36 * k), (x, y - 0.1 * k, z + 0.08 * k), m['pilotsuit'], chamfer=0.1 * k)
    pz.sphere(f'{name}helmet', tuple(T(x, y + 0.36 * k, z)), 0.22 * k, m['pilotsuit'], segments=20, rings=10)
    pz.sphere(f'{name}visor', tuple(T(x, y + 0.37 * k, z - 0.07 * k)), 0.18 * k, m['pilotvisor'], segments=20, rings=10)
    box(f'{name}stripe', (0.08 * k, 0.05 * k, 0.4 * k), (x, y + 0.58 * k, z + 0.02 * k), m['pilotstripe'])


def pilot_materials(m):
    m['pilotsuit'] = pz.material('pilotsuit', '#f4e8cf', roughness=0.55)
    m['pilotvisor'] = pz.material('pilotvisor', '#ffb070', metallic=0.6, roughness=0.08)
    m['pilotstripe'] = pz.material('pilotstripe', '#ff6b2c', roughness=0.5)
    # The canopy keeps its own material too: the game draws it see-through.
    m['canopy'] = pz.material('canopy', '#0c1822', metallic=0.3, roughness=0.06)


def missile_rail(m, name, x, y, z0, z1, n=2):
    """Missiles slung under a wing: a pylon and n rounds with coloured tips."""
    box(f'{name}pylon', (0.18, 0.3, z1 - z0), (x, y + 0.12, (z0 + z1) / 2), m['dark'])
    for i in range(n):
        dx = (i - (n - 1) / 2) * 0.42
        tube(f'{name}m{i}', (x + dx, y - 0.16, z0 + 0.4), (x + dx, y - 0.16, z1), 0.13, m['hull'], seg=10)
        tube(f'{name}t{i}', (x + dx, y - 0.16, z0), (x + dx, y - 0.16, z0 + 0.4), 0.11, m['accent'], seg=10)
        for f in (-1, 1):
            box(f'{name}f{i}{f}', (0.02, 0.22, 0.3), (x + dx + f * 0.12, y - 0.16, z1 - 0.15), m['dark'])


# --------------------------------------------------------------------------
# Ships
# --------------------------------------------------------------------------

def kestrel():
    """The starter: a light freighter, 18 m, two engines on short pylons."""
    m = palette('#d9d2c3', '#3a3946', '#ff6b2c')
    loft('fuselage', [(-9.0, 0.5, 0.4, 0.15, 0, -0.2), (-8.2, 1.3, 0.9, 0.4, 0, -0.1), (-7.0, 2.4, 1.7, 0.6, 0, 0), (-5.0, 3.3, 2.4, 0.8, 0, 0.1), (-1.0, 3.9, 2.8, 0.9, 0, 0.1),
                      (3.0, 4.1, 3.0, 0.9, 0, 0.0), (6.0, 3.6, 2.6, 0.8, 0, 0), (7.2, 3.0, 2.1, 0.6, 0, 0)], m['hull'], soft=True)
    loft('canopy', [(-7.3, 0.6, 0.2, 0.1, 0, 0.85), (-6.4, 1.6, 0.8, 0.35, 0, 1.2), (-4.2, 1.8, 0.95, 0.4, 0, 1.35), (-2.7, 1.3, 0.55, 0.3, 0, 1.25)], m['glass'], soft=True)
    loft('spine', [(-2.6, 1.0, 0.4, 0.15, 0, 1.45), (-1.6, 1.4, 0.7, 0.25, 0, 1.55), (5.5, 1.6, 0.8, 0.3, 0, 1.6), (6.9, 1.0, 0.4, 0.2, 0, 1.4)], m['trim'], soft=True)
    loft('belly', [(-4.5, 1.8, 0.4, 0.15, 0, -1.3), (-3.0, 2.6, 0.8, 0.25, 0, -1.5), (4.5, 3.0, 1.2, 0.35, 0, -1.6), (6.2, 2.2, 0.7, 0.25, 0, -1.4)], m['dark'], soft=True)
    loft('stripe', [(-8.0, 1.0, 0.1, 0.02, 0, 0.62), (-5.5, 2.2, 0.1, 0.02, 0, 1.1)], m['accent'])
    for s in (-1, 1):
        slab(f'wing{s}', [(s * 1.8, -2.5), (s * 8.4, 2.6), (s * 8.8, 4.6), (s * 1.8, 5.2)], -0.4, 0.45, m['trim'], taper=0.4)
        slab(f'stripe{s}', [(s * 6.8, 1.4), (s * 8.45, 2.75), (s * 8.7, 4.0), (s * 6.8, 3.2)], -0.4, 0.5, m['accent'])
        slab(f'flap{s}', [(s * 2.2, 4.4), (s * 7.6, 4.3), (s * 7.6, 4.9), (s * 2.2, 5.15)], -0.42, 0.3, m['dark'])
        fin(f'tipfin{s}', [(-0.2, 2.4), (1.9, 3.6), (1.9, 4.6), (-0.2, 4.7)], s * 8.6, 0.25, m['accent'])
        loft(f'nacelle{s}', [(-0.3, 1.2, 1.2, 0.4, s * 4.2, -0.2), (0.4, 1.9, 1.9, 0.6, s * 4.2, -0.2), (1.4, 2.3, 2.2, 0.7, s * 4.2, -0.2), (5.6, 2.4, 2.3, 0.7, s * 4.2, -0.2), (6.4, 2.0, 2.0, 0.6, s * 4.2, -0.2)], m['dark'], soft=True)
        lathe_z(f'intake{s}', [(0.0, -0.32), (0.55, -0.32), (0.6, -0.1)], m['metal'], s * 4.2, -0.2, seg=16)
        box(f'pylon{s}', (2.2, 0.5, 3.0), (s * 3.0, -0.25, 3.0), m['trim'], chamfer=0.1)
        nozzle(m, f'engine{s}', s * 4.2, -0.2, 6.3, 1.0, 1.3)
        vent(m, f'nvent{s}', s * 4.2, 0.95, 3.4, 0.9, 2.4, 6)
        light(m, f'nav{s}', (s * 8.8, -0.4, 4.4), 0.3, 'red' if s < 0 else 'green')
        box(f'rcs{s}', (0.5, 0.5, 0.7), (s * 2.0, 0.9, -5.4), m['metal'], chamfer=0.08)
        box(f'rcsB{s}', (0.4, 0.4, 0.5), (s * 2.1, 0.6, 5.6), m['metal'], chamfer=0.06)
        tube(f'gun{s}', (s * 2.3, -0.5, -4.6), (s * 2.3, -0.5, -1.0), 0.12, m['metal'])
    vent(m, 'spinevent', 0, 2.02, 2.6, 1.0, 2.6, 7)
    box('cargo', (3.0, 1.4, 3.6), (0, -2.0, 1.4), m['accent'], chamfer=0.18)
    box('cargoband', (3.08, 0.3, 0.3), (0, -1.95, 0.2), m['dark'])
    box('cargoband2', (3.08, 0.3, 0.3), (0, -1.95, 2.6), m['dark'])
    dome(m, 'sensor', (0, 1.75, 4.4), 0.4)
    tube('antenna', (0.6, 1.6, 2.0), (0.6, 3.0, 2.6), 0.05, m['metal'])
    light(m, 'beacon', (0, 2.0, 5.6), 0.3, 'lights')
    # Detail: the pilot under the glass, machinery on the spine, rings on
    # the nacelles, missiles under the wings, gear pods, lettering.
    pilot_materials(m)
    bpy.context.scene.objects['canopy'].data.materials[0] = m['canopy']
    pilot_seat(m, 'pilot', (0, 1.1, -4.7), 1.0)
    greebles(m, 'gspine', -0.55, 0.55, 1.98, -1.4, 1.2, 14, seed=3)
    for x in (-0.62, 0.62):
        tube(f'pipe{x}', (x, 1.92, -2.0), (x, 1.92, 5.6), 0.07, m['metal'], seg=8)
    for s in (-1, 1):
        for i, z in enumerate((1.0, 2.6, 4.9)):
            lathe_z(f'band{s}{i}', [(1.18, z - 0.12), (1.26, z - 0.08), (1.26, z + 0.08), (1.18, z + 0.12)], m['metal'], s * 4.2, -0.2, seg=24)
        missile_rail(m, f'rail{s}', s * 6.0, -0.75, 0.6, 3.2)
        rcs_quad(m, f'rcsq{s}', (s * 1.75, 0.2, -6.4), s)
        box(f'gear{s}', (0.8, 0.5, 1.8), (s * 1.3, -1.75, -3.2), m['dark'], chamfer=0.12)
        box(f'gearB{s}', (0.9, 0.5, 1.6), (s * 2.6, -1.1, 4.0), m['dark'], chamfer=0.12)
        decal(m, f'reg{s}', 'PZ-0911', (s * 5.43, 0.2, 2.4), 0.42, s, 'hull')
        box(f'heat{s}', (0.06, 0.9, 1.4), (s * 5.42, -0.2, 5.3), m['metal'])
        light(m, f'land{s}', (s * 1.3, -2.02, -4.0), 0.18, 'lights')
    decal(m, 'name', 'KESTREL', (1.53, -2.0, 1.4), 0.36, 1, 'dark')
    box('dish', (0.8, 0.06, 0.8), (-0.7, 2.05, 3.5), m['metal'], chamfer=0.1)
    tube('whip', (-0.6, 1.6, 6.2), (-0.6, 2.6, 6.8), 0.03, m['metal'], seg=6)
    return m, 0.75


def mule():
    """The hauler: a cab, a spine, six container bays, two big engines. 32 m."""
    m = palette('#5c6066', '#d9d2c3', '#ff6b2c', dark='#25242c')
    loft('cab', [(-16.0, 3.0, 2.4, 0.8, 0, 1.0), (-14.5, 6.0, 4.6, 1.4, 0, 1.0), (-11.0, 7.0, 5.4, 1.6, 0, 0.8), (-9.0, 6.4, 5.0, 1.4, 0, 0.6)], m['trim'], soft=True)
    loft('windscreen', [(-15.6, 3.6, 0.8, 0.3, 0, 3.0), (-13.8, 4.6, 1.2, 0.4, 0, 3.4), (-12.4, 4.2, 0.8, 0.3, 0, 3.4)], m['glass'], soft=True)
    loft('spine', [(-9.5, 3.0, 3.0, 0.6, 0, 0), (12.0, 3.0, 3.0, 0.6, 0, 0)], m['dark'])
    for i in range(3):
        for s in (-1, 1):
            z = -6.5 + i * 6.4
            box(f'pod{i}{s}', (5.0, 5.0, 5.8), (s * 4.2, 0.3, z), m['accent'] if (i + (s > 0)) % 2 else m['hull'], chamfer=0.25)
            box(f'rib{i}{s}', (5.4, 0.4, 0.5), (s * 4.2, 2.95, z), m['metal'])
    loft('aft', [(11.0, 7.2, 5.6, 1.4, 0, 0), (14.0, 8.0, 6.0, 1.6, 0, 0), (15.5, 7.0, 5.0, 1.4, 0, 0)], m['trim'], soft=True)
    for s in (-1, 1):
        nozzle(m, f'engine{s}', s * 2.4, 0, 15.2, 2.1, 3.0)
        fin(f'fin{s}', [(0, 10.5), (4.5, 13.5), (4.5, 15.0), (0, 15.2)], s * 3.4, 0.35, m['accent'])
        light(m, f'nav{s}', (s * 7.4, 0.3, 9.8), 0.4, 'red' if s < 0 else 'green')
        box(f'rcs{s}', (0.8, 0.8, 1.0), (s * 3.6, 2.2, -11.5), m['metal'])
    for s in (-1, 1):
        vent(m, f'cabvent{s}', s * 2.0, 3.65, -10.4, 1.4, 2.4, 6)
        tube(f'rail{s}', (s * 1.6, 1.6, -9.0), (s * 1.6, 1.6, 11.5), 0.15, m['metal'])
    dome(m, 'sensor', (0, 3.7, -12.0), 0.6)
    light(m, 'beacon', (0, 3.6, -10.0), 0.45, 'lights')
    for i in range(6):
        light(m, f'cabwin{i}', (-2.2 + i * 0.88, 2.2, -14.6), 0.35, 'lights')
    pilot_materials(m)
    bpy.context.scene.objects['windscreen'].data.materials[0] = m['canopy']
    pilot_seat(m, 'pilot', (0, 2.6, -13.2), 1.1)
    greebles(m, 'gspine', -1.3, 1.3, 1.52, -8.5, 11.0, 30, seed=5)
    for i in range(3):
        for s in (-1, 1):
            z = -6.5 + i * 6.4
            decal(m, f'pod{i}{s}tag', f'PZ {i * 2 + (s > 0) + 1:02d}', (s * 6.73, 0.9, z), 0.9, s, 'dark')
            for k in (-1, 1):
                box(f'latch{i}{s}{k}', (0.12, 0.6, 0.3), (s * 6.76, -1.0, z + k * 2.0), m['metal'])
    for s in (-1, 1):
        rcs_quad(m, f'rcsq{s}', (s * 3.4, 2.3, 12.4), s)
        for i, z in enumerate((14.4, 16.2)):
            lathe_z(f'band{s}{i}', [(2.0, z - 0.15), (2.2, z - 0.1), (2.2, z + 0.1), (2.0, z + 0.15)], m['metal'], s * 2.4, 0, seg=24)
        box(f'gear{s}', (1.2, 0.8, 2.4), (s * 2.0, -1.9, -11.5), m['dark'], chamfer=0.15)
        light(m, f'land{s}', (s * 2.0, -2.32, -12.4), 0.25, 'lights')
    decal(m, 'name', 'MULE', (3.65, 0.0, -10.4), 1.0, 1, 'accent')
    tube('mast', (0.8, 3.6, -9.6), (0.8, 6.0, -9.2), 0.06, m['metal'], seg=6)
    box('dish', (1.4, 0.08, 1.4), (-1.2, 3.75, -9.8), m['metal'], chamfer=0.2)
    return m, 1.1


def lance():
    """The interceptor: a needle nose, forward-swept wings, close-coupled engines. 20 m."""
    m = palette('#eef0f2', '#262632', '#2fd3ff')
    loft('fuselage', [(-10.0, 0.2, 0.2, 0.05, 0, 0), (-7.0, 1.4, 1.1, 0.4, 0, 0.1), (-3.0, 2.4, 1.8, 0.6, 0, 0.2), (2.0, 3.0, 2.0, 0.7, 0, 0.2), (6.6, 3.2, 1.8, 0.6, 0, 0.1), (8.2, 2.8, 1.6, 0.5, 0, 0.1)], m['hull'], soft=True)
    loft('canopy', [(-5.4, 0.6, 0.2, 0.1, 0, 0.9), (-4.2, 1.1, 0.7, 0.3, 0, 1.2), (-1.8, 1.0, 0.6, 0.25, 0, 1.15), (-0.6, 0.5, 0.2, 0.1, 0, 0.95)], m['glass'], soft=True)
    for s in (-1, 1):
        slab(f'wing{s}', [(s * 1.2, 1.0), (s * 9.6, -1.6), (s * 9.8, 0.2), (s * 1.2, 6.8)], 0.0, 0.35, m['trim'], taper=0.4)
        slab(f'edge{s}', [(s * 7.6, -1.0), (s * 9.65, -1.6), (s * 9.8, 0.1), (s * 7.6, 1.5)], 0.0, 0.4, m['accent'])
        fin(f'fin{s}', [(0.3, 4.5), (2.6, 7.0), (2.6, 8.0), (0.3, 8.1)], s * 1.7, 0.2, m['trim'])
        loft(f'nacelle{s}', [(1.0, 1.2, 1.2, 0.4, s * 1.6, -0.1), (2.0, 1.7, 1.6, 0.5, s * 1.6, -0.1), (7.6, 1.8, 1.6, 0.5, s * 1.6, -0.1)], m['dark'])
        nozzle(m, f'engine{s}', s * 1.6, -0.1, 7.6, 0.85, 1.1)
        tube(f'gun{s}', (s * 3.2, -0.2, -4.0), (s * 3.2, -0.2, 1.5), 0.13, m['metal'])
        light(m, f'nav{s}', (s * 9.8, 0, 0.0), 0.25, 'red' if s < 0 else 'green')
        box(f'stripe{s}', (0.15, 0.25, 9.0), (s * 1.25, 0.9, -1.0), m['ion'])
        vent(m, f'vent{s}', s * 1.6, 0.72, 4.2, 0.8, 2.0, 5)
    dome(m, 'sensor', (0, 1.0, 2.6), 0.32)
    pilot_materials(m)
    bpy.context.scene.objects['canopy'].data.materials[0] = m['canopy']
    pilot_seat(m, 'pilot', (0, 0.72, -3.0), 0.85)
    greebles(m, 'gback', -0.7, 0.7, 1.15, 0.2, 5.6, 12, seed=7)
    for s in (-1, 1):
        missile_rail(m, f'rail{s}', s * 5.2, -0.2, -0.2, 2.6, 2)
        rcs_quad(m, f'rcsq{s}', (s * 1.15, 0.1, -6.2), s)
        for i, z in enumerate((3.0, 5.0, 6.8)):
            lathe_z(f'band{s}{i}', [(0.92, z - 0.1), (0.98, z - 0.06), (0.98, z + 0.06), (0.92, z + 0.1)], m['metal'], s * 1.6, -0.1, seg=20)
        decal(m, f'reg{s}', 'PZ-L7', (s * 1.53, 0.1, -0.2), 0.36, s, 'trim')
        slab(f'canard{s}', [(s * 0.7, -6.4), (s * 2.6, -5.6), (s * 2.6, -5.1), (s * 0.7, -4.6)], 0.0, 0.12, m['trim'])
        light(m, f'land{s}', (s * 0.8, -0.95, -5.0), 0.15, 'lights')
    tube('probe', (0, 0, -10.0), (0, 0, -11.6), 0.05, m['metal'], seg=6)
    return m, 0.6


def raider():
    """A Hollow raider: scrap-built, asymmetric, one big engine. 14 m."""
    m = palette('#5a1e1e', '#2b2420', '#c9973c', dark='#1d1a1c', glow='#ff5a3a', lights='#ff7a4a')
    loft('body', [(-7.0, 0.6, 0.5, 0.15, 0, -0.1), (-5.0, 2.6, 1.4, 0.5, 0, 0), (0.0, 3.6, 2.2, 0.6, 0, 0.1), (4.5, 3.0, 2.0, 0.6, 0, 0), (6.0, 2.4, 1.8, 0.5, 0, 0)], m['hull'], soft=True)
    loft('hump', [(-3.5, 1.2, 0.6, 0.2, 0.6, 1.0), (1.5, 1.8, 1.2, 0.3, 0.6, 1.3), (4.0, 1.2, 0.6, 0.2, 0.6, 1.1)], m['trim'], smooth=20)
    slab('wingL', [(-1.6, -1.5), (-7.0, 1.5), (-7.4, 3.0), (-1.6, 3.5)], -0.2, 0.3, m['trim'])
    slab('wingR', [(1.6, -0.5), (6.2, 3.2), (6.0, 4.4), (1.6, 3.8)], 0.1, 0.3, m['dark'])
    slab('blade', [(-7.0, 1.5), (-8.2, -2.4), (-7.6, -2.6), (-6.8, 1.0)], -0.2, 0.25, m['accent'])
    slab('plate', [(-1.2, -4.6), (1.4, -4.2), (1.8, -1.4), (-1.6, -1.8)], 0.9, 0.2, m['accent'])
    fin('spike', [(0.8, 0.5), (3.2, 2.5), (3.4, 3.2), (0.8, 3.6)], 0.6, 0.2, m['dark'])
    loft('engine', [(3.5, 2.0, 2.0, 0.6, 0, 0), (6.4, 2.4, 2.3, 0.7, 0, 0)], m['dark'])
    nozzle(m, 'engine0', 0, 0, 6.3, 1.2, 1.4)
    box('gunpod', (0.8, 0.6, 4.0), (-2.6, -0.8, -3.0), m['metal'])
    light(m, 'eye', (0, 0.5, -5.6), 0.5, 'lights')
    for i, (x, z) in enumerate([(-3.4, 1.0), (3.6, 2.8), (0.5, -2.5)]):
        box(f'junk{i}', (0.9, 0.5, 1.2), (x, 0.9, z), m['metal'])
    # Scrap plating bolted over the hull, a glowing slit for a cockpit, pipes and clutter.
    for i, (x, z, w, l) in enumerate([(-0.9, -3.2, 1.1, 1.6), (0.9, -0.6, 1.2, 2.0), (-1.0, 2.2, 1.0, 1.8), (1.1, 3.6, 0.9, 1.2)]):
        box(f'plate{i}', (w, 0.08, l), (x, 1.12 - abs(z) * 0.02, z), m['metal'] if i % 2 else m['trim'], chamfer=0.03)
    box('slit', (1.2, 0.08, 0.18), (0, 0.78, -4.6), m['lights'])
    for s in (-1, 1):
        tube(f'pipe{s}', (s * 1.55, 0.2, -3.5), (s * 1.6, 0.4, 4.4), 0.09, m['metal'], seg=8)
        rcs_quad(m, f'rcsq{s}', (s * 1.6, -0.4, -4.4), s)
    greebles(m, 'gtop', -0.9, 0.9, 1.1, -1.0, 3.5, 10, seed=11)
    missile_rail(m, 'rail', -4.6, -0.55, 0.0, 2.4, 2)
    for i, z in enumerate((4.2, 5.6)):
        lathe_z(f'eband{i}', [(1.22, z - 0.1), (1.3, z - 0.06), (1.3, z + 0.06), (1.22, z + 0.1)], m['metal'], 0, 0, seg=20)
    decal(m, 'tagL', 'HOLLOW', (-1.83, 0.0, 0.8), 0.42, -1, 'accent')
    tube('whip', (0.4, 0.9, 3.2), (0.6, 2.2, 4.4), 0.03, m['metal'], seg=6)
    return m, 0.6


def warden():
    """The Warden's ship: a raider grown into a gunship. 28 m, three engines."""
    m = palette('#2a1414', '#4a1a1a', '#c9973c', dark='#131013', glow='#ff4a2a', lights='#ff6a3a')
    loft('body', [(-14.0, 1.0, 0.8, 0.3, 0, 0), (-10.0, 5.0, 2.8, 0.9, 0, 0), (-2.0, 7.4, 4.4, 1.0, 0, 0.3), (6.0, 7.0, 4.0, 1.0, 0, 0.2), (11.0, 6.0, 3.6, 0.9, 0, 0)], m['hull'], smooth=20)
    loft('bridge', [(-6.0, 2.4, 1.0, 0.4, 0, 2.6), (0.0, 3.4, 2.2, 0.6, 0, 3.0), (3.0, 2.6, 1.4, 0.5, 0, 2.8)], m['trim'], smooth=20)
    for s in (-1, 1):
        slab(f'wing{s}', [(s * 3.0, -4.0), (s * 14.0, 1.0), (s * 14.5, 4.0), (s * 3.0, 6.5)], -0.4, 0.6, m['trim'])
        slab(f'blade{s}', [(s * 14.0, 1.0), (s * 16.0, -6.0), (s * 15.2, -6.4), (s * 13.6, 0.4)], -0.4, 0.4, m['accent'])
        fin(f'horn{s}', [(1.0, -11.0), (4.0, -8.0), (4.0, -7.2), (1.0, -6.4)], s * 2.0, 0.3, m['accent'])
        nozzle(m, f'engine{s}', s * 3.2, 0, 11.0, 1.6, 2.2)
        box(f'cannon{s}', (1.0, 1.0, 7.0), (s * 5.4, -1.0, -6.0), m['metal'])
    nozzle(m, 'engine0', 0, 0.6, 11.0, 2.0, 2.6)
    for i in range(5):
        light(m, f'eye{i}', (-1.6 + i * 0.8, 3.4, -5.6), 0.45, 'lights')
    greebles(m, 'gback', -2.4, 2.4, 2.2, 2.0, 9.5, 26, seed=31)
    for s in (-1, 1):
        missile_rail(m, f'rail{s}', s * 9.5, -0.95, -1.0, 3.0, 3)
        rcs_quad(m, f'rcsq{s}', (s * 3.4, 1.0, -11.0), s)
        for k in range(3):
            box(f'armor{s}{k}', (0.12, 1.8, 3.0), (s * 3.62, 0.2, -4.0 + k * 4.0), m['metal'] if k % 2 else m['trim'], chamfer=0.05)
        for i, z in enumerate((11.6, 12.6)):
            lathe_z(f'eband{s}{i}', [(1.62, z - 0.12), (1.72, z - 0.08), (1.72, z + 0.08), (1.62, z + 0.12)], m['metal'], s * 3.2, 0, seg=24)
    decal(m, 'tag', 'WARDEN', (3.71, 0.4, 2.0), 0.9, 1, 'accent')
    return m, 1.0


def cutter():
    """A Lunar Compact patrol cutter: clean, white, a light bar. 22 m."""
    m = palette('#eef0f2', '#1f3a4e', '#2fd3ff', dark='#2a3036', glow='#9fe9ff')
    loft('fuselage', [(-11.0, 0.6, 0.5, 0.2, 0, 0), (-8.5, 2.6, 2.0, 0.7, 0, 0.1), (-3.0, 3.8, 2.8, 0.9, 0, 0.2), (4.0, 4.0, 2.8, 0.9, 0, 0.2), (9.0, 3.4, 2.4, 0.8, 0, 0.1), (10.4, 2.8, 2.0, 0.6, 0, 0)], m['hull'], soft=True)
    loft('canopy', [(-8.2, 1.0, 0.3, 0.1, 0, 1.0), (-6.6, 1.8, 0.9, 0.4, 0, 1.4), (-3.8, 1.8, 0.9, 0.4, 0, 1.5), (-2.6, 1.2, 0.4, 0.2, 0, 1.4)], m['glass'], soft=True)
    for s in (-1, 1):
        slab(f'wing{s}', [(s * 1.9, -1.0), (s * 6.8, 2.0), (s * 7.0, 5.6), (s * 1.9, 6.5)], -0.5, 0.45, m['hull'], taper=0.5)
        slab(f'band{s}', [(s * 4.0, 0.4), (s * 6.85, 2.2), (s * 6.95, 3.4), (s * 4.0, 2.2)], -0.5, 0.5, m['trim'])
        loft(f'pod{s}', [(2.0, 1.6, 1.6, 0.5, s * 2.6, -0.4), (9.0, 2.0, 2.0, 0.6, s * 2.6, -0.4)], m['dark'])
        nozzle(m, f'engine{s}', s * 2.6, -0.4, 9.0, 0.95, 1.4)
        light(m, f'nav{s}', (s * 7.0, -0.5, 4.0), 0.3, 'red' if s < 0 else 'green')
        box(f'bar{s}', (1.3, 0.3, 0.4), (s * 0.75, 1.75, 0.5), m['ion'] if s > 0 else m['red'])
    fin('fin', [(1.0, 4.0), (3.6, 7.6), (3.6, 9.2), (1.0, 9.4)], 0, 0.3, m['trim'])
    for s in (-1, 1):
        vent(m, f'vent{s}', s * 1.4, 1.62, 3.0, 0.9, 2.6, 6)
        tube(f'gun{s}', (s * 1.6, -1.2, -7.5), (s * 1.6, -1.2, -2.0), 0.14, m['metal'])
    dome(m, 'sensor', (0, -1.5, -4.0), 0.5)
    box('stripe', (4.05, 0.5, 1.0), (0, 0.2, -6.0), m['trim'])
    greebles(m, 'gtop', -0.9, 0.9, 1.62, -1.6, 1.4, 10, seed=21)
    for s in (-1, 1):
        rcs_quad(m, f'rcsq{s}', (s * 1.95, 0.3, -7.6), s)
        missile_rail(m, f'rail{s}', s * 4.8, -0.95, 0.8, 3.6, 2)
        decal(m, f'tag{s}', 'COMPACT', (s * 2.03, 0.3, -1.6), 0.5, s, 'trim')
        for i, z in enumerate((4.4, 6.6, 8.4)):
            lathe_z(f'pband{s}{i}', [(0.98, z - 0.1), (1.05, z - 0.06), (1.05, z + 0.06), (0.98, z + 0.1)], m['metal'], s * 2.6, -0.4, seg=20)
        light(m, f'land{s}', (s * 1.0, -1.45, -6.4), 0.18, 'lights')
    tube('mast', (0.5, 1.6, 6.2), (0.5, 3.0, 7.0), 0.04, m['metal'], seg=6)
    return m, 0.8


def freighter():
    """Traffic: a container freighter, 92 m: bridge, spine, twenty-four boxes, engine block."""
    m = palette('#bdb6a8', '#3a3d44', '#ff6b2c', dark='#25262b')
    loft('bridge', [(-47.0, 8.0, 5.0, 1.5, 0, 4.0), (-44.0, 14.0, 9.0, 2.5, 0, 3.0), (-38.0, 14.0, 9.0, 2.5, 0, 3.0)], m['hull'], soft=True)
    box('spine', (4.0, 4.0, 82.0), (0, 0, 2.0), m['dark'])
    colours = [m['accent'], m['hull'], m['trim'], m['accent'], m['trim'], m['hull']]
    for i in range(6):
        for s in (-1, 1):
            for t in (-1, 1):
                box(f'box{i}{s}{t}', (6.6, 6.6, 11.4), (s * 6.4, t * 6.4, -28.0 + i * 12.6), colours[(i * 3 + (s > 0) + 2 * (t > 0)) % 6], chamfer=0.2)
    loft('engines', [(39.0, 18.0, 14.0, 3.0, 0, 0), (45.0, 20.0, 15.0, 3.5, 0, 0), (48.0, 16.0, 12.0, 3.0, 0, 0)], m['trim'], soft=True)
    for s in (-1, 1):
        nozzle(m, f'engine{s}', s * 4.5, 0, 47.5, 3.4, 4.0)
        light(m, f'nav{s}', (s * 10.0, 0, 44.0), 0.9, 'red' if s < 0 else 'green')
    for i in range(10):
        light(m, f'win{i}', (-6.3 + i * 1.4, 6.0, -46.2), 0.7, 'lights')
    return m, 4.0


def canister():
    """A salvage canister: a 4.5 m drum with a lit band, so it can be found."""
    m = palette('#ff6b2c', '#d9d2c3', '#2b2a33')
    lathe_z('drum', [(0.0, -2.2), (1.4, -2.2), (1.6, -2.0), (1.6, 2.0), (1.4, 2.2), (0.0, 2.2)], m['hull'], seg=20)
    lathe_z('band', [(1.65, -0.3), (1.65, 0.3)], m['ion'], seg=20)
    for z in (-1.5, 1.5):
        lathe_z(f'rib{z}', [(1.62, z - 0.15), (1.7, z - 0.1), (1.7, z + 0.1), (1.62, z + 0.15)], m['dark'], seg=20)
    return m, 0.5


# --------------------------------------------------------------------------
# Stations. Docking ports must match src/game/core/world.js.
# --------------------------------------------------------------------------

def bay(m, z, w, h, depth):
    """A docking bay mouth on the +Z face: a frame, a recess, guide lights."""
    box('bay_back', (w, h, 2), (0, 0, z - depth), m['dark'])
    for s in (-1, 1):
        box(f'bay_side{s}', (6, h + 12, depth + 8), (s * (w / 2 + 3), 0, z - depth / 2 + 4), m['trim'])
        box(f'bay_lip{s}', (w + 18, 6, depth + 8), (0, s * (h / 2 + 3), z - depth / 2 + 4), m['trim'])
        for k in range(6):
            light(m, f'guide{s}{k}', (s * (w / 2 - 1), -h / 2 + 2, z - k * depth / 6), 1.6, 'lights')
            light(m, f'guideTop{s}{k}', (s * (w / 2 - 1), h / 2 - 2, z - k * depth / 6), 1.6, 'ion')


def hearth():
    """Hearth Station at L1: a hub, four spokes, a 760 m wheel turning for gravity."""
    m = palette('#d9d2c3', '#5c6066', '#ff6b2c', dark='#2b2a33')
    lathe_z('hub', [(0, -300), (60, -300), (95, -270), (110, -200), (110, 120), (100, 160), (90, 175)], m['hull'], seg=48, cap0=True, smooth=30)
    lathe_z('hubface', [(0, 175), (90, 175)], m['trim'], seg=48)
    lathe_z('collar', [(112, -60), (150, -50), (150, 50), (112, 60)], m['trim'], seg=48)
    torus('ring', 380, 40, m['hull'], seg=96, rseg=24)
    torus('ringbelt', 380, 41.5, m['trim'], seg=96, rseg=6)
    for i in range(48):
        a = 2 * math.pi * (i + 0.5) / 48
        r = 380 + 41.8
        light(m, f'win{i}', (math.cos(a) * r, math.sin(a) * r, 0), 7.0, 'lights')
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        tube(f'spoke{i}', (math.cos(a) * 140, math.sin(a) * 140, 0), (math.cos(a) * 345, math.sin(a) * 345, 0), 14, m['metal'], seg=12)
        tube(f'spoke2{i}', (math.cos(a) * 140, math.sin(a) * 140, 25), (math.cos(a) * 345, math.sin(a) * 345, 25), 6, m['dark'], seg=8)
    bay(m, 176, 110, 70, 40)
    # The power and heat farm aft: two solar wings and radiators on a truss.
    box('truss', (24, 24, 260), (0, 0, -420), m['metal'])
    for s in (-1, 1):
        box(f'solar{s}', (420, 3, 110), (s * 230, 0, -470), m['solar'])
        box(f'solarframe{s}', (430, 5, 6), (s * 230, 0, -412), m['metal'])
        box(f'radiator{s}', (4, 140, 80), (s * 40, 0, -340), m['trim'])
    lathe_z('dish', [(0, -560), (40, -548), (60, -530)], m['hull'], seg=32, cap0=True)
    light(m, 'beacon', (0, 112, 120), 5, 'red')
    return m, 24.0


def harbor():
    """Harbor, 420 km above Earth: a 700 m truss of modules, gold solar wings."""
    m = palette('#eef0f2', '#8b8e94', '#ff6b2c', dark='#2b2a33')
    box('keel', (26, 26, 700), (0, 0, 0), m['metal'])
    for i in range(6):
        z = -250 + i * 100
        lathe_z(f'module{i}', [(0, z - 40), (20, z - 38), (22, z - 30), (22, z + 30), (20, z + 38), (0, z + 40)], m['hull'] if i % 2 else m['trim'], 0, 30, seg=32)
        lathe_z(f'module_b{i}', [(0, z - 30), (18, z - 28), (18, z + 28), (0, z + 30)], m['hull'], 0, -30, seg=32)
        for k in range(4):
            light(m, f'win{i}{k}', (0, 52, z - 22 + k * 15), 2.5, 'lights')
    for s in (-1, 1):
        for i in range(3):
            box(f'wing{s}{i}', (220, 2.5, 60), (s * 165, 0, -220 + i * 200), m['foil'])
            box(f'wingrib{s}{i}', (220, 4, 4), (s * 165, 0, -220 + i * 200), m['metal'])
        box(f'radiator{s}', (3, 120, 70), (s * 40, 0, 120), m['trim'])
    box('bayblock', (110, 80, 50), (0, 0, 362), m['trim'])
    bay(m, 392, 80, 56, 36)
    return m, 18.0


def gateway():
    """Gateway in the lunar halo orbit: habitats, a power module, wide solar wings."""
    m = palette('#eef0f2', '#b8b2a4', '#2fd3ff', dark='#2b2a33')
    lathe_z('hab', [(0, -120), (14, -118), (16, -110), (16, 110), (14, 118), (0, 120)], m['hull'], seg=32)
    lathe_z('ppe', [(0, -200), (18, -196), (22, -180), (22, -125), (16, -120), (0, -120)], m['trim'], seg=32)
    for s in (-1, 1):
        lathe_z(f'side{s}', [(0, -40), (12, -38), (12, 38), (0, 40)], m['hull'], s * 30, 0, seg=24)
        box(f'array{s}', (180, 2, 40), (s * 112, 0, -170), m['solar'])
        box(f'arrayframe{s}', (186, 3, 3), (s * 112, 0, -150), m['metal'])
    lathe_z('tunnel', [(9, 118), (9, 210)], m['metal'], seg=20)
    for k in range(3):
        lathe_z(f'tunnelring{k}', [(9.6, 135 + k * 25), (10.4, 137 + k * 25), (10.4, 141 + k * 25), (9.6, 143 + k * 25)], m['dark'], seg=20)
    box('bayblock', (54, 44, 40), (0, 0, 228), m['trim'])
    bay(m, 248, 40, 30, 26)
    for k in range(8):
        light(m, f'win{k}', (0, 16.5, -90 + k * 22), 1.6, 'lights')
    return m, 8.0


def shackle():
    """The Shackle: a hollowed rock in the Drift, lit and built over."""
    m = palette('#5d564e', '#3a2a24', '#ff6b2c', dark='#1d1a1c', lights='#ffb070')
    m['_rock'] = True
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1.0)
    rock = bpy.context.active_object
    rock.name = 'rock'
    rock.data.materials.append(m['hull'])
    tex = bpy.data.textures.new('rocktex', 'VORONOI')
    tex.noise_scale = 0.7
    d = rock.modifiers.new('lumps', 'DISPLACE'); d.texture = tex; d.strength = 0.22
    tex2 = bpy.data.textures.new('rocktex2', 'CLOUDS'); tex2.noise_scale = 0.25
    d2 = rock.modifiers.new('grit', 'DISPLACE'); d2.texture = tex2; d2.strength = 0.08
    tex3 = bpy.data.textures.new('rocktex3', 'DISTORTED_NOISE'); tex3.noise_scale = 0.09
    d3 = rock.modifiers.new('pits', 'DISPLACE'); d3.texture = tex3; d3.strength = 0.035
    rock.scale = (470, 430, 420)
    bpy.context.view_layer.objects.active = rock
    for mod in list(rock.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.transform_apply(scale=True)
    for p in rock.data.polygons:
        p.use_smooth = True
    # The works: a dock built out of the rock's face, cranes, tanks, lights.
    box('dockhouse', (110, 80, 170), (0, 0, 520), m['trim'])
    bay(m, 604, 70, 56, 40)
    for i in range(9):
        a = i * 0.7
        x, y, z = math.cos(a) * 440, math.sin(a * 1.7) * 210, math.sin(a) * 440
        box(f'shack{i}', (46, 22, 46), (x, y, z), m['trim'] if i % 3 else m['accent'])
        light(m, f'lamp{i}', (x, y + 14, z), 4.0, 'lights')
    for i in range(3):
        tube(f'crane{i}', (-60 + i * 60, 40, 440), (-80 + i * 70, 160, 560), 4, m['dark'])
    for s in (-1, 1):
        lathe_z(f'tank{s}', [(0, 380), (30, 384), (32, 400), (32, 470), (30, 486), (0, 490)], m['accent'], s * 120, -90, seg=24)
    return m, 30.0


# --------------------------------------------------------------------------
# The hangar: where a docked ship sits, inside any station.
# --------------------------------------------------------------------------

def robot_arm(m, name, x, z, facing, reach=1.0):
    """An industrial arm on a turntable: base, shoulder, upper arm, forearm, tool."""
    y0 = -6.0
    lathe_y(f'{name}_base', [(0, 0), (2.2, 0), (2.2, 0.6), (1.6, 1.0), (1.4, 2.2), (0, 2.2)], m['dark'], x, y0, z)
    sx, sz = math.sin(facing), math.cos(facing)
    shoulder = (x, y0 + 3.2, z)
    elbow = (x + sx * 4.5 * reach, y0 + 9.5, z + sz * 4.5 * reach)
    wrist = (x + sx * 9.0 * reach, y0 + 7.2, z + sz * 9.0 * reach)
    tool = (x + sx * 10.2 * reach, y0 + 5.6, z + sz * 10.2 * reach)
    box(f'{name}_turret', (2.6, 2.4, 2.6), shoulder, m['accent'], chamfer=0.2)
    tube(f'{name}_upper', shoulder, elbow, 0.75, m['accent'], seg=12)
    tube(f'{name}_upper2', shoulder, elbow, 0.45, m['dark'], seg=8)
    pz.sphere(f'{name}_elbow', tuple(T(*elbow)), 1.0, m['dark'], segments=16, rings=8)
    tube(f'{name}_fore', elbow, wrist, 0.55, m['accent'], seg=12)
    pz.sphere(f'{name}_wrist', tuple(T(*wrist)), 0.7, m['dark'], segments=16, rings=8)
    tube(f'{name}_tool', wrist, tool, 0.3, m['metal'], seg=10)
    light(m, f'{name}_tip', tool, 0.35, 'ion')
    tube(f'{name}_cable', (x - 0.8, y0 + 1, z), elbow, 0.12, m['dark'], seg=6)


def hangar():
    """The bay a docked ship sits in. Runtime frame: the ship at the origin
    nose to -Z, the open door 45 m ahead at z = -45, the deck at y = -6.

    Industrial and dark, lit in pools: gunmetal walls in inset panels between
    braced ribs, pipe runs, a coffered roof of light panels, a gold-trimmed
    pad. A glass skywalk comes in through the starboard wall from outside the
    station (x = 36 to 66) and runs on inside to x = 12, where a boarding
    bridge (built by the game, per hull) reaches the cockpit."""
    m = palette('#3a3f47', '#25262d', '#c9973c', dark='#16161b', lights='#fff1d8')
    m['skyglass'] = pz.material('skyglass', '#9fd8ff', metallic=0.4, roughness=0.05)
    W, H0, H1, L0, L1 = 36.0, -6.0, 26.0, -45.0, 46.0
    TZ, TY, TR = -4.25, -1.0, 1.8          # the skywalk: centre z, centre y, radius
    TF = TY - 1.6                           # its floor
    # Deck: plates with seams, darker lanes, grates.
    box('floor', (2 * W, 0.6, L1 - L0), (0, H0 - 0.3, (L0 + L1) / 2), m['trim'])
    for k in range(1, 12):
        box(f'seamx{k}', (0.12, 0.04, L1 - L0), (-W + k * 6, H0 + 0.01, (L0 + L1) / 2), m['dark'])
    for k in range(1, 15):
        box(f'seamz{k}', (2 * W, 0.04, 0.12), (0, H0 + 0.01, L0 + k * 6), m['dark'])
    for i, (x, z) in enumerate([(-24, -30), (24, -30), (-24, 30), (24, 30), (-28, 0), (28, 18)]):
        box(f'grate{i}', (4.0, 0.06, 2.4), (x, H0 + 0.02, z), m['dark'])
        for k in range(7):
            box(f'grate{i}b{k}', (0.12, 0.08, 2.2), (x - 1.8 + k * 0.6, H0 + 0.05, z), m['metal'])
    # Walls: port solid, starboard with the skywalk's doorway; both in inset panels.
    box('wallL', (0.8, H1 - H0, L1 - L0), (-W, (H0 + H1) / 2, (L0 + L1) / 2), m['hull'])
    dz0, dz1, dy0, dy1 = TZ - 2.2, TZ + 2.2, TF - 0.4, TY + 2.2
    box('wallRa', (0.8, H1 - H0, dz0 - L0), (W, (H0 + H1) / 2, (L0 + dz0) / 2), m['hull'])
    box('wallRb', (0.8, H1 - H0, L1 - dz1), (W, (H0 + H1) / 2, (dz1 + L1) / 2), m['hull'])
    box('wallRc', (0.8, dy0 - H0, dz1 - dz0), (W, (H0 + dy0) / 2, TZ), m['hull'])
    box('wallRd', (0.8, H1 - dy1, dz1 - dz0), (W, (dy1 + H1) / 2, TZ), m['hull'])
    for s in (-1, 1):
        for k in range(9):
            z = L0 + 6 + k * 10.5
            box(f'rib{s}{k}', (2.0, H1 - H0, 1.4), (s * (W - 1.0), (H0 + H1) / 2, z), m['trim'], chamfer=0.1)
            # A brace from the rib's foot up the wall, and a lamp on it.
            tube(f'brace{s}{k}', (s * (W - 2.2), H0 + 0.2, z), (s * (W - 0.6), H0 + 7.0, z), 0.22, m['dark'], seg=8)
            light(m, f'wlamp{s}{k}', (s * (W - 2.1), 12, z), 0.6, 'lights')
            # Inset panels between this rib and the next.
            if k < 8:
                for row in range(3):
                    zz = z + 5.25
                    if s > 0 and abs(zz - TZ) < 6 and row == 0:
                        continue
                    box(f'panel{s}{k}{row}', (0.12, 5.6, 8.4), (s * (W - 0.5), H0 + 4.2 + row * 7.6, zz), m['accent'] if (k + row) % 5 == 0 else m['trim'], chamfer=0.08)
        box(f'catwalk{s}', (4.0, 0.3, L1 - L0 - 4), (s * (W - 2.5), 6.0, (L0 + L1) / 2), m['metal'])
        tube(f'rail{s}', (s * (W - 4.4), 7.2, L0 + 2), (s * (W - 4.4), 7.2, L1 - 2), 0.08, m['accent'], seg=6)
        for k in range(12):
            z = L0 + 4 + k * 7.6
            tube(f'post{s}{k}', (s * (W - 4.4), 6.1, z), (s * (W - 4.4), 7.2, z), 0.06, m['metal'], seg=6)
        box(f'strip{s}', (0.3, 0.4, L1 - L0 - 6), (s * (W - 0.6), 18.0, (L0 + L1) / 2), m['ion'])
        # Pipe runs along the wall.
        for h, r in ((9.0, 0.35), (9.9, 0.22), (20.5, 0.45)):
            tube(f'pipe{s}{h}', (s * (W - 0.9), h, L0 + 1), (s * (W - 0.9), h, L1 - 1), r, m['dark'] if r > 0.3 else m['metal'], seg=10)
        for k in range(3):
            z = (-22, 8, 22)[k]
            box(f'console{s}{k}', (2.2, 2.4, 4.0), (s * (W - 3.2), H0 + 1.2, z), m['trim'], chamfer=0.15)
            box(f'screen{s}{k}', (0.1, 1.2, 3.2), (s * (W - 4.35), H0 + 2.0, z), m['ion'])
    box('ceiling', (2 * W, 0.6, L1 - L0), (0, H1 + 0.3, (L0 + L1) / 2), m['hull'])
    box('back', (2 * W, H1 - H0, 0.8), (0, (H0 + H1) / 2, L1), m['hull'])
    box('blastdoor', (22, 18, 0.6), (0, H0 + 9, L1 - 0.6), m['trim'])
    for k in range(5):
        box(f'bdseam{k}', (22.2, 0.15, 0.7), (0, H0 + 2 + k * 3.6, L1 - 0.6), m['dark'])
    for s in (-1, 1):
        box(f'doorlight{s}', (0.5, 18, 0.5), (s * 11.3, H0 + 9, L1 - 0.8), m['lights'])
    box('doorlightTop', (23, 0.5, 0.5), (0, H0 + 18.2, L1 - 0.8), m['lights'])
    # The roof: deep beams and a light panel in each bay of them.
    for k in range(6):
        z = L0 + 8 + k * 15
        box(f'beam{k}', (2 * W, 2.4, 1.6), (0, H1 - 1.2, z), m['trim'], chamfer=0.1)
        box(f'panel{k}', (14, 0.25, 3.0), (0, H1 - 1.9, z + 6), m['lights'])
        box(f'panelframe{k}', (15, 0.5, 4.0), (0, H1 - 1.7, z + 6), m['dark'])
    for s in (-1, 1):
        box(f'craneRail{s}', (1.0, 1.0, L1 - L0), (s * 14, H1 - 2.6, (L0 + L1) / 2), m['metal'])
    box('crane', (30, 1.4, 2.2), (0, H1 - 3.4, 22), m['accent'])
    tube('craneHook', (0, H1 - 4, 22), (0, H1 - 11, 22), 0.12, m['metal'])
    # The door frame: a heavy lip, hazard stripes, lights round the opening.
    for s in (-1, 1):
        box(f'jamb{s}', (4.0, H1 - H0, 3.0), (s * (W - 2), (H0 + H1) / 2, L0 + 1.5), m['trim'])
        for k in range(8):
            box(f'hazard{s}{k}', (0.6, 1.4, 3.1), (s * (W - 0.2), H0 + 1.6 + k * 3.6, L0 + 1.5), m['accent'] if k % 2 else m['dark'])
    box('lintel', (2 * W, 3.0, 3.0), (0, H1 - 1.5, L0 + 1.5), m['trim'])
    for k in range(10):
        light(m, f'doorlamp{k}', (-W + 4 + k * (2 * W - 8) / 9, H1 - 3.2, L0 + 1.0), 0.7, 'lights')
    # The pad: a gold-ringed disc, a ring of light, lanes to the door.
    lathe_y('pad', [(0, 0.15), (13.4, 0.15), (13, 0)], m['trim'], 0, H0 + 0.02, 0, seg=64)
    lathe_y('padgold', [(13.4, 0.18), (14.2, 0.18), (14.0, 0.0)], m['accent'], 0, H0 + 0.02, 0, seg=64)
    lathe_y('padring', [(12.2, 0.2), (12.8, 0.2)], m['ion'], 0, H0 + 0.05, 0, seg=64)
    for k in range(16):
        a = k / 16 * math.tau
        box(f'padmark{k}', (0.3, 0.05, 1.6), (math.sin(a) * 10.5, H0 + 0.2, math.cos(a) * 10.5), m['accent'])
    for s in (-1, 1):
        box(f'lane{s}', (0.6, 0.05, 30), (s * 7, H0 + 0.03, L0 + 16), m['accent'])
        for k in range(6):
            light(m, f'lanelamp{s}{k}', (s * 7, H0 + 0.1, L0 + 4 + k * 5), 0.3, 'ion')
    # Arms either side, clear of the skywalk.
    robot_arm(m, 'armL', -21, 4, math.radians(80))
    robot_arm(m, 'armR', 24, -16, math.radians(-60))
    robot_arm(m, 'armB', -16, 30, math.radians(140), reach=0.8)
    for i, (x, z, n) in enumerate([(24, 28, 3), (-27, -22, 2), (26, -30, 2), (-24, 36, 3)]):
        for k in range(n):
            box(f'crate{i}{k}', (4.2, 3.2, 4.2), (x + (k % 2) * 0.6, H0 + 1.6 + k * 3.25, z + (k % 2) * 0.4), m['accent'] if (i + k) % 2 else m['trim'], chamfer=0.15)
    for k in range(3):
        lathe_y(f'tank{k}', [(0, 0), (2.0, 0.2), (2.2, 1.2), (2.2, 7.0), (2.0, 8.0), (0, 8.2)], m['metal'], 30, H0, 8 + k * 5.2)
        tube(f'fuelline{k}', (30, H0 + 7.6, 8 + k * 5.2), (W - 0.4, H0 + 7.6, 8 + k * 5.2), 0.22, m['dark'], seg=8)
    # The skywalk: from outside the station (x = 66, an airlock) in through
    # the starboard wall to x = 12. Ribs of metal round a glass tube, a deck,
    # strip lights along it; hung from the roof inside, from struts outside.
    X0, X1 = 12.0, 66.0
    box('swdeck', (X1 - X0, 0.2, 2.6), ((X0 + X1) / 2, TF, TZ), m['metal'])
    for s in (-1, 1):
        box(f'swedge{s}', (X1 - X0, 0.12, 0.12), ((X0 + X1) / 2, TF + 0.12, TZ + s * 1.2), m['ion'])
    n = int((X1 - X0) / 3)
    for k in range(n + 1):
        x = X0 + k * (X1 - X0) / n
        torus_name = f'swrib{k}'
        verts, faces = [], []
        seg, rseg = 24, 6
        for a_i in range(seg):
            a = a_i / seg * math.tau
            for b_i in range(rseg):
                b = b_i / rseg * math.tau
                rr = TR + 0.12 * math.cos(b)
                verts.append(T(x + 0.12 * math.sin(b), TY + rr * math.sin(a), TZ + rr * math.cos(a)))
        for a_i in range(seg):
            for b_i in range(rseg):
                i0 = a_i * rseg + b_i; i1 = a_i * rseg + (b_i + 1) % rseg
                i2 = ((a_i + 1) % seg) * rseg + (b_i + 1) % rseg; i3 = ((a_i + 1) % seg) * rseg + b_i
                faces.append((i0, i1, i2, i3))
        _finish(pz._object(torus_name, verts, faces, m['trim']), 60)
    # The glass: a cylinder along x.
    gv, gf, seg = [], [], 32
    for x in (X0, X1):
        for a_i in range(seg):
            a = a_i / seg * math.tau
            gv.append(T(x, TY + TR * math.sin(a), TZ + TR * math.cos(a)))
    for a_i in range(seg):
        j = (a_i + 1) % seg
        gf.append((a_i, j, seg + j, seg + a_i))
    pz._object('swglass', gv, gf, m['skyglass'])
    # Airlock at the far end, struts outside, hangers inside.
    box('swlock', (0.8, 4.2, 4.2), (X1 + 0.4, TY, TZ), m['trim'], chamfer=0.2)
    box('swlockdoor', (0.2, 2.6, 1.6), (X1 - 0.05, TF + 1.3, TZ), m['dark'])
    light(m, 'swlocklamp', (X1 - 0.2, TY + 1.5, TZ), 0.3, 'lights')
    for k in range(4):
        x = W + 6 + k * 7
        tube(f'swstrut{k}', (x, TY - TR, TZ), (x - 4, TY - 9, TZ + 4), 0.18, m['dark'], seg=8)
    for k in range(4):
        x = X0 + 3 + k * 6
        tube(f'swhang{k}', (x, TY + TR, TZ), (x, H1 - 2.5, TZ), 0.09, m['metal'], seg=6)
    return m, 2.5


BUILDERS = {
    'kestrel': kestrel, 'mule': mule, 'lance': lance, 'raider': raider, 'warden': warden, 'cutter': cutter,
    'freighter': freighter, 'canister': canister, 'hangar': hangar, 'hearth': hearth, 'harbor': harbor, 'gateway': gateway, 'shackle': shackle,
}


def build(kind):
    """Build one kind, bake it, mark its engines, export it."""
    a = pz.cli()
    pz.reset_scene()
    # The material cache outlives a factory reset; the materials do not.
    pz._materials.clear()
    m, panel = BUILDERS[kind]()
    surfaces(m, panel=panel)
    # Engine exits: the runtime puts a plume at each.
    exits = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith('engine') and not o.name.endswith(('_glow', '_collar'))]
    nozzles = []
    for o in sorted(exits, key=lambda o: o.name):
        # The bell's last ring is its exit: the largest radius, furthest aft.
        vs = [o.matrix_world @ v.co for v in o.data.vertices]
        aft = min(v.y for v in vs)
        ring = [v for v in vs if abs(v.y - aft) < 1e-4]
        cx = sum(v.x for v in ring) / len(ring); cz = sum(v.z for v in ring) / len(ring)
        nozzles.append(Vector((cx, aft, cz)))
    pz.join_meshes(kind)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if os.environ.get('PZ_NOBAKE'):
        # A quick look: procedural materials, a Cycles preview, nothing exported.
        if a['preview']:
            sf.preview(a['preview'], meshes, size=(900, 560), samples=24, ground='#15131c', azimuth=-35, elevation=22)
        return
    size = 2048 if kind in ('hearth', 'harbor', 'shackle', 'freighter', 'gateway', 'hangar', 'kestrel', 'mule', 'lance') else 1024
    sf.bake_asset(meshes, kind, keep=KEEP, **pz.bake_options(a, size))
    for i, p in enumerate(nozzles):
        pz.empty(f'nozzle_{i}', tuple(p))
    tris = sum(pz.triangle_count(o) for o in meshes)
    print(f'PZ-TRIANGLES {tris}')
    if a['blend']:
        pz.save_blend(a['blend'])
    if a['preview']:
        sf.preview(a['preview'], meshes)
    if a['out']:
        pz.export_glb(a['out'])
        print(f'PZ-WROTE {a["out"]}')
