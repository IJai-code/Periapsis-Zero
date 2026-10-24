class_name ZeroGCave
extends Node3D
## The Zero-G cave on Hearth's crater floor, where pilots learn the suit's
## jetpack (as in Outer Wilds' first morning): inside the dome there is no
## gravity (Explorer asks `ZeroGCave.inside`), rocks drift, and five rings
## hang in a loop. Fly through them in order (the next one burns brightest)
## and the training is done: a line in the ship log. A sign at the mouth
## says how. Hung on the cave's model: +Z is out of its mouth.

const CENTER := Vector3(0, 4.0, 0)
const RADIUS := 8.4
const RINGS := [Vector3(0, 3.2, 4.5), Vector3(-4.2, 5.5, 0.5), Vector3(-1.5, 8.5, -4.0), Vector3(4.0, 6.0, -2.0), Vector3(2.5, 3.0, 2.0)]

static var _all: Array[ZeroGCave] = []

var reach: Node
var _rings: Array[MeshInstance3D] = []
var _mats: Array[StandardMaterial3D] = []
var _next := 0
var _rocks: Array = []
var _t := 0.0
var _was_inside := false

## Whether a point (world space) is inside a cave with no gravity.
static func inside(p: Vector3) -> bool:
	for c in _all:
		if is_instance_valid(c) and c.is_inside_tree() and p.distance_to(c.global_transform * CENTER) < RADIUS:
			return true
	return false

func _enter_tree() -> void:
	_all.append(self)

func _exit_tree() -> void:
	_all.erase(self)

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	for i in RINGS.size():
		var mi := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 1.25
		tm.outer_radius = 1.5
		tm.rings = 32
		tm.ring_segments = 10
		mi.mesh = tm
		var m := StandardMaterial3D.new()
		m.emission_enabled = true
		m.albedo_color = Color(0.2, 0.15, 0.1)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visibility_range_end = 90.0
		add_child(mi)
		var at: Vector3 = RINGS[i]
		var to: Vector3 = RINGS[(i + 1) % RINGS.size()] - at
		# The ring's hole faces along the way to the next one.
		mi.transform = Transform3D(Basis.looking_at(to.normalized(), Vector3.UP if absf(to.normalized().y) < 0.95 else Vector3.RIGHT) * Basis(Vector3.RIGHT, PI / 2.0), at)
		_rings.append(mi)
		_mats.append(m)
	# Rocks drifting in the dome (Poly Haven's moon rocks, scaled up).
	var rng := RandomNumberGenerator.new()
	rng.seed = 19
	for k in 7:
		var r: Node3D = load("res://art/ph/ph-moon_rock_0%d.glb" % [1, 2, 3, 5][k % 4]).instantiate()
		add_child(r)
		var d := Vector3(rng.randf_range(-1, 1), rng.randf_range(-0.3, 1), rng.randf_range(-1, 1)).normalized()
		r.position = CENTER + d * rng.randf_range(3.0, 6.5)
		r.scale = Vector3.ONE * rng.randf_range(6.0, 12.0)
		for mi: MeshInstance3D in r.find_children("*", "MeshInstance3D", true, false):
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			# Inside the dome: never seen from further than its mouth.
			mi.visibility_range_end = 90.0
		_rocks.append([r, r.position, Vector3(rng.randf(), rng.randf(), rng.randf()).normalized(), rng.randf_range(0.1, 0.3), rng.randf() * TAU])
	# A warm light in the dome, and dust motes hanging in the air.
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.75, 0.45)
	l.light_energy = 1.6
	l.omni_range = 13.0
	l.shadow_enabled = false
	l.position = CENTER + Vector3(0, 2.5, 0)
	add_child(l)
	# The sign at the mouth.
	var sign := Usable.box("Read the sign", Vector3(1.2, 2.0, 1.2))
	sign.position = Vector3(2.6, 1.0, 12.5)
	add_child(sign)
	sign.used.connect(func(_by): _read())
	var post := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.0, 0.7, 0.08)
	post.mesh = bm
	post.material_override = Surfaces.get_material("planks")
	post.position = Vector3(2.6, 1.5, 12.5)
	add_child(post)
	var label := Label3D.new()
	label.text = "ZERO-G CAVE\nno gravity inside"
	label.font = ReachStyle.serif_bold
	label.font_size = 40
	label.pixel_size = 0.004
	label.modulate = Color(0.95, 0.9, 0.78)
	label.outline_size = 8
	label.outline_modulate = Color(0.2, 0.13, 0.08)
	label.position = Vector3(2.6, 1.5, 12.56)
	add_child(label)
	reset_loop()

func _read() -> void:
	if reach and reach.hud:
		reach.hud.guide("The Zero-G cave", "Inside the dome there is no gravity. Jump in and you float.\n\nSpace thrusts up, Shift down, W A S D any way; the mouse turns you right round (the suit's fuel refills on the ground).\n\nFly through the five rings in order: the next one burns brightest.", 20.0)

func reset_loop() -> void:
	_next = 0 if not Lore.known("hearth_zerog") else RINGS.size()
	_paint()

func _paint() -> void:
	for i in _mats.size():
		var m := _mats[i]
		if i < _next:
			m.emission = Color(0.4, 1.0, 0.55)
			m.emission_energy_multiplier = 1.2
		elif i == _next:
			m.emission = Color(1.0, 0.7, 0.35)
			m.emission_energy_multiplier = 3.0
		else:
			m.emission = Color(1.0, 0.6, 0.3)
			m.emission_energy_multiplier = 0.5

func _process(dt: float) -> void:
	_t += dt
	for r in _rocks:
		var n: Node3D = r[0]
		n.position = (r[1] as Vector3) + Vector3(0, sin(_t * 0.4 + float(r[4])) * 0.4, 0)
		n.rotate(r[2], float(r[3]) * dt)
	if _next < RINGS.size():
		var pulse := 2.4 + 1.2 * sin(_t * 4.0)
		_mats[_next].emission_energy_multiplier = pulse
	if not reach or not reach.player:
		return
	var p: Vector3 = reach.player.global_position + reach.player.global_basis.y * 0.9
	var here := inside(p)
	if here and not _was_inside and reach.hud:
		reach.hud.caption("No gravity in here. Space up, Shift down, W A S D any way.", 4.0)
	_was_inside = here
	if _next < RINGS.size() and p.distance_to(global_transform * (RINGS[_next] as Vector3)) < 1.6:
		_next += 1
		_paint()
		Sfx.play("ping", -8.0, 1.0 + _next * 0.12)
		if _next < RINGS.size():
			if reach.hud:
				reach.hud.caption("Ring %d of %d" % [_next, RINGS.size()], 2.0)
		else:
			Sfx.play("objective", -6.0)
			if reach.hud:
				reach.hud.caption("Suit training complete. The jetpack is yours.", 4.0)
			if Lore.learn("hearth_zerog") and reach.hud:
				reach.hud.toast("SHIP LOG UPDATED")
