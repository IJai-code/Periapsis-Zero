class_name ZeroGCave
extends Node3D
## The Zero-G cave on Hearth's crater floor: inside the dome there is no
## gravity (Explorer asks `ZeroGCave.inside`) and rocks drift. High on the
## dome's roof, out of reach of anyone standing, the Founders carved
## Hearth's part of the Engine's song. You float up to it (the suit's
## jets, gentle in here) and read it. A sign at the mouth says so, and the
## visor marks the carving. Hung on the cave's model: +Z is out of its mouth.

const CENTER := Vector3(0, 4.0, 0)
const RADIUS := 8.4
## The carving: on the roof, facing down into the dome.
const CARVING := Vector3(0.0, 10.6, -1.5)

static var _all: Array[ZeroGCave] = []

var reach: Node
var _rocks: Array = []
var _t := 0.0
var _was_inside := false
var _told := false

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
	_carving()
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
		reach.hud.guide("The Zero-G cave", "Inside the dome there is no gravity. Walk in and you float.\n\nHigh on the roof the Founders carved something, out of reach of anyone standing. Float up to it: Space rises, Shift sinks, W A S D move you the way you look. Let go and the suit slows you to a stop.\n\nLook at the carving and press E.", 20.0)

var _read_done := false

func reset_loop() -> void:
	_read_done = Lore.known("song_hearth")
	_paint()

func _paint() -> void:
	if _glow_mat:
		_glow_mat.emission_energy_multiplier = 0.8 if _read_done else 2.4

## The carving: on the underside of the great boulder that hangs at the
## top of the dome (nothing holds it up in here), a spiral cut in it and
## lit from within (the Founders' hand), with its own soft light. Only
## someone floating can get under it.
var _glow_mat: StandardMaterial3D
var _use: Usable
var _boulder: Node3D
func _carving() -> void:
	_boulder = load("res://art/ph/ph-moon_rock_03.glb").instantiate()
	add_child(_boulder)
	_boulder.position = CARVING + Vector3(0, 1.4, 0)
	_boulder.scale = Vector3(40.0, 24.0, 40.0)
	for mi: MeshInstance3D in _boulder.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visibility_range_end = 120.0
	var glyph := MeshInstance3D.new()
	var t := TorusMesh.new()
	t.inner_radius = 0.55
	t.outer_radius = 0.75
	t.rings = 24
	t.ring_segments = 6
	glyph.mesh = t
	_glow_mat = StandardMaterial3D.new()
	_glow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_glow_mat.emission_enabled = true
	_glow_mat.albedo_color = Color(1.0, 0.6, 0.3)
	_glow_mat.emission = Color(1.0, 0.55, 0.25)
	glyph.material_override = _glow_mat
	glyph.position = CARVING
	glyph.scale = Vector3(1, 0.15, 1)
	add_child(glyph)
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.65, 0.35)
	l.light_energy = 1.2
	l.omni_range = 6.0
	l.position = CARVING - Vector3(0, 0.8, 0)
	add_child(l)
	_use = Usable.sphere("Read the Founders' carving", 1.6)
	_use.reach = 4.0
	_use.position = CARVING - Vector3(0, 0.4, 0)
	add_child(_use)
	_use.used.connect(func(_by): read_carving())

## Read it: Hearth's part of the Engine's song.
func read_carving() -> void:
	_read_done = true
	_paint()
	Sfx.play("objective", -6.0)
	if reach and reach.hud:
		reach.hud.caption("A Founders' carving, older than the village, cut into the roof where only someone floating could read it: Hearth's part of the Engine's song is EMBER.", 7.0)
	Season.note("zerog")
	var song := Lore.learn("song_hearth")
	if (Lore.learn("hearth_zerog") or song) and reach and reach.hud:
		reach.hud.toast("SHIP LOG UPDATED")

func _process(dt: float) -> void:
	_t += dt
	for r in _rocks:
		var n: Node3D = r[0]
		n.position = (r[1] as Vector3) + Vector3(0, sin(_t * 0.4 + float(r[4])) * 0.4, 0)
		n.rotate(r[2], float(r[3]) * dt)
	if _boulder:
		_boulder.rotation.y = _t * 0.03
	if _glow_mat and not _read_done:
		_glow_mat.emission_energy_multiplier = 2.0 + 0.8 * sin(_t * 2.0)
	if not reach or not reach.player:
		return
	var p: Vector3 = reach.player.global_position + reach.player.global_basis.y * 0.9
	var here := inside(p)
	# Near the cave, the carving not yet read: say so at the mouth, and
	# mark the carving on the visor.
	var near := p.distance_to(global_transform * CENTER) < 28.0
	var mine: bool = reach.race_at.is_empty() or reach.race_at.get("cave", false)
	if near and not _read_done and mine:
		reach.race_at = {"at": global_transform * CARVING, "label": "The carving", "cave": true}
		if not _told and not here:
			_told = true
			reach.hud.caption("The Zero-G cave: walk in and you float. Float up to the carving on the roof (follow the marker): Space rises, Shift sinks, W A S D move.", 7.0)
	elif reach.race_at.get("cave", false):
		reach.race_at = {}
	if not near:
		_told = false
	if here and not _was_inside and reach.hud:
		reach.hud.caption("No gravity in here. Space rises, Shift sinks, W A S D move; let go and you slow to a stop.", 5.0)
	_was_inside = here
