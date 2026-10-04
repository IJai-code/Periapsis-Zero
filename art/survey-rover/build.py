"""
The surface rover, built from its numbers.

    npm run art:build -- survey-rover

Six wheels on a rocker-bogie, because that is how every machine that has
driven on another world carries its wheels: the rockers pivot on the body and
the bogies on the rockers, so all six stay on uneven ground without springs.
The dimensions come from `ROVER` in src/sim/expedition.js through spec.json:
a 1.7 m track, a 2.1 m wheelbase, 0.46 m under the chassis.

The wheels are *not* joined into the body. Each is its own object, named
wheel_0 to wheel_5, with its origin at the hub and its axle along X, so the
runtime can spin them by turning one node. Coordinates below are Blender's
(Z-up); the front, three.js -Z, is Blender +Y.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bpy  # noqa: E402
import pz  # noqa: E402
import surfacing as sf  # noqa: E402

SPEC = json.load(open(os.path.join(HERE, 'spec.json')))
GROUSER = 0.013                      # how far the cleats stand off the rim
# The rolling radius is to the cleat tips, which are what touch the ground.
R = SPEC['wheelRadius'] - GROUSER
TRACK = SPEC['track']
BASE = SPEC['wheelbase']
CLEAR = SPEC['clearance']
WHEEL_W = 0.28


def args():
    return pz.cli()


def materials():
    return {
        'hull': pz.material('rover_hull', '#d6d0bd', metallic=0.2, roughness=0.55),
        'frame': pz.material('rover_frame', '#9a9b97', metallic=0.85, roughness=0.35),
        'dark': pz.material('rover_dark', '#33393c', metallic=0.55, roughness=0.5),
        'tyre': pz.material('rover_tyre', '#2e2d2a', metallic=0.1, roughness=0.8),
        'solar': pz.material('rover_solar', '#1d2c46', metallic=0.45, roughness=0.22),
        'glass': pz.material('rover_glass', '#0f222c', metallic=0.2, roughness=0.08),
        'foil': pz.material('rover_foil', '#d6ae55', metallic=0.7, roughness=0.34),
        'ember': pz.material('rover_ember', '#ff6b2c', metallic=0.0, roughness=0.6),
    }


def wheel(name, centre, m):
    """A chunky treaded tyre on a five-spoke rim. Axle along X.

    The tyre is a lathed carcass with bulging sidewalls, and the tread is
    chevron lugs standing GROUSER proud of it, so the rolling radius (to the
    lug tips) is still the spec's 0.313 m that the drive model uses.
    """
    parts = []
    hw = WHEEL_W / 2
    carcass = pz.lathe(f'{name}_carcass', [
        (R * 0.62, -hw + 0.01), (R * 0.82, -hw), (R * 0.95, -hw + 0.012), (R, -hw + 0.04),
        (R, hw - 0.04), (R * 0.95, hw - 0.012), (R * 0.82, hw), (R * 0.62, hw - 0.01),
    ], 48, m['tyre'], smooth_angle=60)
    parts.append(carcass)
    # Chevron lugs: two blocks a pitch, angled toward the middle, staggered.
    pitch = 22
    for k in range(pitch):
        a = 2 * math.pi * k / pitch
        for side in (-1, 1):
            lug = pz.box(f'{name}_lug_{k}_{side:+d}', (GROUSER * 2, 0.045, hw * 0.92), (0, 0, 0), m['tyre'], chamfer=0.004)
            twist = pz.Matrix.Rotation(side * 0.45, 4, 'X')
            off = pz.Matrix.Translation((R, 0, side * hw * 0.48))
            turn = pz.Matrix.Rotation(a + (math.pi / pitch if side > 0 else 0.0), 4, 'Z')
            lug.data.transform(turn @ off @ twist)
            parts.append(lug)
    # The rim: a dished metal wheel inside the carcass, with five spokes.
    rim = pz.lathe(f'{name}_rim', [(R * 0.6, -hw + 0.03), (R * 0.64, -hw + 0.05), (R * 0.64, hw - 0.05), (R * 0.6, hw - 0.03)],
                   40, m['frame'], smooth_angle=40)
    parts.append(rim)
    hub = pz.lathe(f'{name}_hub', [(0.06, -0.09), (0.085, -0.06), (0.085, 0.07), (0.05, 0.1)], 20, m['dark'],
                   cap_bottom=True, cap_top=True)
    parts.append(hub)
    for k in range(5):
        a = 2 * math.pi * k / 5
        parts.append(pz.box(f'{name}_spoke_{k}', (R * 0.56, 0.05, 0.03), (0, 0, 0), m['frame'], chamfer=0.006))
        parts[-1].data.transform(pz.Matrix.Rotation(a, 4, 'Z') @ pz.Matrix.Translation((R * 0.33, 0, hw - 0.06)))
    # Built about Z; turn the axle onto X and move to the hub.
    turn = pz.Matrix.Rotation(math.pi / 2, 4, 'Y')
    for o in parts:
        o.data.transform(turn)
    # Join the wheel's parts, origin at the hub.
    with bpy.context.temp_override(active_object=parts[0], object=parts[0],
                                   selected_objects=parts, selected_editable_objects=parts):
        bpy.ops.object.join()
    w = parts[0]
    w.name = name
    w.data.name = name
    w.location = pz.Vector(centre)
    return w


def body(m):
    """Chassis, battery and avionics boxes, solar deck, mast, antenna, rockers."""
    top = CLEAR + 0.36
    pz.box('chassis', (1.34, 2.2, 0.36), (0, 0, CLEAR + 0.18), m['hull'], chamfer=0.03)
    pz.box('belly_plate', (1.2, 2.0, 0.03), (0, 0, CLEAR + 0.015), m['dark'])
    # Foil-wrapped avionics box and a battery pack with radiator fins.
    av = pz.box('avionics', (0.9, 0.7, 0.26), (0, -0.35, top + 0.13), m['foil'], chamfer=0.01)
    pz.subdivide(av, 6)
    pz.crinkle(av, 0.008, 9.0, seed=21)
    pz.box('battery', (0.8, 0.5, 0.22), (0, 0.45, top + 0.11), m['dark'], chamfer=0.015)
    for i in range(7):
        pz.box(f'fin_{i}', (0.012, 0.46, 0.08), (-0.33 + i * 0.11, 0.45, top + 0.26), m['frame'])
    # Solar deck on two short posts.
    for x in (-0.5, 0.5):
        for y in (-0.8, 0.8):
            pz.tube(f'deck_post_{x:+.1f}_{y:+.1f}', (x, y, top), (x, y, top + 0.42), 0.02, m['frame'], segments=8)
    pz.box('solar_deck', (1.4, 1.9, 0.035), (0, 0, top + 0.44), m['solar'], chamfer=0.006)
    for i in range(6):
        pz.box(f'deck_rib_{i}', (1.4, 0.012, 0.01), (0, -0.85 + i * 0.34, top + 0.462), m['frame'])
    # A second power mast at the rear: two panels in a shallow V that can be
    # turned to a low sun, the way the reference rovers carry them.
    pz.tube('power_mast', (-0.25, -0.75, top + 0.44), (-0.25, -0.75, 1.55), 0.028, m['frame'], segments=10)
    pz.box('power_hinge', (0.16, 0.12, 0.1), (-0.25, -0.75, 1.57), m['dark'], chamfer=0.012)
    for side in (-1, 1):
        wing = pz.box(f'power_wing_{side:+d}', (0.5, 0.46, 0.025), (0, 0, 0), m['solar'], chamfer=0.004)
        frame = pz.box(f'power_wing_frame_{side:+d}', (0.52, 0.48, 0.015), (0, 0, -0.018), m['frame'])
        for o in (wing, frame):
            o.data.transform(pz.Matrix.Translation((-0.25 + side * 0.3, -0.75, 1.64)) @ pz.Matrix.Rotation(side * -0.32, 4, 'Y'))
    # Mast at the front with a stereo camera head.
    mast_base = (0.0, 0.92, top + 0.44)
    mast_top = (0.0, 0.92, 1.62)
    pz.tube('mast', mast_base, mast_top, 0.03, m['frame'], segments=10)
    pz.box('mast_head', (0.42, 0.16, 0.14), (0, 0.92, 1.69), m['dark'], chamfer=0.015)
    for x in (-0.13, 0.13):
        lens = pz.lathe(f'lens_{x:+.2f}', [(0.035, 0.0), (0.035, 0.03)], 16, m['glass'], cap_top=True)
        lens.data.transform(pz.Matrix.Translation((x, 1.0, 1.69)) @ pz.Matrix.Rotation(-math.pi / 2, 4, 'X'))
    # High-gain antenna at the back, a small dish on a short boom.
    pz.tube('hga_boom', (0.45, -0.85, top + 0.44), (0.45, -0.85, top + 0.75), 0.018, m['frame'])
    f = 0.18
    dish_mat = pz.material('rover_dish', '#d6d0bd', metallic=0.12, roughness=0.5, double_sided=False)
    dish = pz.lathe('hga', [(0.02, 0.0), (0.1, 0.1 ** 2 / (4 * f)), (0.18, 0.18 ** 2 / (4 * f)), (0.18, 0.18 ** 2 / (4 * f) + 0.012), (0.02, 0.012)],
                    28, dish_mat, smooth_angle=60)
    dish.data.transform(pz.Matrix.Translation((0.45, -0.85, top + 0.77)) @ pz.Matrix.Rotation(0.6, 4, 'X'))
    # The stripe, on the front of the chassis.
    pz.box('stripe', (0.8, 0.02, 0.06), (0, 1.11, CLEAR + 0.22), m['ember'])
    # Instrument rack at the rear: three canisters for the three packages.
    for i, x in enumerate((-0.36, 0.0, 0.36)):
        can = pz.lathe(f'canister_{i}', [(0.09, 0.0), (0.09, 0.26), (0.06, 0.29)], 16, m['hull'], cap_bottom=True, cap_top=True)
        can.data.transform(pz.Matrix.Translation((x, -1.02, top - 0.06)))


def suspension(m):
    """Rockers pivot on the body; bogies on the rockers; six hubs on the ground."""
    hub_z = R + GROUSER                  # cleat tips on the ground
    pivot_z = CLEAR + 0.12
    for sx in (-1, 1):
        x = sx * TRACK / 2
        bx = sx * (TRACK / 2 - 0.16)          # the arms run just inboard of the wheels
        front = (x, BASE / 2, hub_z)
        mid = (x, 0.0, hub_z)
        rear = (x, -BASE / 2, hub_z)
        rocker_pivot = (bx, 0.15, pivot_z)
        bogie_pivot = (bx, -BASE / 4, hub_z + 0.2)
        # Body to rocker pivot.
        pz.tube(f'rocker_mount_{sx:+d}', (sx * 0.62, 0.15, pivot_z), rocker_pivot, 0.04, m['frame'])
        pz.sphere(f'rocker_joint_{sx:+d}', rocker_pivot, 0.06, m['dark'], segments=12, rings=6)
        # Rocker: pivot to front hub, pivot to bogie pivot.
        pz.tube(f'rocker_front_{sx:+d}', rocker_pivot, (bx, BASE / 2, hub_z + 0.02), 0.035, m['frame'])
        pz.tube(f'rocker_rear_{sx:+d}', rocker_pivot, bogie_pivot, 0.035, m['frame'])
        pz.sphere(f'bogie_joint_{sx:+d}', bogie_pivot, 0.05, m['dark'], segments=12, rings=6)
        # Bogie: to the middle and rear hubs.
        pz.tube(f'bogie_mid_{sx:+d}', bogie_pivot, (bx, 0.0, hub_z + 0.02), 0.03, m['frame'])
        pz.tube(f'bogie_rear_{sx:+d}', bogie_pivot, (bx, -BASE / 2, hub_z + 0.02), 0.03, m['frame'])
        # Short stub axles from the arms into each hub.
        for (hx, hy, hz) in (front, mid, rear):
            pz.tube(f'axle_{sx:+d}_{hy:+.2f}', (bx, hy, hz), (hx - sx * WHEEL_W * 0.4, hy, hz), 0.025, m['dark'], segments=8)
    return [(sx * TRACK / 2, y, hub_z) for sx in (-1, 1) for y in (BASE / 2, 0.0, -BASE / 2)]


def surfaces(m):
    """What each part is made of (art/lib/surfacing.py). The rover's origin is on
    the ground, so dust reaches about half a metre up the body; each wheel's
    origin is its hub, and a wheel is dusty all over."""
    sf.surface(m['hull'], 'paint', colour='#d6d0bd', panel=0.7, rough=0.5, dust_top=0.55)
    sf.surface(m['frame'], 'metal', colour='#a3a5a2', rough=0.34, dust_top=0.6)
    sf.surface(m['dark'], 'anodised', colour='#33393c', dust_top=0.6)
    sf.surface(m['tyre'], 'tread', dust_top=0.2)
    sf.surface(m['solar'], 'solar', cell=0.125)
    sf.surface(m['glass'], 'glass')
    sf.surface(m['foil'], 'foil', colour='#c9973c', dust_top=0.55)
    sf.surface(m['ember'], 'flat', colour='#ff6b2c', rough=0.55, dust_top=0.55)
    dish = bpy.data.materials.get('rover_dish')
    if dish is not None:
        sf.surface(dish, 'paint', colour='#d6d0bd', panel=3.0, rough=0.45)


def main():
    a = args()
    pz.reset_scene()
    m = materials()
    body(m)
    hubs = suspension(m)
    # Everything so far is the body; join it before the wheels exist.
    pz.join_meshes('rover_body')
    for k, hub in enumerate(hubs):
        wheel(f'wheel_{k}', hub, m)
    surfaces(m)
    meshes = sorted((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: o.name)
    sf.bake_asset(meshes, 'rover', **pz.bake_options(a, 1024))
    pz.empty('seat', (0.0, 0.1, CLEAR + 0.9))
    pz.empty('mast_camera', (0.0, 1.0, 1.69))
    tris = sum(pz.triangle_count(o) for o in bpy.context.scene.objects if o.type == 'MESH')
    print(f'PZ-TRIANGLES {tris}')
    if a['blend']:
        pz.save_blend(a['blend'])
    if a['preview']:
        sf.preview(a['preview'], meshes)
    if a['out']:
        pz.export_glb(a['out'])
        print(f'PZ-WROTE {a["out"]}')


main()
