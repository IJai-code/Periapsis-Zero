extends Node
## The game's spine: scene changes behind a fade, settings, music, progress,
## and the handoff to Act One on periapsiszero.dev.

const SETTINGS := "user://settings.cfg"
const PROGRESS := "user://progress.cfg"
const ACT_ONE := "https://periapsiszero.dev/#game"
const SCENES := {
	"title": "res://scenes/title.tscn",
	"intro": "res://scenes/prologue_intro.tscn",
	"corridor": "res://scenes/prologue_corridor.tscn",
	"bridge": "res://scenes/prologue_bridge.tscn",
	"hangar": "res://scenes/prologue_hangar.tscn",
	"flight": "res://scenes/prologue_flight.tscn",
	"arrival": "res://scenes/prologue_arrival.tscn",
	"hearth": "res://scenes/act1_hearth.tscn",
	"hearth_bay": "res://scenes/act1_bay.tscn",
	"test_flight": "res://scenes/act1_test_flight.tscn",
	"blackbox": "res://scenes/act1_blackbox.tscn",
	"descent": "res://scenes/act1_descent.tscn",
	"act1_end": "res://scenes/act1_end.tscn",
}

var settings := {"music": 0.6, "sfx": 0.8, "mouse": 1.0, "invert": false, "cinematic": false}
var _music: AudioStreamPlayer
var _busy := false
## A chapter's starting beat, from a test link or `-- --beat`.
var beat := ""

## Keys, defined here rather than in project.godot so they read as a list.
## Flight matches the web game: W/S thrust, A/D strafe, Q/E roll, mouse aims.
const KEYS := {
	"forward": [KEY_W], "back": [KEY_S],
	"left": [KEY_A], "right": [KEY_D],
	"look_up": [KEY_UP], "look_down": [KEY_DOWN], "look_left": [KEY_LEFT], "look_right": [KEY_RIGHT],
	"roll_left": [KEY_Q], "roll_right": [KEY_E],
	"up": [KEY_SPACE], "down": [KEY_C],
	"interact": [KEY_E, KEY_F], "boost": [KEY_SHIFT],
	"fire": [KEY_K], "pause": [KEY_ESCAPE, KEY_P], "skip": [KEY_ENTER],
	"crouch": [KEY_C, KEY_CTRL], "jump": [KEY_SPACE],
	"lock": [KEY_T], "missile": [KEY_R], "warp": [KEY_G],
}

## The mouse belongs to the game whenever something that steers by it is
## active (the walking pilot, the ship: group "mouse_look", `wants_mouse()`)
## and the game is not paused. The cursor shows only in menus. On the
## desktop it is captured again at once; a browser needs a click for that,
## so the HUD asks for one.
func _process(_dt: float) -> void:
	_adapt(_dt)
	var want := false
	if not get_tree().paused and not _busy:
		for n in get_tree().get_nodes_in_group("mouse_look"):
			if n.is_inside_tree() and n.wants_mouse():
				want = true
				break
	var captured := Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	if want and not captured and not on_web():
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		captured = true
	elif not want and captured:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		captured = false
	# In a cutscene, no cursor over the picture.
	if not want and not captured and not get_tree().paused:
		var hide := Hud.cinematic
		if hide and Input.mouse_mode != Input.MOUSE_MODE_HIDDEN:
			Input.mouse_mode = Input.MOUSE_MODE_HIDDEN
		elif not hide and Input.mouse_mode == Input.MOUSE_MODE_HIDDEN:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	Hud.click_hint(want and not captured)

func _input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not get_tree().paused:
		for n in get_tree().get_nodes_in_group("mouse_look"):
			if n.is_inside_tree() and n.wants_mouse():
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
				get_viewport().set_input_as_handled()
				return

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for action in KEYS:
		InputMap.add_action(action)
		for k in KEYS[action]:
			var e := InputEventKey.new()
			e.physical_keycode = k
			InputMap.action_add_event(action, e)
	var click := InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	InputMap.action_add_event("fire", click)
	var right := InputEventMouseButton.new()
	right.button_index = MOUSE_BUTTON_RIGHT
	InputMap.action_add_event("missile", right)
	var c := ConfigFile.new()
	if c.load(SETTINGS) == OK:
		for k in settings:
			settings[k] = c.get_value("s", k, settings[k])
	_music = AudioStreamPlayer.new()
	var m: AudioStream = load("res://assets/audio/monume-space-ambient.mp3")
	if m is AudioStreamMP3:
		m.loop = true
	_music.stream = m
	add_child(_music)
	apply_settings()
	if on_web():
		_web_quality()
	else:
		_desktop_quality()
	get_tree().node_added.connect(_tune)
	await get_tree().process_frame
	# A link straight to a chapter, for testing: /play/#flight, #flight/strike.
	if on_web():
		var hash := str(JavaScriptBridge.eval("location.hash", true)).trim_prefix("#")
		var parts := hash.split("/")
		if SCENES.has(parts[0]) and parts[0] != "title":
			beat = parts[1] if parts.size() > 1 else ""
			go(parts[0])
			return
	# Whatever scene the game opened on fades up from black.
	var title := get_tree().current_scene and get_tree().current_scene.scene_file_path == SCENES.title
	Hud.fade_in(2.0 if title else 0.6)

## The browser draws on whatever the visitor has, often a laptop's
## integrated GPU at twice the screen's pixels: no MSAA, hard shadows from a
## smaller map, and the 3D drawn at a resolution that follows the frame
## rate (the 2D overlay stays sharp).
var _res := 1.0
var _pinned := false
## Set when this machine cannot hold the frame rate even at the lowest
## resolution: global illumination goes, in this scene and every later one.
var _gi_off := false
var _strain := 0
var _fps_t := 0.0
var _fps_n := 0

func _web_quality() -> void:
	var vp := get_viewport()
	vp.msaa_3d = Viewport.MSAA_DISABLED
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	RenderingServer.directional_shadow_atlas_set_size(2048, true)
	RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_HARD)
	RenderingServer.positional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_HARD)
	var px := float(vp.size.x * vp.size.y)
	_res = clampf(sqrt(2_000_000.0 / maxf(px, 1.0)), 0.5, 1.0)
	vp.scaling_3d_scale = _res

## The desktop: a retina laptop's window is four times the pixels of
## 1080p, so the 3D is drawn nearer 1080p and upscaled with FSR 2 (which also
## does the antialiasing), its resolution following the frame rate. Global
## illumination at half resolution, lighter fog volumes and ambient
## occlusion: most of the look at a fraction of the cost.
func _desktop_quality() -> void:
	var vp := get_viewport()
	vp.msaa_3d = Viewport.MSAA_DISABLED
	# FSR 2 is temporal: fine detail (grass, leaves, far rock) holds still
	# instead of crawling, and it is the antialiasing too.
	# Cinematic: FSR 2. Otherwise FSR 1 with Godot's temporal antialiasing,
	# which holds fine detail nearly as still for less than half the cost.
	if settings.cinematic:
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR2
	else:
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR
		vp.use_taa = not "--notaa" in OS.get_cmdline_user_args()
	RenderingServer.gi_set_use_half_resolution(true)
	RenderingServer.environment_set_volumetric_fog_volume_size(96, 48)
	RenderingServer.environment_set_ssao_quality(RenderingServer.ENV_SSAO_QUALITY_LOW, true, 0.5, 2, 50.0, 300.0)
	RenderingServer.environment_set_sdfgi_ray_count(RenderingServer.ENV_SDFGI_RAY_COUNT_32)
	RenderingServer.environment_set_sdfgi_frames_to_converge(RenderingServer.ENV_SDFGI_CONVERGE_IN_30_FRAMES)
	RenderingServer.environment_set_sdfgi_frames_to_update_light(RenderingServer.ENV_SDFGI_UPDATE_LIGHT_IN_16_FRAMES)
	RenderingServer.directional_shadow_atlas_set_size(4096, true)
	RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_SOFT_LOW)
	RenderingServer.positional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_SOFT_LOW)
	var px := float(vp.size.x * vp.size.y)
	_res = clampf(sqrt(2_000_000.0 / maxf(px, 1.0)), 0.5, 1.0)
	# For measuring: `-- --res 0.3` pins the 3D resolution.
	var a := OS.get_cmdline_user_args().find("--res")
	if a >= 0:
		_res = float(OS.get_cmdline_user_args()[a + 1])
		_pinned = true
	vp.scaling_3d_scale = _res

## Every environment that enters the game is trimmed of what costs most for
## least: screen-space indirect light and reflections.
func _tune(n: Node) -> void:
	if n is WorldEnvironment and (n as WorldEnvironment).environment:
		var env := (n as WorldEnvironment).environment
		env.ssil_enabled = false
		env.ssr_enabled = false
		env.sdfgi_cascades = mini(env.sdfgi_cascades, 4)
		# Global illumination is the cinematic setting; without it the
		# ambient light makes up the bounce (as the browser build does).
		if env.sdfgi_enabled and (_gi_off or not settings.cinematic):
			env.sdfgi_enabled = false
			env.ambient_light_energy *= 2.0
		if not settings.cinematic and not on_web():
			env.ssao_enabled = false
		# Volumetric fog is cinematic too; plain depth haze stands in for it.
		if env.volumetric_fog_enabled and not settings.cinematic:
			env.volumetric_fog_enabled = false
			if not env.fog_enabled:
				env.fog_enabled = true
				env.fog_light_color = Color(0.55, 0.58, 0.66)
				env.fog_density = 0.006
				env.fog_sky_affect = 0.0
		# For measuring what each effect costs.
		var args := OS.get_cmdline_user_args()
		if "--nogi" in args:
			env.sdfgi_enabled = false
		if "--nofog" in args:
			env.volumetric_fog_enabled = false
		if "--noao" in args:
			env.ssao_enabled = false
	# A shadowed point light renders its room six times over: only the
	# Sun casts shadows unless lighting is cinematic.
	if n is OmniLight3D and not settings.cinematic:
		(n as OmniLight3D).shadow_enabled = false
	if "--noshadow" in OS.get_cmdline_user_args() and n is Light3D:
		(n as Light3D).shadow_enabled = false

func _adapt(dt: float) -> void:
	_fps_t += dt
	_fps_n += 1
	if _fps_t < 1.0:
		return
	var fps := _fps_n / _fps_t
	_fps_t = 0.0
	_fps_n = 0
	if _busy or get_tree().paused or _pinned:
		return
	if fps < 45.0 and _res <= 0.51 and not _gi_off and not on_web():
		_strain += 1
		if _strain >= 2:
			_gi_off = true
			for we in get_tree().root.find_children("*", "WorldEnvironment", true, false):
				var env: Environment = (we as WorldEnvironment).environment
				if env and env.sdfgi_enabled:
					env.sdfgi_enabled = false
					env.ambient_light_energy *= 2.0
	else:
		_strain = 0
	if fps < 44.0 and _res > 0.5:
		_res = maxf(0.5, _res - 0.05)
	elif fps > 57.0 and _res < 1.0:
		_res = minf(1.0, _res + 0.05)
	get_viewport().scaling_3d_scale = _res

## Forward+ on desktop; the browser runs the Compatibility renderer, which has
## no SDFGI, volumetric fog or screen-space effects. Scenes ask this.
func high_quality() -> bool:
	return RenderingServer.get_current_rendering_method() != "gl_compatibility"

func on_web() -> bool:
	return OS.has_feature("web")

func go(scene: String) -> void:
	if _busy:
		return
	_busy = true
	await Hud.fade_out(0.8)
	Hud.reset()
	Hud.loading(true)
	await get_tree().process_frame
	get_tree().paused = false
	get_tree().change_scene_to_file(SCENES[scene])
	# Remember the furthest chapter reached, for "Continue the journey".
	if scene in ["corridor", "bridge", "hangar", "flight", "arrival", "hearth", "hearth_bay", "test_flight", "blackbox", "descent"]:
		set_progress("chapter", scene)
	ambience(scene in ["corridor", "bridge", "hangar", "arrival", "hearth", "hearth_bay"])
	await get_tree().process_frame
	await get_tree().process_frame
	_busy = false
	Hud.loading(false)
	Hud.fade_in(1.2)

## The chapter after this one, for "Skip this part" in the pause menu.
func next_scene() -> String:
	var here := get_tree().current_scene.scene_file_path if get_tree().current_scene else ""
	var order := ["intro", "corridor", "bridge", "hangar", "flight", "arrival", "hearth", "hearth_bay", "test_flight", "blackbox", "descent", "act1_end", "title"]
	for i in order.size() - 1:
		if SCENES[order[i]] == here:
			return order[i + 1]
	return ""

func in_title() -> bool:
	return get_tree().current_scene != null and get_tree().current_scene.scene_file_path == SCENES.title

var _hum: AudioStreamPlayer

## The low hum of a ship's interior: air handlers and the reactor far off.
func ambience(on: bool) -> void:
	if not _hum:
		_hum = AudioStreamPlayer.new()
		_hum.stream = Sfx.hum_stream()
		add_child(_hum)
	if on and not _hum.playing:
		_hum.volume_db = -40.0
		_hum.play()
		create_tween().tween_property(_hum, "volume_db", -17.0 + sfx_db(), 2.0)
	elif not on and _hum.playing:
		var t := create_tween()
		t.tween_property(_hum, "volume_db", -40.0, 1.0)
		t.tween_callback(_hum.stop)

func music(on: bool) -> void:
	if on and not _music.playing:
		_music.volume_db = -40.0
		_music.play()
		create_tween().tween_property(_music, "volume_db", _db(settings.music), 3.0)
	elif not on and _music.playing:
		var t := create_tween()
		t.tween_property(_music, "volume_db", -40.0, 2.0)
		t.tween_callback(_music.stop)

func sfx_db() -> float:
	return _db(settings.sfx)

func apply_settings() -> void:
	if _music.playing:
		_music.volume_db = _db(settings.music)
	var c := ConfigFile.new()
	for k in settings:
		c.set_value("s", k, settings[k])
	c.save(SETTINGS)

func _db(v: float) -> float:
	return -80.0 if v <= 0.001 else linear_to_db(v)

func progress(key: String, default = null):
	var c := ConfigFile.new()
	c.load(PROGRESS)
	return c.get_value("p", key, default)

func set_progress(key: String, value) -> void:
	var c := ConfigFile.new()
	c.load(PROGRESS)
	c.set_value("p", key, value)
	c.save(PROGRESS)

## Act One is the web game. In the browser this is the same site, so the
## prologue tells it the pilot has already lived through the Aster.
## The pilot's money: credits in hand, and what is still owed to Rook.
func credits() -> int:
	return int(progress("credits", 0))

func debt() -> int:
	return int(progress("debt", 40000))

## Pay the pilot; half of every job goes straight to Rook until the debt is
## cleared. Returns [paid to the pilot, paid off the debt].
func earn(amount: int) -> Array:
	var to_debt := mini(debt(), amount / 2)
	set_progress("debt", debt() - to_debt)
	set_progress("credits", credits() + amount - to_debt)
	return [amount - to_debt, to_debt]

func open_act_one() -> void:
	set_progress("prologue_done", true)
	if on_web():
		JavaScriptBridge.eval("try { localStorage.setItem('pz-prologue-done', '1') } catch (e) {}; location.href = '/#game'", true)
	else:
		OS.shell_open(ACT_ONE)
