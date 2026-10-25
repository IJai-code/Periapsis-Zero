class_name ReachEnding
extends CanvasLayer
## The end: the Engine has the core. Every part of the song plays at once,
## the one time it is heard whole (banjo, flute, harmonica, drums, the
## Choir), the light fills with the Engine's blue, and what happened is
## told a line at a time. Any key or a click, after the last line, goes back
## to the title.

## What is told depends on who you brought home that last morning (Crew).
static func lines(home: Array) -> Array:
	var out := [
		"The Engine took the core, and sang.",
		"For the first time in three days, the morning did not come back.",
		"The Lantern fell at twenty-two minutes, as it always had. This time the Fold was open.",
	]
	var all := home.has("hale") and home.has("renn") and home.has("sato")
	if all:
		out.append("Hearth's barges went through first, Mara at the head of them, Hale beside her. Renn flew the pod. Sato called the course.")
		out.append("Pip rode with you, talking the whole way. Every one of the Aster's crew who lived through the Fold, lived through this.")
	else:
		var said := []
		if home.has("hale"):
			said.append("Hale rode the first barge, beside Mara.")
		if home.has("renn"):
			said.append("Renn flew the pod, and did not look back.")
		if home.has("sato"):
			said.append("Sato called the course.")
		if said.is_empty():
			said.append("Hearth's barges went through first, Mara at the head of them.")
		out.append(" ".join(said))
		var left := []
		for id in ["hale", "renn", "sato"]:
			if not home.has(id):
				left.append(Crew.ROSTER[id].name)
		out.append("Pip rode with you. But %s did not come home that morning." % " and ".join(left))
	out.append("You were the last one through, and the only one who remembered why.")
	return out

var _players: Array[AudioStreamPlayer] = []
var _veil: ColorRect
var _line: Label
var _title: Label
var _sub: Label
var _done := false

func _ready() -> void:
	layer = 30
	process_mode = Node.PROCESS_MODE_ALWAYS
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(root)
	_veil = ColorRect.new()
	_veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	_veil.color = Color(0.75, 0.88, 1.0, 0.0)
	root.add_child(_veil)
	_line = ReachStyle.label("", 28, ReachStyle.BONE)
	_line.add_theme_font_override("font", ReachStyle.serif_italic)
	_line.set_anchors_preset(Control.PRESET_CENTER)
	_line.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_line.grow_vertical = Control.GROW_DIRECTION_BOTH
	_line.custom_minimum_size = Vector2(900, 0)
	_line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_line.modulate.a = 0.0
	root.add_child(_line)
	_title = ReachStyle.title("Periapsis Zero", 64, ReachStyle.EMBER)
	_title.set_anchors_preset(Control.PRESET_CENTER)
	_title.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.position.y -= 40
	_title.modulate.a = 0.0
	root.add_child(_title)
	_sub = ReachStyle.label("The Reach\n\nThank you for playing.", 18, ReachStyle.MUTE, true)
	_sub.set_anchors_preset(Control.PRESET_CENTER)
	_sub.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sub.position.y += 30
	_sub.modulate.a = 0.0
	root.add_child(_sub)
	for part in ["banjo", "flute", "harmonica", "drums", "choir"]:
		var p := AudioStreamPlayer.new()
		p.stream = load("res://audio/reach/%s.wav" % part)
		p.volume_db = -5.0 + Flow.music_db()
		add_child(p)
		_players.append(p)
	_run()

func _run() -> void:
	for p in _players:
		p.play(0.0)
	var t := create_tween()
	t.tween_property(_veil, "color", Color(0.75, 0.88, 1.0, 1.0), 5.0).set_trans(Tween.TRANS_SINE)
	t.tween_property(_veil, "color", Color(0.07, 0.06, 0.05, 1.0), 3.0)
	await t.finished
	var auto := "--talkauto" in OS.get_cmdline_user_args()
	var r := get_tree().get_first_node_in_group("reach_root")
	for text in lines(r.crew.home() if r and r.crew else []):
		_line.text = text
		Report.line("ENDING " + text.substr(0, 48))
		var a := create_tween()
		a.tween_property(_line, "modulate:a", 1.0, 1.2)
		a.tween_interval(0.1 if auto else 3.6)
		a.tween_property(_line, "modulate:a", 0.0, 1.0)
		await a.finished
	var b := create_tween()
	b.tween_property(_title, "modulate:a", 1.0, 2.0)
	b.parallel().tween_property(_sub, "modulate:a", 1.0, 3.0)
	await b.finished
	_done = true
	Report.line("ENDING done")

func _input(e: InputEvent) -> void:
	if not _done:
		return
	if (e is InputEventKey and e.pressed and not e.echo) or (e is InputEventMouseButton and e.pressed):
		get_viewport().set_input_as_handled()
		_done = false
		for p in _players:
			p.stop()
		Flow.go("title")
