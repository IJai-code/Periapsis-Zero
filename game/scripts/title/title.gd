extends Node3D
## The title: Hearth's lake from its pier, under the nebulae (the Reach
## itself, in its backdrop mode); the logo top left, the menu under it in
## big friendly words, a little planet bobbing by the one chosen (Explore
## the Cosmos opens the simulator); links bottom left, the version bottom
## right.

const CREAM := Color("#fbf1dc")
const INK := Color("#3a2618")

var _menu: VBoxContainer
var _settings: PanelContainer
var _help: Control
var _items: Array[Button] = []
var _marker: Control
var _t := 0.0
var _confirm := false

func _ready() -> void:
	# A link straight into the game (#reach, #hearth, #flight...) does not
	# need the title's backdrop, and on a small machine building it first is
	# most of the wait: Flow changes scene from the address as soon as the
	# first frame is up.
	if Flow.start_scene == "":
		var reach: Node = load("res://scenes/reach.tscn").instantiate()
		reach.set_meta("backdrop", true)
		add_child(reach)
		# --noui (or ?noui in the browser): the backdrop alone, for the
		# website's front page.
		var noui := "--noui" in OS.get_cmdline_user_args() or (OS.has_feature("web") and str(JavaScriptBridge.eval("location.search", true)).contains("noui"))
		if not noui:
			_ui()
		# The backdrop says when it has a picture (Reach._backdrop): the
		# village is made a piece at a time, and the browser's loading
		# screen should stay up until then.
	Flow.music(false)

func _process(dt: float) -> void:
	_t += dt
	_update_progress()
	if _marker:
		_marker.queue_redraw()

func _ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = ReachStyle.theme()
	layer.add_child(root)
	# A soft shade on the left, enough for the words to read.
	var g := Gradient.new()
	g.set_color(0, Color(0.06, 0.04, 0.03, 0.55))
	g.set_color(1, Color(0.06, 0.04, 0.03, 0.0))
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill_to = Vector2(1, 0)
	var wash := TextureRect.new()
	wash.texture = gt
	wash.stretch_mode = TextureRect.STRETCH_SCALE
	wash.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	wash.custom_minimum_size = Vector2(760, 0)
	wash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(wash)
	# The logo.
	var logo := _Logo.new()
	logo.position = Vector2(70, 36)
	logo.size = Vector2(760, 300)
	logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(logo)
	# The menu.
	_menu = VBoxContainer.new()
	_menu.position = Vector2(150, 360)
	_menu.add_theme_constant_override("separation", 4)
	root.add_child(_menu)
	_marker = Control.new()
	_marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_marker.size = Vector2(60, 60)
	_marker.draw.connect(_paint_marker)
	root.add_child(_marker)
	_fill_menu()
	# Links, bottom left; the version, bottom right.
	var links := VBoxContainer.new()
	links.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	links.grow_vertical = Control.GROW_DIRECTION_BEGIN
	links.offset_left = 150
	links.offset_bottom = -34
	links.add_theme_constant_override("separation", 6)
	root.add_child(links)
	for text in ["Free in your browser  ·  periapsiszero.dev", "Download for Mac, Windows and Linux"]:
		links.add_child(_small(text, 20))
	var ver := _small("Periapsis Zero  ·  The Reach  ·  early build %s" % Time.get_date_string_from_unix_time(Build.STAMP), 17)
	ver.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	ver.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	ver.grow_vertical = Control.GROW_DIRECTION_BEGIN
	ver.offset_right = -30
	ver.offset_bottom = -22
	root.add_child(ver)
	_check_update()
	var told := Graphics.take_notice()
	if told != "":
		Hud.prompt("Performance graphics are on, chosen for %s. You can change it in Settings, under Graphics." % GRAPHICS_WHY.get(told, "this PC"), 9.0)
	_settings = _settings_panel()
	_settings.visible = false
	root.add_child(_settings)
	_help = _help_panel()
	_help.visible = false
	root.add_child(_help)

func _small(text: String, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", ReachStyle.round)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", CREAM)
	l.add_theme_constant_override("outline_size", 7)
	l.add_theme_color_override("font_outline_color", Color(INK, 0.85))
	return l

## The menu's lines, for now: the game, a new start, the road here, settings.
func _fill_menu() -> void:
	for c in _menu.get_children():
		c.queue_free()
	_items.clear()
	if _confirm:
		_button("Yes, start over", func():
			for key in ["reach_facts", "reach_read", "reach_loops", "reach_finished", "reach_signals"]:
				Flow.set_progress(key, null)
			Flow.go("reach"))
		_button("Keep my ship's log", func():
			_confirm = false
			_fill_menu())
		var note := _small("A new start forgets everything your ship's log has learned.", 19)
		_menu.add_child(note)
	else:
		var loops := int(Flow.progress("reach_loops", 0))
		if loops > 0:
			_button("Continue", func(): Flow.go("reach"))
			_button("New Game", func():
				_confirm = true
				_fill_menu())
		else:
			_button("New Game", func(): Flow.go("reach"))
		var done: bool = Flow.progress("prologue_done", false)
		var seen: bool = Flow.progress("intro_seen", false)
		var chapter: String = Flow.progress("chapter", "hearth" if done else ("corridor" if seen else "intro"))
		if done and not chapter in ["hearth", "hearth_bay", "test_flight", "blackbox", "descent", "act1_end"]:
			chapter = "hearth"
		_button("The Road Here", func(): Flow.go(chapter if done or seen else "intro"))
		_button("Explore the Cosmos", Flow.open_sim)
		_button("How to Play", _toggle_help)
		_button("Settings", _toggle_settings)
		if not Flow.on_web():
			_button("Quit", get_tree().quit)
	await get_tree().process_frame
	if not _items.is_empty():
		_items[0].grab_focus()

## A menu line: big rounded words, cream on a dark outline; the chosen one
## warmer, with the little planet beside it.
func _button(text: String, action: Callable, _primary := false) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var none := StyleBoxEmpty.new()
	none.content_margin_left = 6
	none.content_margin_top = 0
	none.content_margin_bottom = 0
	for st in ["normal", "hover", "focus", "pressed", "hover_pressed"]:
		b.add_theme_stylebox_override(st, none)
	b.add_theme_font_override("font", ReachStyle.round_bold)
	b.add_theme_font_size_override("font_size", 50)
	b.add_theme_constant_override("outline_size", 16)
	b.add_theme_color_override("font_outline_color", Color(INK, 0.9))
	b.add_theme_color_override("font_color", CREAM)
	for st in ["font_hover_color", "font_focus_color", "font_pressed_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(st, Color("#ffd9a0"))
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.focus_entered.connect(func(): Sfx.play("click", -20.0, 1.6))
	b.mouse_entered.connect(func(): b.grab_focus())
	b.pressed.connect(func():
		Sfx.play("click", -8.0)
		action.call())
	_menu.add_child(b)
	_items.append(b)
	return b

## The marker: a little ringed planet, bobbing, by the chosen line.
func _paint_marker() -> void:
	var focused: Control = get_viewport().gui_get_focus_owner()
	if not focused or not focused in _items:
		return
	var r := focused.get_global_rect()
	_marker.global_position = Vector2(r.position.x - 64, r.position.y + r.size.y * 0.5 - 30 + sin(_t * 3.0) * 3.0)
	var c := Vector2(30, 30)
	# The ring behind, the planet, the ring in front.
	_marker.draw_arc(c, 22.0, PI, TAU, 24, INK, 7.0, true)
	_marker.draw_set_transform(c, -0.35, Vector2(1.0, 0.36))
	_marker.draw_arc(Vector2.ZERO, 24.0, PI, TAU, 28, INK, 8.0, true)
	_marker.draw_arc(Vector2.ZERO, 24.0, PI, TAU, 28, Color("#ffb36b"), 4.0, true)
	_marker.draw_set_transform(Vector2.ZERO)
	_marker.draw_circle(c, 13.0, INK)
	_marker.draw_circle(c, 10.5, Color("#7fae74"))
	_marker.draw_circle(c + Vector2(-3, -3), 4.5, Color("#a9d39a"))
	_marker.draw_set_transform(c, -0.35, Vector2(1.0, 0.36))
	_marker.draw_arc(Vector2.ZERO, 24.0, 0.0, PI, 28, INK, 8.0, true)
	_marker.draw_arc(Vector2.ZERO, 24.0, 0.0, PI, 28, Color("#ffb36b"), 4.0, true)
	_marker.draw_set_transform(Vector2.ZERO)


## The logo: "Periapsis" over a huge "ZER" and a planet for the O, a little
## ship on its ring; cream letters, a thick dark outline, a drop shadow.
class _Logo extends Control:
	var _t := 0.0

	func _process(dt: float) -> void:
		_t += dt
		queue_redraw()

	func _word(text: String, at: Vector2, size: int) -> float:
		var f: Font = ReachStyle.chunky
		for o in [[Vector2(5, 7), Color(0, 0, 0, 0.35), 0], [Vector2.ZERO, INK, 18], [Vector2.ZERO, CREAM, 0]]:
			if int(o[2]) > 0:
				draw_string_outline(f, at + o[0], text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, int(o[2]), o[1])
			else:
				draw_string(f, at + o[0], text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, o[1])
		return f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x

	func _draw() -> void:
		_word("Periapsis", Vector2(30, 84), 84)
		var w := _word("ZER", Vector2(6, 238), 170)
		# The O: a planet with a ring, the Kestrel going round it.
		var c := Vector2(6 + w + 70, 178)
		var ring := func(from: float, to: float):
			draw_set_transform(c, -0.32, Vector2(1.0, 0.34))
			draw_arc(Vector2.ZERO, 98.0, from, to, 48, INK, 20.0, true)
			draw_arc(Vector2.ZERO, 98.0, from, to, 48, Color("#ffb36b"), 9.0, true)
			draw_set_transform(Vector2.ZERO)
		# The ship on the ring: on its far half (the upper, sin < 0) it goes
		# behind the planet, so it is drawn before it; on the near half, after
		# the front of the ring.
		var a := _t * 0.6
		var p := c + Vector2(cos(a) * 98.0, sin(a) * 98.0 * 0.34).rotated(-0.32)
		var behind := sin(a) < 0.0
		ring.call(PI, TAU)
		if behind:
			draw_circle(p, 9.0, INK)
			draw_circle(p, 6.0, Color("#e8853d"))
		draw_circle(c + Vector2(5, 7), 62.0, Color(0, 0, 0, 0.35))
		draw_circle(c, 64.0, INK)
		draw_circle(c, 55.0, Color("#6fa86a"))
		draw_circle(c + Vector2(14, 12), 40.0, Color("#5b9459"))
		draw_circle(c + Vector2(-18, -18), 20.0, Color("#9fd08e"))
		draw_circle(c + Vector2(20, -24), 8.0, Color("#fbf1dc", 0.8))
		ring.call(0.0, PI)
		if not behind:
			draw_circle(p, 9.0, INK)
			draw_circle(p, 6.0, Color("#e8853d"))
func _toggle_settings() -> void:
	_settings.visible = not _settings.visible
	if _help:
		_help.visible = false

func _toggle_help() -> void:
	_help.visible = not _help.visible
	_settings.visible = false

## The game in plain words, on the title screen: the goal, the first few
## minutes, the keys, and the words the Reach uses. The pause menu's help
## says the same in game; this is what a new pilot reads before starting.
const HELP_GOAL := "You are a pilot who crashed on a little world called Hearthstone. Find out what happened to the Aster, the freighter you were escorting, and why the same day keeps repeating. Every twenty-two minutes the star at the middle of the Reach goes out, and you wake by the campfire again. Nobody else remembers. What you learn is the only thing you keep."
const HELP_STEPS := [
	"Talk to Mara by the fire: look at her and press E.",
	"Get your ship's launch codes from Okafor, in the glass-domed observatory.",
	"Ride the lift up the launch tower, and climb into your ship through the hatch underneath (E).",
	"Hold Space to lift off. Look at a world, press T to lock onto it, then G to fly there.",
	"Near a world, let go and the ship holds still. Hold Shift to set her down. E steps out.",
]
const HELP_KEYS := [
	["W A S D", "walk, or fly"], ["Mouse", "look and steer"],
	["Space", "jump (hold for higher), lift off"], ["Shift", "run, sink and land"],
	["E", "talk, use, read"], ["X", "signalscope"],
	["L", "ship log"], ["M", "map"], ["Esc", "pause and every key"],
]
const HELP_WORDS := [
	["Your ship", "the Kestrel, a small two-engine craft on the launch tower"],
	["The star", "the Lantern, which the five worlds go round. It is dying"],
	["The loop", "every 22 minutes the star goes out and you wake at the fire again"],
	["Ship log (L)", "your notebook: what you have learned, and where it points"],
	["Signalscope (X)", "hears music and signals; turn toward the loudest and follow it"],
	["The Choir", "the people who lived here long ago; they wrote in spirals"],
	["Songline", "a spiral of the Choir's writing; look at it and press E"],
	["Hearthstone", "home: the village, the lake, the observatory, the tower"],
	["Verdance, Ashfall", "the jungle world, and the volcanic moon"],
	["The Phantom, the Wanderer", "the moon that moves, and the comet"],
]

func _help_panel() -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", ReachStyle.panel(14))
	# The right side of the screen, whatever its height: the words scroll
	# rather than run off a laptop's screen.
	p.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	p.offset_left = -700
	p.offset_right = -96
	p.offset_top = 46
	p.offset_bottom = -46
	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 10)
	p.add_child(outer)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	outer.add_child(scroll)
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(552, 0)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_theme_constant_override("separation", 8)
	scroll.add_child(v)
	v.add_child(ReachStyle.title("How to play", 34, ReachStyle.EMBER))
	var goal := ReachStyle.label(HELP_GOAL, 17, ReachStyle.BONE)
	goal.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	goal.custom_minimum_size = Vector2(552, 0)
	v.add_child(goal)
	var steps := ReachStyle.label("YOUR FIRST FEW MINUTES", 15, ReachStyle.EMBER)
	steps.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(steps)
	for i in HELP_STEPS.size():
		var row := ReachStyle.label("%d.  %s" % [i + 1, HELP_STEPS[i]], 16, ReachStyle.BONE)
		row.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		row.custom_minimum_size = Vector2(552, 0)
		v.add_child(row)
	var keys := ReachStyle.label("THE KEYS", 15, ReachStyle.EMBER)
	keys.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(keys)
	for k: Array in HELP_KEYS:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 10)
		var cap := PanelContainer.new()
		cap.add_theme_stylebox_override("panel", ReachStyle.keycap())
		var key := ReachStyle.label(k[0], 13, ReachStyle.CHARCOAL, true)
		key.add_theme_font_override("font", Style.mono_bold)
		cap.add_child(key)
		h.add_child(cap)
		h.add_child(ReachStyle.label(k[1], 16, ReachStyle.BONE))
		v.add_child(h)
	var words := ReachStyle.label("THE WORDS", 15, ReachStyle.EMBER)
	words.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(words)
	for w: Array in HELP_WORDS:
		var row := ReachStyle.label("%s:  %s" % [w[0], w[1]], 15, ReachStyle.BONE)
		row.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		row.custom_minimum_size = Vector2(552, 0)
		v.add_child(row)
	# The way out stays out of the scrolling words.
	var close := Button.new()
	close.text = "Close"
	close.size_flags_horizontal = Control.SIZE_SHRINK_END
	close.pressed.connect(_toggle_help)
	outer.add_child(close)
	return p

func _settings_panel() -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", ReachStyle.panel(12))
	p.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	p.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	p.grow_vertical = Control.GROW_DIRECTION_BOTH
	p.offset_right = -96
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	v.custom_minimum_size = Vector2(380, 0)
	p.add_child(v)
	v.add_child(ReachStyle.title("Settings", 30, ReachStyle.EMBER))
	for row in [["Music", "music", 0.0, 1.0], ["Effects", "sfx", 0.0, 1.0], ["Mouse speed", "mouse", 0.3, 2.5]]:
		v.add_child(Style.label(row[0], 20))
		var s := HSlider.new()
		s.min_value = row[2]
		s.max_value = row[3]
		s.step = 0.05
		s.value = Flow.settings[row[1]]
		var key: String = row[1]
		s.value_changed.connect(func(x):
			Flow.settings[key] = x
			Flow.apply_settings())
		v.add_child(s)
	var inv := CheckBox.new()
	inv.text = "Invert mouse"
	inv.button_pressed = Flow.settings.invert
	inv.toggled.connect(func(on):
		Flow.settings.invert = on
		Flow.apply_settings())
	v.add_child(inv)
	if Flow.high_quality():
		var gi := CheckBox.new()
		gi.text = "Cinematic lighting (needs a strong GPU)"
		gi.button_pressed = Flow.settings.cinematic
		gi.toggled.connect(func(on):
			Flow.settings.cinematic = on
			Flow.apply_settings())
		v.add_child(gi)
	if Graphics.available():
		_graphics_row(v)
	var close := Button.new()
	close.text = "Done"
	close.pressed.connect(_toggle_settings)
	v.add_child(close)
	return p

const GRAPHICS_WHY := {"gpu": "this PC's graphics chip", "crash": "the last session stopping unexpectedly", "frame rate": "a low frame rate"}

## Graphics: the full renderer or the light one (Updater). The choice takes
## a restart, offered on the spot.
func _graphics_row(v: VBoxContainer) -> void:
	v.add_child(Style.label("Graphics", 20))
	var pick := OptionButton.new()
	for item in ["Auto", "Full detail", "Performance (older PCs)"]:
		pick.add_item(item)
	var modes := ["auto", "full", "light"]
	pick.selected = modes.find(Graphics.graphics_mode())
	v.add_child(pick)
	var note := Style.label("", 14, Style.MUTE)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size = Vector2(380, 0)
	v.add_child(note)
	var restart := Button.new()
	restart.text = "Restart to apply"
	restart.visible = false
	restart.pressed.connect(Graphics.restart)
	v.add_child(restart)
	var why := GRAPHICS_WHY
	var show := func():
		if Graphics.is_light():
			var reason: String = why.get(Graphics.light_reason(), "")
			note.text = "Running on performance graphics" + (", chosen for " + reason if reason != "" and Graphics.graphics_mode() == "auto" else "") + "."
		else:
			note.text = "Running on full detail."
	show.call()
	pick.item_selected.connect(func(i: int):
		restart.visible = Graphics.set_graphics_mode(modes[i])
		show.call())

## A downloaded copy keeps itself current (Updater): the notice says when a
## newer build is on its way, when it is ready, and, for a release the app
## cannot take in place (a new engine), offers the download. Progress is
## kept either way: it lives in the user folder, not in the app.
var _notice: PanelContainer
var _notice_head: Label
var _notice_body: Label
var _notice_note: Label
var _notice_button: Button

func _check_update() -> void:
	Updater.changed.connect(_update_notice)
	_update_notice()

func _update_notice() -> void:
	var s: int = Updater.state
	if not s in [Updater.DOWNLOADING, Updater.VERIFYING, Updater.READY, Updater.REINSTALL]:
		return
	if _notice == null:
		_build_notice()
	var when := ("  ·  " + Updater.date) if Updater.date != "" else ""
	_notice_button.visible = s in [Updater.READY, Updater.REINSTALL]
	if s == Updater.READY:
		_notice_head.text = "UPDATE READY" + when
		_notice_body.text = "The new version is downloaded."
		_notice_note.text = "It starts the next time you open the game."
		_notice_button.text = "Restart now"
	elif s == Updater.REINSTALL:
		_notice_head.text = "NEW VERSION" + when
		_notice_body.text = "This update needs a fresh download."
		_notice_note.text = "Your progress is kept when you install it."
		_notice_button.text = "Download the update"
	else:
		_notice_head.text = "UPDATING" + when
		_notice_body.text = "Downloading the new version."
		_update_progress()

func _update_progress() -> void:
	if _notice and Updater.state in [Updater.DOWNLOADING, Updater.VERIFYING]:
		_notice_note.text = "%d%% of %d MB. Keep playing; it is ready next time." % [roundi(Updater.progress() * 100.0), ceili(Updater.download_size() / 1e6)]

func _build_notice() -> void:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", Style.panel(12))
	p.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	p.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	p.offset_right = -40
	p.offset_top = 40
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	p.add_child(v)
	_notice_head = Style.label("", 13, Style.EMBER, Style.mono_bold)
	_notice_body = Style.label("", 20, Style.BONE, Style.sans_bold)
	_notice_note = Style.label("", 15, Style.MUTE)
	v.add_child(_notice_head)
	v.add_child(_notice_body)
	v.add_child(_notice_note)
	_notice_button = Button.new()
	_notice_button.pressed.connect(func():
		if Updater.state == Updater.READY:
			Graphics.restart()
		else:
			var os := OS.get_name()
			var file := "PeriapsisZero-mac.zip" if os == "macOS" else ("PeriapsisZero-windows.zip" if os == "Windows" else "PeriapsisZero-linux.tar.gz")
			OS.shell_open("https://github.com/IJai-code/Periapsis-Zero/releases/download/desktop/" + file))
	v.add_child(_notice_button)
	var layer := CanvasLayer.new()
	layer.layer = 8
	add_child(layer)
	var holder := Control.new()
	holder.theme = Style.theme()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(holder)
	holder.add_child(p)
	_notice = p
