class_name ReachHud
extends CanvasLayer
## What the visor and the cockpit show, and no more: a dot to aim with, what
## E would do, the suit's three gauges (only when not full), and in the
## Kestrel: speed, height, the locked target and which way you are going.

var reach: Node
var _draw: Control
var _visor: ColorRect
var _visor_mat: ShaderMaterial
var _prompt_box: HBoxContainer
var _key: Label
var _act: Label
var _card: PanelContainer
var _card_text: Label
var _card_t := 0.0
var _place: VBoxContainer
var _place_title: Label
var _place_sub: Label
var _place_t := 0.0
var _gauge_t := 0.0
var _last_fuel := 100.0
var _plaque: PanelContainer
var _plaque_title: Label
var _plaque_text: Label
var _plaque_at := Vector3.ZERO
var _plaque_t := 0.0
var _goal: PanelContainer
var _goal_text: Label
var _goal_kind: Label
var _goal_last := ""
var _caption: Label
var _caption_t := 0.0
var _fade: ColorRect
var _photo: TextureRect
var _photo_note: Label
var _flash: ColorRect
var _hint: VBoxContainer
var _hint_t := 0.0
## The overlay's canvas is rebuilt this often, not every frame.
var _paint_t := 0.0
var _help: Button

func _ready() -> void:
	layer = 6
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	# The helmet's glass, on foot.
	_visor = ColorRect.new()
	_visor.set_anchors_preset(Control.PRESET_FULL_RECT)
	_visor.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_visor_mat = ShaderMaterial.new()
	_visor_mat.shader = load("res://shaders/reach/visor.gdshader")
	_visor.material = _visor_mat
	_visor.visible = false
	root.add_child(_visor)
	_draw = Control.new()
	_draw.set_anchors_preset(Control.PRESET_FULL_RECT)
	_draw.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_draw.draw.connect(_paint)
	root.add_child(_draw)
	# What E would do: a key, and the words.
	_prompt_box = HBoxContainer.new()
	_prompt_box.set_anchors_preset(Control.PRESET_CENTER)
	_prompt_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_prompt_box.grow_vertical = Control.GROW_DIRECTION_BOTH
	_prompt_box.position.y += 52
	_prompt_box.add_theme_constant_override("separation", 10)
	_prompt_box.alignment = BoxContainer.ALIGNMENT_CENTER
	_prompt_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_prompt_box)
	var cap := PanelContainer.new()
	cap.add_theme_stylebox_override("panel", ReachStyle.keycap())
	_prompt_box.add_child(cap)
	_key = ReachStyle.label("E", 14, ReachStyle.CHARCOAL, true)
	_key.add_theme_font_override("font", Style.mono_bold)
	_key.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cap.add_child(_key)
	_act = ReachStyle.label("", 20, ReachStyle.BONE)
	_shadow(_act)
	_prompt_box.add_child(_act)
	_prompt_box.visible = false
	# Notices (the ship's log, a signal named): a card from the right.
	_card = PanelContainer.new()
	var cs := ReachStyle.panel(6)
	cs.border_width_top = 0
	cs.border_width_left = 3
	cs.border_color = ReachStyle.EMBER
	_card.add_theme_stylebox_override("panel", cs)
	_card.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_card.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_card.offset_top = 214
	_card.offset_right = 400
	_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_card)
	var ch := HBoxContainer.new()
	ch.add_theme_constant_override("separation", 12)
	_card.add_child(ch)
	var mark := ReachStyle.label("◆", 16, ReachStyle.EMBER)
	ch.add_child(mark)
	_card_text = ReachStyle.label("", 15, ReachStyle.BONE)
	_card_text.add_theme_font_override("font", ReachStyle.serif)
	ch.add_child(_card_text)
	# A museum's plaque, read (bottom middle, above the prompt).
	_plaque = PanelContainer.new()
	_plaque.add_theme_stylebox_override("panel", ReachStyle.panel(8))
	_plaque.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_plaque.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_plaque.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_plaque.offset_bottom = -150
	_plaque.custom_minimum_size = Vector2(540, 0)
	_plaque.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_plaque.visible = false
	root.add_child(_plaque)
	var pv := VBoxContainer.new()
	pv.add_theme_constant_override("separation", 8)
	_plaque.add_child(pv)
	_plaque_title = ReachStyle.title("", 19, ReachStyle.EMBER)
	pv.add_child(_plaque_title)
	_plaque_text = ReachStyle.label("", 15, ReachStyle.BONE)
	_plaque_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_plaque_text.custom_minimum_size = Vector2(496, 0)
	pv.add_child(_plaque_text)
	# What to do next (or, once flying, the lead the log points at): a
	# small card top left, its kind in ember capitals over the words.
	_goal = PanelContainer.new()
	var gs := ReachStyle.panel(10)
	gs.bg_color = Color(0.08, 0.07, 0.06, 0.55)
	gs.border_width_top = 0
	gs.border_width_left = 3
	gs.border_color = ReachStyle.EMBER
	gs.content_margin_left = 14
	gs.content_margin_right = 16
	gs.content_margin_top = 8
	gs.content_margin_bottom = 9
	_goal.add_theme_stylebox_override("panel", gs)
	_goal.position = Vector2(26, 24)
	_goal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_goal)
	var gv := VBoxContainer.new()
	gv.add_theme_constant_override("separation", 1)
	_goal.add_child(gv)
	_goal_kind = ReachStyle.label("NEXT", 12, ReachStyle.EMBER)
	_goal_kind.add_theme_font_override("font", ReachStyle.round_bold)
	gv.add_child(_goal_kind)
	_goal_text = ReachStyle.label("", 18, ReachStyle.BONE)
	_goal_text.add_theme_font_override("font", ReachStyle.round_bold)
	_shadow(_goal_text)
	gv.add_child(_goal_text)
	_goal.modulate.a = 0.0
	# Help, top right: the goal, what to do next, every key (the pause
	# screen's first page). H, or a click when the mouse is free.
	_help = Button.new()
	_help.text = "?  Help"
	_help.add_theme_font_override("font", ReachStyle.round_bold)
	_help.add_theme_font_size_override("font_size", 16)
	var hs := ReachStyle.panel(16)
	hs.bg_color = Color(0.08, 0.07, 0.06, 0.6)
	hs.border_width_top = 0
	hs.border_width_left = 2
	hs.border_width_right = 2
	hs.border_width_bottom = 2
	hs.border_width_top = 2
	hs.border_color = Color(ReachStyle.BONE, 0.5)
	hs.content_margin_left = 14
	hs.content_margin_right = 14
	hs.content_margin_top = 5
	hs.content_margin_bottom = 6
	for st in ["normal", "hover", "pressed", "focus"]:
		_help.add_theme_stylebox_override(st, hs)
	_help.add_theme_color_override("font_color", ReachStyle.BONE)
	_help.add_theme_color_override("font_hover_color", ReachStyle.EMBER)
	_help.focus_mode = Control.FOCUS_NONE
	_help.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_help.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_help.offset_right = -24
	_help.offset_top = 22
	_help.pressed.connect(func(): Hud.pause(true))
	root.add_child(_help)
	var hk := PanelContainer.new()
	hk.add_theme_stylebox_override("panel", ReachStyle.keycap())
	var hkl := ReachStyle.label("H", 12, ReachStyle.CHARCOAL, true)
	hkl.add_theme_font_override("font", Style.mono_bold)
	hk.add_child(hkl)
	hk.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hk.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	hk.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	hk.offset_right = -132
	hk.offset_top = 27
	root.add_child(hk)
	# Arriving somewhere: its name, large, at the top.
	_place = VBoxContainer.new()
	_place.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_place.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_place.offset_top = 70
	_place.alignment = BoxContainer.ALIGNMENT_CENTER
	_place.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_place.modulate.a = 0.0
	root.add_child(_place)
	_place_sub = ReachStyle.label("", 12, ReachStyle.EMBER, true)
	_place_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place.add_child(_place_sub)
	_place_title = ReachStyle.title("", 54, ReachStyle.BONE)
	_place_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_shadow(_place_title)
	_place.add_child(_place_title)
	_caption = ReachStyle.label("", 21, ReachStyle.BONE)
	_caption.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_caption.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_caption.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_caption.offset_bottom = -110
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_shadow(_caption)
	root.add_child(_caption)
	# The Rim Run's clock, top middle, while a run is on (RimRun).
	_race = ReachStyle.title("", 34, ReachStyle.BONE)
	_race.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_race.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_race.offset_top = 64
	_race.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_shadow(_race)
	root.add_child(_race)
	# The last photograph, top right (P).
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", ReachStyle.panel(4))
	frame.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	frame.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	frame.offset_right = -24
	frame.offset_top = 24
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.visible = false
	root.add_child(frame)
	var v := VBoxContainer.new()
	frame.add_child(v)
	_photo = TextureRect.new()
	_photo.custom_minimum_size = Vector2(224, 126)
	_photo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_photo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	v.add_child(_photo)
	_photo_note = ReachStyle.label("", 11, ReachStyle.MUTE, true)
	v.add_child(_photo_note)
	# Keys worth knowing, low on the left: keycaps and words, in rows.
	_hint = VBoxContainer.new()
	_hint.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_hint.offset_left = 120
	_hint.offset_bottom = -34
	_hint.add_theme_constant_override("separation", 6)
	_hint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_hint.modulate.a = 0.0
	root.add_child(_hint)
	_flash = ColorRect.new()
	_flash.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flash.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_flash.color = Color(1, 1, 1, 0)
	root.add_child(_flash)
	_fade = ColorRect.new()
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.color = Color(0, 0, 0, 0)
	root.add_child(_fade)

func _shadow(l: Label) -> void:
	l.add_theme_constant_override("outline_size", 6)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.6))

## A notice for a few seconds ("Ship log updated"): a card from the right.
var _race: Label
## The run's clock and splits; "" hides it.
func race(text: String) -> void:
	if _race:
		_race.text = text

func toast(text: String, seconds := 3.0) -> void:
	_card_text.text = text.capitalize() if text == text.to_upper() and text.length() > 3 else text
	_card_t = seconds

## A plaque's words, while you stay near the thing it is on.
func plaque(title: String, text: String, at: Vector3) -> void:
	_plaque_title.text = title
	_plaque_text.text = text
	_plaque_at = at
	_plaque_t = 20.0
	_guide_t = 0.0
	_plaque.visible = true

## A guide: what this place is and what to do here, in plain words. The
## plaque's panel, held for `seconds` wherever you walk (Enter or Tab puts
## it away sooner).
var _guide_t := 0.0
func guide(title: String, text: String, seconds := 18.0) -> void:
	_plaque_title.text = title
	_plaque_text.text = text + "\n\n[Tab to put this away]"
	_plaque_at = Vector3.INF
	_plaque_t = seconds
	_guide_t = seconds
	_plaque.visible = true

## Tab alone puts a guide away: Enter and Space already mean "go on" in
## conversations and the Choir's verses, and must keep meaning that.
func _unhandled_key_input(e: InputEvent) -> void:
	if _guide_t > 0.0 and e is InputEventKey and e.pressed and not e.echo and (e as InputEventKey).keycode == KEY_TAB:
		_guide_t = 0.0
		_plaque.visible = false
		get_viewport().set_input_as_handled()

## What to do next ("" for nothing).
func goal(text: String) -> void:
	# "Lead: ..." is the log's; anything else is the next thing to do.
	var kind := "NEXT"
	if text.begins_with("Lead: "):
		kind = "LEAD  ·  SHIP LOG (L)"
		text = text.trim_prefix("Lead: ")
	if text == _goal_last:
		return
	_goal_last = text
	_goal_kind.text = kind
	# Broken into lines of at most 460 px here (a wrapping label inside a
	# shrinking panel measures its height before its width, and comes out
	# a tall empty box).
	var lines: Array[String] = []
	var line := ""
	for w in text.split(" "):
		var tryl := w if line == "" else line + " " + w
		if line != "" and ReachStyle.round_bold.get_string_size(tryl, HORIZONTAL_ALIGNMENT_LEFT, -1, 18).x > 460.0:
			lines.append(line)
			line = w
		else:
			line = tryl
	if line != "":
		lines.append(line)
	_goal_text.autowrap_mode = TextServer.AUTOWRAP_OFF
	_goal_text.custom_minimum_size = Vector2.ZERO
	_goal_text.text = "\n".join(lines)
	_goal.size = Vector2.ZERO
	_goal.reset_size()
	if text != "":
		_goal.modulate.a = 0.0

## Arriving somewhere: its name, large, and what it is above it.
func place(title: String, what := "") -> void:
	_place_title.text = title
	_place_sub.text = what.to_upper()
	_place_t = 4.0

## A line low in the middle (what someone says, what the loop did).
func caption(text: String, seconds := 4.0) -> void:
	_caption.text = text
	_caption_t = seconds

## Keys worth knowing, low on the left for a while (the first mornings).
## The text is rows (lines) of "KEY  words" pairs, two or more spaces apart.
func hint(text: String, seconds := 16.0) -> void:
	for c in _hint.get_children():
		c.queue_free()
	for line in text.split("\n"):
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 7)
		_hint.add_child(row)
		var parts := Array(line.split("  ", false)).map(func(x: String) -> String: return x.strip_edges()).filter(func(x: String) -> bool: return x != "")
		var i := 0
		while i + 1 < parts.size():
			var cap := PanelContainer.new()
			cap.add_theme_stylebox_override("panel", ReachStyle.keycap())
			var k := ReachStyle.label(parts[i], 13, ReachStyle.CHARCOAL, true)
			k.add_theme_font_override("font", Style.mono_bold)
			cap.add_child(k)
			row.add_child(cap)
			var w := ReachStyle.label(parts[i + 1], 16, ReachStyle.BONE)
			_shadow(w)
			row.add_child(w)
			var gap := Control.new()
			gap.custom_minimum_size = Vector2(14, 0)
			row.add_child(gap)
			i += 2
	_hint_t = seconds

## The last photograph (null to clear it). `holds` notes the Phantom in it.
func show_photo(tex: Texture2D, holds := false) -> void:
	var frame := _photo.get_parent().get_parent() as Control
	frame.visible = tex != null
	_photo.texture = tex
	if tex:
		var t: float = reach.system.t
		_photo_note.text = "PHOTO  %02d:%02d%s" % [int(t) / 60, int(t) % 60, "   THE PHANTOM" if holds else ""]
		_flash.color = Color(1, 1, 1, 0.7)
		create_tween().tween_property(_flash, "color", Color(1, 1, 1, 0), 0.35)

## A flash of light over everything (the engines lighting, a photograph),
## gone in a moment.
func flash(c: Color, alpha := 0.5, in_s := 0.05, out_s := 0.45) -> void:
	_flash.color = Color(c.r, c.g, c.b, alpha)
	create_tween().tween_property(_flash, "color:a", 0.0, out_s).set_delay(in_s)

## The whole screen to a colour and back; awaitable.
## Opaque black at once (the start, before the morning's eyelids).
func blackout() -> void:
	_fade.color = Color(0, 0, 0, 1)

func fade_to(c: Color, seconds: float) -> void:
	var t := create_tween()
	t.tween_property(_fade, "color", c, seconds)
	await t.finished

## Under water: the view tinted and wavering, light rippling over it.
var _under: ColorRect
func underwater(on: bool) -> void:
	if on and _under == null:
		_under = ColorRect.new()
		_under.set_anchors_preset(Control.PRESET_FULL_RECT)
		_under.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/reach/underwater.gdshader")
		_under.material = m
		get_child(0).add_child(_under)
		get_child(0).move_child(_under, 0)
	if _under:
		_under.visible = on

func _process(dt: float) -> void:
	_card_t -= dt
	var show := clampf(_card_t * 2.0, 0.0, 1.0)
	_card.modulate.a = show
	_card.offset_right = lerpf(_card.offset_right, -28.0 if _card_t > 0.0 else 420.0, minf(1.0, dt * 9.0))
	_card.offset_left = _card.offset_right - _card.size.x
	_place_t -= dt
	_place.modulate.a = clampf(minf(_place_t, 4.0 - _place_t) * 1.2, 0.0, 1.0)
	var pl: Explorer = reach.player
	# Nothing over a conversation.
	_plaque.modulate.a = move_toward(_plaque.modulate.a, 0.0 if reach.talking else 1.0, dt * 6.0)
	if _plaque.visible:
		_plaque_t -= dt
		_guide_t = maxf(_guide_t - dt, 0.0)
		var walked := _plaque_at != Vector3.INF and (not pl or pl.global_position.distance_to(_plaque_at) > 4.5)
		if _plaque_t <= 0.0 or walked:
			_plaque.visible = false
	var want_goal: bool = _goal_text.text != "" and pl != null and (pl.enabled or (reach.ship != null and reach.ship.piloted))
	_goal.modulate.a = move_toward(_goal.modulate.a, 0.9 if want_goal else 0.0, dt * 1.5)
	_caption_t -= dt
	_caption.modulate.a = clampf(_caption_t, 0.0, 1.0)
	_hint_t -= dt
	_hint.modulate.a = clampf(_hint_t, 0.0, 0.85)
	var p: Explorer = reach.player
	var s: ReachShip = reach.ship
	var text := ""
	if p and p.enabled and p.focus:
		text = p.focus.prompt
	elif s and s.piloted and s.landed:
		text = "Leave the seat"
	_act.text = text
	_prompt_box.visible = text != ""
	# The helmet's glass while walking about (not in the seat, not by a
	# fire, not waking).
	var on_foot: bool = p != null and p.enabled and not (s and s.piloted)
	_visor.visible = on_foot and not p.third
	if on_foot:
		var vp := _visor.get_viewport_rect().size
		_visor_mat.set_shader_parameter("aspect", Vector2(vp.x / maxf(vp.y, 1.0), 1.0))
	# At 30 a second: a dot, three capsules and a line of text rebuilt sixty
	# times is half of the work done for nothing (the eye cannot tell).
	# Every frame: the goal's marker and the flight markers sit on things in
	# the world, and drawn a frame behind they would judder as you turn.
	_draw.queue_redraw()

func _paint() -> void:
	var vp := _draw.get_viewport_rect().size
	var c := vp / 2.0
	var p: Explorer = reach.player
	var s: ReachShip = reach.ship
	_marker(vp, c)
	if s and s.piloted and not s.launching:
		_ship(vp, c, s)
	elif p and p.enabled:
		# A dot; a ring round it when what you look at can be used.
		if p.focus:
			_draw.draw_arc(c, 9.0, 0.0, TAU, 28, Color(ReachStyle.EMBER, 0.9), 1.8, true)
			_draw.draw_circle(c, 2.2, ReachStyle.EMBER)
		else:
			_draw.draw_circle(c, 2.4, Color(ReachStyle.BONE, 0.75))
		_suit(vp, p)

## The goal's marker: a diamond over the place with its name and distance;
## off the screen (or behind you), an arrow at the edge pointing the way.
var _goal_at := {}
var _goal_check := 0.0
func _marker(vp: Vector2, c: Vector2) -> void:
	_goal_check -= get_process_delta_time()
	if _goal_check <= 0.0:
		_goal_check = 0.25
		_goal_at = reach.goal_target() if reach.has_method("goal_target") else {}
	if reach.talking:
		return
	var cam := _draw.get_viewport().get_camera_3d()
	if not cam:
		return
	# Where you left the Kestrel, whenever you are on foot and away from
	# her: a blue mark of its own, so she is never lost behind a hill.
	var p: Explorer = reach.player
	var s: ReachShip = reach.ship
	var ship_at := Vector3.INF
	if s and p and p.enabled and not s.piloted and s.is_inside_tree():
		ship_at = s.global_position + s.global_basis.y * 2.5
		var far := p.global_position.distance_to(s.global_position)
		if far > 22.0:
			_pin(vp, c, cam, ship_at, "Kestrel", Color(0.6, 0.85, 1.0), true)
	# A run on: the next ring is the only place that matters.
	var race_at = reach.get("race_at")
	if race_at is Dictionary and not (race_at as Dictionary).is_empty():
		_pin(vp, c, cam, race_at.at, race_at.label, Color(1.0, 0.72, 0.3), false)
		return
	if _goal_at.is_empty():
		return
	var at: Vector3 = _goal_at.at
	# The goal is the ship herself: her own mark already shows it.
	if ship_at != Vector3.INF and at.distance_to(ship_at) < 12.0:
		return
	_pin(vp, c, cam, at, _goal_at.label, Color(1.0, 0.86, 0.6), false)

## A mark on a place: on the screen, a diamond (a ship's chevron for the
## Kestrel) with its name and distance; off the screen or behind you, an
## arrow round the edge pointing the way.
func _pin(vp: Vector2, c: Vector2, cam: Camera3D, at: Vector3, label: String, col: Color, ship: bool) -> void:
	var d := cam.global_position.distance_to(at)
	if d < 3.5:
		return
	var dist := _range(d)
	var ink := Color(0.12, 0.08, 0.05, 0.85) if not ship else Color(0.03, 0.07, 0.12, 0.85)
	var behind := cam.is_position_behind(at)
	var m := cam.unproject_position(at) if not behind else Vector2.ZERO
	var margin := Vector2(60, 70)
	var inside := not behind and Rect2(margin, vp - margin * 2.0).has_point(m)
	if inside:
		var pulse := 1.0 + 0.12 * sin(Time.get_ticks_msec() * 0.006)
		var r := 9.0 * pulse
		var dia := PackedVector2Array([m + Vector2(0, -r), m + Vector2(r, 0), m + Vector2(0, r), m + Vector2(-r, 0)])
		var outline := PackedVector2Array([m + Vector2(0, -r - 3), m + Vector2(r + 3, 0), m + Vector2(0, r + 3), m + Vector2(-r - 3, 0)])
		if ship:
			# A chevron, nose up: her shape from behind.
			dia = PackedVector2Array([m + Vector2(0, -r * 1.1), m + Vector2(r * 1.2, r * 0.8), m + Vector2(0, r * 0.25), m + Vector2(-r * 1.2, r * 0.8)])
			outline = PackedVector2Array([m + Vector2(0, -r * 1.1 - 4), m + Vector2(r * 1.2 + 4, r * 0.8 + 3), m + Vector2(0, r * 0.25 + 3), m + Vector2(-r * 1.2 - 4, r * 0.8 + 3)])
		_draw.draw_colored_polygon(outline, ink)
		_draw.draw_colored_polygon(dia, col)
		_draw.draw_string_outline(ReachStyle.round_bold, m + Vector2(-150, 30), label, HORIZONTAL_ALIGNMENT_CENTER, 300, 15, 6, ink)
		_draw.draw_string(ReachStyle.round_bold, m + Vector2(-150, 30), label, HORIZONTAL_ALIGNMENT_CENTER, 300, 15, col)
		_draw.draw_string_outline(ReachStyle.round, m + Vector2(-150, 48), dist, HORIZONTAL_ALIGNMENT_CENTER, 300, 13, 5, ink)
		_draw.draw_string(ReachStyle.round, m + Vector2(-150, 48), dist, HORIZONTAL_ALIGNMENT_CENTER, 300, 13, Color(col, 0.85))
		return
	# Off the screen: which way, round the edge of an oval.
	var local := cam.global_basis.inverse() * (at - cam.global_position)
	var dir := Vector2(local.x, -local.y)
	if dir.length() < 0.001:
		dir = Vector2(0, 1)
	dir = dir.normalized()
	var half := vp * 0.5 - margin
	var k := 1.0 / sqrt((dir.x * dir.x) / (half.x * half.x) + (dir.y * dir.y) / (half.y * half.y))
	var tip := c + dir * k
	var side := dir.orthogonal()
	var tri := PackedVector2Array([tip + dir * 14.0, tip - dir * 6.0 + side * 13.0, tip - dir * 6.0 - side * 13.0])
	var tri_o := PackedVector2Array([tip + dir * 18.0, tip - dir * 9.0 + side * 17.0, tip - dir * 9.0 - side * 17.0])
	_draw.draw_colored_polygon(tri_o, ink)
	_draw.draw_colored_polygon(tri, col)
	var tp := tip - dir * 34.0 + Vector2(-150, 5)
	_draw.draw_string_outline(ReachStyle.round_bold, tp, label + "  " + dist, HORIZONTAL_ALIGNMENT_CENTER, 300, 14, 6, ink)
	_draw.draw_string(ReachStyle.round_bold, tp, label + "  " + dist, HORIZONTAL_ALIGNMENT_CENTER, 300, 14, col)

func _suit(vp: Vector2, p: Explorer) -> void:
	var gauges := [
		["O2", p.oxygen / Explorer.OXY_MAX, Color(0.55, 0.82, 0.95)],
		["FUEL", p.fuel / Explorer.FUEL_MAX, ReachStyle.EMBER],
		["SUIT", p.health / 100.0, ReachStyle.PINE],
	]
	# Bright while anything is short or the jetpack is burning; faint when
	# all is well.
	var dt := get_process_delta_time()
	var busy := not p.breathing or p.fuel < _last_fuel - 0.01
	for g in gauges:
		if float(g[1]) < 0.98:
			busy = true
	_last_fuel = p.fuel
	_gauge_t = clampf(_gauge_t + (dt * 3.0 if busy else -dt * 0.8), 0.0, 1.0)
	var alpha := 0.32 + 0.68 * _gauge_t
	var h := 92.0
	var w := 12.0
	var base := Vector2(52, vp.y - 58)
	for i in gauges.size():
		var g: Array = gauges[i]
		var x := base.x + i * 36.0
		var f := clampf(float(g[1]), 0.0, 1.0)
		var col: Color = g[2]
		if f < 0.25:
			col = ReachStyle.EMBER.lerp(Color(1, 0.3, 0.2), 0.5 + 0.5 * sin(Time.get_ticks_msec() * 0.012))
		var top := Vector2(x, base.y - h)
		# The capsule: rounded ends, a dark well, the fill from below.
		_capsule(top, w, h, Color(0.04, 0.04, 0.05, 0.55 * alpha))
		var fh := maxf(h * f, 0.0)
		if fh > 1.0:
			_capsule(Vector2(x, base.y - fh), w, fh, Color(col, 0.9 * alpha))
		_capsule_outline(top, w, h, Color(ReachStyle.BONE, 0.35 * alpha))
		_draw.draw_string(Style.mono_bold, Vector2(x - 8, base.y + 18), g[0], HORIZONTAL_ALIGNMENT_CENTER, w + 16, 10, Color(ReachStyle.BONE, 0.7 * alpha))
	if not p.breathing:
		_draw.draw_string(Style.mono_bold, Vector2(base.x - 4, base.y - h - 22), "NO AIR  ·  %d s" % int(maxf(p.oxygen, 0.0)), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ReachStyle.EMBER)

func _capsule(top: Vector2, w: float, h: float, c: Color) -> void:
	var r := w / 2.0
	if h <= w:
		_draw.draw_circle(top + Vector2(r, h / 2.0), h / 2.0, c)
		return
	_draw.draw_rect(Rect2(top + Vector2(0, r), Vector2(w, h - w)), c)
	_draw.draw_circle(top + Vector2(r, r), r, c)
	_draw.draw_circle(top + Vector2(r, h - r), r, c)

func _capsule_outline(top: Vector2, w: float, h: float, c: Color) -> void:
	var r := w / 2.0
	_draw.draw_line(top + Vector2(0, r), top + Vector2(0, h - r), c, 1.2, true)
	_draw.draw_line(top + Vector2(w, r), top + Vector2(w, h - r), c, 1.2, true)
	_draw.draw_arc(top + Vector2(r, r), r, PI, TAU, 12, c, 1.2, true)
	_draw.draw_arc(top + Vector2(r, h - r), r, 0.0, PI, 12, c, 1.2, true)

func _ship(vp: Vector2, c: Vector2, s: ReachShip) -> void:
	var sys: ReachSystem = reach.system
	var cam := _draw.get_viewport().get_camera_3d()
	if not cam:
		return
	# The reticle: where her nose is.
	_draw.draw_arc(c, 14.0, 0.0, TAU, 32, Color(ReachStyle.BONE, 0.5), 1.5, true)
	_draw.draw_circle(c, 1.6, Color(ReachStyle.BONE, 0.7))
	# Where she is actually going, relative to the world that matters (the
	# locked one, else the one the assist is flying against): a green ring
	# with wings. On the reticle, she goes where she points; off it, she is
	# sliding; behind you (the hollow ring), she is going backwards.
	var rel_key: String = s.target if s.target != "" else s.assist_body
	var v := s.linear_velocity
	if rel_key != "" and sys.bodies.has(rel_key):
		v -= sys.world_vel(rel_key)
	if v.length() > 0.5:
		var ahead := cam.global_position + v.normalized() * 200.0
		var back := cam.global_position - v.normalized() * 200.0
		if not cam.is_position_behind(ahead):
			var m := cam.unproject_position(ahead)
			_draw.draw_arc(m, 7.0, 0.0, TAU, 20, ReachStyle.PINE, 2.5, true)
			_draw.draw_line(m + Vector2(-17, 0), m + Vector2(-8, 0), ReachStyle.PINE, 2.5)
			_draw.draw_line(m + Vector2(8, 0), m + Vector2(17, 0), ReachStyle.PINE, 2.5)
			_draw.draw_line(m + Vector2(0, -15), m + Vector2(0, -8), ReachStyle.PINE, 2.5)
		elif not cam.is_position_behind(back):
			var m2 := cam.unproject_position(back)
			_draw.draw_arc(m2, 7.0, 0.0, TAU, 20, Color(ReachStyle.PINE, 0.7), 2.0, true)
			_draw.draw_line(m2 + Vector2(-5, -5), m2 + Vector2(5, 5), Color(ReachStyle.PINE, 0.7), 2.0)
			_draw.draw_line(m2 + Vector2(-5, 5), m2 + Vector2(5, -5), Color(ReachStyle.PINE, 0.7), 2.0)
	# Ground ahead: the whole frame goes red at its edges and says so.
	if s._danger > 0.3:
		var a := clampf(s._danger, 0.0, 1.0) * (0.55 + 0.45 * sin(Time.get_ticks_msec() * 0.018))
		var red := Color(1.0, 0.18, 0.1, 0.35 * a)
		for k in 4:
			var w := 26.0 - k * 6.0
			_draw.draw_rect(Rect2(Vector2.ZERO, vp), Color(red, red.a * (1.0 - k * 0.22)), false, w)
		var msg := "PULL UP" if not s.assist else "TERRAIN  ·  BRAKING"
		_draw.draw_string(ReachStyle.round_bold, Vector2(c.x - 220, c.y - 70), msg, HORIZONTAL_ALIGNMENT_CENTER, 440, 34, Color(1.0, 0.35, 0.25, 0.6 + 0.4 * a))
	# Off the screen, the locked world: an arrow at the edge pointing to it.
	if s.target != "" and sys.bodies.has(s.target):
		var at := sys.world(s.target)
		var on_screen := not cam.is_position_behind(at) and Rect2(Vector2(40, 40), vp - Vector2(80, 80)).has_point(cam.unproject_position(at))
		if not on_screen:
			var local := cam.global_basis.inverse() * (at - cam.global_position)
			var dir := Vector2(local.x, -local.y).normalized()
			if dir.length() < 0.1:
				dir = Vector2(0, 1)
			var edge := c + dir * minf(vp.x, vp.y) * 0.42
			var tip := edge + dir * 16.0
			var side := dir.orthogonal() * 10.0
			_draw.draw_colored_polygon(PackedVector2Array([tip, edge + side, edge - side]), ReachStyle.EMBER)
			_draw.draw_string(ReachStyle.round_bold, edge - dir * 22.0 + Vector2(-80, 5), (sys.bodies[s.target] as ReachBody).title, HORIZONTAL_ALIGNMENT_CENTER, 160, 16, ReachStyle.EMBER)
	# Near a world: how to land, until you have.
	if s.piloted and not s.autopilot and s.near_key != "" and s.assist and s._danger < 0.3:
		var msg := ""
		if s.landed:
			msg = "Landed.  E to step out"
		elif s.altitude < 2500.0:
			msg = "Let go to hold still  ·  Hold Shift to land" if s.altitude > 4.0 else "Setting down"
		if msg != "" and not (s.landed and sys.ruling().key == "hearthstone" and _landed_home(s)):
			_draw.draw_string(ReachStyle.round_bold, Vector2(c.x - 260, c.y + 64), msg, HORIZONTAL_ALIGNMENT_CENTER, 520, 19, Color(ReachStyle.BONE, 0.85))
	elif s.piloted and not s.landed and not s.autopilot and sys.ruling().key == "lantern":
		# Out in the open with nothing locked: how not to be lost.
		_draw.draw_string(ReachStyle.round, Vector2(c.x - 260, c.y + 56), "Put a world on the dot and press T to lock it, then G to fly there", HORIZONTAL_ALIGNMENT_CENTER, 520, 17, Color(ReachStyle.BONE, 0.75))
	# Speed and height, low in the middle: from outside only (inside, the
	# cockpit's own screens say it).
	var inside := s.cockpit != null and s.cockpit.visible
	var b := sys.ruling()
	var lines: Array = [] if inside else ["%d m/s" % int(v.length())]
	if b.key != "lantern" and not inside:
		var alt := s.global_position.length() - b.radius
		lines.append("%d m  %s" % [int(alt), b.title.to_upper()])
	if s.integrity < 99.0 and not inside:
		lines.append("HULL %d%%" % int(s.integrity))
	for i in lines.size():
		_draw.draw_string(Style.mono_bold if i == 0 else Style.mono, Vector2(c.x - 150, vp.y - 92 + i * 20), lines[i], HORIZONTAL_ALIGNMENT_CENTER, 300, 18 if i == 0 else 12, ReachStyle.BONE if i == 0 else ReachStyle.MUTE)
	# The locked target: a bracket round it, its distance and closing speed.
	if s.target != "":
		var tb: ReachBody = sys.bodies[s.target]
		var at := sys.world(s.target)
		var d := cam.global_position.distance_to(at) - tb.radius
		var closing := -(s.linear_velocity - sys.world_vel(s.target)).dot((at - s.global_position).normalized())
		var label := "%s  %s  %+d m/s" % [tb.title.to_upper(), _range(d), int(closing)]
		if not cam.is_position_behind(at):
			var m := cam.unproject_position(at)
			var r := 18.0
			for k in 4:
				var a := PI / 4.0 + k * PI / 2.0
				var dir := Vector2(cos(a), sin(a))
				_draw.draw_line(m + dir * r, m + dir * (r + 8.0), ReachStyle.EMBER, 2.0)
			_draw.draw_string(Style.mono, m + Vector2(26, 4), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, ReachStyle.EMBER)
		else:
			_draw.draw_string(Style.mono, Vector2(c.x - 200, 70), label + "  (behind)", HORIZONTAL_ALIGNMENT_CENTER, 400, 12, ReachStyle.EMBER)
		if Input.is_key_pressed(KEY_F):
			_draw.draw_string(Style.mono_bold, Vector2(c.x - 100, c.y + 60), "MATCHING VELOCITY", HORIZONTAL_ALIGNMENT_CENTER, 200, 12, ReachStyle.PINE)

## Parked on the tower at home: no need to say how to land.
func _landed_home(s: ReachShip) -> bool:
	var v: Village = (reach.planets["hearthstone"] as Planet).sites[0]
	return s.global_position.distance_to(v.ship_rest.origin) < 6.0

static func _range(d: float) -> String:
	return "%d m" % int(d) if d < 1000.0 else "%.1f km" % (d / 1000.0)
