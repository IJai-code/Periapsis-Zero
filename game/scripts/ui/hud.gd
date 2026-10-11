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

const SPEAKERS := {
	"Captain Hale": Style.EMBER,
	"Renn Ayers": Style.ION,
	"Mara Voss": Color("#ffb347"),
	"Aster": Style.MUTE,
	"Kestrel": Style.BONE,
	"Tamsin": Color("#9fd8b8"),
}

var root: Control
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
	root.add_child(_help)

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
	root.add_child(_obj_small)

	# The objective, large, bottom centre, when it changes.
	_obj_big = _rich(30, Style.sans_bold)
	_obj_big.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_obj_big.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_obj_big.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_obj_big.offset_bottom = -210
	_obj_big.custom_minimum_size = Vector2(1100, 0)
	_obj_big.modulate.a = 0.0
	root.add_child(_obj_big)

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
	if _help_left > 0.0:
		_help_left -= dt
		if _help_left <= 0.0:
			_tween(_help, 0.0, 0.4)

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
		var t := create_tween()
		t.tween_property(_obj_big, "modulate:a", 1.0, 0.4)
		t.tween_interval(4.0)
		t.tween_property(_obj_big, "modulate:a", 0.0, 0.8)
		_obj_small.modulate.a = 0.0
		create_tween().tween_property(_obj_small, "modulate:a", 1.0, 0.6).set_delay(0.3)

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

func _run_queue() -> void:
	_speaking = true
	while _queue.size() > 0:
		var q: Dictionary = _queue.pop_front()
		var col: Color = SPEAKERS.get(q.who, Style.MUTE)
		_sub.text = "[center][color=#%s]%s:[/color] %s[/center]" % [col.to_html(false), q.who, q.line]
		_sub.visible_ratio = 0.0
		Sfx.play("comm", -16.0)
		_tween(_sub, 1.0, 0.2)
		create_tween().tween_property(_sub, "visible_ratio", 1.0, minf(1.0, q.line.length() * 0.018))
		await get_tree().create_timer(q.secs, true, false, true).timeout
		if _queue.is_empty():
			_tween(_sub, 0.0, 0.3)
		q.done = true
		line_done.emit()
	_speaking = false

func silence() -> void:
	for q in _queue:
		q.done = true
	_queue.clear()
	line_done.emit()
	_tween(_sub, 0.0, 0.2)

## A line of the opening film's narration: fades up, holds, fades away.
## [words] are in ember. Awaitable.
func narrate(text: String, seconds := 5.0) -> void:
	_narr.text = "[center]" + _accent(text) + "[/center]"
	var t := create_tween()
	t.tween_property(_narr, "modulate:a", 1.0, 1.0)
	t.tween_interval(seconds)
	t.tween_property(_narr, "modulate:a", 0.0, 0.9)
	await t.finished

## A mission title, sliding in lower left.
func card(title: String, sub := "", seconds := 3.5) -> void:
	_card_title.text = title
	_card_sub.text = sub
	_card.position.x = 56.0
	var t := create_tween().set_parallel()
	t.tween_property(_card, "modulate:a", 1.0, 0.7)
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
		_was_captured = Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		if not _pause:
			_pause = PanelContainer.new()
			_pause.add_theme_stylebox_override("panel", Style.panel(14))
			_pause.set_anchors_preset(Control.PRESET_CENTER)
			_pause.grow_horizontal = Control.GROW_DIRECTION_BOTH
			_pause.grow_vertical = Control.GROW_DIRECTION_BOTH
			var v := VBoxContainer.new()
			v.add_theme_constant_override("separation", 12)
			v.custom_minimum_size = Vector2(340, 0)
			_pause.add_child(v)
			v.add_child(Style.label("PAUSED", 16, Style.EMBER, Style.mono_bold))
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
		(_pause.get_child(0).get_child(1) as Button).grab_focus()
	else:
		_pause.visible = false
		if _was_captured:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func fade_out(seconds := 0.8) -> void:
	_fade.mouse_filter = Control.MOUSE_FILTER_STOP
	await _tween(_fade, 1.0, seconds).finished

func fade_in(seconds := 1.2) -> void:
	await _tween(_fade, 0.0, seconds).finished
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE

var _bars: Array[ColorRect] = []

## Widescreen bars for cutscenes; the objective and help step aside.
func letterbox(on: bool) -> void:
	for c in [_obj_big, _obj_small, _help]:
		_tween(c, 0.0 if on else (1.0 if c == _obj_small and _obj_plain != "" else 0.0), 0.4)
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
	for q in _queue:
		q.done = true
	_queue.clear()
	line_done.emit()
	for c in [_obj_small, _obj_big, _sub, _help, _card, _narr]:
		c.modulate.a = 0.0
	_obj_plain = ""

func _tween(node: CanvasItem, alpha: float, seconds: float) -> Tween:
	var t := create_tween()
	t.tween_property(node, "modulate:a", alpha, seconds)
	return t
