class_name Person
extends Node3D
## A character from art/godot/people.py: plays "idle" or "talk" and turns
## to face someone.

var who := ""
## The work suit's colour, multiplied over its denim.
var suit_tint := Color(0.62, 0.6, 0.58)
var _anim: AnimationPlayer
var _gait := "idle"
var _yaw_target := NAN
## Faces: every mesh carrying the expression keys (body, lashes, brows,
## teeth, tongue), so they move together.
var _faces: Array[MeshInstance3D] = []
var _talking := false
var _mouth := 0.0
var _blink_in := 2.0
var _blink := 0.0
var _brow := 0.0
var _t := 0.0

static func make(name: String) -> Person:
	var p := Person.new()
	p.who = name
	return p

func _ready() -> void:
	# Desktop gets the subdivided body; the browser the plain one.
	var hd := "res://art/person-%s_hd.glb" % who
	var path := hd if Flow.high_quality() and ResourceLoader.exists(hd) else "res://art/person-%s.glb" % who
	var body: Node3D = load(path).instantiate()
	add_child(body)
	_dress(body)
	for mi: MeshInstance3D in body.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh and mi.find_blend_shape_by_name("blink_l") >= 0:
			_faces.append(mi)
	_blink_in = randf_range(0.5, 3.0)
	var players := body.find_children("*", "AnimationPlayer", true, false)
	if players.size() > 0:
		_anim = players[0]
		for a in ["idle", "talk", "walk", "run"]:
			if _anim.has_animation(a):
				_anim.get_animation(a).loop_mode = Animation.LOOP_LINEAR
		_anim.play("idle")
		_anim.seek(randf() * 3.0)

## MakeHuman exports every material as layered transparency, which is
## slow, sorts badly and rules out subsurface scattering. Each part gets
## the material it should have: skin, opaque cloth, cut-out hair, wet eyes.
func _dress(body: Node3D) -> void:
	var skin_shader: Shader = load("res://shaders/skin.gdshader")
	for mi: MeshInstance3D in body.find_children("*", "MeshInstance3D", true, false):
		var part := String(mi.name).to_lower()
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i) as StandardMaterial3D
			if not src:
				continue
			if part == "human":
				var skin := ShaderMaterial.new()
				skin.shader = skin_shader
				skin.set_shader_parameter("albedo_tex", src.albedo_texture)
				mi.set_surface_override_material(i, skin)
				continue
			# The eye is two layers, a clear cornea over the iris: keep it as made.
			if part.contains("high-poly") or part.contains("low-poly"):
				continue
			var m := src.duplicate() as StandardMaterial3D
			m.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
			m.cull_mode = BaseMaterial3D.CULL_BACK
			if part.contains("teeth"):
				# Teeth and gums sit in the mouth's shadow: dimmed, so they
				# read as a mouth and not as a grin of bright points.
				m.albedo_color = Color(0.5, 0.47, 0.44)
				m.roughness = 0.4
				m.metallic_specular = 0.3
			elif part.contains("eyebrow") or part.contains("eyelash") or _is_hair(part):
				m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				m.alpha_scissor_threshold = 0.35
				m.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
				m.cull_mode = BaseMaterial3D.CULL_DISABLED
				if _is_hair(part):
					m.roughness = 0.42
					m.metallic_specular = 0.55
					m.anisotropy_enabled = true
					m.anisotropy = 0.6
			else:
				m.roughness = maxf(m.roughness, 0.7)
				if part.contains("worksuit"):
					m.albedo_color = suit_tint
			mi.set_surface_override_material(i, m)

static func _is_hair(part: String) -> bool:
	for h in ["short0", "ponytail", "braid", "bob0", "long0", "afro"]:
		if part.contains(h):
			return true
	return false

## Start or stop talking (the talk loop: head and a hand).
func talk(on: bool) -> void:
	_talking = on
	if _anim:
		_anim.play("talk" if on else "idle", 0.4)

## Walking pace in metres a second: idle, walk or run, the cycle's speed
## matched to the ground covered (walk 1.6 m/s, run 4.4 m/s at 1x).
func locomote(speed: float) -> void:
	if not _anim or _talking:
		return
	var gait := "idle" if speed < 0.25 else ("walk" if speed < 3.0 else "run")
	if gait != _gait and _anim.has_animation(gait):
		_gait = gait
		_anim.play(gait, 0.25)
	if gait == "walk":
		_anim.speed_scale = clampf(speed / 1.6, 0.6, 1.6)
	elif gait == "run":
		_anim.speed_scale = clampf(speed / 4.4, 0.7, 1.4)
	else:
		_anim.speed_scale = 1.0

## Turn the whole body to face a point, over a second or so.
func face(point: Vector3) -> void:
	var d := point - global_position
	_yaw_target = atan2(d.x, d.z)

func _process(dt: float) -> void:
	if not is_nan(_yaw_target):
		rotation.y = lerp_angle(rotation.y, _yaw_target, minf(1.0, dt * 3.0))
	_t += dt
	# Blinks: every two to five seconds, about a sixth of a second each.
	_blink_in -= dt
	if _blink_in <= 0.0:
		_blink_in = randf_range(2.0, 5.0) if randf() > 0.15 else 0.25
		_blink = 0.16
	var lid := 0.0
	if _blink > 0.0:
		_blink -= dt
		lid = sin(clampf(1.0 - _blink / 0.16, 0.0, 1.0) * PI)
	# Talking: syllables at a speaking rate, uneven, pausing now and then.
	var want := 0.0
	if _talking:
		var syl := 0.5 + 0.5 * sin(_t * 13.0 + sin(_t * 3.1) * 2.5)
		var phrase := smoothstep(-0.6, 0.2, sin(_t * 1.7) + sin(_t * 0.63))
		want = 0.04 + 0.24 * syl * phrase
	_mouth = lerpf(_mouth, want, minf(1.0, dt * 18.0))
	if has_meta("hold_mouth"):
		_mouth = float(get_meta("hold_mouth"))
		lid = 0.0
	_brow = lerpf(_brow, 0.35 if _talking and sin(_t * 0.9) > 0.7 else 0.0, minf(1.0, dt * 4.0))
	for mi in _faces:
		_shape(mi, "blink_l", lid)
		_shape(mi, "blink_r", lid)
		_shape(mi, "mouth_open", _mouth)
		_shape(mi, "purse", _mouth * 0.25 * (0.5 + 0.5 * sin(_t * 7.0)))
		# The open-mouth shape pulls the corners down; lift them back level.
		_shape(mi, "smile", _mouth * 0.45)
		_shape(mi, "brow_l", _brow)
		_shape(mi, "brow_r", _brow)

static func _shape(mi: MeshInstance3D, name: String, v: float) -> void:
	var i := mi.find_blend_shape_by_name(name)
	if i >= 0:
		mi.set_blend_shape_value(i, v)
