"""
A photograph of every world you can land on, rendered in Cycles from the
game's own assets.

    npm run art:build -- worlds
    PZ_WORLD=io npm run art:build -- worlds     # one world

The front page's gallery and the campaign's briefings open on these. Each is
made the way a film's key art is: the shipped models (lander, rover,
instrument kit, rock set) and the world's baked ground tile (art/ground)
placed on a landscape of that world's own geology, lit by one sun of the
right size for its distance, with its parent planet in the sky at its true
angular size, and path traced. Nothing is painted over; nothing is a third
party's (Earth is NASA's Blue Marble, already in public/textures).

The landscapes follow the same geology as the game's terrain styles
(src/sim/expedition.js): Mercury's lobate scarp, Phobos's grooves, Venus's
tesserae under 92 bar of orange haze, Io's lava lake, Europa's double ridges,
Ganymede's furrows, Callisto's saturation craters, Titan's dunes and a
methane lake, Pluto's nitrogen-ice cells, Halley's jets.

Writes public/stills/world-<id>.webp, 1280 x 720. Path tracing is not
bit-reproducible across machines, so this asset is not held to --check.
In an open Blender (over MCP) it builds the scene and leaves it to explore.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Euler, Vector, noise  # noqa: E402

import pz  # noqa: E402
import surfacing as sf  # noqa: E402

AUTHORED = os.path.join(ROOT, 'public', 'authored')

# The camera stands behind and left of the lander, looking past it.
CAMERA = ((-9.0, -17.0, 1.8), (1.5, 4.0, 2.6), 30.0)
HEADING = math.atan2(21.0, 10.5)


def ahead(d, side=0.0):
    """A point d metres out along the camera's view, `side` metres to its right."""
    return (math.cos(HEADING) * d + math.sin(HEADING) * side, math.sin(HEADING) * d - math.cos(HEADING) * side)


WORLDS = {
    'moon': {
        'tile': 'moon', 'soil': '#8c8780', 'rock_tint': '#6d6863', 'relief': 9.0, 'far_relief': 70.0,
        'sun': (215.0, 21.0), 'sun_power': 6.5, 'exposure': -0.35,
        'camera': ((-8.5, -16.5, 1.8), (1.5, 2.5, 2.0), 32.0),
        'craters': [(520, -260, 160, 34), (900, 380, 300, 50)],
        'body': {'kind': 'earth', 'azimuth': 9.0, 'elevation': 7.5, 'diameter_deg': 1.9},
    },
    'mars': {
        'tile': 'mars', 'soil': '#b8693c', 'rock_tint': '#6b3f2c', 'relief': 4.0, 'far_relief': 30.0,
        'sun': (78.0, 9.0), 'sun_power': 4.6, 'sky': ('#e9b47c', '#6e4a38'), 'exposure': 0.35,
        'haze': 0.0003, 'glow': '#ffcf8a',
        'camera': ((-9.0, -17.0, 1.8), (1.5, 4.0, 2.6), 30.0),
        'mesas': True,
    },
    'phobos': {
        'tile': 'phobos', 'soil': '#5e5852', 'rock_tint': '#4a4540', 'relief': 6.0, 'far_relief': 60.0,
        'sun': (240.0, 28.0), 'sun_power': 5.0, 'exposure': 0.25, 'hopper': True,
        'camera': ((-9.0, -17.0, 1.8), (1.5, 4.0, 3.0), 26.0),
        'grooves': (34.0, 4.0, 0.62), 'craters': [(620, 200, 260, 70)],
        # Mars from Phobos: forty-two degrees across, rising out of the frame.
        'body': {'kind': 'mars', 'azimuth': 26.0, 'elevation': 21.0, 'diameter_deg': 42.0},
    },
    'mercury': {
        'tile': 'moon', 'soil': '#7d7873', 'rock_tint': '#5d5955', 'relief': 7.0, 'far_relief': 50.0,
        'sun': (200.0, 12.0), 'sun_power': 11.0, 'exposure': -0.6,
        'craters': [(380, -220, 120, 28), (1100, 300, 420, 70)],
        'scarp': (560.0, 75.0),
    },
    'venus': {
        'tile': 'venus', 'soil': '#7a5d3e', 'rock_tint': '#5a4634', 'relief': 4.0, 'far_relief': 40.0,
        'sun': (120.0, 55.0), 'sun_power': 1.6, 'sky': ('#f0b050', '#c07a28'), 'exposure': 1.0,
        'haze': 0.0035, 'haze_colour': '#f0a848', 'sky_strength': 2.4, 'sun_colour': '#ffb050',
        'tessera': 55.0,
    },
    'io': {
        'tile': 'io', 'soil': '#d4c06a', 'rock_tint': '#4a3d28', 'relief': 3.0, 'far_relief': 35.0,
        'sun': (230.0, 14.0), 'sun_power': 3.0, 'exposure': 0.2,
        'lake': ('lava', 70.0, -40.0, 30.0),
        'body': {'kind': 'jupiter', 'azimuth': 14.0, 'elevation': 13.0, 'diameter_deg': 19.5},
    },
    'europa': {
        'tile': 'europa', 'soil': '#d9e1e2', 'rock_tint': '#b6c4c8', 'relief': 2.5, 'far_relief': 45.0,
        'sun': (205.0, 22.0), 'sun_power': 3.4, 'exposure': 0.15,
        'camera': ((-13.0, -27.0, 1.8), (1.5, 4.0, 5.0), 42.0),
        'ridges': True,
        'peaks': {'colours': ('#a9c3d0', '#f2f6f7', '#8a6a55'), 'count': 16, 'height': (140, 340)},
        'body': {'kind': 'jupiter', 'azimuth': 9.0, 'elevation': 10.5, 'diameter_deg': 12.0},
    },
    'ganymede': {
        'tile': 'ganymede', 'soil': '#9a9387', 'rock_tint': '#6e685f', 'relief': 4.0, 'far_relief': 55.0,
        'sun': (215.0, 18.0), 'sun_power': 3.6, 'exposure': 0.1,
        'grooves': (70.0, 12.0, 0.25), 'craters': [(820, -340, 220, 40)],
        'body': {'kind': 'jupiter', 'azimuth': -12.0, 'elevation': 9.0, 'diameter_deg': 7.6},
    },
    'callisto': {
        'tile': 'ganymede', 'soil': '#6e665c', 'rock_tint': '#4c463f', 'relief': 6.0, 'far_relief': 40.0,
        'sun': (190.0, 16.0), 'sun_power': 4.0, 'exposure': 0.2,
        'craters': [(260, -120, 60, 14), (420, 140, 110, 22), (640, -260, 180, 38), (980, 260, 320, 60), (520, 420, 90, 18), (360, -360, 70, 15)],
        'frost': True,
        'body': {'kind': 'jupiter', 'azimuth': 16.0, 'elevation': 6.0, 'diameter_deg': 4.4},
    },
    'titan': {
        'tile': 'titan', 'soil': '#7a5a34', 'rock_tint': '#8e8574', 'relief': 2.0, 'far_relief': 18.0,
        'sun': (140.0, 40.0), 'sun_power': 0.9, 'sky': ('#d08a3a', '#6a4220'), 'exposure': 1.1,
        'haze': 0.0022, 'haze_colour': '#d08a3c', 'sky_strength': 1.3, 'sun_colour': '#ffb060',
        'dunes': (190.0, 26.0), 'lake': ('methane', 75.0, -48.0, 38.0),
    },
    'pluto': {
        'tile': 'pluto', 'soil': '#ddd1c2', 'rock_tint': '#c2b19c', 'relief': 2.0, 'far_relief': 25.0,
        'sun': (230.0, 14.0), 'sun_power': 2.6, 'exposure': 0.9,
        'cells': (210.0, 7.0),
        'peaks': {'colours': ('#8c7c6c', '#e6ddd0', '#7a3f2c'), 'count': 16, 'height': (50, 170), 'blocky': True, 'distance': (1300, 2300)},
        'body': {'kind': 'charon', 'azimuth': -14.0, 'elevation': 17.0, 'diameter_deg': 3.8},
    },
    'halley': {
        'tile': 'phobos', 'soil': '#34302d', 'rock_tint': '#2a2725', 'relief': 7.0, 'far_relief': 80.0,
        'sun': (250.0, 20.0), 'sun_power': 6.0, 'exposure': 0.9, 'hopper': True,
        'camera': ((-9.0, -17.0, 1.6), (1.5, 4.0, 4.5), 26.0),
        'craters': [(380, -140, 90, 30), (700, 220, 160, 55)],
        'jets': [(520, -150, 18, 900), (760, 260, 26, 1300), (1100, -40, 14, 700)],
    },
    'deimos': {
        'tile': 'phobos', 'soil': '#7a7066', 'rock_tint': '#5d554d', 'relief': 3.0, 'far_relief': 25.0,
        'sun': (230.0, 26.0), 'sun_power': 5.0, 'exposure': 0.2, 'hopper': True,
        'camera': ((-9.0, -17.0, 1.6), (1.5, 4.0, 6.0), 28.0),
        'craters': [(500, -120, 200, 18)],
        'body': {'kind': 'mars', 'azimuth': 10.0, 'elevation': 15.0, 'diameter_deg': 16.0},
    },
}


# --------------------------------------------------------------------------
# The landscape
# --------------------------------------------------------------------------

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def heights(w, xs, ys):
    """Gentle ground near the lander rising into the world's own relief toward the horizon."""
    X, Y = np.meshgrid(xs, ys)
    R = np.hypot(X, Y)
    near = np.zeros_like(X)
    far = np.zeros_like(X)
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            # Rolling, not lumpy: long wavelengths, high octaves turned down.
            near[j, i] = noise.fractal(Vector((x / 140, y / 140, 0.3)), 0.35, 2.0, 3)
            far[j, i] = noise.fractal(Vector((x / 900, y / 900, 1.7)), 0.4, 2.0, 3)
    flat = np.clip((R - 40.0) / 260.0, 0.0, 1.0)
    h = w['relief'] * near * (0.2 + 0.8 * flat) + w['far_relief'] * far * flat ** 1.5
    if w.get('ridges'):
        # Europa's double ridges: two parallel crests along a line.
        d = X * 0.6 + Y * 0.8 - 260.0
        h += 38.0 * (np.exp(-((d - 22) / 18) ** 2) + np.exp(-((d + 22) / 18) ** 2)) * flat
    for d, side, r, depth in w.get('craters', []):
        cx, cy = ahead(d, side)
        q = np.hypot(X - cx, Y - cy) / r
        h += -depth * np.clip(1 - q * q, 0, None) + depth * 0.42 * np.exp(-((q - 1) / 0.13) ** 2)
    if w.get('scarp'):
        # A lobate scarp: the crust shrank as Mercury cooled and one side rode
        # up over the other along a winding front.
        dist, high = w['scarp']
        u = X * math.cos(HEADING) + Y * math.sin(HEADING) - dist + 60 * np.sin(X / 230.0) + 30 * np.sin(Y / 97.0)
        h += high * smoothstep(-25.0, 35.0, u) * (1 + 0.15 * np.sin(X / 140.0))
    if w.get('grooves'):
        spacing, depth, turn = w['grooves']
        u = (X * math.cos(turn) + Y * math.sin(turn)) / spacing + 0.6 * np.sin(Y / 410.0)
        f = u - np.round(u)
        h -= depth * np.exp(-(f / 0.16) ** 2) * flat
    if w.get('tessera'):
        # Tesserae: ground folded and then broken across the folds.
        a = np.abs(np.sin((X * 0.8 + Y * 0.6) / 70.0 + 0.8 * np.sin(Y / 260.0)))
        b = np.abs(np.sin((X * -0.5 + Y * 0.86) / 45.0))
        h += w['tessera'] * ((1 - a) ** 3 * 0.8 + (1 - b) ** 4 * 0.35) * smoothstep(250.0, 700.0, R)
    if w.get('dunes'):
        # Linear dunes, hundreds of metres apart, all running one way.
        spacing, high = w['dunes']
        u = (X * 0.96 - Y * 0.28) / spacing + 0.35 * np.sin(Y / 520.0)
        crest = 1 - np.abs(2 * (u - np.floor(u)) - 1)
        h += high * crest ** 2.2 * smoothstep(160.0, 420.0, R)
    if w.get('cells'):
        # Convection cells in nitrogen ice: plains bounded by troughs.
        size, depth = w['cells']
        d1 = np.full(X.shape, 1e9)
        d2 = np.full(X.shape, 1e9)
        rng = np.random.default_rng(97)
        for cx, cy in rng.uniform(-900, 900, (90, 2)):
            d = np.hypot(X - cx, Y - cy)
            d2 = np.where(d < d1, d1, np.minimum(d2, d))
            d1 = np.minimum(d1, d)
        h -= depth * np.exp(-((d2 - d1) / (size * 0.12)) ** 2) * smoothstep(60.0, 160.0, R)
    if w.get('lake'):
        _, d, side, r = w['lake']
        cx, cy = ahead(d, side)
        q = np.hypot(X - cx, Y - cy) / r
        h = h * smoothstep(0.7, 1.4, q) - 9.0 * (1 - smoothstep(0.85, 1.15, q))
    # The landing site itself is level, the way the game's clearing is.
    h *= np.clip(R / 40.0, 0, 1) ** 2
    return h


def terrain(w, world, size=2400.0, step=4.0):
    n = int(size / step) + 1
    xs = np.linspace(-size / 2, size / 2, n)
    ys = np.linspace(-size / 2, size / 2, n)
    h = heights(w, xs, ys)
    verts = [(float(x), float(y), float(h[j, i])) for j, y in enumerate(ys) for i, x in enumerate(xs)]
    faces = [(j * n + i, j * n + i + 1, (j + 1) * n + i + 1, (j + 1) * n + i) for j in range(n - 1) for i in range(n - 1)]
    me = bpy.data.meshes.new('terrain')
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UVMap')
    coords = np.empty(len(me.loops) * 2, dtype=np.float32)
    loop_verts = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get('vertex_index', loop_verts)
    v = np.array(verts, dtype=np.float32)
    coords[0::2] = v[loop_verts, 0] / 4.0
    coords[1::2] = v[loop_verts, 1] / 4.0
    uv.data.foreach_set('uv', coords)
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new('terrain', me)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(ground_material(w))

    def height_at(x, y):
        i = min(n - 1, max(0, int(round((x + size / 2) / step))))
        j = min(n - 1, max(0, int(round((y + size / 2) / step))))
        return float(h[j, i])
    return obj, height_at


def ground_material(w):
    """The baked ground tile (art/ground) on the world's palette, at two scales; rock on steep ground."""
    m = bpy.data.materials.new('ground')
    g = sf.Graph(m)
    uv = g.node('ShaderNodeUVMap', uv_map='UVMap').outputs['UV']
    detail = bpy.data.images.load(os.path.join(AUTHORED, 'ground', f"{w['tile']}-detail.webp"))
    normal = bpy.data.images.load(os.path.join(AUTHORED, 'ground', f"{w['tile']}-normal.webp"))
    normal.colorspace_settings.name = 'Non-Color'

    def tex(img, vector):
        t = g.node('ShaderNodeTexImage', image=img, interpolation='Cubic')
        g.put(t.inputs['Vector'], vector)
        return t.outputs['Color']
    big = g.node('ShaderNodeMapping')
    g.put(big.inputs['Vector'], uv)
    big.inputs['Scale'].default_value = (4 / 17.3, 4 / 17.3, 1)
    big.inputs['Rotation'].default_value = (0, 0, 0.6)
    d = g.mixc(tex(detail, uv), tex(detail, big.outputs['Vector']), 0.35, blend='MULTIPLY')
    v = g.coords()
    palette = g.mixc(sf.rgb(w['soil']), (0, 0, 0, 1), g.remap(g.noise(v, 0.02, detail=5.0), 0.3, 0.75, 0.0, 0.25))
    # Steep ground sheds its dust and shows the rock beneath.
    up = g.xyz(g.node('ShaderNodeNewGeometry').outputs['Normal'])[2]
    palette = g.mixc(palette, sf.rgb(w['rock_tint']), g.remap(up, 0.93, 0.75, 0.0, 0.8))
    if w.get('frost'):
        # Bright frost on the cold, sunward-facing crater rims.
        palette = g.mixc(palette, sf.rgb('#e4e6e4'), g.mul(g.remap(g.noise(v, 0.05, detail=6.0), 0.55, 0.7), g.remap(up, 0.97, 0.85)))
    base = g.mixc(palette, d, 1.0, blend='MULTIPLY')
    scale2 = g.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY', clamp_result=False)
    g.put(scale2.inputs[0], 1.0)
    g.put(scale2.inputs[6], base)
    g.put(scale2.inputs[7], (2.0, 2.0, 2.0, 1.0))
    nm = g.node('ShaderNodeNormalMap', uv_map='UVMap')
    g.put(nm.inputs['Color'], tex(normal, uv))
    nm.inputs['Strength'].default_value = 1.0
    sf._finish(g, scale2.outputs[2], 0.0, 0.96, nm.outputs['Normal'], None, None)
    return m


def mesas(height_at):
    """Layered buttes on the skyline: uneven beds, dust draped over them, talus at the foot."""
    m = bpy.data.materials.new('strata')
    g = sf.Graph(m)
    v = g.coords()
    z = g.xyz(v)[2]
    warp = g.add(g.mul(g.noise(v, 0.004, detail=3.0), 40.0), g.mul(g.noise(v, 0.03, detail=4.0), 8.0))
    beds = g.voronoi(g.vec(0.0, 0.0, g.mul(g.add(z, warp), 1 / 11.0)), 1.0, 'F1', 'Color')
    tone = g.xyz(beds)[0]
    base = g.mixc(sf.rgb('#7a3f26'), sf.rgb('#c48759'), g.remap(tone, 0.0, 1.0, 0.1, 0.9))
    up = g.xyz(g.node('ShaderNodeNewGeometry').outputs['Normal'])[2]
    drape = g.remap(g.noise(v, 0.01, detail=5.0), 0.45, 0.65)
    base = g.mixc(base, sf.rgb('#b8693c'), g.math('MAXIMUM', g.remap(up, 0.55, 0.85), g.mul(drape, 0.7)))
    base = g.mixc(base, sf.rgb('#4a2618'), g.mul(g.remap(g.noise(g.vec(g.xyz(v)[0], g.xyz(v)[1], g.mul(z, 0.08)), 0.15, detail=6.0), 0.6, 0.8), 0.5))
    h = g.add(g.mul(tone, 0.5), g.noise(v, 0.4, detail=8.0))
    sf._finish(g, base, 0.0, 0.95, g.bump(h, 0.5, 0.8), None, None)
    for k, (x, y, r, top) in enumerate(((-420, 780, 210, 170), (180, 900, 260, 210), (620, 700, 170, 130), (-820, 560, 190, 120))):
        butte(f'mesa_{k}', x, y, height_at(0, 0) - 12, r, top, m, seed=k * 7 + 3)


def butte(name, cx, cy, z0, radius, top, mat, seed):
    """A butte: a scree apron, stepped walls, a flat cap, ragged in plan."""
    profile = [(-0.15, 1.6), (0.0, 1.42), (0.1, 1.2), (0.2, 1.08), (0.32, 1.04), (0.38, 1.0), (0.55, 0.97), (0.6, 0.93),
               (0.78, 0.9), (0.84, 0.85), (0.97, 0.82), (1.0, 0.76), (1.01, 0.4), (1.012, 0.0)]
    seg = 200
    verts, faces = [], []
    for zf, rf in profile:
        for i in range(seg):
            a = math.tau * i / seg
            p = Vector((math.cos(a), math.sin(a), zf * 3.0))
            jag = 1.0 + 0.2 * noise.noise(p * 1.6 + Vector((seed, 0, 0))) + 0.08 * noise.noise(p * 6.0 + Vector((0, seed, 0)))
            # Gullies: notches cut down the walls.
            jag -= 0.05 * max(0.0, noise.noise(Vector((math.cos(a) * 9, math.sin(a) * 9, seed))) ) * (1 - abs(zf - 0.5))
            rr = radius * rf * jag
            verts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.8, z0 + zf * top))
    for j in range(len(profile) - 1):
        for i in range(seg):
            a0 = j * seg + i
            a1 = j * seg + (i + 1) % seg
            faces.append((a0, a1, a1 + seg, a0 + seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    sub = o.modifiers.new('detail', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 2
    disp = o.modifiers.new('rough', 'DISPLACE')
    t = bpy.data.textures.new(f'{name}_tex', 'CLOUDS')
    t.noise_scale = 12.0
    disp.texture = t
    disp.strength = 6.0
    o.data.materials.append(mat)


def peaks(spec, height_at, rng):
    """Massifs on the skyline: lathed cones torn by noise (ice), or tilted blocks (Pluto's water ice)."""
    low, high, stain = spec['colours']
    m = bpy.data.materials.new('peaks')
    g = sf.Graph(m)
    v = g.coords()
    up = g.xyz(g.node('ShaderNodeNewGeometry').outputs['Normal'])[2]
    base = g.mixc(sf.rgb(low), sf.rgb(high), g.remap(up, 0.2, 0.75))
    base = g.mixc(base, sf.rgb(stain), g.mul(g.remap(g.noise(v, 0.01, detail=5.0), 0.62, 0.8), 0.4))
    bsdf = sf._finish(g, base, 0.0, 0.4, g.bump(g.noise(v, 0.08, detail=8.0), 0.6, 3.0), None, None)
    bsdf.inputs['Subsurface Weight'].default_value = 0.15
    lo, hi = spec['height']
    blocky = spec.get('blocky', False)
    for k in range(spec['count']):
        a = HEADING + math.radians(-15 + k * (40 / spec['count']) + rng.uniform(-2, 2))
        dist = rng.uniform(*spec.get('distance', (900, 1700)))
        x, y = math.cos(a) * dist, math.sin(a) * dist
        height = rng.uniform(lo, hi)
        radius = height * rng.uniform(0.7, 1.1) * (1.4 if blocky else 1.0)
        fs = (1.0, 0.85, 0.7, 0.55, 0.4) if blocky else (1.0, 0.8, 0.6, 0.42, 0.26, 0.12, 0.03)
        profile = [(radius * f, height * ((1 - f) / (1 - fs[-1])) ** (0.5 if blocky else 1.6)) for f in fs]
        seg = 9 if blocky else 64
        verts, faces = [], []
        tilt = rng.uniform(-0.25, 0.25)
        for r, z in profile:
            for i in range(seg):
                t = math.tau * i / seg + k
                p = Vector((math.cos(t), math.sin(t), z / height * 2))
                jag = 1 + (0.12 if blocky else 0.35) * noise.noise(p * 2.5 + Vector((k * 3.1, 0, 0))) + (0.0 if blocky else 0.15) * noise.noise(p * 7 + Vector((0, k, 0)))
                px, py = math.cos(t) * r * jag, math.sin(t) * r * jag
                verts.append((x + px, y + py, height_at(0, 0) - 30 + z * (0.9 + 0.2 * jag) + tilt * px))
        for j in range(len(profile) - 1):
            for i in range(seg):
                a0, a1 = j * seg + i, j * seg + (i + 1) % seg
                faces.append((a0, a1, a1 + seg, a0 + seg))
        faces.append(tuple((len(profile) - 1) * seg + i for i in range(seg)))
        me = bpy.data.meshes.new(f'peak_{k}')
        me.from_pydata(verts, [], faces)
        o = bpy.data.objects.new(f'peak_{k}', me)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(m)
        disp = o.modifiers.new('torn', 'DISPLACE')
        t = bpy.data.textures.new(f'peak_tex_{k}', 'VORONOI')
        t.noise_scale = 40.0
        disp.texture = t
        disp.strength = 8.0 if blocky else 18.0
        sub = o.modifiers.new('detail', 'SUBSURF')
        sub.levels = 0
        sub.render_levels = 2
        if blocky:
            sub.subdivision_type = 'SIMPLE'
        o.modifiers.move(1, 0)


def lake(w, height_at):
    """A lake surface in the basin: liquid methane, mirror-dark; or a lava lake, crusted and glowing."""
    kind, d, side, r = w['lake']
    cx, cy = ahead(d, side)
    # Brim-full: a few centimetres under the rim, so it shows over the near shore.
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=r * 1.12, fill_type='NGON', location=(cx, cy, height_at(cx, cy) + 8.6))
    o = bpy.context.active_object
    o.name = 'lake'
    m = bpy.data.materials.new(kind)
    g = sf.Graph(m)
    v = g.coords()
    if kind == 'methane':
        base = sf.rgb('#150e08')
        sf._finish(g, base, 0.0, 0.04, g.bump(g.noise(v, 0.3, detail=2.0), 0.05, 0.1), None, None)
    else:
        # Cooled crust in plates; the cracks between them glow.
        cells = g.voronoi(v, 0.06, 'DISTANCE_TO_EDGE', 'Distance')
        crack = g.remap(cells, 0.0, 0.08, 1.0, 0.0)
        base = g.mixc(sf.rgb('#2a2420'), sf.rgb('#1a1512'), g.noise(v, 0.2, detail=4.0))
        glow = g.mixc((0, 0, 0, 1), sf.rgb('#ff6a20'), crack)
        bsdf = sf._finish(g, base, 0.0, 0.8, g.bump(cells, 0.6, 1.0), None, None, emission=glow)
        bsdf.inputs['Emission Strength'].default_value = 6.0
        # The lake lights the ground round it.
        light = bpy.data.lights.new('lava', 'AREA')
        light.shape = 'DISK'
        light.size = r * 1.6
        light.energy = 280.0 * r * r
        light.color = (1.0, 0.42, 0.14)
        lo = bpy.data.objects.new('lava_light', light)
        bpy.context.scene.collection.objects.link(lo)
        lo.location = (cx, cy, height_at(cx, cy) + 25)
        lo.visible_camera = False
        lo.visible_glossy = False
    o.data.materials.append(m)


def jets(w, height_at):
    """Gas and dust jetting from the nucleus where the Sun warms it: lit volumes, widening as they rise."""
    m = bpy.data.materials.new('jet')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (0.9, 0.88, 0.85, 1)
    vol.inputs['Anisotropy'].default_value = 0.1
    # Denser at the vent, thinning upward, and torn into wisps.
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    fall = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(sep.outputs['Z'], fall.inputs['Value'])
    fall.inputs['To Min'].default_value = 0.014
    fall.inputs['To Max'].default_value = 0.0004
    wisp = nt.nodes.new('ShaderNodeTexNoise')
    wisp.inputs['Scale'].default_value = 3.0
    wisp.inputs['Detail'].default_value = 6.0
    wisp.inputs['Distortion'].default_value = 1.2
    nt.links.new(tc.outputs['Generated'], wisp.inputs['Vector'])
    torn = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(wisp.outputs['Fac'], torn.inputs['Value'])
    torn.inputs['From Min'].default_value = 0.42
    torn.inputs['From Max'].default_value = 0.7
    dens = nt.nodes.new('ShaderNodeMath')
    dens.operation = 'MULTIPLY'
    nt.links.new(fall.outputs['Result'], dens.inputs[0])
    nt.links.new(torn.outputs['Result'], dens.inputs[1])
    nt.links.new(dens.outputs[0], vol.inputs['Density'])
    nt.links.new(vol.outputs['Volume'], nt.nodes['Material Output'].inputs['Volume'])
    for k, (d, side, r, high) in enumerate(w['jets']):
        cx, cy = ahead(d, side)
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=r, radius2=r * 9, depth=high, location=(cx, cy, height_at(cx, cy) + high / 2 - 4))
        o = bpy.context.active_object
        o.name = f'jet_{k}'
        o.rotation_euler = (0.12 * (k - 1), 0.1 * k, 0)
        o.data.materials.append(m)


def footpad_mounds(w, height_at, yaw_deg):
    """Regolith pushed up round each footpad as it settled, darker where disturbed."""
    m = bpy.data.materials.new('disturbed')
    g = sf.Graph(m)
    v = g.coords()
    base = g.mixc(sf.rgb(w['soil']), (0, 0, 0, 1), g.add(0.35, g.mul(g.noise(v, 6.0, detail=6.0), 0.25)))
    sf._finish(g, base, 0.0, 0.97, g.bump(g.noise(v, 18.0, detail=8.0), 0.8, 0.02), None, None)
    yaw = math.radians(yaw_deg)
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        px, py = sx * 3.2, sy * 3.2
        x = px * math.cos(yaw) - py * math.sin(yaw)
        y = px * math.sin(yaw) + py * math.cos(yaw)
        prof = [(0.95, 0.0), (0.75, 0.05), (0.58, 0.09), (0.5, 0.07), (0.3, 0.03), (0.0, 0.03)]
        seg = 48
        verts = [(x + math.cos(math.tau * i / seg) * r * (1 + 0.08 * noise.noise(Vector((i * 0.3, k, 0)))),
                  y + math.sin(math.tau * i / seg) * r * (1 + 0.08 * noise.noise(Vector((i * 0.3, k, 0)))),
                  height_at(x, y) + z) for r, z in prof for i in range(seg)]
        faces = [(j * seg + i, j * seg + (i + 1) % seg, (j + 1) * seg + (i + 1) % seg, (j + 1) * seg + i)
                 for j in range(len(prof) - 1) for i in range(seg)]
        me = bpy.data.meshes.new(f'mound_{k}')
        me.from_pydata(verts, [], faces)
        for p in me.polygons:
            p.use_smooth = True
        o = bpy.data.objects.new(f'mound_{k}', me)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(m)


# --------------------------------------------------------------------------
# The sky
# --------------------------------------------------------------------------

def sky(w):
    world = bpy.context.scene.world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    if not w.get('sky'):
        bg.inputs['Color'].default_value = (0.0, 0.0, 0.0, 1.0)
        bg.inputs['Strength'].default_value = 0.0
        return
    horizon, zenith = w['sky']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(sep.outputs['Z'], ramp.inputs['Value'])
    ramp.inputs['From Min'].default_value = 0.0
    ramp.inputs['From Max'].default_value = 0.6
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(ramp.outputs['Result'], mix.inputs[0])
    mix.inputs[6].default_value = sf.rgb(horizon)
    mix.inputs[7].default_value = sf.rgb(zenith)
    colour = mix.outputs[2]
    if w.get('glow'):
        # The sky brightens toward a low sun: forward scattering by the dust.
        az, el = (math.radians(a) for a in w['sun'])
        sun = (math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))
        dot = nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        nt.links.new(tc.outputs['Generated'], dot.inputs[0])
        dot.inputs[1].default_value = sun
        pw = nt.nodes.new('ShaderNodeMath')
        pw.operation = 'POWER'
        clamp = nt.nodes.new('ShaderNodeMath')
        clamp.operation = 'MAXIMUM'
        nt.links.new(dot.outputs['Value'], clamp.inputs[0])
        clamp.inputs[1].default_value = 0.0
        nt.links.new(clamp.outputs[0], pw.inputs[0])
        pw.inputs[1].default_value = 24.0
        add = nt.nodes.new('ShaderNodeMix')
        add.data_type = 'RGBA'
        add.blend_type = 'ADD'
        add.clamp_result = False
        nt.links.new(pw.outputs[0], add.inputs[0])
        nt.links.new(colour, add.inputs[6])
        add.inputs[7].default_value = tuple(c * 6 for c in sf.rgb(w['glow'])[:3]) + (1.0,)
        colour = add.outputs[2]
    nt.links.new(colour, bg.inputs['Color'])
    bg.inputs['Strength'].default_value = w.get('sky_strength', 0.9)
    if w.get('haze'):
        # Haze in a finite box round the scene. A world volume fills infinite
        # space, so a sun at infinity never reaches the ground through it.
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 150))
        box = bpy.context.active_object
        box.name = 'haze'
        box.scale = (3200, 3200, 340)
        hm = bpy.data.materials.new('haze')
        hm.use_nodes = True
        hnt = hm.node_tree
        hnt.nodes.remove(hnt.nodes['Principled BSDF'])
        vol = hnt.nodes.new('ShaderNodeVolumeScatter')
        vol.inputs['Density'].default_value = w['haze']
        vol.inputs['Anisotropy'].default_value = 0.6
        vol.inputs['Color'].default_value = sf.rgb(w.get('haze_colour', '#e8b07c'))
        # Scattering alone takes the haze's own colour out of the light passing
        # straight through and leaves the complement: a thick orange haze turned
        # the sky teal. The haze absorbs the blue as well, which is what tints it.
        ab = hnt.nodes.new('ShaderNodeVolumeAbsorption')
        ab.inputs['Density'].default_value = w['haze'] * 0.35
        ab.inputs['Color'].default_value = sf.rgb(w.get('haze_colour', '#e8b07c'))
        both = hnt.nodes.new('ShaderNodeAddShader')
        hnt.links.new(vol.outputs['Volume'], both.inputs[0])
        hnt.links.new(ab.outputs['Volume'], both.inputs[1])
        hnt.links.new(both.outputs['Shader'], hnt.nodes['Material Output'].inputs['Volume'])
        box.data.materials.append(hm)


def sky_body(w):
    """The parent planet (or Charon) at its true angular size, placed relative to the camera's view."""
    b = w.get('body')
    if not b:
        return
    origin, target, _ = w.get('camera', CAMERA)
    forward = Vector(target) - Vector(origin)
    heading = math.atan2(forward.y, forward.x)
    az = heading + math.radians(b['azimuth'])
    el = math.radians(b['elevation'])
    distance = 60000.0
    d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    radius = distance * math.tan(math.radians(b['diameter_deg'] / 2))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=radius, location=Vector(origin) + d * distance)
    o = bpy.context.active_object
    for p in o.data.polygons:
        p.use_smooth = True
    m = bpy.data.materials.new(b['kind'])
    g = sf.Graph(m)
    v = g.coords()
    if b['kind'] == 'earth':
        img = bpy.data.images.load(os.path.join(ROOT, 'public', 'textures', 'earth_day.jpg'))
        t = g.node('ShaderNodeTexImage', image=img)
        g.put(t.inputs['Vector'], g.node('ShaderNodeTexCoord').outputs['UV'])
        o.rotation_euler = Euler((math.radians(-20), 0.0, math.radians(110)))
        sf._finish(g, t.outputs['Color'], 0.0, 0.6, None, None, None)
    elif b['kind'] == 'jupiter':
        z = g.xyz(v)[2]
        warp = g.mul(g.noise(v, 2.0 / radius, detail=6.0, distortion=1.5), radius * 0.08)
        lat = g.mul(g.add(z, warp), 1.0 / radius)
        bands = g.math('SINE', g.mul(lat, 11.0))
        fine = g.math('SINE', g.mul(lat, 37.0))
        base = g.mixc(sf.rgb('#d9c9ae'), sf.rgb('#a8724e'), g.remap(g.add(bands, g.mul(fine, 0.3)), -1.0, 1.0))
        base = g.mixc(base, sf.rgb('#efe6d6'), g.mul(g.remap(fine, 0.6, 1.0), 0.5))
        sf._finish(g, base, 0.0, 0.8, None, None, None)
    elif b['kind'] == 'mars':
        # Rust plains, dark basaltic regions, a white polar cap.
        z = g.xyz(v)[2]
        dark = g.remap(g.noise(v, 1.6 / radius, detail=6.0, distortion=0.6), 0.48, 0.62)
        base = g.mixc(sf.rgb('#c0703f'), sf.rgb('#6e3d27'), g.mul(dark, 0.8))
        base = g.mixc(base, sf.rgb('#efe8e0'), g.remap(g.mul(z, 1.0 / radius), 0.86, 0.9))
        sf._finish(g, base, 0.0, 0.9, g.bump(g.noise(v, 8.0 / radius, detail=6.0), 0.3, radius * 0.01), None, None)
    else:
        # Charon: grey water ice, a red-brown polar stain (Mordor Macula).
        z = g.xyz(v)[2]
        base = g.mixc(sf.rgb('#9a948c'), sf.rgb('#7d7770'), g.remap(g.noise(v, 3.0 / radius, detail=6.0), 0.4, 0.7))
        base = g.mixc(base, sf.rgb('#6e3a2a'), g.remap(g.mul(z, 1.0 / radius), 0.7, 0.9))
        sf._finish(g, base, 0.0, 0.9, None, None, None)
    o.data.materials.append(m)
    # Lit by the same sun, but not casting shadow on the landscape.
    o.visible_shadow = False


# --------------------------------------------------------------------------
# The vehicles and the rocks, from the shipped files
# --------------------------------------------------------------------------

def import_glb(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(AUTHORED, f'{name}.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    return new, roots


def place(roots, location, yaw):
    for r in roots:
        r.location = Vector(location) + r.location
        r.rotation_euler.z += math.radians(yaw)


def rocks(w, height_at, rng):
    objs, _ = import_glb('rocks')
    shapes = [o for o in objs if o.type == 'MESH']
    mat = shapes[0].active_material.copy()
    tint = mat.node_tree.nodes.new('ShaderNodeMix')
    tint.data_type = 'RGBA'
    tint.blend_type = 'MULTIPLY'
    tint.clamp_result = False
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    src = bsdf.inputs['Base Color'].links[0].from_socket
    tint.inputs[0].default_value = 1.0
    mat.node_tree.links.new(src, tint.inputs[6])
    c = sf.rgb(w['rock_tint'])
    tint.inputs[7].default_value = (c[0] * 2, c[1] * 2, c[2] * 2, 1)
    mat.node_tree.links.new(tint.outputs[2], bsdf.inputs['Base Color'])
    for s in shapes:
        s.active_material = mat
    lake_at = ahead(*w['lake'][1:3]) if w.get('lake') else None
    for i in range(420):
        a = rng.uniform(0, math.tau)
        r = 7 + 170 * rng.random() ** 1.6
        x, y = math.cos(a) * r, math.sin(a) * r
        size = 0.1 + rng.random() ** 5 * 2.2
        if math.hypot(x + 8.5, y + 16.5) < 6.0 + size * 2:
            continue
        if lake_at and math.hypot(x - lake_at[0], y - lake_at[1]) < w['lake'][3] * 1.1:
            continue
        src = shapes[i % len(shapes)]
        o = bpy.data.objects.new(f'stone_{i}', src.data)
        bpy.context.scene.collection.objects.link(o)
        o.scale = (size * rng.uniform(0.8, 1.3), size * rng.uniform(0.8, 1.3), size * rng.uniform(0.5, 0.85))
        o.rotation_euler = (rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), rng.uniform(0, math.tau))
        o.location = (x, y, height_at(x, y) + size * 0.12)
    for s in shapes:
        s.hide_render = True


# --------------------------------------------------------------------------
# One world
# --------------------------------------------------------------------------

def render_world(world, w, out_dir, fast):
    pz.reset_scene()
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new('world')
    rng = np.random.default_rng(sum(map(ord, world)))
    _, height_at = terrain(w, world, step=8.0 if fast else 4.0)
    if w.get('mesas'):
        mesas(height_at)
    if w.get('lake'):
        lake(w, height_at)
    if w.get('jets'):
        jets(w, height_at)
    sky(w)
    rocks(w, height_at, rng)

    _, lander = import_glb('survey-lander')
    place(lander, (0.0, 0.0, height_at(0, 0) + 2.6), -20)
    footpad_mounds(w, height_at, -20)
    if w.get('peaks'):
        peaks(w['peaks'], height_at, rng)
    if not w.get('hopper'):
        # Hoppers survey with the lander itself; there is no rover to bring.
        _, rover = import_glb('survey-rover')
        place(rover, (3.0, -4.5, height_at(3.0, -4.5)), 35)
    _, kit_roots = import_glb('survey-kit')
    keep = {'seismometer', 'stake'}
    for o in kit_roots:
        base = o.name.split('.')[0]
        if base not in keep:
            for c in [o] + list(o.children_recursive):
                c.hide_render = True
        elif base == 'seismometer':
            o.location = (-6.5, 3.0, height_at(-6.5, 3.0))
        else:
            o.location = (-3.0, -6.0, height_at(-3.0, -6.0))

    # The Sun: its true angular size at the world's distance, from (azimuth, elevation).
    az, el = (math.radians(a) for a in w['sun'])
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = w['sun_power']
    sun.angle = math.radians(0.53 * {'mercury': 2.6, 'io': 0.19, 'europa': 0.19, 'ganymede': 0.19, 'callisto': 0.19, 'titan': 0.1, 'pluto': 0.025}.get(world, 1.0))
    sun.color = sf.rgb(w['sun_colour'])[:3] if w.get('sun_colour') else (1.0, 0.96, 0.9) if not w.get('sky') else (1.0, 0.9, 0.78)
    so = bpy.data.objects.new('sun', sun)
    scene.collection.objects.link(so)
    toward = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    so.rotation_euler = (-toward).to_track_quat('-Z', 'Y').to_euler()

    origin, target, lens = w.get('camera', CAMERA)
    cam = bpy.data.cameras.new('camera')
    cam.lens = lens
    cam.clip_end = 200000
    co = bpy.data.objects.new('camera', cam)
    scene.collection.objects.link(co)
    co.location = Vector(origin) + Vector((0, 0, height_at(origin[0], origin[1])))
    aim = Vector(target) + Vector((0, 0, height_at(0, 0)))
    co.rotation_euler = (aim - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co
    sky_body(w)

    sf._cycles(32 if fast else 256, device='GPU')
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = (640, 360) if fast else (1280, 720)
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = w['exposure']
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 82
    if pz.live():
        # In an open Blender: leave the scene set up, looking through its
        # camera, for whoever is watching to explore; the render is headless.
        print(f'PZ-LIVE {world} scene built; not rendering in the open window')
        return
    path = os.path.join(out_dir, f'world-{world}.webp')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'PZ-WROTE {path}')


def main():
    a = pz.cli()
    out_dir = a['out'] or ('' if pz.live() else None)
    if out_dir is None:
        raise SystemExit('--out <directory> is required')
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    only = os.environ.get('PZ_WORLD')
    for world, w in WORLDS.items():
        if not only or world in only.split(','):
            render_world(world, w, out_dir, a['fast'])


main()
