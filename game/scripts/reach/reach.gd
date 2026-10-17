class_name Reach
extends Node3D
## The Reach, the game: the system, its bodies drawn, the Lantern, the sky
## and the light. The player, the ship, the loop and the tools hang off
## this (see the other scripts in scripts/reach).
##
## For checks: `-- --view <body>` puts a camera 4 radii off a body, sun
## behind; `--view <body>/surface` stands it at a body's first landmark.

var system: ReachSystem
var planets := {}
var lantern: Lantern
var sun: DirectionalLight3D
var env: Environment
var _view_cam: Camera3D
var player: Explorer
var ship: ReachShip
var hud: ReachHud
var loop: ReachLoop
var campfire: Campfire
var talking := false
var _log: ShipLog

func _ready() -> void:
	add_to_group("reach_root")
	system = ReachSystem.new()
	add_child(system)
	for key in system.order:
		var b: ReachBody = system.bodies[key]
		if key == "lantern":
			lantern = Lantern.new()
			b.node.add_child(lantern)
			continue
		var p := Planet.make(b)
		b.node.add_child(p)
		planets[key] = p
	_environment()
	system.frame_changed.connect(_on_frame)
	var args := OS.get_cmdline_user_args()
	var i := args.find("--view")
	if i >= 0 and i + 1 < args.size():
		_view(args[i + 1])
		return
	if Flow.beat.begins_with("view:"):
		# From a browser link: #reach/view:hearthstone or view:hearthstone:surface.
		_view(Flow.beat.trim_prefix("view:").replace(":", "/"))
		Flow.beat = ""
		return
	_start_player()
	if "--reachwalk" in args:
		_walk_test()
	if "--reachfly" in args:
		_fly_test()
	var tt := args.find("--talktest")
	if tt >= 0 and tt + 1 < args.size():
		_talk_test(args[tt + 1])

func _environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/reach/sky.gdshader")
	sky.sky_material = sm
	sky.process_mode = Sky.PROCESS_MODE_QUALITY if Flow.high_quality() else Sky.PROCESS_MODE_INCREMENTAL
	sky.radiance_size = Sky.RADIANCE_SIZE_64
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.5, 0.55, 0.7)
	env.ambient_light_energy = 0.18
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.0 if Flow.high_quality() else 0.85
	env.glow_enabled = true
	env.glow_intensity = 0.8
	env.glow_bloom = 0.05
	env.glow_hdr_threshold = 1.1
	env.fog_enabled = false
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.93, 0.82)
	sun.light_energy = 1.6
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 220.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	add_child(sun)

func _on_frame(from: String, to: String) -> void:
	if planets.has(from):
		(planets[from] as Planet).set_ref(false)
	if planets.has(to):
		(planets[to] as Planet).set_ref(true)

func _process(_dt: float) -> void:
	var star := system.world("lantern")
	var cam := get_viewport().get_camera_3d()
	# Sunlight along the line from the Lantern to the frame's body (or to
	# the camera, out in the open).
	var target := Vector3.ZERO if system.ref != "lantern" else (cam.global_position if cam else Vector3.ZERO)
	var dir := (target - star).normalized()
	if dir.length() > 0.5:
		sun.global_basis = Basis.looking_at(dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT)
	var power := lantern.power if lantern else 1.0
	sun.light_energy = 1.6 * power
	for key in planets:
		(planets[key] as Planet).light(star, power)
	_air(cam)

## Inside a body's air: haze for distance, the sky's light for ambient.
func _air(cam: Camera3D) -> void:
	if not cam:
		return
	var b := system.ruling()
	if b.atmo <= 0.0:
		env.fog_enabled = false
		env.ambient_light_color = Color(0.4, 0.45, 0.6)
		env.ambient_light_energy = 0.12
		return
	var up := cam.global_position.normalized()
	var alt := cam.global_position.length() - b.radius
	var sun_up := up.dot((system.world("lantern") - cam.global_position).normalized())
	var thick := 1.0 - smoothstep(0.0, b.atmo - b.radius, alt)
	var day := smoothstep(-0.15, 0.25, sun_up)
	var tint := b.sky_dusk.lerp(b.sky_day, smoothstep(0.0, 0.4, sun_up))
	env.fog_enabled = thick > 0.01
	env.fog_light_color = Color(tint.r, tint.g, tint.b).lerp(Color(0.04, 0.05, 0.08), 1.0 - day) * 0.9
	env.fog_density = 0.0006 * thick
	env.fog_sky_affect = 0.0
	env.ambient_light_color = Color(tint.r, tint.g, tint.b).lerp(Color(0.25, 0.3, 0.45), 1.0 - day)
	env.ambient_light_energy = lerpf(0.1, 0.45, day) * lerpf(0.4, 1.0, thick)

func _start_player() -> void:
	hud = ReachHud.new()
	hud.reach = self
	add_child(hud)
	loop = ReachLoop.new()
	loop.reach = self
	add_child(loop)
	player = Explorer.new()
	player.system = system
	add_child(player)
	player.died.connect(loop.die)
	ship = ReachShip.new()
	ship.system = system
	ship.explorer = player
	add_child(ship)
	ship.destroyed.connect(loop.die)
	system.frame_changed.connect(func(_a, _b): ship.anchor_check())
	var home: ReachBody = system.bodies["hearthstone"]
	campfire = Campfire.new()
	home.node.add_child(campfire)
	campfire.transform = Worlds.place(home, "village")
	home.node.add_child(Village.make(home))
	var args := OS.get_cmdline_user_args()
	loop.woke.connect(_on_woke)
	reset_loop()
	if not ("--reachwalk" in args or "--reachfly" in args):
		loop.wake("")

func _on_woke(n: int, _first: bool) -> void:
	if n > 1 and Lore.learn("hearth_loop"):
		hud.toast("SHIP LOG UPDATED")

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo and e.keycode == KEY_L and not talking and not _log and player:
		_log = ShipLog.open(self)
		_log.closed.connect(func(): _log = null)
		get_viewport().set_input_as_handled()

## Everything back to the morning: the clock, the frame, the Kestrel on her
## pad, the player by the fire.
func reset_loop() -> void:
	var was := system.ref
	system.reset("hearthstone")
	Talk.this_loop.clear()
	for key in planets:
		(planets[key] as Planet).set_ref(key == "hearthstone")
	var home: ReachBody = system.bodies["hearthstone"]
	var pad := Worlds.place(home, "pad")
	ship.reset_to(Transform3D(pad.basis, pad.origin + pad.basis.y * 1.95))
	var fire := Worlds.place(home, "village")
	var at := fire.origin + fire.basis.x * 2.4 + fire.basis.y * 0.3
	player.place(Transform3D(fire.basis, at), -fire.basis.x)
	system.focus = player
	player.camera.make_current()
	if was != "hearthstone":
		for key in system.order:
			(system.bodies[key] as ReachBody).node.reset_physics_interpolation()

func _physics_process(_dt: float) -> void:
	if not loop or loop.ending or not system.focus:
		return
	# Too close to the Lantern: nothing survives that.
	if system.focus.global_position.distance_to(system.world("lantern")) < ReachSystem.STAR_RADIUS * 1.04:
		loop.die("lantern")

# --- For checks --------------------------------------------------------------

## Board, lift off, fly out of Hearthstone's sphere into the Lantern's
## frame, and check the ship's place in the Reach is continuous across the
## switch (the frame moves, the ship must not).
func _fly_test() -> void:
	await get_tree().create_timer(2.0).timeout
	var rested := ship.landed
	ship.board()
	await get_tree().create_timer(2.0).timeout
	# (A dictionary: lambdas capture locals by value.)
	var st := {"before": Vector3.ZERO, "vbefore": Vector3.ZERO, "jump": -1.0, "vjump": -1.0, "switched": false}
	system.frame_will_change.connect(func(from, _to):
		st.before = ship.global_position + system.helio(from)
		st.vbefore = ship.linear_velocity + system.helio_vel(from))
	system.frame_changed.connect(func(_a, to):
		st.switched = true
		st.jump = (ship.global_position + system.helio(to)).distance_to(st.before)
		st.vjump = (ship.linear_velocity + system.helio_vel(to)).distance_to(st.vbefore))
	Input.action_press("jump")
	var t := 0.0
	var space_down := true
	while t < 50.0 and not st.switched:
		await get_tree().physics_frame
		t += get_physics_process_delta_time()
		# Up off the pad, then turn the nose up and burn.
		if t > 4.0 and space_down:
			space_down = false
		var up := ship.global_position.normalized()
		var fwd := -ship.global_basis.z
		var err := fwd.cross(up)
		ship.angular_velocity = err * 2.0 if t > 3.0 else Vector3.ZERO
		ship.apply_central_force((up * 12.0 if t < 3.0 else fwd * ReachShip.MAIN) * ship.mass)
	Input.action_release("jump")
	Report.line("REACHFLY rested on the pad %s, left Hearthstone %s after %.0f s, frame now %s, jump at switch %.4f m %.4f m/s, hull %d" % [rested, st.switched, t, system.ref, st.jump, st.vjump, int(ship.integrity)])
	Report.finish(get_tree())

## Talk to someone in the village, every line and the first choice each
## time, and report what was learned.
func _talk_test(key: String) -> void:
	Lore.forget_all()
	await get_tree().create_timer(1.5).timeout
	player.enabled = true
	var npc: Npc = null
	for n in get_tree().get_nodes_in_group("reach_root")[0].find_children("Npc_" + key, "Npc", true, false):
		npc = n
	if not npc:
		Report.line("TALKTEST no one called %s" % key)
		Report.finish(get_tree())
		return
	npc.usable.use(player)
	while not talking:
		await get_tree().process_frame
	while talking:
		await get_tree().process_frame
	Report.line("TALKTEST %s learned %s, player enabled %s" % [key, Lore._facts(), player.enabled])
	Report.finish(get_tree())

## Walk the player in a straight line round Hearthstone and report: how far,
## the lowest it got below the surface (it must never fall through), and
## whether it is still standing on something.
func _walk_test() -> void:
	await get_tree().create_timer(1.5).timeout
	var lowest := INF
	var walked := 0.0
	var last := player.global_position
	var t := 0.0
	Input.action_press("forward")
	while t < 40.0:
		await get_tree().physics_frame
		t += get_physics_process_delta_time()
		walked += last.distance_to(player.global_position)
		last = player.global_position
		var d := player.global_position.normalized()
		var hb: ReachBody = system.bodies["hearthstone"]
		var ground := hb.radius + Worlds.height("hearthstone", d, hb.radius)
		lowest = minf(lowest, player.global_position.length() - ground)
	Input.action_release("forward")
	Report.line("REACHWALK walked %.0f m, lowest %.2f m above ground, on floor %s, health %d, dead %s" % [walked, lowest, player.is_on_floor(), int(player.health), player._dead])
	Report.finish(get_tree())

# --- For checks --------------------------------------------------------------

func _view(what: String) -> void:
	var parts := what.split("/")
	var key := parts[0]
	_view_cam = Camera3D.new()
	_view_cam.far = 60000.0
	_view_cam.near = 0.1
	_view_cam.fov = 60.0
	add_child(_view_cam)
	_view_cam.make_current()
	set_meta("view", parts)
	system.focus = _view_cam
	_place_view.call_deferred()

func _place_view() -> void:
	var parts: PackedStringArray = get_meta("view")
	var key := parts[0]
	var b: ReachBody = system.bodies[key]
	system.switch(key)
	system.place()
	if parts.size() > 1 and parts[1] == "surface":
		var marks := Worlds.landmarks(key)
		var name: String = marks.keys()[0]
		var xf := Worlds.place(b, name)
		var at := xf.origin + xf.basis.y * 1.7 + xf.basis.z * 30.0
		_view_cam.global_position = at
		_view_cam.look_at(xf.origin + xf.basis.y * 6.0, xf.basis.y)
	else:
		var star := system.world("lantern")
		var away := (Vector3.ZERO - star).normalized()
		var side := away.cross(Vector3.UP).normalized()
		_view_cam.global_position = (away * 0.6 + side * 0.8 + Vector3.UP * 0.35).normalized() * b.radius * 4.0
		_view_cam.look_at(Vector3.ZERO, Vector3.UP)
