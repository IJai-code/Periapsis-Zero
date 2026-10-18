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
var night: NightSky
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
	if "--count" in OS.get_cmdline_user_args():
		_count_soon()
	system.frame_changed.connect(_on_frame)
	var args := OS.get_cmdline_user_args()
	# The title's scene alone, for pictures: #reach/backdrop.
	if Flow.beat == "backdrop":
		Flow.beat = ""
		set_meta("backdrop", true)
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
	if "--launchtest" in args:
		_launch_test()
	if "--landtest" in args:
		_land_test()
	if "--reftest" in args:
		_ref_test()
	if "--swimtest" in args:
		_swim_test()
	if "--proftest" in args:
		_prof_test()
	if "--arrivetest" in args:
		_arrive_test()
	if "--walltestfly" in args:
		_fly_wall_test()
	var apt := args.find("--aptest")
	if apt >= 0 and apt + 1 < args.size():
		_autopilot_test(args[apt + 1])
	if "--skytest" in args:
		_sky_test()
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
		if a in ["--reachwalk", "--reachfly", "--maptest", "--storytest", "--talktest", "--logtest", "--firetest", "--walltest", "--lifttest", "--jumptest", "--launchtest", "--landtest", "--skytest", "--aptest", "--reftest", "--swimtest", "--walltestfly", "--proftest", "--arrivetest"]:
			return true
	return false

## What to do next, until you are off the ground: Mara, Okafor's codes, the
## lift, the sky. After that the Reach is yours, and nothing is said.
func _next_goal() -> String:
	if not player or not ship or loop.ending:
		return ""
	if system.ref != "hearthstone" or (ship.piloted and ship.global_position.length() > 420.0):
		_launched = true
	if _launched or (Lore.known("hearth_loop") and Lore.known("hearth_codes")):
		# Off the ground, or any morning after the first: the log's lead.
		return _lead()
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

## A few frames from the tower, behind the black of the morning, so every
## material the lift-off will show (the valley, the sky, the air of the
## other worlds, the dust on the deck) is compiled before it matters.
func _prewarm() -> void:
	var v: Village = (planets["hearthstone"] as Planet).sites[0]
	var xf := v.ship_rest
	var up := xf.basis.y.normalized()
	var fwd := xf.basis.z.normalized()
	var side := xf.basis.x.normalized()
	var fx := LaunchFx.make(self, xf.origin - up * 1.85, up, 0.3)
	var cam := Camera3D.new()
	cam.fov = 45.0
	cam.near = 0.1
	cam.far = 60000.0
	add_child(cam)
	cam.make_current()
	ship.rehearse(true)
	# The launch camera's own place, then the valley from the tower, then the
	# whole crater: what a lift-off can see, seen once, behind the black.
	var views := [
		[xf.origin + side * 30.0 + fwd * 3.0 + up * 10.0, xf.origin + up * 0.5, up],
		[xf.origin + up * 55.0 + side * 6.0, xf.origin + side * 160.0, up],
		[xf.origin + up * 150.0 - side * 80.0, xf.origin, fwd],
	]
	for view in views:
		cam.global_transform = Transform3D(Basis.looking_at((view[1] as Vector3) - (view[0] as Vector3), view[2] as Vector3), view[0] as Vector3)
		for i in 2:
			await get_tree().process_frame
	await _material_zoo(cam)
	for key in planets:
		(planets[key] as Planet).prepare()
	ship.rehearse(false)
	fx.queue_free()
	cam.queue_free()

## Every material on every world, drawn once on a fleck in front of the
## camera behind the black: a browser compiles a material the first time it
## draws it, and the first time should not be the moment a world comes into
## view at two hundred metres a second. Plain meshes and multimeshes draw
## through different shaders, so each is drawn the way it is used.
func _material_zoo(cam: Camera3D) -> void:
	var seen := {}
	var plain: Array[Material] = []
	var multi: Array[Material] = []
	var add := func(m: Material, many: bool) -> void:
		if m == null:
			return
		var k := "%d/%s" % [m.get_instance_id(), many]
		if seen.has(k):
			return
		seen[k] = true
		(multi if many else plain).append(m)
	for key in planets:
		var p: Planet = planets[key]
		for n in p.find_children("*", "GeometryInstance3D", true, false):
			var gi := n as GeometryInstance3D
			var many := gi is MultiMeshInstance3D
			add.call(gi.material_override, many)
			var mesh: Mesh = null
			if gi is MeshInstance3D:
				mesh = (gi as MeshInstance3D).mesh
				for i in (gi as MeshInstance3D).get_surface_override_material_count():
					add.call((gi as MeshInstance3D).get_surface_override_material(i), false)
			elif many and (gi as MultiMeshInstance3D).multimesh:
				mesh = (gi as MultiMeshInstance3D).multimesh.mesh
			elif gi is CPUParticles3D:
				mesh = (gi as CPUParticles3D).mesh
			if mesh:
				for i in mesh.get_surface_count():
					add.call(mesh.surface_get_material(i), many)
	var zoo := Node3D.new()
	add_child(zoo)
	var fleck := BoxMesh.new()
	fleck.size = Vector3.ONE * 0.04
	# (A dictionary: lambdas capture locals by value.)
	var n := {"i": 0}
	var place := func() -> Transform3D:
		var k: int = n.i
		n.i = k + 1
		return cam.global_transform * Transform3D(Basis(), Vector3(-0.6 + (k % 24) * 0.05, -0.4 + (k / 24) * 0.05, -2.0))
	for m in plain:
		var mi := MeshInstance3D.new()
		mi.mesh = fleck
		mi.material_override = m
		zoo.add_child(mi)
		mi.global_transform = place.call()
	for m in multi:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = fleck
		mm.instance_count = 1
		mm.set_instance_transform(0, Transform3D())
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = m
		zoo.add_child(mmi)
		mmi.global_transform = place.call()
	for f in 2:
		await get_tree().process_frame
	if "--count" in OS.get_cmdline_user_args():
		print("ZOO %d plain, %d multimesh materials" % [plain.size(), multi.size()])
	zoo.queue_free()

## Count once the camera exists and the places near it are awake: two
## frames, so the count is what a frame actually draws.
func _count_soon() -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	_count_draws()

## What the scene asks the renderer for, by world: for judging a draw-call
## budget (a browser submits each one through WebGL, which is not free).
func _count_draws() -> void:
	var total := 0
	var shadowed := 0
	var mms := 0
	# Only what is actually submitted: a hidden node (a merged piece) is
	# not a draw call.
	for mi: MeshInstance3D in find_children("*", "MeshInstance3D", true, false):
		if not mi.is_visible_in_tree():
			continue
		total += 1
		if mi.cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
			shadowed += 1
	for mm: MultiMeshInstance3D in find_children("*", "MultiMeshInstance3D", true, false):
		if not mm.is_visible_in_tree():
			continue
		mms += 1
		if mm.cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
			shadowed += 1
	print("DRAW meshes=%d multimesh=%d shadow_casters=%d" % [total, mms, shadowed])
	# Where the triangles are (Hearthstone): instances x triangles, biggest first.
	var tri := []
	for gi: GeometryInstance3D in (planets["hearthstone"] as Planet).find_children("*", "GeometryInstance3D", true, false):
		if not gi.is_visible_in_tree():
			continue
		var mesh: Mesh = null
		var count := 1
		if gi is MeshInstance3D:
			mesh = (gi as MeshInstance3D).mesh
		elif gi is MultiMeshInstance3D and (gi as MultiMeshInstance3D).multimesh:
			mesh = (gi as MultiMeshInstance3D).multimesh.mesh
			count = (gi as MultiMeshInstance3D).multimesh.instance_count
		if mesh == null:
			continue
		var t := 0
		for si in mesh.get_surface_count():
			var arr := mesh.surface_get_arrays(si)
			var idx = arr[Mesh.ARRAY_INDEX]
			t += (idx.size() if idx != null else (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()) / 3
		# Only what the camera's distance lets be drawn.
		var cam := get_viewport().get_camera_3d()
		if cam:
			var dd := cam.global_position.distance_to(gi.global_transform * mesh.get_aabb().get_center())
			if dd < gi.visibility_range_begin or (gi.visibility_range_end > 0.0 and dd > gi.visibility_range_end):
				continue
		var label := String(gi.get_parent().name) + "/" + String(gi.name)
		tri.append([t * count, "%s %s x%d r%.0f" % [label, mesh.resource_path.get_file(), count, gi.visibility_range_end]])
	tri.sort_custom(func(a, b): return a[0] > b[0])
	var sum := 0
	for e in tri:
		sum += int(e[0])
	print("  TRIS total in range %d" % sum)
	for k in mini(16, tri.size()):
		print("  TRIS %7d %s" % tri[k])
	for key in planets:
		var p: Planet = planets[key]
		var c := 0
		var sh := 0
		for mi: MeshInstance3D in p.find_children("*", "MeshInstance3D", true, false):
			if not mi.is_visible_in_tree():
				continue
			c += 1
			if mi.cast_shadow != GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
				sh += 1
		var mc := 0
		for mm: MultiMeshInstance3D in p.find_children("*", "MultiMeshInstance3D", true, false):
			if mm.is_visible_in_tree():
				mc += 1
		print("  %-11s meshes=%d multimesh=%d shadow=%d" % [key, c, mc, sh])
		var kinds := {}
		for mm: MultiMeshInstance3D in p.find_children("*", "MultiMeshInstance3D", true, false):
			if not mm.is_visible_in_tree():
				continue
			var path := mm.multimesh.mesh.resource_path if mm.multimesh and mm.multimesh.mesh else "?"
			kinds[path.get_file()] = int(kinds.get(path.get_file(), 0)) + 1
		for k in kinds:
			print("      mm %-22s x%d" % [k, kinds[k]])
		for s in p.sites:
			print("    site %-12s meshes=%d" % [s.name, s.find_children("*", "MeshInstance3D", true, false).size()])

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
	# Small things on every world drawn only near (Site.cull_small).
	for key in planets:
		for site in (planets[key] as Planet).sites:
			(site as Site).cull_small()
	# Small life on every world: fireflies over Hearth, ash on Ashfall, pollen
	# on Verdance, dust out on the cold ones.
	for key in planets:
		Ambience.attach(planets[key] as Planet, key)
	# After dark, Hearth's sky: the aurora, and stones falling through it.
	night = NightSky.new()
	night.reach = self
	(planets["hearthstone"] as Planet).add_child(night)

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
	if Flow.lite():
		# A browser submits every shadow draw through WebGL, twice over with
		# two splits: one map, out to the village's own trees, is the trade.
		sun.directional_shadow_max_distance = 145.0
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	else:
		sun.directional_shadow_max_distance = 220.0
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
		sun.directional_shadow_blend_splits = true
	sun.shadow_normal_bias = 1.4
	add_child(sun)

var _arrived := {}
## Off Hearthstone at least once this loop (the first steps are done).
var _launched := false
var _goal_t := 0.0
## The far worlds are lit on a timer, not every frame: see _process.
var _light_t := 0.0
## Lamps are recollected on a timer; the lit ones breathe every frame.
var _lamp_t := 0.0
const PLACE_WORDS := {"verdance": "the jungle world", "ashfall": "where the Aster fell", "phantom": "the moon that moves",
	"wanderer": "the comet", "hearthstone": "home"}

func _on_frame(from: String, to: String) -> void:
	if campfire:
		campfire.solid(to == "hearthstone")
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
	# The world under your feet is lit every frame (it is what you are
	# standing on). The others are seen from far off, where the Lantern's
	# direction drifts by a degree over minutes: ten times a second is
	# smooth, and it takes four shader writes per world off every frame.
	if planets.has(system.ref):
		(planets[system.ref] as Planet).light(star, power)
	_light_t -= _dt
	if _light_t <= 0.0:
		_light_t = 0.1
		for key in planets:
			if key != system.ref:
				(planets[key] as Planet).light(star, power)
	_air(cam)
	# Only the lamps near the camera burn; the rest are a lit dot. A village
	# of lamps should not cost a village of lights.
	_lamp_t -= _dt
	if _lamp_t <= 0.0:
		_lamp_t = 0.2
		Lamp.pump(cam)
	Lamp.animate(Time.get_ticks_msec() * 0.001)
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
	# Under the water: green-blue, close, the light from above.
	var under := player != null and player.underwater and cam == player.camera
	if hud:
		hud.underwater(under)
	_muffle(under)
	if under:
		env.fog_enabled = true
		env.fog_light_color = Color(0.06, 0.22, 0.26)
		env.fog_light_energy = 1.0
		env.fog_density = 0.09
		env.fog_sky_affect = 1.0
		env.ambient_light_color = Color(0.25, 0.5, 0.55)
		env.ambient_light_energy = 0.5
		return
	env.fog_light_energy = 1.0
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
	# Night is dark but never blind: starlight off the dust, enough to find
	# the fire and the path lanterns by.
	env.ambient_light_color = Color(tint.r, tint.g, tint.b).lerp(Color(0.30, 0.36, 0.55), 1.0 - day)
	env.ambient_light_energy = lerpf(0.17, 0.45, day) * lerpf(0.4, 1.0, thick)

## Sound under water: everything through a low-pass, as through the helmet
## and the water both.
var _muffled := false
func _muffle(on: bool) -> void:
	if on == _muffled:
		return
	_muffled = on
	var bus := AudioServer.get_bus_index("Master")
	var at := -1
	for i in AudioServer.get_bus_effect_count(bus):
		if AudioServer.get_bus_effect(bus, i) is AudioEffectLowPassFilter:
			at = i
	if at < 0:
		var lp := AudioEffectLowPassFilter.new()
		lp.cutoff_hz = 650.0
		lp.resonance = 0.6
		AudioServer.add_bus_effect(bus, lp)
		at = AudioServer.get_bus_effect_count(bus) - 1
	AudioServer.set_bus_effect_enabled(bus, at, on)

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
	ship.boarded.connect(_on_boarded)
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
	# Compile what a lift-off needs while the morning is still dark: the
	# ship on the tower (her plume, her cockpit), the wide view from it (the
	# valley, the sky, the air of the other worlds) and the dust at the
	# deck. A browser compiles a material the first time it is drawn, and
	# the first draw should not be ignition.
	if not _testing(args):
		await _prewarm()
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
		elif beat == "launch":
			# Straight to the ride, for looking at it.
			Lore.learn("hearth_codes")
			ship.board()
			await ship.boarded
			await get_tree().create_timer(1.2).timeout
			ship.launch()
		elif beat.begins_with("cruise:"):
			# Off the deck and on the autopilot to a world, for looking at
			# flight (and its frame rate) from a browser.
			Lore.learn("hearth_codes")
			ship.board()
			await ship.boarded
			ship.launch()
			while ship.launching:
				await get_tree().physics_frame
			ship.target = beat.trim_prefix("cruise:")
			ship.start_autopilot()
		elif beat.begins_with("deck"):
			# On the tower's deck by the Kestrel (deck:<loop s> for the hour),
			# looking at her from her left side, ahead of the wing.
			if beat.begins_with("deck:"):
				system.t = float(beat.trim_prefix("deck:"))
			var v: Village = (planets["hearthstone"] as Planet).sites[0]
			var xf := v.ship_rest
			var up := xf.basis.y.normalized()
			var at := xf.origin - up * 1.9 - xf.basis.x.normalized() * 8.0 - xf.basis.z.normalized() * 5.5
			player.place(Transform3D(Site.upright(up, xf.basis.z), at), (xf.origin - at))
			player.set_pitch(0.12)
		elif beat == "dive" or beat == "swim":
			# In the pond beside the pier, floating or a metre and a half under.
			var home: ReachBody = system.bodies["hearthstone"]
			var pond := Worlds.place(home, "pond")
			var v: Village = (planets["hearthstone"] as Planet).sites[0]
			var away := pond.origin - v.pier_xf.origin
			away = (away - pond.basis.y * away.dot(pond.basis.y)).normalized()
			var spot := (pond.origin + pond.basis.y.cross(away).normalized() * 9.0).normalized()
			var level := home.radius + home.sea
			player.place(Transform3D(Site.upright(spot, away), spot * (level - (3.2 if beat == "dive" else 1.0))), -away)
			if beat == "dive":
				# Held under, for looking at it.
				await get_tree().physics_frame
				player.underwater = true
				player.process_mode = Node.PROCESS_MODE_DISABLED
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
		# The first time round again, said plainly: what happened and what
		# carries over.
		hud.plaque("The same morning", "The Lantern went out, and you woke here again, at the fire, at the start of the same day. Nobody else remembers it. Only what you learned carries over: your ship's log (L) keeps it, and its leads point where to go next. Twenty-two minutes each time. Find out why it happens, and end it.", player.global_position)
	if n <= 2:
		hud.hint("E  talk, use, read    X  signalscope    M  map\nL  ship log    P  photograph    F  torch    Esc  every key", 20.0)

## The ship's keys, the first times you sit in her.
var _ship_hints := 0
func _on_boarded() -> void:
	if _ship_hints < 2:
		_ship_hints += 1
		hud.hint("Space  lift off, climb    Shift  sink, land    W S  forward, back    A D  sideways\nMouse  turn    Q E  roll    T  lock a world    G  autopilot    let go  hold still\nR  flight assist    V  outside view    Right mouse  look about", 24.0)

## What the log points at next, once the pilot is off the ground: the lead
## nearest the end of the story that is still open (its place not yet all
## learned), in a few words.
const LEADS := [
	["ash_core", "wan_end", "Carry the core to the Wanderer's Engine. Its door opens at about 20:30."],
	["ph_shrine", "ash_core", "The core is in the Aster's vault on Ashfall."],
	["ash_hale", "ash_core", "Open the Aster's cargo vault on Ashfall: the code is 0412."],
	["verd_engine", "ash_core", "The Engine needs a core. Hale's cargo hummed like the songlines."],
	["hearth_songline", "wan_door", "The Wanderer carries the Engine. Its door opens near the Lantern, at about 20:30."],
	["verd_cargo", "ash_hale", "Hale's bridge recorder, at the Aster's wreck on Ashfall (signalscope: Distress)."],
	["hearth_vex", "ash_vex", "Vex salvages the Aster's wreck on Ashfall. Listen for her drums (X)."],
	["hearth_renn", "verd_renn", "A harmonica on Verdance that nobody in Hearth plays. Follow it with the signalscope (X)."],
	["hearth_phantom", "ph_moves", "The Phantom moves when no one looks. A photograph (P) might hold it."],
	["hearth_choir", "hearth_songline", "A Choir songline in the old mine, past the lake."],
]

func _lead() -> String:
	for l in LEADS:
		if Lore.known(l[0]) and not Lore.known(l[1]):
			return "Lead: " + String(l[2])
	return "Lead: Press M for the map and pick a world; T locks it, G flies there."

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
	# The fire too: walked round, not through.
	targets.append(["campfire", campfire.global_position, campfire.global_basis.x])
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

## Space on the tower's deck: the dust, the climb, and control handed back
## at the top of it with the speed she had.
func _launch_test() -> void:
	Lore.learn("hearth_codes")
	await get_tree().create_timer(1.0).timeout
	ship.board()
	await ship.boarded
	await get_tree().create_timer(0.5).timeout
	var y0 := ship.global_position.length()
	# Space held for three seconds, as a player lifts off.
	ship.launch()
	var fx := 0
	var t := 0.0
	var peak := 0.0
	while t < 3.5:
		await get_tree().physics_frame
		t += get_physics_process_delta_time()
		fx = maxi(fx, get_tree().get_nodes_in_group("launch_fx").size())
		peak = maxf(peak, ship.global_position.length() - y0)
	var climb := ship.linear_velocity.dot(ship.global_position.normalized())
	await get_tree().create_timer(2.0).timeout
	var held := ship.linear_velocity.length()
	Report.line("LAUNCHTEST dust %d, rose %.1f m in 3 s, climbing %.1f m/s, then held at %.2f m/s, gear up %s, airborne %s" % [fx, peak, climb, held, ship._gear_k < 0.5, not ship.landed])
	Report.finish(get_tree())

## She lifts off the deck, is let go, and sets down again: the grit thrown
## out from under the gear, the thud through the hull, and her resting on
## the deck afterwards (the dust is a one-shot, so it is counted as it happens).
func _land_test() -> void:
	Lore.learn("hearth_codes")
	await get_tree().create_timer(1.0).timeout
	ship.board()
	await ship.boarded
	await get_tree().create_timer(0.5).timeout
	var up := ship.global_basis.y.normalized()
	# Forty metres over the deck, falling at 6 m/s, nothing pressed: the
	# assist should catch her and hold her.
	ship.freeze = true
	ship.global_position += up * 40.0
	ship.reset_physics_interpolation()
	ship.freeze = false
	ship.linear_velocity = -up * 6.0
	ship.landed = false
	await get_tree().create_timer(4.0).timeout
	var held := absf(ship.linear_velocity.dot(up))
	var hover_alt := ship.altitude
	# Then Shift held: a descent that slows as she nears the deck.
	var k := InputEventKey.new()
	k.keycode = KEY_SHIFT
	k.physical_keycode = KEY_SHIFT
	k.pressed = true
	Input.parse_input_event(k)
	var start := Time.get_ticks_msec()
	var dust := 0
	var touch := 0.0
	while Time.get_ticks_msec() - start < 30000:
		await get_tree().physics_frame
		for n in get_tree().get_nodes_in_group("launch_fx"):
			dust = maxi(dust, n.get_child_count())
		if ship.get_contact_count() > 0 and touch == 0.0:
			touch = maxf(ship.sink, 0.01)
		if ship.landed:
			break
	k = k.duplicate()
	k.pressed = false
	Input.parse_input_event(k)
	var t := (Time.get_ticks_msec() - start) / 1000.0
	Report.line("LANDTEST held %.2f m/s at %.0f m, landed %s after %.1f s, touched at %.1f m/s, dust %d, hull %d%%" % [held, hover_alt, ship.landed, t, touch, dust, int(maxf(ship.integrity, 0.0))])
	Report.finish(get_tree())

## Arriving at Verdance as a player does: 1.5 km up, sliding across it at
## 40 m/s. Hands off, she should stop sliding and hold; then Shift held
## should bring her down onto her feet, whole.
func _arrive_test() -> void:
	Lore.learn("hearth_codes")
	await get_tree().create_timer(1.0).timeout
	ship.board()
	await ship.boarded
	var vd: ReachBody = system.bodies["verdance"]
	system.switch("verdance")
	await get_tree().physics_frame
	var d := Worlds.place(vd, "renn").origin.normalized().rotated(Vector3.UP, 0.25).normalized()
	var start := d * (vd.radius + 1500.0)
	var side := d.cross(Vector3.UP).normalized()
	ship.freeze = true
	ship.global_transform = Transform3D(Basis.looking_at(side, d), start)
	ship.reset_physics_interpolation()
	ship.freeze = false
	ship.landed = false
	ship.linear_velocity = side * 40.0
	ship._last_v = ship.linear_velocity
	var t := 0.0
	var held_at := -1.0
	while t < 40.0:
		await get_tree().physics_frame
		t += get_physics_process_delta_time()
		if held_at < 0.0 and ship.linear_velocity.length() < 1.0:
			held_at = t
	var drift := ship.linear_velocity.length()
	var k := InputEventKey.new()
	k.keycode = KEY_SHIFT
	k.physical_keycode = KEY_SHIFT
	k.pressed = true
	Input.parse_input_event(k)
	var t2 := 0.0
	var crashed := {"v": false}
	ship.destroyed.connect(func(_c): crashed.v = true)
	while t2 < 240.0 and not ship.landed and not crashed.v:
		await get_tree().physics_frame
		t2 += get_physics_process_delta_time()
	var k2 := k.duplicate() as InputEventKey
	k2.pressed = false
	Input.parse_input_event(k2)
	Report.line("ARRIVETEST still after %.1f s (drift %.2f m/s), landed %s after %.0f s, crashed %s, hull %d" % [held_at, drift, ship.landed, t2, crashed.v, int(ship.integrity)])
	Report.finish(get_tree())

## Script time per frame, standing at the fire and flying low over the
## village: what the scripts cost before anything is drawn.
func _prof_test() -> void:
	await get_tree().create_timer(2.0).timeout
	var measure := func() -> float:
		var tot := 0.0
		var n := 0
		var t0 := Time.get_ticks_msec()
		while Time.get_ticks_msec() - t0 < 1500:
			await get_tree().process_frame
			tot += Performance.get_monitor(Performance.TIME_PROCESS) + Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
			n += 1
		return tot / n * 1000.0
	var base: float = await measure.call()
	Report.line("PROF base %.2f ms" % base)
	var groups := {}
	var walk := [get_tree().root]
	while not walk.is_empty():
		var node: Node = walk.pop_back()
		walk.append_array(node.get_children())
		var script: Script = node.get_script()
		if script and (node.is_processing() or node.is_physics_processing()) and node != self:
			var k := script.resource_path.get_file()
			if not groups.has(k):
				groups[k] = []
			groups[k].append(node)
	for k in groups:
		if k in ["flow.gd", "updater.gd", "shot.gd", "reach_loop.gd"]:
			continue
		for node: Node in groups[k]:
			node.set_process(false)
			node.set_physics_process(false)
		var t: float = await measure.call()
		Report.line("PROF without %-20s %.2f ms (saves %.2f)" % [k, t, base - t])
		for node: Node in groups[k]:
			node.set_process(true)
			node.set_physics_process(true)
	# And this script's own.
	set_process(false)
	set_physics_process(false)
	var t2: float = await measure.call()
	Report.line("PROF without reach.gd %.2f ms (saves %.2f)" % [t2, base - t2])
	set_process(true)
	set_physics_process(true)
	Report.finish(get_tree())

## At the crater's wall at 45 m/s, W held: with the assist she stops short
## of it; without, she hits it (the control), and either way she does not
## bounce back off it.
func _fly_wall_test() -> void:
	Lore.learn("hearth_codes")
	await get_tree().create_timer(1.0).timeout
	ship.board()
	await ship.boarded
	var out := []
	for with_assist in [true, false]:
		var home: ReachBody = system.bodies["hearthstone"]
		var v := Worlds.place(home, "village")
		var wall := Worlds.crater_dir(160.0, 112.5)
		var start_d := v.origin.normalized().slerp(wall, 0.45)
		var up := start_d
		var start := start_d * (home.radius + Worlds.height("hearthstone", start_d, home.radius) + 22.0)
		var to := wall * (home.radius + 20.0) - start
		to = (to - up * to.dot(up)).normalized()
		ship.freeze = true
		ship.global_transform = Transform3D(Basis.looking_at(to, up), start)
		ship.reset_physics_interpolation()
		ship.freeze = false
		ship.landed = false
		ship.integrity = 100.0
		ship.assist = with_assist
		ship.linear_velocity = to * 45.0
		ship.angular_velocity = Vector3.ZERO
		# (Teleported: the speed is not a knock.)
		ship._last_v = ship.linear_velocity
		await get_tree().physics_frame
		ship._last_v = ship.linear_velocity
		var k := InputEventKey.new()
		k.keycode = KEY_W
		k.physical_keycode = KEY_W
		k.pressed = true
		Input.parse_input_event(k)
		var crashed := {"v": false}
		var on_crash := func(_c): crashed.v = true
		ship.destroyed.connect(on_crash)
		var hit_speed := 0.0
		var fwd_was := 45.0
		var back := 0.0
		var t := 0.0
		var warned := false
		while t < 9.0:
			await get_tree().physics_frame
			t += get_physics_process_delta_time()
			warned = warned or ship.assist_doing == "TERRAIN"
			if ship.get_contact_count() > 0:
				hit_speed = maxf(hit_speed, fwd_was)
			fwd_was = ship.linear_velocity.dot(to)
			back = maxf(back, -ship.linear_velocity.dot(to))
		var k2 := k.duplicate() as InputEventKey
		k2.pressed = false
		Input.parse_input_event(k2)
		ship.destroyed.disconnect(on_crash)
		out.append("%s: warned %s, touched at %.1f m/s, bounced back %.1f m/s, crashed %s" % ["assist" if with_assist else "no assist", warned, hit_speed, back, crashed.v])
		if crashed.v:
			await loop.woke
			ship.board()
			await ship.boarded
		await get_tree().create_timer(0.5).timeout
	ship.assist = true
	Report.line("FLYWALL " + "; ".join(out))
	Report.finish(get_tree())

## Into the pond from a height: a splash, then floating with the head out;
## Shift dives (the eyes go under, the view with them); let go and she
## comes back up.
func _swim_test() -> void:
	await get_tree().create_timer(1.0).timeout
	var home: ReachBody = system.bodies["hearthstone"]
	var pond := Worlds.place(home, "pond")
	var up := pond.basis.y
	var level := home.radius + home.sea
	# Clear of the pier, which runs out over the middle.
	var village: Village = (planets["hearthstone"] as Planet).sites[0]
	var away := pond.origin - village.pier_xf.origin
	away = (away - up * away.dot(up)).normalized()
	var spot := (pond.origin + up.cross(away).normalized() * 9.0).normalized()
	up = spot
	player.place(Transform3D(Site.upright(spot, pond.basis.z), spot * (level + 3.0)), pond.basis.z)
	var splashed := false
	var start := Time.get_ticks_msec()
	while Time.get_ticks_msec() - start < 4000:
		await get_tree().physics_frame
		if player.wet > 0.05:
			splashed = splashed or player._was_wet > 0.05
	var head := (player.camera.global_position - home.node.global_position).length() - level
	var k := InputEventKey.new()
	k.keycode = KEY_SHIFT
	k.physical_keycode = KEY_SHIFT
	k.pressed = true
	Input.parse_input_event(k)
	await get_tree().create_timer(2.0).timeout
	var dived := player.underwater
	var fogged := env.fog_density > 0.05
	var k2 := k.duplicate() as InputEventKey
	k2.pressed = false
	Input.parse_input_event(k2)
	await get_tree().create_timer(4.0).timeout
	var back := not player.underwater
	Report.line("SWIMTEST floating head %.2f m over the water, dived %s, fog %s, back up %s, alive %s" % [head, dived, fogged, back, not player._dead])
	Report.finish(get_tree())

## What arriving at each world costs: its collision, its sites waking.
func _ref_test() -> void:
	await get_tree().create_timer(1.0).timeout
	for key in ["verdance", "ashfall", "phantom", "wanderer", "hearthstone"]:
		var t0 := Time.get_ticks_usec()
		system.switch(key)
		var t1 := Time.get_ticks_usec()
		await get_tree().physics_frame
		var t2 := Time.get_ticks_usec()
		await get_tree().physics_frame
		var t3 := Time.get_ticks_usec()
		Report.line("REFTEST %s switch %.1f ms, next tick %.1f ms, then %.1f ms" % [key, (t1 - t0) / 1000.0, (t2 - t1) / 1000.0, (t3 - t2) / 1000.0])
		await get_tree().create_timer(0.5).timeout
	Report.finish(get_tree())

## Off the deck, lock a world, G: the autopilot flies her there, round
## anything in the way, and holds her over it. Run at three times speed.
func _autopilot_test(to: String) -> void:
	Lore.learn("hearth_codes")
	await get_tree().create_timer(1.0).timeout
	ship.board()
	await ship.boarded
	await get_tree().create_timer(0.5).timeout
	ship.launch()
	while ship.launching:
		await get_tree().physics_frame
	Engine.time_scale = 3.0
	ship.target = to
	ship.start_autopilot()
	var t0 := system.t
	var closest := INF
	var star := INF
	while ship.autopilot and system.t - t0 < 400.0 and not ship._dead:
		await get_tree().physics_frame
		star = minf(star, ship.global_position.distance_to(system.world("lantern")))
	Engine.time_scale = 1.0
	var tb: ReachBody = system.bodies[to]
	var alt := ship.global_position.distance_to(system.world(to)) - tb.radius
	var rel := (ship.linear_velocity - system.world_vel(to)).length()
	# Then hands off: the assist should hold her there.
	await get_tree().create_timer(3.0).timeout
	var rel2 := (ship.linear_velocity - system.world_vel(to)).length()
	Report.line("APTEST to %s arrived %s in %.0f s, %.0f m over it, %.1f m/s, then %.1f m/s held, frame %s, nearest the Lantern %.0f m, hull %d" % [to, not ship.autopilot and not ship._dead, system.t - t0, alt, rel, rel2, system.ref, star, int(ship.integrity)])
	Report.finish(get_tree())

## Night over Hearth: the aurora comes up as the Lantern sets, a stone falls
## through it, and the lamps burn only where they are worth burning.
func _sky_test() -> void:
	await get_tree().create_timer(1.0).timeout
	var home: ReachBody = system.bodies["hearthstone"]
	var up := Worlds.place(home, "village").origin.normalized()
	var dark_at := 0.0
	var low := INF
	var day_at := 0.0
	var high := -INF
	var t := 0.0
	while t < ReachSystem.LOOP:
		var el: float = up.dot((system.helio("lantern", t) - system.helio("hearthstone", t)).normalized())
		if el < low:
			low = el
			dark_at = t
		if el > high:
			high = el
			day_at = t
		t += 5.0
	system.running = false
	system.t = dark_at
	system.place()
	await get_tree().process_frame
	await get_tree().process_frame
	var cam := get_viewport().get_camera_3d()
	var near := Lamp.pump(cam)
	night.shoot()
	await get_tree().process_frame
	var aurora := night.visible and night.night > 0.6
	var stars := night.star_shown() and night._streak.visible
	var dark := night.night
	# Three kilometres up: not one lamp is lit.
	var away := Camera3D.new()
	add_child(away)
	away.global_position = cam.global_position + up * 3000.0
	var far := Lamp.pump(away)
	away.queue_free()
	system.t = day_at
	system.place()
	await get_tree().process_frame
	await get_tree().process_frame
	Report.line("SKYTEST night %.2f aurora %s stars %s day %.2f lamps near %d/%d far %d/%d at %.0f s" % [dark, aurora, stars, night.night, near.lit, near.lit + near.dark, far.lit, far.lit + far.dark, dark_at])
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

## Behind the title (title.gd): Hearth's lake in the Lantern's low light,
## from out by the end of the pier looking back along it to the shore, the
## village and the crater wall beyond under the nebulae, Mara's banjo and
## Okafor's flute; the camera breathing a little.
var _drift_base: Transform3D

func _backdrop() -> void:
	system.running = false
	system.switch("hearthstone")
	var village: Village = (planets["hearthstone"] as Planet).sites[0]
	var up := village.pier_xf.basis.y
	var out := -village.pier_xf.basis.z
	var side := village.pier_xf.basis.x
	# Behind Isa's left shoulder at the pier's end, looking back along it
	# toward the shore, she and the water to the right.
	var eye := village.pier_xf.origin + out * 26.0 + side * 2.2 + up * 2.6
	var look := village.pier_xf.origin + out * 4.0 - side * 2.6 + up * 5.5
	var fwd := (look - eye).normalized()
	# The hour: the Lantern low (8 to 16 degrees up), off to the side of the
	# view, a little behind.
	var home: ReachBody = system.bodies["hearthstone"]
	var best_t := 0.0
	var best := -INF
	var t := 0.0
	while t < ReachSystem.LOOP:
		var sun := (-(home.orbit.position(t))).normalized()
		var el := rad_to_deg(asin(clampf(sun.dot(up), -1.0, 1.0)))
		var flat := (sun - up * sun.dot(up)).normalized()
		# High enough to clear the crater's rim; from the side and behind.
		var score := -absf(el - 34.0) * 1.5 - absf(flat.dot(fwd) - 0.35) * 25.0 + flat.dot(side) * 4.0
		if el > 20.0 and score > best:
			best = score
			best_t = t
		t += 4.0
	system.t = best_t
	system.place()
	_drift = Camera3D.new()
	_drift.fov = 52.0
	_drift.near = 0.1
	_drift.far = 60000.0
	_drift.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(_drift)
	_drift.make_current()
	system.focus = _drift
	_drift_base = Transform3D(Basis.looking_at(fwd, up), eye)
	# Turn the nebulae so their brightest clouds stand behind the scene,
	# a little above the view's middle.
	var sky_dir := (fwd + up * 0.45).normalized()
	var sm := env.sky.sky_material as ShaderMaterial
	# (The sky shader's own tilt; unset on the material, so its default.)
	var tilt := 0.25
	var best_yaw := 0.0
	var best_d := INF
	for k in 126:
		var yaw := k * 0.05
		var cy := cos(yaw)
		var sy := sin(yaw)
		var d := Vector3(cy * sky_dir.x - sy * sky_dir.z, sky_dir.y, sy * sky_dir.x + cy * sky_dir.z)
		d = Vector3(d.x, cos(tilt) * d.y - sin(tilt) * d.z, sin(tilt) * d.y + cos(tilt) * d.z)
		var u := atan2(d.x, -d.z) / TAU + 0.5
		var off := absf(u - 0.42)
		if off < best_d:
			best_d = off
			best_yaw = yaw
	sm.set_shader_parameter("yaw", best_yaw)
	_drift.fov = 60.0
	# A warmer, richer light for the picture.
	sun.light_color = Color(1.0, 0.84, 0.64)
	env.adjustment_saturation = 1.18
	env.adjustment_contrast = 1.08
	for part in ["banjo", "flute"]:
		var p := AudioStreamPlayer.new()
		p.stream = load("res://audio/reach/%s.wav" % part)
		p.volume_db = -60.0
		add_child(p)
		p.play()
		create_tween().tween_property(p, "volume_db", -9.0 + Flow.music_db(), 4.0)
	_place_drift()

func _place_drift() -> void:
	var b := _drift_base.basis
	var sway := Vector3(sin(_drift_t * 0.11) * 0.25, sin(_drift_t * 0.17) * 0.12, 0.0)
	_drift.global_transform = Transform3D(b.rotated(b.y, sin(_drift_t * 0.07) * 0.025), _drift_base.origin + b * sway)

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
	if parts.size() > 4 and not parts[1] in ["eye", "from"]:
		system.t = float(parts[4])
		system.running = false
	system.switch(key)
	# A view of the body it already is swaps nothing, so nothing would wake
	# its detail, its collision or its places: wake them here.
	if system.ref == key and planets.has(key):
		(planets[key] as Planet).set_ref(true)
	system.place()
	if parts.size() > 5 and parts[1] == "from":
		# view:<body>:from:<landmark>:<landmark>:<height>:<look height>[:<loop s>[:<metres along>]]
		# Standing at one landmark (or some metres along the way from it),
		# looking at another.
		var a := Worlds.place(b, parts[2]).origin
		var z := Worlds.place(b, parts[3]).origin
		if parts.size() > 6:
			system.t = float(parts[6])
			system.running = false
		if parts.size() > 7:
			var d0 := a.normalized().slerp(z.normalized(), float(parts[7]) / maxf(a.distance_to(z), 1.0))
			a = d0 * (b.radius + Worlds.height(key, d0, b.radius))
		var eye0 := a + a.normalized() * float(parts[4])
		_view_cam.global_position = eye0
		_view_cam.look_at(z + z.normalized() * float(parts[5]), eye0.normalized())
		return
	if parts.size() > 8 and parts[1] == "eye":
		# view:<body>:eye:<landmark>:<east>:<north>:<height>:<look east>:<look north>:<look height>[:<loop s>]
		# A standing eye on the ground near a landmark, looking at a point
		# near it, each (east, north) metres along the ground from it.
		var mark := Worlds.place(b, parts[2])
		var gnd := func(e: float, n: float) -> Vector3:
			var d := (mark.origin + mark.basis.x * e - mark.basis.z * n).normalized()
			return d * (b.radius + Worlds.height(key, d, b.radius))
		if parts.size() > 9:
			system.t = float(parts[9])
			system.running = false
		var eye: Vector3 = gnd.call(float(parts[3]), float(parts[4]))
		eye += eye.normalized() * float(parts[5])
		var at: Vector3 = gnd.call(float(parts[6]), float(parts[7]))
		at += at.normalized() * float(parts[8])
		_view_cam.global_position = eye
		_view_cam.look_at(at, eye.normalized())
		return
	if parts.size() > 2 and parts[1] == "orbit":
		# view:<body>:orbit:<loop s>: side-on to the Lantern (a comet's tail
		# in profile), at that moment.
		system.t = float(parts[2])
		system.running = false
		# A camera this far out would switch the frame under itself: hold it.
		system.focus = null
		system.place()
		var star := system.world("lantern") - system.world(key)
		var side := star.normalized().cross(Vector3.UP).normalized()
		var cpos := system.world(key) + side * 2600.0 - star.normalized() * 900.0 + Vector3.UP * 300.0
		_view_cam.global_position = cpos
		_view_cam.look_at(system.world(key) - star.normalized() * 900.0, Vector3.UP)
		for p in planets.values():
			(p as Planet).light(system.world("lantern"), 1.0)
		return
	if parts.size() > 1 and parts[1] == "sky":
		# Standing in the village, looking up: what the night does.
		var v := Worlds.place(b, "village")
		var vup := v.basis.y
		_view_cam.global_position = v.origin + vup * 2.0
		_view_cam.look_at(v.origin + vup * 2.0 + (v.basis.z + vup * 1.5).normalized(), vup)
		return
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
		# From the lit side, the Lantern behind the camera's shoulder.
		var star := system.world("lantern")
		var toward := (star - Vector3.ZERO).normalized()
		var side := toward.cross(Vector3.UP).normalized()
		_view_cam.global_position = (toward * 0.75 + side * 0.55 + Vector3.UP * 0.3).normalized() * b.radius * 3.6
		_view_cam.look_at(Vector3.ZERO, Vector3.UP)
