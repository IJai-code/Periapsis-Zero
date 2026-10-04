"""
Ground detail for each world: a real patch of ground, baked to a tile.

Run through the build command:

    npm run art:build -- ground

The expedition terrain is a 12 m lattice. Everything smaller than that, the
grit, pebbles, craterlets, wind ripples and ice cracks that make ground read
as ground at walking distance, comes from these textures. Each is made the
way a texture artist would make it by hand, but from a script:

1. A 4 x 4 m heightfield, periodic by construction (spectral synthesis on the
   tile's own Fourier grid), with each world's small features added on the
   same wrapped grid: craterlets on the Moon, ripples on Mars, cracks on Europa.
2. Pebbles and rocks as real 3D meshes, half buried, copied across the tile's
   edges so a rock cut by one edge continues on the other.
3. Cycles bakes that geometry onto a flat 4 m tile: the normal map, the colour
   (through an emission pass, so nothing is lit), and ambient occlusion around
   every pebble, which is multiplied into the colour.

Two WebP images a world, 1024 px (4 mm a texel):

    <world>-detail.webp   colour detail, normalised so its linear mean is 0.5;
                          the terrain shader multiplies its palette by 2x this
    <world>-normal.webp   tangent space, +U along +x and +V along -z (three.js)

The output directory is the --out argument; art.mjs passes public/authored.
"""

import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

import pz  # noqa: E402
import surfacing as sf  # noqa: E402

L = 4.0          # tile size, metres
BORDER = 0.4     # geometry beyond the tile, so occlusion at the edges matches the other side

WORLDS = {
    'moon': {
        'seed': 11, 'rough_amp': 0.012, 'beta': 2.6,
        'soil': '#8f8a83', 'soil_dark': '#6f6b65', 'rock': ['#5c5955', '#77736c', '#4a4743'],
        'pebbles': 230, 'big': 9, 'craterlets': 22,
    },
    'mars': {
        'seed': 23, 'rough_amp': 0.009, 'beta': 2.4,
        'soil': '#b46c42', 'soil_dark': '#8e4f30', 'rock': ['#4f2d22', '#6e3b28', '#3e2a24'],
        'pebbles': 340, 'big': 12, 'ripples': True,
    },
    'europa': {
        'seed': 37, 'rough_amp': 0.006, 'beta': 2.9,
        'soil': '#dfe5e6', 'soil_dark': '#c3cfd3', 'rock': ['#e9eef0', '#cdd8dc', '#b9c5ca'],
        'pebbles': 50, 'big': 4, 'cracks': 26,
    },
}


# --------------------------------------------------------------------------
# The heightfield, on a periodic grid
# --------------------------------------------------------------------------

def heightfield(w, n):
    """Heights (metres) and two colour factors on an n x n periodic grid."""
    rng = np.random.default_rng(w['seed'])
    k = np.fft.fftfreq(n, d=L / n)
    kx, ky = np.meshgrid(k, k)
    kk = np.hypot(kx, ky)
    kk[0, 0] = 1.0
    spectrum = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) * kk ** (-w['beta'] / 2)
    spectrum[0, 0] = 0
    h = np.real(np.fft.ifft2(spectrum))
    h = h / h.std() * w['rough_amp']

    xs = (np.arange(n) + 0.5) * L / n
    X, Y = np.meshgrid(xs, xs)
    cavity = np.zeros_like(h)
    stain = np.zeros_like(h)

    def wrapped(cx, cy):
        dx = (X - cx + L / 2) % L - L / 2
        dy = (Y - cy + L / 2) % L - L / 2
        return dx, dy

    for _ in range(w.get('craterlets', 0)):
        cx, cy = rng.uniform(0, L, 2)
        r = rng.uniform(0.04, 0.22) * (1 if rng.random() > 0.15 else 2.2)
        dx, dy = wrapped(cx, cy)
        q = np.hypot(dx, dy) / r
        bowl = -0.22 * r * np.clip(1 - q * q, 0, None) + 0.07 * r * np.exp(-((q - 1) / 0.25) ** 2)
        h += bowl
        cavity += np.clip(1 - q, 0, 1) * 0.5

    if w.get('ripples'):
        # Wind ripples: about 28 cm crest to crest, wandering, a centimetre high.
        warp = np.real(np.fft.ifft2(np.fft.fft2(rng.normal(size=(n, n))) * (kk < 0.9) ))
        warp = warp / warp.std() * 0.35
        phase = 2 * math.pi * (X * math.cos(0.4) + Y * math.sin(0.4)) / L * 14 + warp * 3
        ripple = 0.5 + 0.5 * np.sin(phase)
        h += 0.011 * ripple ** 1.6
        stain += (1 - ripple) * 0.35

    if w.get('cracks'):
        # Ice broken into plates: each Voronoi cell (wrapped) is a slab with
        # its own height and tilt, the gaps between them cut a few
        # centimetres deep; some gaps carry the brown material that seeps up.
        pts = rng.uniform(0, L, (w['cracks'], 2))
        lift = rng.normal(0, 0.012, w['cracks'])
        tilt = rng.normal(0, 0.03, (w['cracks'], 2))
        brown = rng.random(w['cracks']) < 0.35
        d1 = np.full(h.shape, 1e9); d2 = np.full(h.shape, 1e9)
        owner = np.zeros(h.shape, dtype=np.int32)
        dxo = np.zeros(h.shape); dyo = np.zeros(h.shape)
        for k, (cx, cy) in enumerate(pts):
            dx, dy = wrapped(cx, cy)
            d = np.hypot(dx, dy)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d))
            owner = np.where(closer, k, owner)
            dxo = np.where(closer, dx, dxo); dyo = np.where(closer, dy, dyo)
            d1 = np.minimum(d1, d)
        edge = d2 - d1
        slab = lift[owner] + tilt[owner, 0] * dxo + tilt[owner, 1] * dyo
        gap = np.clip(1 - edge / 0.03, 0, 1) ** 1.5
        h += slab * (1 - gap) - 0.03 * gap
        stain += gap * np.where(brown[owner], 1.0, 0.0)
        cavity += gap
    return h, cavity, stain


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

def ground_mesh(w, h, cavity, stain, step):
    """The heightfield as a mesh over the tile plus its border, sampled with wrap."""
    n = h.shape[0]
    count = int(round((L + 2 * BORDER) / step)) + 1
    verts, colours = [], []
    for j in range(count):
        y = -BORDER + j * step
        for i in range(count):
            x = -BORDER + i * step
            gi = int(round(x / L * n - 0.5)) % n
            gj = int(round(y / L * n - 0.5)) % n
            verts.append((x, y, float(h[gj, gi])))
            colours.append((float(cavity[gj, gi]), float(stain[gj, gi])))
    faces = [(j * count + i, j * count + i + 1, (j + 1) * count + i + 1, (j + 1) * count + i)
             for j in range(count - 1) for i in range(count - 1)]
    mesh = bpy.data.meshes.new('ground_high')
    mesh.from_pydata(verts, [], faces)
    attr = mesh.color_attributes.new('marks', 'FLOAT_COLOR', 'POINT')
    for k, (c, s) in enumerate(colours):
        attr.data[k].color = (c, s, 0.0, 1.0)
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new('ground_high', mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rock_mesh(name, seed, size, height_at):
    """A broken stone: a displaced icosphere, flattened where it sits, half buried."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))
    for v in bm.verts:
        p = v.co.copy()
        k = 0.78 + 0.3 * noise.noise(p * 1.4 + off) + 0.1 * noise.noise(p * 3.7 + off) + 0.04 * noise.noise(p * 9.0 + off)
        # Fracture planes: stone breaks flat.
        for a in range(3):
            nrm = Vector((math.sin(seed * 3.1 + a * 2.1), math.cos(seed * 1.7 + a * 1.3), math.sin(seed + a)))
            nrm.normalize()
            if p.dot(nrm) > 0.55:
                k = min(k, 0.55 / max(p.dot(nrm), 1e-3) * 1.05)
        v.co = p * k
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj, size


def scatter(w, rng, height_at, mats):
    """Pebbles and rocks, wrapped across the tile's edges."""
    rocks = []
    total = w['pebbles'] + w['big']
    for i in range(total):
        big = i >= w['pebbles']
        size = rng.uniform(0.05, 0.15) if big else 0.008 + rng.random() ** 2.2 * 0.05
        x, y = rng.uniform(0, L, 2)
        sx, sy, sz = rng.uniform(0.8, 1.25), rng.uniform(0.8, 1.25), rng.uniform(0.45, 0.8)
        rot = rng.uniform(0, math.tau, 3)
        sink = rng.uniform(0.25, 0.5)
        mat = mats[int(rng.integers(len(mats)))]
        base, _ = rock_mesh(f'rock_{i}', int(rng.integers(1, 10_000)), size, height_at)
        base.data.materials.append(mat)
        for ox in (-L, 0.0, L):
            for oy in (-L, 0.0, L):
                px, py = x + ox, y + oy
                if not (-BORDER - size < px < L + BORDER + size and -BORDER - size < py < L + BORDER + size):
                    continue
                o = base if (ox, oy) == (0.0, 0.0) else bpy.data.objects.new(f'{base.name}_{ox:+.0f}{oy:+.0f}', base.data)
                if o is not base:
                    bpy.context.scene.collection.objects.link(o)
                o.scale = (size * sx, size * sy, size * sz)
                o.rotation_euler = (rot[0] * 0.15, rot[1] * 0.15, rot[2])
                o.location = (px, py, height_at(x, y) + size * sz * (0.5 - sink))
                rocks.append(o)
        if not any(r is base for r in rocks):
            bpy.data.objects.remove(base)
    return rocks


# --------------------------------------------------------------------------
# Materials for the bake
# --------------------------------------------------------------------------

def soil_material(w):
    m = bpy.data.materials.new('soil')
    g = sf.Graph(m)
    v = g.coords()
    attr = g.node('ShaderNodeAttribute', attribute_name='marks', attribute_type='GEOMETRY')
    marks = g.xyz(attr.outputs['Vector'])
    grain = g.noise(v, 90.0, detail=6.0, rough=0.65)
    patches = g.noise(v, 1.6, detail=4.0)
    base = g.mixc(sf.rgb(w['soil']), sf.rgb(w['soil_dark']), g.remap(patches, 0.3, 0.75, 0.0, 0.7))
    base = g.mixc(base, sf.rgb(w['soil_dark']), g.remap(grain, 0.35, 0.8, 0.0, 0.45))
    # Brighter fine grains, the glints of glass beads and fresh fragments.
    base = g.mixc(base, (0.85, 0.85, 0.85, 1.0), g.mul(g.remap(g.noise(v, 260.0, detail=1.0), 0.72, 0.85), 0.35))
    if w.get('cracks'):
        # Deep blue in the gaps, where light travels further through clean ice.
        base = g.mixc(base, sf.rgb('#7fa3b8'), g.math('MINIMUM', g.mul(marks[0], 0.85), 1.0))
        base = g.mixc(base, sf.rgb('#7c4a32'), g.math('MINIMUM', g.mul(marks[1], 0.8), 1.0))
    else:
        base = g.mixc(base, sf.rgb(w['soil_dark']), g.mul(marks[0], 0.5))
    if w.get('ripples'):
        base = g.mixc(base, sf.rgb(w['soil_dark']), g.mul(marks[1], 0.6))
    bump = g.bump(grain, 0.25, 0.002)
    sf._finish(g, base, 0.0, 0.95, bump, None, None)
    return m


def rock_material(name, colour, w):
    m = bpy.data.materials.new(name)
    g = sf.Graph(m)
    v = g.coords()
    spots = g.noise(v, 18.0, detail=6.0)
    pits = g.voronoi(v, 22.0, 'F1', 'Distance')
    base = g.mixc(sf.rgb(colour), sf.rgb(w['soil']), g.remap(spots, 0.55, 0.8, 0.0, 0.5))
    # Dust settled in the pits and on top.
    up = g.xyz(g.node('ShaderNodeNewGeometry').outputs['Normal'])[2]
    base = g.mixc(base, sf.rgb(w['soil']), g.mul(g.remap(up, 0.6, 1.0), 0.45))
    h = g.add(g.mul(spots, 0.6), g.mul(g.remap(pits, 0.0, 0.25, -1.0, 0.0), 0.4))
    sf._finish(g, base, 0.0, 0.85, g.bump(h, 0.6, 0.003), None, None)
    return m


# --------------------------------------------------------------------------
# Bake one world
# --------------------------------------------------------------------------

def bake_world(world, w, out_dir, size, fast):
    t0 = time.time()
    stamp = lambda label: print(f'PZ-TIME {world} {label} {time.time() - t0:.1f}s', flush=True)
    pz.reset_scene()
    n = 512 if fast else 1024
    h, cavity, stain = heightfield(w, n)

    def height_at(x, y):
        return float(h[int(y / L * n) % n, int(x / L * n) % n])

    step = 0.012 if fast else 0.008
    ground = ground_mesh(w, h, cavity, stain, step)
    ground.data.materials.append(soil_material(w))
    stamp('ground mesh')
    rng = np.random.default_rng(w['seed'] + 1000)
    mats = [rock_material(f'rock_{k}', c, w) for k, c in enumerate(w['rock'])]
    rocks = scatter(w, rng, height_at, mats)
    stamp('rocks')

    # The target: a flat tile, UVs 0..1 over it, invisible to every ray.
    bpy.ops.mesh.primitive_plane_add(size=L, location=(L / 2, L / 2, 0.0))
    tile = bpy.context.active_object
    tile.name = 'tile'
    for attr in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
        setattr(tile, attr, False)
    tm = bpy.data.materials.new('tile')
    tm.use_nodes = True
    tile.data.materials.append(tm)

    # Four samples a texel is enough for colour and normals (they are
    # antialiasing, not noise); occlusion gets more. On the CPU: Metal measured
    # four times slower for these selected-to-active bakes.
    sf._cycles(4)
    scene = bpy.context.scene
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.25
    scene.render.bake.max_ray_distance = 0.6
    scene.world.light_settings.distance = 0.06

    sources = [ground] + rocks
    materials = [m for m in bpy.data.materials if m.name != 'tile' and m.node_tree and any(n.type == 'BSDF_PRINCIPLED' for n in m.node_tree.nodes)]

    def bake(kind, img, **kw):
        nodes = tm.node_tree.nodes
        node = nodes.get('pz_bake') or nodes.new('ShaderNodeTexImage')
        node.name = 'pz_bake'
        node.image = img
        nodes.active = node
        for o in bpy.context.scene.objects:
            o.select_set(False)
        for o in sources:
            o.select_set(True)
        tile.select_set(True)
        bpy.context.view_layer.objects.active = tile
        bpy.ops.object.bake(type=kind, use_clear=True, margin=0, **kw)

    colour = sf._image(f'{world}_colour', size, data=False)
    normal = sf._image(f'{world}_normal', size, data=True)
    ao = sf._image(f'{world}_ao', size, data=True)
    undo = sf._to_emission(materials, 'Base Color')
    bake('EMIT', colour)
    sf._restore(undo)
    stamp('colour')
    bake('NORMAL', normal, normal_space='TANGENT')
    stamp('normal')
    scene.cycles.samples = 24 if fast else 48
    bake('AO', ao)
    stamp('occlusion')

    # Colour times a softened occlusion, then normalised to a 0.5 linear mean,
    # so the shader's palette sets the world's colour and this sets its texture.
    c = sf._pixels(colour)[:, :3] * (0.35 + 0.65 * sf._pixels(ao)[:, :1])
    c = sf.normalise_srgb(c, 0.5)
    detail = sf._image(f'{world}-detail', size, data=False)
    px = np.ones((size * size, 4), dtype=np.float32)
    px[:, :3] = c
    detail.pixels.foreach_set(px.ravel())
    for img, name in ((detail, f'{world}-detail'), (normal, f'{world}-normal')):
        img.filepath_raw = os.path.join(out_dir, f'{name}.webp')
        img.file_format = 'WEBP'
        img.save(quality=90)
        print(f'PZ-WROTE {img.filepath_raw}')
    print(f'PZ-ROCKS {world} {len(rocks)}')


def main():
    a = pz.cli()
    out_dir = a['out']
    if not out_dir:
        raise SystemExit('--out <directory> is required')
    os.makedirs(out_dir, exist_ok=True)
    only = os.environ.get('PZ_WORLD')
    for world, w in WORLDS.items():
        if only and world != only:
            continue
        bake_world(world, w, out_dir, 512 if a['fast'] else 1024, a['fast'])


main()
