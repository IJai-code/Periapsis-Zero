extends Node
## The game's spine: scene changes behind a fade, settings, music, progress,
## and the handoff to Act One on periapsiszero.dev.

const SETTINGS := "user://settings.cfg"
const PROGRESS := "user://progress.cfg"
const ACT_ONE := "https://periapsiszero.dev/#game"
const SCENES := {
	"title": "res://scenes/title.tscn",
	"corridor": "res://scenes/prologue_corridor.tscn",
	"bridge": "res://scenes/prologue_bridge.tscn",
	"hangar": "res://scenes/prologue_hangar.tscn",
	"flight": "res://scenes/prologue_flight.tscn",
	"arrival": "res://scenes/prologue_arrival.tscn",
}

var settings := {"music": 0.6, "sfx": 0.8, "mouse": 1.0, "invert": false}
var _music: AudioStreamPlayer
var _busy := false
## A chapter's starting beat, from a test link or `-- --beat`.
var beat := ""

## Keys, defined here rather than in project.godot so they read as a list.
## Flight matches the web game: W/S thrust, A/D strafe, Q/E roll, mouse aims.
const KEYS := {
	"forward": [KEY_W, KEY_UP], "back": [KEY_S, KEY_DOWN],
	"left": [KEY_A, KEY_LEFT], "right": [KEY_D, KEY_RIGHT],
	"roll_left": [KEY_Q], "roll_right": [KEY_E],
	"up": [KEY_SPACE], "down": [KEY_C],
	"interact": [KEY_E, KEY_F], "boost": [KEY_SHIFT],
	"fire": [KEY_K], "pause": [KEY_ESCAPE, KEY_P], "skip": [KEY_ENTER],
}

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
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	await Hud.fade_out(0.8)
	Hud.reset()
	Hud.loading(true)
	await get_tree().process_frame
	get_tree().paused = false
	get_tree().change_scene_to_file(SCENES[scene])
	await get_tree().process_frame
	await get_tree().process_frame
	_busy = false
	Hud.loading(false)
	Hud.fade_in(1.2)

## The chapter after this one, for "Skip this part" in the pause menu.
func next_scene() -> String:
	var here := get_tree().current_scene.scene_file_path if get_tree().current_scene else ""
	var order := ["corridor", "bridge", "hangar", "flight", "arrival", "title"]
	for i in order.size() - 1:
		if SCENES[order[i]] == here:
			return order[i + 1]
	return ""

func in_title() -> bool:
	return get_tree().current_scene != null and get_tree().current_scene.scene_file_path == SCENES.title

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
func open_act_one() -> void:
	set_progress("prologue_done", true)
	if on_web():
		JavaScriptBridge.eval("try { localStorage.setItem('pz-prologue-done', '1') } catch (e) {}; location.href = '/#game'", true)
	else:
		OS.shell_open(ACT_ONE)
