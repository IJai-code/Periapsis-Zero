extends CanvasLayer
## Everything drawn over the game: the fade, chapter cards, the objective,
## key prompts and subtitles. Scenes talk to it; it never decides anything.
##
##   Hud.card("THE ASTER", "Harbor orbit · 3091")
##   Hud.objective("Report to the flight deck")
##   Hud.prompt("[W][A][S][D] walk   [Mouse] look")
##   await Hud.say("Captain Hale", "All hands...")

signal line_done

const SPEAKERS := {
	"Captain Hale": Style.EMBER,
	"Renn Ayers": Style.ION,
	"Mara Voss": Style.EMBER,
	"Aster": Style.MUTE,
	"Kestrel": Style.BONE,
}

var _fade: ColorRect
var _card_title: Label
var _card_sub: Label
var _card: VBoxContainer
var _obj_box: PanelContainer
var _obj_text: Label
var _obj_extra: Label
var _prompt: RichTextLabel
var _sub_box: PanelContainer
var _sub_name: Label
var _sub_text: Label
var _queue: Array = []
var _speaking := false
var _prompt_left := 0.0
var root: Control
var _loading: Label

func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = Style.theme()
	add_child(root)

	# Objective, top left.
	_obj_box = PanelContainer.new()
	_obj_box.add_theme_stylebox_override("panel", Style.panel())
	_obj_box.position = Vector2(36, 32)
	var ov := VBoxContainer.new()
	ov.add_theme_constant_override("separation", 2)
	ov.add_child(Style.label("OBJECTIVE", 14, Style.EMBER, Style.mono_bold))
	_obj_text = Style.label("", 24, Style.BONE, Style.sans_bold)
	ov.add_child(_obj_text)
	_obj_extra = Style.label("", 16, Style.MUTE, Style.mono)
	ov.add_child(_obj_extra)
	_obj_box.add_child(ov)
	_obj_box.modulate.a = 0.0
	root.add_child(_obj_box)

	# Subtitles, low centre.
	_sub_box = PanelContainer.new()
	_sub_box.add_theme_stylebox_override("panel", Style.panel(12))
	_sub_box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_sub_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_sub_box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_sub_box.offset_bottom = -150
	_sub_box.custom_minimum_size = Vector2(760, 0)
	var sv := VBoxContainer.new()
	_sub_name = Style.label("", 15, Style.EMBER, Style.mono_bold)
	_sub_text = Style.label("", 26, Style.BONE)
	_sub_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_sub_text.custom_minimum_size = Vector2(720, 0)
	sv.add_child(_sub_name)
	sv.add_child(_sub_text)
	_sub_box.add_child(sv)
	_sub_box.modulate.a = 0.0
	root.add_child(_sub_box)

	# Key prompts, bottom centre.
	_prompt = RichTextLabel.new()
	_prompt.bbcode_enabled = true
	_prompt.fit_content = true
	_prompt.scroll_active = false
	_prompt.autowrap_mode = TextServer.AUTOWRAP_OFF
	_prompt.add_theme_font_override("normal_font", Style.sans)
	_prompt.add_theme_font_override("mono_font", Style.mono_bold)
	_prompt.add_theme_font_size_override("normal_font_size", 22)
	_prompt.add_theme_font_size_override("mono_font_size", 18)
	_prompt.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_prompt.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_prompt.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_prompt.offset_bottom = -60
	_prompt.custom_minimum_size = Vector2(900, 0)
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_prompt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_prompt.modulate.a = 0.0
	root.add_child(_prompt)

	# Chapter cards, centre.
	_card = VBoxContainer.new()
	_card.set_anchors_preset(Control.PRESET_CENTER)
	_card.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_card.grow_vertical = Control.GROW_DIRECTION_BOTH
	_card.alignment = BoxContainer.ALIGNMENT_CENTER
	_card_title = Style.label("", 76, Style.BONE, Style.sans_bold)
	_card_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_card_sub = Style.label("", 20, Style.EMBER, Style.mono)
	_card_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_card.add_child(_card_title)
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

func _process(dt: float) -> void:
	if _prompt_left > 0.0:
		_prompt_left -= dt
		if _prompt_left <= 0.0:
			_tween(_prompt, 0.0, 0.4)

## Keys in [brackets] become keycaps: "[W] thrust  [Mouse] steer".
func prompt(text: String, seconds := 0.0) -> void:
	var re := RegEx.create_from_string("\\[([^\\]]+)\\]")
	var bb := re.sub(text, "[bgcolor=#f4e8cf26][code] $1 [/code][/bgcolor]", true)
	_prompt.text = "[center]" + bb + "[/center]"
	_prompt_left = seconds
	_tween(_prompt, 1.0, 0.35)

func clear_prompt() -> void:
	_prompt_left = 0.0
	_tween(_prompt, 0.0, 0.3)

func objective(text: String, extra := "") -> void:
	var changed := text != _obj_text.text
	_obj_text.text = text
	_obj_extra.text = extra
	_obj_extra.visible = extra != ""
	if changed:
		Sfx.play("objective", -8.0)
		_obj_box.modulate.a = 0.0
		_obj_box.position.x = 16
		var t := create_tween().set_parallel()
		t.tween_property(_obj_box, "modulate:a", 1.0, 0.5)
		t.tween_property(_obj_box, "position:x", 36.0, 0.5).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)

func objective_extra(extra: String) -> void:
	_obj_extra.text = extra
	_obj_extra.visible = extra != ""

func clear_objective() -> void:
	_obj_text.text = ""
	_tween(_obj_box, 0.0, 0.4)

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
		_sub_name.text = String(q.who).to_upper()
		_sub_name.add_theme_color_override("font_color", SPEAKERS.get(q.who, Style.MUTE))
		_sub_text.text = q.line
		_sub_text.visible_ratio = 0.0
		Sfx.play("comm", -14.0)
		_tween(_sub_box, 1.0, 0.25)
		create_tween().tween_property(_sub_text, "visible_ratio", 1.0, minf(1.2, q.line.length() * 0.02))
		await get_tree().create_timer(q.secs, true, false, true).timeout
		if _queue.is_empty():
			_tween(_sub_box, 0.0, 0.35)
		q.done = true
		line_done.emit()
	_speaking = false

func silence() -> void:
	for q in _queue:
		q.done = true
	_queue.clear()
	line_done.emit()
	_tween(_sub_box, 0.0, 0.2)

func card(title: String, sub := "", seconds := 3.5) -> void:
	_card_title.text = title
	_card_sub.text = sub
	_card.scale = Vector2.ONE
	var t := create_tween()
	t.tween_property(_card, "modulate:a", 1.0, 0.9)
	t.tween_interval(seconds)
	t.tween_property(_card, "modulate:a", 0.0, 1.2)
	await t.finished

func fade_out(seconds := 0.8) -> void:
	_fade.mouse_filter = Control.MOUSE_FILTER_STOP
	await _tween(_fade, 1.0, seconds).finished

func fade_in(seconds := 1.2) -> void:
	await _tween(_fade, 0.0, seconds).finished
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE

var _bars: Array[ColorRect] = []

## Widescreen bars for cutscenes.
func letterbox(on: bool) -> void:
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

## The note in the corner while a scene loads behind the fade.
func loading(on: bool) -> void:
	_loading.visible = on

## Everything off, for a scene change.
func reset() -> void:
	for q in _queue:
		q.done = true
	_queue.clear()
	line_done.emit()
	_speaking = false
	for c in [_obj_box, _sub_box, _prompt, _card]:
		c.modulate.a = 0.0
	_obj_text.text = ""

func _tween(node: CanvasItem, alpha: float, seconds: float) -> Tween:
	var t := create_tween()
	t.tween_property(node, "modulate:a", alpha, seconds)
	return t
