class_name Translator
extends CanvasLayer
## Okafor's player, playing a founders' recording (Lore.SONGLINES): each
## track's waveform on a strip, the answers hanging below the track they
## answer like a branching reel. The track being played fills in from its
## start while its words come up out of the static. Played tracks stay lit.
##
## E, Space or a click goes on to the next track; Z and C (or the arrows)
## pick one; a click on a track plays that one. Esc or Q puts it away.
## Time does not stop while you read.

signal finished

const GLYPHS := ".:-~·"

var id := ""
var hud: ReachHud
var _verses: Array = []
var _layout: Array = []   # per verse: {c: Vector2, r: float, a0: float, sense: float, end: Vector2}
var _sel := 0
var _reveal := 0.0        # 0..1 along the selected verse
var _t := 0.0
var _canvas: Control
var _name: Label
var _text: Label
var _hint: Label
var _auto := false

static func open(parent: Node, id_: String, h: ReachHud) -> Translator:
	var t := Translator.new()
	t.id = id_
	t.hud = h
	parent.add_child(t)
	return t

func _ready() -> void:
	layer = 12
	process_mode = Node.PROCESS_MODE_ALWAYS
	_auto = "--talkauto" in OS.get_cmdline_user_args()
	_verses = Lore.SONGLINES[id].verses
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = ReachStyle.theme()
	add_child(root)
	var bg := ColorRect.new()
	bg.color = Color(0.03, 0.04, 0.06, 0.82)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(bg)
	_canvas = Control.new()
	_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	_canvas.offset_right = -460
	_canvas.draw.connect(_paint)
	_canvas.gui_input.connect(_click)
	root.add_child(_canvas)
	var title := ReachStyle.title(String(Lore.SONGLINES[id].title), 26, Color(0.62, 0.86, 1.0))
	title.position = Vector2(48, 34)
	root.add_child(title)
	var side := PanelContainer.new()
	side.add_theme_stylebox_override("panel", ReachStyle.panel(10))
	side.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	side.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	side.grow_vertical = Control.GROW_DIRECTION_BOTH
	side.offset_right = -40
	side.custom_minimum_size = Vector2(400, 0)
	root.add_child(side)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	side.add_child(v)
	_name = ReachStyle.title("", 22, Color(0.62, 0.86, 1.0))
	v.add_child(_name)
	_text = ReachStyle.label("", 21, ReachStyle.BONE)
	_text.add_theme_font_override("font", ReachStyle.serif_italic)
	_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_text.custom_minimum_size = Vector2(360, 120)
	v.add_child(_text)
	_hint = ReachStyle.label("E  next track      Z / C  choose      Esc  put away", 12, ReachStyle.MUTE, true)
	v.add_child(_hint)
	await get_tree().process_frame
	_lay_out()
	# Start at the first verse not yet read.
	_sel = 0
	for n in _verses.size():
		if not Lore.read(id, n):
			_sel = n
			break
	_select(_sel)
	Sfx.play("ping", -12.0, 0.8)

## Each verse a track, its waveform drawn along a strip; answers hang
## below the verse they answer, indented, like a branching reel.
func _lay_out() -> void:
	_layout.resize(_verses.size())
	var kids := {}
	for n in _verses.size():
		var p: int = _verses[n][2]
		if not kids.has(p):
			kids[p] = []
		kids[p].append(n)
	var row := [0]
	_place(0, 0, kids, row)
	# Fit the reel to the space left of the panel, centred.
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for L: Dictionary in _layout:
		var c: Vector2 = L.c
		var r: float = L.r
		lo = lo.min(c - Vector2(r, 30.0))
		hi = hi.max(c + Vector2(r, 30.0))
	var room := _canvas.size * Vector2(0.86, 0.8)
	var fit := minf(1.3, minf(room.x / maxf(hi.x - lo.x, 1.0), room.y / maxf(hi.y - lo.y, 1.0)))
	var mid := (lo + hi) / 2.0
	for L: Dictionary in _layout:
		L.c = ((L.c as Vector2) - mid) * fit
		L.end = ((L.end as Vector2) - mid) * fit
		L.r = (L.r as float) * fit

func _place(n: int, depth: int, kids: Dictionary, row: Array) -> void:
	var r := 190.0
	var c := Vector2(depth * 70.0 + r, row[0] * 78.0)
	row[0] += 1
	# `end` is where the track starts playing: the left of its strip.
	_layout[n] = {"c": c, "r": r, "end": c - Vector2(r, 0)}
	for child: int in kids.get(n, []):
		_place(child, depth + 1, kids, row)

## The waveform of verse n, from its start, `frac` of the way along.
func _points(n: int, frac := 1.0) -> PackedVector2Array:
	var L: Dictionary = _layout[n]
	var pts := PackedVector2Array()
	var steps := 120
	var c: Vector2 = L.c
	var r: float = L.r
	for i in int(steps * clampf(frac, 0.0, 1.0)) + 1:
		var t := float(i) / steps
		var env := sin(t * PI) * (0.55 + 0.45 * sin(t * 9.0 + n * 1.7))
		var y := (sin(i * 2.3 + n) * 0.6 + sin(i * 0.71 + n * 3.0) * 0.4) * 17.0 * env
		pts.append(c + Vector2(-r + 2.0 * r * t, y))
	return pts

func _origin() -> Vector2:
	return _canvas.size / 2.0

func _paint() -> void:
	if _layout.is_empty():
		return
	var o := _origin()
	for n in _verses.size():
		var L: Dictionary = _layout[n]
		var p: int = _verses[n][2]
		var read := Lore.read(id, n)
		var lit := Color(0.85, 0.93, 1.0) if read else Color(0.45, 0.62, 0.8, 0.35)
		if p >= 0:
			var a: Vector2 = o + (_layout[p] as Dictionary).end + Vector2(12, 0)
			var b: Vector2 = o + L.end
			var knee := Vector2(a.x, b.y)
			_canvas.draw_polyline(PackedVector2Array([a, knee, b]), Color(lit, lit.a * 0.6), 2.0, true)
		# The strip it plays along.
		_canvas.draw_line(o + L.c - Vector2(L.r, 0), o + L.c + Vector2(L.r, 0), Color(lit, lit.a * 0.25), 1.0, true)
		var all := _points(n)
		for i in all.size():
			all[i] += o
		if n == _sel:
			var pulse := 0.6 + 0.4 * sin(_t * 4.0)
			_canvas.draw_polyline(all, Color(0.45, 0.75, 1.0, 0.25), 3.0, true)
			var part := _points(n, _reveal)
			for i in part.size():
				part[i] += o
			if part.size() > 1:
				_canvas.draw_polyline(part, Color(0.5, 0.85, 1.0, 0.22 * pulse), 12.0, true)
				_canvas.draw_polyline(part, Color(0.75, 0.92, 1.0), 3.2, true)
		else:
			if read:
				_canvas.draw_polyline(all, Color(0.6, 0.85, 1.0, 0.12), 9.0, true)
			_canvas.draw_polyline(all, lit, 2.4, true)
		_canvas.draw_circle(o + L.end, 4.0, lit if n != _sel else Color(0.75, 0.92, 1.0))

func _process(dt: float) -> void:
	_t += dt
	if _layout.is_empty():
		return
	if _reveal < 1.0:
		_reveal = minf(1.0, _reveal + dt / maxf(0.9, String(_verses[_sel][1]).length() / 70.0))
		if _auto:
			_reveal = 1.0
		_words()
		if _reveal >= 1.0:
			_finish_verse()
	elif _auto:
		var next := _next_unread()
		if next < 0:
			_close()
			return
		_select(next)
	_canvas.queue_redraw()

## The words resolve out of glyphs as the strand lights.
func _words() -> void:
	var full: String = _verses[_sel][1]
	var shown := int(full.length() * _reveal)
	var out := full.substr(0, shown)
	var rng := RandomNumberGenerator.new()
	rng.seed = int(_t * 20.0)
	for i in mini(12, full.length() - shown):
		var ch := full[shown + i]
		out += " " if ch == " " else GLYPHS[rng.randi() % GLYPHS.length()]
	_text.text = out

func _finish_verse() -> void:
	_text.text = _verses[_sel][1]
	if Lore.read(id, _sel):
		return
	Lore.mark_read(id, _sel)
	var fact: String = _verses[_sel][3]
	if fact != "" and Lore.learn(fact) and hud:
		hud.toast("SHIP LOG UPDATED")
		Sfx.play("objective", -10.0, 1.2)
	if _next_unread() < 0:
		_hint.text = "All played.      Z / C  play again      Esc  put away"
	Report.line("TRANSLATE %s verse %d" % [id, _sel])

func _next_unread() -> int:
	for k in _verses.size():
		var n := (_sel + 1 + k) % _verses.size()
		if not Lore.read(id, n):
			return n
	return -1

func _select(n: int) -> void:
	_sel = n
	_reveal = 1.0 if Lore.read(id, n) else 0.0
	_name.text = String(_verses[n][0])
	if _reveal >= 1.0:
		_text.text = _verses[n][1]
	else:
		_words()
		Sfx.play("beep", -18.0, 1.4)

func _click(e: InputEvent) -> void:
	if _layout.is_empty():
		return
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		var o := _origin()
		var best := -1
		var best_d := 1e9
		for n in _verses.size():
			var L: Dictionary = _layout[n]
			var c: Vector2 = L.c
			var r: float = L.r
			# Distance to the strip (a track is long and thin).
			var q := (e as InputEventMouseButton).position - (o + c)
			var d := Vector2(maxf(absf(q.x) - r, 0.0), q.y).length()
			if d < best_d:
				best_d = d
				best = n
		if best >= 0 and best_d < 60.0:
			_select(best)
		else:
			_advance()

func _advance() -> void:
	if _reveal < 1.0:
		_reveal = 1.0
		_words()
		_finish_verse()
		return
	var next := _next_unread()
	if next >= 0:
		_select(next)
	else:
		_close()

func _input(e: InputEvent) -> void:
	if _layout.is_empty() or not (e is InputEventKey and e.pressed and not e.echo):
		return
	var k := (e as InputEventKey).keycode
	if k in [KEY_E, KEY_SPACE, KEY_ENTER]:
		_advance()
	elif k in [KEY_C, KEY_RIGHT, KEY_DOWN]:
		_select((_sel + 1) % _verses.size())
	elif k in [KEY_Z, KEY_LEFT, KEY_UP]:
		_select((_sel + _verses.size() - 1) % _verses.size())
	elif k in [KEY_ESCAPE, KEY_Q]:
		_close()
	else:
		return
	get_viewport().set_input_as_handled()

func _close() -> void:
	Sfx.play("click", -12.0, 0.6)
	finished.emit()
	queue_free()
