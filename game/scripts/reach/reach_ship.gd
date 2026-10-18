class_name ReachShip
extends RigidBody3D
## The Kestrel in the Reach: flown in first person from her cockpit (V for a
## view from behind). Newtonian: thrust changes velocity and nothing slows
## her but air (a little) and the ground. W/S forward and back, A/D sideways,
## Space/Shift up and down, the mouse turns her, Q/E roll. T locks the body
## nearest the middle of the view; hold F to match its velocity; G flies her
## there by herself (the autopilot) and holds her above it.
##
## Flight assist (R turns it off): her side thrusters take out any drift
## across the way she is going, relative to the world ahead of her, so the
## nose pointed at Verdance goes to Verdance; she will not let herself fall
## at a world faster than she can stop; and near the ground, with nothing
## pressed, she hovers and levels her wings, so landing is setting down.
##
## Landed (slow and resting), she can be left: E. Walk up under her belly
## from either side and E lowers the hatch and climbs in. A hard landing
## hurts the hull; a crash kills.

signal boarded
signal left_ship
signal destroyed(cause: String)
signal launched

const MAIN := 24.0
const SIDE := 16.0
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
var _plumes: Array[ShaderMaterial] = []
var _rumble: AudioStreamPlayer
var _thrust := Vector3.ZERO
var _last_v := Vector3.ZERO
var _anchor := ""
var _view_chase := false
var _board: Usable
var _moving := false
var _dead := false
var screens: KestrelScreens
## The hull's skin: hidden while the view is inside her (its top runs
## between the pilot's eye and the lower dash).
var _fuselage: MeshInstance3D
var _needle_rest := Basis()
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
## Her mass in the seat: the view hangs back from the thrust.
var _seat := Vector3.ZERO
## Off the ground (the last time contacts were counted), and how recently
## she set down (so a rocking hull throws its dust only once).
var _airborne := false
var _land_t := 0.0
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
## Flight assist (R): on unless turned off. What it is working against (the
## world ahead, or the one under her) and what it is doing, for the screens.
var assist := true
var assist_body := ""
var assist_doing := ""
## The autopilot (G with a target locked): flying to `target` by itself.
var autopilot := false
## Her height over the ground of the world she is in, and her speed down
## toward it (for the screens and the assist).
var altitude := INF
var sink := 0.0
## The hatch in her belly: 0 shut, 1 down as a ramp.
var _hatch: Node3D
var _hatch_open := 0.0
## A knock felt in the seat (a landing, a hit): decays.
var _knock := 0.0
var _sway_t := 0.0
## Lit on the ground this lift-off (reset when she is down again); a held
## Space for checks and the launch beat.
var _lit := false
var _lit_at := 0
var _jets: Array = []
var _jet_k := 0.0
var _auto_lift := 0.0
## The mouse as a turn rate (rad/s, x yaw y pitch), smoothed per frame.
var _stick := Vector2.ZERO
const TURN_ACCEL := 7.5
const TURN_MAX := 2.4
## Thrust as the engines are giving it (spooling toward what is asked).
var _acc := Vector3.ZERO
## Ground ahead: 0 clear, up to 1 when she cannot stop in time; where.
var _danger := 0.0
var _danger_dir := Vector3.ZERO
var _terrain_t := 0
var _warn_t := 0.0
var _cast: PhysicsShapeQueryParameters3D
var _in_water := false
## Free look in the seat (right mouse held): the head turns, not the ship.
var _look := Vector2.ZERO

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
	# She does not bounce: what she hits, she stops against, and slides.
	physics_material_override.friction = 1.0
	physics_material_override.bounce = 0.0
	physics_material_override.absorbent = true
	model = Hull.model("kestrel")
	add_child(model)
	_hearth_livery()
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		if mi.name == "canopy":
			_canopy = mi
		elif mi.name == "canopy_frame":
			_canopy_frame = mi
		elif mi.name == "fuselage":
			_fuselage = mi
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
	# The hatch is in her belly, behind the seat: reached from either side,
	# from under the wings or from beside her nose.
	_board = Usable.box("Climb into the Kestrel", Vector3(6.4, 2.4, 5.6))
	_board.position = Vector3(0.0, -0.9, -2.2)
	add_child(_board)
	_hatch_make()
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

## Hearth repainted her when they patched her up: cream panels where she
## was gunmetal, rust-brown where she was dark, her bone stripes kept. A
## village ship, not a convoy's fighter.
func _hearth_livery() -> void:
	var swap := {
		"paint_grey": Surfaces._pbr("MetalPlates013", 1.4, Color(0.86, 0.8, 0.7), true),
		"paint_dark": Surfaces._pbr("MetalPlates013", 1.4, Color(0.44, 0.27, 0.19), true),
	}
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i)
			if src and swap.has(src.resource_name):
				mi.set_surface_override_material(i, swap[src.resource_name])

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
	# The lift jets under her belly: what holds her up and what lifts her
	# off, firing straight down.
	for at in [Vector3(-1.6, -0.55, 2.4), Vector3(1.6, -0.55, 2.4), Vector3(0.0, -0.6, -4.6)]:
		var c2 := CylinderMesh.new()
		c2.top_radius = 0.34
		c2.bottom_radius = 0.06
		c2.height = 1.0
		c2.radial_segments = 12
		c2.rings = 1
		var pm2 := ShaderMaterial.new()
		pm2.shader = load("res://shaders/plume.gdshader")
		pm2.set_shader_parameter("hot", Color(1.0, 0.86, 0.52))
		pm2.set_shader_parameter("cool", Color(1.0, 0.32, 0.05))
		c2.material = pm2
		var jet := MeshInstance3D.new()
		jet.mesh = c2
		jet.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		jet.position = at
		add_child(jet)
		_jets.append([jet, pm2, at])

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
		"screen_log": glow.call(Color(0.06, 0.3, 0.14), 1.4), "cabin_lamp": glow.call(Color(1.0, 0.7, 0.4), 2.4),
		"alarm_lamp": glow.call(Color(0.5, 0.06, 0.04), 1.0), "knob_blue": glow.call(Color(0.35, 0.55, 1.0), 0.8),
		"knob_teal": glow.call(Color(0.3, 0.9, 0.8), 0.8), "knob_cream": glow.call(Color(1.0, 0.92, 0.75), 0.7)}
	for key in named:
		var mi := cockpit.find_child(key, true, false) as MeshInstance3D
		if mi:
			mi.material_override = named[key]
	_alarm_mat = named["alarm_lamp"]
	# The dial's needle: its node sits at the dial's centre, turning about
	# its own up (the face's normal).
	_needle = cockpit.find_child("dial_needle", true, false) as Node3D
	if _needle:
		_needle_rest = _needle.basis
	# The two screens, live (KestrelScreens), over the dash's glass (where
	# art/godot/kestrel_cockpit.py says they are).
	var mn := Vector3(0.0, 0.342, 0.9397).normalized()
	var sn := Vector3(0.4698, 0.342, 0.8138).normalized()
	screens = KestrelScreens.make(self, cockpit,
		Transform3D(Basis.looking_at(-mn, Vector3.UP), Vector3(0.0, 0.9831, -4.0658) + mn * 0.003), Vector2(0.48, 0.3),
		Transform3D(Basis.looking_at(-sn, Vector3.UP), Vector3(-0.4549, 1.0106, -3.9909) + sn * 0.003), Vector2(0.27, 0.22))
	# The ship log's terminal on the back wall, seen climbing in.
	var term := Label3D.new()
	term.text = "SHIP LOG\n\nrumours: L\nmap: M"
	term.font = Style.mono_bold
	term.font_size = 22
	term.pixel_size = 0.0011
	term.modulate = Color(0.55, 1.0, 0.62)
	term.outline_size = 0
	term.shaded = false
	term.position = Vector3(0.32, 1.05, -1.157)
	term.rotation_degrees = Vector3(0, 180, 0)
	cockpit.add_child(term)
	# A warm lamp over the dash, one in the well behind the seat.
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.75, 0.5)
	lamp.light_energy = 0.55
	lamp.omni_range = 1.9
	lamp.position = Vector3(0.0, 1.32, -3.85)
	lamp.shadow_enabled = false
	cockpit.add_child(lamp)
	var well := OmniLight3D.new()
	well.light_color = Color(1.0, 0.68, 0.4)
	well.light_energy = 0.7
	well.omni_range = 2.2
	well.position = Vector3(-0.3, 1.2, -1.3)
	well.shadow_enabled = false
	cockpit.add_child(well)
	cockpit.visible = false

## The cockpit's screens, dial and alarm, while flown from inside.
func _instruments(dt: float) -> void:
	if not cockpit or not cockpit.visible:
		return
	_alarm_t += dt
	var r := get_tree().get_first_node_in_group("reach_root")
	var v := linear_velocity
	if target != "":
		v -= system.world_vel(target)
	var speed := v.length()
	screens.tick(dt)
	if _needle:
		_needle.basis = _needle_rest * Basis(Vector3.UP, lerpf(2.1, -2.1, clampf(speed / 200.0, 0.0, 1.0)))
	var late: bool = r != null and r.system != null and float(r.system.t) > 1250.0
	var alarm: bool = integrity < 40.0 or late
	var on: bool = alarm and fmod(_alarm_t, 0.8) < 0.4
	_alarm_mat.emission = Color(1.0, 0.12, 0.06) if on else Color(0.5, 0.06, 0.04)
	_alarm_mat.emission_energy_multiplier = 4.0 if on else 0.8

func _unhandled_input(e: InputEvent) -> void:
	if not piloted or _moving or _dead or hold or launching:
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var rel: Vector2 = e.relative * Vector2(1.0, -1.0 if Flow.settings.invert else 1.0)
		if Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) and not _view_chase:
			var s := 0.0022 * float(Flow.settings.mouse)
			_look = Vector2(clampf(_look.x - rel.x * s, -2.6, 2.6), clampf(_look.y - rel.y * s, -1.2, 1.1))
		else:
			_mouse += rel
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
			KEY_G:
				if autopilot:
					_autopilot_off("Autopilot off. She is yours.")
				else:
					start_autopilot()
			KEY_R:
				assist = not assist
				Sfx.play("click", -8.0, 1.2 if assist else 0.8)
				var r := get_tree().get_first_node_in_group("reach_root")
				if r:
					r.hud.caption("Flight assist on: no drift, no falling, a hover near the ground." if assist else "Flight assist off: just you and Newton.", 2.5)

func _physics_process(dt: float) -> void:
	if _dead or not system:
		return
	if launching:
		_lift_step(dt)
		return
	var g := system.gravity(global_position)
	var force := g * mass
	_thrust = Vector3.ZERO
	_measure()
	assist_doing = ""
	if piloted and not _moving and not hold:
		var t := Vector3(
			float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A)),
			float(Input.is_key_pressed(KEY_SPACE)) - float(Input.is_key_pressed(KEY_SHIFT)),
			float(Input.is_key_pressed(KEY_S)) - float(Input.is_key_pressed(KEY_W)))
		if _auto_lift > 0.0:
			_auto_lift -= dt
			t.y = 1.0
		# Lifting off is flying: Space on the ground lights the engines under
		# her (dust, flame, a jolt through the hull) and she rises as long as
		# it is held. No cutscene; the deck simply falls away.
		if t.y > 0.0 and _can_lift() and not _lit:
			autopilot = false
			_ignite()
		var roll := float(Input.is_key_pressed(KEY_Q)) - float(Input.is_key_pressed(KEY_E))
		# Any hand on the controls takes her back from the autopilot.
		if autopilot and (t.length() > 0.01 or _stick.length() > 0.25 or roll != 0.0):
			_autopilot_off("Autopilot off. She is yours.")
		var acc := Vector3.ZERO
		if autopilot:
			acc = _autopilot_step(dt, g)
			_mouse = Vector2.ZERO
		else:
			if Input.is_key_pressed(KEY_F) and target != "":
				t = _match(dt)
			acc = Vector3(t.x * SIDE, t.y * SIDE, (MAIN if t.z < 0.0 else SIDE) * t.z)
			if assist:
				acc = _assist(acc, t, g, roll, dt)
			# The mouse asks for a turn rate (smoothed per frame in _process,
			# so it does not matter how frames and physics ticks fall); her
			# attitude thrusters reach it at a fixed angular acceleration and
			# bring her to rest the same way: weight, not a cursor.
			var inv := global_basis.inverse()
			var want := Vector3(-_stick.y, -_stick.x, roll * 1.2)
			if assist and roll == 0.0:
				want += inv * _level(dt)
			var lav := inv * angular_velocity
			lav = lav.move_toward(want, TURN_ACCEL * dt)
			angular_velocity = global_basis * lav
		# The engines spool: a tenth of a second up and down, never a switch.
		_terrain(dt)
		if _danger > 0.0 and assist:
			acc = _avoid(acc, g)
		_acc = _acc.lerp(acc, 1.0 - exp(-dt / 0.09))
		acc = _acc
		# What the engines are doing, for the plumes, the sound and the seat.
		_thrust = Vector3(acc.x / SIDE, acc.y / SIDE, acc.z / (MAIN if acc.z < 0.0 else SIDE)).limit_length(1.0)
		force += global_basis * acc * mass
		if acc.length() > 0.01:
			sleeping = false
	# Air: a drag toward the frame's body (it carries its air with it).
	var b := system.ruling()
	if b.atmo > 0.0:
		var r := global_position.length()
		var thick := 1.0 - smoothstep(b.radius, b.atmo, r)
		force += -linear_velocity * mass * 0.08 * thick
	# Water: she floats, and it drags hard at her.
	if b.sea != 0.0 and b.key != "lantern":
		var rel := global_position - b.node.position
		var under := (b.radius + b.sea) - rel.length() + 1.2
		if under > 0.0:
			var k := clampf(under / 2.4, 0.0, 1.0)
			force += rel.normalized() * g.length() * mass * 1.6 * k
			force += -linear_velocity * mass * 1.8 * k
			if not _in_water and linear_velocity.length() > 3.0:
				Sfx.play("splash", -2.0, 0.6)
				LaunchFx.splash(get_parent(), global_position - rel.normalized() * 0.8, rel.normalized(), 1.8)
			_in_water = true
		else:
			_in_water = false
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

## The ground ahead: her own shape swept along her path for the next few
## seconds (four ticks in five skipped). `_danger` rises from 0 as the room
## left to stop shrinks toward what she needs, to 1 when she cannot.
func _terrain(_dt: float) -> void:
	var b := system.ruling()
	_terrain_t += 1
	if b.key == "lantern" or altitude > 2500.0:
		_danger = 0.0
		return
	if _terrain_t % 3 != 0:
		return
	var v := linear_velocity
	var speed := v.length()
	# A descent the assist is already pacing (Shift, low down) is not danger.
	var up := (global_position - b.node.position).normalized()
	var paced := assist and altitude < HOVER_ALT and v.dot(-up) > speed * 0.8 and speed < 1.6 + altitude * 0.35 + 3.0
	if speed < 3.0 or paced:
		_danger = move_toward(_danger, 0.0, 0.2)
		return
	if _cast == null:
		_cast = PhysicsShapeQueryParameters3D.new()
		var sh := SphereShape3D.new()
		sh.radius = 3.2
		_cast.shape = sh
		_cast.collision_mask = 1
		_cast.exclude = [get_rid()]
	var look := minf(speed * 4.5 + 30.0, 1400.0)
	_cast.transform = Transform3D(Basis(), global_position)
	_cast.motion = v.normalized() * look
	var hit := get_world_3d().direct_space_state.cast_motion(_cast)
	if hit.is_empty() or hit[0] >= 1.0:
		_danger = move_toward(_danger, 0.0, 0.15)
		return
	var d := hit[0] * look
	# What she needs to stop: braking against her path with her strongest
	# engines, gravity working against her where it does.
	var stop := speed * speed / (2.0 * 13.0) + speed * 0.35 + 12.0
	_danger = clampf((stop * 1.6 - d) / (stop * 0.8), 0.0, 1.0)
	_danger_dir = v.normalized()

## Ground ahead too close to stop for: the assist brakes against her path
## and lifts her away from the world, overruling a push toward it.
func _avoid(acc: Vector3, _g: Vector3) -> Vector3:
	var inv := global_basis.inverse()
	var b := system.ruling()
	var up := (global_position - b.node.position).normalized()
	var along := inv * _danger_dir
	var into := acc.dot(along)
	if into > 0.0:
		acc -= along * into
	acc += inv * ((-_danger_dir * 0.8 + up * 0.6).normalized() * MAIN * _danger)
	assist_doing = "TERRAIN"
	return _clamp_acc(acc)

## Height over the ground of the world she is in (a ray when it is close,
## the terrain's own height when not) and how fast she is sinking to it.
func _measure() -> void:
	var b := system.ruling()
	if b.key == "lantern":
		altitude = INF
		sink = 0.0
		return
	var r := global_position - b.node.position
	var up := r.normalized()
	altitude = r.length() - b.radius - Worlds.height(b.key, up, b.radius) - 1.9
	sink = -linear_velocity.dot(up)
	if altitude < 160.0:
		if _ray == null:
			_ray = PhysicsRayQueryParameters3D.new()
			_ray.collision_mask = 1
			_ray.exclude = [get_rid()]
		_ray.from = global_position
		_ray.to = global_position - up * 170.0
		var hit := get_world_3d().direct_space_state.intersect_ray(_ray)
		if not hit.is_empty():
			altitude = global_position.distance_to(hit.position) - 1.9

var _ray: PhysicsRayQueryParameters3D

## The world the assist flies relative to: the locked one; the one she is
## low over; or the one her nose is pointed at.
func _assist_ref() -> String:
	# Inside a world's pull, always that world: that is what "still" means.
	var b := system.ruling()
	if b.key != "lantern":
		return b.key
	if target != "":
		return target
	var fwd := -global_basis.z
	var best := ""
	var best_a := 0.3
	for key in system.order:
		if key == "lantern":
			continue
		var to := system.world(key) - global_position
		if to.length() > 12000.0:
			continue
		var a := fwd.angle_to(to)
		if a < best_a:
			best_a = a
			best = key
	if best == "" and b.key != "lantern":
		best = b.key
	return best

const HOVER_ALT := 320.0

## Flight assist, on top of what the pilot asks for (`acc`, her own axes):
## drift across her heading taken out, a fall at a world held to what she
## can stop from, and near the ground with nothing pressed, a hover.
func _assist(acc: Vector3, t: Vector3, g: Vector3, _roll: float, _dt: float) -> Vector3:
	var key := _assist_ref()
	assist_body = key
	if key == "":
		return acc
	var tb: ReachBody = system.bodies[key]
	var inv := global_basis.inverse()
	var v_rel := linear_velocity - system.world_vel(key)
	var v := inv * v_rel
	var to := system.world(key) - global_position
	var surf := to.length() - tb.radius
	var near := key == system.ref and key != "lantern"
	var out := acc
	var k := 1.6
	if near:
		# Inside a world's pull she flies like a hovering thing, the same at
		# any height: let go and she stops where she is (relative to the
		# world: no drifting round it); push and she goes exactly that way,
		# whatever she was doing across it taken out; gravity undone. Space
		# and Shift climb and sink at a pace (gentler the lower she is), and
		# just over the ground with nothing pressed, or Shift, she settles
		# onto her gear at a walking pace.
		var up := (global_position - system.ruling().node.position).normalized()
		var aw := global_basis * acc
		var v_up := v_rel.dot(up)
		var settle := altitude < 3.0 and t.y <= 0.0 and t.x == 0.0 and t.z == 0.0
		if t.y != 0.0 or settle:
			aw -= up * aw.dot(up)
			var want_up := 12.0 if t.y > 0.0 else -clampf(1.6 + maxf(altitude, 0.0) * 0.45, 1.2, 35.0)
			if settle:
				want_up = -1.2
			aw += up * (want_up - v_up) * 2.5
		aw -= g
		var wish := aw + g
		if wish.length() < 0.1:
			aw -= v_rel * k if not settle else (v_rel - up * v_up) * k
		else:
			var wd := wish.normalized()
			aw -= (v_rel - wd * v_rel.dot(wd)) * k
		out = inv * aw
		if settle:
			assist_doing = "LANDING"
		elif t.length() < 0.01:
			assist_doing = "HOLD"
		elif t.y < 0.0:
			assist_doing = "DESCENT"
		else:
			assist_doing = ""
	else:
		# Across the heading: always, unless that axis is being flown.
		if t.x == 0.0:
			out.x = -v.x * k
		if t.y == 0.0:
			out.y = -v.y * k
	# Falling at a world faster than she can stop in the height left.
	var dirn := to.normalized()
	var closing := v_rel.dot(dirn)
	var room := maxf(altitude - 25.0 if key == system.ref and altitude < INF else surf - 120.0, 0.0)
	var safe := sqrt(2.0 * 6.0 * room) + 5.0
	if closing > safe:
		var brake := inv * (-dirn * (closing - safe) * 2.4)
		# The pilot's own push toward it is overruled while she brakes.
		var along := inv * dirn
		var into := out.dot(along)
		if into > 0.0:
			out -= along * into
		out += brake
		assist_doing = "BRAKING"
	return _clamp_acc(out)

## What her thrusters can do on each axis.
func _clamp_acc(a: Vector3) -> Vector3:
	return Vector3(clampf(a.x, -SIDE, SIDE), clampf(a.y, -SIDE, SIDE), clampf(a.z, -MAIN, SIDE))

## Low over a world, her wings brought level (and right down near the
## ground, her nose too), so she sets down on her feet.
func _level(_dt: float) -> Vector3:
	var b := system.ruling()
	if b.key == "lantern" or altitude > 140.0:
		return Vector3.ZERO
	var up := (global_position - b.node.position).normalized()
	var err := global_basis.y.cross(up)
	if altitude > 30.0:
		var fwd := -global_basis.z
		err = fwd * err.dot(fwd)
	return err * 1.4

## G: fly to the locked world by herself.
func start_autopilot() -> void:
	if target == "":
		_lock()
	if target == "" or landed:
		var r := get_tree().get_first_node_in_group("reach_root")
		if r:
			r.hud.caption("Lock onto a world first: look at it and press T." if not landed else "Lift off first.", 2.5)
		return
	if target == system.ref and altitude < HOVER_ALT:
		return
	autopilot = true
	Sfx.play("locked", -6.0, 0.8)
	var r := get_tree().get_first_node_in_group("reach_root")
	if r:
		r.hud.caption("Autopilot: to %s. Touch the controls to take her back." % (system.bodies[target] as ReachBody).title, 3.0)

func _autopilot_off(why: String) -> void:
	autopilot = false
	var r := get_tree().get_first_node_in_group("reach_root")
	if r and why != "":
		r.hud.caption(why, 3.0)

## One tick of the autopilot: a point over the target, on this side of it,
## flown to at the speed she can still stop from; round the Lantern or a
## world in the way; nose along the way; gravity undone. Returns thrust in
## her own axes.
func _autopilot_step(dt: float, g: Vector3) -> Vector3:
	if target == "" or not system.bodies.has(target):
		_autopilot_off("")
		return Vector3.ZERO
	var tb: ReachBody = system.bodies[target]
	var c := system.world(target)
	var stand := clampf(tb.radius * 0.5, 120.0, 220.0)
	var p := c + (global_position - c).normalized() * (tb.radius + stand)
	var aim := p
	var far := false
	# Anything in the way (the Lantern, or a world): go round it.
	for key in system.order:
		if key == target:
			continue
		var ob: ReachBody = system.bodies[key]
		var oc := system.world(key)
		var clear := 1700.0 if key == "lantern" else ob.radius + 260.0
		var seg := p - global_position
		var k := clampf((oc - global_position).dot(seg) / maxf(seg.length_squared(), 1.0), 0.0, 1.0)
		var q := global_position + seg * k
		if q.distance_to(oc) < clear and global_position.distance_to(oc) > clear * 0.9:
			var side := q - oc
			if side.length() < 1.0:
				side = seg.cross(Vector3.UP if absf(seg.normalized().y) < 0.9 else Vector3.RIGHT)
			aim = oc + side.normalized() * clear * 1.25
			far = true
			break
	var d := aim - global_position
	var dist := d.length()
	var v_rel := linear_velocity - system.world_vel(target)
	var spd := 220.0 if far else minf(220.0, sqrt(2.0 * 7.0 * dist) * 0.85)
	if dist < 20.0 and not far:
		spd = dist * 0.3
	var v_des := d.normalized() * spd
	var g_t := Vector3.ZERO if target == system.ref else system.gravity(c)
	var a := (v_des - v_rel) * 1.3 - (g - g_t)
	# Nose along the way; wings level to the world ahead.
	var want := d.normalized() if dist > 40.0 else -global_basis.z
	var turn := (-global_basis.z).cross(want) * 2.2
	var up := (global_position - c).normalized()
	turn += (-global_basis.z) * global_basis.y.cross(up).dot(-global_basis.z) * 0.8
	angular_velocity = angular_velocity.lerp(turn, minf(1.0, 6.0 * dt))
	assist_body = target
	assist_doing = "AUTOPILOT"
	if not far and dist < 25.0 and v_rel.length() < 2.5:
		_autopilot_off("Holding over %s. Bring her down when you are ready." % tb.title)
	return _clamp_acc(global_basis.inverse() * a)

func _impacts() -> void:
	var touching := get_contact_count() > 0
	var dv := (linear_velocity - _last_v).length()
	# Setting down: the first touch after flying throws the ground's grit out
	# from under the gear and takes the hull with a thud. Softly from a
	# hover, hard from a fall.
	if touching and _airborne and piloted and _land_t <= 0.0 and dv > 0.2:
		_land_t = 0.7
		var g := system.gravity(global_position)
		var down := g.normalized() if g.length() > 0.001 else -global_basis.y.normalized()
		LaunchFx.land(get_parent(), global_position + down * 1.9, -down, clampf(maxf(dv, 0.5) / 4.0, 0.3, 1.5))
		# A hard one will hit the hull below and sound for itself.
		if dv <= 11.0:
			Sfx.play("hit", -13.0, 0.5)
		_knock = maxf(_knock, clampf(dv / 10.0, 0.15, 1.0))
	_airborne = not touching
	if not touching:
		return
	# She is built for rough fields: a bump at a walking pace is nothing,
	# a fall at a run dents her, a dive into the ground ends her.
	if dv > 4.0:
		# A knock spins nothing off: the hull grinds to a stop.
		angular_velocity *= 0.35
	if dv > 11.0:
		integrity -= (dv - 11.0) * 4.0
		_knock = 1.0
		Sfx.play("hit", -2.0, 0.6)
		var r := get_tree().get_first_node_in_group("reach_root")
		if r and r.hud and piloted:
			r.hud.caption("Hull %d%%" % int(maxf(integrity, 0.0)), 1.5)
		if dv > 32.0 or integrity <= 0.0:
			_crash()

func _crash() -> void:
	if _dead:
		return
	_dead = true
	Fx.explode(get_parent(), global_position, 9.0)
	destroyed.emit("crash")

func _landed_state() -> void:
	if freeze and not piloted and not launching:
		landed = true
		return
	var b := system.ruling()
	var slow := (linear_velocity - Vector3.ZERO).length() < 0.6 and angular_velocity.length() < 0.15
	landed = slow and get_contact_count() > 0 and b.key != "lantern"
	# Down again (and not merely still on the deck in the instant after
	# lighting up): the next lift-off lights her again.
	if landed and Time.get_ticks_msec() - _lit_at > 2500:
		_lit = false
	# Parked and empty, she is set down for good: nothing a person walking
	# into her, or climbing on her wing, can push about.
	if landed and not piloted and not _moving and not freeze and _anchor == "":
		freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		freeze = true
		linear_velocity = Vector3.ZERO
		angular_velocity = Vector3.ZERO

func _can_lift() -> bool:
	return not launching and not _moving and (landed or get_contact_count() > 0) and system.ruling().key != "lantern"

## Space on the deck: the clamps hold her while the engines come up, then
## she goes. The first lift of each morning is the ride (the deck and the
## valley falling away under her, nose easing back, the trees dropping
## past); every lift after it is short, so flying is never a cutscene.
func launch() -> void:
	# (The launch beat and the checks: Space held for her, for 3 s.)
	_auto_lift = 3.0

## The engines lighting on the ground: grit and smoke blown off the deck, a
## warm flash, the plume's light on the boards, a jolt through the hull and
## a widening of the view as she goes.
func _ignite() -> void:
	_lit = true
	_lit_at = Time.get_ticks_msec()
	landed = false
	sleeping = false
	if freeze:
		freeze = false
	var up := global_basis.y.normalized()
	LaunchFx.make(get_parent(), global_position - up * 1.85, up, 1.0)
	Sfx.play("big", -4.0, 0.75)
	Sfx.play("door", -12.0, 0.55)
	var root := get_tree().get_first_node_in_group("reach_root")
	if root and root.hud:
		root.hud.flash(Color(1.0, 0.72, 0.42), 0.22, 0.04, 0.5)
	_knock = 0.9
	_shake = 0.75
	cam.fov = FOV + 6.0
	create_tween().tween_property(cam, "fov", FOV, 2.2).set_trans(Tween.TRANS_SINE)
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
	# The mouse's movement this frame as a rate, eased over ~60 ms.
	if piloted and not _moving and not hold and not launching and dt > 0.0:
		var sens := 0.0016 * float(Flow.settings.mouse)
		var inst := (_mouse * sens / maxf(dt, 1.0 / 240.0)).limit_length(TURN_MAX)
		_stick = _stick.lerp(inst, 1.0 - exp(-dt / 0.06))
	else:
		_stick = Vector2.ZERO
	_mouse = Vector2.ZERO
	_warn_t -= dt
	if _danger > 0.35 and piloted and _warn_t <= 0.0:
		_warn_t = lerpf(0.6, 0.2, _danger)
		Sfx.play("warn", -10.0, 1.0 + _danger * 0.3)
	if _fuselage:
		_fuselage.visible = not (cockpit.visible and get_viewport().get_camera_3d() == cam)
	_instruments(dt)
	_shake_t += dt
	_land_t = maxf(_land_t - dt, 0.0)
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
	# The belly's jets: lifting off, climbing, or holding her against
	# gravity low over the ground.
	var lift := 0.0
	if piloted and not landed:
		lift = clampf(_thrust.y, 0.0, 1.0)
		if system and system.ruling().key != "lantern" and altitude < 80.0:
			lift = maxf(lift, 0.35)
	_jet_k = lerpf(_jet_k, lift, minf(1.0, dt * 8.0))
	for j in _jets:
		var jet: MeshInstance3D = j[0]
		var len := 0.3 + _jet_k * 3.2
		jet.visible = _jet_k > 0.03
		jet.scale = Vector3(1.0 + _jet_k * 0.4, len, 1.0 + _jet_k * 0.4)
		jet.position = (j[2] as Vector3) - Vector3(0, len * 0.5, 0)
		(j[1] as ShaderMaterial).set_shader_parameter("power", 0.3 + _jet_k * 1.6)
	_engine_light.light_energy = maxf(p * (3.6 if launching else 1.7), _jet_k * 2.4)
	# The gear: up once she is clear of the deck, down again as she settles.
	var want_gear := 0.0 if (piloted and not landed and altitude > 4.0) else 1.0
	if launching and _lift_t < 0.85:
		want_gear = 1.0
	if not is_equal_approx(_gear_k, want_gear):
		_gear_k = move_toward(_gear_k, want_gear, dt * 0.85)
		_gear_pose()
	# The engines, felt in the seat: three slow sines, never random. Idling
	# she is a hum you can feel in the frame; under thrust the whole view
	# buzzes, and the pilot hangs back from her acceleration.
	# The ride off the deck shakes (that is its point) and a hard landing
	# knocks; flying is steady, as the glass must be to fly by: only a slow
	# lean back from her acceleration and a breath of sway with the
	# engines, far under anything that reads as judder.
	if piloted and not _moving and not _view_chase:
		_shake = maxf(_shake - dt * 0.8, 0.0)
		_knock = maxf(_knock - dt * 2.2, 0.0)
		if launching:
			_shake = maxf(_shake, 0.8)
		var amp := _shake * _shake + _knock * _knock * 0.6
		var push := clampf(_thrust.length(), 0.0, 1.0)
		_sway_t += dt * (1.0 + push * 1.5)
		_seat = _seat.lerp(Vector3(-_thrust.x, -_thrust.y, -_thrust.z) * 0.035, minf(1.0, dt * 2.5))
		var sway := Vector3(sin(_sway_t * 2.3), sin(_sway_t * 3.1 + 1.0), 0.0) * 0.0025 * push
		cam.position = EYE + _seat + sway + Vector3(sin(_shake_t * 23.0), cos(_shake_t * 19.0), sin(_shake_t * 17.0)) * 0.012 * amp
		if not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
			_look = _look.lerp(Vector2.ZERO, minf(1.0, dt * 5.0))
		cam.rotation = Vector3(sin(_shake_t * 21.0), sin(_shake_t * 17.0 + 1.1), sin(_shake_t * 13.0 + 2.3)) * 0.006 * amp
		cam.basis = Basis(Vector3.UP, _look.x) * Basis(Vector3.RIGHT, _look.y) * cam.basis
	var rum := -80.0
	if piloted:
		rum = -10.0 - (1.0 - _thrust.length()) * 10.0
		if launching:
			rum = lerpf(-5.0, 3.0, clampf(_lift_t / 0.9, 0.0, 1.0))
		elif _shake > 0.3:
			rum = -4.0
	_rumble.volume_db = lerpf(_rumble.volume_db, rum, minf(1.0, dt * 6.0))
	_rumble.pitch_scale = 0.52 if launching else 0.8 + _thrust.length() * 0.5
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

## The hatch: a plate in her belly behind the seat, hinged at its back
## edge, that swings down into a ramp with rungs on it; a warm light in the
## well above it while it is open.
const HATCH_HINGE := Vector3(0.0, -0.5, -1.0)
const HATCH_LEN := 1.6
const HATCH_ANGLE := 58.0

func _hatch_make() -> void:
	_hatch = Node3D.new()
	_hatch.name = "hatch"
	_hatch.position = HATCH_HINGE
	add_child(_hatch)
	var plate := MeshInstance3D.new()
	var bx := BoxMesh.new()
	bx.size = Vector3(1.04, 0.07, HATCH_LEN)
	plate.mesh = bx
	plate.material_override = Surfaces.get_material("paint_dark")
	plate.position = Vector3(0.0, 0.0, -HATCH_LEN * 0.5)
	_hatch.add_child(plate)
	# Rails and rungs on its inner face, which is the ramp's top when down.
	var metal := Surfaces.get_material("metal")
	for x in [-0.46, 0.46]:
		var rail := MeshInstance3D.new()
		var rb := BoxMesh.new()
		rb.size = Vector3(0.06, 0.08, HATCH_LEN - 0.1)
		rail.mesh = rb
		rail.material_override = metal
		rail.position = Vector3(x, 0.07, -HATCH_LEN * 0.5)
		_hatch.add_child(rail)
	for k in 5:
		var rung := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.022
		cm.bottom_radius = 0.022
		cm.height = 0.86
		cm.radial_segments = 8
		rung.mesh = cm
		rung.material_override = metal
		rung.rotation_degrees = Vector3(0, 0, 90)
		rung.position = Vector3(0.0, 0.09, -0.2 - k * 0.3)
		_hatch.add_child(rung)
	# The well it opens: dark round the edge, lit warm from inside.
	var well := MeshInstance3D.new()
	var wq := BoxMesh.new()
	wq.size = Vector3(1.0, 0.02, HATCH_LEN - 0.04)
	well.mesh = wq
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color(0.08, 0.06, 0.05)
	wm.emission_enabled = true
	wm.emission = Color(1.0, 0.62, 0.32)
	wm.emission_energy_multiplier = 0.9
	well.material_override = wm
	well.position = HATCH_HINGE + Vector3(0.0, 0.03, -HATCH_LEN * 0.5)
	well.visible = false
	well.name = "hatch_well"
	add_child(well)
	var lamp := OmniLight3D.new()
	lamp.name = "hatch_lamp"
	lamp.light_color = Color(1.0, 0.68, 0.38)
	lamp.light_energy = 0.0
	lamp.omni_range = 3.2
	lamp.shadow_enabled = false
	lamp.position = HATCH_HINGE + Vector3(0.0, -0.25, -0.8)
	add_child(lamp)

## Swing the hatch to `k` (0 shut, 1 a ramp) over `secs`.
func _hatch_to(k: float, secs: float) -> void:
	var from := _hatch_open
	var t := create_tween()
	t.tween_method(_hatch_pose, from, k, secs).set_trans(Tween.TRANS_SINE)
	if k > from:
		Sfx.play("door", -9.0, 0.7)
	await t.finished
	if k < from:
		Sfx.play("hit", -16.0, 1.4)

func _hatch_pose(k: float) -> void:
	_hatch_open = k
	if _hatch:
		_hatch.rotation.x = -deg_to_rad(HATCH_ANGLE) * k
	var well := get_node_or_null("hatch_well") as MeshInstance3D
	if well:
		well.visible = k > 0.02
	var lamp := get_node_or_null("hatch_lamp") as OmniLight3D
	if lamp:
		lamp.light_energy = 1.4 * k

## Where the ramp meets the ground, in her space, and a standing eye there
## looking up it.
func _ramp_foot() -> Vector3:
	var a := deg_to_rad(HATCH_ANGLE)
	return HATCH_HINGE + Vector3(0.0, -sin(a) * HATCH_LEN, -cos(a) * HATCH_LEN)

## Climb in: the hatch swings down, the explorer walks to its foot and up
## it into the well, and comes up behind the seat as it closes.
func board() -> void:
	if piloted or _moving or not explorer:
		return
	if not Lore.known("hearth_codes"):
		var r := get_tree().get_first_node_in_group("reach_root")
		if r:
			r.hud.caption("The hatch is locked. Okafor has the launch codes, at the observatory.", 3.5)
		Sfx.play("beep", -8.0, 0.7)
		return
	_moving = true
	explorer.enabled = false
	var from := explorer.camera.global_transform
	var up := global_basis.y.normalized()
	var xf := global_transform
	var hinge := xf * HATCH_HINGE
	# Under her, looking up the ramp; in the well, facing the ladder; at the
	# top, facing the back wall (the log's terminal, the shelf, the lamp);
	# then round and down into the seat.
	var foot := xf * (_ramp_foot() + Vector3(0.0, 1.62, -0.7))
	var at_foot := Transform3D(Basis.looking_at(hinge - foot, up), foot)
	var low := xf * Vector3(0.0, -0.15, -1.75)
	var at_low := Transform3D(Basis.looking_at(xf.basis * Vector3(0.0, 0.55, 1.0), up), low)
	var high := xf * Vector3(0.0, 1.25, -1.7)
	var at_high := Transform3D(Basis.looking_at(xf.basis * Vector3(0.0, -0.25, 1.0), up), high)
	var seat := xf * Transform3D(Basis(), EYE)
	cam.global_transform = from
	cam.make_current()
	var face := Transform3D(Basis.looking_at(hinge - from.origin, up), from.origin)
	var t := create_tween()
	t.tween_method(func(k: float): cam.global_transform = from.interpolate_with(face, k), 0.0, 1.0, 0.45).set_trans(Tween.TRANS_SINE)
	_hatch_to(1.0, 0.8)
	await t.finished
	Sfx.play("step", -12.0, 0.9)
	t = create_tween()
	t.tween_method(func(k: float): cam.global_transform = face.interpolate_with(at_foot, k), 0.0, 1.0, 0.8).set_trans(Tween.TRANS_SINE)
	t.tween_callback(func():
		Sfx.play("step", -10.0, 0.8)
		cockpit.visible = true)
	t.tween_method(func(k: float): cam.global_transform = at_foot.interpolate_with(at_low, k), 0.0, 1.0, 0.6).set_trans(Tween.TRANS_SINE)
	t.tween_callback(func(): Sfx.play("step", -11.0, 1.1))
	t.tween_method(func(k: float): cam.global_transform = at_low.interpolate_with(at_high, k), 0.0, 1.0, 0.85).set_trans(Tween.TRANS_SINE)
	t.tween_callback(func(): _hatch_to(0.0, 0.6))
	t.tween_interval(0.25)
	t.tween_method(func(k: float): cam.global_transform = at_high.interpolate_with(seat, k), 0.0, 1.0, 0.95).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	await t.finished
	cockpit.visible = true
	cam.position = EYE
	cam.rotation = Vector3.ZERO
	_seat = Vector3.ZERO
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

## Out of the seat, back past the log's terminal, down the ladder and the
## ramp, and out onto the ground under her.
func leave() -> void:
	if not piloted or _moving:
		return
	_moving = true
	piloted = false
	autopilot = false
	_look = Vector2.ZERO
	var down := system.gravity(global_position).normalized()
	var up := -down if down.length() > 0.5 else global_basis.y
	var xf := global_transform
	var seat := xf * Transform3D(Basis(), EYE)
	var high := xf * Vector3(0.0, 1.25, -1.7)
	var at_high := Transform3D(Basis.looking_at(xf.basis * Vector3(0.0, -0.6, 1.0), up), high)
	var low := xf * Vector3(0.0, -0.15, -1.75)
	var at_low := Transform3D(Basis.looking_at(xf.basis * Vector3(0.0, -0.5, -1.0), up), low)
	var foot := xf * (_ramp_foot() + Vector3(0.0, 0.0, -1.5))
	var away := xf.basis * Vector3(0.0, 0.0, -1.0)
	away = (away - up * away.dot(up)).normalized()
	var stand_eye := foot + up * 1.62
	var at_out := Transform3D(Basis.looking_at(away, up), stand_eye)
	cam.make_current()
	cam.global_transform = seat
	_hatch_to(1.0, 0.8)
	var t := create_tween()
	t.tween_method(func(k: float): cam.global_transform = seat.interpolate_with(at_high, k), 0.0, 1.0, 0.8).set_trans(Tween.TRANS_SINE)
	t.tween_callback(func(): Sfx.play("step", -11.0, 1.1))
	t.tween_method(func(k: float): cam.global_transform = at_high.interpolate_with(at_low, k), 0.0, 1.0, 0.7).set_trans(Tween.TRANS_SINE)
	t.tween_callback(func():
		Sfx.play("step", -10.0, 0.8)
		cockpit.visible = false)
	t.tween_method(func(k: float): cam.global_transform = at_low.interpolate_with(at_out, k), 0.0, 1.0, 0.8).set_trans(Tween.TRANS_SINE)
	await t.finished
	cockpit.visible = false
	if _canopy:
		_canopy.visible = true
	if _canopy_frame:
		_canopy_frame.visible = true
	explorer.process_mode = Node.PROCESS_MODE_INHERIT
	explorer.visible = true
	explorer.add_to_group("reach_dynamic")
	explorer.place(Transform3D(_upright(up), foot + up * 0.05), away)
	explorer.camera.make_current()
	system.focus = explorer
	_moving = false
	_hatch_to(0.0, 0.7)
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
	_knock = 0.0
	autopilot = false
	assist = true
	_acc = Vector3.ZERO
	_stick = Vector2.ZERO
	_danger = 0.0
	_ride_ready = true
	_lit = false
	_auto_lift = 0.0
	_gear_k = 1.0
	if _legs.size() > 0:
		_gear_pose()
	_hatch_pose(0.0)
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
