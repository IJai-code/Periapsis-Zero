class_name ReachPause
extends Control
## Paused, in the Reach: the title's look over a dimmed view. "Paused" in
## the logo's letters, the menu in big rounded words with the little ringed
## planet bobbing beside the chosen one; on the right, the keys (on foot, in
## the water, in the Kestrel, anywhere) as keycaps, or the settings.

const CREAM := Color("#fbf1dc")
const INK := Color("#3a2618")

signal resume
signal leave

var _menu: VBoxContainer
var _items: Array[Button] = []
var _marker: Control
var _keys: Control
var _help: Control
var _help_goal: Label
var _settings: Control
var _t := 0.0

const KEYS := [
	["On foot", [["W A S D", "walk"], ["Shift", "run"], ["Space", "hold to crouch, let go to jump"], ["Space (in the air)", "jetpack up"], ["E", "use, talk, read"], ["F", "torch"], ["V", "first or third person"]]],
	["In the water", [["W A S D", "swim"], ["Space", "up"], ["Shift", "dive"]]],
	["Your ship", [["W S", "forward, back"], ["A D", "sideways"], ["Space", "lift off, climb"], ["Shift", "sink and land"], ["let go", "she holds still near a world"], ["Mouse", "turn"], ["Q E", "roll"], ["T", "lock the world you look at"], ["G", "autopilot to it"], ["F (held)", "match its speed"], ["R", "flight assist on or off"], ["V", "view from outside"], ["Right mouse", "look about the cockpit"], ["E (landed)", "leave the seat"]]],
	["Anywhere", [["X", "signalscope (Z C or wheel to tune)"], ["M", "map"], ["L", "ship log"], ["P", "photograph"], ["H", "help: the goal and what to do next"], ["Esc", "pause"]]],
]

func _init() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	process_mode = Node.PROCESS_MODE_ALWAYS
	mouse_filter = Control.MOUSE_FILTER_STOP

func _ready() -> void:
	var dim := ColorRect.new()
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.color = Color(0.03, 0.03, 0.05, 0.62)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)
	var left := VBoxContainer.new()
	left.position = Vector2(150, 150)
	left.add_theme_constant_override("separation", 8)
	add_child(left)
	var title := Label.new()
	title.text = "Paused"
	title.add_theme_font_override("font", ReachStyle.chunky)
	title.add_theme_font_size_override("font_size", 96)
	title.add_theme_color_override("font_color", CREAM)
	title.add_theme_constant_override("outline_size", 22)
	title.add_theme_color_override("font_outline_color", INK)
	left.add_child(title)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 18)
	left.add_child(gap)
	_menu = VBoxContainer.new()
	_menu.add_theme_constant_override("separation", 4)
	left.add_child(_menu)
	_button("Resume", func(): resume.emit())
	_button("How to play", func(): _show(_help))
	_button("Controls", func(): _show(_keys))
	_button("Settings", func(): _show(_settings))
	_button("Back to the title", func(): leave.emit())
	_marker = Control.new()
	_marker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_marker.draw.connect(_paint_marker)
	_marker.top_level = true
	add_child(_marker)
	_keys = _keys_panel()
	add_child(_keys)
	_help = _help_panel()
	add_child(_help)
	_settings = _settings_panel()
	add_child(_settings)
	_show(_keys)

func open() -> void:
	visible = true
	var r := get_tree().get_first_node_in_group("reach_root")
	if r and _help_goal:
		var g: String = r._next_goal()
		_help_goal.text = g.trim_prefix("Lead: ") if g != "" else "Explore. Your ship log (L) lists every lead you have found."
	_show(_help)
	if not _items.is_empty():
		_items[0].grab_focus()

func _process(dt: float) -> void:
	_t += dt
	_marker.queue_redraw()

func _show(panel: Control) -> void:
	_keys.visible = panel == _keys
	_settings.visible = panel == _settings
	_help.visible = panel == _help

## A menu line, as on the title: big rounded words, cream on a dark outline.
func _button(text: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var none := StyleBoxEmpty.new()
	none.content_margin_left = 6
	for st in ["normal", "hover", "focus", "pressed", "hover_pressed"]:
		b.add_theme_stylebox_override(st, none)
	b.add_theme_font_override("font", ReachStyle.round_bold)
	b.add_theme_font_size_override("font_size", 46)
	b.add_theme_constant_override("outline_size", 14)
	b.add_theme_color_override("font_outline_color", Color(INK, 0.92))
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

func _paint_marker() -> void:
	var focused: Control = get_viewport().gui_get_focus_owner()
	if not focused or not focused in _items:
		return
	var r := focused.get_global_rect()
	_marker.global_position = Vector2(r.position.x - 64, r.position.y + r.size.y * 0.5 - 30 + sin(_t * 3.0) * 3.0)
	var c := Vector2(30, 30)
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

func _card() -> PanelContainer:
	var p := PanelContainer.new()
	var s := ReachStyle.panel(14)
	s.bg_color = Color(0.09, 0.08, 0.07, 0.86)
	s.border_width_top = 0
	s.border_width_left = 4
	s.border_color = ReachStyle.EMBER
	s.content_margin_left = 26
	s.content_margin_right = 26
	s.content_margin_top = 20
	s.content_margin_bottom = 22
	p.add_theme_stylebox_override("panel", s)
	p.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	p.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	p.grow_vertical = Control.GROW_DIRECTION_BOTH
	p.offset_right = -120
	return p

const WORDS := [
	["Your ship", "the Kestrel: a small two-engine craft, parked on the launch tower"],
	["The star", "the Lantern, which the five worlds go round. It is dying"],
	["The loop", "every 22 minutes the star goes out and you wake by the fire again"],
	["Ship log (L)", "your notebook: what you have learned and where it points"],
	["Signalscope (X)", "listens for music and signals; turn toward the loudest"],
	["The Founders", "Hearth's first settlers, a century ago; they left recordings all over the Reach"],
	["Recording", "a Founders' recorder; look at it and press E to play it"],
	["Hearthstone", "home: the village, the lake, the observatory, the tower"],
	["Verdance, Ashfall", "the jungle world and the volcanic moon"],
	["The Phantom, the Wanderer", "the moon that moves, and the comet"],
]

const STEPS := [
	"Talk to Mara by the fire: look at her and press E.",
	"Get your ship's launch codes from Okafor, in the glass-domed observatory.",
	"Ride the lift up the launch tower, and climb into your ship through the hatch underneath (E).",
	"Hold Space to lift off. Look at a world, press T to lock onto it, then G to fly there.",
	"Near a world, let go and the ship holds still. Hold Shift to set her down. E steps out.",
]

## The goal, the first few minutes, what to do next, and the words the game
## uses. Scrolled: the words do not fit on a laptop's screen all at once.
func _help_panel() -> Control:
	var p := _card()
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size = Vector2(560, 620)
	p.add_child(scroll)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.custom_minimum_size = Vector2(560, 0)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(v)
	var head := ReachStyle.label("THE GOAL", 15, ReachStyle.EMBER)
	head.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(head)
	var goal := ReachStyle.label("Find out what happened to the Aster, the freighter you were escorting, and why the same day keeps repeating. Then put an end to it. What you learn is the only thing you keep from one day to the next.", 18, ReachStyle.BONE)
	goal.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	goal.custom_minimum_size = Vector2(560, 0)
	v.add_child(goal)
	var sh := ReachStyle.label("YOUR FIRST FEW MINUTES", 15, ReachStyle.EMBER)
	sh.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(sh)
	for i in STEPS.size():
		var step := ReachStyle.label("%d.  %s" % [i + 1, STEPS[i]], 16, ReachStyle.BONE)
		step.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		step.custom_minimum_size = Vector2(560, 0)
		v.add_child(step)
	var nh := ReachStyle.label("WHAT TO DO NEXT", 15, ReachStyle.EMBER)
	nh.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(nh)
	_help_goal = ReachStyle.label("", 18, ReachStyle.BONE)
	_help_goal.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_help_goal.custom_minimum_size = Vector2(560, 0)
	v.add_child(_help_goal)
	var wh := ReachStyle.label("WORDS", 15, ReachStyle.EMBER)
	wh.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(wh)
	for w: Array in WORDS:
		var row := ReachStyle.label("", 16, ReachStyle.BONE)
		row.text = "%s:  %s" % [w[0], w[1]]
		row.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		row.custom_minimum_size = Vector2(560, 0)
		v.add_child(row)
	return p

## Every key, grouped, as keycaps and words.
func _keys_panel() -> Control:
	var p := _card()
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 40)
	p.add_child(cols)
	var col_a := VBoxContainer.new()
	var col_b := VBoxContainer.new()
	for c in [col_a, col_b]:
		c.add_theme_constant_override("separation", 7)
		cols.add_child(c)
	for g in KEYS.size():
		var group: Array = KEYS[g]
		var col := col_b if group[0] == "Your ship" else col_a
		var head := ReachStyle.label(String(group[0]).to_upper(), 15, ReachStyle.EMBER)
		head.add_theme_font_override("font", ReachStyle.round_bold)
		if col.get_child_count() > 0:
			var sp := Control.new()
			sp.custom_minimum_size = Vector2(0, 10)
			col.add_child(sp)
		col.add_child(head)
		for row: Array in group[1]:
			var h := HBoxContainer.new()
			h.add_theme_constant_override("separation", 10)
			var cap := PanelContainer.new()
			cap.add_theme_stylebox_override("panel", ReachStyle.keycap())
			var k := ReachStyle.label(row[0], 14, ReachStyle.CHARCOAL, true)
			k.add_theme_font_override("font", Style.mono_bold)
			cap.add_child(k)
			h.add_child(cap)
			h.add_child(ReachStyle.label(row[1], 18, ReachStyle.BONE))
			col.add_child(h)
	return p

## Music, effects, mouse speed, invert.
func _settings_panel() -> Control:
	var p := _card()
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	v.custom_minimum_size = Vector2(420, 0)
	p.add_child(v)
	var head := ReachStyle.label("SETTINGS", 15, ReachStyle.EMBER)
	head.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(head)
	for row in [["Music", "music", 0.0, 1.0], ["Effects", "sfx", 0.0, 1.0], ["Mouse speed", "mouse", 0.3, 2.5]]:
		v.add_child(ReachStyle.label(row[0], 20, ReachStyle.BONE))
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
	inv.add_theme_font_override("font", ReachStyle.round)
	inv.add_theme_font_size_override("font_size", 19)
	inv.button_pressed = Flow.settings.invert
	inv.toggled.connect(func(on):
		Flow.settings.invert = on
		Flow.apply_settings())
	v.add_child(inv)
	return p
