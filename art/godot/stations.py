"""Stations for the Godot game, built in Blender from code.

    blender -b --factory-startup --python art/godot/stations.py -- hearth game/art/station-hearth.glb

Hearth: a working station at Earth-Moon L1. A long hub, 180 m, with the
docking bay's mouth at its fore end (+Y, lit); a ring 150 m across on four
spokes, turning for gravity in Godot (the ring is its own part, `ring`);
solar wings and radiators aft; antennas, lights and machinery everywhere.
Materials are names for game/scripts/art/surfaces.gd.
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

KIND, OUT = sys.argv[sys.argv.index('--') + 1:][:2]


def hearth():
    rng = random.Random(3)
    root = bpy.data.objects.new('hearth', None)
    bpy.context.collection.objects.link(root)
    # The hub: a stepped cylinder along Y, panelled.
    bm = bmesh.new()
    prof = [(14, -90), (18, -84), (18, -40), (22, -34), (22, 30), (18, 36), (18, 70), (24, 76), (24, 90)]
    kit.lathe(bm, [(r, y) for y, r in kit.stations([(y, r) for r, y in prof], 6.0)], 28, V((0, 0, 0)), cap_start=True, cap_end=False)
    kit.panelize(bm, inset=0.25, depth=-0.18, seam=1, paint=lambda c, n: 2 if rng.random() < 0.05 else 0)
    hub = kit.part('hub', bm, ['paint_bone', 'seam', 'paint_grey'], parent=root)
    # The docking bay mouth: a dark recess and a lit frame.
    bm = bmesh.new()
    kit.lathe(bm, [(19, 90), (19, 82), (0.01, 82)], 28, V((0, 0, 0)), cap_start=False)
    kit.part('bay_inside', bm, 'seam', parent=hub)
    bm = bmesh.new()
    for k in range(16):
        a = 2 * math.pi * k / 16
        kit.box(bm, (math.cos(a) * 21.5, 90.4, math.sin(a) * 21.5), (2.0, 0.8, 2.0))
    kit.part('bay_lights', bm, 'light_floor', parent=hub)
    bm = bmesh.new()
    kit.lathe(bm, [(24.2, 89.5), (25.5, 90.5), (19.5, 90.8), (19.0, 89.8)], 28, V((0, 0, 0)), cap_start=False, cap_end=False)
    kit.part('bay_rim', bm, 'hazard', parent=hub)
    # The ring, on four spokes, its own part so it can turn.
    ring = bpy.data.objects.new('ring', None)
    bpy.context.collection.objects.link(ring)
    ring.parent = root
    R = 75.0
    bm = bmesh.new()
    sections = []
    for k in range(73):
        a = 2 * math.pi * k / 72
        c, s = math.cos(a), math.sin(a)
        sec = []
        for (dr, dy) in ((-5, -7), (5, -7), (7, -4), (7, 4), (5, 7), (-5, 7), (-7, 4), (-7, -4)):
            sec.append(V(((R + dr) * c, dy, (R + dr) * s)))
        sections.append(sec)
    kit.loft(bm, sections[:-1] + [sections[0]], cap_start=False, cap_end=False)
    kit.panelize(bm, inset=0.2, depth=-0.12, seam=1, paint=lambda c, n: 2 if rng.random() < 0.05 else 0)
    kit.part('ring_hull', bm, ['paint_bone', 'seam', 'paint_dark'], parent=ring)
    bm = bmesh.new()
    for k in range(72):
        a = 2 * math.pi * (k + 0.5) / 72
        kit.box(bm, (math.cos(a) * (R - 7.1), 0, math.sin(a) * (R - 7.1)), (1.2, 5.0, 1.2), Matrix.Rotation(-a, 3, 'Y'))
    kit.part('ring_windows', bm, 'window_glow', parent=ring)
    bm = bmesh.new()
    for k in range(4):
        a = 2 * math.pi * k / 4 + math.pi / 4
        kit.cylinder(bm, V((math.cos(a) * 22, 0, math.sin(a) * 22)), V((math.cos(a) * (R - 6), 0, math.sin(a) * (R - 6))), 3.0, 12)
    kit.part('spokes', bm, 'paint_grey', bevel=0.1, parent=ring)
    # Solar wings and radiators aft.
    for side in (-1, 1):
        bm = bmesh.new()
        kit.box(bm, (side * 60, -70, 0), (90, 20, 0.6))
        for k in range(9):
            kit.box(bm, (side * (20 + k * 10), -70, 0), (0.6, 20.4, 1.0))
        kit.cylinder(bm, V((side * 18, -70, 0)), V((side * 106, -70, 0)), 0.8, 8)
        kit.part(f'solar_{"R" if side > 0 else "L"}', bm, 'solar', bevel=0.05, parent=root)
        bm = bmesh.new()
        kit.box(bm, (0, -55, side * 40), (0.5, 26, 44))
        kit.part(f'radiator_{"T" if side > 0 else "B"}', bm, 'radiator', bevel=0.05, parent=root)
    # Machinery and antennas on the hub; running lights.
    surf = kit.Surface([hub])
    bm = bmesh.new()
    for _ in range(70):
        a = rng.uniform(0, 2 * math.pi)
        y = rng.uniform(-80, 80)
        o = V((math.cos(a) * 40, y, math.sin(a) * 40))
        kit.greeble(bm, surf, o, -V((math.cos(a), 0, math.sin(a))), rng.choice(('box', 'vent', 'dome', 'pipe')), rng.uniform(3, 7), rng)
    for k in range(3):
        kit.greeble(bm, surf, (0, -20 + k * 30, 40), (0, 0, -1), 'antenna', 22.0)
    kit.part('machinery', bm, 'metal', bevel=0.05, parent=hub)
    bm = bmesh.new()
    for y in range(-80, 90, 20):
        for a in (0, math.pi):
            kit.sphere(bm, (math.cos(a) * 22.6, y, math.sin(a) * 22.6), 0.7, 6)
    kit.part('running_lights', bm, 'nav_white', parent=hub)


kit.reset()
if KIND == 'hearth':
    hearth()
kit.export(OUT)
print('station:', KIND, OUT, len(bpy.data.objects), 'objects')
