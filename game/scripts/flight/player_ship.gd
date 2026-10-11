class_name PlayerShip
extends Hull
## The Kestrel, flown with mouse aim: the mouse moves an aim point and the
## ship turns to follow it, the way the web game flies. W/S thrust (the
## speed you set is held), A/D strafe, Space/C up and down, Q/E roll,
## Shift boost, click to fire, double-tap A or D to barrel roll.

const MAX := 95.0
const BOOST := 190.0
const TURN := 1.9
const ROLL := 2.2
const AIM_LIMIT := 0.75

var controls := true
var aim := Vector3.FORWARD
var cruise := 30.0
var boosting := false
var bolts: Bolts
var camera: Camera3D
var shake := 0.0
var _model: Node3D
var _plumes: Array[ShaderMaterial] = []
var cockpit := false
var _cockpit_parts: Array[Node3D] = []
var _dash: Node3D
var _cam_up := Vector3.UP
var _cam_pos := Vector3.ZERO
var _gun := 0
var _cool := 0.0
var _tap := {"left": -9.0, "right": -9.0}
var _roll_t := -1.0
var _roll_dir := 0.0
var _roll_cool := 0.0
var _bank := 0.0
var _clock := 0.0

func _ready() -> void:
	team = "player"
	radius = 7.0
	max_shield = 100.0
	shield = 100.0
	_model = Hull.model("kestrel")
	add_child(_model)
	body = _model
	camera = Camera3D.new()
	camera.fov = 68.0
	camera.near = 0.2
	camera.far = 120_000.0
	camera.top_level = true
	add_child(camera)
	# Engine plumes from both nozzles (art/godot/ships.py: x = 1.62, aft at 7.3).
	for x in [-1.62, 1.62]:
		var c := CylinderMesh.new()
		c.top_radius = 0.42
		c.bottom_radius = 0.05
		c.height = 1.0
		c.radial_segments = 16
		c.rings = 1
		var pm := ShaderMaterial.new()
		pm.shader = load("res://shaders/plume.gdshader")
		c.material = pm
		var mi := MeshInstance3D.new()
		mi.mesh = c
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		# The cylinder's top (the nozzle end) faces forward, its length aft.
		mi.rotation_degrees = Vector3(-90, 0, 0)
		mi.position = Vector3(x, 0.0, 7.3)
		_model.add_child(mi)
		_plumes.append(pm)
		mi.set_meta("plume", true)
	var dust := Dust.new()
	dust.ship = self
	add_child(dust)
	# The cockpit: the glass hides from inside; a dashboard appears.
	for n in _model.find_children("canopy", "MeshInstance3D", true, false):
		_cockpit_parts.append(n)
	_dash = _make_dash()
	_model.add_child(_dash)
	_dash.visible = false
	if "--cockpit" in OS.get_cmdline_user_args():
		toggle_cockpit.call_deferred()
	aim = -global_basis.z
	_cam_up = global_basis.y
	_cam_pos = global_position + global_basis * Vector3(0, 5.5, 27)

func _unhandled_input(e: InputEvent) -> void:
	if not controls:
		return
	if e is InputEventMouseButton and e.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		get_viewport().set_input_as_handled()
	elif e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s := 0.0016 * float(Flow.settings.mouse)
		var cb := camera.global_basis
		aim = aim.rotated(cb.y, -e.relative.x * s)
		aim = aim.rotated(cb.x, -e.relative.y * s * (-1.0 if Flow.settings.invert else 1.0)).normalized()
	if e is InputEventKey and e.pressed and not e.echo and e.physical_keycode == KEY_V:
		toggle_cockpit()
	for side in ["left", "right"]:
		if e.is_action_pressed(side):
			if _clock - _tap[side] < 0.28:
				barrel_roll(-1.0 if side == "left" else 1.0)
			_tap[side] = _clock

func _make_dash() -> Node3D:
	var d := Node3D.new()
	var body := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = Vector3(1.1, 0.24, 0.55)
	b.material = Surfaces.get_material("seam")
	body.mesh = b
	body.position = Vector3(0, 0.86, -3.35)
	body.rotation_degrees = Vector3(-18, 0, 0)
	d.add_child(body)
	for x in [-0.27, 0.27]:
		var sc := MeshInstance3D.new()
		var sm := BoxMesh.new()
		sm.size = Vector3(0.34, 0.2, 0.02)
		sm.material = Surfaces.get_material("screen")
		sc.mesh = sm
		sc.position = Vector3(x, 0.99, -3.1)
		sc.rotation_degrees = Vector3(-30, 0, 0)
		d.add_child(sc)
	return d

## V toggles the view between the chase camera and the cockpit.
func toggle_cockpit() -> void:
	cockpit = not cockpit
	for n in _cockpit_parts:
		n.visible = not cockpit
	_dash.visible = cockpit
	for p in _model.find_children("*", "MeshInstance3D", true, false):
		if p.has_meta("plume"):
			p.visible = not cockpit

func barrel_roll(dir: float) -> void:
	if _roll_cool > 0.0:
		return
	_roll_t = 0.0
	_roll_dir = dir
	_roll_cool = 1.1
	velocity += global_basis.x * dir * 70.0
	Sfx.play("roll", -6.0)

func _physics_process(dt: float) -> void:
	_clock += dt
	_roll_cool -= dt
	regenerate(dt, 2.5, 25.0)
	var fwd := -global_basis.z
	# Keep the aim point within reach of the nose.
	if fwd.angle_to(aim) > AIM_LIMIT:
		aim = fwd.slerp(aim, AIM_LIMIT / fwd.angle_to(aim)).normalized()
	# Turn toward the aim point at a limited rate.
	var angle := fwd.angle_to(aim)
	var yaw_rate := 0.0
	if angle > 0.0005:
		var axis := fwd.cross(aim).normalized()
		var step := minf(angle, TURN * dt * clampf(angle * 3.0, 0.25, 1.0))
		global_basis = Basis(axis, step) * global_basis
		yaw_rate = global_basis.y.dot(axis) * step / dt
	var roll_in := 0.0
	if controls:
		roll_in = Input.get_axis("roll_right", "roll_left")
	global_basis = Basis(-global_basis.z, roll_in * ROLL * dt) * global_basis
	global_basis = global_basis.orthonormalized()
	# Flight assist: hold the speed that was set, slide sideways on A/D.
	boosting = controls and Input.is_action_pressed("boost")
	if controls:
		if Input.is_action_pressed("forward"):
			cruise = move_toward(cruise, MAX, 55.0 * dt)
		elif Input.is_action_pressed("back"):
			cruise = move_toward(cruise, -15.0, 70.0 * dt)
	var speed := BOOST if boosting else cruise
	var strafe := Vector2.ZERO
	if controls:
		strafe = Vector2(Input.get_axis("left", "right"), Input.get_axis("down", "up"))
	var want := -global_basis.z * speed + global_basis.x * strafe.x * 35.0 + global_basis.y * strafe.y * 35.0
	velocity = velocity.move_toward(want, (90.0 if boosting else 45.0) * dt)
	global_position += velocity * dt
	# The model banks into turns and spins through a barrel roll.
	_bank = lerpf(_bank, clampf(-yaw_rate * 0.5, -0.6, 0.6), 4.0 * dt)
	var spin := 0.0
	if _roll_t >= 0.0:
		_roll_t += dt / 0.7
		spin = -_roll_dir * TAU * smoothstep(0.0, 1.0, _roll_t)
		if _roll_t >= 1.0:
			_roll_t = -1.0
	_model.rotation = Vector3(0.0, 0.0, _bank + spin)
	# Guns.
	_cool -= dt
	if controls and Input.is_action_pressed("fire") and _cool <= 0.0 and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_cool = 0.1
		_gun = 1 - _gun
		# The wing guns: barrels at x = 3.5, under the wing, muzzles 2.25 m ahead.
		var local := Vector3(3.5 if _gun else -3.5, -0.42, -2.3)
		var muzzle := to_global(local)
		var target := global_position + aim * 450.0
		bolts.fire(muzzle, (target - muzzle).normalized(), velocity, "player", 9.0)
		Fx.muzzle(self, local, Color(0.5, 1.4, 2.2))
		Sfx.play("laser", -16.0, randf_range(0.95, 1.08))

func _process(dt: float) -> void:
	var thrust := clampf(velocity.length() / MAX, 0.15, 1.0) * (1.8 if boosting else 1.0)
	for pm in _plumes:
		pm.set_shader_parameter("power", thrust)
	for p in _model.find_children("*", "MeshInstance3D", true, false):
		if p.has_meta("plume"):
			p.scale = Vector3(1.0, 2.0 + thrust * 6.0, 1.0)
	if cockpit:
		shake = maxf(0.0, shake - dt * 1.6)
		var j := Vector3(randf_range(-1, 1), randf_range(-1, 1), 0.0) * shake * shake * 0.05
		camera.global_position = to_global(Vector3(0.0, 1.38, -2.45) + j)
		camera.global_basis = Basis.looking_at(aim, global_basis.y.slerp(_cam_up, 0.3))
		camera.fov = lerpf(camera.fov, 84.0 if boosting else 76.0, 3.0 * dt)
		_cam_pos = camera.global_position
		return
	# Chase camera: behind the aim, its up easing toward the ship's.
	_cam_up = _cam_up.slerp(global_basis.y, minf(1.0, 3.0 * dt)).normalized()
	var look := Basis.looking_at(aim, _cam_up)
	var want := global_position + look * Vector3(0.0, 5.5, 27.0)
	_cam_pos = _cam_pos.lerp(want, minf(1.0, 9.0 * dt))
	shake = maxf(0.0, shake - dt * 1.6)
	var jitter := Vector3(randf_range(-1, 1), randf_range(-1, 1), 0.0) * shake * shake * 0.8
	camera.global_position = _cam_pos + look * jitter
	camera.global_basis = Basis.looking_at(global_position + aim * 80.0 - camera.global_position, _cam_up)
	camera.fov = lerpf(camera.fov, 80.0 if boosting else 68.0, 3.0 * dt)
