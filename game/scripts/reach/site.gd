class_name Site
extends Node3D
## A place on one of the Reach's small worlds: pieces stood on the sphere
## along its up, people to talk to, things to use. A site hangs under its
## body's Planet, so its collision is on only while that body is the
## frame's (Planet.set_ref), and it sleeps (hidden, not processed) while
## the camera is far from that world.
##
## Layout is in a landmark's frame: (east, north) metres along the ground
## from it (Worlds.place: +X east, +Y up, -Z north).

var body: ReachBody
var center: Transform3D
## Every piece made through piece(): the list merge_pieces works from.
var _pieces: Array[Node3D] = []

func _init(b: ReachBody = null, mark := "") -> void:
	body = b
	if b and mark != "":
		center = Worlds.place(b, mark)

## A new morning: put things back as they were (doors shut, the core in
## its cradle). Most places have nothing to undo.
func reset_loop() -> void:
	pass

## Awake while its world is the frame's or the camera is near it.
func awake(on: bool, near: bool) -> void:
	visible = on or near
	process_mode = Node.PROCESS_MODE_INHERIT if on else Node.PROCESS_MODE_DISABLED

## The surface point (east, north) metres from a frame's origin, along the
## ground, with that frame's axes turned to the up there.
func ground(at: Vector2, frame := center) -> Transform3D:
	var east := frame.basis.x
	var north := -frame.basis.z
	var d := frame.origin.normalized()
	var dist := at.length()
	if dist > 0.001:
		var axis := d.cross((east * at.x + north * at.y).normalized()).normalized()
		d = d.rotated(axis, dist / body.radius)
	var h := Worlds.height(body.key, d, body.radius)
	return Transform3D(upright(d, -north), d * (body.radius + h))

## A basis standing along `up` whose +Z (a piece's front, a person's face)
## points along `toward` laid flat.
static func upright(up: Vector3, toward: Vector3) -> Basis:
	var f := toward - up * toward.dot(up)
	if f.length() < 0.001:
		f = up.cross(Vector3.RIGHT if absf(up.x) < 0.9 else Vector3.FORWARD)
	f = f.normalized()
	return Basis(up.cross(f).normalized(), up, f).orthonormalized()

## A model (res://art/<path>.glb) at a transform, its surfaces applied,
## sunk a little so no edge floats over a bump; solid unless told not.
func piece(path: String, xf: Transform3D, solid := true, scale := 1.0, sink := 0.08) -> Node3D:
	var n: Node3D = load("res://art/%s.glb" % path).instantiate()
	Surfaces.apply(n)
	add_child(n)
	n.transform = Transform3D(xf.basis * Basis.from_scale(Vector3.ONE * scale), xf.origin - xf.basis.y * sink)
	if solid:
		Surfaces.collide(n)
	_pieces.append(n)
	# Ramps under stairs ('collide_only'): walked on, never seen.
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh and mi.mesh.get_surface_count() > 0 and mi.mesh.surface_get_material(0) and mi.mesh.surface_get_material(0).resource_name == "collide_only":
			mi.visible = false
	return n

## A dirt path along the ground through points (body-space directions),
## `width` metres wide, a hand's breadth above the grass.
func path(dirs: Array, width := 2.2) -> MeshInstance3D:
	# Densify: a point every metre and a half.
	var pts: Array[Vector3] = []
	for i in dirs.size() - 1:
		var a: Vector3 = (dirs[i] as Vector3).normalized()
		var b: Vector3 = (dirs[i + 1] as Vector3).normalized()
		var n := maxi(1, int(a.angle_to(b) * body.radius / 1.5))
		for k in n:
			pts.append(a.slerp(b, float(k) / n))
	pts.append((dirs[dirs.size() - 1] as Vector3).normalized())
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = pts.size()
	var prev_l := Vector3.ZERO
	var prev_r := Vector3.ZERO
	var along := 0.0
	for i in pts.size():
		var d := pts[i]
		var fwd := (pts[mini(i + 1, pts.size() - 1)] - pts[maxi(i - 1, 0)])
		fwd = (fwd - d * fwd.dot(d)).normalized()
		var side := d.cross(fwd).normalized()
		var w := width * 0.5 * rng.randf_range(0.85, 1.15)
		var pl := (d + side * (w / body.radius)).normalized()
		var pr := (d - side * (w / body.radius)).normalized()
		var l := pl * (body.radius + Worlds.height(body.key, pl, body.radius) + 0.06)
		var r := pr * (body.radius + Worlds.height(body.key, pr, body.radius) + 0.06)
		if i > 0:
			for tri in [[prev_l, prev_r, r], [prev_l, r, l]]:
				for v: Vector3 in tri:
					st.set_normal(v.normalized())
					st.set_uv(Vector2(1.0 if v == prev_l or v == l else 0.0, along))
					st.add_vertex(v)
		prev_l = l
		prev_r = r
		along += 0.4
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = Surfaces.get_material("path_dirt")
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	return mi

## A piece at (east, north), its front toward a point (east, north), or
## toward the frame's origin when `look` is the same as `at`.
func put(path: String, at: Vector2, look := Vector2.ZERO, solid := true, scale := 1.0, sink := 0.08) -> Node3D:
	var xf := ground(at)
	var to := ground(look).origin if look != at else center.origin
	return piece(path, Transform3D(upright(xf.basis.y, to - xf.origin), xf.origin), solid, scale, sink)

## A piece placed off a landmark's frame (offset in its axes), its front
## toward a point in the body's space.
func put_near(path: String, mark: Transform3D, offset: Vector3, toward: Vector3, solid := true, scale := 1.0, sink := 0.08) -> Node3D:
	var d := (mark.origin + mark.basis * offset).normalized()
	var at := d * (body.radius + Worlds.height(body.key, d, body.radius))
	return piece(path, Transform3D(upright(d, toward - at), at), solid, scale, sink)

## A piece standing on the ground in direction `d`, its front toward a
## point in the body's space.
func put_dir(path: String, d: Vector3, toward: Vector3, solid := true, scale := 1.0, sink := 0.08) -> Node3D:
	d = d.normalized()
	var at := d * (body.radius + Worlds.height(body.key, d, body.radius))
	return piece(path, Transform3D(upright(d, toward - at), at), solid, scale, sink)

## A person standing at (east, north), facing a point.
func person(key: String, model: String, at: Vector2, look: Vector2, sit := false) -> Npc:
	var xf := ground(at)
	var n := Npc.make(key, model, sit)
	add_child(n)
	n.transform = Transform3D(upright(xf.basis.y, ground(look).origin - xf.origin), xf.origin)
	return n

## Where grass must not grow on this site: under every piece and person,
## as [body-space point, radius].
func footprints() -> Array:
	var out := []
	for n in get_children():
		if not n is Node3D:
			continue
		var r := 0.8
		for mi: MeshInstance3D in (n as Node3D).find_children("*", "MeshInstance3D", true, false):
			if mi.mesh:
				var box := mi.mesh.get_aabb()
				r = maxf(r, Vector2(box.size.x, box.size.z).length() * 0.5 * (n as Node3D).scale.x + 0.6)
		out.append([(n as Node3D).position, minf(r, 14.0)])
	return out

## A light on a piece, in its own space: a real light up close, a halo from
## far off (Lamp), so a village of lamps does not cost a village of lights.
static func lamp(on: Node3D, at: Vector3, color := Color(1.0, 0.68, 0.36), energy := 1.2, reach := 7.0) -> Lamp:
	return Lamp.make(on, at, color, energy, reach)

## Pieces that repeat (lamps, cliff segments, benches, houses of one kind)
## are drawn as one multimesh per mesh and material: the same picture, a
## fraction of the draw calls a browser pays for. Static pieces only:
## anything with a script under it (a lift's car, an orrery, a person) is
## left exactly as it was. Returns the draw calls saved.
func merge_pieces(min_instances := 2) -> int:
	var site_inv := global_transform.affine_inverse()
	var groups := {}
	for p in _pieces:
		if is_instance_valid(p):
			_collect(p, site_inv, groups)
	var saved := 0
	for key in groups:
		var g: Dictionary = groups[key]
		var xfs: Array = g.xfs
		if xfs.size() < min_instances:
			continue
		# A multimesh draws the mesh's own surfaces: bake the piece's surface
		# overrides into a copy of the mesh, or the merged houses come out
		# wearing the raw export's materials instead of the scanned ones.
		var mesh := g.mesh as Mesh
		var bake := false
		for m in g.mats:
			if m:
				bake = true
				break
		if bake and mesh is ArrayMesh:
			var copy := mesh.duplicate() as ArrayMesh
			for i in (g.mats as Array).size():
				if g.mats[i]:
					copy.surface_set_material(i, g.mats[i])
			mesh = copy
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		mm.instance_count = xfs.size()
		for i in xfs.size():
			mm.set_instance_transform(i, xfs[i])
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.material_override = g.mat
		mi.cast_shadow = g.shadow
		add_child(mi)
		for n: MeshInstance3D in g.nodes:
			n.visible = false
		saved += xfs.size() - 1
	return saved

## Small things are only drawn near: a crate, a bucket, a fence at a
## hundred metres is a pixel or two, and each is a draw call (and another in
## the shadow pass). Anything under a metre and a half casts no shadow and
## goes beyond 130 m (a pixel or two by then, so its going is not seen);
## under five metres, beyond 300 m. Houses, cliffs, the
## tower: always. Returns how many were limited.
func cull_small() -> int:
	var n := 0
	for gi: GeometryInstance3D in find_children("*", "GeometryInstance3D", true, false):
		if not (gi is MeshInstance3D or gi is MultiMeshInstance3D) or not gi.visible:
			continue
		var mesh: Mesh = (gi as MeshInstance3D).mesh if gi is MeshInstance3D else ((gi as MultiMeshInstance3D).multimesh.mesh if (gi as MultiMeshInstance3D).multimesh else null)
		if mesh == null or gi.visibility_range_end > 0.0:
			continue
		var size := mesh.get_aabb().size * gi.global_basis.get_scale()
		var big := maxf(size.x, maxf(size.y, size.z))
		if big < 1.5:
			gi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			gi.visibility_range_end = 130.0
		elif big < 5.0:
			gi.visibility_range_end = 300.0
		else:
			continue
		gi.visibility_range_end_margin = 25.0
		n += 1
	return n

func _collect(node: Node, site_inv: Transform3D, groups: Dictionary) -> void:
	for c in node.get_children():
		if c is MeshInstance3D:
			var mi := c as MeshInstance3D
			if not mi.visible or not mi.mesh or mi.mesh.get_surface_count() == 0:
				continue
			var mat: Material = mi.material_override
			# Surfaces.apply sets each surface's material by override, not the
			# instance's: carry both over or a merged piece comes out bare.
			var sig := ""
			var mats := []
			for i in mi.mesh.get_surface_count():
				var sm := mi.get_surface_override_material(i)
				mats.append(sm)
				sig += "%d," % [sm.get_instance_id() if sm else 0]
			var key := "%d|%d|%s|%d" % [mi.mesh.get_instance_id(), mat.get_instance_id() if mat else 0, sig, int(mi.cast_shadow)]
			if not groups.has(key):
				groups[key] = {"mesh": mi.mesh, "mat": mat, "mats": mats, "shadow": mi.cast_shadow, "xfs": [], "nodes": []}
			(groups[key].xfs as Array).append(site_inv * mi.global_transform)
			(groups[key].nodes as Array).append(mi)
		elif c is Node3D:
			# A script means something moves or drives that subtree.
			if (c as Node3D).get_script() != null:
				continue
			_collect(c, site_inv, groups)

## A Choir songline (Songline: read it with the translator) at (east, north).
func songline(id: String, at: Vector2, look: Vector2, path := "site-songline") -> Songline:
	var xf := ground(at)
	return songline_at(id, Transform3D(upright(xf.basis.y, ground(look).origin - xf.origin), xf.origin), path)

func songline_at(id: String, xf: Transform3D, path := "site-songline") -> Songline:
	var s := Songline.make(id, path)
	add_child(s)
	s.transform = Transform3D(xf.basis, xf.origin - xf.basis.y * 0.06)
	return s
