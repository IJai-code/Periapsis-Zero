class_name Talk
extends CanvasLayer
## A conversation (Lore.TALK): lines one at a time at the foot of the
## screen, a choice where there is one (click, or 1 to 3). E, Space or a
## click moves it on. Facts learned along the way go into the ship's log.

signal finished

## Who has been talked to this loop (cleared on waking).
static var this_loop := {}

var who := ""
var person: Person
var hud: ReachHud
var _box: PanelContainer
var _name: Label
var _text: RichTextLabel
var _choices: VBoxContainer
var _waiting := false
var _shown := 0.0
var _full := 0

static func open(parent: Node, key: String, p: Person, h: ReachHud) -> Talk:
	var t := Talk.new()
	t.who = key
	t.person = p
	t.hud = h
	parent.add_child(t)
	return t

func _ready() -> void:
	layer = 12
	process_mode = Node.PROCESS_MODE_ALWAYS
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = ReachStyle.theme()
	add_child(root)
	_box = PanelContainer.new()
	_box.add_theme_stylebox_override("panel", ReachStyle.panel(10))
	_box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_box.offset_bottom = -40
	_box.custom_minimum_size = Vector2(760, 0)
	root.add_child(_box)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	_box.add_child(v)
	_name = ReachStyle.label("", 15, ReachStyle.EMBER, true)
	v.add_child(_name)
	_text = RichTextLabel.new()
	_text.fit_content = true
	_text.bbcode_enabled = false
	_text.custom_minimum_size = Vector2(716, 0)
	_text.add_theme_font_size_override("normal_font_size", 20)
	_text.add_theme_color_override("default_color", ReachStyle.BONE)
	_text.add_theme_font_override("normal_font", Style.sans)
	v.add_child(_text)
	_choices = VBoxContainer.new()
	_choices.add_theme_constant_override("separation", 6)
	v.add_child(_choices)
	if person:
		person.talk(true)
	_run.call_deferred()

func _run() -> void:
	var tree: Dictionary = Lore.TALK[who]
	var node: String = "start"
	var start: Dictionary = tree["start"]
	for f in start.get("first", []):
		var cond: String = f[0]
		var ok := (cond.begins_with("@") and this_loop.has(cond.trim_prefix("@"))) or (not cond.begins_with("@") and Lore.known(cond))
		if ok:
			node = f[1]
			break
	this_loop[who] = true
	while node != "":
		var n: Dictionary = tree[node]
		for line in n.get("lines", []):
			await _say(line[0], line[1])
		var new := false
		for f in n.get("learn", []):
			if Lore.learn(f):
				new = true
		if new and hud:
			hud.toast("SHIP LOG UPDATED")
			Sfx.play("objective", -10.0, 1.2)
		if n.get("end", false) or not n.has("choices"):
			break
		node = await _choose(n["choices"])
	_close()

func _say(speaker: String, text: String) -> void:
	_name.text = speaker.to_upper()
	_text.text = text
	_text.visible_characters = 0
	_full = text.length()
	_shown = 0.0
	_waiting = true
	Sfx.play("comm", -16.0, 1.1)
	if "--talkauto" in OS.get_cmdline_user_args():
		Report.line("TALK %s: %s" % [speaker, text.substr(0, 60)])
		await get_tree().process_frame
		_waiting = false
	while _waiting:
		await get_tree().process_frame

func _process(dt: float) -> void:
	if _text.visible_characters >= 0 and _text.visible_characters < _full:
		_shown += dt * 55.0
		_text.visible_characters = int(_shown)

func _input(e: InputEvent) -> void:
	var go := false
	if e is InputEventKey and e.pressed and not e.echo and (e.keycode in [KEY_E, KEY_SPACE, KEY_ENTER]):
		go = true
	elif e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT and _choices.get_child_count() == 0:
		go = true
	if go and _waiting:
		get_viewport().set_input_as_handled()
		if _text.visible_characters < _full:
			_text.visible_characters = _full
			_shown = _full
		else:
			_waiting = false
	if e is InputEventKey and e.pressed and not e.echo and _choices.get_child_count() > 0:
		var k: int = e.keycode - KEY_1
		if k >= 0 and k < _choices.get_child_count():
			get_viewport().set_input_as_handled()
			(_choices.get_child(k) as Button).pressed.emit()

func _choose(choices: Array) -> String:
	# null until chosen ("" is a choice that ends the talk).
	var picked := {"node": null}
	var shown := 0
	for c in choices:
		var need: String = c[2]
		var hide: String = c[3]
		if need != "" and not Lore.known(need):
			continue
		if hide != "" and Lore.known(hide):
			continue
		shown += 1
		var b := Button.new()
		b.text = "%d   %s" % [shown, c[0]]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.add_theme_font_size_override("font_size", 17)
		var target: String = c[1]
		b.pressed.connect(func(): picked.node = target)
		_choices.add_child(b)
	if shown == 0:
		return ""
	(_choices.get_child(0) as Button).grab_focus()
	if "--talkauto" in OS.get_cmdline_user_args():
		(_choices.get_child(0) as Button).pressed.emit()
	while picked.node == null:
		await get_tree().process_frame
	for b in _choices.get_children():
		b.queue_free()
	await get_tree().process_frame
	return str(picked.node)

func _close() -> void:
	if person:
		person.talk(false)
	finished.emit()
	queue_free()
