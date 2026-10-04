"""
Shared helpers for every Periapsis Zero asset built in Blender.

Each asset is a script (`art/<asset>/build.py`) that runs in headless Blender:

    npm run art:build -- survey-lander

The script is the source of truth, so these helpers are written for
determinism first. Nothing here reads the clock, the user's preferences or a
random number without a fixed seed, and every mesh is built from explicit
vertices rather than from operators that depend on viewport state. The same
script produces the same .glb bytes twice, which `art.mjs --check` verifies.

Conventions (AGENT.md, section 4.4):

- One Blender unit is one metre; the scene is metric with unit scale 1.0.
- Assets are authored Z-up. The glTF exporter delivers Y-up, so a three.js
  point (x, y, z) is the Blender point (x, -z, y), and a vehicle whose front
  faces three.js -Z faces Blender +Y. `from_three` does that conversion so a
  build script can be written against the numbers the runtime uses.
- Materials are Principled BSDF only, which glTF maps straight onto three.js
  MeshStandardMaterial.
- Named empties mark the points the runtime reads (nozzle exits, hatches,
  footpads) instead of the runtime hard-coding offsets.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

def cli():
    """The build's arguments: --out, --blend, --preview <png>, and --fast (a quick, small bake)."""
    import sys
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {'out': None, 'blend': None, 'preview': None, 'fast': '--fast' in argv}
    for i, a in enumerate(argv):
        if a in ('--out', '--blend', '--preview') and i + 1 < len(argv):
            out[a[2:]] = argv[i + 1]
    return out


def bake_options(a, size):
    """Bake size and samples: the shipped quality, or a quick look with --fast."""
    return {'size': size // 2, 'samples': 4, 'ao_samples': 24} if a['fast'] else {'size': size}


def live():
    """True when the script runs inside someone's open Blender (over MCP) rather than headless."""
    return not bpy.app.background


def reset_scene():
    """An empty, metric scene, independent of whatever startup file exists.

    Headless, that is a factory reset. Inside an open Blender it is not: a
    factory reset there would also switch off the add-ons, including the MCP
    server the script is being run through. So a live session empties the
    open file instead, every object and every datablock a build makes.
    """
    if live():
        for collection in (bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.images,
                           bpy.data.lights, bpy.data.cameras, bpy.data.textures, bpy.data.curves):
            for block in list(collection):
                collection.remove(block)
        for group in list(bpy.data.node_groups):
            bpy.data.node_groups.remove(group)
        _materials.clear()
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    units = bpy.context.scene.unit_settings
    units.system = 'METRIC'
    units.scale_length = 1.0
    units.length_unit = 'METERS'


def from_three(x, y, z):
    """A point in the runtime's three.js frame (Y-up), as a Blender point (Z-up)."""
    return Vector((x, -z, y))


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

_materials = {}


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, hex_colour, metallic=0.0, roughness=0.5, double_sided=False):
    """A Principled BSDF material, made once per name.

    Colours are given as the sRGB hex a designer reads and converted to the
    linear values Blender's base colour expects; the glTF exporter writes them
    back out as linear factors, which three.js treats correctly.
    """
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    h = hex_colour.lstrip('#')
    rgb = [_srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    # Single-sided unless asked. Blender 5 creates materials with back-face
    # culling off, and the glTF exporter turns that into `doubleSided: true`,
    # so the first export drew the inside of every closed panel in three.js:
    # twice the fragments for surfaces nobody can see. Only open shells — a
    # nozzle bell, a dish — need their back faces.
    m.use_backface_culling = not double_sided
    _materials[name] = m
    return m


# --------------------------------------------------------------------------
# Meshes from explicit geometry
# --------------------------------------------------------------------------

def _object(name, verts, faces, mat, smooth_angle=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if mat is not None:
        obj.data.materials.append(mat)
    if smooth_angle is not None:
        for p in mesh.polygons:
            p.use_smooth = True
        # Faces meeting at more than this angle keep a hard edge; the glTF
        # exporter splits normals along them, so a chamfer reads as a chamfer.
        mesh.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return obj


def lathe(name, profile, segments, mat, phase=0.0, cap_bottom=False, cap_top=False, smooth_angle=35):
    """Revolve a profile of (radius, z) pairs about the Z axis.

    The profile runs bottom to top. A surface of revolution built this way has
    exactly the rings it is given, which is what a nozzle bell, a tank or a
    footpad needs: the curvature is where the profile says it is.
    """
    verts = []
    for r, z in profile:
        for i in range(segments):
            a = phase + 2 * math.pi * i / segments
            verts.append((r * math.cos(a), r * math.sin(a), z))
    faces = []
    for j in range(len(profile) - 1):
        for i in range(segments):
            a = j * segments + i
            b = j * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    if cap_bottom:
        faces.append(tuple(reversed(range(segments))))
    if cap_top:
        top = (len(profile) - 1) * segments
        faces.append(tuple(top + i for i in range(segments)))
    return _object(name, verts, faces, mat, smooth_angle)


def prism(name, radius, z0, z1, sides, mat, phase=None, chamfer=0.0):
    """A closed regular prism standing on the Z axis, flats facing the axes.

    `chamfer` bevels the vertical edges and the two rims, which is what keeps a
    machined body from reading as a cardboard box in raking sunlight.
    """
    if phase is None:
        phase = math.pi / sides
    obj = lathe(name, [(radius, z0), (radius, z1)], sides, mat, phase=phase,
                cap_bottom=True, cap_top=True, smooth_angle=None)
    if chamfer > 0:
        bevel(obj, chamfer, segments=2)
    return obj


def box(name, size, centre, mat, chamfer=0.0):
    """An axis-aligned box. `size` and `centre` are Blender coordinates."""
    sx, sy, sz = (s / 2 for s in size)
    cx, cy, cz = centre
    verts = [(cx + x * sx, cy + y * sy, cz + z * sz)
             for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    obj = _object(name, verts, faces, mat)
    if chamfer > 0:
        bevel(obj, chamfer, segments=2)
    return obj


def tube(name, a, b, radius, mat, segments=12, caps=True):
    """A cylinder from point a to point b — a strut, a rail, a mast."""
    a, b = Vector(a), Vector(b)
    axis = b - a
    length = axis.length
    obj = lathe(name, [(radius, 0.0), (radius, length)], segments, mat,
                cap_bottom=caps, cap_top=caps, smooth_angle=60)
    rot = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
    obj.data.transform(Matrix.Translation(a) @ rot)
    return obj


def sphere(name, centre, radius, mat, segments=24, rings=12, z_cut=None):
    """A UV sphere; `z_cut` (fraction from -1 to 1) trims it into a cap."""
    lo = -math.pi / 2 if z_cut is None else math.asin(max(-1.0, min(1.0, z_cut)))
    profile = []
    for j in range(rings + 1):
        t = lo + (math.pi / 2 - lo) * j / rings
        profile.append((max(radius * math.cos(t), 1e-5), radius * math.sin(t)))
    obj = lathe(name, profile, segments, mat, cap_bottom=z_cut is not None, smooth_angle=80)
    obj.data.transform(Matrix.Translation(Vector(centre)))
    return obj


def bevel(obj, width, segments=2):
    """Chamfer every edge sharper than 30 degrees, deterministically, via bmesh."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    edges = [e for e in bm.edges if e.calc_face_angle(0.0) > math.radians(30)]
    bmesh.ops.bevel(bm, geom=edges, offset=width, segments=segments, profile=0.5, affect='EDGES')
    bm.to_mesh(obj.data)
    bm.free()
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(40))
    obj.data.update()


def crinkle(obj, depth, scale, seed):
    """Foil crinkle: displace each vertex along its normal by fixed noise.

    Multi-layer insulation is a thin film over a frame, and what makes it read
    as foil rather than as gold paint is that it is never flat. The noise is
    `mathutils.noise` with a fixed seed offset, so the crinkle is the same on
    every build.
    """
    from mathutils import noise
    mesh = obj.data
    mesh.update()
    offset = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in mesh.vertices:
        n = noise.noise(v.co * scale + offset, noise_basis='PERLIN_ORIGINAL')
        v.co += v.normal * (n * depth)
    mesh.update()


def subdivide(obj, cuts):
    """Even subdivision of every face, so displacement has vertices to move."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


# --------------------------------------------------------------------------
# Empties and output
# --------------------------------------------------------------------------

def empty(name, location):
    """A named marker the runtime reads. Exported to glTF as a bare node."""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'PLAIN_AXES'
    obj.empty_display_size = 0.25
    obj.location = Vector(location)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def join_meshes(name):
    """Every mesh object joined into one, keeping one material slot per material.

    One object with several materials exports as one glTF mesh with one
    primitive per material, which is one draw call per material in three.js —
    eight or so for a whole vehicle instead of one per part.
    """
    meshes = sorted((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: o.name)
    if not meshes:
        raise RuntimeError('nothing to join')
    target = meshes[0]
    with bpy.context.temp_override(active_object=target, object=target,
                                   selected_objects=meshes, selected_editable_objects=meshes):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    # Identical materials collapse into one slot each.
    with bpy.context.temp_override(active_object=target, object=target):
        bpy.ops.object.material_slot_remove_unused()
    return target


def join(objects, name, origin=(0.0, 0.0, 0.0)):
    """Join exactly these objects into one, named `name`, origin at `origin`.

    `join_meshes` takes everything in the scene, which is right for a single
    vehicle; a kit of separate props needs each prop joined on its own. The
    origin is where the runtime will stand the prop, so the mesh is moved to
    put that point at the object's origin.
    """
    objects = [o for o in objects if o is not None]
    target = objects[0]
    with bpy.context.temp_override(active_object=target, object=target,
                                   selected_objects=objects, selected_editable_objects=objects):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    o = Vector(origin)
    target.data.transform(Matrix.Translation(-o))
    target.location = o
    with bpy.context.temp_override(active_object=target, object=target):
        bpy.ops.object.material_slot_remove_unused()
    return target


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export_glb(path):
    """The shipped file: Y-up, Draco-compressed, modifiers already applied."""
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        # Baked textures (art/lib/surfacing.py) ship as WebP: a quarter of
        # PNG's size, and three.js reads EXT_texture_webp natively.
        export_image_format='WEBP',
        export_image_quality=88,
    )


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
