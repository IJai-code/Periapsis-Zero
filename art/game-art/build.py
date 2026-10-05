"""
The game's pictures, path traced in Cycles: the title screen's key art, the
shipyard's hull portraits, and the people on the comms.

    npm run art:build -- game-art
    PZ_ONLY=portraits npm run art:build -- game-art     # one group

Writes into public/game/:
    keyart.webp              1920 x 1080: the Kestrel over the Moon, Earth beyond, Hearth's wheel
    hull-<id>.webp           960 x 540: each ship you can buy, lit like a showroom
    portrait-<who>.webp      512 x 512: helmets, because in 2091 nobody takes theirs off on comms

The ships are the same procedural models the game bakes (art/lib/craft.py),
rendered here with their full node materials. The Earth and the Moon are
NASA's imagery already in the repository.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'lib'))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import pz  # noqa: E402
import surfacing as sf  # noqa: E402
import craft  # noqa: E402

T = pz.from_three
TEX = os.path.join(ROOT, 'public', 'textures')


def fresh():
    pz.reset_scene()
    pz._materials.clear()
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new('world')
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0, 0, 0, 1)
    bg.inputs['Strength'].default_value = 0
    return scene


def render(path, size, samples=128, exposure=0.0):
    scene = bpy.context.scene
    sf._cycles(samples, device='GPU')
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = exposure
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = 84
    scene.render.filepath = path
    if pz.live():
        print(f'PZ-LIVE scene ready for {os.path.basename(path)}')
        return
    bpy.ops.render.render(write_still=True)
    print(f'PZ-WROTE {path}')


def camera(at, look, lens=50, roll=0.0):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    cam.clip_end = 1e7
    co = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(co)
    co.location = Vector(at)
    q = (Vector(look) - Vector(at)).to_track_quat('-Z', 'Y')
    co.rotation_euler = q.to_euler()
    co.rotation_euler.rotate_axis('Z', roll)
    bpy.context.scene.camera = co
    return co


def sun(direction, energy=4.0, colour=(1.0, 0.96, 0.9), angle=0.53):
    s = bpy.data.lights.new('sun', 'SUN')
    s.energy = energy
    s.color = colour
    s.angle = math.radians(angle)
    o = bpy.data.objects.new('sun', s)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (-Vector(direction).normalized()).to_track_quat('-Z', 'Y').to_euler()
    return o


def area(at, look, energy, colour, size=4.0):
    l = bpy.data.lights.new('area', 'AREA')
    l.energy = energy
    l.color = colour
    l.size = size
    o = bpy.data.objects.new('area', l)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(at)
    o.rotation_euler = (Vector(look) - Vector(at)).to_track_quat('-Z', 'Y').to_euler()
    return o


def stars(n=3000, radius=5e6):
    """Points of light on a far sphere, as tiny emissive icospheres instanced by a particle-free mesh."""
    import random
    rnd = random.Random(7)
    verts = []
    for _ in range(n):
        z = rnd.uniform(-1, 1)
        a = rnd.uniform(0, 2 * math.pi)
        r = math.sqrt(1 - z * z)
        verts.append((r * math.cos(a) * radius, r * math.sin(a) * radius, z * radius))
    me = bpy.data.meshes.new('stars')
    me.from_pydata(verts, [], [])
    o = bpy.data.objects.new('stars', me)
    bpy.context.scene.collection.objects.link(o)
    # Instance a small emissive sphere on every vertex.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=radius * 0.0009)
    dot = bpy.context.active_object
    mat = craft.emissive('star', '#fff6e8', 30.0)
    dot.data.materials.append(mat)
    dot.parent = o
    o.instance_type = 'VERTS'
    return o


def planet(name, centre, radius, colour_tex, normal_tex=None, night_tex=None, atmosphere=None, rotation=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=192, ring_count=96, radius=radius, location=centre)
    o = bpy.context.active_object
    o.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    o.rotation_euler = (0, 0, rotation)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(colour_tex)
    nt.links.new(tc.outputs['UV'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.92
    if normal_tex:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nimg = nt.nodes.new('ShaderNodeTexImage')
        nimg.image = bpy.data.images.load(normal_tex)
        nimg.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(tc.outputs['UV'], nimg.inputs['Vector'])
        nt.links.new(nimg.outputs['Color'], nm.inputs['Color'])
        nm.inputs['Strength'].default_value = 1.2
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if night_tex:
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(night_tex)
        nt.links.new(tc.outputs['UV'], n.inputs['Vector'])
        nt.links.new(n.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 0.6
    o.data.materials.append(m)
    if atmosphere:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=radius * 1.018, location=centre)
        a = bpy.context.active_object
        a.name = f'{name}_air'
        for p in a.data.polygons:
            p.use_smooth = True
        am = bpy.data.materials.new(f'{name}_air')
        am.use_nodes = True
        ant = am.node_tree
        ant.nodes.remove(ant.nodes['Principled BSDF'])
        vol = ant.nodes.new('ShaderNodeVolumeScatter')
        vol.inputs['Color'].default_value = atmosphere
        vol.inputs['Density'].default_value = 2.5 / radius
        ant.links.new(vol.outputs['Volume'], ant.nodes['Material Output'].inputs['Volume'])
        a.data.materials.append(am)
    return o


# --------------------------------------------------------------------------
# Key art
# --------------------------------------------------------------------------

def plume(at, length, radius, colour):
    """An engine plume: a glowing cone streaming aft (Blender -Y)."""
    x, y, z = at
    verts, faces, seg = [], [], 24
    for k, (r, d) in enumerate([(radius, 0.0), (radius * 0.85, length * 0.25), (radius * 0.4, length * 0.7), (0.02, length)]):
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append((x + r * math.cos(a), y - d, z + r * math.sin(a)))
    for j in range(3):
        for i in range(seg):
            a0, a1 = j * seg + i, j * seg + (i + 1) % seg
            faces.append((a0, a1, a1 + seg, a0 + seg))
    me = bpy.data.meshes.new('plume'); me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new('plume', me); bpy.context.scene.collection.objects.link(o)
    # A glowing gas, not a solid: emission in the volume, so the core (more
    # depth to look through) is bright and the edges fall away.
    m = bpy.data.materials.new('plume'); m.use_nodes = True
    nt = m.node_tree; nt.nodes.remove(nt.nodes['Principled BSDF'])
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*colour, 1); em.inputs['Strength'].default_value = 0.32
    nt.links.new(em.outputs['Emission'], nt.nodes['Material Output'].inputs['Volume'])
    o.data.materials.append(m)
    return o


def keyart(out):
    fresh()
    m, panel = craft.kestrel()
    craft.surfaces(m, panel)
    ship = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    exits = [T(s * 4.2, -0.2, 7.6) for s in (-1, 1)]
    k = pz.join(ship, 'kestrel')
    for e in exits:
        p = plume(tuple(e), 30, 1.0, (0.45, 0.75, 1.0))
        p.parent = k
    k.rotation_euler = (math.radians(-6), math.radians(18), math.radians(32))
    cam_at = Vector((-17.0, 30.0, 6.0))
    look = Vector((1.5, -2.0, 0.0))
    d = (look - cam_at).normalized()
    up = Vector((0, 0, 1))
    right = d.cross(up).normalized()
    up = right.cross(d).normalized()
    planet('moon', tuple(d * 3000 + right * 850 - up * 700), 1150, os.path.join(TEX, 'moon_color.jpg'), os.path.join(TEX, 'moon_normal.jpg'), rotation=1.2)
    planet('earth', tuple(d * 30000 - right * 9000 + up * 6500), 1500, os.path.join(TEX, 'earth_day.jpg'), os.path.join(TEX, 'earth_normal.jpg'), os.path.join(TEX, 'earth_night.jpg'), atmosphere=(0.35, 0.6, 1.0, 1), rotation=2.5)
    hm, hp = craft.hearth()
    craft.surfaces(hm, hp)
    keep = {'kestrel', 'moon', 'earth', 'earth_air', 'plume'}
    hearth_parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.split('.')[0] not in keep]
    h = pz.join(hearth_parts, 'hearth')
    h.scale = (0.05, 0.05, 0.05)
    h.location = d * 900 - right * 380 + up * 60
    h.rotation_euler = (math.radians(62), math.radians(14), math.radians(-40))
    stars()
    sun((-0.55, -0.45, 0.5), energy=6.0)
    area(tuple(cam_at + right * 6 - up * 8), (0, 0, 0), 2200, (0.18, 0.75, 1.0), size=10)
    area(tuple(Vector((12, -10, 9))), (0, 0, 0), 1800, (1.0, 0.55, 0.3), size=8)
    camera(tuple(cam_at), tuple(look), lens=40, roll=math.radians(-5))
    render(out, (1920, 1080), samples=192, exposure=0.15)


# --------------------------------------------------------------------------
# Hulls for the shipyard
# --------------------------------------------------------------------------

def hull(kind, out):
    fresh()
    m, panel = getattr(craft, kind)()
    craft.surfaces(m, panel)
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    pz.join(parts, kind)
    o = bpy.data.objects[kind]
    o.rotation_euler = (0, 0, math.radians(-38))
    r = max(o.dimensions) / 2
    bpy.ops.mesh.primitive_plane_add(size=r * 60, location=(0, 0, -o.dimensions.z * 0.6))
    floor = bpy.context.active_object
    fm = bpy.data.materials.new('floor')
    fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.012, 0.01, 0.02, 1)
    fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.25
    fm.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.6
    floor.data.materials.append(fm)
    area((r * 2.5, -r * 2.0, r * 2.2), (0, 0, 0), 900 * r, (1.0, 0.92, 0.82), size=r * 2)
    area((-r * 3, r * 1.5, r * 0.8), (0, 0, 0), 1400 * r, (1.0, 0.45, 0.2), size=r * 1.5)
    area((0, r * 3, r * 2.5), (0, 0, 0), 900 * r, (0.2, 0.8, 1.0), size=r * 2)
    camera((r * 2.1, -r * 2.6, r * 0.9), (0, 0, -r * 0.05), lens=50)
    render(out, (960, 540), samples=96)


# --------------------------------------------------------------------------
# Portraits
# --------------------------------------------------------------------------

PEOPLE = {
    'mara': {'skin': '#b07a5c', 'shell': '#d9d2c3', 'stripe': '#ff6b2c', 'visor': (0.85, 0.55, 0.2), 'rim': (1.0, 0.45, 0.2), 'bg': (0.10, 0.04, 0.02)},
    'rook': {'skin': '#5e3e30', 'shell': '#6a3b2c', 'stripe': '#c9973c', 'visor': (0.9, 0.6, 0.1), 'rim': (1.0, 0.5, 0.15), 'bg': (0.09, 0.03, 0.02), 'scuffed': True, 'hood': True},
    'chen': {'skin': '#c79c78', 'shell': '#eef0f2', 'stripe': '#2fd3ff', 'visor': (0.2, 0.6, 1.0), 'rim': (0.2, 0.8, 1.0), 'bg': (0.01, 0.05, 0.08), 'antenna': True},
    'warden': {'shell': '#1d1a1c', 'stripe': '#5a1e1e', 'visor': None, 'rim': (1.0, 0.2, 0.1), 'bg': (0.06, 0.0, 0.0), 'mask': True},
    'hollow': {'skin': '#4a3a32', 'shell': '#5a1e1e', 'stripe': '#2b2420', 'visor': (1.0, 0.25, 0.1), 'rim': (1.0, 0.3, 0.15), 'bg': (0.05, 0.01, 0.01), 'scuffed': True},
    'patrol': {'skin': '#8a6a52', 'shell': '#eef0f2', 'stripe': '#1f3a4e', 'visor': (0.1, 0.4, 0.9), 'rim': (0.2, 0.8, 1.0), 'bg': (0.01, 0.04, 0.07)},
    'control': {'skin': '#a07a62', 'shell': '#5c6066', 'stripe': '#2fd3ff', 'visor': (0.6, 0.9, 1.0), 'rim': (0.4, 0.8, 1.0), 'bg': (0.02, 0.04, 0.06), 'antenna': True},
    # Act Two: the Ceres Line's factor, in company black and gold, and Rook's gun.
    'okafor': {'skin': '#6b4532', 'shell': '#1f1d24', 'stripe': '#c9973c', 'visor': (0.95, 0.75, 0.3), 'rim': (1.0, 0.8, 0.4), 'bg': (0.06, 0.045, 0.02), 'antenna': True},
    'vex': {'skin': '#9a6f55', 'shell': '#ff6b2c', 'stripe': '#23222a', 'visor': (0.2, 0.9, 0.7), 'rim': (0.3, 1.0, 0.7), 'bg': (0.02, 0.05, 0.04), 'scuffed': True},
}


def helmet(who, p):
    """A flight helmet on a suit collar, in Blender's own frame (Z up, facing -Y)."""
    shell = pz.material('shell', p['shell'], metallic=0.15, roughness=0.42)
    sf.surface(shell, 'paint', colour=p['shell'], panel=0.25, rough=0.38 if not p.get('scuffed') else 0.6)
    stripe = pz.material('stripe', p['stripe'], roughness=0.45)
    sf.surface(stripe, 'paint', colour=p['stripe'], panel=0.4, rough=0.45)
    dark = pz.material('hdark', '#23222a', metallic=0.6, roughness=0.4)
    sf.surface(dark, 'anodised', colour='#23222a')
    # The shell: a lathed dome, a little longer front to back, with the face opening cut out of it.
    prof = [(0.0, 0.34), (0.12, 0.335), (0.22, 0.30), (0.29, 0.22), (0.32, 0.10), (0.325, -0.02), (0.31, -0.14), (0.27, -0.22), (0.2, -0.26)]
    s = pz.lathe('shell', prof, 64, shell, smooth_angle=60)
    s.scale = (1.0, 1.12, 1.0)
    if not p.get('mask'):
        import bmesh
        bm = bmesh.new(); bm.from_mesh(s.data)
        cut = [f for f in bm.faces if (lambda c: c.y < -0.12 and abs(c.x) < 0.22 and -0.17 < c.z < 0.17)(f.calc_center_median())]
        bmesh.ops.delete(bm, geom=cut, context='FACES')
        bm.to_mesh(s.data); bm.free()
        sol = s.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.018
    # The stripe over the crown.
    st = pz.box('crest', (0.07, 0.62, 0.05), (0, 0.02, 0.335), stripe, chamfer=0.02)
    for side in (-1, 1):
        pz.prism(f'ear{side}', 0.085, 0.0, 0.07, 20, dark).location = (side * 0.33, 0.0, -0.06)
        bpy.data.objects[f'ear{side}'].rotation_euler = (0, math.radians(90 * side), 0)
        pz.box(f'lamp{side}', (0.025, 0.05, 0.025), (side * 0.27, -0.24, 0.17), craft.emissive(f'lampmat{side}', '#fff1d8', 8.0))
    if p.get('antenna'):
        pz.tube('antenna', (0.3, 0.05, 0.05), (0.38, 0.18, 0.42), 0.006, dark)
        pz.sphere('antennatip', (0.38, 0.18, 0.43), 0.012, craft.emissive('tipmat', '#ff3b2c', 20.0))
    if p.get('mask'):
        # The Warden: a slab faceplate with two burning slits.
        pz.box('faceplate', (0.42, 0.06, 0.34), (0, -0.33, -0.02), dark, chamfer=0.03)
        glow = craft.emissive('slits', '#ff3b1c', 40.0)
        for side in (-1, 1):
            pz.box(f'slit{side}', (0.11, 0.02, 0.022), (side * 0.09, -0.365, 0.06), glow)
        for i in range(5):
            pz.box(f'grille{i}', (0.2, 0.02, 0.012), (0, -0.365, -0.08 - i * 0.03), dark)
    else:
        # A face behind the glass: only a shape, lit dimly from the console below.
        skin = pz.material('skin', p.get('skin', '#9a7a62'), roughness=0.6)
        head = pz.sphere('head', (0, -0.02, -0.03), 0.2, skin, segments=32, rings=16)
        head.scale = (0.82, 0.95, 1.15)
        for poly in head.data.polygons:
            poly.use_smooth = True
        visor = bpy.data.materials.new('visor')
        visor.use_nodes = True
        b = visor.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*p['visor'], 1)
        b.inputs['Metallic'].default_value = 0.55
        b.inputs['Roughness'].default_value = 0.05 if not p.get('scuffed') else 0.16
        b.inputs['Transmission Weight'].default_value = 0.55
        b.inputs['Coat Weight'].default_value = 1.0
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=0.3, location=(0, -0.02, 0.0))
        v = bpy.context.active_object
        v.name = 'visor'
        v.scale = (0.98, 1.12, 0.86)
        for poly in v.data.polygons:
            poly.use_smooth = True
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(v.data)
        dead = [f for f in bm.faces if f.calc_center_median().y > -0.1 or abs(f.calc_center_median().z) > 0.2 or abs(f.calc_center_median().x) > 0.26]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bm.to_mesh(v.data)
        bm.free()
        v.data.materials.append(visor)
        sol = v.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.006
        # A dim console glow inside, from below, on the face.
        lamp = bpy.data.lights.new('console', 'POINT'); lamp.energy = 0.6; lamp.color = p['rim']; lamp.shadow_soft_size = 0.05
        lo = bpy.data.objects.new('console', lamp); bpy.context.scene.collection.objects.link(lo)
        lo.location = (0, -0.2, -0.16)
    # The suit: a collar ring and shoulders.
    suit = pz.material('suit', '#3a3946', roughness=0.7)
    sf.surface(suit, 'paint', colour='#3a3946' if who not in ('chen', 'patrol') else '#d9dce0', panel=0.3, rough=0.7)
    pz.lathe('collar', [(0.26, -0.36), (0.3, -0.3), (0.32, -0.26), (0.24, -0.25)], 40, dark)
    sh = pz.lathe('shoulders', [(0.0, -0.95), (0.62, -0.92), (0.66, -0.7), (0.58, -0.5), (0.36, -0.38), (0.26, -0.33)], 48, suit, smooth_angle=60)
    sh.scale = (1.0, 0.55, 1.0)
    pz.box('patch', (0.12, 0.02, 0.08), (0.36, -0.28, -0.6), stripe)
    if p.get('hood'):
        hood = pz.material('hood', '#3a2a22', roughness=0.9)
        sf.surface(hood, 'paint', colour='#3a2a22', panel=0.2, rough=0.95)
        h = pz.lathe('hood', [(0.2, -0.4), (0.4, -0.25), (0.42, 0.05), (0.36, 0.28), (0.18, 0.42), (0.0, 0.45)], 40, hood, smooth_angle=70)
        h.scale = (1.05, 1.2, 1.0)
        h.location = (0, 0.07, 0)
        import bmesh
        bm = bmesh.new(); bm.from_mesh(h.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().y < -0.12], context='FACES')
        bm.to_mesh(h.data); bm.free()
        sol = h.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.02


def portrait(who, out):
    scene = fresh()
    p = PEOPLE[who]
    helmet(who, p)
    # A backdrop in the character's own dark tone, a key, a coloured rim, a fill.
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 1.2, 0), rotation=(math.radians(90), 0, 0))
    bd = bpy.context.active_object
    bm_ = bpy.data.materials.new('backdrop'); bm_.use_nodes = True
    bm_.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*p['bg'], 1)
    bm_.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    bd.data.materials.append(bm_)
    area((-1.2, -1.6, 0.9), (0, 0, 0), 120, (1.0, 0.94, 0.86), size=1.2)
    area((1.3, 0.6, 0.5), (0, 0, 0.05), 220, p['rim'], size=0.6)
    area((0.4, -1.2, -0.8), (0, 0, 0), 25, (0.6, 0.65, 0.8), size=2.0)
    # Something for the visor to reflect: a bright strip, as from a cockpit.
    bpy.ops.mesh.primitive_plane_add(size=1, location=(-0.6, -1.4, 0.5))
    strip = bpy.context.active_object
    strip.scale = (1.4, 0.3, 1)
    strip.rotation_euler = (math.radians(80), 0, math.radians(-20))
    strip.data.materials.append(craft.emissive('strip', '#ffe6c8', 3.0))
    strip.visible_camera = False
    camera((0.85, -2.45, 0.05), (0, 0, -0.2), lens=85)
    render(out, (512, 512), samples=96, exposure=0.1)


def main():
    a = pz.cli()
    out = a['out'] or os.path.join(ROOT, 'public', 'game')
    os.makedirs(out, exist_ok=True)
    only = os.environ.get('PZ_ONLY')
    # PZ_ONLY=portraits, hulls or keyart; or portrait:<who>,<who> for a few faces.
    if only and only.startswith('portrait:'):
        for who in only.split(':', 1)[1].split(','):
            portrait(who, os.path.join(out, f'portrait-{who}.webp'))
        return
    if not only or only == 'portraits':
        for who in PEOPLE:
            portrait(who, os.path.join(out, f'portrait-{who}.webp'))
    if not only or only == 'hulls':
        for kind in ('kestrel', 'mule', 'lance'):
            hull(kind, os.path.join(out, f'hull-{kind}.webp'))
    if not only or only == 'keyart':
        keyart(os.path.join(out, 'keyart.webp'))


main()
