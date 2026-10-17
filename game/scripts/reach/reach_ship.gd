class_name ReachShip
extends RigidBody3D
## The Kestrel in the Reach: flown in first person from her cockpit (V for a
## view from behind). Newtonian: thrust changes velocity and nothing slows
## her but air (a little) and the ground. W/S forward and back, A/D sideways,
## Space/Shift up and down, the mouse turns her, Q/E roll. T locks the body
## nearest the middle of the view; hold F to match its velocity.
##
## Landed (slow and resting), she can be left: E. Walk back up to her side
## and E climbs in. A hard landing hurts the hull; a crash kills.

signal boarded
signal left_ship
signal destroyed(cause: String)
signal launched

const MAIN := 20.0
const SIDE := 12.0
const EYE := Vector3(0.0, 1.3, -3.35)
const FOV := 78.0
## The ride off the tower: clamped down while the engines build, then a
## long smooth shove up, nose easing back, before she is yours.
const LIFT_HOLD := 0.95
const LIFT_TIME := 2.45
const LIFT_ACCEL := 9.0
const LIFT_PITCH := 11.0

var system: ReachSystem
var explorer: Explorer
var model: Node3D
var cockpit: Node3D
var cam: Camera3D
var chase: Camera3D
var piloted := false
var integrity := 100.0
var target := ""
var landed := false
var _mouse := Vector2.ZERO
var _canopy: Node3D
var _canopy_frame: Node3D
var _canopy_open := 0.0
var _plumes: Array[ShaderMaterial] = []
var _rumble: AudioStreamPlayer
var _thrust := Vector3.ZERO
var _last_v := Vector3.ZERO
var _anchor := ""
var _view_chase := false
var _board: Usable
var _moving := false
var _dead := false
var _screen_main: Label3D
var _screen_status: Label3D
var _needle: Node3D
var _alarm_mat: StandardMaterial3D
var _alarm_t := 0.0
## Controls let go (the map is open).
var hold := false
## The lift-off: clamped on the deck, the engines building, then up.
var launching := false
var _lift_t := 0.0
var _lift_h := 0.0
var _lift_v := 0.0
var _lift_xf := Transform3D()
var _lift_full := true
var _shake := 0.0
var _shake_t := 0.0
var _gear_k := 1.0
var _legs: Array = []
var _engine_light: OmniLight3D
## The first lift-off of each morning gets the whole ride; hops after it
## are quick, so flying is never interrupted by a cutscene.
var _ride_ready := true
## The external shot of the lift-off: the ship seen from the tower while the
## dust goes up, then back into the cockpit for the last of the climb.
var _launch_cam: Camera3D
var _launch_shot := false
var _launch_cam_at := Vector3.ZERO
## How the ride itself went, for looking at it from a browser: the worst
## frame and how many were long enough to feel.
var _lift_worst := 0.0
var _lift_worst_at := 0.0
var _lift_hitches := 0

func _ready() -> void:
	add_to_group("reach_dynamic")
	add_to_group("mouse_look")
	mass = 4000.0
	gravity_scale = 0.0
	can_sleep = true
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 8
	linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	linear_damp = 0.0
	angular_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	angular_damp = 2.5
	physics_material_override = PhysicsMaterial.new()
	physics_material_override.friction = 0.9
	physics_material_override.bounce = 0.05
	model = Hull.model("kestrel")
	add_child(model)
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		if mi.name == "canopy":
			_canopy = mi
		elif mi.name == "canopy_frame":
			_canopy_frame = mi
	_shapes()
	_gear()
	_plumes_make()
	_cockpit()
	cam = Camera3D.new()
	cam.fov = FOV
	cam.near = 0.04
	cam.far = 60000.0
	cam.position = EYE
	add_child(cam)
	chase = Camera3D.new()
	chase.fov = 70.0
	chase.near = 0.2
	chase.far = 60000.0
	chase.top_level = true
	chase.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(chase)
	# The lift-off shot: a camera out on the tower, watching her go. Made
	# once, here, and used for the first two thirds of the ride.
	_launch_cam = Camera3D.new()
	_launch_cam.fov = 45.0
	_launch_cam.near = 0.1
	_launch_cam.far = 60000.0
	_launch_cam.top_level = true
	_launch_cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(_launch_cam)
	_board = Usable.box("Climb into the Kestrel", Vector3(1.6, 3.0, 4.0))
	_board.position = Vector3(-1.8, -0.4, -3.6)
	add_child(_board)
	_board.used.connect(func(_by): board())
	_rumble = AudioStreamPlayer.new()
	_rumble.stream = Sfx.hum_stream()
	_rumble.volume_db = -80.0
	add_child(_rumble)
	_rumble.play()
	# The plume's light on the deck. Made now, at zero: a light added the
	# moment the engines light would make the browser compile a new shader
	# variant at the worst possible time.
	_engine_light = OmniLight3D.new()
	_engine_light.light_color = Color(1.0, 0.62, 0.3)
	_engine_light.light_energy = 0.0
	_engine_light.omni_range = 26.0
	_engine_light.shadow_enabled = false
	_engine_light.position = Vector3(0.0, -1.1, 4.8)
	add_child(_engine_light)

func wants_mouse() -> bool:
	return piloted and not _moving

## A hull of boxes and three feet (spheres) the size of the model.
func _shapes() -> void:
	for spec in [
		[Vector3(0.09, 0.31, -0.95), Vector3(2.5, 1.6, 14.9)],
		[Vector3(0.0, -0.15, 1.1), Vector3(13.2, 0.55, 5.3)],
		[Vector3(-1.6, -0.0, 3.5), Vector3(1.4, 1.3, 6.0)],
		[Vector3(1.6, -0.0, 3.5), Vector3(1.4, 1.3, 6.0)],
	]:
		var cs := CollisionShape3D.new()
		var b := BoxShape3D.new()
		b.size = spec[1]
		cs.shape = b
		cs.position = spec[0]
		add_child(cs)
	for p in [Vector3(0.0, -1.55, -6.2), Vector3(-2.4, -1.55, 2.2), Vector3(2.4, -1.55, 2.2)]:
		var cs := CollisionShape3D.new()
		var s := SphereShape3D.new()
		s.radius = 0.32
		cs.shape = s
		cs.position = p
		add_child(cs)

## Landing legs: a strut and a pad under each foot, kept so they can fold
## up into the hull as she lifts.
func _gear() -> void:
	var m := Surfaces.get_material("metal")
	for p in [Vector3(0.0, -1.55, -6.2), Vector3(-2.4, -1.55, 2.2), Vector3(2.4, -1.55, 2.2)]:
		var strut := MeshInstance3D.new()
		var c := CylinderMesh.new()
		c.top_radius = 0.09
		c.bottom_radius = 0.12
		c.height = 1.25
		c.material = m
		strut.mesh = c
		strut.position = p + Vector3(0, 0.62, 0)
		add_child(strut)
		var pad := MeshInstance3D.new()
		var pc := CylinderMesh.new()
		pc.top_radius = 0.28
		pc.bottom_radius = 0.34
		pc.height = 0.1
		pc.material = m
		pad.mesh = pc
		pad.position = p + Vector3(0, -0.2, 0)
		add_child(pad)
		_legs.append([strut, pad, p])

## Legs down (k = 1) or folded up (0): the strut telescopes and the pad
## tucks under the hull.
func _gear_pose() -> void:
	for leg in _legs:
		var strut: MeshInstance3D = leg[0]
		var pad: MeshInstance3D = leg[1]
		var at: Vector3 = leg[2]
		strut.scale = Vector3(1.0, lerpf(0.2, 1.0, _gear_k), 1.0)
		strut.position = at + Vector3(0, 0.62 * _gear_k + 0.34 * (1.0 - _gear_k), 0)
		pad.position = at + Vector3(0, lerpf(0.6, -0.2, _gear_k), 0)
		pad.scale = Vector3.ONE * lerpf(0.55, 1.0, _gear_k)

func _plumes_make() -> void:
	for x in [-1.62, 1.62]:
		var c := CylinderMesh.new()
		c.top_radius = 0.42
		c.bottom_radius = 0.05
		c.height = 1.0
		c.radial_segments = 16
		c.rings = 1
		var pm := ShaderMaterial.new()
		pm.shader = load("res://shaders/plume.gdshader")
		# Hearth's engines burn ember, not ice: the same palette as her fire.
		pm.set_shader_parameter("hot", Color(1.0, 0.86, 0.52))
		pm.set_shader_parameter("cool", Color(1.0, 0.32, 0.05))
		c.material = pm
		var mi := MeshInstance3D.new()
		mi.mesh = c
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.rotation_degrees = Vector3(-90, 0, 0)
		mi.position = Vector3(x, 0.0, 7.3)
		mi.set_meta("plume", true)
		model.add_child(mi)
		_plumes.append(pm)

## The cockpit as seen from the seat: a dashboard with lit screens, the
## canopy's frame, the sill. Only drawn while piloted from inside.
func _cockpit() -> void:
	# The cockpit (art/godot/kestrel_cockpit.py), in the ship's own space.
	cockpit = load("res://art/kestrel-cockpit.glb").instantiate()
	Surfaces.apply(cockpit)
	add_child(cockpit)
	for mi: MeshInstance3D in cockpit.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var glow := func(c: Color, e: float) -> StandardMaterial3D:
		var m := StandardMaterial3D.new()
		m.albedo_color = c * 0.3
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = e
		return m
	var named := {"screen_main": glow.call(Color(0.12, 0.3, 0.72), 1.2), "screen_status": glow.call(Color(0.04, 0.26, 0.1), 1.5),
		"alarm_lamp": glow.call(Color(0.5, 0.06, 0.04), 1.0), "knob_blue": glow.call(Color(0.35, 0.55, 1.0), 0.8),
		"knob_teal": glow.call(Color(0.3, 0.9, 0.8), 0.8), "knob_cream": glow.call(Color(1.0, 0.92, 0.75), 0.7)}
	for key in named:
		var mi := cockpit.find_child(key, true, false) as MeshInstance3D
		if mi:
			mi.material_override = named[key]
	_alarm_mat = named["alarm_lamp"]
	# The dial's needle turns about its centre.
	var needle := cockpit.find_child("dial_needle", true, false) as Node3D
	if needle:
		_needle = Node3D.new()
		cockpit.add_child(_needle)
		_needle.position = Vector3(0.4, 0.84 + 0.12, -3.94 - 0.3)
		needle.get_parent().remove_child(needle)
		_needle.add_child(needle)
		needle.transform = Transform3D(Basis(), Vector3(0.0, 0.025, 0.0))
	# What the screens say.
	_screen_main = _screen_text(Vector3(0.0, 1.12, -4.368), Vector3(0, 0.53, 0.848), Color(0.82, 0.95, 1.0), 34)
	_screen_status = _screen_text(Vector3(-0.388, 1.07, -4.28), Vector3(0.377, 0.375, 0.847), Color(0.55, 1.0, 0.62), 26)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.75, 0.5)
	lamp.light_energy = 0.5
	lamp.omni_range = 1.8
	lamp.position = Vector3(0.0, 1.35, -3.6)
	lamp.shadow_enabled = false
	cockpit.add_child(lamp)
	cockpit.visible = false

func _screen_text(at: Vector3, normal: Vector3, col: Color, size: int) -> Label3D:
	var l := Label3D.new()
	l.font = Style.mono_bold
	l.font_size = size
	l.pixel_size = 0.0006
	l.modulate = col
	l.outline_size = 0
	l.shaded = false
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.width = 560.0
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	cockpit.add_child(l)
	var n := normal.normalized()
	l.transform = Transform3D(Basis.looking_at(-n, Vector3.UP), at + n * 0.004)
	return l

## The cockpit's screens, dial and alarm, while flown from inside.
func _instruments(dt: float) -> void:
	if not cockpit or not cockpit.visible:
		return
	_alarm_t += dt
	var r := get_tree().get_first_node_in_group("reach_root")
	var b := system.ruling()
	var v := linear_velocity
	if target != "":
		v -= system.world_vel(target)
	var speed := v.length()
	var lines := ["%d m/s" % int(speed)]
	if b.key != "lantern":
		lines.append("%d m  %s" % [int(global_position.length() - b.radius), b.title.to_upper()])
	else:
		lines.append("OPEN SPACE")
	if target != "":
		var d := global_position.distance_to(system.world(target)) - (system.bodies[target] as ReachBody).radius
		lines.append("LOCK  %s  %s" % [(system.bodies[target] as ReachBody).title.to_upper(), ("%d m" % int(d)) if d < 1000.0 else ("%.1f km" % (d / 1000.0))])
	if r and r.system:
		var t: float = r.system.t
		lines.append("%02d:%02d" % [int(t) / 60, int(t) % 60])
	_screen_main.text = "\n".join(lines)
	_screen_status.text = "KESTREL\nHULL %d%%\n%s\n%s" % [int(integrity), "GEAR DOWN" if landed else "IN FLIGHT", "MATCHING" if Input.is_key_pressed(KEY_F) and target != "" else ""]
	if _needle:
		_needle.rotation.z = lerpf(2.1, -2.1, clampf(speed / 200.0, 0.0, 1.0))
	var late: bool = r != null and r.system != null and float(r.system.t) > 1250.0
	var alarm: bool = integrity < 40.0 or late
	var on: bool = alarm and fmod(_alarm_t, 0.8) < 0.4
	_alarm_mat.emission = Color(1.0, 0.12, 0.06) if on else Color(0.5, 0.06, 0.04)
	_alarm_mat.emission_energy_multiplier = 4.0 if on else 0.8

func _unhandled_input(e: InputEvent) -> void:
	if not piloted or _moving or _dead or hold or launching:
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_mouse += e.relative * Vector2(1.0, -1.0 if Flow.settings.invert else 1.0)
	elif e is InputEventKey and e.pressed and not e.echo:
		match (e as InputEventKey).keycode:
			KEY_E:
				if landed:
					leave()
				else:
					var r := get_tree().get_first_node_in_group("reach_root")
					if r:
						r.hud.caption("Land first to leave the seat.", 2.0)
			KEY_V:
				_view_chase = not _view_chase
				_cameras()
			KEY_T:
				_lock()

func _physics_process(dt: float) -> void:
	if _dead or not system:
		return
	if launching:
		_lift_step(dt)
		return
	var g := system.gravity(global_position)
	var force := g * mass
	_thrust = Vector3.ZERO
	if piloted and not _moving and not hold:
		# Space on the deck does not just push: it lights her.
		if Input.is_key_pressed(KEY_SPACE) and _can_lift():
			launch()
			return
		var t := Vector3(
			float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A)),
			float(Input.is_key_pressed(KEY_SPACE)) - float(Input.is_key_pressed(KEY_SHIFT)),
			float(Input.is_key_pressed(KEY_S)) - float(Input.is_key_pressed(KEY_W)))
		if Input.is_key_pressed(KEY_F) and target != "":
			t = _match(dt)
		_thrust = t
		var acc := Vector3(t.x * SIDE, t.y * SIDE, (MAIN if t.z < 0.0 else SIDE) * t.z)
		force += global_basis * acc * mass
		# The mouse turns her directly; Q/E roll.
		var s := 0.0016 * float(Flow.settings.mouse)
		var roll := float(Input.is_key_pressed(KEY_Q)) - float(Input.is_key_pressed(KEY_E))
		var want := global_basis * Vector3(-_mouse.y * s / dt, -_mouse.x * s / dt, roll * 1.3)
		angular_velocity = angular_velocity.lerp(want, minf(1.0, 18.0 * dt))
		_mouse = Vector2.ZERO
		if t.length() > 0.01:
			sleeping = false
	# Air: a drag toward the frame's body (it carries its air with it).
	var b := system.ruling()
	if b.atmo > 0.0:
		var r := global_position.length()
		var thick := 1.0 - smoothstep(b.radius, b.atmo, r)
		force += -linear_velocity * mass * 0.08 * thick
	apply_central_force(force)
	_impacts()
	_last_v = linear_velocity
	_landed_state()

## Thrust that zeroes the velocity relative to the locked body.
func _match(_dt: float) -> Vector3:
	var rel := linear_velocity - system.world_vel(target)
	if rel.length() < 0.3:
		return Vector3.ZERO
	var local := global_basis.inverse() * (-rel)
	return local.normalized() * clampf(rel.length() / 6.0, 0.2, 1.0)

func _impacts() -> void:
	if get_contact_count() == 0:
		return
	var dv := (linear_velocity - _last_v).length()
	if dv > 8.0:
		integrity -= (dv - 8.0) * 4.5
		Sfx.play("hit", -2.0, 0.6)
		var r := get_tree().get_first_node_in_group("reach_root")
		if r and r.hud and piloted:
			r.hud.caption("Hull %d%%" % int(maxf(integrity, 0.0)), 1.5)
		if dv > 26.0 or integrity <= 0.0:
			_crash()

func _crash() -> void:
	if _dead:
		return
	_dead = true
	Fx.explode(get_parent(), global_position, 9.0)
	destroyed.emit("crash")

func _landed_state() -> void:
	var b := system.ruling()
	var slow := (linear_velocity - Vector3.ZERO).length() < 0.6 and angular_velocity.length() < 0.15
	landed = slow and get_contact_count() > 0 and b.key != "lantern"

func _can_lift() -> bool:
	return not launching and not _moving and (landed or get_contact_count() > 0) and system.ruling().key != "lantern"

## Space on the deck: the clamps hold her while the engines come up, then
## she goes. The first lift of each morning is the ride (the deck and the
## valley falling away under her, nose easing back, the trees dropping
## past); every lift after it is short, so flying is never a cutscene.
func launch() -> void:
	if not _can_lift():
		return
	launching = true
	_lift_full = _ride_ready
	_ride_ready = false
	landed = false
	sleeping = false
	freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	freeze = true
	reset_physics_interpolation()
	_lift_t = 0.0
	_lift_h = 0.0
	_lift_v = 0.0
	_lift_xf = global_transform
	_shake = 1.0
	_shake_t = 0.0
	_mouse = Vector2.ZERO
	_lift_worst = 0.0
	_lift_worst_at = 0.0
	_lift_hitches = 0
	if Flow.on_web():
		JavaScriptBridge.eval("window.pzLaunch={start:performance.now(),worst:0,worst_at:0,hitches:0}", true)
	var up := _lift_xf.basis.y.normalized()
	LaunchFx.make(get_parent(), _lift_xf.origin - up * 1.85, up, 1.0)
	Sfx.play("big", -3.0, 0.72)
	Sfx.play("door", -11.0, 0.55)
	# The engines lighting, as light: it covers the one frame the browser
	# still spends on the first dust and washes the cockpit warm.
	var root := get_tree().get_first_node_in_group("reach_root")
	if root and root.hud:
		root.hud.flash(Color(1.0, 0.72, 0.42), 0.38, 0.05, 0.45)
	cam.fov = FOV + 7.0
	# The ride is watched from the tower first: the ship, the flames under
	# her and the dust going up, the deck falling away. Then the cockpit.
	if _lift_full:
		_launch_shot = true
		var b := _lift_xf.basis
		_launch_cam_at = _lift_xf.origin + b.x.normalized() * 30.0 + b.z.normalized() * 3.0 + up * 10.0
		_launch_cam.global_transform = Transform3D(Basis.looking_at(_lift_xf.origin + up * 0.4 - _launch_cam_at, up), _launch_cam_at)
		_launch_cam.make_current()
		cockpit.visible = true
		if _canopy:
			_canopy.visible = true
		if _canopy_frame:
			_canopy_frame.visible = true
	launched.emit()

## One frame of ignition, without the ignition: the plume wide and hot,
## the engine light on the deck, the gear down, the cockpit from outside.
## Drawn behind the morning's black, so the first real one has nothing new
## to compile (Reach._prewarm).
func rehearse(on: bool) -> void:
	_engine_light.light_energy = 3.6 if on else 0.0
	for pm in _plumes:
		pm.set_shader_parameter("power", 1.9 if on else 0.2)
	for n in model.get_children():
		if n.has_meta("plume"):
			(n as Node3D).scale = Vector3(1.32, 7.5, 1.32) if on else Vector3.ONE
	show_cockpit(on)

## Everything that a lift-off can put on screen (the cockpit from outside,
## the glass) drawn once, out of sight.
func show_cockpit(on: bool) -> void:
	if cockpit:
		cockpit.visible = on
	if _canopy:
		_canopy.visible = on or not piloted
	if _canopy_frame:
		_canopy_frame.visible = on or not piloted

## The tower camera follows her up, a little rattled by the engines, until
## the cut back into the seat two thirds of the way through the climb.
func _launch_cam_step() -> void:
	if not _launch_shot:
		return
	var up := _lift_xf.basis.y.normalized()
	var look := global_position + up * 0.55 - _launch_cam_at
	var b := Basis.looking_at(look, up)
	b = b * Basis(Vector3.RIGHT, sin(_shake_t * 43.0) * 0.0045 * _shake) * Basis(Vector3.UP, sin(_shake_t * 31.0) * 0.0035 * _shake)
	_launch_cam.global_transform = Transform3D(b, _launch_cam_at)
	if _lift_t >= LIFT_HOLD + 1.55:
		_launch_shot = false
		_cameras()
		cam.fov = FOV + 5.0
		create_tween().tween_property(cam, "fov", FOV, 0.8).set_trans(Tween.TRANS_SINE)

## The lift itself: a scripted pose (frozen body, kinematic) rather than
## forces, so the climb is exactly as smooth as the curve drawn here.
func _lift_step(dt: float) -> void:
	_lift_t += dt
	var hold := LIFT_HOLD if _lift_full else 0.5
	var t := _lift_t - hold
	if t > 0.0:
		_lift_v += LIFT_ACCEL * smoothstep(0.0, 0.85, t) * dt
		_lift_h += _lift_v * dt
	var up := _lift_xf.basis.y.normalized()
	var pitch := deg_to_rad(LIFT_PITCH) * smoothstep(0.1, hold + LIFT_TIME * 0.55, _lift_t) if _lift_full else 0.0
	var b := _lift_xf.basis.rotated(_lift_xf.basis.x.normalized(), pitch)
	global_transform = Transform3D(b, _lift_xf.origin + up * _lift_h)
	if _lift_t >= hold + (LIFT_TIME if _lift_full else 0.0):
		_finish_lift()

## Hers again: the speed she has, her nose where it is, the camera eased
## back from the ride's wide view.
func _finish_lift() -> void:
	launching = false
	freeze = false
	sleeping = false
	if _launch_shot:
		_launch_shot = false
		_cameras()
	_lift_v = maxf(_lift_v, 4.0)
	linear_velocity = _lift_xf.basis.y.normalized() * _lift_v
	angular_velocity = Vector3.ZERO
	landed = false
	_shake = 0.4
	if Flow.on_web():
		JavaScriptBridge.eval("window.pzLaunch.end=performance.now();window.pzLaunch.worst=%d;window.pzLaunch.worst_at=%d;window.pzLaunch.hitches=%d" % [int(_lift_worst), int(_lift_worst_at * 1000.0), _lift_hitches], true)
	var t := create_tween()
	t.tween_property(cam, "fov", FOV, 1.1).set_trans(Tween.TRANS_SINE)

func _process(dt: float) -> void:
	_instruments(dt)
	_shake_t += dt
	if launching:
		if dt * 1000.0 > _lift_worst:
			_lift_worst = dt * 1000.0
			_lift_worst_at = _lift_t
		if dt > 0.05:
			_lift_hitches += 1
		_launch_cam_step()
	var p := clampf(-_thrust.z, 0.0, 1.0) if piloted else 0.0
	if launching:
		p = clampf(_lift_t / 0.8, 0.0, 1.0) * 1.35
	for pm in _plumes:
		pm.set_shader_parameter("power", 0.2 + p * 1.7)
	for n in model.get_children():
		if n.has_meta("plume"):
			(n as Node3D).scale = Vector3(1.0 + p * 0.32, 1.0 + p * 6.5, 1.0 + p * 0.32)
	_engine_light.light_energy = p * (3.6 if launching else 1.7)
	# The gear: up once she is clear of the deck, down again as she settles.
	var want_gear := 0.0 if (piloted and not landed) else 1.0
	if launching and _lift_t < 0.85:
		want_gear = 1.0
	if not is_equal_approx(_gear_k, want_gear):
		_gear_k = move_toward(_gear_k, want_gear, dt * 0.85)
		_gear_pose()
	# The engines, felt in the seat: three slow sines, never random.
	if piloted and not _moving and not _view_chase:
		_shake = maxf(_shake - dt * 0.62, 0.0)
		var amp := _shake * _shake
		cam.position = EYE + Vector3(sin(_shake_t * 37.0), cos(_shake_t * 43.0), sin(_shake_t * 31.0)) * 0.017 * amp
		cam.rotation = Vector3(sin(_shake_t * 41.0), sin(_shake_t * 34.0 + 1.1), sin(_shake_t * 27.0 + 2.3)) * 0.009 * amp
	var rum := -80.0
	if piloted:
		rum = -10.0 - (1.0 - _thrust.length()) * 10.0
		if launching:
			rum = lerpf(-5.0, 3.0, clampf(_lift_t / 0.9, 0.0, 1.0))
		elif _shake > 0.3:
			rum = -1.0
	_rumble.volume_db = lerpf(_rumble.volume_db, rum, minf(1.0, dt * 6.0))
	_rumble.pitch_scale = 0.52 if launching else 0.8 + _thrust.length() * 0.5
	if _canopy:
		# Open only while someone climbs in or out: it slides back on rails.
		_canopy_open = move_toward(_canopy_open, 1.0 if _moving else 0.0, dt * 1.8)
		_canopy.position = Vector3(0.0, 0.25, 2.2) * smoothstep(0.0, 1.0, _canopy_open)
	if _view_chase and piloted:
		var at := get_global_transform_interpolated()
		var up := at.basis.y
		chase.global_position = at.origin + at.basis.z * 16.0 + up * 4.5
		chase.look_at(at.origin - at.basis.z * 10.0, up)
	_board.prompt = "Climb into the Kestrel" if not piloted and not _moving else ""

func _cameras() -> void:
	if not piloted:
		return
	if _view_chase:
		chase.make_current()
	else:
		cam.make_current()
	cockpit.visible = not _view_chase
	if _canopy:
		_canopy.visible = _view_chase
	if _canopy_frame:
		_canopy_frame.visible = _view_chase or not piloted

## Climb in: the explorer's view rises up her side, over the sill and down
## into the seat, as the canopy lifts and closes.
func board() -> void:
	if piloted or _moving or not explorer:
		return
	if not Lore.known("hearth_codes"):
		var r := get_tree().get_first_node_in_group("reach_root")
		if r:
			r.hud.caption("The canopy is locked. Okafor has the launch codes, at the observatory.", 3.5)
		Sfx.play("beep", -8.0, 0.7)
		return
	_moving = true
	explorer.enabled = false
	var from := explorer.camera.global_transform
	var sill := Transform3D(global_basis, global_transform * Vector3(-0.9, 1.7, -3.4))
	var seat := global_transform * Transform3D(Basis(), EYE)
	cam.global_transform = from
	cam.make_current()
	var t := create_tween()
	t.tween_method(func(k: float): cam.global_transform = from.interpolate_with(sill, k), 0.0, 1.0, 0.9).set_trans(Tween.TRANS_SINE)
	t.tween_method(func(k: float): cam.global_transform = sill.interpolate_with(seat, k), 0.0, 1.0, 0.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	Sfx.play("step", -8.0, 0.8)
	await t.finished
	cam.position = EYE
	cam.rotation = Vector3.ZERO
	explorer.visible = false
	explorer.process_mode = Node.PROCESS_MODE_DISABLED
	explorer.remove_from_group("reach_dynamic")
	piloted = true
	_moving = false
	freeze = false
	sleeping = false
	system.focus = self
	_cameras()
	Sfx.play("door", -8.0, 1.3)
	boarded.emit()

## Out of the seat and down her side to the ground.
func leave() -> void:
	if not piloted or _moving:
		return
	_moving = true
	piloted = false
	cockpit.visible = false
	if _canopy:
		_canopy.visible = true
	if _canopy_frame:
		_canopy_frame.visible = true
	cam.make_current()
	var down := -system.gravity(global_position).normalized()
	var ground := global_transform * Vector3(-3.2, -0.2, -3.4)
	var stand := Transform3D(global_basis, ground + down * 0.2)
	var from := cam.global_transform
	var t := create_tween()
	t.tween_method(func(k: float): cam.global_transform = from.interpolate_with(Transform3D(global_basis, global_transform * Vector3(-0.9, 1.6, -3.4)), k), 0.0, 1.0, 0.5).set_trans(Tween.TRANS_SINE)
	t.tween_method(func(k: float): cam.global_transform = Transform3D(global_basis, global_transform * Vector3(-0.9, 1.6, -3.4)).interpolate_with(Transform3D(global_basis, stand.origin + down * 1.62), k), 0.0, 1.0, 0.8).set_trans(Tween.TRANS_SINE)
	await t.finished
	explorer.process_mode = Node.PROCESS_MODE_INHERIT
	explorer.visible = true
	explorer.add_to_group("reach_dynamic")
	var face := -global_basis.z
	explorer.place(Transform3D(_upright(down), stand.origin), face)
	explorer.camera.make_current()
	system.focus = explorer
	_moving = false
	left_ship.emit()

## Back on her pad at the start of a loop, whole and empty.
func reset_to(xf: Transform3D) -> void:
	if _anchor != "":
		reparent(system.get_parent())
		_anchor = ""
	_anchor_body = ""
	freeze = false
	piloted = false
	_moving = false
	_dead = false
	integrity = 100.0
	target = ""
	_view_chase = false
	launching = false
	_launch_shot = false
	_lift_t = 0.0
	_lift_h = 0.0
	_lift_v = 0.0
	_shake = 0.0
	_thrust = Vector3.ZERO
	_ride_ready = true
	_gear_k = 1.0
	if _legs.size() > 0:
		_gear_pose()
	if _engine_light:
		_engine_light.light_energy = 0.0
	if cam:
		cam.fov = FOV
		cam.position = EYE
		cam.rotation = Vector3.ZERO
	cockpit.visible = false
	if _canopy:
		_canopy.visible = true
	if _canopy_frame:
		_canopy_frame.visible = true
	if explorer and explorer.process_mode == Node.PROCESS_MODE_DISABLED:
		explorer.process_mode = Node.PROCESS_MODE_INHERIT
		explorer.visible = true
		explorer.add_to_group("reach_dynamic")
	global_transform = xf
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	reset_physics_interpolation()

static func _upright(up: Vector3) -> Basis:
	var f := up.cross(Vector3.RIGHT if absf(up.dot(Vector3.RIGHT)) < 0.9 else Vector3.FORWARD).normalized()
	return Basis(f.cross(up).normalized(), up, -f).orthonormalized()

## T: lock the body nearest the middle of the view.
func _lock() -> void:
	var c := get_viewport().get_camera_3d()
	var best := ""
	var best_a := 0.18
	for key in system.order:
		var to := system.world(key) - c.global_position
		var a := (-c.global_basis.z).angle_to(to)
		if a < best_a:
			best_a = a
			best = key
	if best == target or best == "":
		target = ""
		Sfx.play("click", -10.0, 0.8)
	else:
		target = best
		Sfx.play("locked", -8.0)

## The world's frame moved: move with it (or, parked on a body the frame
## left, stay with that body).
func frame_shift(dp: Vector3, dv: Vector3) -> void:
	if _anchor != "":
		return
	global_position += dp
	linear_velocity += dv
	# The frame's velocity changed, not hers: no impact in that.
	_last_v += dv
	reset_physics_interpolation()

## The frame is about to leave `from`: parked there, she stays with it.
func frame_leaving(from: String) -> void:
	if not piloted and landed and _anchor == "":
		_anchor_body = from

## Parked on a body the explorer flies away from (jetpack, or riding
## something): held on that body until the frame comes back to it.
func anchor_check() -> void:
	if piloted:
		return
	var here := system.ref
	if _anchor == "" and _anchor_body != "" and here != _anchor_body:
		_anchor = _anchor_body
		freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		freeze = true
		reparent(system.bodies[_anchor].node)
	elif _anchor != "" and here == _anchor:
		reparent(system.get_parent())
		freeze = false
		_anchor = ""
		_anchor_body = ""
		_last_v = Vector3.ZERO
		reset_physics_interpolation()

var _anchor_body := ""
