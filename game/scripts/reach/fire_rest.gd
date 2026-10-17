class_name FireRest
extends Node3D
## Sitting by a fire. The view drops low by the flames; you can look about
## (and up at the sky). A stick with a marshmallow on it: hold E to hold it
## over the flames and let go to pull it back; it goes golden, then brown,
## then catches. F eats it. Q sleeps: the eyes close and the night races
## past until any key, or until the end of the loop is near. Space stands.

const TOAST_RATE := 0.2
const SLEEP_WARP := 30.0
const WAKE_BEFORE := 1250.0

var fire: Node3D
var ex: Explorer
var reach: Node
var cam: Camera3D
var _stick: MeshInstance3D
var _mallow: MeshInstance3D
var _mallow_mat: StandardMaterial3D
var _flame: CPUParticles3D
var _toast := 0.0
var _burning := false
var _out := 0.0
var _eaten := 0
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
var _fresh := 0.0

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
	# The stick and the marshmallow.
	_stick = MeshInstance3D.new()
	var sm := CylinderMesh.new()
	sm.top_radius = 0.008
	sm.bottom_radius = 0.012
	sm.height = 1.0
	sm.radial_segments = 6
	var bark := StandardMaterial3D.new()
	bark.albedo_color = Color(0.36, 0.25, 0.16)
	bark.roughness = 0.9
	sm.material = bark
	_stick.mesh = sm
	add_child(_stick)
	_mallow = MeshInstance3D.new()
	var mm := CylinderMesh.new()
	mm.top_radius = 0.032
	mm.bottom_radius = 0.032
	mm.height = 0.06
	mm.radial_segments = 12
	_mallow_mat = StandardMaterial3D.new()
	_mallow_mat.roughness = 0.75
	mm.material = _mallow_mat
	_mallow.mesh = mm
	add_child(_mallow)
	_flame = CPUParticles3D.new()
	Fx._materials()
	var q := QuadMesh.new()
	q.size = Vector2(0.08, 0.12)
	q.material = Fx._fire
	_flame.mesh = q
	_flame.amount = 10
	_flame.lifetime = 0.5
	_flame.direction = Vector3.UP
	_flame.gravity = _up * 0.8
	_flame.initial_velocity_min = 0.1
	_flame.initial_velocity_max = 0.3
	_flame.emitting = false
	_flame.color_ramp = Fx._ramp([Color(1.3, 0.75, 0.3, 0.9), Color(1.1, 0.4, 0.1, 0.6), Color(0.2, 0.05, 0.0, 0.0)])
	_mallow.add_child(_flame)
	_new_mallow()
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

func _new_mallow() -> void:
	_toast = 0.0
	_burning = false
	_flame.emitting = false
	_mallow.visible = true
	_fresh = 0.6

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
			KEY_F:
				_eat()
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
	_fresh -= dt
	# E held: out over the flames.
	var holding := Input.is_key_pressed(KEY_E) and not _sleeping and _mallow.visible and _fresh <= 0.0
	_out = move_toward(_out, 1.0 if holding else 0.0, dt * 1.6)
	var near := cam.global_position + cam.global_basis * Vector3(0.12, -0.22, -0.62)
	var far := fire.global_position + _up * 0.62
	var tip := near.lerp(far, smoothstep(0.0, 1.0, _out))
	var hand := cam.global_position + cam.global_basis * Vector3(0.24, -0.42, -0.18)
	var along := tip - hand
	var length := along.length()
	_stick.global_transform = Transform3D(_along_basis(along), hand + along * 0.5)
	_stick.scale = Vector3(1.0, length, 1.0)
	_mallow.global_transform = Transform3D(_along_basis(along), tip + along.normalized() * 0.01)
	if _mallow.visible:
		if _out > 0.85:
			_toast += dt * TOAST_RATE * (2.2 if _burning else 1.0)
			if _toast > 1.0 and not _burning:
				_burning = true
				_flame.emitting = true
				Sfx.play("hit", -18.0, 1.8)
		elif _burning and _out < 0.2:
			# Pulled back burning, it burns itself out to charcoal.
			_toast += dt * 0.6
			if _toast > 1.6:
				_burning = false
				_flame.emitting = false
		_mallow_mat.albedo_color = _toast_color(_toast)
	var t: float = reach.system.t
	if _sleeping:
		_clock.text = "Sleeping   %02d:%02d\nany key to wake" % [int(t) / 60, int(t) % 60]
		if t >= WAKE_BEFORE:
			_wake()
			reach.hud.caption("Something wakes you. The Lantern is wrong.", 4.0)
		_prompt.text = ""
	else:
		var words := ["[E] hold over the fire"]
		if _mallow.visible and _out < 0.2:
			words.append("[F] eat it")
		words.append("[Q] sleep")
		words.append("[Space] get up")
		_prompt.text = "      ".join(words)

static func _along_basis(v: Vector3) -> Basis:
	var y := v.normalized()
	var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
	return Basis(x, y, x.cross(y)).orthonormalized()

static func _toast_color(k: float) -> Color:
	var raw := Color(0.97, 0.95, 0.9)
	var gold := Color(0.88, 0.62, 0.3)
	var brown := Color(0.45, 0.26, 0.12)
	var black := Color(0.07, 0.06, 0.05)
	if k < 0.5:
		return raw.lerp(gold, k / 0.5)
	if k < 0.85:
		return gold.lerp(brown, (k - 0.5) / 0.35)
	return brown.lerp(black, clampf((k - 0.85) / 0.6, 0.0, 1.0))

func _eat() -> void:
	if not _mallow.visible or _out > 0.2:
		return
	var line := ""
	if _toast < 0.15:
		line = "Cold and squishy. Still good."
	elif _toast < 0.6:
		line = "Golden all the way round. Perfect."
	elif _toast < 0.95:
		line = "Dark and smoky. Sweet in the middle."
	else:
		line = "Burnt to a crisp. You eat it anyway."
	_eaten += 1
	if _eaten == 5:
		line += " That's five."
	reach.hud.caption(line, 3.0)
	Sfx.play("step", -10.0, 1.6)
	_mallow.visible = false
	_flame.emitting = false
	await get_tree().create_timer(1.1).timeout
	if not _gone:
		_new_mallow()

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
