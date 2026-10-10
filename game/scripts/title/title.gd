extends Node3D
## The title: a slow drift over Earth at sunrise, and the way in.

const SUN := Vector3(0.18, -0.02, -1.0)

var _cam: Camera3D
var _t := 0.0
var _menu: VBoxContainer
var _settings: PanelContainer
var _ship: Node3D

func _ready() -> void:
	Space.environment(self, SUN, 1.1)
	add_child(Earth.below(520_000.0, SUN))
	_cam = Camera3D.new()
	_cam.fov = 50.0
	_cam.near = 0.1
	_cam.far = 120_000.0
	add_child(_cam)
	# The Kestrel, gliding across the view on a slow pass.
	_ship = Hull.model("kestrel")
	add_child(_ship)
	_ui()
	Flow.music(true)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _process(dt: float) -> void:
	_t += dt
	# Looking along the orbit at the horizon, the Sun just above it, drifting.
	var yaw := sin(_t * 0.03) * 0.12
	_cam.rotation = Vector3(deg_to_rad(-15.0) + sin(_t * 0.05) * 0.01, yaw, sin(_t * 0.04) * 0.02)
	# A 70-second pass from right to left, then round again.
	var k := fmod(_t + 22.0, 70.0) / 70.0
	_ship.position = _cam.global_basis * Vector3(lerpf(26.0, -30.0, k), -3.5 + sin(_t * 0.3) * 0.3, -46.0)
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
	_menu.add_child(Style.label("A STORY IN CISLUNAR SPACE · 3091", 16, Style.EMBER, Style.mono_bold))
	var title := Style.label("Periapsis\nZero", 112, Style.BONE, Style.sans_bold)
	title.add_theme_constant_override("line_spacing", -28)
	_menu.add_child(title)
	_menu.add_child(Style.label("Dogfights where the orbits are real.", 26, Style.MUTE))
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 28)
	_menu.add_child(gap)
	var done: bool = Flow.progress("prologue_done", false)
	_button("Play the prologue" if not done else "Replay the prologue", func(): Flow.go("intro")).grab_focus()
	if done:
		_button("Continue to Act One", Flow.open_act_one)
	_button("Settings", _toggle_settings)
	if not Flow.on_web():
		_button("Quit", get_tree().quit)
	var foot := Style.label("Prologue · early build · periapsiszero.dev", 14, Style.MUTE, Style.mono)
	foot.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	foot.offset_left = 96
	foot.offset_top = -56
	root.add_child(foot)
	_settings = _settings_panel()
	_settings.visible = false
	root.add_child(_settings)

func _button(text: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = text
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
	var close := Button.new()
	close.text = "Done"
	close.pressed.connect(_toggle_settings)
	v.add_child(close)
	return p
