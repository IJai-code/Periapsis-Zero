class_name Memories
extends Node
## What the loop looked like, kept for its end: a small picture of the view
## every so often (and on arriving somewhere, after a conversation, after
## reading), and every photograph. When the loop ends, `play` runs them
## backwards down a tunnel toward a point of light, faster and faster, as
## the Reach forgets everything but you.

const EVERY := 40.0
const KEEP := 28

var reach: Node
var shots: Array[Texture2D] = []
var _t := 0.0
var _was_talking := false
var _pending := -1.0
var _busy := false

func _process(dt: float) -> void:
	if not reach or not reach.player or reach.loop.ending or reach.finished:
		return
	_t += dt
	var talking: bool = reach.talking
	if _was_talking and not talking:
		later(0.4)
	_was_talking = talking
	if _pending >= 0.0:
		_pending -= dt
		if _pending < 0.0:
			capture()
	if _t >= EVERY and (reach.player as Explorer).enabled:
		_t = 0.0
		capture()

## A picture in a moment (once the view has settled).
func later(seconds: float) -> void:
	_pending = seconds

## The view as it is now, small.
func capture() -> void:
	if _busy:
		return
	_busy = true
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	_busy = false
	if not img or img.get_width() < 16:
		return
	img.resize(320, maxi(1, int(320.0 * img.get_height() / img.get_width())), Image.INTERPOLATE_BILINEAR)
	add(ImageTexture.create_from_image(img))

func add(tex: Texture2D) -> void:
	shots.append(tex)
	while shots.size() > KEEP:
		shots.pop_front()

func clear() -> void:
	shots.clear()
	_t = 0.0
	_pending = -1.0

## The end of a loop: the pictures, newest first, rushing past into the
## light. Awaitable.
func play() -> void:
	var reel := _Reel.new()
	reel.shots = shots.duplicate()
	reel.shots.reverse()
	add_child(reel)
	await reel.done
	reel.queue_free()


class _Reel extends CanvasLayer:
	signal done
	var shots: Array = []
	var _c: Control
	var _t := 0.0
	var _length := 5.5
	var _glow: GradientTexture2D

	func _ready() -> void:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.add_point(0.12, Color(0.85, 0.94, 1.0, 0.75))
		g.add_point(0.4, Color(0.6, 0.8, 1.0, 0.18))
		g.set_color(g.get_point_count() - 1, Color(0.5, 0.7, 1.0, 0.0))
		_glow = GradientTexture2D.new()
		_glow.gradient = g
		_glow.fill = GradientTexture2D.FILL_RADIAL
		_glow.fill_from = Vector2(0.5, 0.5)
		_glow.fill_to = Vector2(1.0, 0.5)
		_glow.width = 256
		_glow.height = 256
		layer = 40
		process_mode = Node.PROCESS_MODE_ALWAYS
		_c = Control.new()
		_c.set_anchors_preset(Control.PRESET_FULL_RECT)
		_c.mouse_filter = Control.MOUSE_FILTER_IGNORE
		_c.draw.connect(_paint)
		add_child(_c)
		_length = clampf(2.0 + shots.size() * 0.16, 2.5, 6.5)

	func _process(dt: float) -> void:
		_t += dt
		_c.queue_redraw()
		if _t >= _length + 2.2:
			done.emit()
			set_process(false)

	func _paint() -> void:
		var vp := _c.get_viewport_rect().size
		var mid := vp / 2.0
		var k := clampf(_t / _length, 0.0, 1.0)
		# From white (the light that took you) to the dark between loops.
		var bg := Color(0.82, 0.92, 1.0).lerp(Color(0.01, 0.012, 0.02), smoothstep(0.0, 0.35, k))
		_c.draw_rect(Rect2(Vector2.ZERO, vp), bg)
		# Travelled along the tunnel: accelerating.
		var travel := pow(k, 1.7) * (shots.size() + 2.0)
		# Far to near, so nearer pictures cover farther ones.
		for i in range(shots.size() - 1, -1, -1):
			var z := float(i) + 1.0 - travel
			if z <= 0.05 or z > 7.0:
				continue
			var s := 1.0 / z
			var size := vp * 0.62 * s
			# Each a little off the axis, turning about it as it comes.
			var a := float(i) * 2.399
			var off := Vector2(cos(a + travel * 0.3), sin(a + travel * 0.3)) * vp.y * 0.07 * s
			var alpha := clampf((7.0 - z) / 2.5, 0.0, 1.0) * clampf(z / 0.35, 0.0, 1.0)
			var r := Rect2(mid + off - size / 2.0, size)
			_c.draw_rect(r.grow(3.0 * s), Color(1, 1, 1, 0.85 * alpha))
			_c.draw_texture_rect(shots[i], r, false, Color(1, 1, 1, alpha))
		# The point of light at the end of it, growing; then the ring.
		var glow := smoothstep(0.55, 1.0, k)
		var light := 40.0 + glow * 420.0
		_c.draw_texture_rect(_glow, Rect2(mid - Vector2.ONE * light, Vector2.ONE * light * 2.0), false, Color(1, 1, 1, 0.55 + glow * 0.45))
		var after := clampf((_t - _length) / 2.2, 0.0, 1.0)
		if after > 0.0:
			var ring := lerpf(30.0, vp.y * 0.36, smoothstep(0.0, 1.0, after))
			_c.draw_arc(mid, ring, 0.0, TAU, 96, Color(0.65, 0.85, 1.0, 0.8 * (1.0 - after)), 3.0 + 6.0 * (1.0 - after), true)
			_c.draw_rect(Rect2(Vector2.ZERO, vp), Color(0, 0, 0, smoothstep(0.4, 1.0, after)))
