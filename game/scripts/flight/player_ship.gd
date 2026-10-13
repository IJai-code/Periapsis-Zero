class_name PlayerShip
extends Hull
## The Kestrel, flown with mouse aim: the mouse moves an aim point and the
## ship turns to follow it. W/S set the speed (it is held), A/D slide,
## Space/C rise and sink, Q/E roll, Shift boosts, double-tap A or D to
## barrel roll (it also shakes off a missile).
##
## Systems, as a real small warship has them: a capacitor that the guns
## and the boost draw on and that recharges; a target lock (T, or it
## locks the hostile under the reticle by itself) that lets the guns
## converge on the target's lead and the missiles (right click or R) home.

signal lock_changed(target: Hull)
signal fired(kind: String)

const MAX := 95.0
const BOOST := 190.0
const TURN := 1.9
const ROLL := 2.2
const AIM_LIMIT := 0.75
const LOCK_RANGE := 2600.0
const LOCK_TIME := 0.8
const GUN_COST := 0.9
const BOOST_COST := 14.0
const CAP_REGEN := 9.0

var controls := true
## Scenes hold the guns (inside a station's traffic lanes, in a cutscene).
var weapons := true
var aim := Vector3.FORWARD
var cruise := 30.0
var boosting := false
var bolts: Bolts
var missiles: Missiles
var camera: Camera3D
var shake := 0.0
var capacitor := 100.0
var max_capacitor := 100.0
var missile_count := 8
## The locked target, and the one being locked.
var target: Hull = null
var locking: Hull = null
var lock_t := 0.0
## True through a barrel roll: a missile's seeker loses the ship.
var dodging := false
## V pulls the camera back for a wider view of the fight.
var far_view := false
## Flight model, set per chapter: space is gentle, atmosphere is fast.
var top_speed := MAX
var boost_speed := BOOST
var turn_rate := TURN
var min_speed := -15.0
## In air: the ship rolls itself level with the horizon when not rolled by
## hand, so the ground stays the ground.
var level_assist := false
## In air: velocity follows the nose (see _physics_process).
var aero := false
## The FPV camera, on the nose, banking into turns (V switches to chase).
var fpv := false
var _plume_nodes: Array[Node3D] = []
var _fpv_ok := false
## Contacts with anything solid, for the checks.
var bumps := 0
var last_bumped := ""

## Offer the FPV camera (and start in it).
func use_fpv() -> void:
	_fpv_ok = true
	fpv = true
var _cam_dist := 27.0
var _model: Node3D
var _plumes: Array[ShaderMaterial] = []
var _cam_up := Vector3.UP
var _cam_pos := Vector3.ZERO
var _gun := 0
var _cool := 0.0
var _mcool := 0.0
var _hover: Hull = null
var _hover_t := 0.0
var _tap := {"left": -9.0, "right": -9.0}
var _roll_t := -1.0
var _roll_dir := 0.0
var _roll_cool := 0.0
var _bank := 0.0
var _clock := 0.0
## For checks: `-- --autofight` locks, leads and fires by itself.
var _auto := false

## Steering by mouse while controls (see Flow's mouse capture).
func wants_mouse() -> bool:
	return controls

func _ready() -> void:
	add_to_group("mouse_look")
	team = "player"
	display_name = "Kestrel"
	ship_class = "Escort fighter"
	radius = 7.0
	max_shield = 100.0
	shield = 100.0
	max_armor = 60.0
	armor = 60.0
	_model = Hull.model("kestrel")
	add_child(_model)
	body = _model
	camera = Camera3D.new()
	camera.fov = 68.0
	camera.near = 0.2
	camera.far = 120_000.0
	camera.top_level = true
	# Steered every frame in _process like any manual camera; it must not
	# wait for the physics ticks that drive the hull underneath it.
	camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
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
		_plume_nodes.append(mi)
	_auto = "--autofight" in OS.get_cmdline_user_args()
	var dust := Dust.new()
	dust.ship = self
	add_child(dust)
	aim = -global_basis.z
	_cam_up = global_basis.y
	_cam_pos = global_position + global_basis * Vector3(0, 5.5, 27)

func _unhandled_input(e: InputEvent) -> void:
	if not controls:
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s := 0.0016 * float(Flow.settings.mouse)
		var cb := camera.global_basis
		aim = aim.rotated(cb.y, -e.relative.x * s)
		aim = aim.rotated(cb.x, -e.relative.y * s * (-1.0 if Flow.settings.invert else 1.0)).normalized()
	if e is InputEventKey and e.pressed and not e.echo and e.physical_keycode == KEY_V:
		if fpv or far_view:
			# Cycle: FPV -> chase -> wide chase -> FPV (when FPV is offered).
			if fpv:
				fpv = false
				_model.visible = true
			elif far_view:
				far_view = false
				if _fpv_ok:
					fpv = true
		else:
			far_view = true
	if e.is_action_pressed("lock"):
		_lock_next()
	if e.is_action_pressed("missile"):
		fire_missiles()
	for side in ["left", "right"]:
		if e.is_action_pressed(side):
			if _clock - _tap[side] < 0.28:
				barrel_roll(-1.0 if side == "left" else 1.0)
			_tap[side] = _clock

# --- Targeting ---------------------------------------------------------------

## Hostiles in lock range, with how far each is off the aim (radians).
func hostiles() -> Array:
	var out := []
	for h in get_tree().get_nodes_in_group("hull"):
		if h == self or not h.alive or h.team == team or h.team == "neutral" or not h.is_inside_tree():
			continue
		var to: Vector3 = h.global_position - global_position
		if to.length() > LOCK_RANGE:
			continue
		out.append([h, aim.angle_to(to)])
	out.sort_custom(func(a, b): return a[1] < b[1])
	return out

## T: lock the hostile nearest the reticle; again, the next one along.
func _lock_next() -> void:
	var list := hostiles()
	if list.is_empty():
		return
	var pick: Hull = list[0][0]
	if (pick == target or pick == locking) and list.size() > 1:
		pick = list[1][0]
	_begin_lock(pick)

func _begin_lock(h: Hull) -> void:
	if h == target or h == locking:
		return
	locking = h
	lock_t = 0.0
	Sfx.play("beep", -12.0, 0.9)

func _targeting(dt: float) -> void:
	if target and (not is_instance_valid(target) or not target.alive or target.global_position.distance_to(global_position) > LOCK_RANGE * 1.3):
		target = null
		lock_changed.emit(null)
	if locking and (not is_instance_valid(locking) or not locking.alive):
		locking = null
	if locking:
		lock_t += dt
		if int((lock_t - dt) * 8.0) != int(lock_t * 8.0):
			Sfx.play("beep", -18.0, 1.3)
		if lock_t >= LOCK_TIME:
			target = locking
			locking = null
			Sfx.play("locked", -8.0)
			lock_changed.emit(target)
	# A hostile held under the reticle for a moment locks by itself.
	if not controls or locking:
		return
	var list := hostiles()
	var under: Hull = list[0][0] if not list.is_empty() and list[0][1] < 0.14 else null
	if under and under != target:
		if under == _hover:
			_hover_t += dt
			if _hover_t > 0.2:
				_begin_lock(under)
		else:
			_hover = under
			_hover_t = 0.0
	else:
		_hover = null

## Where to shoot to hit `h` with a bolt from `from`: its predicted place.
func lead_point(h: Node3D, from: Vector3) -> Vector3:
	var hv: Vector3 = h.get("velocity") if h.get("velocity") != null else Vector3.ZERO
	var p := h.global_position
	for i in 2:
		var t := from.distance_to(p) / Bolts.SPEED
		p = h.global_position + (hv - velocity) * t
	return p

## Right click or R: two missiles at the locked target.
func fire_missiles() -> void:
	if not weapons or not missiles or _mcool > 0.0:
		return
	if not target:
		Hud.prompt("Lock a target first: [T] or hold the reticle on it", 3.0)
		return
	if missile_count <= 0:
		Sfx.play("click", -6.0, 0.6)
		return
	_mcool = 1.2
	for side in [-1.0, 1.0]:
		if missile_count <= 0:
			break
		missile_count -= 1
		var from := to_global(Vector3(2.2 * side, -0.9, -1.0))
		missiles.launch(from, (-global_basis.z - global_basis.y * 0.15).normalized(), velocity, "player", target, 24.0)
	fired.emit("missile")

var _probe := SphereShape3D.new()

## Move by velocity, but not through anything solid: a sphere the size of
## the ship is swept along the motion; on contact the ship stops at the
## surface, bounces off it, and takes damage by how hard it hit.
func _move(dt: float) -> void:
	var motion := velocity * dt
	if motion.length() < 0.0001:
		return
	_probe.radius = 4.2
	var space := get_world_3d().direct_space_state
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = _probe
	q.transform = Transform3D(Basis(), global_position)
	q.motion = motion
	var r := space.cast_motion(q)
	if r.size() < 2 or r[0] >= 1.0:
		global_position += motion
		return
	global_position += motion * r[0]
	q.transform = Transform3D(Basis(), global_position + motion * (r[1] - r[0]))
	q.motion = Vector3.ZERO
	var info := space.get_rest_info(q)
	var n: Vector3 = info.get("normal", -motion.normalized())
	var into := -velocity.dot(n)
	if into > 0.0:
		bumps += 1
		var hit_obj = instance_from_id(int(info.get("collider_id", 0)))
		last_bumped = hit_obj.get_class() + (" " + str((hit_obj as Node).get_parent().name) if hit_obj is Node and (hit_obj as Node).get_parent() else "") if hit_obj else "?"
		velocity += n * into * 1.5
		cruise = minf(cruise, 15.0)
		shake = maxf(shake, clampf(into / 40.0, 0.2, 1.2))
		Fx.sparks(get_parent(), info.get("point", global_position))
		Sfx.play("hit", -4.0, 0.6)
		if into > 8.0:
			hit(into * 0.8, info.get("point", global_position))
	# Never rest inside: nudge out along the normal.
	global_position += n * 0.05

## Parked: no thrust, no physics, nothing to collide (docking, landing,
## cutscenes that move the ship by hand).
func park(on: bool) -> void:
	controls = not on
	weapons = not on
	velocity = Vector3.ZERO
	cruise = 0.0
	boosting = false
	set_physics_process(not on)

func fwd_angle(dir: Vector3) -> float:
	return (-global_basis.z).angle_to(dir)

func barrel_roll(dir: float) -> void:
	if _roll_cool > 0.0:
		return
	_roll_t = 0.0
	_roll_dir = dir
	_roll_cool = 1.1
	dodging = true
	velocity += global_basis.x * dir * 70.0
	Sfx.play("roll", -6.0)

func _physics_process(dt: float) -> void:
	_clock += dt
	_roll_cool -= dt
	_mcool -= dt
	regenerate(dt, 3.0, 22.0)
	_targeting(dt)
	var fwd := -global_basis.z
	# Keep the aim point within reach of the nose.
	if fwd.angle_to(aim) > AIM_LIMIT:
		aim = fwd.slerp(aim, AIM_LIMIT / fwd.angle_to(aim)).normalized()
	# Turn toward the aim point at a limited rate.
	var angle := fwd.angle_to(aim)
	var yaw_rate := 0.0
	if angle > 0.0005:
		var axis := fwd.cross(aim).normalized()
		var step := minf(angle, turn_rate * dt * clampf(angle * 3.0, 0.25, 1.0))
		global_basis = Basis(axis, step) * global_basis
		yaw_rate = global_basis.y.dot(axis) * step / dt
	var roll_in := 0.0
	if controls:
		roll_in = Input.get_axis("roll_right", "roll_left")
		# Arrow keys steer too: pitch and yaw the aim, for flying without a mouse.
		var look := Input.get_vector("look_left", "look_right", "look_up", "look_down")
		if look.length() > 0.0:
			var cb := camera.global_basis
			aim = aim.rotated(cb.y, -look.x * 1.6 * dt)
			aim = aim.rotated(cb.x, -look.y * 1.6 * dt * (-1.0 if Flow.settings.invert else 1.0)).normalized()
	global_basis = Basis(-global_basis.z.normalized(), roll_in * ROLL * dt) * global_basis
	if level_assist and absf(roll_in) < 0.01 and _roll_t < 0.0:
		var fwd2 := -global_basis.z
		var want_right := fwd2.cross(Vector3.UP)
		if want_right.length() > 0.2:
			want_right = want_right.normalized()
			var err := global_basis.x.signed_angle_to(want_right, fwd2)
			global_basis = Basis(fwd2.normalized(), err * minf(1.0, 2.5 * dt)) * global_basis
	global_basis = global_basis.orthonormalized()
	# Flight assist: hold the speed that was set, slide sideways on A/D.
	boosting = controls and Input.is_action_pressed("boost") and capacitor > 2.0
	if boosting:
		capacitor -= BOOST_COST * dt
	if controls:
		if Input.is_action_pressed("forward"):
			cruise = move_toward(cruise, top_speed, 55.0 * dt)
		elif Input.is_action_pressed("back"):
			cruise = move_toward(cruise, min_speed, 70.0 * dt)
	cruise = maxf(cruise, min_speed)
	var speed := boost_speed if boosting else cruise
	var strafe := Vector2.ZERO
	if controls:
		strafe = Vector2(Input.get_axis("left", "right"), Input.get_axis("down", "up"))
	var want := -global_basis.z * speed + global_basis.x * strafe.x * 35.0 + global_basis.y * strafe.y * 35.0
	if aero:
		# In air the ship carves like an aircraft: its velocity swings round
		# to follow the nose (no sliding wide through a turn), speed eases.
		var sp := velocity.length()
		var heading := velocity / sp if sp > 1.0 else -global_basis.z
		var to := want.normalized() if want.length() > 0.1 else heading
		heading = heading.slerp(to, minf(1.0, 6.0 * dt)).normalized()
		velocity = heading * move_toward(sp, want.length(), (140.0 if boosting else 80.0) * dt)
	else:
		velocity = velocity.move_toward(want, (90.0 if boosting else 45.0) * dt)
	_move(dt)
	# The model banks into turns and spins through a barrel roll.
	_bank = lerpf(_bank, clampf(-yaw_rate * 0.5, -0.6, 0.6), 4.0 * dt)
	var spin := 0.0
	if _roll_t >= 0.0:
		_roll_t += dt / 0.7
		spin = -_roll_dir * TAU * smoothstep(0.0, 1.0, _roll_t)
		if _roll_t >= 1.0:
			_roll_t = -1.0
			dodging = false
	_model.rotation = Vector3(0.0, 0.0, _bank + spin)
	capacitor = minf(max_capacitor, capacitor + CAP_REGEN * dt)
	_guns(dt)

## The wing guns: ten rounds a second, alternating, each drawing on the
## capacitor. With a target locked and the reticle near its lead, the guns
## converge on the lead; otherwise they converge on the aim point.
func _guns(dt: float) -> void:
	_cool -= dt
	var trigger := Input.is_action_pressed("fire")
	if _auto and controls:
		var list := hostiles()
		if not target and not locking and not list.is_empty():
			_begin_lock(list[0][0])
		if target:
			aim = (lead_point(target, global_position) - global_position).normalized()
			trigger = fwd_angle(aim) < 0.1
			if missile_count > 6 and _mcool <= 0.0:
				fire_missiles()
	if not (controls and weapons and trigger and _cool <= 0.0):
		return
	if capacitor < GUN_COST:
		return
	_cool = 0.1
	capacitor -= GUN_COST
	_gun = 1 - _gun
	# Barrels at x = 3.5, under the wing, muzzles 2.25 m ahead.
	var local := Vector3(3.5 if _gun else -3.5, -0.42, -2.3)
	var muzzle := to_global(local)
	var aim_at := global_position + aim * 450.0
	var assist: Hull = target
	if not assist:
		var list := hostiles()
		if not list.is_empty() and list[0][1] < 0.08:
			assist = list[0][0]
	if assist:
		var lead := lead_point(assist, muzzle)
		var off := aim.angle_to(lead - global_position)
		if off < (0.11 if assist == target else 0.05):
			aim_at = lead
		elif assist == target:
			aim_at = global_position + aim * global_position.distance_to(assist.global_position)
	var dir := (aim_at - muzzle).normalized()
	dir = (dir + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.0025).normalized()
	bolts.fire(muzzle, dir, velocity, "player", 6.0)
	Fx.muzzle(self, local, Color(0.5, 1.4, 2.2))
	Sfx.play("laser", -16.0, randf_range(0.95, 1.08))
	fired.emit("gun")

func _process(dt: float) -> void:
	var thrust := clampf(velocity.length() / top_speed, 0.15, 1.0) * (1.8 if boosting else 1.0)
	for pm in _plumes:
		pm.set_shader_parameter("power", thrust)
	for p in _plume_nodes:
		p.scale = Vector3(1.0, 2.0 + thrust * 6.0, 1.0)
	shake = maxf(0.0, shake - dt * 1.6)
	if fpv:
		_fpv_camera(dt)
		return
	# Chase camera: behind the aim, its up easing toward the ship's. It
	# follows the interpolated hull, so it does not step once a tick.
	var at := get_global_transform_interpolated()
	# Near-parallel Vector3.slerp can form an unstable axis from float
	# roundoff. Normalized lerp gives the chase camera the same soft roll.
	var up := _cam_up.lerp(at.basis.y.normalized(), minf(1.0, 3.0 * dt))
	_cam_up = up.normalized() if up.length_squared() > 0.0001 else at.basis.y.normalized()
	var look := Basis.looking_at(aim, _cam_up)
	_cam_dist = lerpf(_cam_dist, 52.0 if far_view else 27.0, minf(1.0, 3.0 * dt))
	var want := at.origin + look * Vector3(0.0, _cam_dist * 0.2, _cam_dist)
	_cam_pos = _cam_pos.lerp(want, minf(1.0, 9.0 * dt))
	var jitter := Vector3(randf_range(-1, 1), randf_range(-1, 1), 0.0) * shake * shake * 0.8
	camera.global_position = _cam_pos + look * jitter
	camera.global_basis = Basis.looking_at(at.origin + aim * 80.0 - camera.global_position, _cam_up)
	camera.fov = lerpf(camera.fov, 80.0 if boosting else 68.0, 3.0 * dt)

## On the nose, looking where the ship points, rolling with its bank: the
## ground rushing past a metre below the lens. Wider with speed.
func _fpv_camera(dt: float) -> void:
	_model.visible = false
	# Interpolated matrices can contain slight scale/shear; axis-angle
	# rotation requires a unit axis, especially during fast FPV turns.
	var b := get_global_transform_interpolated().basis.orthonormalized()
	b = Basis(b.z.normalized(), _bank * 0.9) * b
	var j := Vector3(randf_range(-1, 1), randf_range(-1, 1), 0.0) * shake * shake * 0.12
	camera.global_position = get_global_transform_interpolated() * (Vector3(0.0, 0.6, -7.5)) + b * j
	camera.global_basis = camera.global_basis.slerp(b.orthonormalized(), minf(1.0, 14.0 * dt))
	var spd := velocity.length() / maxf(top_speed, 1.0)
	camera.fov = lerpf(camera.fov, 88.0 + spd * 14.0 + (10.0 if boosting else 0.0), 3.0 * dt)
	_cam_pos = camera.global_position
	_cam_up = camera.global_basis.y
