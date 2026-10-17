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

const MAIN := 20.0
const SIDE := 12.0
const EYE := Vector3(0.0, 1.12, -3.35)

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
## Controls let go (the map is open).
var hold := false

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
	_shapes()
	_gear()
	_plumes_make()
	_cockpit()
	cam = Camera3D.new()
	cam.fov = 78.0
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
	_board = Usable.box("Climb into the Kestrel", Vector3(1.6, 3.0, 4.0))
	_board.position = Vector3(-1.8, -0.4, -3.6)
	add_child(_board)
	_board.used.connect(func(_by): board())
	_rumble = AudioStreamPlayer.new()
	_rumble.stream = Sfx.hum_stream()
	_rumble.volume_db = -80.0
	add_child(_rumble)
	_rumble.play()

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

## Landing legs: a strut and a pad under each foot.
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
	cockpit = Node3D.new()
	add_child(cockpit)
	var dark := Surfaces.get_material("paint_dark")
	var parts := [
		[Vector3(0.0, 0.78, -4.25), Vector3(1.05, 0.34, 0.55), dark],
		[Vector3(0.0, 0.6, -3.35), Vector3(1.1, 0.12, 2.0), dark],
		[Vector3(-0.56, 0.86, -3.3), Vector3(0.06, 0.3, 2.2), dark],
		[Vector3(0.56, 0.86, -3.3), Vector3(0.06, 0.3, 2.2), dark],
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = p[1]
		b.material = p[2]
		mi.mesh = b
		mi.position = p[0]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		cockpit.add_child(mi)
	# Three screens on the dash, angled at the pilot.
	for k in 3:
		var scr := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(0.26, 0.17)
		var sm := StandardMaterial3D.new()
		sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		sm.albedo_color = [Color(0.95, 0.5, 0.2), Color(0.35, 0.85, 0.55), Color(0.95, 0.75, 0.4)][k] * 0.55
		q.material = sm
		scr.mesh = q
		scr.position = Vector3(-0.33 + k * 0.33, 0.97, -4.0)
		scr.rotation_degrees = Vector3(-28.0, 0.0, 0.0)
		cockpit.add_child(scr)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.7, 0.45)
	lamp.light_energy = 0.35
	lamp.omni_range = 1.6
	lamp.position = Vector3(0.0, 1.05, -3.8)
	lamp.shadow_enabled = false
	cockpit.add_child(lamp)
	cockpit.visible = false

func _unhandled_input(e: InputEvent) -> void:
	if not piloted or _moving or _dead or hold:
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
	var g := system.gravity(global_position)
	var force := g * mass
	_thrust = Vector3.ZERO
	if piloted and not _moving and not hold:
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

func _process(dt: float) -> void:
	var p := clampf(-_thrust.z, 0.0, 1.0) if piloted else 0.0
	for pm in _plumes:
		pm.set_shader_parameter("power", 0.2 + p * 1.6)
	for n in model.get_children():
		if n.has_meta("plume"):
			(n as Node3D).scale = Vector3(1.0, 1.0 + p * 6.0, 1.0)
	_rumble.volume_db = lerpf(_rumble.volume_db, (-10.0 - (1.0 - _thrust.length()) * 10.0) if piloted else -80.0, minf(1.0, dt * 4.0))
	_rumble.pitch_scale = 0.8 + _thrust.length() * 0.5
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

## Climb in: the explorer's view rises up her side, over the sill and down
## into the seat, as the canopy lifts and closes.
func board() -> void:
	if piloted or _moving or not explorer:
		return
	if not Lore.known("hearth_codes"):
		var r := get_tree().get_first_node_in_group("reach_root")
		if r:
			r.hud.caption("The canopy is locked. Mara has the launch codes.", 3.5)
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
	cockpit.visible = false
	if _canopy:
		_canopy.visible = true
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
