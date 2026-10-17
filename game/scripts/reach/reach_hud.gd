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
var _goal: HBoxContainer
var _goal_text: Label
var _caption: Label
var _caption_t := 0.0
var _fade: ColorRect
var _photo: TextureRect
var _photo_note: Label
var _flash: ColorRect
var _hint: Label
var _hint_t := 0.0
## The overlay's canvas is rebuilt this often, not every frame.
var _paint_t := 0.0

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
	_act = ReachStyle.label("", 19, ReachStyle.BONE)
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
	_card_text = ReachStyle.label("", 16, ReachStyle.BONE)
	_card_text.add_theme_font_override("font", ReachStyle.serif)
	ch.add_child(_card_text)
	# A museum's plaque, read (bottom middle, above the prompt).
	_plaque = PanelContainer.new()
	_plaque.add_theme_stylebox_override("panel", ReachStyle.panel(8))
	_plaque.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_plaque.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_plaque.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_plaque.offset_bottom = -150
	_plaque.custom_minimum_size = Vector2(620, 0)
	_plaque.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_plaque.visible = false
	root.add_child(_plaque)
	var pv := VBoxContainer.new()
	pv.add_theme_constant_override("separation", 8)
	_plaque.add_child(pv)
	_plaque_title = ReachStyle.title("", 22, ReachStyle.EMBER)
	pv.add_child(_plaque_title)
	_plaque_text = ReachStyle.label("", 17, ReachStyle.BONE)
	_plaque_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_plaque_text.custom_minimum_size = Vector2(576, 0)
	pv.add_child(_plaque_text)
	# What to do next, quietly, top left.
	_goal = HBoxContainer.new()
	_goal.position = Vector2(34, 30)
	_goal.add_theme_constant_override("separation", 10)
	_goal.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_goal)
	var gm := ReachStyle.label("◆", 13, ReachStyle.EMBER)
	_goal.add_child(gm)
	_goal_text = ReachStyle.label("", 17, ReachStyle.BONE)
	_goal_text.add_theme_font_override("font", ReachStyle.serif)
	_shadow(_goal_text)
	_goal.add_child(_goal_text)
	_goal.modulate.a = 0.0
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
	_caption = ReachStyle.label("", 22, ReachStyle.BONE)
	_caption.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_caption.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_caption.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_caption.offset_bottom = -110
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_shadow(_caption)
	root.add_child(_caption)
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
	_hint = ReachStyle.label("", 13, ReachStyle.BONE, true)
	_hint.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_hint.offset_left = 156
	_hint.offset_bottom = -52
	_hint.modulate.a = 0.0
	_shadow(_hint)
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
func toast(text: String, seconds := 3.0) -> void:
	_card_text.text = text.capitalize() if text == text.to_upper() and text.length() > 3 else text
	_card_t = seconds

## A plaque's words, while you stay near the thing it is on.
func plaque(title: String, text: String, at: Vector3) -> void:
	_plaque_title.text = title
	_plaque_text.text = text
	_plaque_at = at
	_plaque_t = 20.0
	_plaque.visible = true

## What to do next ("" for nothing).
func goal(text: String) -> void:
	if text == _goal_text.text:
		return
	_goal_text.text = text
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
func hint(text: String, seconds := 16.0) -> void:
	_hint.text = text
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
func fade_to(c: Color, seconds: float) -> void:
	var t := create_tween()
	t.tween_property(_fade, "color", c, seconds)
	await t.finished

func _process(dt: float) -> void:
	_card_t -= dt
	var show := clampf(_card_t * 2.0, 0.0, 1.0)
	_card.modulate.a = show
	_card.offset_right = lerpf(_card.offset_right, -28.0 if _card_t > 0.0 else 420.0, minf(1.0, dt * 9.0))
	_card.offset_left = _card.offset_right - _card.size.x
	_place_t -= dt
	_place.modulate.a = clampf(minf(_place_t, 4.0 - _place_t) * 1.2, 0.0, 1.0)
	var pl: Explorer = reach.player
	if _plaque.visible:
		_plaque_t -= dt
		if _plaque_t <= 0.0 or not pl or pl.global_position.distance_to(_plaque_at) > 4.5:
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
	_visor.visible = on_foot
	if on_foot:
		var vp := _visor.get_viewport_rect().size
		_visor_mat.set_shader_parameter("aspect", Vector2(vp.x / maxf(vp.y, 1.0), 1.0))
	# At 30 a second: a dot, three capsules and a line of text rebuilt sixty
	# times is half of the work done for nothing (the eye cannot tell).
	_paint_t += dt
	if _paint_t >= 1.0 / 30.0:
		_paint_t = 0.0
		_draw.queue_redraw()

func _paint() -> void:
	var vp := _draw.get_viewport_rect().size
	var c := vp / 2.0
	var p: Explorer = reach.player
	var s: ReachShip = reach.ship
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
	# The reticle, and where she is heading (relative to the frame's body).
	_draw.draw_arc(c, 14.0, 0.0, TAU, 32, Color(ReachStyle.BONE, 0.5), 1.5, true)
	var v := s.linear_velocity
	if s.target != "":
		v -= sys.world_vel(s.target)
	if v.length() > 0.5:
		var ahead := cam.global_position + v.normalized() * 200.0
		if not cam.is_position_behind(ahead):
			var m := cam.unproject_position(ahead)
			_draw.draw_circle(m, 5.0, Color(ReachStyle.PINE, 0.85))
			_draw.draw_line(m + Vector2(-11, 0), m + Vector2(-6, 0), ReachStyle.PINE, 2.0)
			_draw.draw_line(m + Vector2(6, 0), m + Vector2(11, 0), ReachStyle.PINE, 2.0)
			_draw.draw_line(m + Vector2(0, -11), m + Vector2(0, -6), ReachStyle.PINE, 2.0)
	# Speed and height, low in the middle.
	var b := sys.ruling()
	var lines := ["%d m/s" % int(v.length())]
	if b.key != "lantern":
		var alt := s.global_position.length() - b.radius
		lines.append("%d m  %s" % [int(alt), b.title.to_upper()])
	if s.integrity < 99.0:
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

static func _range(d: float) -> String:
	return "%d m" % int(d) if d < 1000.0 else "%.1f km" % (d / 1000.0)
