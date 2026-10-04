"""
Surfaces that look like the things they are, baked into textures a browser can draw.

A Principled BSDF with one colour reads as plastic. What makes flight hardware
read as flight hardware is the detail inside a surface: foil that is never
flat, paint with panel seams and a little grime, aluminium with a grain, solar
cells with their busbars, a nozzle tinted by its own heat, dust where the
vehicle meets the ground, and the soft darkening where parts crowd each other.

All of that is built here as Blender shader graphs (procedural, nothing
downloaded), then baked by Cycles into four images per asset and swapped for
one plain glTF material that three.js draws in one pass:

    base    colour, sRGB
    orm     occlusion (R), roughness (G), metalness (B), glTF's own packing
    normal  tangent-space detail: crinkle, seams, grain, rounded edges

`bake_asset` does the whole job for a list of objects. The images are packed
into the .blend and written into the .glb as WebP by the exporter.

Determinism: every noise has a fixed position in object space, Cycles runs on
the CPU with a fixed seed, and the UV unwrap is the same operator on the same
mesh, so a rebuild bakes the same pixels.
"""

import math

import bpy
import numpy as np


# --------------------------------------------------------------------------
# A small graph builder
# --------------------------------------------------------------------------

class Graph:
    """Nodes and links on one material, laid out left to right as they are made."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.col = 0

    def node(self, kind, inputs=None, **props):
        n = self.nt.nodes.new(kind)
        n.location = (-1400 + 160 * (self.col % 9), -220 * (self.col // 9))
        self.col += 1
        for k, v in props.items():
            setattr(n, k, v)
        for k, v in (inputs or {}).items():
            self.put(n.inputs[k], v)
        return n

    def put(self, socket, value):
        if hasattr(value, 'is_output'):
            self.nt.links.new(value, socket)
        elif isinstance(value, (tuple, list)):
            socket.default_value = tuple(value) if len(value) == len(socket.default_value) else (*value, 1.0)
        else:
            socket.default_value = value

    # Arithmetic on sockets or numbers --------------------------------------
    def math(self, op, a, b=0.0, clamp=False):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.put(n.inputs[0], a)
        self.put(n.inputs[1], b)
        return n.outputs[0]

    def mul(self, a, b): return self.math('MULTIPLY', a, b)
    def add(self, a, b): return self.math('ADD', a, b)

    def remap(self, x, a, b, c=0.0, d=1.0, smooth=False):
        n = self.node('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR', clamp=True)
        self.put(n.inputs['Value'], x)
        n.inputs['From Min'].default_value = a
        n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = c
        n.inputs['To Max'].default_value = d
        return n.outputs['Result']

    def mixf(self, a, b, t):
        n = self.node('ShaderNodeMix', data_type='FLOAT')
        self.put(n.inputs[0], t)
        self.put(n.inputs[2], a)
        self.put(n.inputs[3], b)
        return n.outputs[0]

    def mixc(self, a, b, t, blend='MIX'):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type=blend, clamp_result=True)
        self.put(n.inputs[0], t)
        self.put(n.inputs[6], a)
        self.put(n.inputs[7], b)
        return n.outputs[2]

    # Sources ---------------------------------------------------------------
    def coords(self):
        """Object-space position in metres: the same on every part of a joined body."""
        return self.node('ShaderNodeTexCoord').outputs['Object']

    def xyz(self, v):
        n = self.node('ShaderNodeSeparateXYZ')
        self.put(n.inputs[0], v)
        return n.outputs

    def vec(self, x, y, z):
        n = self.node('ShaderNodeCombineXYZ')
        self.put(n.inputs[0], x); self.put(n.inputs[1], y); self.put(n.inputs[2], z)
        return n.outputs[0]

    def scale(self, v, s):
        n = self.node('ShaderNodeVectorMath', operation='MULTIPLY')
        self.put(n.inputs[0], v)
        self.put(n.inputs[1], s if isinstance(s, (tuple, list)) else (s, s, s))
        return n.outputs[0]

    def vadd(self, a, b):
        n = self.node('ShaderNodeVectorMath', operation='ADD')
        self.put(n.inputs[0], a)
        self.put(n.inputs[1], b)
        return n.outputs[0]

    def noise(self, v, scale, detail=4.0, rough=0.5, distortion=0.0, w=None):
        n = self.node('ShaderNodeTexNoise', noise_dimensions='4D' if w is not None else '3D')
        self.put(n.inputs['Vector'], v)
        n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough
        n.inputs['Distortion'].default_value = distortion
        if w is not None:
            self.put(n.inputs['W'], w)
        return n.outputs['Fac']

    def voronoi(self, v, scale, feature='F1', output='Distance', randomness=1.0, w=None):
        n = self.node('ShaderNodeTexVoronoi', feature=feature, voronoi_dimensions='4D' if w is not None else '3D')
        self.put(n.inputs['Vector'], v)
        n.inputs['Scale'].default_value = scale
        n.inputs['Randomness'].default_value = randomness
        if w is not None:
            self.put(n.inputs['W'], w)
        return n.outputs[output]

    def bump(self, height, strength, distance, normal=None):
        n = self.node('ShaderNodeBump')
        n.inputs['Strength'].default_value = strength
        n.inputs['Distance'].default_value = distance
        self.put(n.inputs['Height'], height)
        if normal is not None:
            self.put(n.inputs['Normal'], normal)
        return n.outputs['Normal']

    def bevel(self, radius):
        """Cycles' rounded-edge normal: a machined edge catches light instead of cutting it."""
        n = self.node('ShaderNodeBevel', samples=8)
        n.inputs['Radius'].default_value = radius
        return n.outputs['Normal']

    def panels(self, v, normal, size, seam):
        """Panel seams on any shape: a grid on each face, projected along its dominant axis.

        Returns 1 in a seam and 0 on a panel. Box projection keeps the seams
        straight on flat sides and sensible on curved ones.
        """
        x, y, z = self.xyz(v)
        nx, ny, nz = self.xyz(normal)
        def grid(a, b):
            n = self.node('ShaderNodeTexBrick', offset=0.0, squash=1.0)
            self.put(n.inputs['Vector'], self.vec(a, b, 0.0))
            n.inputs['Scale'].default_value = 1.0
            n.inputs['Mortar Size'].default_value = seam
            n.inputs['Mortar Smooth'].default_value = 0.4
            n.inputs['Brick Width'].default_value = size * 1.3
            n.inputs['Row Height'].default_value = size
            return n.outputs['Fac']
        ax, ay, az = (self.math('ABSOLUTE', c) for c in (nx, ny, nz))
        wx = self.remap(ax, 0.55, 0.75); wy = self.remap(ay, 0.55, 0.75); wz = self.remap(az, 0.55, 0.75)
        s = self.add(self.add(self.mul(grid(y, z), wx), self.mul(grid(x, z), wy)), self.mul(grid(x, y), wz))
        return self.math('MINIMUM', s, 1.0)


def rgb(hex_colour):
    h = hex_colour.lstrip('#')
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


# --------------------------------------------------------------------------
# Recipes: each builds a graph ending in a Principled BSDF
# --------------------------------------------------------------------------

def _finish(g, base, metal, rough, normal, dust_top, dust_colour, emission=None):
    """Dust where the vehicle meets the ground, then the BSDF and the output.

    `dust_top` is the height (object Z, metres) the dust reaches; it thins
    upward through a ragged band rather than ending on a line.
    """
    v = g.coords()
    if dust_top is not None:
        z = g.xyz(v)[2]
        ragged = g.mul(g.add(g.noise(v, 3.0, detail=6.0), -0.5), 0.5)
        dust = g.remap(g.add(z, ragged), dust_top, dust_top - 0.7, 0.0, 1.0, smooth=True)
        speck = g.remap(g.noise(v, 40.0, detail=2.0), 0.35, 0.75)
        dust = g.mul(dust, g.mixf(0.55, 1.0, speck))
        base = g.mixc(base, rgb(dust_colour), g.mul(dust, 0.8))
        rough = g.mixf(rough, 0.95, dust)
        metal = g.mixf(metal, 0.0, dust)
    bsdf = g.node('ShaderNodeBsdfPrincipled')
    g.put(bsdf.inputs['Base Color'], base)
    g.put(bsdf.inputs['Metallic'], metal)
    g.put(bsdf.inputs['Roughness'], rough)
    if normal is not None:
        g.put(bsdf.inputs['Normal'], normal)
    if emission is not None:
        g.put(bsdf.inputs['Emission Color'], emission)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    out = g.node('ShaderNodeOutputMaterial')
    g.put(out.inputs['Surface'], bsdf.outputs['BSDF'])
    return bsdf


def paint(g, colour, dust_top=None, dust_colour='#8a8378', panel=1.1, rough=0.5, metal=0.0):
    """Thermal paint on aluminium: panel seams, a faint mottle, grime in the seams."""
    v = g.coords()
    normal_geo = g.node('ShaderNodeNewGeometry').outputs['Normal']
    seams = g.panels(v, normal_geo, panel, 0.005)
    mottle = g.noise(v, 2.2, detail=5.0)
    base = g.mixc(rgb(colour), (0.0, 0.0, 0.0, 1.0), g.remap(mottle, 0.3, 0.7, 0.0, 0.06))
    grime = g.mul(g.remap(g.noise(v, 7.0, detail=8.0), 0.45, 0.8), 0.18)
    base = g.mixc(base, rgb('#6f6a60'), grime)
    base = g.mixc(base, rgb('#4a4740'), g.mul(seams, 0.35))
    r = g.add(rough, g.mul(g.add(g.noise(v, 11.0, detail=6.0), -0.5), 0.25))
    edges = g.bevel(0.012)
    peel = g.noise(v, 260.0, detail=2.0)
    h = g.add(g.mul(seams, -1.0), g.mul(peel, 0.04))
    n = g.bump(h, 0.35, 0.0015, edges)
    return _finish(g, base, metal, r, n, dust_top, dust_colour)


def foil(g, colour='#c9973c', dust_top=None, dust_colour='#8a8378', silver=False, quilt=0.42):
    """Multi-layer insulation: metal film over a frame, quilted and crumpled.

    Three scales, the way the real blankets look in close-up photographs:
    quilting where the layers are stitched or taped down every forty
    centimetres or so (the film pillows between); crumple facets a few
    centimetres across, each tilted a little differently so each catches the
    light on its own; and sharp creases along the facet edges. The colour
    shifts facet by facet between brass and amber, darker in the creases.
    """
    v = g.coords()
    normal_geo = g.node('ShaderNodeNewGeometry').outputs['Normal']
    seams = g.panels(v, normal_geo, quilt, 0.006)
    jitter = g.scale(g.node('ShaderNodeTexNoise', {'Vector': v, 'Scale': 3.0}).outputs['Color'], 0.04)
    p = g.vadd(v, jitter)
    facets = g.voronoi(p, 4.5, 'F1', 'Distance')
    cell = g.voronoi(p, 4.5, 'F1', 'Color')
    creases = g.voronoi(p, 4.5, 'DISTANCE_TO_EDGE', 'Distance')
    fine = g.voronoi(p, 11.0, 'DISTANCE_TO_EDGE', 'Distance')
    shade = g.xyz(cell)[0]
    pillow = g.mul(seams, -1.6)
    soft = g.noise(v, 14.0, detail=6.0, rough=0.55)
    h = g.add(g.add(g.mul(facets, 0.9), g.mul(g.remap(creases, 0.0, 0.08, -0.7, 0.0), 1.0)),
              g.add(g.add(g.mul(g.remap(fine, 0.0, 0.05, -0.3, 0.0), 1.0), g.mul(soft, 0.12)), pillow))
    crease_dark = g.remap(creases, 0.0, 0.05, 1.0, 0.0)
    if silver:
        base = g.mixc(rgb('#dcdcd6'), rgb('#9c9e9c'), g.mul(shade, 0.7))
    else:
        base = g.mixc(rgb(colour), rgb('#9a6a26'), g.mul(shade, 0.55))
        base = g.mixc(base, rgb('#e8c77c'), g.mul(g.remap(shade, 0.8, 1.0), 0.4))
    base = g.mixc(base, rgb('#4a3416' if not silver else '#5c5e5e'), g.mul(crease_dark, 0.35))
    base = g.mixc(base, rgb('#3a3832'), g.mul(seams, 0.5))
    rough = g.add(0.14, g.add(g.mul(shade, 0.16), g.mul(crease_dark, 0.2)))
    n = g.bump(h, 0.4, 0.03, g.bevel(0.006))
    return _finish(g, base, 1.0, rough, n, dust_top, dust_colour)


def metal(g, colour='#a8aaa9', rough=0.34, brushed_axis=2, dust_top=None, dust_colour='#8a8378', metalness=1.0):
    """Machined aluminium: a brushed grain along one axis, a little scuffing."""
    v = g.coords()
    stretch = [60.0, 60.0, 60.0]
    stretch[brushed_axis] = 1.5
    grain = g.noise(g.scale(v, stretch), 4.0, detail=3.0)
    scuff = g.remap(g.noise(v, 9.0, detail=7.0), 0.55, 0.85)
    base = g.mixc(rgb(colour), (0.0, 0.0, 0.0, 1.0), g.mul(g.add(g.mul(grain, 0.12), g.mul(scuff, 0.1)), 1.0))
    r = g.add(rough, g.add(g.mul(g.add(grain, -0.5), 0.12), g.mul(scuff, 0.15)))
    n = g.bump(g.mul(grain, 0.3), 0.15, 0.001, g.bevel(0.008))
    return _finish(g, base, metalness, r, n, dust_top, dust_colour)


def anodised(g, colour='#363b3e', dust_top=None, dust_colour='#8a8378'):
    """Dark anodised or painted structure: soft sheen, worn lighter on the edges."""
    v = g.coords()
    wear = g.remap(g.noise(v, 14.0, detail=6.0), 0.62, 0.8)
    base = g.mixc(rgb(colour), rgb('#7d8285'), g.mul(wear, 0.5))
    r = g.add(0.42, g.mul(g.add(g.noise(v, 6.0), -0.5), 0.2))
    n = g.bump(g.noise(v, 90.0, detail=2.0), 0.05, 0.001, g.bevel(0.01))
    return _finish(g, base, 0.55, r, n, dust_top, dust_colour)


def solar(g, cell=0.156, dust_top=None, dust_colour='#8a8378'):
    """Silicon cells in a grid: deep blue, silver fingers and busbars, glass over them."""
    v = g.coords()
    x, y, z = g.xyz(v)
    cells = g.node('ShaderNodeTexBrick', offset=0.0)
    g.put(cells.inputs['Vector'], g.vec(x, y, 0.0))
    cells.inputs['Scale'].default_value = 1.0
    cells.inputs['Mortar Size'].default_value = 0.004
    cells.inputs['Mortar Smooth'].default_value = 0.1
    cells.inputs['Brick Width'].default_value = cell
    cells.inputs['Row Height'].default_value = cell
    gap = cells.outputs['Fac']
    fingers = g.remap(g.math('SINE', g.mul(y, 2 * math.pi / 0.0026)), 0.93, 1.0)
    busbar = g.remap(g.math('ABSOLUTE', g.math('SINE', g.mul(x, 2 * math.pi / (cell / 3)))), 0.985, 1.0)
    metal_lines = g.math('MAXIMUM', g.mul(fingers, 0.35), busbar)
    mottle = g.noise(v, 25.0, detail=3.0)
    base = g.mixc(rgb('#0f1c3a'), rgb('#1d3566'), g.remap(mottle, 0.35, 0.7, 0.0, 0.6))
    base = g.mixc(base, rgb('#b8bcc0'), metal_lines)
    base = g.mixc(base, rgb('#c9cbc8'), gap)
    m = g.mixf(0.25, 1.0, g.math('MAXIMUM', metal_lines, gap))
    r = g.mixf(0.08, 0.3, gap)
    n = g.bump(g.mul(gap, -1.0), 0.2, 0.0008)
    return _finish(g, base, m, r, n, dust_top, dust_colour)


def nozzle(g, throat_z, exit_z, dust_top=None):
    """A radiatively cooled bell: niobium, tinted by its own heat.

    Blue-violet temper colours near the throat give way to a straw and
    grey-brown toward the exit, with vertical streaks from the exhaust.
    """
    v = g.coords()
    z = g.xyz(v)[2]
    t = g.remap(z, throat_z, exit_z)
    x, y, _ = g.xyz(v)
    angle = g.math('ARCTAN2', y, x)
    streak = g.noise(g.vec(g.mul(angle, 6.0), g.mul(z, 0.3), 0.0), 3.0, detail=4.0)
    hot = g.mixc(rgb('#3d3f6e'), rgb('#7a5f8c'), g.remap(streak, 0.3, 0.7))
    warm = g.mixc(rgb('#8a7350'), rgb('#4e4943'), g.remap(streak, 0.2, 0.8))
    base = g.mixc(hot, warm, g.remap(t, 0.15, 0.65, smooth=True))
    r = g.add(0.38, g.mul(streak, 0.25))
    n = g.bump(g.mul(streak, 0.4), 0.2, 0.002)
    return _finish(g, base, 1.0, r, n, dust_top, '#8a8378')


def glass(g):
    v = g.coords()
    base = rgb('#0b1a22')
    r = g.add(0.04, g.mul(g.noise(v, 30.0), 0.05))
    return _finish(g, base, 0.2, r, None, None, None)


def mesh_tyre(g, dust_top=None, dust_colour='#8a8378'):
    """A woven-wire wheel, the kind that worked on the Moon: crossing strands, dusty."""
    v = g.coords()
    x, y, z = g.xyz(v)
    a = g.math('SINE', g.mul(g.add(y, z), 2 * math.pi / 0.02))
    b = g.math('SINE', g.mul(g.add(y, g.mul(z, -1.0)), 2 * math.pi / 0.02))
    weave = g.math('MAXIMUM', g.remap(a, 0.2, 1.0), g.remap(b, 0.2, 1.0))
    base = g.mixc(rgb('#3a3a37'), rgb('#a6a49c'), weave)
    r = g.mixf(0.7, 0.38, weave)
    n = g.bump(weave, 0.6, 0.004, g.bevel(0.004))
    return _finish(g, base, g.mixf(0.2, 0.9, weave), r, n, dust_top, dust_colour)


def tread(g, dust_top=None, dust_colour='#8a8378'):
    """A tyre's compound: dark, matte, with fine sipes and scuffing, dust in every gap."""
    v = g.coords()
    sipes = g.voronoi(v, 60.0, 'DISTANCE_TO_EDGE', 'Distance')
    scuff = g.noise(v, 25.0, detail=6.0)
    base = g.mixc(rgb('#2e2d2a'), rgb('#55524c'), g.mul(g.remap(scuff, 0.5, 0.8), 0.6))
    rough = g.add(0.72, g.mul(scuff, 0.15))
    n = g.bump(g.add(g.remap(sipes, 0.0, 0.03, -1.0, 0.0), g.mul(scuff, 0.3)), 0.4, 0.002, g.bevel(0.005))
    return _finish(g, base, 0.0, rough, n, dust_top, dust_colour)


def flat(g, colour, metal=0.0, rough=0.5, dust_top=None, dust_colour='#8a8378'):
    """A plain colour with a faint mottle: markings, small parts."""
    v = g.coords()
    base = g.mixc(rgb(colour), (0.0, 0.0, 0.0, 1.0), g.remap(g.noise(v, 8.0, detail=5.0), 0.3, 0.8, 0.0, 0.12))
    return _finish(g, base, metal, g.add(rough, g.mul(g.add(g.noise(v, 13.0), -0.5), 0.15)), g.bevel(0.006), dust_top, dust_colour)


def surface(mat, recipe, **params):
    """Rebuild `mat`'s node tree from one of the recipes above."""
    g = Graph(mat)
    globals()[recipe](g, **params)
    return mat


# --------------------------------------------------------------------------
# Unwrap, bake, pack
# --------------------------------------------------------------------------

def _select(objects):
    vl = bpy.context.view_layer
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    vl.objects.active = objects[0]


def unwrap(objects, margin=0.004):
    """One UV atlas shared by every object, islands sized by their real area."""
    _select(objects)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=margin,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def _cycles(samples, device='CPU'):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = device
    if device == 'GPU':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
    scene.cycles.samples = samples
    scene.cycles.seed = 0
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    scene.render.bake.margin_type = 'EXTEND'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('bake_world')
    # Ambient occlusion reaches a third of a metre: parts crowding parts, not the sky.
    scene.world.light_settings.distance = 0.35


def _image(name, size, data):
    img = bpy.data.images.get(name) or bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img


def _target(materials, img):
    """Point every material's active image node at `img`, the bake's target."""
    for m in materials:
        nodes = m.node_tree.nodes
        node = nodes.get('pz_bake') or nodes.new('ShaderNodeTexImage')
        node.name = 'pz_bake'
        node.image = img
        node.location = (400, 400)
        for n in nodes:
            n.select = False
        node.select = True
        nodes.active = node


def _bake(objects, kind, **kw):
    _select(objects)
    bpy.ops.object.bake(type=kind, use_clear=True, margin=8, **kw)


def _to_emission(materials, socket):
    """Route one BSDF input to an emission for one EMIT bake.

    Metalness has no bake pass of its own, and base colour cannot come from
    the DIFFUSE pass: Cycles weights diffuse by (1 - metalness), so every
    metal baked black. Emission carries the input through unweighted.
    """
    undo = []
    for m in materials:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        old = out.inputs['Surface'].links[0].from_socket
        em = nt.nodes.new('ShaderNodeEmission')
        src = bsdf.inputs[socket]
        if src.is_linked:
            nt.links.new(src.links[0].from_socket, em.inputs['Color'])
        else:
            v = src.default_value
            em.inputs['Color'].default_value = (v, v, v, 1.0) if isinstance(v, float) else tuple(v)
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
        undo.append((nt, em, old, out))
    return undo


def _restore(undo):
    for nt, em, old, out in undo:
        nt.links.new(old, out.inputs['Surface'])
        nt.nodes.remove(em)


def normalise_srgb(c, mean=0.5):
    """Scale sRGB-encoded colours so their *linear* mean per channel is `mean`.

    An 8-bit sRGB image's pixels are sRGB-encoded, and a renderer decodes them
    to linear light before using them. The first ground and rock bakes
    normalised the encoded values to 0.5, which decodes to about 0.21, so a
    detail map meant to average 1.0 after doubling averaged 0.43 and darkened
    every surface it touched by half.
    """
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    lin = np.clip(lin / np.maximum(lin.mean(axis=0), 1e-6) * mean, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)


def _pixels(img):
    a = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(-1, 4)


def bake_asset(objects, name, size=2048, keep=(), samples=16, ao_samples=96):
    """Bake every material on `objects` (but those named in `keep`) into one atlas.

    Returns the two materials that replace them: `<name>` (single-sided) and
    `<name>_ds` (double-sided, for open shells). Every slot that used a
    double-sided material moves to `_ds`; every other baked slot to `<name>`.
    """
    objects = [o for o in objects if o.type == 'MESH']
    if not bpy.app.background:
        # In an open Blender the procedural materials stay as they are, to be
        # looked at live; the bake (minutes of Cycles that would freeze the
        # window) happens in the headless build.
        print('PZ-LIVE skipping the bake: procedural materials left in place')
        return None, None
    baked = sorted({s.material for o in objects for s in o.material_slots
                    if s.material is not None and s.material.name not in keep}, key=lambda m: m.name)
    unwrap(objects)
    _cycles(samples)

    base = _image(f'{name}_base', size, data=False)
    rough = _image(f'{name}_rough', size, data=True)
    metal = _image(f'{name}_metal', size, data=True)
    ao = _image(f'{name}_ao', size, data=True)
    normal = _image(f'{name}_normal', size, data=True)

    # Materials kept out of the bake still need a target, or the bake refuses;
    # they get a throwaway image that is discarded afterwards.
    kept = sorted({s.material for o in objects for s in o.material_slots
                   if s.material is not None and s.material.name in keep}, key=lambda m: m.name)
    scratch = _image(f'{name}_scratch', 16, data=True)
    _target(kept, scratch)

    undo = _to_emission(baked, 'Base Color')
    _target(baked, base)
    _bake(objects, 'EMIT')
    _restore(undo)
    _target(baked, rough)
    _bake(objects, 'ROUGHNESS')
    _target(baked, normal)
    _bake(objects, 'NORMAL', normal_space='TANGENT')
    undo = _to_emission(baked, 'Metallic')
    _target(baked, metal)
    _bake(objects, 'EMIT')
    _restore(undo)
    bpy.context.scene.cycles.samples = ao_samples
    _target(baked, ao)
    _bake(objects, 'AO')

    # glTF's packing: occlusion in R, roughness in G, metalness in B.
    orm = _image(f'{name}_orm', size, data=True)
    px = np.ones((size * size, 4), dtype=np.float32)
    px[:, 0] = _pixels(ao)[:, 0]
    px[:, 1] = _pixels(rough)[:, 0]
    px[:, 2] = _pixels(metal)[:, 0]
    orm.pixels.foreach_set(px.ravel())
    for img in (base, orm, normal):
        img.update()
        img.pack()
    for img in (rough, metal, ao, scratch):
        bpy.data.images.remove(img)

    single = _gltf_material(name, base, orm, normal, double_sided=False)
    double = _gltf_material(f'{name}_ds', base, orm, normal, double_sided=True)
    for o in objects:
        for s in o.material_slots:
            if s.material is not None and s.material.name not in keep:
                s.material = double if not s.material.use_backface_culling else single
        _merge_slots(o)
        for m in kept:
            node = m.node_tree.nodes.get('pz_bake')
            if node:
                m.node_tree.nodes.remove(node)
    for m in baked:
        if m.users == 0:
            bpy.data.materials.remove(m)
    return single, double


def _gltf_material(name, base, orm, normal, double_sided):
    """The material the exporter understands: image, packed ORM, normal map."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double_sided
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    tb = nt.nodes.new('ShaderNodeTexImage'); tb.image = base
    nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = orm
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    # Occlusion goes through the exporter's own node group, by name.
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gn = nt.nodes.new('ShaderNodeGroup'); gn.node_tree = group
    nt.links.new(sep.outputs['Red'], gn.inputs['Occlusion'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = normal
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def _merge_slots(obj):
    """One slot per distinct material: faces are remapped and the duplicates dropped."""
    first = {}
    remap = []
    for i, s in enumerate(obj.material_slots):
        key = s.material.name if s.material else None
        first.setdefault(key, i)
        remap.append(first[key])
    for p in obj.data.polygons:
        p.material_index = remap[p.material_index]
    with bpy.context.temp_override(active_object=obj, object=obj):
        bpy.ops.object.material_slot_remove_unused()


# --------------------------------------------------------------------------
# A look at the result, in Cycles
# --------------------------------------------------------------------------

def preview(path, objects, size=(1280, 800), samples=64, ground='#7d776e', distance=None, elevation=12, azimuth=-35):
    """A beauty shot for checking a bake: low sun, a ground plane, a camera framing the objects."""
    from mathutils import Vector
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9)); hi = -lo
    for o in objects:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
    centre = (lo + hi) / 2
    radius = (hi - lo).length / 2
    bpy.ops.mesh.primitive_plane_add(size=radius * 40, location=(0, 0, lo.z))
    plane = bpy.context.active_object
    gm = bpy.data.materials.new('preview_ground'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = rgb(ground)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    plane.data.materials.append(gm)
    sun = bpy.data.lights.new('preview_sun', 'SUN'); sun.energy = 4.5; sun.angle = math.radians(0.53)
    so = bpy.data.objects.new('preview_sun', sun); scene.collection.objects.link(so)
    # From over the camera's left shoulder, 32 degrees up: the lit side faces us.
    saz, sel = math.radians(azimuth - 55), math.radians(32)
    toward = Vector((math.sin(saz) * math.cos(sel), -math.cos(saz) * math.cos(sel), math.sin(sel)))
    so.rotation_euler = (-toward).to_track_quat('-Z', 'Y').to_euler()
    world = scene.world or bpy.data.worlds.new('w'); scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.02, 0.024, 1)
    cam = bpy.data.cameras.new('preview_cam'); cam.lens = 50
    co = bpy.data.objects.new('preview_cam', cam); scene.collection.objects.link(co)
    d = distance or radius * 3.2
    az, el = math.radians(azimuth), math.radians(elevation)
    co.location = centre + Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * d
    co.rotation_euler = (centre - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co
    _cycles(samples, device='GPU')
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for ob in (plane, so, co):
        bpy.data.objects.remove(ob)
