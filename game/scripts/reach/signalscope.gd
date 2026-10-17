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
var _t := 0.0

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
	_t += get_process_delta_time()
	var vp := _ui.get_viewport_rect().size
	var c := Vector2(vp.x / 2.0, vp.y - 120.0)
	var cam := get_viewport().get_camera_3d()
	var here := sources.filter(func(s): return s.freq == freq)
	here.sort_custom(func(a, b): return float(_strengths.get(a, 0.0)) > float(_strengths.get(b, 0.0)))
	var best: SignalSource = here[0] if not here.is_empty() else null
	var k := clampf(float(_strengths.get(best, 0.0)), 0.0, 1.0) if best else 0.0
	# The scope's ring, and a pip on it toward every source on this
	# frequency (bigger the nearer it is to where you point).
	var m := vp / 2.0
	_ui.draw_arc(m, 64.0, 0.0, TAU, 64, Color(ReachStyle.PINE, 0.35), 1.5, true)
	_ui.draw_arc(m, 64.0, -PI / 2.0 - k * PI, -PI / 2.0 + k * PI, 64, Color(ReachStyle.PINE, 0.9), 3.0, true)
	if cam:
		for src: SignalSource in here:
			var to := src.global_position - cam.global_position
			var local := cam.global_basis.inverse() * to
			var dir := Vector2(local.x, -local.y)
			if dir.length() < 0.001:
				continue
			var ang := dir.angle()
			var sk := clampf(float(_strengths.get(src, 0.0)), 0.0, 1.0)
			var facing := clampf(-local.normalized().z, 0.0, 1.0)
			var p := m + Vector2(cos(ang), sin(ang)) * 74.0
			var col := Color(ReachStyle.PINE if sk > 0.3 else ReachStyle.BONE, 0.35 + 0.65 * maxf(sk, facing * 0.4))
			var tip := p + Vector2(cos(ang), sin(ang)) * (7.0 + sk * 6.0)
			var side := Vector2(-sin(ang), cos(ang)) * (4.0 + sk * 3.0)
			_ui.draw_colored_polygon(PackedVector2Array([tip, p + side, p - side]), col)
	# The panel: frequency, the strongest signal, an oscilloscope.
	var w := 520.0
	var r := Rect2(c - Vector2(w / 2.0, 58), Vector2(w, 116))
	_ui.draw_rect(r, Color(0.06, 0.055, 0.05, 0.82))
	_ui.draw_rect(Rect2(r.position, Vector2(w, 2)), Color(ReachStyle.PINE, 0.8))
	var title := String(FREQS[freq]).to_upper()
	var tw := Style.mono_bold.get_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x
	_ui.draw_string(Style.mono_bold, Vector2(c.x - tw / 2.0, r.position.y + 26), title, HORIZONTAL_ALIGNMENT_LEFT, -1, 14, ReachStyle.BONE)
	_ui.draw_string(ReachStyle.serif_bold, Vector2(c.x - tw / 2.0 - 34, r.position.y + 28), "‹", HORIZONTAL_ALIGNMENT_LEFT, -1, 22, ReachStyle.EMBER)
	_ui.draw_string(ReachStyle.serif_bold, Vector2(c.x + tw / 2.0 + 22, r.position.y + 28), "›", HORIZONTAL_ALIGNMENT_LEFT, -1, 22, ReachStyle.EMBER)
	for i in FREQS.size():
		var dx := (i - (FREQS.size() - 1) / 2.0) * 12.0
		_ui.draw_circle(Vector2(c.x + dx, r.position.y + 38), 2.5 if i == freq else 1.8, ReachStyle.EMBER if i == freq else Color(ReachStyle.BONE, 0.3))
	# The wave: clean and tall on a strong signal, hiss on nothing.
	var pts := PackedVector2Array()
	var y0 := r.position.y + 72.0
	var rng := RandomNumberGenerator.new()
	rng.seed = int(_t * 30.0)
	for i in 121:
		var x := r.position.x + 20.0 + (w - 40.0) * i / 120.0
		var phase := float(i) * 0.38 - _t * 9.0
		var wave := sin(phase) * 0.7 + sin(phase * 2.03 + 1.0) * 0.3
		var hiss := rng.randf_range(-1.0, 1.0)
		pts.append(Vector2(x, y0 - (wave * k * 16.0 + hiss * (1.0 - k) * 5.0)))
	_ui.draw_polyline(pts, Color(ReachStyle.PINE, 0.25 + 0.6 * k), 1.6, true)
	var name := "Nothing on this frequency yet." if not best else (best.title if best.identified() else "Unidentified signal")
	var nw := Style.mono.get_string_size(name, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
	_ui.draw_string(Style.mono, Vector2(c.x - nw / 2.0, r.position.y + 106), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, ReachStyle.BONE if k > 0.05 else ReachStyle.MUTE)
	_ui.draw_string(Style.mono, Vector2(r.position.x + 12, r.position.y + 106), "Z", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, ReachStyle.FAINT)
	_ui.draw_string(Style.mono, Vector2(r.end.x - 20, r.position.y + 106), "C", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, ReachStyle.FAINT)
