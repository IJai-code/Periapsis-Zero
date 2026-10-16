class_name JobBoard
extends CanvasLayer
## Lowdeck's job board, from the street terminal or the cockpit (J): four
## jobs, each with who is paying and how much; take one, or drop the one in
## hand. The game waits while it is open.

signal taken(job: Dictionary)
signal closed

var _list: VBoxContainer

static func open(parent: Node) -> JobBoard:
	var b := JobBoard.new()
	parent.add_child(b)
	return b

func _ready() -> void:
	layer = 20
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().paused = true
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = Style.theme()
	add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(Style.VOID, 0.72)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(dim)
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", Style.panel(14))
	p.set_anchors_preset(Control.PRESET_CENTER)
	p.grow_horizontal = Control.GROW_DIRECTION_BOTH
	p.grow_vertical = Control.GROW_DIRECTION_BOTH
	p.custom_minimum_size = Vector2(760, 0)
	root.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	p.add_child(v)
	v.add_child(Style.label("LOWDECK  ·  JOB BOARD", 14, Style.EMBER, Style.mono_bold))
	v.add_child(Style.label("Work for anyone who pays. Fly it from the Kestrel's berth.", 18, Style.MUTE))
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 10)
	v.add_child(_list)
	var held := Act2.active()
	if not held.is_empty():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		row.add_child(Style.label("In hand: " + str(held.get("title", "")), 18, Style.ION, Style.sans_bold))
		var drop := Button.new()
		drop.text = "Drop it"
		drop.pressed.connect(func():
			Act2.clear()
			_close())
		row.add_child(drop)
		v.add_child(row)
	for job in Act2.board():
		_row(job, held)
	var close := Button.new()
	close.text = "Close"
	close.pressed.connect(_close)
	v.add_child(close)
	close.grab_focus()

func _row(job: Dictionary, held: Dictionary) -> void:
	var box := PanelContainer.new()
	box.add_theme_stylebox_override("panel", Style.panel(8))
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	box.add_child(v)
	var head := HBoxContainer.new()
	head.add_child(Style.label(str(job.title), 20, Style.BONE, Style.sans_bold))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(spacer)
	head.add_child(Style.label("₡ %s" % Hud._thousands(int(job.pay)), 18, Style.EMBER, Style.mono_bold))
	v.add_child(head)
	v.add_child(Style.label(str(job.giver).to_upper(), 11, Style.MUTE, Style.mono))
	var text := Style.label(str(job.text), 15, Style.MUTE)
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	text.custom_minimum_size = Vector2(700, 0)
	v.add_child(text)
	var take := Button.new()
	take.text = "Take this job" if held.is_empty() else "Take this one instead"
	take.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	take.pressed.connect(func():
		Act2.take(job)
		taken.emit(job)
		_close())
	v.add_child(take)
	_list.add_child(box)

func _unhandled_input(e: InputEvent) -> void:
	if e.is_action_pressed("pause"):
		get_viewport().set_input_as_handled()
		_close()

func _close() -> void:
	get_tree().paused = false
	closed.emit()
	queue_free()
