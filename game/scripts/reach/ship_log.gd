class_name ShipLog
extends CanvasLayer
## The Kestrel's log (L): every place you know of as a card, what you have
## learned there, and threads from each rumour to the place it points at.
## Places only rumoured show as a question. Click a card to read it.

signal closed

var _canvas: Control
var _detail: VBoxContainer
var _selected := "hearth"
var _t := 0.0

static func open(parent: Node) -> ShipLog:
	var s := ShipLog.new()
	parent.add_child(s)
	return s

var _tints := {}
var _pics := {}
var _stars := PackedVector3Array()
const CARD := Vector2(252, 196)

func _ready() -> void:
	for b: ReachBody in ReachSystem.define():
		_tints[b.key] = b.tint
	for place in Lore.PLACES:
		var path := "res://art/log/%s.jpg" % place
		if ResourceLoader.exists(path):
			_pics[place] = load(path)
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	for i in 160:
		_stars.append(Vector3(rng.randf(), rng.randf(), rng.randf()))
	layer = 14
	process_mode = Node.PROCESS_MODE_ALWAYS
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = ReachStyle.theme()
	add_child(root)
	var bg := ColorRect.new()
	bg.color = Color(0.045, 0.04, 0.045, 0.97)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(bg)
	var title := ReachStyle.title("Ship Log", 34, ReachStyle.BONE)
	title.position = Vector2(48, 20)
	root.add_child(title)
	var sub := ReachStyle.label("THE KESTREL  ·  RUMOURS AND WHAT YOU FOUND", 12, ReachStyle.EMBER, true)
	sub.position = Vector2(50, 66)
	root.add_child(sub)
	var hint := ReachStyle.label("Loop %d    Click a place to read it    L or Esc to close" % int(Flow.progress("reach_loops", 1)), 13, ReachStyle.MUTE, true)
	hint.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	hint.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	hint.offset_right = -48
	hint.offset_top = 34
	root.add_child(hint)
	_canvas = Control.new()
	_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	_canvas.offset_right = -420
	_canvas.offset_top = 70
	_canvas.draw.connect(_paint)
	_canvas.gui_input.connect(_click)
	root.add_child(_canvas)
	var side := PanelContainer.new()
	side.add_theme_stylebox_override("panel", ReachStyle.panel(10))
	side.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	side.offset_left = -400
	side.offset_right = -32
	side.offset_top = 80
	side.offset_bottom = -40
	root.add_child(side)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	side.add_child(scroll)
	_detail = VBoxContainer.new()
	_detail.add_theme_constant_override("separation", 14)
	_detail.custom_minimum_size = Vector2(320, 0)
	scroll.add_child(_detail)
	_show(_selected)
	get_tree().paused = true

func _process(dt: float) -> void:
	_t += dt
	_canvas.queue_redraw()

func _visible(place: String) -> bool:
	return Lore.place_known(place) or Lore.place_rumoured(place)

func _card_pos(place: String) -> Vector2:
	var size := _canvas.size
	var p: Vector2 = Lore.PLACES[place].pos
	return size / 2.0 + Vector2(p.x * size.x * 0.34, p.y * size.y * 0.62)

func _paint() -> void:
	# A night behind the cards: faint stars.
	var sz := _canvas.size
	for st in _stars:
		_canvas.draw_circle(Vector2(st.x * sz.x, st.y * sz.y), 0.6 + st.z, Color(ReachStyle.BONE, 0.05 + st.z * 0.12))
	# Threads: rumour facts from where they were learned to where they lead.
	for id in Lore.FACTS:
		if not Lore.known(id):
			continue
		var f: Array = Lore.FACTS[id]
		var to: String = f[2]
		if to == "" or to == f[0]:
			continue
		var a := _card_pos(f[0])
		var b := _card_pos(to)
		var pulse := 0.55 + 0.45 * sin(_t * 2.0 + a.x * 0.01)
		_ink(a, b, Color(ReachStyle.EMBER, 0.35 + 0.35 * pulse))
	for place in Lore.PLACES:
		if not _visible(place):
			continue
		var c := _card_pos(place)
		var known := Lore.place_known(place)
		var r := Rect2(c - CARD / 2.0, CARD)
		var sel: bool = place == _selected
		# The card: a picture of the place (dark, behind a question, while
		# only rumoured), its name, how much is known.
		_canvas.draw_rect(r.grow(3.0 if sel else 1.0), Color(ReachStyle.EMBER, 0.85) if sel else Color(0.0, 0.0, 0.0, 0.35))
		_canvas.draw_rect(r, Color(0.13, 0.115, 0.1, 0.98))
		var pic := Rect2(r.position + Vector2(6, 6), Vector2(CARD.x - 12, 134))
		if _pics.has(place):
			_canvas.draw_texture_rect(_pics[place], pic, false, Color(1, 1, 1, 1) if known else Color(0.16, 0.15, 0.17, 1))
		else:
			_canvas.draw_rect(pic, Color(0.06, 0.06, 0.07))
		if not known:
			var q := ReachStyle.serif_bold.get_string_size("?", HORIZONTAL_ALIGNMENT_LEFT, -1, 72)
			_canvas.draw_string(ReachStyle.serif_bold, pic.get_center() + Vector2(-q.x / 2.0, 24), "?", HORIZONTAL_ALIGNMENT_LEFT, -1, 72, Color(ReachStyle.BONE, 0.6))
		var tint: Color = _tints.get(Lore.PLACES[place].body, ReachStyle.BONE)
		_canvas.draw_circle(r.position + Vector2(18, 164), 6.0, tint if known else Color(tint, 0.35))
		var name: String = Lore.PLACES[place].title
		_canvas.draw_string(ReachStyle.serif_bold, r.position + Vector2(32, 170), name, HORIZONTAL_ALIGNMENT_LEFT, CARD.x - 40, 18, ReachStyle.BONE if known else ReachStyle.MUTE)
		var n := 0
		for id in Lore.FACTS:
			if Lore.known(id) and Lore.FACTS[id][0] == place:
				n += 1
		_canvas.draw_string(Style.mono, r.position + Vector2(32, 187), ("%d %s" % [n, "entry" if n == 1 else "entries"]) if known else "rumoured", HORIZONTAL_ALIGNMENT_LEFT, CARD.x - 40, 11, ReachStyle.MUTE)

## A line drawn like ink: slightly wavering, with a soft glow under it.
func _ink(a: Vector2, b: Vector2, c: Color) -> void:
	var pts := PackedVector2Array()
	var n := 24
	var side := (b - a).orthogonal().normalized()
	for i in n + 1:
		var t := float(i) / n
		var wobble := sin(t * 11.0 + a.x * 0.02) * 2.2 + sin(t * 23.0 + b.y * 0.03) * 1.1
		pts.append(a.lerp(b, t) + side * (wobble + sin(t * PI) * 26.0))
	_canvas.draw_polyline(pts, Color(c, c.a * 0.25), 7.0, true)
	_canvas.draw_polyline(pts, c, 2.0, true)

func _click(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		for place in Lore.PLACES:
			if _visible(place) and Rect2(_card_pos(place) - CARD / 2.0, CARD).has_point(e.position):
				_selected = place
				_show(place)
				Sfx.play("click", -10.0)

func _show(place: String) -> void:
	for c in _detail.get_children():
		c.queue_free()
	var known := Lore.place_known(place)
	if not known and not Lore.place_rumoured(place):
		# Nothing written yet.
		_detail.add_child(ReachStyle.title("Nothing yet", 26, ReachStyle.EMBER))
		_entry("The log fills as you go: what people tell you, what the Founders left recorded, what you see for yourself. Rumours point the way to places you have not been.", false)
		return
	_detail.add_child(ReachStyle.title(Lore.PLACES[place].title, 26, ReachStyle.EMBER if known else ReachStyle.MUTE))
	if not known:
		for id in Lore.FACTS:
			if Lore.known(id) and Lore.FACTS[id][2] == place:
				_entry(Lore.FACTS[id][1], true)
		return
	for id in Lore.FACTS:
		if Lore.known(id) and Lore.FACTS[id][0] == place:
			_entry(Lore.FACTS[id][1], Lore.FACTS[id][2] != "")

func _entry(text: String, rumour: bool) -> void:
	var l := ReachStyle.label(("Rumour:  " if rumour else "") + text, 16, ReachStyle.BONE if not rumour else Color(ReachStyle.EMBER, 0.95))
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(320, 0)
	_detail.add_child(l)

func _input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo and e.keycode in [KEY_L, KEY_ESCAPE]:
		get_viewport().set_input_as_handled()
		get_tree().paused = false
		closed.emit()
		queue_free()
