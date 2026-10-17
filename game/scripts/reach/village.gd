class_name Village
extends Node3D
## Hearth village on Hearthstone: cabins round the campfire, lamps along the
## paths, the launch tower by the Kestrel's pad, the observatory and the
## lookout on their hills, the mine's mouth at the cave. Everything stands
## on the sphere along its own up (art/godot/hearth_village.py has the
## pieces). Solid: collision built from the meshes.

var body: ReachBody
var center: Transform3D

static func make(b: ReachBody) -> Village:
	var v := Village.new()
	v.body = b
	v.name = "Village"
	return v

func _ready() -> void:
	center = Worlds.place(body, "village")
	# Benches round the fire, facing it.
	for k in 4:
		var a := TAU * k / 4.0 + 0.4
		_put("bench", Vector2(cos(a), sin(a)) * 3.0, Vector2.ZERO, false)
	# Cabins in a loose ring, porches toward the fire.
	for spec in [["cabin_a", Vector2(-15, 11)], ["cabin_a", Vector2(17, 12)], ["cabin_b", Vector2(-19, -9)],
			["cabin_b", Vector2(13, -17)], ["cabin_a", Vector2(-3, 24)], ["cabin_b", Vector2(26, -2)]]:
		_put(spec[0], spec[1], Vector2.ZERO)
	for p in [Vector2(5.5, 0.5), Vector2(-6.5, 5.5), Vector2(8, -8.5), Vector2(-1, -12), Vector2(-11, -2), Vector2(11, 6.5), Vector2(3, 15)]:
		_put("lamp", p, Vector2.ZERO, true, true)
	for spec in [["fence", Vector2(-21, 8), Vector2(-21, 30)], ["fence", Vector2(-24, 4), Vector2(-40, 4)], ["fence", Vector2(22, 17), Vector2(40, 17)],
			["fence", Vector2(25.5, 14), Vector2(25.5, 40)], ["crate", Vector2(-12.5, 7.2), Vector2.ZERO], ["crate", Vector2(-11.6, 7.8), Vector2.ZERO],
			["barrel", Vector2(14.5, 8.8), Vector2.ZERO], ["barrel", Vector2(20.5, 9.5), Vector2.ZERO], ["barrel", Vector2(-16, -6.2), Vector2.ZERO],
			["table", Vector2(9.5, -12), Vector2.ZERO], ["sign", Vector2(5.5, -4.5), Vector2(40, -20)], ["mast", Vector2(30, -14), Vector2.ZERO]]:
		_put(spec[0], spec[1], spec[2])
	# The launch tower beside the pad, its arm over the Kestrel.
	var pad := Worlds.place(body, "pad")
	_put_at("tower", pad, Vector3(-11.0, 0.0, 0.0), Vector3(1, 0, 0))
	for k in 3:
		_put_at("crate", pad, Vector3(-8.0 + k * 0.9, 0.0, 5.0 + (k % 2) * 0.7), Vector3(0, 0, 1))
	_put_at("observatory", Worlds.place(body, "observatory"), Vector3.ZERO, Vector3(0, 0, 1))
	_put_at("lookout", Worlds.place(body, "lookout"), Vector3.ZERO, Vector3(1, 0, 0))
	_put_at("mine", Worlds.place(body, "cave"), Vector3.ZERO, Vector3(0, 0, 1))
	# The people: Mara by the fire, Fen on a cabin porch, a miner and a
	# hauler about the village, Okafor at the observatory's door.
	_person("mara", "mara", Vector2(-2.6, 1.4), Vector2.ZERO)
	_person("fen", "crowd2", Vector2(-13.0, 6.0), Vector2(0, 0))
	_person("miner", "crowd3", Vector2(10.5, -11.0), Vector2(9.5, -12.0))
	_person("hauler", "crowd1", Vector2(18.0, 7.0), Vector2(14.5, 8.8))
	var obs := Worlds.place(body, "observatory")
	var door := (obs.origin + obs.basis * Vector3(0, 0, 5.5)).normalized()
	_person_at("okafor", "okafor", door, obs.origin)

func _person(key: String, model: String, at: Vector2, look: Vector2) -> Npc:
	var xf := _ground(at)
	return _person_at(key, model, xf.origin.normalized(), _ground(look).origin)

func _person_at(key: String, model: String, d: Vector3, look_at: Vector3) -> Npc:
	var h := Worlds.height(body.key, d, body.radius)
	var at := d * (body.radius + h)
	var f := look_at - at
	f -= d * f.dot(d)
	if f.length() < 0.01:
		f = d.cross(Vector3.UP if absf(d.y) < 0.9 else Vector3.RIGHT)
	var n := Npc.make(key, model)
	add_child(n)
	# Person faces its +Z; turn so that is toward the point looked at.
	n.transform = Transform3D(Basis(d.cross(f.normalized()).normalized(), d, f.normalized()).orthonormalized(), at)
	return n

## A piece at (east, north) metres from the fire, facing a point (or the
## fire when `look` is zero), on the ground there.
func _put(kind: String, at: Vector2, look: Vector2, solid := true, light := false) -> Node3D:
	var xf := _ground(at)
	var to := _ground(look).origin
	var up := xf.basis.y
	var f := to - xf.origin
	f -= up * f.dot(up)
	if f.length() < 0.01:
		f = xf.basis.z
	var basis := Basis(f.normalized().cross(up).normalized(), up, -f.normalized()).orthonormalized()
	var n := _spawn(kind, Transform3D(basis, xf.origin), solid)
	if light:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.68, 0.36)
		l.light_energy = 1.2
		l.omni_range = 7.0
		l.position = Vector3(0, 1.9, 0.55)
		n.add_child(l)
	return n

## A piece relative to a landmark's frame (offset in its own axes), facing
## along `facing` (in those axes).
func _put_at(kind: String, mark: Transform3D, offset: Vector3, facing: Vector3) -> Node3D:
	var d := (mark.origin + mark.basis * offset).normalized()
	var h := Worlds.height(body.key, d, body.radius)
	var up := d
	var f := mark.basis * facing
	f -= up * f.dot(up)
	var basis := Basis(f.normalized().cross(up).normalized(), up, -f.normalized()).orthonormalized()
	return _spawn(kind, Transform3D(basis, d * (body.radius + h)), true)

## The surface point (east, north) metres from the fire.
func _ground(at: Vector2) -> Transform3D:
	var c := center
	var east := c.basis.x
	var north := -c.basis.z
	var dist := at.length()
	var d := c.basis.y
	if dist > 0.001:
		var axis := c.basis.y.cross((east * at.x + north * at.y).normalized()).normalized()
		d = c.basis.y.rotated(axis, dist / body.radius)
	var h := Worlds.height(body.key, d, body.radius)
	return Transform3D(Basis(east, d, -north).orthonormalized(), d * (body.radius + h))

func _spawn(kind: String, xf: Transform3D, solid: bool) -> Node3D:
	var n: Node3D = load("res://art/village-%s.glb" % kind).instantiate()
	Surfaces.apply(n)
	add_child(n)
	n.transform = xf
	# Sunk a little, so no edge floats over a bump.
	n.position -= xf.basis.y * 0.08
	if solid:
		Surfaces.collide(n)
	return n
