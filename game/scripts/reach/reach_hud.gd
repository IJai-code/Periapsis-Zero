class_name ReachHud
extends CanvasLayer
## What the visor and the cockpit show, and no more: a dot to aim with, what
## E would do, the suit's three gauges (only when not full), and in the
## Kestrel: speed, height, the locked target and which way you are going.

var reach: Node
var _draw: Control
var _prompt: Label
var _toast: Label
var _toast_t := 0.0
var _caption: Label
var _caption_t := 0.0
var _fade: ColorRect
var _photo: TextureRect
var _photo_note: Label
var _flash: ColorRect
var _hint: Label
var _hint_t := 0.0

func _ready() -> void:
	layer = 6
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_draw = Control.new()
	_draw.set_anchors_preset(Control.PRESET_FULL_RECT)
	_draw.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_draw.draw.connect(_paint)
	root.add_child(_draw)
	_prompt = ReachStyle.label("", 18, ReachStyle.BONE)
	_prompt.set_anchors_preset(Control.PRESET_CENTER)
	_prompt.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_prompt.position.y += 44
	_shadow(_prompt)
	root.add_child(_prompt)
	_toast = ReachStyle.label("", 15, ReachStyle.EMBER, true)
	_toast.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_toast.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.offset_top = 36
	_shadow(_toast)
	root.add_child(_toast)
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
	_hint.offset_left = 40
	_hint.offset_bottom = -84
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

## A line at the top for a few seconds ("Ship log updated").
func toast(text: String, seconds := 3.0) -> void:
	_toast.text = text
	_toast_t = seconds

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

## The whole screen to a colour and back; awaitable.
func fade_to(c: Color, seconds: float) -> void:
	var t := create_tween()
	t.tween_property(_fade, "color", c, seconds)
	await t.finished

func _process(dt: float) -> void:
	_toast_t -= dt
	_toast.modulate.a = clampf(_toast_t, 0.0, 1.0)
	_caption_t -= dt
	_caption.modulate.a = clampf(_caption_t, 0.0, 1.0)
	_hint_t -= dt
	_hint.modulate.a = clampf(_hint_t, 0.0, 0.85)
	var p: Explorer = reach.player
	var s: ReachShip = reach.ship
	var text := ""
	if p and p.enabled and p.focus:
		text = "[E]  " + p.focus.prompt
	elif s and s.piloted and s.landed:
		text = "[E]  Leave the seat"
	_prompt.text = text
	_draw.queue_redraw()

func _paint() -> void:
	var vp := _draw.get_viewport_rect().size
	var c := vp / 2.0
	var p: Explorer = reach.player
	var s: ReachShip = reach.ship
	if s and s.piloted:
		_ship(vp, c, s)
	elif p and p.enabled:
		_draw.draw_circle(c, 2.4, Color(ReachStyle.BONE, 0.75))
		_suit(vp, p)

func _suit(vp: Vector2, p: Explorer) -> void:
	var gauges := [
		["O2", p.oxygen / Explorer.OXY_MAX, ReachStyle.PINE],
		["FUEL", p.fuel / Explorer.FUEL_MAX, ReachStyle.EMBER],
		["SUIT", p.health / 100.0, ReachStyle.BONE],
	]
	var show := not p.breathing
	for g in gauges:
		if float(g[1]) < 0.995:
			show = true
	if not show:
		return
	var at := Vector2(40, vp.y - 50)
	for i in gauges.size():
		var g: Array = gauges[i]
		var x := at.x + i * 96
		var f := clampf(float(g[1]), 0.0, 1.0)
		var col: Color = g[2]
		if f < 0.25:
			col = Color(ReachStyle.EMBER, 0.6 + 0.4 * sin(Time.get_ticks_msec() * 0.012))
		_draw.draw_rect(Rect2(Vector2(x, at.y), Vector2(80, 5)), Color(ReachStyle.BONE, 0.14))
		_draw.draw_rect(Rect2(Vector2(x, at.y), Vector2(80 * f, 5)), col)
		_draw.draw_string(Style.mono, Vector2(x, at.y - 8), g[0], HORIZONTAL_ALIGNMENT_LEFT, -1, 11, ReachStyle.MUTE)
	if not p.breathing:
		_draw.draw_string(Style.mono_bold, Vector2(at.x, at.y - 30), "NO AIR  ·  %d s" % int(maxf(p.oxygen, 0.0)), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ReachStyle.EMBER)

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
