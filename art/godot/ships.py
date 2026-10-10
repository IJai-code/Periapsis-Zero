"""Periapsis Zero's ships, built for the Godot game at hard-surface detail.

    blender -b --factory-startup --python art/godot/ships.py -- <kind> <out.glb>

kinds: kestrel (the player's fighter), raider (the Hollow), freighter (the
Aster and the convoy; `freighter:<seed>:<length>` for variants).

Each ship is a root with one child per big piece (fuselage, wings, engines,
modules), and the small details parented to the piece they sit on, so Godot
can break a ship apart along those lines. Materials are names only; see
game/scripts/art/surfaces.gd.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector as V  # noqa: E402

import kit  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
KIND, OUT = args[0], args[1]


def root(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    return o


def twin(o, side_name):
    """The right-hand part `o` and its mirrored left twin, children too."""
    left = kit.mirror_copy(o, o.name.replace('_R', '_L'))
    left.parent = o.parent
    for c in [c for c in bpy.data.objects if c.parent == o]:
        lc = kit.mirror_copy(c, c.name.replace('_R', '_L'))
        lc.parent = left
    return left


# --------------------------------------------------------------------------
# The Kestrel: a light escort fighter, 16 m nose to nozzles, 13 m span.

def kestrel():
    ship = root('kestrel')
    rng = random.Random(9)

    # Fuselage: faceted sections, nose to tail. The skin is dark; painted
    # plates with real gaps go over it, so every seam is geometry.
    stations = [
        (8.4, 0.14, 0.1, 0.0),
        (7.4, 0.8, 0.5, 0.05),
        (5.8, 1.6, 1.0, 0.16),
        (3.8, 2.2, 1.4, 0.28),
        (1.4, 2.6, 1.65, 0.32),
        (-1.4, 2.7, 1.65, 0.3),
        (-3.8, 2.5, 1.45, 0.22),
        (-5.6, 2.0, 1.1, 0.14),
        (-6.5, 1.6, 0.85, 0.1),
    ]
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y(kit.densify(kit.facet(w, h, z=z), 0.95), y) for y, w, h, z in kit.stations(stations, 1.05)])
    # Livery: pale on top, gunmetal flanks, dark belly, a few odd panels.
    def livery(c, n):
        if n.z > 0.55:
            return 2 if rng.random() > 0.08 else 0
        if n.z < -0.45:
            return 3
        return 0 if rng.random() > 0.06 else 2
    kit.panelize(bm, inset=0.022, depth=-0.014, seam=1, paint=livery)
    fus = kit.part('fuselage', bm, ['paint_grey', 'seam', 'paint_bone', 'paint_dark'], parent=ship)
    surf = kit.Surface([fus])
    # A dorsal spine from the canopy to the tail, with vents along it.
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y(kit.chamfer_rect(w, h, 0.1, z), y) for y, w, h, z in [(0.9, 0.3, 0.16, 1.12), (0.2, 0.55, 0.32, 1.12), (-4.8, 0.55, 0.36, 0.92), (-6.3, 0.4, 0.24, 0.68)]])
    spine = kit.part('spine', bm, 'paint_dark', bevel=0.02, parent=fus)
    bm = bmesh.new()
    for y in kit.frange(-0.4, -4.4, -0.5):
        kit.box(bm, (0, y, 1.3), (0.4, 0.1, 0.05))
    kit.part('spine_vents', bm, 'metal', parent=spine)

    # Canopy: a faceted blister of glass on the spine, ribs over it.
    cs = [(6.1, 0.14, 0.06, 0.62), (5.0, 0.9, 0.55, 0.92), (3.5, 1.15, 0.72, 1.12), (2.2, 1.0, 0.6, 1.2), (1.2, 0.5, 0.2, 1.14)]
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y([(x, z + zc) for x, z in kit.facet(w, h, top=0.5, shoulder=0.1, belly=0.5)], y) for y, w, h, zc in cs])
    kit.part('canopy', bm, 'canopy', bevel=0.02, parent=fus)
    bm = bmesh.new()
    for y, w, h, zc in cs[1:-1]:
        pts = kit.facet(w + 0.06, h + 0.06, top=0.5, shoulder=0.1, belly=0.5)
        for (x0, z0), (x1, z1) in zip(pts[2:6], pts[3:7]):
            kit.cylinder(bm, V((x0, y, z0 + zc)), V((x1, y, z1 + zc)), 0.035, 6)
    kit.cylinder(bm, V((0, 5.2, 1.22)), V((0, 1.6, 1.52)), 0.04, 6)
    kit.part('canopy_frame', bm, 'paint_dark', parent=fus)

    # Intakes on the flanks, ahead of the wing roots.
    bm = bmesh.new()
    dark = bmesh.new()
    for side in (-1, 1):
        x = side * 1.38
        kit.loft(bm, [kit.ring_y([(xx * side + x, z) for xx, z in kit.chamfer_rect(0.5, 0.75, 0.12, 0.05)], y) for y in (3.2, 0.2)])
        kit.box(dark, (x + side * 0.02, 3.22, 0.05), (0.36, 0.06, 0.6))
    kit.part('intakes', bm, 'paint_dark', bevel=0.02, parent=fus)
    kit.part('intake_faces', dark, 'engine', parent=fus)
    # Chin turret and a sensor boom at the nose.
    bm = bmesh.new()
    kit.sphere(bm, (0, 6.0, -0.45), 0.28, 14)
    kit.cylinder(bm, V((0, 6.1, -0.5)), V((0, 7.5, -0.52)), 0.045, 8)
    kit.cylinder(bm, V((0, 8.2, 0.0)), V((0, 9.6, 0.0)), 0.025, 6)
    kit.part('nose_gear', bm, 'metal', bevel=0.005, parent=fus)

    # Wings: swept, thin, a little anhedral; panelled top and bottom.
    def wing_section(x, y_lead, y_trail, t, dz):
        c = y_lead - y_trail
        return [V((x, y_lead, dz)), V((x, y_lead - c * 0.25, dz + t / 2)), V((x, y_trail + c * 0.1, dz + t * 0.35)),
                V((x, y_trail, dz)), V((x, y_trail + c * 0.1, dz - t * 0.3)), V((x, y_lead - c * 0.25, dz - t / 2))]
    def wing_at(x):
        # Root to tip, linearly: (leading edge, trailing edge, thickness, droop).
        keys = [(1.1, 1.6, -3.6, 0.3, 0.0), (3.8, -0.6, -3.7, 0.17, -0.22), (6.6, -2.4, -3.8, 0.08, -0.45)]
        for a, b in zip(keys, keys[1:]):
            if a[0] <= x <= b[0]:
                t = (x - a[0]) / (b[0] - a[0])
                return wing_section(x, *[p + (q - p) * t for p, q in zip(a[1:], b[1:])])
    bm = bmesh.new()
    rings = [wing_at(x) for x in kit.frange(1.1, 6.6, 0.69)]
    # More points along the chord, so panels are near-square.
    dense = []
    for r in rings:
        top = [r[0].lerp(r[3], t) for t in (0.0, 0.2, 0.4, 0.6, 0.8)]
        dense.append([r[0], r[1].lerp(r[0], 0.0), r[1].lerp(r[2], 0.33), r[1].lerp(r[2], 0.66), r[2], r[3], r[4], r[4].lerp(r[5], 0.33), r[4].lerp(r[5], 0.66), r[5]])
    kit.loft(bm, dense)
    kit.panelize(bm, inset=0.02, depth=-0.01, seam=1, paint=lambda c, n: 2 if n.z > 0.3 and rng.random() > 0.1 else (3 if n.z < -0.3 else 0))
    wing = kit.part('wing_R', bm, ['paint_grey', 'seam', 'paint_bone', 'paint_dark'], parent=ship)
    wsurf = kit.Surface([wing])
    bm = bmesh.new()
    kit.loft(bm, [wing_section(3.0, 0.2, -0.5, 0.24, -0.15), wing_section(6.35, -2.2, -2.75, 0.12, -0.43)])
    kit.part('stripe_R', bm, 'paint_ember', parent=wing)
    bm = bmesh.new()
    kit.loft(bm, [[V((6.55, -2.5, -0.45)), V((6.6, -3.75, -0.45)), V((6.62, -3.75, -0.4)), V((6.57, -2.5, -0.4))],
                  [V((6.85, -3.1, 0.45)), V((6.9, -3.8, 0.45)), V((6.92, -3.8, 0.5)), V((6.87, -3.1, 0.5))]])
    kit.part('tipfin_R', bm, 'paint_ember', bevel=0.01, parent=wing)
    bm = bmesh.new()
    kit.box(bm, (3.5, -0.9, -0.42), (0.34, 2.6, 0.3))
    kit.cylinder(bm, V((3.5, 0.4, -0.42)), V((3.5, 2.0, -0.42)), 0.07, 10)
    for k in range(4):
        kit.cylinder(bm, V((3.5, 0.5 + k * 0.28, -0.42)), V((3.5, 0.6 + k * 0.28, -0.42)), 0.12, 10)
    kit.cylinder(bm, V((3.5, 2.0, -0.42)), V((3.5, 2.25, -0.42)), 0.1, 10, r2=0.08)
    kit.part('gun_R', bm, 'metal', bevel=0.01, parent=wing)
    bm = bmesh.new()
    kit.sphere(bm, (6.62, -2.55, -0.42), 0.07, 8)
    kit.part('navlight_R', bm, 'nav_green', parent=wing)

    # Engines: slim nacelles faired into the rear fuselage.
    at = V((1.62, 0, 0.0))
    bm = bmesh.new()
    kit.lathe(bm, [(r, y) for y, r in kit.stations([(-0.6, 0.42), (-0.9, 0.56), (-1.4, 0.62), (-3.0, 0.64), (-5.4, 0.63), (-6.2, 0.58), (-6.5, 0.55)], 0.9)], 16, at)
    kit.panelize(bm, inset=0.02, depth=-0.01, seam=1, paint=lambda c, n: 2 if n.z > 0.5 else 0)
    nac = kit.part('engine_R', bm, ['paint_grey', 'seam', 'paint_bone'], parent=ship)
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y([(x + 1.05, z) for x, z in kit.chamfer_rect(0.9, 0.55, 0.15, 0.32)], y) for y in (-0.8, -5.6)])
    kit.part('fairing_R', bm, 'paint_grey', bevel=0.02, parent=nac)
    bm = bmesh.new()
    kit.lathe(bm, [(0.5, -6.3), (0.56, -6.5), (0.52, -7.2), (0.44, -7.25), (0.46, -6.6)], 20, at, cap_start=False, cap_end=False)
    for k in range(12):
        a = 2 * math.pi * k / 12
        d = V((math.cos(a), 0, math.sin(a)))
        rot = kit.frame_from_normal(d, V((0, -1, 0)))
        kit.box(bm, at + d * 0.55 + V((0, -6.95, 0)), (0.2, 0.6, 0.03), rot)
    kit.part('nozzle_R', bm, 'engine', bevel=0.006, parent=nac)
    bm = bmesh.new()
    kit.lathe(bm, [(0.01, -6.3), (0.4, -6.45), (0.4, -6.55)], 20, at)
    kit.part('burner_R', bm, 'glow_engine', parent=nac)
    bm = bmesh.new()
    kit.lathe(bm, [(0.42, -0.58), (0.3, -0.9), (0.1, -1.2), (0.01, -1.25)], 20, at, cap_start=False)
    kit.part('intake_R', bm, 'metal', parent=nac)
    bm = bmesh.new()
    for y in (-1.8, -2.4, -3.0, -4.6):
        kit.lathe(bm, [(0.645, y), (0.67, y - 0.1), (0.645, y - 0.2)], 24, at, cap_start=False, cap_end=False)
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        d = V((math.cos(a), 0, math.sin(a)))
        rot = kit.frame_from_normal(d, V((0, 1, 0)))
        kit.box(bm, at + d * 0.66 + V((0, -5.6, 0)), (0.08, 0.9, 0.05), rot)
    kit.part('engine_detail_R', bm, 'metal', parent=nac)

    # Tail fins, canted out.
    cant = Matrix.Rotation(math.radians(-22), 3, 'Y')
    def fin_pts(pts, t):
        return [cant @ (p + V((t, 0, 0))) + V((0.85, 0, 0.55)) for p in pts]
    pts = [V((0, -3.2, 0)), V((0, -6.3, 0)), V((0, -6.6, 1.9)), V((0, -5.3, 1.9))]
    bm = bmesh.new()
    kit.loft(bm, [fin_pts(pts, -0.05), fin_pts(pts, 0.05)])
    fin = kit.part('fin_R', bm, 'paint_grey', bevel=0.015, parent=ship)
    tip = [V((0, -5.35, 1.55)), V((0, -6.55, 1.55)), V((0, -6.6, 1.9)), V((0, -5.3, 1.9))]
    bm = bmesh.new()
    kit.loft(bm, [fin_pts(tip, -0.065), fin_pts(tip, 0.065)])
    kit.part('fintip_R', bm, 'paint_ember', parent=fin)
    bm = bmesh.new()
    for k in range(4):
        kit.loft(bm, [fin_pts([V((0, -3.6 - k * 0.6, 0.2)), V((0, -3.9 - k * 0.6, 0.2)), V((0, -4.1 - k * 0.6, 1.2)), V((0, -3.8 - k * 0.6, 1.2))], t) for t in (-0.07, 0.07)])
    kit.part('fin_ribs_R', bm, 'paint_dark', parent=fin)

    for o in (wing, nac, fin):
        twin(o, 'L')
    for o in [o for o in bpy.data.objects if o.name.startswith('navlight_L')]:
        o.data.materials[0] = kit.material('nav_red')

    # Small machines on the skin.
    bm = bmesh.new()
    for side in (-1, 1):
        kit.greeble(bm, surf, (side * 0.9, -5.4, 3), (0, 0, -1), 'box', 0.9, rng)
        kit.greeble(bm, surf, (side * 3, 6.3, 0.1), (-side, 0, 0), 'box', 0.35, rng)
        kit.greeble(bm, surf, (side * 3, 5.9, 0.1), (-side, 0, 0), 'box', 0.35, rng)
        kit.greeble(bm, surf, (side * 3, -6.0, 0.1), (-side, 0, 0), 'box', 0.4, rng)
        kit.greeble(bm, surf, (side * 2, -2.0, -3), (-side * 0.4, 0, 1), 'pipe', 1.0)
    kit.part('greebles', bm, 'metal', bevel=0.005, parent=fus)
    bm = bmesh.new()
    kit.greeble(bm, surf, (0, 6.8, -2), (0, 0, 1), 'dome', 1.4)
    kit.greeble(bm, surf, (0.35, -5.0, 3), (0, 0, -1), 'antenna', 1.2)
    kit.greeble(bm, surf, (-0.35, -4.6, 3), (0, 0, -1), 'antenna', 0.8)
    kit.part('sensors', bm, 'paint_dark', parent=fus)
    bm = bmesh.new()
    kit.sphere(bm, (0, -6.5, 0.6), 0.06, 8)
    kit.part('navlight_tail', bm, 'nav_white', parent=fus)
    return ship


# --------------------------------------------------------------------------
# A Hollow raider: a mining tug made into a weapon. Heavy prow, mandible
# guns, an exposed reactor, armour bolted on where it was needed.

def raider():
    ship = root('raider')
    rng = random.Random(4)
    stations = [(6.4, 1.6, 1.0, 0.0), (5.2, 3.0, 1.9, 0.05), (2.6, 3.4, 2.2, 0.1), (-0.8, 2.6, 1.9, 0.2), (-3.6, 2.4, 1.8, 0.15), (-5.2, 2.0, 1.4, 0.1)]
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y(kit.densify(kit.chamfer_rect(w, h, 0.45, z), 0.9), y) for y, w, h, z in kit.stations(stations, 1.0)])
    kit.panelize(bm, inset=0.03, depth=-0.02, seam=1, paint=lambda c, n: 2 if rng.random() < 0.18 else (3 if n.z > 0.5 and rng.random() < 0.3 else 0))
    body = kit.part('hull', bm, ['paint_hollow', 'seam', 'rust', 'paint_dark'], parent=ship)
    # The prow: a wedge of armour over the nose, ember-striped.
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y([(-1.9, 0.9), (1.9, 0.9), (1.5, 1.35), (-1.5, 1.35)], 5.8), kit.ring_y([(-1.9, 1.0), (1.9, 1.0), (1.6, 1.5), (-1.6, 1.5)], 1.2)])
    kit.part('prow', bm, 'rust', bevel=0.03, parent=body)
    # Mandibles: two long gun arms reaching forward, built right and mirrored.
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y(kit.chamfer_rect(0.8, 0.7, 0.18, -0.2), y) for y in (2.2, 7.6)])
    kit.loft(bm, [kit.ring_y([(x + 2.1, z) for x, z in kit.chamfer_rect(0.8, 0.7, 0.18, -0.2)], y) for y in (2.2, 7.6)])
    arm = bmesh.new()
    kit.loft(arm, [kit.ring_y([(x + 2.2, z) for x, z in kit.chamfer_rect(0.75, 0.75, 0.2, -0.25)], y) for y in (3.0, 8.4)])
    kit.cylinder(arm, V((2.2, 8.4, -0.25)), V((2.2, 10.6, -0.25)), 0.11, 10)
    kit.cylinder(arm, V((2.2, 9.6, -0.25)), V((2.2, 9.9, -0.25)), 0.18, 10)
    kit.box(arm, (2.2, 2.4, -0.25), (1.2, 1.4, 0.6))
    bm.free()
    mand = kit.part('mandible_R', arm, 'paint_hollow', bevel=0.03, parent=ship)
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y([(x + 2.2, z) for x, z in kit.chamfer_rect(0.8, 0.12, 0.03, 0.15)], y) for y in (4.0, 8.2)])
    kit.part('mandible_band_R', bm, 'paint_ember', parent=mand)
    # The reactor, open to space, and the drive.
    bm = bmesh.new()
    kit.lathe(bm, [(0.9, -2.0), (1.15, -2.4), (1.15, -4.4), (0.9, -4.8)], 20, V((0, 0, 1.25)), axis='Y')
    reactor = kit.part('reactor', bm, 'metal', bevel=0.02, parent=ship)
    bm = bmesh.new()
    for y in (-2.6, -3.1, -3.6, -4.1):
        kit.lathe(bm, [(1.17, y), (1.25, y - 0.1), (1.17, y - 0.2)], 20, V((0, 0, 1.25)), cap_start=False, cap_end=False)
    kit.part('reactor_rings', bm, 'glow_reactor', parent=reactor)
    bm = bmesh.new()
    kit.lathe(bm, [(0.9, -5.0), (1.2, -5.4), (1.2, -6.4), (1.0, -7.0), (0.8, -7.1)], 20, V((0, 0, 0.1)))
    drive = kit.part('drive', bm, 'engine', bevel=0.02, parent=ship)
    bm = bmesh.new()
    kit.lathe(bm, [(0.01, -6.9), (0.85, -7.0), (0.85, -7.05)], 20, V((0, 0, 0.1)))
    kit.part('drive_glow', bm, 'glow_hollow', parent=drive)
    # Bolted-on plates, pipes and spikes.
    surf = kit.Surface([body])
    bm = bmesh.new()
    pl = [(rng.choice((-1, 1)) * 3, rng.uniform(-4.5, 4.5), rng.uniform(-0.6, 0.9)) for _ in range(14)]
    pl += [(rng.uniform(-1, 1), rng.uniform(-4, 3), 3) for _ in range(6)]
    kit.plates(bm, surf, pl, (1.1, 1.4), thick=0.08)
    kit.part('armour', bm, 'rust', bevel=0.012, parent=body)
    bm = bmesh.new()
    for _ in range(10):
        s = rng.choice((-1, 1))
        kit.greeble(bm, surf, (s * 3, rng.uniform(-4.5, 4), rng.uniform(-0.5, 0.8)), (-s, 0, 0), rng.choice(('box', 'vent', 'pipe')), rng.uniform(0.7, 1.2), rng)
    for side in (-1, 1):
        for k in range(3):
            o = V((side * 1.6, 1.6 - k * 1.6, 1.4))
            kit.cylinder(bm, o, o + V((side * 0.5, -0.4, 0.9)), 0.07, 6, r2=0.005)
    kit.part('junk', bm, 'metal', bevel=0.005, parent=body)
    bm = bmesh.new()
    for x in (-1.2, 1.2):
        kit.box(bm, (x, 6.1, 0.3), (0.5, 0.12, 0.18))
    kit.part('eyes', bm, 'glow_hollow', parent=body)
    twin(mand, 'L')
    return ship


# --------------------------------------------------------------------------
# Freighters: a command section, a spine of container bays, radiators and a
# drive block. The Aster is seed 1 at 140 m; the convoy are other seeds.

def freighter(seed=1, length=140.0):
    ship = root('freighter')
    rng = random.Random(seed)
    L = length
    front, back = L * 0.42, -L * 0.5
    # The spine: a truss of four longerons and cross-frames.
    bm = bmesh.new()
    for x in (-2.2, 2.2):
        for z in (-2.2, 2.2):
            kit.box(bm, (x, (front + back) / 2, z), (0.7, front - back, 0.7))
    k = back + 8
    while k < front - 8:
        kit.box(bm, (0, k, 2.2), (4.4, 0.5, 0.5))
        kit.box(bm, (0, k, -2.2), (4.4, 0.5, 0.5))
        kit.box(bm, (2.2, k, 0), (0.5, 0.5, 4.4))
        kit.box(bm, (-2.2, k, 0), (0.5, 0.5, 4.4))
        k += 6.0
    spine = kit.part('spine', bm, 'metal', bevel=0.04, parent=ship)
    # Container bays: racks of standard boxes in the company's colours.
    colours = ['container_bone', 'container_ember', 'container_ion', 'container_grey', 'container_dark']
    y = front - 14
    bay = 0
    while y > back + 22:
        n = rng.choice((2, 3, 3, 4))
        bm = bmesh.new()
        racks = bmesh.new()
        for ring in range(n):
            yy = y - ring * 6.6
            for (x, z) in ((-5.4, 2.6), (5.4, 2.6), (-5.4, -2.6), (5.4, -2.6), (0, 6.2), (0, -6.2)):
                if rng.random() < 0.12:
                    continue
                kit.box(bm, (x, yy, z), (4.6 if x else 9.6, 6.1, 4.6 if x else 4.4))
            kit.box(racks, (0, yy + 3.2, 0), (15.6, 0.35, 0.35))
            kit.box(racks, (0, yy + 3.2, 0), (0.35, 0.35, 17.0))
        mat = rng.choice(colours)
        c = kit.part(f'bay{bay}', bm, mat, bevel=0.06, parent=ship)
        kit.part(f'bay{bay}_racks', racks, 'paint_dark', bevel=0.03, parent=c)
        y -= n * 6.6 + 2.0
        bay += 1
    # The command section: a stepped block with window bands and a mast.
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y(kit.densify(kit.chamfer_rect(w, h, c, z), 2.2), yy) for yy, w, h, c, z in
                  kit.stations([(L * 0.5, 6.0, 4.0, 1.4, 1.0), (L * 0.47, 12.0, 9.0, 2.6, 1.0), (front - 6, 13.0, 10.5, 2.8, 0.8), (front - 12, 10.0, 8.0, 2.0, 0.0)], 2.4)])
    kit.panelize(bm, inset=0.08, depth=-0.05, seam=1, paint=lambda c, n: 2 if (n.z > 0.6 or rng.random() < 0.15) else 0)
    cmd = kit.part('command', bm, ['paint_bone', 'seam', 'paint_grey'], parent=ship)
    bm = bmesh.new()
    for zz in (2.6, 4.2):
        kit.box(bm, (0, L * 0.462, zz), (10.6, 0.25, 0.5))
    for side in (-1, 1):
        for yy in range(int(front - 10), int(L * 0.46), 2):
            kit.box(bm, (side * 6.52, yy, 2.4), (0.08, 0.9, 0.5))
    kit.part('windows', bm, 'window_glow', parent=cmd)
    surf = kit.Surface([cmd])
    bm = bmesh.new()
    for _ in range(22):
        kit.greeble(bm, surf, (rng.uniform(-5, 5), rng.uniform(front - 8, L * 0.46), 12), (0, 0, -1), rng.choice(('box', 'vent', 'dome', 'pipe')), rng.uniform(1.5, 3.0), rng)
    kit.greeble(bm, surf, (0, front - 2, 12), (0, 0, -1), 'antenna', 9.0)
    kit.greeble(bm, surf, (2, front - 5, 12), (0, 0, -1), 'antenna', 6.0)
    kit.part('command_gear', bm, 'metal', bevel=0.02, parent=cmd)
    bm = bmesh.new()
    kit.box(bm, (0, front - 7, 6.6), (5.0, 6.0, 2.0))
    kit.box(bm, (0, front - 6, 8.0), (3.4, 3.6, 1.4))
    kit.part('bridge', bm, 'paint_dark', bevel=0.06, parent=cmd)
    bm = bmesh.new()
    kit.box(bm, (0, front - 3.95, 6.9), (4.4, 0.12, 0.7))
    kit.part('bridge_windows', bm, 'window_glow', parent=cmd)
    # The drive block: tanks, a thrust frame and three nozzles.
    bm = bmesh.new()
    kit.loft(bm, [kit.ring_y(kit.densify(kit.chamfer_rect(w, h, c), 2.4), yy) for yy, w, h, c in kit.stations([(back + 22, 9, 9, 2), (back + 18, 15, 15, 4), (back + 6, 15, 15, 4), (back + 2, 12, 12, 3)], 2.5)])
    kit.panelize(bm, inset=0.08, depth=-0.05, seam=1, paint=lambda c, n: 2 if rng.random() < 0.2 else 0)
    drive = kit.part('drive', bm, ['paint_dark', 'seam', 'paint_grey'], parent=ship)
    bm = bmesh.new()
    for x, z in ((-4.2, -4.2), (4.2, -4.2), (-4.2, 4.2), (4.2, 4.2)):
        kit.lathe(bm, [(0.01, back + 21), (2.2, back + 19.5), (2.6, back + 16), (2.6, back + 9), (2.2, back + 6.5), (0.01, back + 5)], 18, V((x * 1.45, 0, z * 1.45)))
    kit.part('tanks', bm, 'container_bone', bevel=0.03, parent=drive)
    bm = bmesh.new()
    glow = bmesh.new()
    for x, z in ((0, 3.2), (-3.0, -2.2), (3.0, -2.2)):
        at = V((x, 0, z))
        kit.lathe(bm, [(1.5, back + 2.5), (1.9, back + 1.5), (2.8, back - 3.5), (2.6, back - 3.6), (1.5, back + 1.0)], 24, at, cap_start=False, cap_end=False)
        kit.lathe(glow, [(0.01, back + 1.4), (1.6, back + 1.2), (1.6, back + 1.1)], 24, at)
    kit.part('nozzles', bm, 'engine', bevel=0.02, parent=drive)
    kit.part('drive_glow', glow, 'glow_engine', parent=drive)
    # Radiators: two big panels off the spine, ahead of the drive.
    for side in (-1, 1):
        bm = bmesh.new()
        kit.box(bm, (side * 15.0, back + 34, 0), (20.0, 14.0, 0.25))
        for r in range(6):
            kit.box(bm, (side * (6.5 + r * 3.4), back + 34, 0), (0.18, 14.2, 0.45))
        kit.box(bm, (side * 4.6, back + 34, 0), (3.0, 1.4, 1.4))
        kit.part(f'radiator_{"R" if side > 0 else "L"}', bm, 'radiator', bevel=0.02, parent=ship)
    # Running lights down the hull.
    bm = bmesh.new()
    for yy in range(int(back + 30), int(front), 12):
        kit.sphere(bm, (0, yy, 8.9), 0.25, 6)
    kit.part('lights', bm, 'nav_white', parent=spine)
    return ship


kit.reset()
if KIND == 'kestrel':
    kestrel()
elif KIND == 'raider':
    raider()
elif KIND.startswith('freighter'):
    parts = KIND.split(':')
    freighter(int(parts[1]) if len(parts) > 1 else 1, float(parts[2]) if len(parts) > 2 else 140.0)
kit.export(OUT)
print('ship:', KIND, OUT, len(bpy.data.objects), 'objects', sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'), 'faces before modifiers')
