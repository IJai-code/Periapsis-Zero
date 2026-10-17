class_name Signalscope
extends Node
## The signalscope (X, on foot or in the Kestrel): point it and listen. Five
## frequencies (Z and C, or the wheel, to change): Travellers, Distress, the
## Choir, Hollow chatter, Quantum. A signal is loudest straight ahead and
## carries across the Reach; its name shows once you have been near it.
## Out of the scope, each source is heard where it is, close by.
##
## Every Traveller plays a part of the same song in step with the loop's
## clock, so two heard together harmonise.

const FREQS := ["Travellers", "Distress", "The Choir", "Hollow chatter", "Quantum"]
const SONG := 41.7391

var reach: Node
var active := false
var freq := 0
var sources: Array[SignalSource] = []
var _ui: Control
var _strengths := {}

func _ready() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 7
	add_child(layer)
	_ui = Control.new()
	_ui.set_anchors_preset(Control.PRESET_FULL_RECT)
	_ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ui.draw.connect(_paint)
	layer.add_child(_ui)

## A source somewhere in the Reach, under `parent` (a body's node, or a
## moving thing), playing `stream`.
func add_source(parent: Node3D, id: String, title: String, f: int, stream: AudioStream, at := Vector3.ZERO, near := 18.0) -> SignalSource:
	var s := SignalSource.new()
	s.id = id
	s.title = title
	s.freq = f
	s.near = near
	s.stream = stream
	s.position = at
	parent.add_child(s)
	sources.append(s)
	s.sync_to(reach.system.t)
	return s

## Back in step after the loop restarts.
func resync() -> void:
	for s in sources:
		s.sync_to(reach.system.t)

func _unhandled_input(e: InputEvent) -> void:
	if not reach or reach.talking:
		return
	if e is InputEventKey and e.pressed and not e.echo:
		match (e as InputEventKey).keycode:
			KEY_X:
				active = not active
				Sfx.play("click", -10.0, 0.7 if active else 0.5)
				get_viewport().set_input_as_handled()
			KEY_Z:
				if active:
					freq = (freq + FREQS.size() - 1) % FREQS.size()
					Sfx.play("beep", -14.0, 0.8)
			KEY_C:
				if active:
					freq = (freq + 1) % FREQS.size()
					Sfx.play("beep", -14.0, 0.8)
	elif active and e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP:
			freq = (freq + 1) % FREQS.size()
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			freq = (freq + FREQS.size() - 1) % FREQS.size()

func _process(dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if not cam:
		return
	var fwd := -cam.global_basis.z
	for s in sources:
		var to := s.global_position - cam.global_position
		var d := to.length()
		var strength := 0.0
		if active and s.freq == freq and d > 0.01:
			var c := fwd.dot(to / d)
			var aim := pow(maxf(c, 0.0), 60.0)
			var reach_k := clampf(1.0 - d / 26000.0, 0.0, 1.0)
			strength = aim * (0.25 + 0.75 * reach_k)
		_strengths[s] = lerpf(float(_strengths.get(s, 0.0)), strength, minf(1.0, dt * 8.0))
		s.scope_level(_strengths[s])
		if d < s.near * 4.0 and not s.identified():
			s.identify()
			if reach.hud:
				reach.hud.toast("SIGNAL IDENTIFIED  ·  " + s.title.to_upper())
	# A narrower view through the scope.
	if reach.player and reach.player.camera:
		reach.player.camera.fov = lerpf(reach.player.camera.fov, 42.0 if active and reach.player.enabled else 74.0, minf(1.0, dt * 6.0))
	_ui.queue_redraw()

func _paint() -> void:
	if not active:
		return
	var vp := _ui.get_viewport_rect().size
	var c := Vector2(vp.x / 2.0, vp.y - 150.0)
	_ui.draw_rect(Rect2(c - Vector2(230, 60), Vector2(460, 120)), Color(0.08, 0.07, 0.06, 0.78))
	_ui.draw_rect(Rect2(c - Vector2(230, 60), Vector2(460, 2)), Color(ReachStyle.EMBER, 0.7))
	_ui.draw_string(Style.mono_bold, c + Vector2(-210, -36), "SIGNALSCOPE", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, ReachStyle.EMBER)
	_ui.draw_string(Style.sans_bold, c + Vector2(-210, -12), "%s" % FREQS[freq], HORIZONTAL_ALIGNMENT_LEFT, -1, 18, ReachStyle.BONE)
	_ui.draw_string(Style.mono, c + Vector2(110, -36), "Z / C  wheel", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, ReachStyle.MUTE)
	# Signals on this frequency, strongest first.
	var here := sources.filter(func(s): return s.freq == freq)
	here.sort_custom(func(a, b): return float(_strengths.get(a, 0.0)) > float(_strengths.get(b, 0.0)))
	for i in mini(here.size(), 3):
		var s: SignalSource = here[i]
		var k := clampf(float(_strengths.get(s, 0.0)), 0.0, 1.0)
		var y := c.y + 12 + i * 16
		_ui.draw_rect(Rect2(Vector2(c.x - 210, y - 8), Vector2(160, 6)), Color(ReachStyle.BONE, 0.12))
		_ui.draw_rect(Rect2(Vector2(c.x - 210, y - 8), Vector2(160 * k, 6)), ReachStyle.PINE if k > 0.6 else ReachStyle.EMBER)
		var name := s.title if s.identified() else "Unidentified signal"
		_ui.draw_string(Style.mono, Vector2(c.x - 40, y), name, HORIZONTAL_ALIGNMENT_LEFT, 250, 12, ReachStyle.BONE if k > 0.05 else ReachStyle.MUTE)
	if here.is_empty():
		_ui.draw_string(Style.mono, Vector2(c.x - 210, c.y + 16), "Nothing on this frequency yet.", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, ReachStyle.MUTE)
	# The scope's reticle.
	var m := vp / 2.0
	_ui.draw_arc(m, 34.0, 0.0, TAU, 48, Color(ReachStyle.PINE, 0.5), 1.5, true)
	_ui.draw_line(m + Vector2(-46, 0), m + Vector2(-38, 0), ReachStyle.PINE, 1.5)
	_ui.draw_line(m + Vector2(38, 0), m + Vector2(46, 0), ReachStyle.PINE, 1.5)
