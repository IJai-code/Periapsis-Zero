extends CanvasLayer
## Everything drawn over the game, in the manner of an open-world crime
## game: a help box top left for controls, the objective spoken large at
## the bottom when it changes and kept small top right, subtitles as
## outlined text with the speaker's name in colour, mission titles that
## slide in lower left. Scenes talk to it; it never decides anything.
##
##   Hud.card("THE ASTER", "Harbor orbit · 3091")
##   Hud.objective("Report to the [bridge]", "16 m")   # [words] in ember
##   Hud.prompt("[W][A][S][D] walk   [Mouse] look")     # [keys] as keycaps
##   await Hud.say("Captain Hale", "All hands...")

signal line_done

const CONTROLS := """ON FOOT
  W A S D   walk          Shift   run
  Mouse     look          Arrows  look
  C / Ctrl  crouch        Space   jump
  E         use, talk, sit, stand

IN FLIGHT
  Mouse     steer         Arrows  steer
  W / S     speed up, slow down
  A / D     slide         Q / E   roll
  Space/C   up, down      Shift   boost
  Click / K fire guns     T       lock target
  Right click / R  missiles at the lock
  G         warp drive    V       wider view
  Double-tap A or D  barrel roll (breaks a missile's lock)

  Esc / P   pause"""

const SPEAKERS := {
	"Captain Hale": Style.EMBER,
	"Renn Ayers": Style.ION,
	"Mara Voss": Color("#ffb347"),
	"Aster": Style.MUTE,
	"Kestrel": Style.BONE,
	"Tamsin": Color("#9fd8b8"),
	"Rook": Color("#e0503f"),
	"Hearth Traffic": Color("#8fd3e8"),
	"Flight recorder": Style.MUTE,
	"Hearth PA": Color("#8fd3e8"),
}

## Faces on the comms panel in flight (art/portraits, rendered from the
## people themselves). A caller with no face shows a channel card instead.
const PORTRAITS := {
	"Captain Hale": "hale", "Renn Ayers": "renn", "Mara Voss": "mara", "Hearth Traffic": "crowd2",
}
const CHANNELS := {
	"Captain Hale": "ASTER · BRIDGE", "Renn Ayers": "ASTER · ENGINEERING", "Mara Voss": "HEARTH · DOCKMASTER",
	"Hearth Traffic": "HEARTH · TRAFFIC CONTROL", "Rook": "PRIVATE RELAY · ENCRYPTED", "Tamsin": "CONVOY · MERIDIAN",
	"Flight recorder": "ASTER · BRIDGE CORE",
}

var root: Control
## The gameplay layer (help, objectives): hidden as one in cutscenes.
var _play_ui: Control
var cinematic := false
var _fade: ColorRect
var _wake: ColorRect
var _loading: Label
var _help: PanelContainer
var _help_text: RichTextLabel
var _help_left := 0.0
var _obj_big: RichTextLabel
var _obj_small: VBoxContainer
var _obj_text: RichTextLabel
var _obj_extra: Label
var _obj_plain := ""
var _sub: RichTextLabel
var _narr: RichTextLabel
var _card: Control
var _card_title: Label
var _card_sub: Label
var _queue: Array = []
var _speaking := false

func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = Style.theme()
	add_child(root)
	var film := ColorRect.new()
	film.set_anchors_preset(Control.PRESET_FULL_RECT)
	film.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var fm := ShaderMaterial.new()
	fm.shader = load("res://shaders/film.gdshader")
	film.material = fm
	root.add_child(film)
	_wake = ColorRect.new()
	_wake.set_anchors_preset(Control.PRESET_FULL_RECT)
	_wake.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var wm := ShaderMaterial.new()
	wm.shader = load("res://shaders/wake.gdshader")
	_wake.material = wm
	_wake.visible = false
	root.add_child(_wake)

	_play_ui = Control.new()
	_play_ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	_play_ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_play_ui)

	# Help box, top left: how to do the thing in front of you.
	_help = PanelContainer.new()
	var hb := StyleBoxFlat.new()
	hb.bg_color = Color(0.02, 0.015, 0.04, 0.72)
	hb.set_corner_radius_all(6)
	hb.content_margin_left = 20
	hb.content_margin_right = 20
	hb.content_margin_top = 14
	hb.content_margin_bottom = 14
	_help.add_theme_stylebox_override("panel", hb)
	_help.position = Vector2(40, 40)
	_help.custom_minimum_size = Vector2(0, 0)
	_help_text = _rich(21, Style.sans)
	_help_text.custom_minimum_size = Vector2(560, 0)
	_help_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_help.add_child(_help_text)
	_help.modulate.a = 0.0
	_play_ui.add_child(_help)

	# The objective, small, top right.
	_obj_small = VBoxContainer.new()
	_obj_small.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	_obj_small.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_obj_small.offset_right = -40
	_obj_small.offset_top = 36
	_obj_small.alignment = BoxContainer.ALIGNMENT_END
	_obj_small.add_theme_constant_override("separation", 0)
	var tag := Style.label("OBJECTIVE", 13, Style.EMBER, Style.mono_bold)
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_obj_small.add_child(tag)
	_obj_text = _rich(22, Style.sans_bold)
	_obj_text.custom_minimum_size = Vector2(460, 0)
	_obj_small.add_child(_obj_text)
	_obj_extra = Style.label("", 15, Style.MUTE, Style.mono)
	_obj_extra.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_outline(_obj_extra)
	_obj_small.add_child(_obj_extra)
	_obj_small.modulate.a = 0.0
	_play_ui.add_child(_obj_small)

	# Marks in the world: the waypoint and the thing you can use.
	_marks = Control.new()
	_marks.set_anchors_preset(Control.PRESET_FULL_RECT)
	_marks.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_marks.draw.connect(_draw_marks)
	_play_ui.add_child(_marks)

	# The objective, large, bottom centre, when it changes.
	_obj_big = _rich(30, Style.sans_bold)
	_obj_big.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_obj_big.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_obj_big.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_obj_big.offset_bottom = -210
	_obj_big.custom_minimum_size = Vector2(1100, 0)
	_obj_big.modulate.a = 0.0
	_play_ui.add_child(_obj_big)

	# Subtitles, bottom centre: outlined, no box.
	_sub = _rich(27, Style.sans)
	_sub.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_sub.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_sub.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_sub.offset_bottom = -96
	_sub.custom_minimum_size = Vector2(1180, 0)
	_sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_sub.modulate.a = 0.0
	root.add_child(_sub)

	# Narration for the opening film, centre low.
	_narr = _rich(34, Style.sans)
	_narr.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_narr.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_narr.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_narr.offset_bottom = -150
	_narr.custom_minimum_size = Vector2(1240, 0)
	_narr.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_narr.modulate.a = 0.0
	root.add_child(_narr)

	# Mission titles, lower left, sliding in.
	_card = VBoxContainer.new()
	_card.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_card.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_card.offset_left = 96
	_card.offset_bottom = -170
	_card.add_theme_constant_override("separation", 2)
	var bar := ColorRect.new()
	bar.color = Style.EMBER
	bar.custom_minimum_size = Vector2(90, 5)
	_card.add_child(bar)
	_card_title = Style.label("", 92, Style.BONE, Style.sans_bold)
	_card_title.add_theme_constant_override("line_spacing", -20)
	_outline(_card_title, 3, 0.35)
	_card.add_child(_card_title)
	_card_sub = Style.label("", 19, Style.EMBER, Style.mono_bold)
	_outline(_card_sub)
	_card.add_child(_card_sub)
	_card.modulate.a = 0.0
	_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_card)

	_fade = ColorRect.new()
	_fade.color = Color.BLACK
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_fade)
	_loading = Style.label("LOADING", 14, Style.MUTE, Style.mono_bold)
	_loading.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_loading.offset_left = -160
	_loading.offset_top = -60
	_loading.visible = false
	_fade.add_child(_loading)

func _rich(size: int, font: Font) -> RichTextLabel:
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = true
	r.scroll_active = false
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.add_theme_font_override("normal_font", font)
	r.add_theme_font_override("bold_font", Style.sans_bold)
	r.add_theme_font_override("mono_font", Style.mono_bold)
	r.add_theme_font_size_override("normal_font_size", size)
	r.add_theme_font_size_override("bold_font_size", size)
	r.add_theme_font_size_override("mono_font_size", int(size * 0.8))
	r.add_theme_constant_override("outline_size", 9)
	r.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.75))
	return r

func _outline(l: Label, size := 7, alpha := 0.7) -> void:
	l.add_theme_constant_override("outline_size", size)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, alpha))

## [words] in an objective become ember; [keys] in a prompt become keycaps.
static func _accent(text: String) -> String:
	var re := RegEx.create_from_string("\\[([^\\]]+)\\]")
	return re.sub(text, "[color=#ff6b2c]$1[/color]", true)

static func _keys(text: String) -> String:
	var re := RegEx.create_from_string("\\[([^\\]]+)\\]")
	return re.sub(text, "[bgcolor=#f4e8cf30][code] $1 [/code][/bgcolor]", true)

func _process(dt: float) -> void:
	_marks.queue_redraw()
	if _comm and _comm.visible:
		_comm_bars.queue_redraw()
	if _help_left > 0.0:
		_help_left -= dt
		if _help_left <= 0.0:
			_tween(_help, 0.0, 0.4)

var _marks: Control
var _focus: Node3D = null
var _focus_t := 0.0
var _way: Variant = null       # a Node3D or a Vector3
var _way_label := ""
var _way_h := 1.2

## The thing the player can use right now: its prompt is drawn on it, a
## keycap and the words, so it is where the player is already looking.
func focus(target: Node3D) -> void:
	if target != _focus:
		_focus_t = 0.0
	_focus = target

func focus_text() -> String:
	if _focus and is_instance_valid(_focus) and _focus.has_method("prompt_text"):
		return _focus.prompt_text()
	return ""

## The objective's place in the world, marked like a map blip: a chevron
## over it with the distance, pinned to the screen's edge when out of view.
## Pass a Node3D (followed) or a Vector3; null clears it.
func waypoint(target: Variant, label := "", height := 1.2) -> void:
	_way = target
	_way_label = label
	_way_h = height

func _draw_marks() -> void:
	var cam := get_viewport().get_camera_3d()
	if not cam or cinematic:
		return
	var vp := _marks.size
	_focus_t += get_process_delta_time()
	# The usable thing.
	var text := focus_text()
	if text != "" and is_instance_valid(_focus):
		var at := _focus.global_position + Vector3(0, 0.45, 0)
		var p := vp * Vector2(0.5, 0.62)
		if not cam.is_position_behind(at):
			p = cam.unproject_position(at)
		p.x = clampf(p.x, 160.0, vp.x - 160.0)
		p.y = clampf(p.y, 120.0, vp.y - 160.0)
		var a := minf(1.0, _focus_t * 6.0)
		var key := ""
		var words := text
		var m := RegEx.create_from_string("^\\[([^\\]]+)\\]\\s*").search(text)
		if m:
			key = m.get_string(1)
			words = text.substr(m.get_end())
		var fs := 22
		var w := Style.sans_bold.get_string_size(words, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		var kw := 34.0 if key != "" else 0.0
		var total := w + kw + (12.0 if key != "" else 0.0)
		var o := p - Vector2(total / 2.0, 0)
		_marks.draw_rect(Rect2(o - Vector2(14, 26), Vector2(total + 28, 40)), Color(0.02, 0.015, 0.04, 0.62 * a))
		if key != "":
			_marks.draw_rect(Rect2(o + Vector2(0, -20), Vector2(kw, 28)), Color(Style.BONE, 0.95 * a))
			_marks.draw_string(Style.mono_bold, o + Vector2(0, 0), key, HORIZONTAL_ALIGNMENT_CENTER, kw, 18, Color(Style.VOID, a))
			o.x += kw + 12.0
		_marks.draw_string(Style.sans_bold, o + Vector2(0, 2), words, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(Style.BONE, a))
	# The waypoint.
	if _way == null or (_way is Node3D and not is_instance_valid(_way)):
		return
	var world: Vector3 = ((_way as Node3D).global_position if _way is Node3D else _way) + Vector3(0, _way_h, 0)
	var dist := cam.global_position.distance_to(world)
	# Close enough to see it: the marker steps aside (the prompt takes over).
	if dist < 5.0:
		return
	var c := Color(Style.EMBER, 0.95)
	var bob := sin(Time.get_ticks_msec() * 0.004) * 3.0
	var inside := false
	var q := Vector2.ZERO
	if not cam.is_position_behind(world):
		q = cam.unproject_position(world)
		inside = Rect2(Vector2(60, 60), vp - Vector2(120, 120)).has_point(q)
	if inside:
		q.y += bob
		_marks.draw_colored_polygon(PackedVector2Array([q + Vector2(-11, -16), q + Vector2(11, -16), q]), c)
		_marks.draw_polyline(PackedVector2Array([q + Vector2(-11, -16), q + Vector2(11, -16), q, q + Vector2(-11, -16)]), Color(0, 0, 0, 0.5), 1.5, true)
		var t := ("%s  ·  %d m" % [_way_label, int(dist)]) if _way_label != "" else "%d m" % int(dist)
		_marks.draw_string_outline(Style.mono_bold, q + Vector2(-120, -26), t, HORIZONTAL_ALIGNMENT_CENTER, 240, 14, 5, Color(0, 0, 0, 0.7))
		_marks.draw_string(Style.mono_bold, q + Vector2(-120, -26), t, HORIZONTAL_ALIGNMENT_CENTER, 240, 14, c)
	else:
		var local := cam.global_basis.inverse() * (world - cam.global_position)
		var d := Vector2(local.x, -local.y)
		if local.z > 0.0 and d.length() < 0.001:
			d = Vector2(0, 1)
		d = d.normalized()
		var e := vp / 2.0 + d * Vector2(vp.x * 0.46, vp.y * 0.42)
		var n := Vector2(-d.y, d.x)
		_marks.draw_colored_polygon(PackedVector2Array([e + d * 16.0, e - d * 8.0 + n * 12.0, e - d * 8.0 - n * 12.0]), c)
		_marks.draw_string_outline(Style.mono_bold, e - d * 34.0 + Vector2(-60, 5), "%d m" % int(dist), HORIZONTAL_ALIGNMENT_CENTER, 120, 13, 5, Color(0, 0, 0, 0.7))
		_marks.draw_string(Style.mono_bold, e - d * 34.0 + Vector2(-60, 5), "%d m" % int(dist), HORIZONTAL_ALIGNMENT_CENTER, 120, 13, c)

func prompt(text: String, seconds := 0.0) -> void:
	_help_text.text = _keys(text)
	_help_left = seconds
	_tween(_help, 1.0, 0.3)

func clear_prompt() -> void:
	_help_left = 0.0
	_tween(_help, 0.0, 0.3)

func objective(text: String, extra := "") -> void:
	var plain := text
	var changed := plain != _obj_plain
	_obj_plain = plain
	_obj_text.text = "[right]" + _accent(text) + "[/right]"
	_obj_extra.text = extra
	if changed:
		Sfx.play("objective", -8.0)
		_obj_big.text = "[center]" + _accent(text) + "[/center]"
		var t := _tween(_obj_big, 1.0, 0.4)
		t.tween_interval(4.0)
		t.tween_property(_obj_big, "modulate:a", 0.0, 0.8)
		_obj_small.modulate.a = 0.0
		_tween(_obj_small, 1.0, 0.6)

func objective_extra(extra: String) -> void:
	_obj_extra.text = extra

func clear_objective() -> void:
	_obj_plain = ""
	_tween(_obj_small, 0.0, 0.4)
	_tween(_obj_big, 0.0, 0.3)

## Queue a line; awaitable (returns when that line has been shown).
func say(speaker: String, line: String, seconds := 0.0) -> void:
	var secs := seconds if seconds > 0.0 else clampf(1.6 + line.length() * 0.055, 2.5, 7.5)
	var entry := {"who": speaker, "line": line, "secs": secs, "done": false}
	_queue.append(entry)
	if not _speaking:
		_run_queue()
	while not entry.done:
		await line_done

## Lines play one after another. `silence` and `reset` start a new
## generation: the running loop sees it and stops at once, so the next line
## shows straight away instead of after the cut line's time.
var _gen := 0

func _run_queue() -> void:
	_speaking = true
	var gen := _gen
	while _queue.size() > 0 and gen == _gen:
		var q: Dictionary = _queue.pop_front()
		var col: Color = SPEAKERS.get(q.who, Style.MUTE)
		_sub.text = "[center][color=#%s]%s:[/color] %s[/center]" % [col.to_html(false), q.who, q.line]
		_sub.visible_ratio = 0.0
		Sfx.play("comm", -16.0)
		_comm_show(q.who)
		_tween(_sub, 1.0, 0.2)
		create_tween().tween_property(_sub, "visible_ratio", 1.0, minf(1.0, q.line.length() * 0.018))
		await get_tree().create_timer(q.secs, true, false, true).timeout
		q.done = true
		line_done.emit()
		if gen != _gen:
			return
		if _queue.is_empty():
			_tween(_sub, 0.0, 0.3)
			if _comm:
				_tween(_comm, 0.0, 0.4)
	if gen == _gen:
		_speaking = false

var _flight := false
var _comm: PanelContainer
var _comm_face: TextureRect
var _comm_none: Label
var _comm_name: Label
var _comm_chan: Label
var _comm_bars: Control

## In flight the subtitles sit higher (the ship's gauge is at the bottom)
## and whoever is talking shows on the comms panel, bottom left.
func flight_layout(on: bool) -> void:
	_flight = on
	_sub.offset_bottom = -232.0 if on else -96.0
	_card.offset_bottom = -260.0 if on else -170.0
	_obj_big.offset_bottom = -330.0 if on else -210.0
	if not on and _comm:
		_comm.visible = false

func _comm_show(who: String) -> void:
	if not _flight or not (PORTRAITS.has(who) or CHANNELS.has(who)):
		if _comm:
			_tween(_comm, 0.0, 0.3)
		return
	if not _comm:
		_comm = PanelContainer.new()
		_comm.add_theme_stylebox_override("panel", Style.panel(10))
		_comm.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
		_comm.grow_vertical = Control.GROW_DIRECTION_BEGIN
		_comm.offset_left = 40
		_comm.offset_bottom = -40
		_comm.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 14)
		_comm.add_child(h)
		var frame := Control.new()
		frame.custom_minimum_size = Vector2(112, 112)
		h.add_child(frame)
		_comm_face = TextureRect.new()
		_comm_face.set_anchors_preset(Control.PRESET_FULL_RECT)
		_comm_face.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		_comm_face.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		_comm_face.modulate = Color(0.85, 0.95, 1.05)
		frame.add_child(_comm_face)
		_comm_none = Style.label("NO VIDEO", 12, Style.MUTE, Style.mono_bold)
		_comm_none.set_anchors_preset(Control.PRESET_FULL_RECT)
		_comm_none.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_comm_none.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		frame.add_child(_comm_none)
		var scan := ColorRect.new()
		scan.set_anchors_preset(Control.PRESET_FULL_RECT)
		scan.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var sm := ShaderMaterial.new()
		var sh := Shader.new()
		sh.code = "shader_type canvas_item;\nvoid fragment(){ float l = step(0.5, fract(UV.y * 56.0 + TIME * 0.6)); COLOR = vec4(0.05, 0.12, 0.16, 0.18 * l + 0.04); }"
		sm.shader = sh
		scan.material = sm
		frame.add_child(scan)
		var v := VBoxContainer.new()
		v.add_theme_constant_override("separation", 4)
		v.custom_minimum_size = Vector2(220, 0)
		h.add_child(v)
		v.add_child(Style.label("COMMS", 11, Style.EMBER, Style.mono_bold))
		_comm_name = Style.label("", 20, Style.BONE, Style.sans_bold)
		v.add_child(_comm_name)
		_comm_chan = Style.label("", 11, Style.MUTE, Style.mono)
		v.add_child(_comm_chan)
		_comm_bars = Control.new()
		_comm_bars.custom_minimum_size = Vector2(200, 30)
		_comm_bars.draw.connect(func():
			var n := 22
			for i in n:
				var k := 0.15
				if _speaking and _sub.visible_ratio < 1.0 or _speaking and fmod(Time.get_ticks_msec() * 0.001, 0.6) < 0.45:
					k = 0.2 + 0.8 * absf(sin(Time.get_ticks_msec() * 0.011 + i * 1.7) * sin(Time.get_ticks_msec() * 0.004 + i * 0.6))
				var hgt := 28.0 * k
				_comm_bars.draw_rect(Rect2(Vector2(i * 9.0, 15.0 - hgt / 2.0), Vector2(5.0, hgt)), Color(Style.ION, 0.85)))
		v.add_child(_comm_bars)
		_comm.modulate.a = 0.0
		_play_ui.add_child(_comm)
	var face: String = PORTRAITS.get(who, "")
	_comm_face.texture = load("res://art/portraits/%s.png" % face) if face != "" else null
	_comm_none.visible = face == ""
	_comm_none.text = "SIGNAL ENCRYPTED" if who == "Rook" else "AUDIO ONLY"
	_comm_name.text = who
	_comm_name.add_theme_color_override("font_color", SPEAKERS.get(who, Style.BONE))
	_comm_chan.text = CHANNELS.get(who, "OPEN CHANNEL")
	_comm.visible = true
	_tween(_comm, 1.0, 0.2)

## Something a passer-by says as the player goes by: shown only when no
## one in the story is talking.
func overheard(line: String) -> void:
	if _speaking or cinematic or not _queue.is_empty():
		return
	say("Passer-by", line, 3.2)

func silence() -> void:
	_gen += 1
	_speaking = false
	for q in _queue:
		q.done = true
	_queue.clear()
	line_done.emit()
	_tween(_sub, 0.0, 0.2)

## A line of the opening film's narration: fades up, holds, fades away.
## [words] are in ember. Awaitable.
func narrate(text: String, seconds := 5.0) -> void:
	_narr.text = "[center]" + _accent(text) + "[/center]"
	var t := _tween(_narr, 1.0, 1.0)
	t.tween_interval(seconds)
	t.tween_property(_narr, "modulate:a", 0.0, 0.9)
	await t.finished

## MISSION PASSED: the big ember title, the pay counting up, and the debt
## to Rook going down. Awaitable; returns when it has faded.
func mission_passed(title: String, paid: int, to_debt: int, debt_left: int) -> void:
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 6)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var head := Style.label("MISSION PASSED", 84, Style.EMBER, Style.sans_bold)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_outline(head, 10, 0.5)
	box.add_child(head)
	var name := Style.label(title, 26, Style.BONE, Style.sans)
	name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_outline(name)
	box.add_child(name)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 18)
	box.add_child(gap)
	var cash := Style.label("₡ 0", 44, Style.BONE, Style.mono_bold)
	cash.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_outline(cash)
	box.add_child(cash)
	var debt := Style.label("", 18, Style.MUTE, Style.mono)
	debt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_outline(debt)
	box.add_child(debt)
	box.modulate.a = 0.0
	root.add_child(box)
	root.move_child(box, _fade.get_index())
	Sfx.play("objective", -2.0, 0.8)
	var t := create_tween()
	t.tween_property(box, "modulate:a", 1.0, 0.5)
	t.tween_method(func(v: float): cash.text = "₡ %s" % _thousands(int(v)), 0.0, float(paid), 1.4)
	await t.finished
	debt.text = "₡ %s to Rook  ·  ₡ %s still owed" % [_thousands(to_debt), _thousands(debt_left)]
	Sfx.play("click", -6.0)
	await get_tree().create_timer(4.0, true, false, true).timeout
	await _tween(box, 0.0, 0.8).finished
	box.queue_free()

## SHIP LOST: the failure title and why, then a moment before the retry.
## Awaitable.
func mission_failed(reason: String) -> void:
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 8)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var head := Style.label("MISSION FAILED", 84, Style.EMBER, Style.sans_bold)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_outline(head, 10, 0.5)
	box.add_child(head)
	var why := Style.label(reason, 26, Style.BONE, Style.sans)
	why.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_outline(why)
	box.add_child(why)
	var again := Style.label("Retrying from the last checkpoint", 16, Style.MUTE, Style.mono)
	again.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_outline(again)
	box.add_child(again)
	box.modulate.a = 0.0
	root.add_child(box)
	root.move_child(box, _fade.get_index())
	Sfx.play("big", -6.0, 0.7)
	await _tween(box, 1.0, 0.6).finished
	await get_tree().create_timer(3.0, true, false, true).timeout
	await _tween(box, 0.0, 0.6).finished
	box.queue_free()

static func _thousands(n: int) -> String:
	var s := str(absi(n))
	var out := ""
	while s.length() > 3:
		out = "," + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return s + out

## A mission title, sliding in lower left.
func card(title: String, sub := "", seconds := 3.5) -> void:
	_card_title.text = title
	_card_sub.text = sub
	_card.position.x = 56.0
	var t := _tween(_card, 1.0, 0.7)
	t.set_parallel()
	t.tween_property(_card, "position:x", 96.0, 0.9).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	await t.finished
	await get_tree().create_timer(seconds, true, false, true).timeout
	await _tween(_card, 0.0, 1.0).finished

func _unhandled_input(e: InputEvent) -> void:
	if e.is_action_pressed("pause") and not Flow.in_title() and _fade.modulate.a < 0.5:
		pause(not get_tree().paused)
		get_viewport().set_input_as_handled()

var _pause: PanelContainer
var _was_captured := false

## The pause menu: resume, skip this part, or leave for the title.
func pause(on: bool) -> void:
	if on == get_tree().paused:
		return
	get_tree().paused = on
	if on:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		if not _pause:
			_pause = PanelContainer.new()
			_pause.add_theme_stylebox_override("panel", Style.panel(14))
			_pause.set_anchors_preset(Control.PRESET_CENTER)
			_pause.grow_horizontal = Control.GROW_DIRECTION_BOTH
			_pause.grow_vertical = Control.GROW_DIRECTION_BOTH
			var v := VBoxContainer.new()
			v.add_theme_constant_override("separation", 12)
			v.custom_minimum_size = Vector2(520, 0)
			_pause.add_child(v)
			v.add_child(Style.label("PAUSED", 16, Style.EMBER, Style.mono_bold))
			var keys := Style.label(CONTROLS, 16, Style.MUTE, Style.mono)
			v.add_child(keys)
			for b in [["Resume", func(): pause(false)], ["Skip this part", func():
					pause(false)
					var n := Flow.next_scene()
					if n != "":
						Flow.go(n)], ["Back to the title", func():
					pause(false)
					Flow.go("title")]]:
				var btn := Button.new()
				btn.text = b[0]
				btn.pressed.connect(b[1])
				v.add_child(btn)
			root.add_child(_pause)
			root.move_child(_pause, root.get_child_count() - 2)
		_pause.visible = true
		for c in _pause.get_child(0).get_children():
			if c is Button:
				(c as Button).grab_focus()
				break
	else:
		_pause.visible = false
		pass


func fade_out(seconds := 0.8) -> void:
	_fade.mouse_filter = Control.MOUSE_FILTER_STOP
	await _tween(_fade, 1.0, seconds).finished

func fade_in(seconds := 1.2) -> void:
	await _tween(_fade, 0.0, seconds).finished
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE

var _bars: Array[ColorRect] = []

## Widescreen bars for cutscenes; the objective and help step aside.
func letterbox(on: bool) -> void:
	cinematic = on
	_tween(_play_ui, 0.0 if on else 1.0, 0.4)
	if _bars.is_empty():
		for top in [true, false]:
			var r := ColorRect.new()
			r.color = Color.BLACK
			r.mouse_filter = Control.MOUSE_FILTER_IGNORE
			r.set_anchors_preset(Control.PRESET_TOP_WIDE if top else Control.PRESET_BOTTOM_WIDE)
			r.custom_minimum_size = Vector2(0, 0)
			root.add_child(r)
			root.move_child(r, 0)
			_bars.append(r)
	var h := get_viewport().get_visible_rect().size.y * 0.11
	for i in 2:
		var r := _bars[i]
		var t := create_tween()
		t.tween_property(r, "custom_minimum_size:y", h if on else 0.0, 0.6).set_trans(Tween.TRANS_CUBIC)
		if i == 1:
			r.offset_top = 0.0
			t.parallel().tween_property(r, "offset_top", -h if on else 0.0, 0.6).set_trans(Tween.TRANS_CUBIC)

var _click: Label

## "Click to take control", centred: shown by Flow when the game wants the
## mouse and the browser has let it go.
func click_hint(on: bool) -> void:
	if not _click:
		_click = Style.label("Click to take control\nor steer with the arrow keys", 28, Style.BONE, Style.sans_bold)
		_click.set_anchors_preset(Control.PRESET_CENTER)
		_click.grow_horizontal = Control.GROW_DIRECTION_BOTH
		_click.grow_vertical = Control.GROW_DIRECTION_BOTH
		_click.offset_top = 200
		_click.offset_bottom = 200
		_click.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_outline(_click, 10, 0.8)
		_click.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(_click)
	_click.visible = on

## Waking up: the view blurred, clearing over `seconds`.
func wake(seconds: float) -> void:
	_wake.visible = true
	var m := _wake.material as ShaderMaterial
	var t := create_tween()
	t.tween_method(func(v: float): m.set_shader_parameter("amount", v), 1.0, 0.0, seconds).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	await t.finished
	_wake.visible = false

## The note in the corner while a scene loads behind the fade.
func loading(on: bool) -> void:
	_loading.visible = on

## Everything off, for a scene change.
func reset() -> void:
	for t in _fades.values():
		if t and t.is_valid():
			t.kill()
	_fades.clear()
	_help_left = 0.0
	_gen += 1
	_speaking = false
	for q in _queue:
		q.done = true
	_queue.clear()
	line_done.emit()
	for c in [_obj_small, _obj_big, _sub, _help, _card, _narr]:
		c.modulate.a = 0.0
	_obj_plain = ""
	flight_layout(false)
	_focus = null
	_way = null
	cinematic = false
	_play_ui.modulate.a = 1.0
	for b in _bars:
		b.custom_minimum_size.y = 0.0
		b.offset_top = 0.0

## Fade an element. Each element has at most one fade running: a new one
## replaces the old, so two fades can never fight over the same text.
var _fades := {}

func _tween(node: CanvasItem, alpha: float, seconds: float) -> Tween:
	var old: Tween = _fades.get(node.get_instance_id())
	if old and old.is_valid():
		old.kill()
	var t := create_tween()
	t.tween_property(node, "modulate:a", alpha, seconds)
	_fades[node.get_instance_id()] = t
	return t
