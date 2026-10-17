extends Node3D
## The title: Hearth at midnight under the nebulae (the Reach itself, in its
## backdrop mode), the fire and the band, and the way in.

var _menu: VBoxContainer
var _settings: PanelContainer
var _items: Array[Button] = []

func _ready() -> void:
	var reach: Node = load("res://scenes/reach.tscn").instantiate()
	reach.set_meta("backdrop", true)
	add_child(reach)
	if not "--noui" in OS.get_cmdline_user_args():
		_ui()
	Flow.music(false)

func _process(_dt: float) -> void:
	_update_progress()

func _ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = ReachStyle.theme()
	layer.add_child(root)
	# Dusk on the left so the words sit on something, and a low shade.
	for spec in [[Vector2(1, 0), Control.PRESET_LEFT_WIDE, Vector2(980, 0), 0.92], [Vector2(0, -1), Control.PRESET_BOTTOM_WIDE, Vector2(0, 260), 0.7]]:
		var g := Gradient.new()
		g.set_color(0, Color(0.03, 0.025, 0.035, spec[3]))
		g.set_color(1, Color(0.03, 0.025, 0.035, 0.0))
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill_from = Vector2(0, 1) if spec[0] == Vector2(0, -1) else Vector2(0, 0)
		gt.fill_to = Vector2(0, 0) if spec[0] == Vector2(0, -1) else Vector2(1, 0)
		var wash := TextureRect.new()
		wash.texture = gt
		wash.stretch_mode = TextureRect.STRETCH_SCALE
		wash.set_anchors_preset(spec[1])
		wash.custom_minimum_size = spec[2]
		if spec[1] == Control.PRESET_BOTTOM_WIDE:
			wash.grow_vertical = Control.GROW_DIRECTION_BEGIN
		wash.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(wash)

	_menu = VBoxContainer.new()
	_menu.set_anchors_preset(Control.PRESET_CENTER_LEFT)
	_menu.grow_vertical = Control.GROW_DIRECTION_BOTH
	_menu.offset_left = 110
	_menu.add_theme_constant_override("separation", 6)
	root.add_child(_menu)
	_menu.add_child(ReachStyle.label("A MYSTERY IN THE REACH  ·  3091", 14, ReachStyle.EMBER, true))
	var title := ReachStyle.title("Periapsis\nZero", 124, ReachStyle.BONE)
	title.add_theme_constant_override("line_spacing", -34)
	title.add_theme_constant_override("outline_size", 18)
	title.add_theme_color_override("font_outline_color", Color(0.02, 0.015, 0.02, 0.35))
	_menu.add_child(title)
	var tag := ReachStyle.label("Twenty-two minutes. Then the star goes out.", 26, ReachStyle.MUTE)
	tag.add_theme_font_override("font", ReachStyle.serif_italic)
	_menu.add_child(tag)
	var loops := int(Flow.progress("reach_loops", 0))
	var facts: Array = Flow.progress("reach_facts", [])
	if loops > 0:
		var note := "Loop %d    ·    %d %s in your ship log" % [loops, facts.size(), "entry" if facts.size() == 1 else "entries"]
		if Flow.progress("reach_finished", false):
			note += "    ·    you heard the whole song"
		_menu.add_child(ReachStyle.label(note, 13, ReachStyle.PINE, true))
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 30)
	_menu.add_child(gap)
	_button("Return to the Reach" if loops > 0 else "Enter the Reach", func(): Flow.go("reach"), true).grab_focus()
	# The road here: the prologue and Act One, the story of how the Kestrel
	# came to the Reach.
	var done: bool = Flow.progress("prologue_done", false)
	var seen: bool = Flow.progress("intro_seen", false)
	if done:
		var chapter: String = Flow.progress("chapter", "hearth")
		if not chapter in ["hearth", "hearth_bay", "test_flight", "blackbox", "descent", "act1_end"]:
			chapter = "hearth"
		_button("The road here: Act One", func(): Flow.go(chapter))
	elif seen:
		var chapter: String = Flow.progress("chapter", "corridor")
		_button("The road here: the prologue", func(): Flow.go(chapter))
	else:
		_button("The road here: the prologue", func(): Flow.go("intro"))
	_button("Settings", _toggle_settings)
	_check_update()
	var told := Graphics.take_notice()
	if told != "":
		Hud.prompt("Performance graphics are on, chosen for %s. You can change it in Settings, under Graphics." % GRAPHICS_WHY.get(told, "this PC"), 9.0)
	if not Flow.on_web():
		_button("Quit", get_tree().quit)
	var foot := ReachStyle.label("The Reach  ·  early build  ·  periapsiszero.dev", 13, ReachStyle.FAINT, true)
	foot.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	foot.offset_left = 110
	foot.offset_top = -52
	root.add_child(foot)
	_settings = _settings_panel()
	_settings.visible = false
	root.add_child(_settings)

## A menu line: words, not boxes. Ember and a marker when it has the focus.
func _button(text: String, action: Callable, primary := false) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var none := StyleBoxEmpty.new()
	none.content_margin_left = 26
	none.content_margin_top = 4
	none.content_margin_bottom = 4
	for st in ["normal", "hover", "focus", "pressed", "hover_pressed"]:
		b.add_theme_stylebox_override(st, none)
	b.add_theme_font_override("font", ReachStyle.serif if not primary else ReachStyle.serif_bold)
	b.add_theme_font_size_override("font_size", 38 if primary else 27)
	b.add_theme_color_override("font_color", ReachStyle.BONE if primary else Color(ReachStyle.BONE, 0.78))
	for st in ["font_hover_color", "font_focus_color", "font_pressed_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(st, ReachStyle.EMBER)
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	var mark := ReachStyle.label("›", 38 if primary else 28, ReachStyle.EMBER)
	mark.add_theme_font_override("font", ReachStyle.serif_bold)
	mark.position = Vector2(-4, -2 if primary else -1)
	mark.visible = false
	b.add_child(mark)
	var lit := func(on: bool):
		mark.visible = on
		if on:
			Sfx.play("click", -20.0, 1.6)
	b.focus_entered.connect(lit.bind(true))
	b.focus_exited.connect(func(): mark.visible = b.is_hovered())
	b.mouse_entered.connect(func():
		b.grab_focus())
	b.pressed.connect(func():
		Sfx.play("click", -8.0)
		action.call())
	_menu.add_child(b)
	_items.append(b)
	return b

func _toggle_settings() -> void:
	_settings.visible = not _settings.visible

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
	v.add_child(Style.label("SETTINGS", 16, Style.EMBER, Style.mono_bold))
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
