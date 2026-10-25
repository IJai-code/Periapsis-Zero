class_name ReachIntro
extends Node
## The first time the Reach is opened: a minute of the game itself, filmed
## live (every shot is the real world at a chosen hour), under the whole
## song, with a caption a shot telling what this is. Letterboxed. Any key,
## or a click, skips it. Then the morning begins as always.
##
## Shots are [world, loop seconds, camera from, camera to, look at, caption,
## seconds]; the points are worked out from the world's own landmarks once
## its frame is ruling (see _shot).

signal finished

var reach: Node
var _cam: Camera3D
var _layer: CanvasLayer
var _caption: Label
var _title: Label
var _veil: ColorRect
var _skip := false
var _music: AudioStreamPlayer

const SHOTS := [
	["lantern", 900.0, "system", "", "", "The Reach. Five small worlds round a dying star, the Lantern.", 6.5],
	["ashfall", 1100.0, "wreck_high", "wreck_low", "wreck", "Three days ago the freighter Aster was ambushed at the Fold, and came down burning on Ashfall.", 7.0],
	["hearthstone", 820.0, "tower_low", "tower_high", "ship", "You flew her escort, the Kestrel. The village of Hearth pulled you out of the wreck and patched her up.", 7.0],
	["hearthstone", 1290.0, "lookout", "lookout_in", "lantern", "This morning, the star began to die. Twenty-two minutes, and it goes out.", 6.5],
	["hearthstone", 20.0, "fire_far", "fire_near", "fire", "Then the same morning comes back. Nobody remembers it. Only you...", 6.5],
	["ashfall", 1100.0, "vault_high", "vault_near", "vault", "...and Rook, whose drones brought her down. He has lived this morning longer than you have.", 7.0],
	["wanderer", 1230.0, "engine_out", "engine_door", "engine", "Out on the comet, a machine has waited a century for what the Aster carried.", 6.5],
	["wanderer", 1230.0, "engine_in", "engine_in2", "socket", "Whoever reaches it first decides what the morning becomes.", 6.0],
	["hearthstone", 820.0, "rim_high", "rim_low", "village", "", 7.0],
]

func _ready() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 40
	add_child(_layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(root)
	for top in [true, false]:
		var bar := ColorRect.new()
		bar.color = Color(0, 0, 0)
		bar.set_anchors_preset(Control.PRESET_TOP_WIDE if top else Control.PRESET_BOTTOM_WIDE)
		bar.custom_minimum_size = Vector2(0, 0)
		if top:
			bar.offset_bottom = 0
			bar.anchor_bottom = 0.11
		else:
			bar.anchor_top = 0.89
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(bar)
	_caption = ReachStyle.label("", 28, ReachStyle.BONE)
	_caption.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_caption.add_theme_font_override("font", ReachStyle.serif_italic)
	_caption.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_caption.anchor_top = 0.80
	_caption.anchor_bottom = 0.88
	_caption.anchor_left = 0.12
	_caption.anchor_right = 0.88
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_caption.modulate.a = 0.0
	root.add_child(_caption)
	_title = ReachStyle.title("Periapsis Zero", 76, ReachStyle.EMBER)
	_title.set_anchors_preset(Control.PRESET_CENTER)
	_title.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_title.grow_vertical = Control.GROW_DIRECTION_BOTH
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.modulate.a = 0.0
	root.add_child(_title)
	var hint := ReachStyle.label("Any key to skip", 13, ReachStyle.MUTE)
	hint.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	hint.offset_left = -170
	hint.offset_top = -40
	root.add_child(hint)
	_veil = ColorRect.new()
	_veil.color = Color(0, 0, 0, 1)
	_veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	_veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_veil)
	_cam = Camera3D.new()
	_cam.fov = 58.0
	_cam.near = 0.1
	_cam.far = 60000.0
	reach.add_child(_cam)
	_music = AudioStreamPlayer.new()
	_music.stream = load("res://audio/reach/launch.wav")
	_music.volume_db = -4.0 + Flow.music_db()
	add_child(_music)

func _input(e: InputEvent) -> void:
	if (e is InputEventKey and e.pressed and not e.echo) or (e is InputEventMouseButton and e.pressed):
		_skip = true
		get_viewport().set_input_as_handled()

## The whole film; awaitable.
func play() -> void:
	var sys: ReachSystem = reach.system
	var hud_was: bool = reach.hud.visible
	reach.hud.visible = false
	var ex: Node = reach.player
	var ex_mode: int = ex.process_mode
	ex.process_mode = Node.PROCESS_MODE_DISABLED
	_cam.make_current()
	sys.focus = _cam
	# Every world the film visits, woken once behind the black, so each is
	# drawn whole the moment its shot begins.
	for key in ["ashfall", "wanderer", "hearthstone"]:
		sys.switch(key)
		(reach.planets[key] as Planet).set_ref(true)
		sys.place()
		_cam.global_position = sys.world(key) + Vector3(0, (sys.bodies[key] as ReachBody).radius + 60.0, 0)
		for i in 6:
			await get_tree().process_frame
	_music.play()
	for shot: Array in SHOTS:
		if _skip:
			break
		await _shot(shot)
	if not _skip:
		# The title over the crater, then black.
		var t := create_tween()
		t.tween_property(_title, "modulate:a", 1.0, 1.4)
		t.tween_interval(2.4)
		t.tween_property(_veil, "color:a", 1.0, 1.2)
		while t.is_running() and not _skip:
			await get_tree().process_frame
	_veil.color.a = 1.0
	var fade := create_tween()
	fade.tween_property(_music, "volume_db", -60.0, 1.2)
	await get_tree().create_timer(0.4).timeout
	Flow.set_progress("intro_seen", true)
	ex.process_mode = ex_mode
	reach.hud.visible = hud_was
	reach.hud.blackout()
	sys.running = true
	_cam.queue_free()
	finished.emit()
	queue_free.call_deferred()

func _shot(shot: Array) -> void:
	var sys: ReachSystem = reach.system
	var key: String = shot[0]
	sys.t = float(shot[1])
	sys.running = false
	if key != "lantern":
		sys.switch(key)
		if reach.planets.has(key):
			(reach.planets[key] as Planet).set_ref(true)
	else:
		sys.switch("lantern")
	sys.place()
	# The camera there first: the frame follows the focus, and left where the
	# last shot was it would pull the frame back to that world.
	reach.system.focus = _cam
	_cam.global_position = _point(key, String(shot[2]))
	await get_tree().physics_frame
	await get_tree().process_frame
	if key != "lantern" and sys.ref != key:
		sys.switch(key)
		sys.place()
	var a := _point(key, String(shot[2]))
	var b := _point(key, String(shot[3])) if String(shot[3]) != "" else a + (_point(key, "system_end") - a)
	var look := _point(key, String(shot[4])) if String(shot[4]) != "" else _point(key, "lantern_c")
	var up := _up(key, a)
	var dur: float = shot[6]
	reach.system.focus = _cam
	_cam.make_current()
	_cam.global_position = a
	_cam.look_at(look, up)
	_caption.text = String(shot[5])
	var t := create_tween().set_parallel(true)
	t.tween_method(func(k: float):
		if not _cam.current:
			_cam.make_current()
		var p := a.lerp(b, smoothstep(0.0, 1.0, k))
		_cam.global_position = p
		_cam.look_at(look, _up(key, p)), 0.0, 1.0, dur)
	t.tween_property(_veil, "color:a", 0.0, 0.9)
	t.tween_property(_caption, "modulate:a", 1.0 if _caption.text != "" else 0.0, 1.0).set_delay(0.5)
	var end := create_tween()
	end.tween_interval(dur - 0.9)
	end.tween_property(_veil, "color:a", 1.0, 0.9)
	end.parallel().tween_property(_caption, "modulate:a", 0.0, 0.7)
	while end.is_running() and not _skip:
		await get_tree().process_frame
	t.kill()
	end.kill()

func _up(key: String, at: Vector3) -> Vector3:
	if key == "lantern":
		return Vector3.UP
	var c: Vector3 = reach.system.world(key)
	return (at - c).normalized()

## A named point of a shot, in the world as it stands now.
func _point(key: String, what: String) -> Vector3:
	var sys: ReachSystem = reach.system
	var lantern: Vector3 = sys.world("lantern")
	match what:
		"system":
			return lantern + Vector3(-5200, 2600, 7600)
		"system_end":
			return lantern + Vector3(-4200, 1900, 6100)
		"lantern_c", "lantern":
			return lantern
	var b: ReachBody = sys.bodies[key]
	var c: Vector3 = sys.world(key)
	var mark := func(name: String, east := 0.0, north := 0.0, h := 0.0) -> Vector3:
		var xf := Worlds.place(b, name)
		var p := xf.origin + xf.basis.x * east - xf.basis.z * north
		var d := p.normalized()
		return c + d * (b.radius + Worlds.height(key, d, b.radius) + h)
	match what:
		"wreck_high": return mark.call("vex", 0.0, 0.0, 15.0)
		"wreck_low": return mark.call("vex", 0.0, 0.0, 9.0) + (mark.call("wreck") - mark.call("vex")) * 0.22
		"wreck": return mark.call("wreck", 0.0, 0.0, 2.0)
		"vault_high": return mark.call("vault", 30.0, -40.0, 30.0)
		"vault_near": return mark.call("vault", 14.0, -20.0, 8.0)
		"vault": return mark.call("vault", 0.0, 0.0, 3.0)
		"ship":
			return reach.ship.global_position
		"tower_low": return mark.call("pad", -34.0, 30.0, 26.0)
		"tower_high": return mark.call("pad", -20.0, 18.0, 33.0)
		"lookout": return mark.call("lookout", 0.0, 0.0, 3.0)
		"lookout_in": return mark.call("lookout", 0.0, 0.0, 2.0) + (mark.call("village") - mark.call("lookout")) * 0.05
		"fire": return mark.call("village", 0.0, 0.0, 0.8)
		"fire_far": return mark.call("village", 9.0, 7.0, 3.2)
		"fire_near": return mark.call("village", 4.0, 3.2, 1.7)
		"village": return mark.call("village", 0.0, 0.0, 6.0)
		"rim_high": return mark.call("village", -80.0, -60.0, 60.0)
		"rim_low": return mark.call("village", -55.0, -40.0, 38.0)
	if key == "wanderer":
		var wan: WandererSite = (reach.planets["wanderer"] as Planet).sites[0]
		var e := wan.engine.global_transform
		match what:
			"engine_out": return e * Vector3(-6, 6, 30)
			"engine_door": return e * Vector3(0, 3.5, 18)
			"engine": return e * Vector3(0, 3, 0)
			"engine_in": return e * Vector3(-3, 1.8, 5.5)
			"engine_in2": return e * Vector3(3, 2.4, 4.0)
			"socket": return e * Vector3(0, 2.6, 0)
	return c
