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
var _help_clock: Label
var _help_steps_head: Label
var _help_steps: VBoxContainer
var _settings: Control
var _season: Control
var _t := 0.0

const KEYS := [
	["On foot", [["W A S D", "walk"], ["Shift", "run"], ["Space", "hold to crouch, let go to jump"], ["Space (in the air)", "jetpack up"], ["E", "use, talk, read"], ["F", "torch"], ["V", "first or third person"]]],
	["In the water", [["W A S D", "swim"], ["Space", "up"], ["Shift", "dive"]]],
	["Your ship", [["W S", "forward, back"], ["A D", "sideways"], ["Space", "lift off, climb"], ["Shift", "sink and land"], ["let go", "she holds still near a world"], ["Mouse", "turn"], ["Q E", "roll"], ["T", "lock the world you look at"], ["G", "autopilot to it"], ["F (held)", "match its speed"], ["R", "flight assist on or off"], ["V", "view from outside"], ["Right mouse", "look about the cockpit"], ["E (landed)", "leave the seat"]]],
	["Anywhere", [["X", "signalscope (Z C or wheel to tune)"], ["M", "map"], ["L", "ship log"], ["P", "photograph"], ["T", "lock a world (holds the Phantom still)"], ["K", "wave to the echoes near you"], ["H", "help: the goal and what to do next"], ["Esc", "pause"]]],
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
	_button("Season %d" % Season.current().n, func(): _show(_season))
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
	_season = SeasonPanel.make(self)
	add_child(_season)
	_show(_keys)

func open() -> void:
	visible = true
	var r := get_tree().get_first_node_in_group("reach_root")
	if r and _help_goal:
		var g: String = r._next_goal()
		_help_goal.text = g.trim_prefix("Lead: ") if g != "" else "Explore. Your ship log (L) lists every lead you have found."
		_fill_steps(r)
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
	_season.visible = panel == _season
	if panel == _season:
		(_season.get_meta("fill") as Callable).call()

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
	["The loop", "every 22 minutes the star goes out and the morning starts again; only you and Rook remember"],
	["Rook", "whose drones brought the Aster down; he remembers the mornings too, and wants the core"],
	["The core", "what the Aster carried; once you take it, it stays with you through every morning"],
	["Ship log (L)", "your notebook: what you have learned and where it points"],
	["Signalscope (X)", "hears beacons, old recordings and the drones; turn toward the loudest"],
	["The Founders", "Hearth's first settlers, a century ago; they left recordings all over the Reach"],
	["Recording", "a Founders' recorder; look at it and press E to play it"],
	["Echoes", "the faint lights: other travellers, playing right now in their own mornings; K waves to them"],
	["Seasons", "the Reach changes with the real calendar; the pause menu's Season page has the tiers, the week's challenges and the Fold's transmissions"],
	["Hearthstone", "home: the village, the lake, the observatory, the tower"],
	["Verdance, Ashfall", "the jungle world and the volcanic moon"],
	["The Phantom, the Wanderer", "the moon that moves, and the comet"],
]

const STEPS := [
	"Talk to Mara by the fire: look at her and press E.",
	"Mara gives you the Kestrel's launch codes. Every morning after the first, you wake already in her seat.",
	"Ride the lift up the launch tower, and climb into your ship through the hatch underneath (E).",
	"Hold Space to lift off. Look at a world, press T to lock onto it, then G to fly there.",
	"Near a world, let go and the ship holds still. Hold Shift to set her down. E steps out.",
	"Take the core from the Aster's vault on Ashfall to the Engine on the Wanderer while its door is open (20:00 to 21:15). Rook will be waiting.",
]

const STEPS_LATER := [
	"You wake in the Kestrel's seat on the launch tower. Hold Space to lift off.",
	"Follow the marker: it points at your lead. Look at that world, press T to lock it, then G for the autopilot.",
	"Near a world, let go and the ship holds still. Hold Shift to set her down. E steps out.",
	"On foot, walk to the marker and press E on what it shows. L opens your ship log, with every lead so far.",
	"The Engine is inside the Wanderer, the comet with two tails. Its stone door only sinks open between 20:00 and 21:15 on the clock; before that there is no way in. Bring the core from the vault on Ashfall.",
]

## The steps that fit where you are: the first morning's walk to the ship,
## or, once Mara has given you the codes, the morning in the seat; and the
## clock, with the Engine's door when the core is the lead.
func _fill_steps(r: Node) -> void:
	for c in _help_steps.get_children():
		c.queue_free()
	var first: bool = not (Lore.known("hearth_codes") and Lore.known("hearth_loop"))
	var steps: Array = STEPS if first else STEPS_LATER
	_help_steps_head.text = "YOUR FIRST MORNING" if first else "EVERY MORNING FROM NOW ON"
	for i in steps.size():
		var step := ReachStyle.label("%d.  %s" % [i + 1, steps[i]], 16, ReachStyle.BONE)
		step.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		step.custom_minimum_size = Vector2(560, 0)
		_help_steps.add_child(step)
	var t: float = r.system.t if r.get("system") else 0.0
	var line := "The clock: %s of 22:00. At 22:00 the star goes out and the morning starts again." % _mmss(t)
	if r.get("carrying_core") or Lore.known("ash_core") or Lore.known("hearth_songline"):
		if t < WandererSite.OPEN_FROM:
			line += " The Engine's door on the Wanderer opens at 20:00, in %s, and shuts at 21:15." % _span(WandererSite.OPEN_FROM - t)
		elif t <= WandererSite.OPEN_TO:
			line += " The Engine's door on the Wanderer is open now, until 21:15."
		else:
			line += " The Engine's door has shut for this morning; it opens again at 20:00 next morning."
	_help_clock.text = line

static func _mmss(t: float) -> String:
	return "%d:%02d" % [int(t) / 60, int(t) % 60]

static func _span(s: float) -> String:
	var m := int(s) / 60
	return ("%d min" % m) if m >= 1 else ("%d s" % int(s))

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
	# What to do now first, in the biggest words: it is what H is for.
	var nh := ReachStyle.label("WHAT TO DO NOW", 15, ReachStyle.EMBER)
	nh.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(nh)
	_help_goal = ReachStyle.label("", 20, Color("#ffd9a0"))
	_help_goal.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_help_goal.custom_minimum_size = Vector2(560, 0)
	v.add_child(_help_goal)
	_help_clock = ReachStyle.label("", 16, Color(0.75, 0.9, 1.0))
	_help_clock.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_help_clock.custom_minimum_size = Vector2(560, 0)
	v.add_child(_help_clock)
	_help_steps_head = ReachStyle.label("", 15, ReachStyle.EMBER)
	_help_steps_head.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(_help_steps_head)
	_help_steps = VBoxContainer.new()
	_help_steps.add_theme_constant_override("separation", 8)
	v.add_child(_help_steps)
	var head := ReachStyle.label("THE GOAL", 15, ReachStyle.EMBER)
	head.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(head)
	var goal := ReachStyle.label("Find out what happened to the Aster, the freighter you were escorting, and why the same day keeps repeating. Then put an end to it. What you learn is the only thing you keep from one day to the next.", 18, ReachStyle.BONE)
	goal.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	goal.custom_minimum_size = Vector2(560, 0)
	v.add_child(goal)
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
	var echo := CheckBox.new()
	echo.text = "Echoes: see other travellers"
	echo.add_theme_font_override("font", ReachStyle.round)
	echo.add_theme_font_size_override("font_size", 19)
	echo.button_pressed = bool(Flow.settings.get("echoes", true))
	echo.toggled.connect(func(on):
		Flow.settings.echoes = on
		Flow.apply_settings()
		get_tree().call_group("echoes", "set_enabled", on))
	v.add_child(echo)
	# What this machine is drawing with, for a report when it runs badly.
	var gfx := ReachStyle.label("", 15, ReachStyle.MUTE)
	gfx.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	gfx.custom_minimum_size = Vector2(420, 0)
	v.add_child(gfx)
	var info := func():
		gfx.text = "Graphics: %s\nQuality %d of %d, %d fps" % [RenderingServer.get_video_adapter_name(), Flow.tier + 1, Flow._tiers().size(), Engine.get_frames_per_second()]
	info.call()
	p.visibility_changed.connect(info)
	return p
