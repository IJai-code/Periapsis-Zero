"""Lowdeck: the city on Hearth's lower ring, for the Godot game.

    blender -b --factory-startup --python art/godot/lowdeck.py -- <out dir>

Writes four models into <out dir>:

  lowdeck-street.glb   the walkable street: a wet road, tiled pavements,
                       storefronts with lit shops behind glass, sign bands,
                       awnings and shutters, five to twelve storeys above
                       (balconies, air-conditioners, pipes, fire escapes),
                       alleys with bins and steam, cables slung across, a
                       skybridge, lamps, bollards, vending machines and food
                       stalls. Empties named mk_<kind>_<n> mark where the
                       game puts neon, lights, steam, seats and people.
  lowdeck-ring.glb     the habitat ring the street runs along the bottom of:
                       its curving floor rising away on both sides until it
                       is overhead, the end bulkheads with their window
                       bands, and the axial light tube along the middle.
  lowdeck-block-a/b/c  far-city towers, instanced by the game all round the
                       ring (game/scripts/sets/lowdeck.gd).

Blender is Z-up and the street runs along Y; Godot reads Y as -Z. Every
mesh is one material by name (game/scripts/art/surfaces.gd) and is merged
per material, so the whole street is a few dozen draws.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Vector as V  # noqa: E402

import kit  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1]
L = 120.0          # walkable street length (y from -60 to 60)
FRONT = 11.0       # storefront line, metres from the street's centre
RING_R = 420.0     # the habitat ring's radius: the street is at its bottom
RING_W = 150.0     # the ring's width along its axis (x)


class Mats:
    """One bmesh per material; `done` turns each into one object."""

    def __init__(self):
        self.b = {}

    def __call__(self, name):
        if name not in self.b:
            self.b[name] = bmesh.new()
        return self.b[name]

    def done(self, prefix, bevels=None):
        """Architecture is flat-shaded and crisp: kit.part's smooth shading
        and weighted normals (made for ship hulls) blur merged boxes into
        tubes, and its bevels multiply thin rails and stairs many times."""
        for name, bm in self.b.items():
            o = kit.part(f'{prefix}{name}', bm, name)
            for mod in list(o.modifiers):
                o.modifiers.remove(mod)
            for p in o.data.polygons:
                p.use_smooth = False
        self.b = {}


def marker(name, at, size=1.0):
    o = bpy.data.objects.new(name, None)
    o.empty_display_size = size
    o.location = at
    bpy.context.collection.objects.link(o)
    return o


def cable(bm, a, b, sag, r=0.035, n=10):
    a, b = V(a), V(b)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.z -= sag * 4 * t * (1 - t)
        pts.append(p)
    for p, q in zip(pts, pts[1:]):
        kit.cylinder(bm, p, q, r, 5)


# --- The street ------------------------------------------------------------

def street(rng):
    m = Mats()
    counts = {}

    def mk(kind, at, size=1.0):
        counts[kind] = counts.get(kind, 0) + 1
        return marker(f'mk_{kind}_{counts[kind]}', at, size)

    # Road, kerbs, pavements.
    kit.box(m('asphalt'), (0, 0, -0.05), (8.2, L, 0.1))
    for sx in (-1, 1):
        kit.box(m('concrete'), (sx * 4.2, 0, 0.04), (0.25, L, 0.2))
        kit.box(m('sidewalk'), (sx * 7.6, 0, 0.04), (6.6, L, 0.2))
    # Lane lines, worn.
    y = -L / 2 + 2
    while y < L / 2 - 2:
        kit.box(m('marking'), (0, y, 0.002), (0.14, 2.4, 0.004))
        y += 5.0
    # Manholes, with steam on some.
    for i, y in enumerate((-41, -17, 9, 33, 52)):
        kit.cylinder(m('metal'), (rng.uniform(-2, 2), y, -0.01), (rng.uniform(-2, 2) * 0 + 0, y, 0.006), 0.45, 12)
        if i % 2 == 0:
            mk('steam', (0, y, 0.05))

    # Buildings down both sides, lot by lot, with alleys between some.
    for sx in (-1, 1):
        y = -L / 2 - 2
        lot = 0
        while y < L / 2 + 2:
            w = rng.choice((10.0, 12.0, 14.0, 16.0))
            building(m, mk, rng, sx, y, w, lot)
            y += w
            if rng.random() < 0.3:
                alley(m, mk, rng, sx, y, 3.0)
                y += 3.0
            lot += 1

    # Cables slung across the street, in bundles.
    for y in (-48, -30, -14, 4, 20, 38, 55):
        z = rng.uniform(7.5, 12.5)
        for k in range(rng.randint(2, 4)):
            cable(m('cable'), (-FRONT, y + k * 0.3, z + k * 0.2), (FRONT, y + rng.uniform(-2, 2), z + rng.uniform(-1, 1)), rng.uniform(0.6, 1.6))
        mk('lantern', (rng.uniform(-3, 3), y, z - 1.0))
    # A skybridge across the street.
    yb = 14.0
    kit.box(m('concrete'), (0, yb, 9.2), (2 * FRONT, 3.2, 0.4))
    kit.box(m('concrete'), (0, yb, 12.0), (2 * FRONT, 3.2, 0.3))
    kit.box(m('shopglass'), (0, yb - 1.55, 10.6), (2 * FRONT - 1, 0.06, 2.4))
    kit.box(m('shopglass'), (0, yb + 1.55, 10.6), (2 * FRONT - 1, 0.06, 2.4))
    for x in (-FRONT + 0.3, 0, FRONT - 0.3):
        kit.box(m('concrete'), (x, yb, 10.6), (0.3, 3.2, 2.8))
    mk('bridge_neon', (0, yb - 1.7, 9.0))

    # Street furniture.
    for sx in (-1, 1):
        y = -L / 2 + 4
        k = 0
        while y < L / 2 - 4:
            # Bollards at the kerb.
            kit.cylinder(m('metal_dark'), (sx * 4.6, y, 0.14), (sx * 4.6, y, 1.0), 0.11, 8)
            if k % 3 == 0:
                # A lamp: pole, arm, head; the game lights it.
                kit.cylinder(m('metal_dark'), (sx * 4.9, y + 1.5, 0.14), (sx * 4.9, y + 1.5, 6.5), 0.09, 8)
                kit.box(m('metal_dark'), (sx * 4.2, y + 1.5, 6.5), (1.5, 0.15, 0.12))
                kit.box(m('lamp'), (sx * 3.6, y + 1.5, 6.4), (0.6, 0.3, 0.08))
                mk('lamp', (sx * 3.6, y + 1.5, 6.2))
            if k % 4 == 1:
                kit.box(m('metal_dark'), (sx * 5.6, y, 0.75), (0.8, 0.7, 1.5))
                kit.box(m('vending'), (sx * 5.17, y, 0.95), (0.04, 0.6, 1.0))
                mk('vending', (sx * 5.0, y, 1.0))
            if k % 4 == 3:
                mk('bench', (sx * 5.4, y, 0.15))
                kit.box(m('metal_dark'), (sx * 5.4, y, 0.45), (0.5, 1.8, 0.08))
                kit.box(m('metal_dark'), (sx * 5.65, y, 0.75), (0.06, 1.8, 0.55))
                for dy in (-0.75, 0.75):
                    kit.box(m('metal_dark'), (sx * 5.4, y + dy, 0.25), (0.45, 0.06, 0.45))
            y += 6.0
            k += 1
    # Food stalls: counter, canopy, stools, steam off the pot.
    for (sx, y, mat) in ((-1, -24, 'awning_ember'), (1, 2, 'awning_ion'), (-1, 40, 'awning_bone')):
        cx = sx * 8.8
        kit.box(m('metal'), (cx, y, 0.6), (1.4, 3.2, 1.0))
        kit.box(m('counter'), (cx - sx * 0.1, y, 1.12), (1.7, 3.4, 0.06))
        for dy in (-1.6, 1.6):
            kit.cylinder(m('metal_dark'), (cx + sx * 0.6, y + dy, 0.1), (cx + sx * 0.6, y + dy, 2.8), 0.05, 6)
        kit.box(m(mat), (cx - sx * 0.2, y, 2.85), (2.6, 3.8, 0.08), rot=None)
        kit.cylinder(m('metal'), (cx, y - 0.8, 1.15), (cx, y - 0.8, 1.45), 0.25, 12)
        mk('steam', (cx, y - 0.8, 1.5))
        mk('stall', (cx - sx * 1.2, y, 0.15))
        for dy in (-1.0, 0.0, 1.0):
            kit.cylinder(m('metal_dark'), (cx - sx * 1.3, y + dy, 0.14), (cx - sx * 1.3, y + dy, 0.75), 0.04, 6)
            kit.cylinder(m('rubber'), (cx - sx * 1.3, y + dy, 0.75), (cx - sx * 1.3, y + dy, 0.8), 0.2, 10)
    # The barriers at either end of the walkable street: Hearth Security.
    for sy in (-1, 1):
        yy = sy * (L / 2 - 1.0)
        kit.box(m('hazard'), (0, yy, 0.6), (8.0, 0.3, 1.2))
        for x in (-3.6, 0.0, 3.6):
            kit.box(m('metal_dark'), (x, yy, 1.4), (0.2, 0.2, 0.6))
        mk('checkpoint', (0, yy - sy * 0.5, 2.2))
    m.done('street_', {'metal': 0.01, 'metal_dark': 0.01, 'counter': 0.005})
    print('street markers', counts)


def building(m, mk, rng, sx, y0, w, lot):
    """One lot: a shop on the ground floor, storeys above, a roof."""
    yc = y0 + w / 2
    fx = sx * FRONT
    depth = rng.uniform(11.0, 16.0)
    bx = sx * (FRONT + depth / 2)
    g = 5.0
    floors = rng.choice((5, 6, 7, 8, 9, 10, 12))
    top = g + floors * 3.2
    # Corner piers.
    for dy in (-w / 2 + 0.35, w / 2 - 0.35):
        kit.box(m('concrete'), (fx + sx * 0.3, yc + dy, g / 2), (0.7, 0.7, g))
    # The shop: a room behind glass, lit from within.
    sw = w - 1.4
    room = 3.4
    kit.box(m('floor_shop'), (fx + sx * room / 2, yc, 0.16), (room, sw, 0.04))
    kit.box(m('shop_back'), (fx + sx * room, yc, 1.9), (0.1, sw, 3.5))
    for dy in (-sw / 2, sw / 2):
        kit.box(m('shop_wall'), (fx + sx * room / 2, yc + dy, 1.9), (room, 0.1, 3.5))
    kit.box(m('shop_wall'), (fx + sx * room / 2, yc, 3.65), (room, sw, 0.1))
    kit.box(m('counter'), (fx + sx * (room - 1.0), yc, 0.6), (0.6, sw * 0.6, 0.9))
    for k in range(3):
        kit.box(m('shelf'), (fx + sx * (room - 0.25), yc - sw * 0.3 + k * sw * 0.3, 1.6), (0.35, sw * 0.22, 0.05))
        kit.box(m('shelf'), (fx + sx * (room - 0.25), yc - sw * 0.3 + k * sw * 0.3, 2.3), (0.35, sw * 0.22, 0.05))
    shuttered = rng.random() < 0.25
    glass_top = 3.4
    if shuttered:
        # A roller shutter most of the way down: a closed shop.
        kit.box(m('shutter'), (fx + sx * 0.05, yc, 2.0), (0.08, sw, 2.8))
    kit.box(m('shopglass'), (fx + sx * 0.08, yc, 1.8), (0.04, sw, glass_top - 0.2))
    kit.box(m('concrete'), (fx + sx * 0.1, yc, 0.27), (0.25, sw, 0.25))
    # The sign band over the shop, and the game's neon on it.
    kit.box(m('signband'), (fx - sx * 0.05, yc, 4.2), (0.25, w - 0.2, 1.2))
    mk('sign', (fx - sx * 0.2, yc, 4.2)).scale = (sx, w - 1.6, 1.0)
    if not shuttered and rng.random() < 0.55:
        mat = rng.choice(('awning_ember', 'awning_ion', 'awning_bone', 'awning_dark'))
        kit.box(m(mat), (fx - sx * 1.1, yc, 3.35), (2.2, w - 1.0, 0.07))
    if not shuttered:
        mk('shoplight', (fx + sx * 1.6, yc, 3.0))
    # Storeys: the tower mass, its front a curtain of windows.
    kit.box(m('facade'), (bx, yc, (g + top) / 2), (depth, w - 0.1, top - g))
    # A setback near the top on some.
    if floors >= 8 and rng.random() < 0.6:
        k = rng.uniform(2.0, 4.0)
        kit.box(m('concrete'), (bx + sx * k / 2, yc, top + 0.15), (depth - k, w - 0.1, 0.3))
        top2 = top + rng.choice((2, 3)) * 3.2
        kit.box(m('facade'), (bx + sx * k / 2, yc, (top + top2) / 2), (depth - k, w - 1.2, top2 - top))
        top = top2
    # Floor slabs show as bands.
    for f in range(floors + 1):
        z = g + f * 3.2
        kit.box(m('concrete'), (fx - sx * 0.08, yc, z), (0.3, w - 0.1, 0.25))
    # Balconies with rails on some floors.
    for f in range(1, floors):
        if rng.random() < 0.25:
            z = g + f * 3.2
            bw = rng.uniform(2.5, min(5.0, w - 2))
            by = yc + rng.uniform(-(w - bw) / 2 + 0.5, (w - bw) / 2 - 0.5)
            kit.box(m('concrete'), (fx - sx * 0.7, by, z + 0.05), (1.4, bw, 0.15))
            kit.box(m('metal_dark'), (fx - sx * 1.35, by, z + 0.6), (0.05, bw, 0.05))
            for k in range(int(bw / 0.6) + 1):
                kit.box(m('metal_dark'), (fx - sx * 1.35, by - bw / 2 + k * 0.6, z + 0.35), (0.03, 0.03, 0.55))
    # Air-conditioners on the face, pipes down it.
    for _ in range(rng.randint(3, 9)):
        z = g + rng.uniform(0.5, top - g - 1.0)
        ay = yc + rng.uniform(-w / 2 + 0.8, w / 2 - 0.8)
        kit.box(m('metal'), (fx - sx * 0.35, ay, z), (0.6, 0.9, 0.55))
        kit.box(m('vent'), (fx - sx * 0.66, ay, z), (0.02, 0.6, 0.4))
    if rng.random() < 0.5:
        py = yc + rng.choice((-1, 1)) * (w / 2 - 0.6)
        kit.cylinder(m('pipe_steel'), (fx - sx * 0.25, py, g), (fx - sx * 0.25, py, top), 0.12, 8)
    # A fire escape zig-zagging up some.
    if rng.random() < 0.35:
        ey = yc + rng.uniform(-w / 4, w / 4)
        for f in range(1, min(floors, 7)):
            z = g + f * 3.2
            kit.box(m('metal_dark'), (fx - sx * 0.6, ey, z), (1.1, 3.0, 0.06))
            kit.box(m('metal_dark'), (fx - sx * 1.15, ey, z + 0.5), (0.04, 3.0, 0.04))
            d = 1 if f % 2 else -1
            for s in range(8):
                kit.box(m('metal_dark'), (fx - sx * 0.6, ey + d * (-1.2 + s * 0.3), z + 0.4 + s * 0.35), (0.9, 0.25, 0.04))
    # Roof: a parapet, a water tank, an antenna; a big sign on some.
    kit.box(m('concrete'), (bx, yc, top + 0.5), (depth, w - 0.1, 1.0))
    if rng.random() < 0.5:
        tx, ty = bx + rng.uniform(-depth / 4, depth / 4), yc + rng.uniform(-w / 4, w / 4)
        kit.cylinder(m('metal'), (tx, ty, top + 1.0), (tx, ty, top + 4.0), 1.3, 14)
        for a in range(4):
            ang = a * math.pi / 2 + 0.6
            kit.cylinder(m('metal_dark'), (tx + math.cos(ang) * 1.0, ty + math.sin(ang) * 1.0, top), (tx + math.cos(ang) * 1.0, ty + math.sin(ang) * 1.0, top + 1.1), 0.06, 6)
    if rng.random() < 0.6:
        ax, ay = bx + rng.uniform(-depth / 3, depth / 3), yc + rng.uniform(-w / 3, w / 3)
        kit.cylinder(m('metal_dark'), (ax, ay, top + 1.0), (ax, ay, top + rng.uniform(4, 9)), 0.07, 6)
    if rng.random() < 0.35:
        mk('roofsign', (fx + sx * 1.0, yc, top + 3.2)).scale = (sx, w - 2, 1.0)
    elif rng.random() < 0.5:
        mk('vsign', (fx - sx * 0.6, yc + rng.choice((-1, 1)) * (w / 2 - 1.2), g + rng.uniform(2.0, 8.0))).scale = (sx, 1.0, 1.0)


def alley(m, mk, rng, sx, y0, w):
    yc = y0 + w / 2
    depth = 14.0
    ax = sx * (FRONT + depth / 2)
    kit.box(m('asphalt'), (ax, yc, 0.0), (depth, w, 0.12))
    kit.box(m('brick'), (sx * (FRONT + depth), yc, 6.0), (0.3, w, 12.0))
    kit.box(m('metal'), (ax + sx * 2.0, yc, 0.7), (1.6, 1.1, 1.3))
    for _ in range(rng.randint(3, 6)):
        kit.sphere(m('rubber'), (ax + sx * rng.uniform(-3, 4), yc + rng.uniform(-1, 1), 0.3), rng.uniform(0.25, 0.4), 8, (1.0, 1.0, 0.8))
    mk('steam', (ax + sx * 3.0, yc, 0.1))
    mk('alley', (ax - sx * 2.0, yc, 3.2))


# --- The ring --------------------------------------------------------------

def ring():
    m = Mats()
    seg = 160
    # The floor: a cylinder's inner face, the walkable street's stretch left
    # out (the street model is there).
    half = (L / 2 + 4.0) / RING_R
    for i in range(seg):
        a0 = 2 * math.pi * i / seg
        a1 = 2 * math.pi * (i + 1) / seg
        if a1 <= half or a0 >= 2 * math.pi - half:
            continue
        a0 = max(a0, half) if a0 < half else a0
        a1 = min(a1, 2 * math.pi - half) if a1 > 2 * math.pi - half else a1
        bm = m('ringfloor')
        vs = []
        for (x, a) in ((-RING_W / 2, a0), (RING_W / 2, a0), (RING_W / 2, a1), (-RING_W / 2, a1)):
            vs.append(bm.verts.new((x, RING_R * math.sin(a), RING_R - RING_R * math.cos(a) - 0.05)))
        bm.faces.new(vs)
        # Light strips down the far streets.
        for x in (-30.0, 30.0):
            ls = m('streetglow')
            v2 = []
            for (dx, a) in ((-0.6, a0), (0.6, a0), (0.6, a1), (-0.6, a1)):
                v2.append(ls.verts.new((x + dx, (RING_R - 0.1) * math.sin(a), RING_R - (RING_R - 0.1) * math.cos(a))))
            ls.faces.new(v2)
    # The bulkheads at the ring's two ends: annuli with window bands.
    for sx in (-1, 1):
        bm = m('bulkhead')
        inner = RING_R * 0.25
        for i in range(seg):
            a0 = 2 * math.pi * i / seg
            a1 = 2 * math.pi * (i + 1) / seg
            pts = [(sx * RING_W / 2, r * math.sin(a), RING_R - r * math.cos(a)) for (r, a) in ((RING_R, a0), (inner, a0), (inner, a1), (RING_R, a1))]
            vs = [bm.verts.new(p) for p in pts]
            bm.faces.new(vs if sx > 0 else list(reversed(vs)))
        win = m('ringwindows')
        for i in range(seg):
            if i % 2:
                continue
            a0 = 2 * math.pi * i / seg + 0.004
            a1 = 2 * math.pi * (i + 1) / seg - 0.004
            for (r0, r1) in ((RING_R * 0.62, RING_R * 0.66), (RING_R * 0.45, RING_R * 0.47)):
                pts = [(sx * (RING_W / 2 - 0.3), r * math.sin(a), RING_R - r * math.cos(a)) for (r, a) in ((r1, a0), (r0, a0), (r0, a1), (r1, a1))]
                vs = [win.verts.new(p) for p in pts]
                win.faces.new(vs if sx > 0 else list(reversed(vs)))
    # The axial light tube, dimmed for the night shift, and its spokes.
    kit.cylinder(m('axis_light'), (-RING_W / 2, 0, RING_R), (RING_W / 2, 0, RING_R), 3.0, 24)
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.3
        p = (0, (RING_R - 6) * math.sin(a), RING_R - (RING_R - 6) * math.cos(a))
        kit.cylinder(m('metal_dark'), (0, 0, RING_R), p, 1.2, 8)
    m.done('ring_')


# --- Far-city towers ---------------------------------------------------------

def block(name, rng, w, d, h):
    m = Mats()
    kit.box(m('facade'), (0, 0, h / 2), (w, d, h))
    kit.box(m('concrete'), (0, 0, h + 0.4), (w + 0.4, d + 0.4, 0.8))
    if h > 30:
        kit.box(m('facade'), (0, 0, h + 0.8 + 6), (w * 0.6, d * 0.6, 12))
    kit.box(m('signband'), (0, -d / 2 - 0.1, 5.5), (w * 0.9, 0.2, 1.4))
    kit.box(m('neon_ember' if rng.random() < 0.5 else 'neon_ion'), (0, -d / 2 - 0.22, 5.5), (w * 0.7, 0.05, 0.35))
    kit.cylinder(m('metal'), (w * 0.2, d * 0.1, h + 0.8), (w * 0.2, d * 0.1, h + 3.5), 1.2, 10)
    m.done(f'{name}_')


rng = random.Random(1983)
os.makedirs(OUT, exist_ok=True)
kit.reset()
street(rng)
kit.export(os.path.join(OUT, 'lowdeck-street.glb'))
kit.reset()
ring()
kit.export(os.path.join(OUT, 'lowdeck-ring.glb'))
for name, (w, d, h) in (('lowdeck-block-a', (14, 12, 26)), ('lowdeck-block-b', (16, 14, 40)), ('lowdeck-block-c', (12, 12, 18))):
    kit.reset()
    block(name.split('-')[-1], rng, w, d, h)
    kit.export(os.path.join(OUT, f'{name}.glb'))
print('lowdeck: done', OUT)
