"""
The survey kit: three instrument packages and the stake that marks a sample.

    npm run art:build -- survey-kit

Each prop is one object with its origin on the ground point it stands on, so
the runtime can clone it by name and stand it at a site. Each instrument has a
small status light made of the material named `status`; the game recolours it
when the package is deployed, so the model carries no game state.

What each one is for decides its shape, which is the point of the three of
them being different:
  seismometer   a squat sensor under a domed thermal cover, low and heavy, on
                three short feet: it has to couple to the ground and nothing else.
  magnetometer  a sensor head on the end of a two-metre-class boom, as far from
                its own electronics as it can be carried.
  heat probe    an electronics box with a tether running into the ground, where
                the probe itself has hammered down out of sight.
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
LAYOUT = {'seismometer': -3.3, 'magnetometer': -1.1, 'heat_probe': 1.1, 'stake': 3.3}


def args():
    return pz.cli()


def materials():
    return {
        'hull': pz.material('kit_hull', '#d8d2bf', metallic=0.2, roughness=0.5),
        'frame': pz.material('kit_frame', '#9a9b97', metallic=0.85, roughness=0.35),
        'dark': pz.material('kit_dark', '#33393c', metallic=0.55, roughness=0.5),
        'foil': pz.material('kit_foil', '#d6ae55', metallic=0.7, roughness=0.34),
        'solar': pz.material('kit_solar', '#1d2c46', metallic=0.45, roughness=0.22),
        'ember': pz.material('kit_ember', '#ff6b2c', metallic=0.0, roughness=0.6),
        # Recoloured by the game when a package is set up.
        'status': pz.material('status', '#c8c2ae', metallic=0.0, roughness=0.4),
    }


def legs(prefix, cx, top_z, spread, height, m, r=0.018):
    """Three splayed feet from a hub at top_z to the ground."""
    parts = []
    for k in range(3):
        a = math.pi / 2 + k * 2 * math.pi / 3
        foot = (cx + spread * math.cos(a), spread * math.sin(a), 0.0)
        # The tube ends on top of the foot pad: a tilted tube's end ring dips
        # below its end point by about its radius, which put every leg 2 cm
        # into the ground (verify-art measured -0.021 m).
        on_pad = (foot[0], foot[1], 0.03)
        parts.append(pz.tube(f'{prefix}_leg_{k}', (cx + 0.08 * math.cos(a), 0.08 * math.sin(a), top_z), on_pad, r, m['frame'], segments=8))
        parts.append(pz.lathe(f'{prefix}_foot_{k}', [(0.05, 0.0), (0.05, 0.015), (0.025, 0.03)], 12, m['dark'], cap_bottom=True))
        parts[-1].data.transform(pz.Matrix.Translation(foot))
    return parts


def seismometer(m):
    x = LAYOUT['seismometer']
    parts = legs('seis', x, 0.12, 0.42, 0.12, m, r=0.022)
    # The sensor sphere under a domed, foil-skirted cover.
    parts.append(pz.lathe('seis_skirt', [(0.46, 0.04), (0.44, 0.1), (0.36, 0.14)], 40, m['foil'], smooth_angle=40))
    dome = pz.sphere('seis_dome', (x, 0.0, 0.1), 0.36, m['hull'], segments=40, rings=14, z_cut=0.0)
    parts.append(dome)
    parts[-2].data.transform(pz.Matrix.Translation((x, 0, 0)))
    parts.append(pz.box('seis_status', (0.06, 0.02, 0.04), (x, -0.355, 0.2), m['status']))
    parts.append(pz.tube('seis_tether', (x + 0.36, 0, 0.12), (x + 0.9, 0.0, 0.02), 0.01, m['dark'], segments=6))
    return pz.join(parts, 'seismometer', (x, 0.0, 0.0))


def magnetometer(m):
    x = LAYOUT['magnetometer']
    parts = legs('mag', x, 0.5, 0.45, 0.5, m)
    parts.append(pz.box('mag_box', (0.3, 0.24, 0.16), (x, 0.0, 0.58), m['hull'], chamfer=0.015))
    parts.append(pz.box('mag_panel', (0.42, 0.3, 0.02), (x, 0.0, 0.68), m['solar'], chamfer=0.004))
    # The boom, angled up and out, with the sensor head at its tip.
    tip = (x + 0.0, -0.62, 1.78)
    parts.append(pz.tube('mag_boom', (x, -0.05, 0.66), tip, 0.018, m['frame'], segments=8))
    parts.append(pz.lathe('mag_head', [(0.05, -0.06), (0.06, -0.02), (0.06, 0.06), (0.03, 0.09)], 16, m['dark'], cap_bottom=True, cap_top=True))
    parts[-1].data.transform(pz.Matrix.Translation(tip))
    parts.append(pz.box('mag_status', (0.04, 0.02, 0.04), (x + 0.1, -0.125, 0.6), m['status']))
    return pz.join(parts, 'magnetometer', (x, 0.0, 0.0))


def heat_probe(m):
    x = LAYOUT['heat_probe']
    parts = legs('heat', x, 0.34, 0.36, 0.34, m)
    parts.append(pz.box('heat_box', (0.4, 0.3, 0.22), (x, 0.0, 0.42), m['foil'], chamfer=0.01))
    parts.append(pz.box('heat_lid', (0.42, 0.32, 0.03), (x, 0.0, 0.545), m['hull'], chamfer=0.006))
    # The mole's housing beside it, empty now, and the tether into the ground.
    parts.append(pz.lathe('heat_housing', [(0.05, 0.0), (0.05, 0.42), (0.03, 0.46)], 16, m['hull'], cap_top=True))
    parts[-1].data.transform(pz.Matrix.Translation((x + 0.42, 0.0, 0.0)))
    parts.append(pz.tube('heat_tether', (x + 0.2, 0.0, 0.36), (x + 0.42, 0.0, 0.02), 0.008, m['dark'], segments=6))
    parts.append(pz.lathe('heat_entry', [(0.06, 0.0), (0.035, 0.012)], 16, m['dark'], cap_top=True))
    parts[-1].data.transform(pz.Matrix.Translation((x + 0.42, 0.0, 0.0)))
    parts.append(pz.box('heat_status', (0.05, 0.02, 0.04), (x - 0.1, -0.155, 0.46), m['status']))
    return pz.join(parts, 'heat_probe', (x, 0.0, 0.0))


def stake(m):
    """A sample stake: a thin pole and a small ember flag, so a site reads from afar."""
    x = LAYOUT['stake']
    parts = [pz.tube('stake_pole', (x, 0.0, 0.0), (x, 0.0, 1.35), 0.014, m['frame'], segments=8)]
    flag = pz.box('stake_flag', (0.26, 0.006, 0.16), (x + 0.135, 0.0, 1.26), m['ember'])
    pz.subdivide(flag, 4)
    for v in flag.data.vertices:
        v.co.y += 0.025 * math.sin((v.co.x - x) * 14.0)    # a slight wave, as if just planted
    parts.append(flag)
    parts.append(pz.lathe('stake_cap', [(0.02, 1.35), (0.0, 1.38)], 10, m['dark']))
    return pz.join(parts, 'stake', (x, 0.0, 0.0))


def main():
    a = args()
    pz.reset_scene()
    m = materials()
    objs = [seismometer(m), magnetometer(m), heat_probe(m), stake(m)]
    print(f'PZ-TRIANGLES {sum(pz.triangle_count(o) for o in objs)}')
    # Each prop stands with its origin on the ground: dust on the feet.
    sf.surface(m['hull'], 'paint', colour='#d8d2bf', panel=0.5, rough=0.5, dust_top=0.22)
    sf.surface(m['frame'], 'metal', colour='#a3a5a2', rough=0.34, dust_top=0.22)
    sf.surface(m['dark'], 'anodised', colour='#33393c', dust_top=0.22)
    sf.surface(m['foil'], 'foil', colour='#c9973c', dust_top=0.22)
    sf.surface(m['solar'], 'solar', cell=0.1)
    # The status lamp and the stake's flag stay their own materials: the
    # runtime clones them to light them (ExpeditionScene, useKitProp).
    sf.bake_asset(objs, 'kit', keep=('status', 'kit_ember'), **pz.bake_options(a, 1024))
    if a['blend']:
        pz.save_blend(a['blend'])
    if a['preview']:
        sf.preview(a['preview'], objs)
    if a['out']:
        pz.export_glb(a['out'])
        print(f'PZ-WROTE {a["out"]}')


main()
