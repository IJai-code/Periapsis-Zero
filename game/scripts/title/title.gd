extends Node3D
## The title: a slow drift over Earth at sunrise, and the way in.

const SUN := Vector3(0.18, -0.02, -1.0)

var _cam: Camera3D
var _t := 0.0
var _menu: VBoxContainer
var _settings: PanelContainer
var _ship: Node3D
var _fill: OmniLight3D

func _ready() -> void:
	Space.environment(self, SUN, 1.1)
	add_child(Earth.below(520_000.0, SUN))
	_cam = Camera3D.new()
	# Driven per rendered frame in _process; no auto-interpolation on top.
	_cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	_cam.fov = 50.0
	_cam.near = 0.1
	_cam.far = 120_000.0
	add_child(_cam)
	# The Kestrel, gliding across the view on a slow pass.
	_ship = Hull.model("kestrel")
	# Moved per rendered frame (its slow pass below); an interpolated node
	# would hold still between ticks and then jump.
	_ship.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(_ship)
	# Earthshine and a rim from below so the ship reads against the Sun.
	var fill := OmniLight3D.new()
	fill.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	fill.light_color = Color(0.55, 0.7, 1.0)
	fill.light_energy = 16.0
	fill.omni_range = 60.0
	add_child(fill)
	_fill = fill
	if not "--noui" in OS.get_cmdline_user_args():
		_ui()
	Flow.music(true)

func _process(dt: float) -> void:
	_t += dt
	_update_progress()
	# Looking along the orbit at the horizon, the Sun just above it, drifting.
	var yaw := sin(_t * 0.03) * 0.12
	_cam.rotation = Vector3(deg_to_rad(-15.0) + sin(_t * 0.05) * 0.01, yaw, sin(_t * 0.04) * 0.02)
	# A 70-second pass from right to left, then round again.
	var k := fmod(_t + 22.0, 70.0) / 70.0
	_ship.position = _cam.global_basis * Vector3(lerpf(26.0, -30.0, k), -3.5 + sin(_t * 0.3) * 0.3, -46.0)
	_fill.global_position = _ship.global_position + _cam.global_basis * Vector3(0, -6, 12)
	_ship.global_basis = Basis.looking_at(-_cam.global_basis.x, _cam.global_basis.y).rotated(_cam.global_basis.z.normalized(), 0.0) * Basis(Vector3.FORWARD, sin(_t * 0.25) * 0.08 + 0.12)

func _ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = Style.theme()
	layer.add_child(root)
	# A soft dark wash on the left so the words sit on something.
	var wash := TextureRect.new()
	var g := Gradient.new()
	g.set_color(0, Color(Style.VOID, 0.85))
	g.set_color(1, Color(Style.VOID, 0.0))
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill_to = Vector2(1, 0)
	wash.texture = gt
	wash.stretch_mode = TextureRect.STRETCH_SCALE
	wash.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	wash.custom_minimum_size = Vector2(900, 0)
	wash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(wash)

	_menu = VBoxContainer.new()
	_menu.set_anchors_preset(Control.PRESET_CENTER_LEFT)
	_menu.grow_vertical = Control.GROW_DIRECTION_BOTH
	_menu.offset_left = 96
	_menu.add_theme_constant_override("separation", 10)
	root.add_child(_menu)
	_menu.add_child(Style.label("A MYSTERY IN THE REACH · 3091", 16, Style.EMBER, Style.mono_bold))
	var title := Style.label("Periapsis\nZero", 112, Style.BONE, Style.sans_bold)
	title.add_theme_constant_override("line_spacing", -28)
	_menu.add_child(title)
	_menu.add_child(Style.label("Twenty-two minutes. Then the star goes out.", 26, Style.MUTE))
	if Flow.progress("reach_finished", false):
		_menu.add_child(Style.label("You heard the whole song.", 16, ReachStyle.PINE, Style.mono))
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 28)
	_menu.add_child(gap)
	# First time: one button, the journey from the start (the opening film
	# plays). After that the menu offers to carry on from where it stopped.
	# The game is the Reach. The chapters that lead to it (the prologue,
	# Act One) are there too, as the road here.
	var loops := int(Flow.progress("reach_loops", 0))
	_button("Return to the Reach" if loops > 0 else "Enter the Reach", func(): Flow.go("reach"), true).grab_focus()
	var done: bool = Flow.progress("prologue_done", false)
	var seen: bool = Flow.progress("intro_seen", false)
	if done:
		var chapter: String = Flow.progress("chapter", "hearth")
		if not chapter in ["hearth", "hearth_bay", "test_flight", "blackbox", "descent", "act1_end"]:
			chapter = "hearth"
		_button("The road here: continue Act One", func(): Flow.go(chapter))
	elif seen:
		var chapter: String = Flow.progress("chapter", "corridor")
		_button("The road here: continue the prologue", func(): Flow.go(chapter))
	else:
		_button("The road here: the prologue", func(): Flow.go("intro"))
	_button("Settings", _toggle_settings)
	_check_update()
	var told := Graphics.take_notice()
	if told != "":
		Hud.prompt("Performance graphics are on, chosen for %s. You can change it in Settings, under Graphics." % GRAPHICS_WHY.get(told, "this PC"), 9.0)
	if not Flow.on_web():
		_button("Quit", get_tree().quit)
	var foot := Style.label("The Reach · early build · periapsiszero.dev", 14, Style.MUTE, Style.mono)
	foot.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	foot.offset_left = 96
	foot.offset_top = -56
	root.add_child(foot)
	_settings = _settings_panel()
	_settings.visible = false
	root.add_child(_settings)

func _button(text: String, action: Callable, primary := false) -> Button:
	var b := Button.new()
	b.text = text
	if primary:
		# The way in: ember, larger, an arrow.
		b.text = text + "   →"
		var st := StyleBoxFlat.new()
		st.bg_color = Style.EMBER
		st.set_corner_radius_all(8)
		st.content_margin_left = 30
		st.content_margin_right = 30
		st.content_margin_top = 18
		st.content_margin_bottom = 18
		var hv := st.duplicate()
		hv.bg_color = Style.EMBER.lightened(0.12)
		b.add_theme_stylebox_override("normal", st)
		b.add_theme_stylebox_override("hover", hv)
		b.add_theme_stylebox_override("focus", hv)
		b.add_theme_stylebox_override("pressed", st)
		b.add_theme_color_override("font_color", Style.VOID)
		b.add_theme_color_override("font_focus_color", Style.VOID)
		b.add_theme_color_override("font_hover_color", Style.VOID)
		b.add_theme_font_size_override("font_size", 26)
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.custom_minimum_size = Vector2(340, 0)
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.mouse_entered.connect(func(): Sfx.play("click", -18.0, 1.6))
	b.pressed.connect(func():
		Sfx.play("click", -8.0)
		action.call())
	_menu.add_child(b)
	return b

func _toggle_settings() -> void:
	_settings.visible = not _settings.visible

func _settings_panel() -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", Style.panel(14))
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
