class_name FireRest
extends Node3D
## Sitting by a fire. The view drops low by the flames; you can look about
## (and up at the sky). Q sleeps: the eyes close and the time races past
## until any key, or until the end of the loop is near. Space stands.

const SLEEP_WARP := 30.0
const WAKE_BEFORE := 1250.0

var fire: Node3D
var ex: Explorer
var reach: Node
var cam: Camera3D
var _yaw := 0.0
var _pitch := -0.22
var _up := Vector3.UP
var _seat := Vector3.ZERO
var _sleeping := false
var _lids: ColorRect
var _lid_mat: ShaderMaterial
var _prompt: Label
var _clock: Label
var _gone := false

## Sit down at `fire` (a Campfire), on the side the explorer stands.
static func sit(f: Node3D, by: Explorer) -> void:
	var r := f.get_tree().get_first_node_in_group("reach_root")
	if not r or r.talking or not by or not by.enabled:
		return
	var rest := FireRest.new()
	rest.fire = f
	rest.ex = by
	rest.reach = r
	r.add_child(rest)

func wants_mouse() -> bool:
	return not _gone

func _ready() -> void:
	add_to_group("fire_rest")
	add_to_group("mouse_look")
	reach.talking = true
	ex.enabled = false
	_up = fire.global_basis.y
	var c := fire.global_position
	var away := ex.global_position - c
	away -= _up * away.dot(_up)
	away = away.normalized() if away.length() > 0.1 else fire.global_basis.x
	_seat = c + away * 2.0 + _up * 1.02
	_yaw = 0.0
	cam = Camera3D.new()
	cam.fov = 70.0
	cam.near = 0.03
	cam.far = 60000.0
	add_child(cam)
	cam.global_position = _seat
	_aim()
	cam.make_current()
	_ui()
	Sfx.play("step", -12.0, 0.6)

func _ui() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 8
	add_child(layer)
	_lids = ColorRect.new()
	_lids.set_anchors_preset(Control.PRESET_FULL_RECT)
	_lids.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_lid_mat = ShaderMaterial.new()
	_lid_mat.shader = load("res://shaders/reach/blink.gdshader")
	_lid_mat.set_shader_parameter("lid", 0.0)
	_lids.material = _lid_mat
	_lids.visible = false
	layer.add_child(_lids)
	_prompt = ReachStyle.label("", 16, ReachStyle.BONE, true)
	_prompt.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_prompt.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_prompt.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_prompt.offset_bottom = -44
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_prompt.add_theme_constant_override("outline_size", 6)
	_prompt.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	layer.add_child(_prompt)
	_clock = ReachStyle.label("", 15, ReachStyle.MUTE, true)
	_clock.set_anchors_preset(Control.PRESET_CENTER)
	_clock.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_clock.visible = false
	layer.add_child(_clock)

func _aim() -> void:
	var c := fire.global_position + _up * 0.3
	var fwd := c - _seat
	fwd -= _up * fwd.dot(_up)
	var base := Basis.looking_at(fwd.normalized(), _up)
	cam.global_basis = base * Basis(Vector3.UP, _yaw) * Basis(Vector3.RIGHT, _pitch)

func _input(e: InputEvent) -> void:
	if _gone:
		return
	if _sleeping:
		if (e is InputEventKey and e.pressed and not e.echo) or (e is InputEventMouseButton and e.pressed):
			get_viewport().set_input_as_handled()
			_wake()
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s := 0.0022 * float(Flow.settings.mouse)
		_yaw = clampf(_yaw - e.relative.x * s, -1.4, 1.4)
		_pitch = clampf(_pitch - e.relative.y * s * (-1.0 if Flow.settings.invert else 1.0), -0.7, 1.35)
	elif e is InputEventKey and e.pressed and not e.echo:
		match (e as InputEventKey).keycode:
			KEY_Q:
				_sleep()
			KEY_SPACE:
				_stand()
			_:
				return
		get_viewport().set_input_as_handled()

func _process(dt: float) -> void:
	if _gone:
		return
	_aim()
	var t: float = reach.system.t
	if _sleeping:
		_clock.text = "Sleeping   %02d:%02d\nany key to wake" % [int(t) / 60, int(t) % 60]
		if t >= WAKE_BEFORE:
			_wake()
			reach.hud.caption("Something wakes you. The star is wrong.", 4.0)
		_prompt.text = ""
	else:
		_prompt.text = "[Q] sleep until later in the day      [Space] get up"

## Eyes closed, the night hurrying past.
func _sleep() -> void:
	if _sleeping or reach.system.t >= WAKE_BEFORE - 10.0:
		return
	_sleeping = true
	_lids.visible = true
	var t := create_tween()
	t.tween_method(func(v: float): _lid_mat.set_shader_parameter("lid", v), 0.0, 1.0, 1.4).set_trans(Tween.TRANS_SINE)
	await t.finished
	if _sleeping and not _gone:
		reach.system.warp = SLEEP_WARP
		_clock.visible = true

func _wake() -> void:
	if not _sleeping:
		return
	_sleeping = false
	reach.system.warp = 1.0
	_clock.visible = false
	if reach.scope:
		reach.scope.resync()
	var t := create_tween()
	t.tween_method(func(v: float): _lid_mat.set_shader_parameter("lid", v), 1.0, 0.0, 1.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	await t.finished
	_lids.visible = false

func _stand() -> void:
	leave(true)

## Up from the fire (or, when the loop ends, simply gone).
func leave(stand: bool) -> void:
	if _gone:
		return
	_gone = true
	reach.system.warp = 1.0
	reach.talking = false
	if stand:
		var foot := _seat - _up * 1.02
		var look := -cam.global_basis.z
		ex.place(Transform3D(Site.upright(_up, look), foot + _up * 0.05), look)
		ex.camera.make_current()
		ex.enabled = true
	queue_free()
