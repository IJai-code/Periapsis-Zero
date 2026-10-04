"""
The survey lander, built from its numbers.

Run through the build command, never by hand:

    npm run art:build -- survey-lander

This replaces the thirty-odd primitives of `SurveyLander` in
`src/components/ExpeditionScene.jsx` with a machined vehicle, and it keeps
every dimension the simulation and the cameras depend on. Those numbers live in
`spec.json` beside this file, in the runtime's own coordinates, and are read
here rather than retyped: the origin 2.65 m above the ground
(`VEHICLE.clearance`), footpad soles at -2.60 under pads 3.2 m out on each
diagonal, the engine's exit plane at -1.85 with a 0.65 m radius, and the top of
the antenna at +3.75. `verify-art` checks the exported file against the same
spec, so the model cannot drift from the physics it is drawn for.

Coordinates below are Blender's (Z-up). The runtime's -Z, the side the window
and the ember stripe are on, is Blender's +Y; the hatch and ladder are on -Y.
The fiction is a small reusable survey lander: a two-person crew module on an
octagonal descent stage, four tanks in foil, one throttleable engine.
"""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import pz  # noqa: E402
import surfacing as sf  # noqa: E402

SPEC = json.load(open(os.path.join(HERE, 'spec.json')))

SOLE_Z = SPEC['footpadSoleY']            # three y -> Blender z
PAD_R = SPEC['footpadRadius']
PAD_XY = 3.2                             # every pad is on a diagonal, 3.2 m out
EXIT_Z = SPEC['nozzleExitY']
EXIT_R = SPEC['nozzleExitRadius']
TOP_Z = SPEC['bounds']['max'][1]

STAGE_APOTHEM = 1.75                     # the descent stage's flats
STAGE_Z0, STAGE_Z1 = -1.1, 1.1
THROAT_Z, THROAT_R = -1.05, 0.33


def args():
    return pz.cli()


def materials():
    return {
        # Painted panels: white that is not paper-white, so the sun does not clip it.
        'hull': pz.material('hull', '#d8d4c4', metallic=0.12, roughness=0.55),
        'frame': pz.material('frame', '#9a9c98', metallic=0.85, roughness=0.36),
        'dark': pz.material('dark', '#3b4043', metallic=0.6, roughness=0.5),
        # Foil, not gold paint, but not a mirror either: the expedition renders
        # without an environment map, and a fully metallic surface there
        # reflects a black sky and turns brown. Measured in the first preview,
        # the bays read as dark boards; 0.7 keeps the gold and the glints.
        'foil': pz.material('foil', '#d6ae55', metallic=0.7, roughness=0.34),
        # The bell is an open shell, seen from inside: the one double-sided part.
        'engine': pz.material('engine', '#4b4743', metallic=0.85, roughness=0.55, double_sided=True),
        'glass': pz.material('glass', '#0f222c', metallic=0.2, roughness=0.08),
        'solar': pz.material('solar', '#1d2c46', metallic=0.45, roughness=0.22),
        # The project's ember, the one warm accent on the vehicle.
        'ember': pz.material('ember', '#ff6b2c', metallic=0.0, roughness=0.6),
        # Gold-anodised truss for the legs, silver film on the upper deck, and
        # the braided harness that runs down each leg.
        'truss': pz.material('truss', '#c8902c', metallic=0.85, roughness=0.38),
        'silver': pz.material('silver_foil', '#d9d9d4', metallic=1.0, roughness=0.25),
        'cable': pz.material('cable', '#5a4630', metallic=0.3, roughness=0.6),
    }


def descent_stage(m):
    """Octagonal stage, structural rings, foil bays on the diagonals, four tanks."""
    circum = STAGE_APOTHEM / math.cos(math.pi / 8)
    # The whole stage is blanketed in gold multi-layer insulation, the way a
    # descent stage actually flies: a film over the structure, puckered where
    # it is taped down, never flat.
    stage = pz.prism('stage', circum, STAGE_Z0, STAGE_Z1, 8, m['foil'], chamfer=0.035)
    pz.subdivide(stage, 6)
    pz.crinkle(stage, 0.014, 4.5, seed=3)
    # A silver blanket over the upper deck, a little proud of the rim.
    pz.prism('deck_blanket', circum + 0.03, STAGE_Z1 - 0.01, STAGE_Z1 + 0.03, 8, m['silver'], chamfer=0.01)
    ring = (STAGE_APOTHEM + 0.04) / math.cos(math.pi / 8)
    for z in (STAGE_Z0, STAGE_Z1 - 0.09):
        pz.prism(f'ring_{z:+.2f}', ring, z, z + 0.09, 8, m['dark'], chamfer=0.012)

    # Foil bays on the four diagonal faces: subdivided, then crinkled, because
    # multi-layer insulation is a film over a frame and is never flat.
    # Black radiator panels on the diagonals, with louvres: the heat the crew
    # module makes has to go somewhere, and this is where it is seen to go.
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        rot = pz.Matrix.Rotation(a - math.pi / 2, 4, 'Z')
        place = pz.Matrix.Translation((math.cos(a) * (STAGE_APOTHEM + 0.03),
                                       math.sin(a) * (STAGE_APOTHEM + 0.03), 0.25)) @ rot
        panel = pz.box(f'radiator_{k}', (1.0, 0.04, 0.95), (0, 0, 0), m['dark'], chamfer=0.01)
        panel.data.transform(place)
        for i in range(7):
            fin = pz.box(f'radiator_{k}_louvre_{i}', (0.9, 0.05, 0.035), (0, 0.03, -0.38 + i * 0.125), m['frame'])
            fin.data.transform(place @ pz.Matrix.Rotation(0.5, 4, 'X'))

    # Propellant tanks proud of the two side faces, two a side.
    for sx in (-1, 1):
        for sy in (-1, 1):
            tank = pz.sphere(f'tank_{sx:+d}{sy:+d}', (0, 0, 0), 0.57, m['foil'], segments=32, rings=16)
            pz.crinkle(tank, 0.01, 7.0, seed=10 + sx * 3 + sy)
            tank.data.transform(pz.Matrix.Translation((sx * 1.9, sy * 0.7, 0.0)))
            # A strap round each tank's waist.
            band = pz.lathe(f'strap_{sx:+d}{sy:+d}', [(0.585, -0.04), (0.585, 0.04)], 32, m['dark'],
                            cap_bottom=False, cap_top=False)
            band.data.transform(pz.Matrix.Translation((sx * 1.9, sy * 0.7, 0.0)))

    # The stripe, on the front face, where the primitive version carried it.
    pz.box('stripe', (1.3, 0.04, 0.14), (0, STAGE_APOTHEM + 0.02, 0.3), m['ember'], chamfer=0.008)

    # Sample bay door (+X, under the tanks) and the rover's stowage frame (-X).
    pz.box('sample_door', (0.05, 0.72, 0.42), (STAGE_APOTHEM + 0.025, 0, -0.78), m['dark'], chamfer=0.01)
    pz.tube('sample_handle', (STAGE_APOTHEM + 0.07, -0.2, -0.62), (STAGE_APOTHEM + 0.07, 0.2, -0.62), 0.015, m['frame'])
    for dy in (-0.45, 0.45):
        pz.tube(f'rover_rail_{dy:+.2f}', (-STAGE_APOTHEM - 0.05, dy, -1.05), (-STAGE_APOTHEM - 0.05, dy, -0.45), 0.03, m['frame'])
    pz.tube('rover_rail_cross', (-STAGE_APOTHEM - 0.05, -0.45, -0.75), (-STAGE_APOTHEM - 0.05, 0.45, -0.75), 0.025, m['frame'])


def crew_module(m):
    """Two-person cabin, front window, solar deck, four RCS quads."""
    pz.box('cabin', (2.6, 2.5, 1.5), (0, 0, 1.5), m['hull'], chamfer=0.06)
    # Panel seams: a hair proud of each face, darker than the hull.
    for x in (-0.65, 0.65):
        for y in (-1.255, 1.255):
            if y > 0 and abs(x) < 0.95:
                continue                     # the window takes the front's middle
            pz.box(f'seam_v_{x:+.2f}_{y:+.2f}', (0.018, 0.012, 1.36), (x, y, 1.5), m['dark'])
    for y in (-0.62, 0.62):
        for x in (-1.305, 1.305):
            pz.box(f'seam_side_{x:+.2f}_{y:+.2f}', (0.012, 0.018, 1.36), (x, y, 1.5), m['dark'])
    for x in (-1.305, 1.305):
        pz.box(f'seam_h_{x:+.2f}', (0.012, 2.36, 0.018), (x, 0, 1.08), m['dark'])
    # Handrails along both sides, for a crew member working outside.
    for sx in (-1, 1):
        x = sx * 1.37
        pz.tube(f'handrail_{sx:+d}', (x, -0.9, 1.92), (x, 0.9, 1.92), 0.018, m['frame'])
        for y in (-0.9, 0.0, 0.9):
            pz.tube(f'handrail_post_{sx:+d}_{y:+.1f}', (sx * 1.3, y, 1.92), (x, y, 1.92), 0.014, m['frame'])
    # A silver blanket wrapped round the cabin's lower half, below the
    # window line: the thermal skirt that keeps the crew deck warm.
    skirt = pz.box('cabin_blanket', (2.64, 2.54, 0.62), (0, 0, 1.06), m['silver'], chamfer=0.04)
    pz.subdivide(skirt, 6)
    pz.crinkle(skirt, 0.01, 5.0, seed=9)
    # Window with a frame, on the front (+Y).
    pz.box('window_frame', (1.82, 0.05, 0.72), (0, 1.262, 1.62), m['dark'], chamfer=0.015)
    pz.box('window', (1.66, 0.05, 0.58), (0, 1.282, 1.62), m['glass'], chamfer=0.01)
    # Solar deck on the roof, with the ribs between its cells.
    pz.box('solar', (1.8, 1.6, 0.06), (0, 0, 2.32), m['solar'], chamfer=0.01)
    for i in range(5):
        x = -0.72 + i * 0.36
        pz.box(f'solar_rib_{i}', (0.025, 1.6, 0.015), (x, 0, 2.355), m['frame'])

    # RCS quads at the cabin's upper corners: a block and three thrusters each.
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy, cz = sx * 1.36, sy * 1.3, 2.02
            pz.box(f'rcs_{sx:+d}{sy:+d}', (0.2, 0.2, 0.2), (cx, cy, cz), m['dark'], chamfer=0.02)
            for name, (dx, dy, dz) in (('x', (sx, 0, 0)), ('y', (0, sy, 0)), ('z', (0, 0, 1))):
                bell = pz.lathe(f'rcs_{sx:+d}{sy:+d}_{name}', [(0.03, 0.0), (0.045, 0.06), (0.06, 0.11)],
                                12, m['engine'], cap_bottom=True)
                rot = pz.Vector((0, 0, 1)).rotation_difference(pz.Vector((dx, dy, dz))).to_matrix().to_4x4()
                bell.data.transform(pz.Matrix.Translation((cx + dx * 0.1, cy + dy * 0.1, cz + dz * 0.1)) @ rot)


def engine(m):
    """Bell, lip, stiffeners and the chamber above the throat."""
    profile = []
    for i in range(15):
        t = i / 14
        # A bell rather than a cone: it opens fast from the throat and
        # straightens toward the exit, which is the shape that keeps the flow
        # attached and the one a viewer recognises as an engine.
        r = THROAT_R + (EXIT_R - THROAT_R) * (1 - (1 - t) ** 2)
        profile.append((r, THROAT_Z + (EXIT_Z - THROAT_Z) * t))
    profile.reverse()                      # bottom to top for the lathe
    bell = pz.lathe('bell', profile, 48, m['engine'], smooth_angle=60)
    lip = pz.lathe('bell_lip', [(EXIT_R, EXIT_Z), (EXIT_R + 0.03, EXIT_Z + 0.015),
                                (EXIT_R + 0.03, EXIT_Z + 0.05), (EXIT_R - 0.005, EXIT_Z + 0.06)],
                   48, m['dark'], smooth_angle=50)
    for f in (0.35, 0.7):
        z = THROAT_Z + (EXIT_Z - THROAT_Z) * f
        r = THROAT_R + (EXIT_R - THROAT_R) * (1 - (1 - f) ** 2) + 0.012
        pz.lathe(f'bell_stiffener_{f}', [(r, z - 0.018), (r + 0.012, z), (r, z + 0.018)], 48, m['dark'])
    pz.lathe('chamber', [(THROAT_R - 0.02, THROAT_Z), (0.3, THROAT_Z + 0.1), (0.3, STAGE_Z0 + 0.35),
                         (0.18, STAGE_Z0 + 0.42)], 32, m['dark'], cap_top=True)
    return bell, lip


def legs(m):
    """Four legs on the diagonals: primary strut with a shock sleeve, a
    secondary strut, two side braces, a ball joint and a dished footpad."""
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        pad = pz.Vector((sx * PAD_XY, sy * PAD_XY, 0))
        knee = pad + pz.Vector((0, 0, SOLE_Z + 0.2))
        # Attach points sit on the diagonal face itself. The first version put
        # the primary strut's top 0.23 m outside the stage and the braces' feet
        # half a metre out, so in the preview they began in mid-air.
        on_face = (STAGE_APOTHEM - 0.05) / math.sqrt(2)
        top = pz.Vector((sx * on_face, sy * on_face, -0.5))
        upper = pz.Vector((sx * on_face, sy * on_face, 0.75))
        pz.tube(f'leg_{k}_primary', top, knee, 0.085, m['truss'], segments=14)
        # The shock absorber: a long dark cylinder over the lower primary
        # strut, its crushable core inside, with a collar where it slides.
        a = top.lerp(knee, 0.42)
        b = top.lerp(knee, 0.9)
        pz.tube(f'leg_{k}_sleeve', a, b, 0.13, m['dark'], segments=18)
        pz.tube(f'leg_{k}_collar', a.lerp(b, -0.03), a.lerp(b, 0.05), 0.15, m['frame'], segments=18)
        pz.tube(f'leg_{k}_secondary', upper, knee, 0.05, m['truss'], segments=10)
        # The secondary strut is a truss, not a rod: a zigzag web between it
        # and the primary.
        for i in range(5):
            t0, t1 = 0.12 + i * 0.16, 0.2 + i * 0.16
            pz.tube(f'leg_{k}_web_{i}', top.lerp(knee, t0), upper.lerp(knee, t1), 0.018, m['truss'], segments=6)
        # The harness: a braided cable wound loosely down the shock strut.
        axis = (b - a)
        side = axis.cross(pz.Vector((0, 0, 1))).normalized()
        other = axis.normalized().cross(side)
        points = []
        for i in range(49):
            t = i / 48
            ang = t * math.tau * 2.25
            points.append(a.lerp(b, t) + (side * math.cos(ang) + other * math.sin(ang)) * 0.155)
        for i in range(48):
            pz.tube(f'leg_{k}_cable_{i}', points[i], points[i + 1], 0.014, m['cable'], segments=6, caps=False)
        mid = top.lerp(knee, 0.42)
        tangent = pz.Vector((-sy, sx, 0)).normalized()
        base = pz.Vector((sx * on_face, sy * on_face, STAGE_Z0 + 0.08))
        for side in (-1, 1):
            foot = base + tangent * (0.5 * side)
            pz.tube(f'leg_{k}_brace_{side:+d}', foot, mid, 0.035, m['truss'], segments=8)
            pz.sphere(f'leg_{k}_brace_mount_{side:+d}', foot, 0.06, m['dark'], segments=12, rings=6)
        for p_, r_ in ((top, 0.13), (upper, 0.09)):
            pz.sphere(f'leg_{k}_mount_{p_.z:+.2f}', p_, r_, m['dark'], segments=16, rings=8)
        pz.sphere(f'leg_{k}_joint', knee, 0.12, m['dark'], segments=16, rings=8)
        foot = pz.lathe(f'leg_{k}_pad', [
            (PAD_R - 0.07, SOLE_Z), (PAD_R, SOLE_Z + 0.04), (PAD_R, SOLE_Z + 0.09),
            (PAD_R - 0.05, SOLE_Z + 0.13), (0.13, SOLE_Z + 0.17), (0.11, SOLE_Z + 0.2),
        ], 32, m['frame'], cap_bottom=True, cap_top=True, smooth_angle=40)
        foot.data.transform(pz.Matrix.Translation((pad.x, pad.y, 0)))


def hatch_and_ladder(m):
    """Hatch on the rear face, a porch below it, a railed ladder to the ground."""
    y = -STAGE_APOTHEM
    pz.box('hatch_frame', (1.02, 0.07, 1.5), (0, y - 0.02, 0.2), m['dark'], chamfer=0.015)
    pz.box('hatch_door', (0.88, 0.05, 1.36), (0, y - 0.05, 0.2), m['hull'], chamfer=0.02)
    pz.tube('hatch_handle', (-0.18, y - 0.1, 0.25), (0.18, y - 0.1, 0.25), 0.018, m['frame'])
    porch_z = STAGE_Z0 + 0.52
    pz.box('porch', (1.1, 0.62, 0.05), (0, y - 0.33, porch_z), m['frame'], chamfer=0.01)
    for x in (-0.53, 0.53):
        pz.tube(f'porch_post_{x:+.2f}', (x, y - 0.6, porch_z), (x, y - 0.6, porch_z + 0.9), 0.02, m['frame'])
        pz.tube(f'porch_rail_{x:+.2f}', (x, y - 0.6, porch_z + 0.9), (x, y - 0.02, porch_z + 0.9), 0.02, m['frame'])
    pz.tube('porch_top_rail', (-0.53, y - 0.6, porch_z + 0.9), (0.53, y - 0.6, porch_z + 0.9), 0.02, m['frame'])
    # The ladder: two stringers and rungs every 28 cm, from the porch to just
    # above the ground, braced back to the stage's lower ring.
    ly = y - 0.42
    bottom = SOLE_Z + 0.3
    for x in (-0.36, 0.36):
        pz.tube(f'ladder_stringer_{x:+.2f}', (x, ly, porch_z), (x, ly - 0.25, bottom), 0.028, m['frame'])
        pz.tube(f'ladder_brace_{x:+.2f}', (x, ly - 0.16, bottom + 0.6), (x * 0.8, y + 0.05, STAGE_Z0 + 0.04), 0.022, m['frame'])
    steps = int((porch_z - bottom) / 0.28)
    for i in range(1, steps + 1):
        t = i / (steps + 1)
        z = porch_z + (bottom - porch_z) * t
        yy = ly - 0.25 * t
        pz.tube(f'ladder_rung_{i}', (-0.36, yy, z), (0.36, yy, z), 0.02, m['frame'])
    return pz.Vector((0, ly - 0.25, SOLE_Z))


def antenna(m):
    """Mast, a parabolic dish with a feed on a tripod, placed so its top is the spec's."""
    import bpy
    parts = []
    mast_base = pz.Vector((0.9, -0.4, 2.25))
    mast_top = pz.Vector((0.9, -0.4, 3.18))
    parts.append(pz.tube('mast', mast_base, mast_top, 0.04, m['frame']))
    f = 0.3
    profile = [(r, r * r / (4 * f)) for r in (0.03, 0.12, 0.22, 0.32, 0.4, 0.45)]
    # Its own material, because only the dish is open: double-siding the whole
    # hull would draw the back of every closed panel for nothing.
    dish_mat = pz.material('dish', '#d8d4c4', metallic=0.12, roughness=0.5, double_sided=True)
    dish = pz.lathe('dish', profile, 40, dish_mat, cap_bottom=True, smooth_angle=60)
    feed = pz.tube('dish_feed', (0, 0, f - 0.05), (0, 0, f + 0.04), 0.035, m['dark'])
    legs_ = [pz.tube(f'dish_strut_{i}', (0.42 * math.cos(a), 0.42 * math.sin(a), 0.42 * 0.42 / (4 * f)),
                     (0, 0, f - 0.04), 0.008, m['frame'], segments=6)
             for i, a in enumerate((0.3, 0.3 + 2.094, 0.3 + 4.189))]
    tilt = pz.Matrix.Rotation(-0.5, 4, 'X')
    for o in [dish, feed, *legs_]:
        o.data.transform(pz.Matrix.Translation(mast_top) @ tilt)
        parts.append(o)
    # Lift the antenna so its highest vertex is exactly the spec's top.
    bpy.context.view_layer.update()
    top = max((o.matrix_world @ v.co).z for o in parts for v in o.data.vertices)
    lift = TOP_Z - top
    for o in parts:
        o.data.transform(pz.Matrix.Translation((0, 0, lift)))
    # And grow the mast's foot back down to the roof.
    mast = parts[0]
    for v in mast.data.vertices:
        if v.co.z < mast_base.z + lift + 0.01:
            v.co.z = 2.25


# Dust reaches about 0.9 m up from the soles: footpads, the feet of the legs,
# the nozzle's lip. Blender z here is height above the vehicle's origin.
DUST = SOLE_Z + 0.9


def surfaces(m):
    """What each material is made of (art/lib/surfacing.py), before the bake."""
    sf.surface(m['hull'], 'paint', colour='#d8d4c4', panel=0.55, rough=0.5, dust_top=DUST)
    sf.surface(m['frame'], 'metal', colour='#a3a5a2', rough=0.32, dust_top=DUST)
    sf.surface(m['dark'], 'anodised', colour='#363b3e', dust_top=DUST)
    sf.surface(m['foil'], 'foil', colour='#c9973c', dust_top=DUST)
    sf.surface(m['engine'], 'nozzle', throat_z=THROAT_Z, exit_z=EXIT_Z)
    sf.surface(m['glass'], 'glass')
    sf.surface(m['solar'], 'solar')
    sf.surface(m['ember'], 'flat', colour='#ff6b2c', rough=0.55, dust_top=DUST)
    sf.surface(pz.bpy.data.materials['dish'], 'paint', colour='#d8d4c4', panel=3.0, rough=0.45)
    sf.surface(m['truss'], 'metal', colour='#c8902c', rough=0.36, brushed_axis=2, dust_top=DUST)
    sf.surface(m['silver'], 'foil', silver=True)
    sf.surface(m['cable'], 'flat', colour='#5a4630', metal=0.2, rough=0.6, dust_top=DUST)


def main():
    a = args()
    pz.reset_scene()
    m = materials()
    descent_stage(m)
    crew_module(m)
    engine(m)
    legs(m)
    ladder_foot = hatch_and_ladder(m)
    antenna(m)

    body = pz.join_meshes('survey_lander')
    surfaces(m)
    sf.bake_asset([body], 'lander', **pz.bake_options(a, 2048))

    # The points the runtime reads, in Blender coordinates.
    pz.empty('nozzle_0', (0, 0, EXIT_Z))
    pz.empty('hatch', (0, -STAGE_APOTHEM - 0.1, 0.2))
    pz.empty('ladder_base', tuple(ladder_foot))
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (1, -1), (-1, -1))):
        pz.empty(f'footpad_{k}', (sx * PAD_XY, sy * PAD_XY, SOLE_Z))
    pz.empty('sample_bay', (STAGE_APOTHEM + 0.08, 0, -0.78))
    pz.empty('rover_mount', (-STAGE_APOTHEM - 0.08, 0, -0.75))

    print(f'PZ-TRIANGLES {pz.triangle_count(body)}')
    print(f'PZ-MATERIALS {len(body.data.materials)}')
    if a['blend']:
        pz.save_blend(a['blend'])
    if a['preview']:
        sf.preview(a['preview'], [body])
    if a['out']:
        pz.export_glb(a['out'])
        print(f'PZ-WROTE {a["out"]}')


main()
