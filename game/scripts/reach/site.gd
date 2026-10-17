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

## A light on a piece, in its own space.
static func lamp(on: Node3D, at: Vector3, color := Color(1.0, 0.68, 0.36), energy := 1.2, reach := 7.0) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.light_color = color
	l.light_energy = energy
	l.omni_range = reach
	l.position = at
	on.add_child(l)
	return l

## A Choir songline (Songline: read it with the translator) at (east, north).
func songline(id: String, at: Vector2, look: Vector2, path := "site-songline") -> Songline:
	var xf := ground(at)
	return songline_at(id, Transform3D(upright(xf.basis.y, ground(look).origin - xf.origin), xf.origin), path)

func songline_at(id: String, xf: Transform3D, path := "site-songline") -> Songline:
	var s := Songline.make(id, path)
	add_child(s)
	s.transform = Transform3D(xf.basis, xf.origin - xf.basis.y * 0.06)
	return s
