class_name Person
extends Node3D
## A character from art/godot/people.py: plays "idle" or "talk" and turns
## to face someone.

var who := ""
var _anim: AnimationPlayer
var _yaw_target := NAN

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
				t.albedo_color = Color(0.62, 0.6, 0.58)
				mi.set_surface_override_material(i, t)
	var players := body.find_children("*", "AnimationPlayer", true, false)
	if players.size() > 0:
		_anim = players[0]
		for a in ["idle", "talk"]:
			if _anim.has_animation(a):
				_anim.get_animation(a).loop_mode = Animation.LOOP_LINEAR
		_anim.play("idle")
		_anim.seek(randf() * 3.0)

## Start or stop talking (the talk loop: head and a hand).
func talk(on: bool) -> void:
	if _anim:
		_anim.play("talk" if on else "idle", 0.4)

## Turn the whole body to face a point, over a second or so.
func face(point: Vector3) -> void:
	var d := point - global_position
	_yaw_target = atan2(d.x, d.z)

func _process(dt: float) -> void:
	if not is_nan(_yaw_target):
		rotation.y = lerp_angle(rotation.y, _yaw_target, minf(1.0, dt * 3.0))
