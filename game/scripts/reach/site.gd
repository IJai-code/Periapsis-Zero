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
	return n

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

## A person standing at (east, north), facing a point.
func person(key: String, model: String, at: Vector2, look: Vector2, sit := false) -> Npc:
	var xf := ground(at)
	var n := Npc.make(key, model, sit)
	add_child(n)
	n.transform = Transform3D(upright(xf.basis.y, ground(look).origin - xf.origin), xf.origin)
	return n

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
