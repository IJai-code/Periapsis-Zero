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
var scope: Signalscope
var _log: ShipLog
var _music: AudioStreamPlayer
var quantum: QuantumMoon
var memories: Memories
var fold: Fold
## The Choir core, carried this loop (from Ashfall's vault).
var carrying_core := false
var _core_vis: Node3D
var _map: ReachMap
var finished := false

func _ready() -> void:
	add_to_group("reach_root")
	system = ReachSystem.new()
	add_child(system)
	for key in system.order:
		var b: ReachBody = system.bodies[key]
		if key == "lantern":
			lantern = Lantern.new()
			b.node.add_child(lantern)
			fold = Fold.new()
			b.node.add_child(fold)
			continue
		var p := Planet.make(b)
		b.node.add_child(p)
		planets[key] = p
	_environment()
	_build_sites()
	system.frame_changed.connect(_on_frame)
	var args := OS.get_cmdline_user_args()
	if has_meta("backdrop"):
		_backdrop()
		return
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
	if "--maptest" in args:
		_map_test()
	if "--logtest" in args:
		_log_test()
	if "--firetest" in args:
		_fire_test()
	if "--walltest" in args:
		_wall_test()
	if "--lifttest" in args:
		_lift_test()
	if "--jumptest" in args:
		_jump_test()
	if "--reachwalk" in args:
		_walk_test()
	if "--reachfly" in args:
		_fly_test()
	if "--storytest" in args:
		_story_test()
	var tt := args.find("--talktest")
	if tt >= 0 and tt + 1 < args.size():
		_talk_test(args[tt + 1])

## Whether this run is a check rather than a playthrough. Checks drive the
## camera and the player themselves, so the morning cinematic is skipped.
static func _testing(args: PackedStringArray) -> bool:
	for a in args:
		if a in ["--reachwalk", "--reachfly", "--maptest", "--storytest", "--talktest", "--logtest", "--firetest", "--walltest", "--lifttest", "--jumptest"]:
			return true
	return false

## What to do next, until you are off the ground: Mara, Okafor's codes, the
## lift, the sky. After that the Reach is yours, and nothing is said.
func _next_goal() -> String:
	if not player or not ship or loop.ending:
		return ""
	if system.ref != "hearthstone" or (ship.piloted and ship.global_position.length() > 420.0):
		_launched = true
	if _launched:
		return ""
	if not Lore.known("hearth_codes"):
		if not Talk.this_loop.has("mara") and not Lore.known("hearth_crash"):
			return "Talk to Mara, by the fire"
		return "Get the launch codes from Okafor, in the observatory"
	if ship.piloted:
		return "Take off: hold Space to rise, then W" if ship.landed else "Climb: up and out of the air"
	var village: Village = (planets["hearthstone"] as Planet).sites[0]
	if village.lift.at_top():
		return "Board the Kestrel"
	return "Ride the lift up the launch tower to the Kestrel"

## The places on each world (Site), the campfire.
func _build_sites() -> void:
	var home: ReachBody = system.bodies["hearthstone"]
	campfire = Campfire.new()
	home.node.add_child(campfire)
	campfire.transform = Worlds.place(home, "village")
	(planets["hearthstone"] as Planet).add_site(Village.make(home))
	(planets["verdance"] as Planet).add_site(VerdanceSite.make(system.bodies["verdance"]))
	(planets["ashfall"] as Planet).add_site(AshfallSite.make(system.bodies["ashfall"]))
	(planets["phantom"] as Planet).add_site(PhantomSite.make(system.bodies["phantom"]))
	(planets["wanderer"] as Planet).add_site(WandererSite.make(system.bodies["wanderer"]))
	# Small life on every world: fireflies over Hearth, ash on Ashfall, pollen
	# on Verdance, dust out on the cold ones.
	for key in planets:
		Ambience.attach(planets[key] as Planet, key)

## Static caches hold resources; let them go with the scene, or the
## engine reports them as leaked at exit.
func _exit_tree() -> void:
	Grass.clear_cache()
	Valley.clear_cache()
	Props._cache.clear()
	Worlds._noise.clear()

func _environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/reach/sky.gdshader")
	sm.set_shader_parameter("panorama", load("res://art/sky/space-hearth.jpg"))
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
	env.glow_intensity = 0.85
	env.glow_bloom = 0.06
	env.glow_hdr_threshold = 1.05
	# Contact shadow where a cabin meets the grass, a rock meets the ground:
	# what the flat ambient light could not say before.
	if Flow.high_quality():
		env.ssao_enabled = true
		env.ssao_radius = 1.6
		env.ssao_intensity = 2.1
		env.ssao_power = 1.6
		env.ssao_detail = 0.6
	# A touch of grade: a warmer, slightly deeper picture than the raw tonemap.
	env.adjustment_enabled = true
	env.adjustment_brightness = 1.02
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.06
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
	sun.directional_shadow_blend_splits = true
	sun.shadow_normal_bias = 1.4
	add_child(sun)

var _arrived := {}
## Off Hearthstone at least once this loop (the first steps are done).
var _launched := false
var _goal_t := 0.0
const PLACE_WORDS := {"verdance": "the jungle world", "ashfall": "where the Aster fell", "phantom": "the moon that moves",
	"wanderer": "the comet", "hearthstone": "home"}

func _on_frame(from: String, to: String) -> void:
	if planets.has(from):
		(planets[from] as Planet).set_ref(false)
	if planets.has(to):
		(planets[to] as Planet).set_ref(true)
		# A world's name, the first time you reach it in a loop.
		if hud and not _arrived.has(to) and loop and not loop.ending:
			_arrived[to] = true
			hud.place((system.bodies[to] as ReachBody).title, PLACE_WORDS.get(to, ""))
			if memories:
				memories.later(3.0)

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
	# Below the horizon where you stand, the Lantern lights nothing near you
	# (else it would shine up through the world onto cabins and faces).
	var lit := 1.0
	if cam and system.ref != "lantern":
		var up := (cam.global_position - system.ruling().node.position).normalized()
		lit = smoothstep(-0.1, 0.06, up.dot(-dir))
	sun.light_energy = 1.6 * power * lit
	sun.visible = lit > 0.001
	for key in planets:
		(planets[key] as Planet).light(star, power)
	_air(cam)
	_carry()
	_goal_t -= _dt
	if hud and _goal_t <= 0.0:
		_goal_t = 0.5
		hud.goal(_next_goal())
	if _drift:
		_drift_t += _dt
		_place_drift()

## Inside a body's air: haze for distance, the sky's light for ambient.
func _air(cam: Camera3D) -> void:
	if not cam:
		return
	var b := system.ruling()
	if b.atmo <= 0.0:
		# No air: starlight and the Lantern's glow off the dust, just
		# enough to find your feet on the night side.
		env.fog_enabled = false
		env.ambient_light_color = Color(0.42, 0.47, 0.62)
		env.ambient_light_energy = 0.24
		# Inside the Fold: its light all round, thickening toward its heart.
		var deep := fold.depth(cam.global_position) if fold else 0.0
		if deep > 0.0:
			env.fog_enabled = true
			env.fog_light_color = Color(0.32, 0.5, 0.6).lerp(Color(0.6, 0.35, 0.55), 0.5 + 0.5 * sin(cam.global_position.x * 0.0011))
			env.fog_light_energy = 1.0
			env.fog_density = 0.00035 * deep
			env.fog_sky_affect = 0.6 * deep
			env.ambient_light_color = Color(0.45, 0.6, 0.7)
			env.ambient_light_energy = 0.24 + 0.4 * deep
			if hud and deep > 0.15 and not _arrived.has("fold") and loop and not loop.ending:
				_arrived["fold"] = true
				hud.place("The Fold", "where the Reach opens")
				if memories:
					memories.later(2.0)
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
	system.frame_will_change.connect(func(from, _to): ship.frame_leaving(from))
	system.frame_changed.connect(func(_a, _b): ship.anchor_check())
	scope = Signalscope.new()
	scope.reach = self
	add_child(scope)
	_signals()
	_music = AudioStreamPlayer.new()
	add_child(_music)
	loop.collapsing.connect(func():
		_music.stream = load("res://audio/reach/end.wav")
		_music.volume_db = -4.0 + Flow.music_db()
		_music.play())
	quantum = QuantumMoon.new()
	quantum.reach = self
	add_child(quantum)
	memories = Memories.new()
	memories.reach = self
	add_child(memories)
	Flow.music(false)
	var args := OS.get_cmdline_user_args()
	loop.woke.connect(_on_woke)
	reset_loop()
	# The morning plays for a player. A check places the camera itself and
	# needs the world answering at once, so it starts already awake.
	if not _testing(args):
		loop.wake("")
	# For looking at things from a browser link, once awake: #reach/map,
	# #reach/songline:<id>, or #reach/at:<loop seconds>.
	var bi := args.find("--beat")
	if bi >= 0 and bi + 1 < args.size():
		Flow.beat = args[bi + 1]
	if Flow.beat != "":
		var beat := Flow.beat
		Flow.beat = ""
		await loop.woke
		if beat.begins_with("at:"):
			system.t = float(beat.trim_prefix("at:"))
		elif beat.begins_with("log:"):
			# The first n facts known, and the log open (for looking at it).
			var n := int(beat.trim_prefix("log:"))
			for id in Lore.FACTS.keys().slice(0, n):
				Lore.learn(id)
			_log = ShipLog.open(self)
			_log.closed.connect(func(): _log = null)
		elif beat == "cockpit":
			Lore.learn("hearth_codes")
			ship.board()
		elif beat == "map":
			_map = ReachMap.open(self)
			_map.closed.connect(func(): _map = null)
		elif beat.begins_with("talk:") and Lore.TALK.has(beat.trim_prefix("talk:")):
			talking = true
			player.enabled = false
			var tk := Talk.open(self, beat.trim_prefix("talk:"), null, hud)
			await tk.finished
			talking = false
			player.enabled = true
		elif beat.begins_with("songline:") and Lore.SONGLINES.has(beat.trim_prefix("songline:")):
			talking = true
			player.enabled = false
			var t := Translator.open(self, beat.trim_prefix("songline:"), hud)
			await t.finished
			talking = false
			player.enabled = true

## Every signal in the Reach (see Signalscope).
func _signals() -> void:
	var B := system.bodies
	var hs: ReachBody = B["hearthstone"]
	var fire := Worlds.place(hs, "village")
	scope.add_source(hs.node, "mara", "Mara's banjo", 0, load("res://audio/reach/banjo.wav"), fire.origin + fire.basis.y * 1.2, 14.0)
	var obs := Worlds.place(hs, "observatory")
	scope.add_source(hs.node, "okafor", "Okafor's flute", 0, load("res://audio/reach/flute.wav"), obs.origin + obs.basis.y * 2.0, 14.0)
	scope.add_source(hs.node, "choir_mine", "Songline: the old mine", 2, load("res://audio/reach/choir.wav"), Worlds.place(hs, "cave").origin, 10.0)
	var vd: ReachBody = B["verdance"]
	scope.add_source(vd.node, "renn", "A harmonica", 0, load("res://audio/reach/harmonica.wav"), Worlds.place(vd, "renn").origin + Worlds.place(vd, "renn").basis.y, 16.0)
	scope.add_source(vd.node, "pod", "Escape pod beacon", 1, ReachSounds.beacon(0.9), Worlds.place(vd, "pod").origin, 12.0)
	scope.add_source(vd.node, "choir_pillars", "Songline: the pillar city", 2, load("res://audio/reach/choir.wav"), Worlds.place(vd, "pillars").origin, 14.0)
	var ash: ReachBody = B["ashfall"]
	scope.add_source(ash.node, "vex", "Hand drums", 0, load("res://audio/reach/drums.wav"), Worlds.place(ash, "vex").origin, 14.0)
	var rec: Vector3 = ((planets["ashfall"] as Planet).sites[0] as AshfallSite).recorder_at
	scope.add_source(ash.node, "hale", "The Aster's bridge recorder", 1, ReachSounds.beacon(1.6), rec, 14.0)
	scope.add_source(ash.node, "drones", "Hollow drones", 3, ReachSounds.chatter(), Worlds.place(ash, "vault").origin, 16.0)
	var ph: ReachBody = B["phantom"]
	scope.add_source(ph.node, "phantom", "A wavering tone", 4, ReachSounds.quantum(), Vector3.ZERO, 30.0)
	scope.add_source(ph.node, "choir_shrine", "Songline: the Phantom's shrine", 2, load("res://audio/reach/choir.wav"), Worlds.place(ph, "shrine").origin, 10.0)
	var wa: ReachBody = B["wanderer"]
	scope.add_source(wa.node, "engine", "The Engine", 2, load("res://audio/reach/choir.wav"), Worlds.place(wa, "engine").origin, 20.0)

func _on_woke(n: int, _first: bool) -> void:
	if n > 1 and Lore.learn("hearth_loop"):
		hud.toast("SHIP LOG UPDATED")
	if n <= 2:
		hud.hint("E  talk, use, read        X  signalscope        M  map\nL  ship log        P  photograph        Esc  every key", 20.0)

func _unhandled_input(e: InputEvent) -> void:
	if not (e is InputEventKey and e.pressed and not e.echo) or talking or _log or not player or finished:
		return
	match (e as InputEventKey).keycode:
		KEY_L:
			_log = ShipLog.open(self)
			_log.closed.connect(func(): _log = null)
		KEY_M:
			if _map:
				_map.close()
			else:
				_map = ReachMap.open(self)
				_map.closed.connect(func(): _map = null)
		KEY_P:
			_photo()
		_:
			return
	get_viewport().set_input_as_handled()

## A photograph (P): the view as it is, kept in the corner of the visor.
## With the Phantom in it, the Phantom holds still (QuantumMoon).
func _photo() -> void:
	if loop.ending:
		return
	var holds := quantum.observed() and get_viewport().get_camera_3d().global_position.distance_to(quantum.body.node.global_position) < 9000.0
	Sfx.play("shutter", -4.0)
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.resize(int(img.get_width() * 180.0 / img.get_height()), 180, Image.INTERPOLATE_BILINEAR)
	var tex := ImageTexture.create_from_image(img)
	hud.show_photo(tex, holds)
	if memories:
		memories.add(tex)
	quantum.locked = holds

## The core taken from the vault: carried, glowing at the edge of the view,
## for the rest of this loop.
func take_core() -> void:
	carrying_core = true
	if not _core_vis:
		_core_vis = load("res://art/site-core.glb").instantiate()
		Surfaces.apply(_core_vis)
		_core_vis.scale = Vector3.ONE * 0.6
		var l := OmniLight3D.new()
		l.light_color = Color(0.6, 0.85, 1.0)
		l.light_energy = 0.6
		l.omni_range = 2.5
		_core_vis.add_child(l)
		for mi: MeshInstance3D in _core_vis.find_children("*", "MeshInstance3D", true, false):
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_core_vis.visible = true

func _carry() -> void:
	if not carrying_core or not _core_vis:
		return
	var cam := get_viewport().get_camera_3d()
	if cam and _core_vis.get_parent() != cam:
		if _core_vis.get_parent():
			_core_vis.get_parent().remove_child(_core_vis)
		cam.add_child(_core_vis)
		_core_vis.position = Vector3(0.3, -0.24, -0.62)
	_core_vis.rotation.y += get_process_delta_time() * 0.8

## The Engine has the core: the end (ReachEnding).
func finish(site: WandererSite) -> void:
	if finished:
		return
	finished = true
	loop.ending = true
	carrying_core = false
	player.enabled = false
	Flow.set_progress("reach_finished", true)
	# The core leaves your hands for the socket.
	if _core_vis:
		var at := _core_vis.global_transform
		_core_vis.get_parent().remove_child(_core_vis)
		site.add_child(_core_vis)
		_core_vis.global_transform = at
		var t := create_tween()
		t.tween_property(_core_vis, "transform", Transform3D(site.socket_at.basis, site.socket_at.origin), 2.0).set_trans(Tween.TRANS_SINE)
	Sfx.play("warp", -4.0, 0.6)
	if Lore.learn("wan_end"):
		hud.toast("SHIP LOG UPDATED")
	await get_tree().create_timer(1.5).timeout
	if _music:
		_music.stop()
	add_child(ReachEnding.new())

## Everything back to the morning: the clock, the frame, the Kestrel on her
## pad, the player by the fire.
func reset_loop() -> void:
	var was := system.ref
	_arrived = {"hearthstone": true}
	for r in get_tree().get_nodes_in_group("fire_rest"):
		(r as FireRest).leave(false)
	system.warp = 1.0
	if lantern:
		lantern.reset()
	system.reset("hearthstone")
	Talk.this_loop.clear()
	if scope:
		scope.active = false
		scope.resync.call_deferred()
	if _music:
		_music.stream = load("res://audio/reach/wake.wav")
		_music.volume_db = -6.0 + Flow.music_db()
		_music.play()
	# The places put back, the core in its vault, the Phantom loose.
	carrying_core = false
	if _core_vis:
		_core_vis.visible = false
	for key in planets:
		for site: Site in (planets[key] as Planet).sites:
			site.reset_loop()
	if quantum:
		quantum.reset()
	if hud:
		hud.show_photo(null)
	for key in planets:
		(planets[key] as Planet).set_ref(key == "hearthstone")
	var home: ReachBody = system.bodies["hearthstone"]
	# The Kestrel on the launch tower's deck, the lift at its foot.
	var village: Village = (planets["hearthstone"] as Planet).sites[0]
	ship.reset_to(village.ship_rest)
	village.lift.reset()
	_launched = false
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
	Lore.learn("hearth_codes")
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

## The whole chain, by teleport: the mine's songline, Hale's recorder, the
## vault (its code), the core, the Engine at 20:00, the end.
func _story_test() -> void:
	Lore.forget_all()
	await get_tree().create_timer(1.5).timeout
	var log := func(what: String): Report.line("STORY " + what)
	# Every songline written is somewhere in the Reach.
	var placed := {}
	for sl: Songline in find_children("*", "Songline", true, false):
		placed[sl.id] = true
	var missing := Lore.SONGLINES.keys().filter(func(k): return not placed.has(k))
	log.call("songlines placed %d of %d %s" % [placed.size(), Lore.SONGLINES.size(), missing])
	# The mine's songline, read through.
	var village: Village = (planets["hearthstone"] as Planet).sites[0]
	var mine: Songline = village.find_children("Songline_mine", "Songline", true, false)[0]
	_stand_before(mine.usable)
	await _use(mine.usable)
	log.call("songline mine read %s, learned %s" % [Lore.all_read("mine"), Lore.known("hearth_songline")])
	# To Ashfall: Hale's recorder.
	await _go("ashfall")
	var ash: AshfallSite = (planets["ashfall"] as Planet).sites[0]
	var rec: Usable = null
	for u: Usable in ash.find_children("*", "Usable", true, false):
		if u.prompt == "Play Hale's recorder":
			rec = u
	_stand_before(rec)
	await _use(rec)
	log.call("recorder learned %s" % Lore.known("ash_hale"))
	# The vault: the code, the door, the core.
	_stand_before(ash._keypad)
	await _use(ash._keypad)
	await get_tree().create_timer(2.6).timeout
	log.call("vault open %s" % (ash._door.position.x > 1.5))
	_stand_before(ash._core_use)
	await _use(ash._core_use)
	log.call("core carried %s, learned %s" % [carrying_core, Lore.known("ash_core")])
	# The Engine at 20:00, the door down, the socket.
	system.t = WandererSite.OPEN_FROM + 2.0
	await _go("wanderer")
	var wan: WandererSite = (planets["wanderer"] as Planet).sites[0]
	await get_tree().create_timer(3.5).timeout
	log.call("engine door open %s (t %.0f, open %.2f, door y %.2f, mode %d, ref %s)" % [wan._door.position.y < -3.5, system.t, wan._open, wan._door.position.y, wan.process_mode, system.ref])
	_stand_before(wan._socket)
	await _use(wan._socket)
	log.call("finished %s" % finished)
	if finished:
		await get_tree().create_timer(2.0).timeout
		var end: ReachEnding = find_children("*", "ReachEnding", false, false)[0]
		while not end._done:
			await get_tree().process_frame
	Report.finish(get_tree())

## Into a body's frame, standing at its first landmark.
func _go(key: String) -> void:
	system.switch(key)
	var b: ReachBody = system.bodies[key]
	var mark := Worlds.place(b, Worlds.landmarks(key).keys()[0])
	player.place(Transform3D(mark.basis, mark.origin + mark.basis.y * 30.0 + mark.basis.z * 18.0))
	await get_tree().physics_frame

## Stand the explorer a metre and a half in front of a usable thing, looking
## at it, on the ground there.
func _stand_before(u: Usable) -> void:
	var at := u.global_position
	var up := system.up_at(at)
	var out := (u.global_basis.z - up * u.global_basis.z.dot(up)).normalized()
	player.place(Transform3D(Site.upright(up, -out), at + out * 1.4 - up * 1.3), -out)

## Use a thing as the explorer would, and wait for what it opens to close.
func _use(u: Usable) -> void:
	u.use(player)
	await get_tree().process_frame
	while talking:
		await get_tree().process_frame
	await get_tree().create_timer(0.3).timeout

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

## Walk straight at every solid piece of the village (and the nearest trees
## and rocks) from 6 m away for 3 s; report any time the explorer's chest
## was inside something solid (it must never be).
func _wall_test() -> void:
	await get_tree().create_timer(1.5).timeout
	var village: Village = (planets["hearthstone"] as Planet).sites[0]
	var targets := []
	for n in village.get_children():
		if n is Node3D and not n is Npc and (n as Node3D).find_children("*", "CollisionShape3D", true, false).size() > 0:
			targets.append([String(n.name), (n as Node3D).global_position, (n as Node3D).global_basis.z])
	var pl: Planet = planets["hearthstone"]
	var near := pl._solids.duplicate()
	var here := village.center.origin
	near.sort_custom(func(a, b): return (a[1] as Transform3D).origin.distance_to(here) < (b[1] as Transform3D).origin.distance_to(here))
	var trunks := 0
	for item in near:
		if trunks >= 6:
			break
		if item[0] in ["pine", "rock"]:
			trunks += 1
			var xf: Transform3D = item[1]
			targets.append([String(item[0]), xf.origin, xf.basis.y.cross(Vector3.RIGHT).normalized()])
	var probe := SphereShape3D.new()
	probe.radius = 0.12
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = probe
	q.collision_mask = 1
	q.exclude = [player.get_rid()]
	var inside := []
	var space := get_world_3d().direct_space_state
	for t in targets:
		var at: Vector3 = t[1]
		var up := at.normalized()
		var out: Vector3 = t[2]
		out = (out - up * out.dot(up)).normalized()
		var start := at + out * 7.0
		var d := start.normalized()
		start = d * (system.ruling().radius + Worlds.height("hearthstone", d, system.ruling().radius) + 0.15)
		player.place(Transform3D(Site.upright(d, -out), start), -out)
		await get_tree().physics_frame
		Input.action_press("forward")
		var s := 0.0
		var hit := false
		while s < 3.0:
			await get_tree().physics_frame
			s += get_physics_process_delta_time()
			q.transform = Transform3D(Basis(), player.global_position + player.global_basis.y * 1.2)
			if not space.intersect_shape(q, 1).is_empty():
				hit = true
		Input.action_release("forward")
		if hit:
			inside.append(t[0])
	# The control: with the explorer's own collision off it walks into a
	# house, and the probe must notice (else the test proves nothing).
	var control := false
	for t in targets:
		if String(t[0]).begins_with("valley-house"):
			var at: Vector3 = t[1]
			var up := at.normalized()
			var out: Vector3 = t[2]
			out = (out - up * out.dot(up)).normalized()
			var start := at + out * 7.0
			var d := start.normalized()
			start = d * (system.ruling().radius + Worlds.height("hearthstone", d, system.ruling().radius) + 3.0)
			player.collision_mask = 0
			player.place(Transform3D(Site.upright(d, -out), start), -out)
			Input.action_press("forward")
			var s2 := 0.0
			while s2 < 3.0:
				await get_tree().physics_frame
				s2 += get_physics_process_delta_time()
				q.transform = Transform3D(Basis(), player.global_position + player.global_basis.y * 1.2)
				if not space.intersect_shape(q, 1).is_empty():
					control = true
			Input.action_release("forward")
			player.collision_mask = 1
			break
	Report.line("WALLTEST tried %d inside %d %s control %s" % [targets.size(), inside.size(), inside, control])
	Report.finish(get_tree())

## A tapped jump, a jump charged a full second, and the jetpack fired in
## the air after one: report each apex above the ground.
func _jump_test() -> void:
	await get_tree().create_timer(1.5).timeout
	var key := func(code: Key, down: bool):
		var k := InputEventKey.new()
		k.keycode = code
		k.physical_keycode = code
		k.pressed = down
		Input.parse_input_event(k)
	var apex := func() -> float:
		var base := player.global_position.length()
		var best := 0.0
		var t := 0.0
		while t < 4.0:
			await get_tree().physics_frame
			t += get_physics_process_delta_time()
			best = maxf(best, player.global_position.length() - base)
			if t > 0.4 and player.is_on_floor():
				break
		return best
	var results := []
	for hold in [0.05, 1.0]:
		key.call(KEY_SPACE, true)
		await get_tree().create_timer(hold).timeout
		key.call(KEY_SPACE, false)
		results.append(await apex.call())
		await get_tree().create_timer(0.6).timeout
	# The jetpack: a tap jump, then Space held again in the air.
	var fuel0 := player.fuel
	key.call(KEY_SPACE, true)
	await get_tree().create_timer(0.05).timeout
	key.call(KEY_SPACE, false)
	await get_tree().create_timer(0.3).timeout
	key.call(KEY_SPACE, true)
	var base := player.global_position.length()
	var best := 0.0
	var t2 := 0.0
	while t2 < 1.5:
		await get_tree().physics_frame
		t2 += get_physics_process_delta_time()
		best = maxf(best, player.global_position.length() - base)
	key.call(KEY_SPACE, false)
	Report.line("JUMPTEST tap %.2f m charged %.2f m jetpack %.2f m fuel used %.0f" % [results[0], results[1], best, fuel0 - player.fuel])
	Report.finish(get_tree())

## Codes known: ride the lift up the tower, walk to the Kestrel, board her;
## report the height reached and whether she is flown.
func _lift_test() -> void:
	Lore.learn("hearth_codes")
	await get_tree().create_timer(1.5).timeout
	var village: Village = (planets["hearthstone"] as Planet).sites[0]
	var lift := village.lift
	var car_at := lift.car.global_position
	var up := car_at.normalized()
	var out := village.tower.global_basis.z
	out = (out - up * out.dot(up)).normalized()
	player.place(Transform3D(Site.upright(up, -out), car_at + out * 2.6 + up * 0.1), -out)
	await get_tree().create_timer(0.5).timeout
	var ground := player.global_position.length()
	lift._ride(player)
	while not lift.at_top() or lift._moving:
		await get_tree().physics_frame
	await get_tree().create_timer(0.5).timeout
	var risen := player.global_position.length() - ground
	# Walk to the Kestrel's side and board.
	var on_deck := player.is_on_floor()
	ship.board()
	await get_tree().create_timer(4.0).timeout
	Report.line("LIFTTEST risen %.1f m, on deck %s, piloted %s" % [risen, on_deck, ship.piloted])
	Report.finish(get_tree())

## Sit at Hearth's fire, roast a marshmallow, eat it, sleep a while, wake,
## stand, and report each.
func _fire_test() -> void:
	await get_tree().create_timer(1.5).timeout
	var key := func(code: Key, down: bool):
		var k := InputEventKey.new()
		k.keycode = code
		k.physical_keycode = code
		k.pressed = down
		Input.parse_input_event(k)
	FireRest.sit(campfire, player)
	await get_tree().process_frame
	var rest: FireRest = get_tree().get_first_node_in_group("fire_rest")
	if not rest:
		Report.line("FIRETEST no seat")
		Report.finish(get_tree())
		return
	await get_tree().create_timer(0.8).timeout
	key.call(KEY_E, true)
	await get_tree().create_timer(3.4).timeout
	key.call(KEY_E, false)
	await get_tree().create_timer(1.0).timeout
	var toast := rest._toast
	key.call(KEY_F, true)
	await get_tree().process_frame
	key.call(KEY_F, false)
	await get_tree().create_timer(0.3).timeout
	var eaten := rest._eaten
	var t0 := system.t
	key.call(KEY_Q, true)
	await get_tree().process_frame
	key.call(KEY_Q, false)
	await get_tree().create_timer(3.0).timeout
	var slept := system.t - t0
	key.call(KEY_W, true)
	await get_tree().process_frame
	key.call(KEY_W, false)
	await get_tree().create_timer(2.0).timeout
	var warp := system.warp
	key.call(KEY_SPACE, true)
	await get_tree().process_frame
	key.call(KEY_SPACE, false)
	await get_tree().create_timer(0.5).timeout
	Report.line("FIRETEST toast %.2f eaten %d slept %.0f s warp after %.0f stood %s talking %s" % [toast, eaten, slept, warp, player.enabled, talking])
	Report.finish(get_tree())

## Press L once awake and report whether the ship's log opened.
func _log_test() -> void:
	await get_tree().create_timer(2.0).timeout
	var k := InputEventKey.new()
	k.keycode = KEY_L
	k.physical_keycode = KEY_L
	k.pressed = true
	Input.parse_input_event(k)
	await get_tree().process_frame
	await get_tree().process_frame
	Report.line("LOGTEST open %s talking %s player %s" % [_log != null, talking, player != null])
	if _log:
		get_tree().paused = false
	Report.finish(get_tree())

## Open the map mid-air and report: how long the predicted fall is, how many
## sphere-of-influence crossings it marks, and which sphere holds the player.
func _map_test() -> void:
	await get_tree().create_timer(1.5).timeout
	var hb: ReachBody = system.bodies["hearthstone"]
	var mark := Worlds.place(hb, Worlds.landmarks("hearthstone").keys()[0])
	player.place(Transform3D(mark.basis, mark.origin + mark.basis.y * 500.0))
	await get_tree().physics_frame
	var m := ReachMap.open(self)
	ship.target = "wanderer"
	await get_tree().create_timer(1.5).timeout
	Report.line("MAPTEST path %d crossings %d inside '%s'" % [m._path.size(), m._crossings.size(), m._inside_now])
	# Outside Hearthstone's sphere, falling toward it: the fall must cross
	# the sphere and say so.
	player.place(Transform3D(mark.basis, mark.origin + mark.basis.y * 1450.0))
	await get_tree().physics_frame
	var hp: Vector3 = system.world("hearthstone")
	var inward: Vector3 = (hp - player.global_position).normalized()
	player.velocity = system.world_vel("hearthstone") + inward * 10.0
	await get_tree().create_timer(1.5).timeout
	var first := String(m._crossings[0][1]) if m._crossings.size() > 0 else "none"
	Report.line("MAPTEST far path %d crossings %d first '%s' inside '%s'" % [m._path.size(), m._crossings.size(), first, m._inside_now])
	var keys := []
	for a in m._approaches:
		keys.append(String(a[0]))
	Report.line("MAPTEST approaches %d [%s]" % [m._approaches.size(), ", ".join(keys)])
	m.close()
	Report.finish(get_tree())

## Walk the player in a straight line round Hearthstone and report: how far,
## the lowest it got below the surface (it must never fall through), and
## whether it is still standing on something.
func _walk_test() -> void:
	await get_tree().create_timer(1.5).timeout
	# Along the path from the fire toward the old mine.
	var hb0: ReachBody = system.bodies["hearthstone"]
	var cave := Worlds.place(hb0, "cave").origin
	var here := player.global_position
	var up0 := here.normalized()
	var toward := cave - here
	toward -= up0 * toward.dot(up0)
	player.place(Transform3D(Site.upright(up0, toward), here), toward)
	await get_tree().physics_frame
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

# --- The title's backdrop ---------------------------------------------------

var _drift: Camera3D
var _drift_t := 0.0

## Behind the title (title.gd): Hearth at midnight under the nebulae, the
## fire and the village's lamps, Mara's banjo and Okafor's flute, and a
## camera drifting slowly round the fire.
func _backdrop() -> void:
	system.t = 560.0
	system.running = false
	system.switch("hearthstone")
	system.place()
	_drift = Camera3D.new()
	_drift.fov = 56.0
	_drift.near = 0.1
	_drift.far = 60000.0
	_drift.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(_drift)
	_drift.make_current()
	system.focus = _drift
	for part in ["banjo", "flute"]:
		var p := AudioStreamPlayer.new()
		p.stream = load("res://audio/reach/%s.wav" % part)
		p.volume_db = -60.0
		add_child(p)
		p.play()
		create_tween().tween_property(p, "volume_db", -7.0 + Flow.music_db(), 4.0)
	_place_drift()

func _place_drift() -> void:
	var home: ReachBody = system.bodies["hearthstone"]
	var fire := Worlds.place(home, "village")
	var up := fire.basis.y
	var a := 2.3 + _drift_t * 0.012
	var at := fire.origin + (fire.basis.x * cos(a) + fire.basis.z * sin(a)) * 8.5 + up * (1.9 + sin(_drift_t * 0.07) * 0.25)
	_drift.global_position = at
	_drift.look_at(fire.origin + up * 4.2, up)
	# Turned a little left, so the fire sits right of the words.
	_drift.rotate(up, 0.3)

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
	if key == "fold":
		# view:fold (inside it, looking in) or view:fold:out (from afar).
		system.switch("lantern")
		system.place()
		var c := fold.global_position
		var from := c + Vector3(-0.35, 0.05, 0.3).normalized() * (Fold.RADIUS * (3.2 if parts.size() > 1 and parts[1] == "out" else 0.55))
		_view_cam.global_position = from
		_view_cam.look_at(c, Vector3.UP)
		return
	var b: ReachBody = system.bodies[key]
	# view:<body>:<landmark>:<metres>:<degrees>:<loop seconds>
	if parts.size() > 4:
		system.t = float(parts[4])
		system.running = false
	system.switch(key)
	system.place()
	if parts.size() > 1:
		# view:<body>:surface (its first landmark) or view:<body>:<landmark>,
		# then :top (from overhead), :<metres> away along the ground, and
		# :<degrees> round it.
		var marks := Worlds.landmarks(key)
		var name: String = marks.keys()[0] if parts[1] == "surface" else parts[1]
		var xf := Worlds.place(b, name)
		if parts.size() > 2 and parts[2] == "in":
			# Inside a building at the landmark: from near its door, looking in.
			var door := xf.origin + xf.basis.y * 2.2
			var to_c := (Worlds.place(b, "village").origin - xf.origin)
			to_c = (to_c - xf.basis.y * to_c.dot(xf.basis.y)).normalized()
			_view_cam.global_position = door + to_c * 6.0
			_view_cam.look_at(xf.origin + xf.basis.y * 1.6, xf.basis.y)
		elif parts.size() > 2 and parts[2] == "top":
			_view_cam.global_position = xf.origin + xf.basis.y * 75.0 + xf.basis.z * 20.0
			_view_cam.look_at(xf.origin, -xf.basis.z)
		else:
			var dist := float(parts[2]) if parts.size() > 2 else 30.0
			var turn := deg_to_rad(float(parts[3])) if parts.size() > 3 else 0.0
			var off := xf.basis.z.rotated(xf.basis.y, turn) * dist
			_view_cam.global_position = xf.origin + xf.basis.y * 1.7 + off
			_view_cam.look_at(xf.origin + xf.basis.y * 4.0, xf.basis.y)
	else:
		var star := system.world("lantern")
		var away := (Vector3.ZERO - star).normalized()
		var side := away.cross(Vector3.UP).normalized()
		_view_cam.global_position = (away * 0.6 + side * 0.8 + Vector3.UP * 0.35).normalized() * b.radius * 4.0
		_view_cam.look_at(Vector3.ZERO, Vector3.UP)
