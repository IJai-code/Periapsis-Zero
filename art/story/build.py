"""
The story's chapter art, rendered in Cycles from the game's own assets.

    npm run art:build -- story

Each chapter of the survey campaign opens on a briefing photograph of where
it happens. These are those photographs, made the way a film's key art is:
the shipped models (lander, rover, instrument kit, rock set) and the baked
ground textures, placed on a landscape, lit by one sun of the right size, and
path traced. Nothing in them is painted over; nothing is a third party's.

- Moon: southern highlands, Earth low in a black sky (NASA's Blue Marble,
  already in public/textures), long shadows.
- Mars: a sediment plain under layered mesas, the dusty sky.
- Europa: ridged ice, Jupiter at its true twelve degrees across.

Writes public/stills/story-<world>.webp, 1600 x 900. Path tracing is not
bit-reproducible across machines, so this asset is not held to --check.
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

WORLDS = {
    'moon': {
        'soil': '#8c8780', 'rock_tint': '#6d6863', 'relief': 9.0, 'far_relief': 70.0,
        'sun': (215.0, 21.0), 'sun_power': 6.5, 'sky': None, 'exposure': -0.35,
        'camera': ((-8.5, -16.5, 1.8), (1.5, 2.5, 2.0), 32.0),
        'body': {'kind': 'earth', 'azimuth': 9.0, 'elevation': 7.5, 'diameter_deg': 1.9},
    },
    'mars': {
        'soil': '#b8693c', 'rock_tint': '#6b3f2c', 'relief': 4.0, 'far_relief': 30.0,
        'sun': (78.0, 9.0), 'sun_power': 4.6, 'sky': ('#e9b47c', '#6e4a38'), 'exposure': 0.35,
        'haze': 0.0003, 'glow': '#ffcf8a',
        'camera': ((-9.0, -17.0, 1.8), (1.5, 4.0, 2.6), 30.0),
        'mesas': True,
    },
    'europa': {
        'soil': '#d9e1e2', 'rock_tint': '#b6c4c8', 'relief': 2.5, 'far_relief': 45.0,
        'sun': (205.0, 22.0), 'sun_power': 3.4, 'sky': None, 'exposure': 0.15,
        'camera': ((-13.0, -27.0, 1.8), (1.5, 4.0, 5.0), 42.0),
        'peaks': True,
        'body': {'kind': 'jupiter', 'azimuth': 9.0, 'elevation': 10.5, 'diameter_deg': 12.0},
    },
}


# --------------------------------------------------------------------------
# The landscape
# --------------------------------------------------------------------------

def heights(w, xs, ys):
    """Gentle ground near the lander rising into real relief toward the horizon."""
    h = np.zeros((len(ys), len(xs)))
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            r = math.hypot(x, y)
            # Rolling, not lumpy: long wavelengths, and the fractal's higher
            # octaves turned well down, the way old ground is sanded smooth.
            near = w['relief'] * noise.fractal(Vector((x / 140, y / 140, 0.3)), 0.35, 2.0, 3)
            far = w['far_relief'] * noise.fractal(Vector((x / 900, y / 900, 1.7)), 0.4, 2.0, 3)
            flat = min(1.0, max(0.0, (r - 40.0) / 260.0))
            v = near * (0.2 + 0.8 * flat) + far * flat ** 1.5
            if w.get('ridges'):
                # Europa's double ridges: two parallel crests along a line.
                d = (x * 0.6 + y * 0.8 - 260.0)
                v += 38.0 * (math.exp(-((d - 22) / 18) ** 2) + math.exp(-((d + 22) / 18) ** 2)) * flat
            h[j, i] = v
    # The landing site itself is level, the way the game's clearing is.
    return h


def terrain(w, world, size=1400.0, step=2.5):
    n = int(size / step) + 1
    xs = np.linspace(-size / 2, size / 2, n)
    ys = np.linspace(-size / 2, size / 2, n)
    h = heights(w, xs, ys)
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            r = math.hypot(x, y)
            if r < 40:
                h[j, i] *= (r / 40) ** 2
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
    obj.data.materials.append(ground_material(w, world))
    return obj, lambda x, y: float(h[int(round((y + size / 2) / step)), int(round((x + size / 2) / step))])


def ground_material(w, world):
    """The baked ground tile (art/ground) on the world's palette, at two scales."""
    m = bpy.data.materials.new(f'{world}_ground')
    g = sf.Graph(m)
    uv = g.node('ShaderNodeUVMap', uv_map='UVMap').outputs['UV']
    detail = bpy.data.images.load(os.path.join(AUTHORED, 'ground', f'{world}-detail.webp'))
    normal = bpy.data.images.load(os.path.join(AUTHORED, 'ground', f'{world}-normal.webp'))
    normal.colorspace_settings.name = 'Non-Color'
    def tex(img, vector):
        t = g.node('ShaderNodeTexImage', image=img, interpolation='Cubic')
        g.put(t.inputs['Vector'], vector)
        return t.outputs['Color']
    big = g.node('ShaderNodeMapping')
    g.put(big.inputs['Vector'], uv)
    big.inputs['Scale'].default_value = (4 / 17.3, 4 / 17.3, 1)
    big.inputs['Rotation'].default_value = (0, 0, 0.6)
    a = tex(detail, uv)
    b = tex(detail, big.outputs['Vector'])
    d = g.mixc(a, b, 0.35, blend='MULTIPLY')
    palette = g.mixc(sf.rgb(w['soil']), (0, 0, 0, 1), g.remap(g.noise(g.coords(), 0.02, detail=5.0), 0.3, 0.75, 0.0, 0.25))
    base = g.mixc(palette, d, 1.0, blend='MULTIPLY')
    scale2 = g.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY', clamp_result=False)
    g.put(scale2.inputs[0], 1.0); g.put(scale2.inputs[6], base); g.put(scale2.inputs[7], (2.0, 2.0, 2.0, 1.0))
    nm = g.node('ShaderNodeNormalMap', uv_map='UVMap')
    g.put(nm.inputs['Color'], tex(normal, uv))
    nm.inputs['Strength'].default_value = 1.0
    sf._finish(g, scale2.outputs[2], 0.0, 0.96, nm.outputs['Normal'], None, None)
    return m


def mesas(w, height_at):
    """Layered buttes on the skyline: displaced cylinders in banded sediment."""
    m = bpy.data.materials.new('strata')
    g = sf.Graph(m)
    v = g.coords()
    z = g.xyz(v)[2]
    warp = g.mul(g.noise(v, 0.02, detail=4.0), 14.0)
    bands = g.math('SINE', g.mul(g.add(z, warp), 2 * math.pi / 9.0))
    fine = g.math('SINE', g.mul(g.add(z, warp), 2 * math.pi / 2.3))
    base = g.mixc(sf.rgb('#7a3f26'), sf.rgb('#c48759'), g.remap(g.add(bands, g.mul(fine, 0.3)), -1.0, 1.0))
    base = g.mixc(base, sf.rgb('#5a2c1c'), g.mul(g.remap(g.noise(v, 0.15, detail=6.0), 0.55, 0.8), 0.6))
    h = g.add(g.mul(fine, 0.3), g.noise(v, 0.4, detail=8.0))
    sf._finish(g, base, 0.0, 0.95, g.bump(h, 0.5, 0.8), None, None)
    for k, (x, y, r, top) in enumerate(((-420, 780, 210, 170), (180, 900, 260, 210), (620, 700, 170, 130), (-820, 560, 190, 120))):
        butte(f'mesa_{k}', x, y, height_at(0, 0) - 12, r, top, m, seed=k * 7 + 3)


def butte(name, cx, cy, z0, radius, top, mat, seed):
    """A butte: a scree apron, steep layered walls, a flat cap, ragged in plan."""
    profile = [(-0.15, 1.45), (0.0, 1.32), (0.12, 1.12), (0.22, 1.03), (0.55, 0.99), (0.85, 0.96), (0.97, 0.93), (1.0, 0.86), (1.01, 0.4), (1.012, 0.0)]
    seg = 160
    verts, faces = [], []
    for zf, rf in profile:
        for i in range(seg):
            a = math.tau * i / seg
            p = Vector((math.cos(a), math.sin(a), zf * 3.0))
            jag = 1.0 + 0.13 * noise.noise(p * 2.2 + Vector((seed, 0, 0))) + 0.05 * noise.noise(p * 7.0 + Vector((0, seed, 0)))
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


def ice_peaks(height_at, rng):
    """Jagged ice massifs on the skyline: lathed cones, torn by noise, sharp at the top."""
    m = bpy.data.materials.new('ice_peaks')
    g = sf.Graph(m)
    v = g.coords()
    up = g.xyz(g.node('ShaderNodeNewGeometry').outputs['Normal'])[2]
    base = g.mixc(sf.rgb('#a9c3d0'), sf.rgb('#f2f6f7'), g.remap(up, 0.2, 0.75))
    base = g.mixc(base, sf.rgb('#8a6a55'), g.mul(g.remap(g.noise(v, 0.01, detail=5.0), 0.62, 0.8), 0.4))
    bsdf = sf._finish(g, base, 0.0, 0.35, g.bump(g.noise(v, 0.08, detail=8.0), 0.6, 3.0), None, None)
    bsdf.inputs['Subsurface Weight'].default_value = 0.15
    for k in range(16):
        a = math.radians(48 + k * 6.2 + rng.uniform(-2, 2))
        dist = rng.uniform(900, 1700)
        x, y = math.cos(a) * dist, math.sin(a) * dist
        height = rng.uniform(140, 340)
        radius = height * rng.uniform(0.7, 1.1)
        profile = [(radius * f, height * (1 - f) ** 1.6) for f in (1.0, 0.8, 0.6, 0.42, 0.26, 0.12, 0.03)]
        verts, faces, seg = [], [], 64
        for j, (r, z) in enumerate(profile):
            for i in range(seg):
                t = math.tau * i / seg
                p = Vector((math.cos(t), math.sin(t), z / height * 2))
                jag = 1 + 0.35 * noise.noise(p * 2.5 + Vector((k * 3.1, 0, 0))) + 0.15 * noise.noise(p * 7 + Vector((0, k, 0)))
                verts.append((x + math.cos(t) * r * jag, y + math.sin(t) * r * jag, height_at(0, 0) - 30 + z * (0.9 + 0.2 * jag)))
        for j in range(len(profile) - 1):
            for i in range(seg):
                a0, a1 = j * seg + i, j * seg + (i + 1) % seg
                faces.append((a0, a1, a1 + seg, a0 + seg))
        me = bpy.data.meshes.new(f'peak_{k}')
        me.from_pydata(verts, [], faces)
        o = bpy.data.objects.new(f'peak_{k}', me)
        bpy.context.scene.collection.objects.link(o)
        o.data.materials.append(m)
        disp = o.modifiers.new('torn', 'DISPLACE')
        t = bpy.data.textures.new(f'peak_tex_{k}', 'VORONOI')
        t.noise_scale = 40.0
        disp.texture = t
        disp.strength = 18.0
        sub = o.modifiers.new('detail', 'SUBSURF'); sub.levels = 0; sub.render_levels = 2
        o.modifiers.move(1, 0)


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
    if w['sky'] is None:
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
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(ramp.outputs['Result'], mix.inputs[0])
    mix.inputs[6].default_value = sf.rgb(horizon)
    mix.inputs[7].default_value = sf.rgb(zenith)
    colour = mix.outputs[2]
    if w.get('glow'):
        # The sky brightens toward a low sun: forward scattering by the dust.
        az, el = (math.radians(a) for a in w['sun'])
        sun = (math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))
        dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
        nt.links.new(tc.outputs['Generated'], dot.inputs[0])
        dot.inputs[1].default_value = sun
        pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'
        clamp = nt.nodes.new('ShaderNodeMath'); clamp.operation = 'MAXIMUM'
        nt.links.new(dot.outputs['Value'], clamp.inputs[0]); clamp.inputs[1].default_value = 0.0
        nt.links.new(clamp.outputs[0], pw.inputs[0]); pw.inputs[1].default_value = 24.0
        add = nt.nodes.new('ShaderNodeMix'); add.data_type = 'RGBA'; add.blend_type = 'ADD'; add.clamp_result = False
        nt.links.new(pw.outputs[0], add.inputs[0])
        nt.links.new(colour, add.inputs[6])
        add.inputs[7].default_value = tuple(c * 6 for c in sf.rgb(w['glow'])[:3]) + (1.0,)
        colour = add.outputs[2]
    nt.links.new(colour, bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.9
    if w.get('haze'):
        # Dust in the air, in a finite box round the scene. A world volume
        # fills infinite space, so a sun at infinity never reaches the ground
        # through it: the first Mars render was black.
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
        vol.inputs['Color'].default_value = sf.rgb('#e8b07c')
        hnt.links.new(vol.outputs['Volume'], hnt.nodes['Material Output'].inputs['Volume'])
        box.data.materials.append(hm)


def sky_body(w, camera):
    """Earth or Jupiter at its true angular size, placed relative to the camera's view."""
    b = w.get('body')
    if not b:
        return
    origin, target, _ = w['camera']
    forward = (Vector(target) - Vector(origin))
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
    if b['kind'] == 'earth':
        img = bpy.data.images.load(os.path.join(ROOT, 'public', 'textures', 'earth_day.jpg'))
        t = g.node('ShaderNodeTexImage', image=img)
        g.put(t.inputs['Vector'], g.node('ShaderNodeTexCoord').outputs['UV'])
        o.rotation_euler = Euler((math.radians(-20), 0.0, math.radians(110)))
        sf._finish(g, t.outputs['Color'], 0.0, 0.6, None, None, None)
    else:
        v = g.coords()
        z = g.xyz(v)[2]
        warp = g.mul(g.noise(v, 2.0 / radius, detail=6.0, distortion=1.5), radius * 0.08)
        lat = g.mul(g.add(z, warp), 1.0 / radius)
        bands = g.math('SINE', g.mul(lat, 11.0))
        fine = g.math('SINE', g.mul(lat, 37.0))
        base = g.mixc(sf.rgb('#d9c9ae'), sf.rgb('#a8724e'), g.remap(g.add(bands, g.mul(fine, 0.3)), -1.0, 1.0))
        base = g.mixc(base, sf.rgb('#efe6d6'), g.mul(g.remap(fine, 0.6, 1.0), 0.5))
        sf._finish(g, base, 0.0, 0.8, None, None, None)
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
    objs, roots = import_glb('rocks')
    shapes = [o for o in objs if o.type == 'MESH']
    mat = shapes[0].active_material.copy()
    tint = mat.node_tree.nodes.new('ShaderNodeMix')
    tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'; tint.clamp_result = False
    bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    src = bsdf.inputs['Base Color'].links[0].from_socket
    tint.inputs[0].default_value = 1.0
    mat.node_tree.links.new(src, tint.inputs[6])
    c = sf.rgb(w['rock_tint'])
    tint.inputs[7].default_value = (c[0] * 2, c[1] * 2, c[2] * 2, 1)
    mat.node_tree.links.new(tint.outputs[2], bsdf.inputs['Base Color'])
    for s in shapes:
        s.active_material = mat
    for i in range(420):
        a = rng.uniform(0, math.tau)
        r = 7 + 170 * rng.random() ** 1.6
        x, y = math.cos(a) * r, math.sin(a) * r
        size = 0.1 + rng.random() ** 5 * 2.2
        if math.hypot(x + 8.5, y + 16.5) < 6.0 + size * 2:
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
# One chapter
# --------------------------------------------------------------------------

def render_world(world, w, out_dir, fast):
    pz.reset_scene()
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new('world')
    rng = np.random.default_rng({'moon': 3, 'mars': 5, 'europa': 7}[world])
    _, height_at = terrain(w, world, step=5.0 if fast else 2.5)
    if w.get('mesas'):
        mesas(w, height_at)
    sky(w)
    rocks(w, height_at, rng)

    _, lander = import_glb('survey-lander')
    place(lander, (0.0, 0.0, height_at(0, 0) + 2.6), -20)
    footpad_mounds(w, height_at, -20)
    if w.get('peaks'):
        ice_peaks(height_at, rng)
    _, rover = import_glb('survey-rover')
    place(rover, (8.5, -5.5, height_at(8.5, -5.5)), 35)
    kit, kit_roots = import_glb('survey-kit')
    keep = {'seismometer', 'stake'}
    for o in kit_roots:
        if o.name.split('.')[0] not in keep:
            for c in [o] + list(o.children_recursive):
                c.hide_render = True
    for o in kit_roots:
        base = o.name.split('.')[0]
        if base == 'seismometer':
            o.location = (-6.5, 3.0, height_at(-6.5, 3.0))
        elif base == 'stake':
            o.location = (-3.0, -6.0, height_at(-3.0, -6.0))

    # The Sun: half a degree across, from (azimuth, elevation) in degrees.
    az, el = (math.radians(a) for a in w['sun'])
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = w['sun_power']
    sun.angle = math.radians(0.53)
    sun.color = (1.0, 0.96, 0.9) if w['sky'] is None else (1.0, 0.9, 0.78)
    so = bpy.data.objects.new('sun', sun)
    scene.collection.objects.link(so)
    toward = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
    so.rotation_euler = (-toward).to_track_quat('-Z', 'Y').to_euler()

    origin, target, lens = w['camera']
    cam = bpy.data.cameras.new('camera')
    cam.lens = lens
    cam.clip_end = 200000
    co = bpy.data.objects.new('camera', cam)
    scene.collection.objects.link(co)
    co.location = Vector(origin) + Vector((0, 0, height_at(origin[0], origin[1])))
    aim = Vector(target) + Vector((0, 0, height_at(0, 0)))
    co.rotation_euler = (aim - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co
    sky_body(w, co)

    sf._cycles(48 if fast else 384, device='GPU')
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = (800, 450) if fast else (1600, 900)
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = w['exposure']
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 86
    if pz.live():
        # In an open Blender: leave the scene set up, looking through its
        # camera, for whoever is watching to explore; the render is headless.
        print(f'PZ-LIVE {world} scene built; not rendering in the open window')
        return
    path = os.path.join(out_dir, f'story-{world}.webp')
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
        if not only or world == only:
            render_world(world, w, out_dir, a['fast'])


main()
