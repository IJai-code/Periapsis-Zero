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
	var body: Node3D = load("res://art/person-%s.glb" % who).instantiate()
	add_child(body)
	# MakeHuman's workwear is bright denim; the Aster's crew wear it faded.
	for mi: MeshInstance3D in body.find_children("*", "MeshInstance3D", true, false):
		for i in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(i) as StandardMaterial3D
			if m and m.resource_name.contains("worksuit"):
				var t := m.duplicate() as StandardMaterial3D
				t.albedo_color = suit_tint
				mi.set_surface_override_material(i, t)
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
		want = 0.12 + 0.38 * syl * phrase
	_mouth = lerpf(_mouth, want, minf(1.0, dt * 18.0))
	_brow = lerpf(_brow, 0.35 if _talking and sin(_t * 0.9) > 0.7 else 0.0, minf(1.0, dt * 4.0))
	for mi in _faces:
		_shape(mi, "blink_l", lid)
		_shape(mi, "blink_r", lid)
		_shape(mi, "mouth_open", _mouth)
		_shape(mi, "purse", _mouth * 0.25 * (0.5 + 0.5 * sin(_t * 7.0)))
		_shape(mi, "brow_l", _brow)
		_shape(mi, "brow_r", _brow)

static func _shape(mi: MeshInstance3D, name: String, v: float) -> void:
	var i := mi.find_blend_shape_by_name(name)
	if i >= 0:
		mi.set_blend_shape_value(i, v)
