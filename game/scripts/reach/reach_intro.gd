class_name ReachIntro
extends Node
## The first time the Reach is opened: seventy seconds of the game itself,
## filmed live, one unbroken flight. It opens on the Nadir, the Lantern's
## light bent into a ring round it; rides the gleam back across the whole
## Reach toward the star; comes round Hearthstone's night side as the
## Lantern rises over its limb and drops into the crater; then the morning
## races past in twelve seconds, the star swells, reddens, falls in and
## goes, and the shell of light reaches the camera. White, black, the title.
## Then the eyes open by the fire, as every morning.
##
## What the best openings do, and this tries to: one continuous camera and
## no loading (No Man's Sky's seamless flight), scale shown before story
## (Elite), few words and the music carrying it (Homeworld), the game's own
## central picture in the first minute (Outer Wilds: a star going out and
## the morning coming back), rendered live so it is never a choppy video
## (EVE's intro was, on weak machines).
##
## The camera is a spline through keys in the Lantern's frame (each key is
## a body and an offset from it), turned into the world's frame every
## frame, so the system's frame can change under it (at the Nadir, at
## Hearthstone) without a jump. The score is art/audio/reach_music.py
## `intro`, cut to these times; keep them together. Any key or click skips.

signal finished

## Seen once per player: the key is this film's (the first film's was
## "intro_seen").
const SEEN := "film_seen_v2"

const LENGTH := 70.0
## When the shell of the nova goes out (the score's boom).
const NOVA_AT := 57.2
## The morning's clock: frozen at T0 for the flight, then raced to T_END.
## Candidate hours for the flight (the first whose path passes no other
## world closely: seen from a few kilometres, a far world's coarse mesh
## shows its facets).
const T0S := [150.0, 250.0, 350.0, 450.0, 560.0]
var T0 := 150.0
const T_END := 1255.0

var reach: Node
var _cam: Camera3D
var _layer: CanvasLayer
var _caption: Label
var _title: Label
var _title_font: FontVariation
var _glow: TextureRect
var _sub: Label
var _hint: Label
var _veil: ColorRect
var _skip := false
var _music: AudioStreamPlayer
var _keys: Array = []
var _looks: Array = []
var _tau := 0.0
var _collapsing := false
var _nova := false

## [from, to, words] in film seconds.
const WORDS := [
	[2.5, 7.6, "Every star keeps time."],
	[8.6, 13.4, "This one is running out."],
	[34.0, 41.0, "Three days ago you came down here, burning.\nThey pulled you out of the fire."],
	[45.0, 51.6, "Twenty-two minutes of light."],
	[52.4, 56.6, "Then it goes out."],
]

func _ready() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 40
	add_child(_layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(root)
	_veil = ColorRect.new()
	_veil.color = Color(0, 0, 0, 1)
	_veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	_veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_veil)
	# Scope: 2.35 to 1 on a 16:9 screen, the words in the bar below.
	for top in [true, false]:
		var bar := ColorRect.new()
		bar.color = Color(0, 0, 0)
		bar.set_anchors_preset(Control.PRESET_TOP_WIDE if top else Control.PRESET_BOTTOM_WIDE)
		if top:
			bar.anchor_bottom = 0.122
		else:
			bar.anchor_top = 0.878
		bar.offset_top = 0
		bar.offset_bottom = 0
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		root.add_child(bar)
	_caption = ReachStyle.label("", 23, Color("#efe4cf"))
	_caption.add_theme_font_override("font", ReachStyle.serif_italic)
	_caption.set_anchors_preset(Control.PRESET_FULL_RECT)
	_caption.anchor_top = 0.885
	_caption.anchor_bottom = 0.995
	_caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_caption.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_caption.modulate.a = 0.0
	root.add_child(_caption)
	_title_font = FontVariation.new()
	_title_font.base_font = ReachStyle.chunky
	_title_font.spacing_glyph = 40
	_title = Label.new()
	_title.text = "PERIAPSIS ZERO"
	_title.add_theme_font_override("font", _title_font)
	_title.add_theme_font_size_override("font_size", 84)
	_title.add_theme_color_override("font_color", Color("#ffd9a0"))
	_title.add_theme_color_override("font_shadow_color", Color(1.0, 0.45, 0.12, 0.55))
	_title.add_theme_constant_override("shadow_outline_size", 26)
	_title.add_theme_constant_override("shadow_offset_x", 0)
	_title.add_theme_constant_override("shadow_offset_y", 0)
	_title.set_anchors_preset(Control.PRESET_CENTER)
	_title.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_title.grow_vertical = Control.GROW_DIRECTION_BOTH
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.modulate.a = 0.0
	# An ember's glow behind the name.
	_glow = TextureRect.new()
	var g := GradientTexture2D.new()
	g.fill = GradientTexture2D.FILL_RADIAL
	g.fill_from = Vector2(0.5, 0.5)
	g.fill_to = Vector2(1.0, 0.5)
	g.width = 512
	g.height = 256
	var grad := Gradient.new()
	grad.set_color(0, Color(1.0, 0.55, 0.2, 0.55))
	grad.set_color(1, Color(1.0, 0.4, 0.1, 0.0))
	grad.add_point(0.45, Color(1.0, 0.45, 0.15, 0.18))
	g.gradient = grad
	_glow.texture = g
	_glow.stretch_mode = TextureRect.STRETCH_SCALE
	_glow.set_anchors_preset(Control.PRESET_CENTER)
	_glow.custom_minimum_size = Vector2(1100, 420)
	_glow.size = Vector2(1100, 420)
	_glow.position = -_glow.size * 0.5
	_glow.pivot_offset = _glow.size * 0.5
	_glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_glow.modulate.a = 0.0
	root.add_child(_glow)
	root.add_child(_title)
	_sub = ReachStyle.label("The morning begins again. Only you remember.", 22, Color("#efe4cf"))
	_sub.add_theme_font_override("font", ReachStyle.serif_italic)
	_sub.set_anchors_preset(Control.PRESET_CENTER)
	_sub.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_sub.offset_top = 70
	_sub.offset_bottom = 110
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sub.modulate.a = 0.0
	root.add_child(_sub)
	_hint = ReachStyle.label("Any key to skip", 13, ReachStyle.MUTE)
	_hint.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_hint.offset_left = -170
	_hint.offset_top = -40
	root.add_child(_hint)
	_cam = Camera3D.new()
	_cam.fov = 42.0
	_cam.near = 0.2
	_cam.far = 60000.0
	# Moved every drawn frame, on the music's clock: not smoothed between
	# physics ticks (that is a lag of a tick, and a warning each frame).
	_cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	reach.add_child(_cam)
	_music = AudioStreamPlayer.new()
	_music.stream = load("res://audio/reach/intro.wav")
	_music.volume_db = -2.0 + Flow.music_db()
	add_child(_music)

func _input(e: InputEvent) -> void:
	if (e is InputEventKey and e.pressed and not e.echo) or (e is InputEventMouseButton and e.pressed):
		_skip = true
		get_viewport().set_input_as_handled()

## The whole film; awaitable.
func play() -> void:
	var sys: ReachSystem = reach.system
	var hud_was: bool = reach.hud.visible
	reach.hud.visible = false
	var ex: Node = reach.player
	var ex_mode: int = ex.process_mode
	ex.process_mode = Node.PROCESS_MODE_DISABLED
	sys.running = false
	sys.t = T0
	_cam.make_current()
	# The frame stays Hearthstone's the whole way (the explorer, asleep by
	# the fire, holds it): the camera may fly anywhere, and no world is
	# woken or put to sleep mid-flight (that was a two-thirds-of-a-second
	# stall on arriving home). Far out, a float is still good to a
	# millimetre.
	sys.focus = ex
	# The stones that fall from eight o'clock: not in a morning raced
	# through in twelve seconds (a burst of them was a hitch).
	var storms: Array[Node] = []
	for n in (reach.planets["hearthstone"] as Node).get_children():
		if n is MeteorStorm:
			storms.append(n)
			n.process_mode = Node.PROCESS_MODE_DISABLED
	sys.switch("hearthstone")
	(reach.planets["hearthstone"] as Planet).set_ref(true)
	for cand in T0S:
		T0 = cand
		sys.t = T0
		sys.place()
		_build()
		if _clear(16.0, 33.0) > 5000.0:
			break
	sys.place()
	_place(0.0)
	for i in 4:
		await get_tree().process_frame
	_place(0.0)
	_music.play()
	var start := Time.get_ticks_msec()
	while not _skip:
		# The film runs on the music's clock, so a slow frame never puts
		# the picture behind the score; on the wall clock if the browser
		# holds the sound back (no click yet) and the music stands still.
		var wall := (Time.get_ticks_msec() - start) / 1000.0
		var pos := _music.get_playback_position() + AudioServer.get_time_since_last_mix()
		var tau := pos if _music.playing and pos > 0.05 and absf(pos - wall) < 1.5 else wall
		_tau = maxf(_tau, tau)
		if _tau >= LENGTH - 2.4:
			break
		var f0 := Time.get_ticks_usec()
		_frame(_tau)
		await get_tree().process_frame
		if "--introprof" in OS.get_cmdline_user_args():
			var ms := (Time.get_ticks_usec() - f0) / 1000.0
			if ms > 40.0:
				print("INTROSLOW tau %.2f t %.0f %.0f ms" % [_tau, reach.system.t, ms])
	_veil.color = Color(0, 0, 0, 1)
	var fade := create_tween()
	fade.tween_property(_music, "volume_db", -60.0, 2.4 if not _skip else 0.8)
	_caption.modulate.a = 0.0
	if _skip:
		_title.modulate.a = 0.0
		_sub.modulate.a = 0.0
	else:
		var tf := create_tween()
		tf.tween_property(_title, "modulate:a", 0.0, 1.0)
		tf.parallel().tween_property(_sub, "modulate:a", 0.0, 1.0)
		tf.parallel().tween_property(_glow, "modulate:a", 0.0, 1.0)
		await tf.finished
	await get_tree().create_timer(0.3).timeout
	Flow.set_progress("intro_seen", true)
	Flow.set_progress(SEEN, true)
	_gleam_power(1.0)
	for n in storms:
		n.process_mode = Node.PROCESS_MODE_INHERIT
	var lan: Lantern = reach.lantern
	lan.reset()
	ex.process_mode = ex_mode
	reach.hud.visible = hud_was
	reach.hud.blackout()
	sys.running = true
	_cam.queue_free()
	finished.emit()
	queue_free.call_deferred()

# --- The flight ---------------------------------------------------------------

## The keys: [film seconds, body, offset from it]. Space keys are offsets
## from the Lantern (the bodies are still while the clock is frozen); the
## ones at Hearthstone are offsets from it, so they hold while the morning
## races. Looks the same, aimed at.
func _build() -> void:
	var sys: ReachSystem = reach.system
	var N := sys.helio("nadir")
	var H := sys.helio("hearthstone")
	var u := N.normalized()
	var dup: Vector3 = reach.nadir.global_basis.y if reach.nadir else Vector3.UP
	var side := u.cross(dup).normalized()
	var w := H.normalized()
	var hup := Vector3.UP - w * Vector3.UP.dot(w)
	hup = hup.normalized()
	var hside := w.cross(hup).normalized()
	var R: float = (sys.bodies["hearthstone"] as ReachBody).radius
	var at := func(tau: float, p: Vector3) -> Array: return [tau, "lantern", p]
	var home := func(tau: float, p: Vector3) -> Array: return [tau, "hearthstone", p]
	var rim_high := _mark("village", -80.0, -60.0, 60.0)
	var rim_low := _mark("village", -38.0, -26.0, 13.0)
	var look_out := _mark("lookout", 0.0, 0.0, 30.0)
	var fire := _mark("village", 0.0, 0.0, 1.5)
	_keys = [
		# The Nadir: the Lantern behind it, its light bent into a ring;
		# then round and over the disk.
		at.call(0.0, N + u * 1150.0 + dup * 45.0),
		at.call(7.0, N + u * 880.0 + side * 140.0 + dup * 90.0),
		at.call(13.0, N + u * 560.0 + side * 360.0 + dup * 210.0),
		at.call(16.5, N + side * 470.0 + dup * 330.0),
		# The gleam: down its braid toward the star.
		at.call(20.5, N - u * 1800.0 + dup * 420.0),
		at.call(27.0, N - u * 7600.0 + dup * 650.0),
		# Round Hearthstone's night side, the Lantern rising over its limb.
		at.call(33.0, H + w * (R + 1350.0) + hup * 380.0),
		at.call(38.0, H + w * (R + 520.0) + hside * 420.0 + hup * 160.0),
		# Down into the crater.
		home.call(42.5, rim_high),
		home.call(46.0, rim_low),
		# The morning racing; up to the lookout to watch the star.
		home.call(51.0, look_out + (rim_low - look_out) * 0.35),
		home.call(56.0, look_out),
		home.call(LENGTH, look_out),
	]
	_looks = [
		at.call(0.0, N),
		at.call(13.0, N),
		at.call(18.5, Vector3.ZERO),
		at.call(27.5, Vector3.ZERO),
		at.call(33.5, H),
		at.call(37.5, H + (fire.normalized() * R) * 1.0),
		home.call(43.0, fire),
		home.call(49.5, fire),
		["lantern_live", 0.0, 53.0],
		["lantern_live", 0.0, LENGTH],
	]

## The nearest the camera comes to any world but home and the Nadir
## between two film times (metres from its surface).
func _clear(a: float, b: float) -> float:
	var sys: ReachSystem = reach.system
	var best := INF
	var tau := a
	while tau <= b:
		var p := _spline(tau)
		for key in sys.order:
			if key in ["lantern", "hearthstone", "nadir"]:
				continue
			var body: ReachBody = sys.bodies[key]
			best = minf(best, p.distance_to(sys.world(key)) - body.radius)
		tau += 0.25
	return best

## A point over a landmark of Hearthstone, as an offset from its centre.
func _mark(name: String, east: float, north: float, h: float) -> Vector3:
	var b: ReachBody = reach.system.bodies["hearthstone"]
	var xf := Worlds.place(b, name)
	var p := xf.origin + xf.basis.x * east - xf.basis.z * north
	var d := p.normalized()
	return d * (b.radius + Worlds.height("hearthstone", d, b.radius) + h)

## A key's point in the world's frame now.
func _world(k: Array) -> Vector3:
	var sys: ReachSystem = reach.system
	return sys.helio(String(k[1])) + (k[2] as Vector3) - sys.helio(sys.ref)

## Catmull-Rom through the keys, parameterised by time (Barry and
## Goldman's form), so the speed runs on smoothly from one leg to the next.
func _spline(tau: float) -> Vector3:
	var n := _keys.size()
	var i := 0
	while i < n - 2 and tau > float(_keys[i + 1][0]):
		i += 1
	var k1: Array = _keys[i]
	var k2: Array = _keys[i + 1]
	var p1 := _world(k1)
	var p2 := _world(k2)
	var t1 := float(k1[0])
	var t2 := float(k2[0])
	var k0: Array = _keys[i - 1] if i > 0 else []
	var k3: Array = _keys[i + 2] if i + 2 < n else []
	var p0 := _world(k0) if not k0.is_empty() else p1 - (p2 - p1)
	var t0 := float(k0[0]) if not k0.is_empty() else t1 - (t2 - t1)
	var p3 := _world(k3) if not k3.is_empty() else p2 + (p2 - p1)
	var t3 := float(k3[0]) if not k3.is_empty() else t2 + (t2 - t1)
	var t := clampf(tau, t1, t2)
	var a1 := p0.lerp(p1, (t - t0) / maxf(t1 - t0, 1e-3))
	var a2 := p1.lerp(p2, (t - t1) / maxf(t2 - t1, 1e-3))
	var a3 := p2.lerp(p3, (t - t2) / maxf(t3 - t2, 1e-3))
	var b1 := a1.lerp(a2, (t - t0) / maxf(t2 - t0, 1e-3))
	var b2 := a2.lerp(a3, (t - t1) / maxf(t3 - t1, 1e-3))
	return b1.lerp(b2, (t - t1) / maxf(t2 - t1, 1e-3))

## Where the camera looks: from one aim to the next, turning (not sliding).
func _aim(tau: float, from: Vector3) -> Vector3:
	var i := 0
	while i < _looks.size() - 2 and tau > _look_t(_looks[i + 1]):
		i += 1
	var a: Array = _looks[i]
	var b: Array = _looks[i + 1]
	var da := (_look_at(a) - from).normalized()
	var db := (_look_at(b) - from).normalized()
	var k := clampf((tau - _look_t(a)) / maxf(_look_t(b) - _look_t(a), 1e-3), 0.0, 1.0)
	k = k * k * (3.0 - 2.0 * k)
	if da.dot(db) > 0.9999:
		return db
	return da.slerp(db, k).normalized()

static func _live(k: Array) -> bool:
	return k[0] is String and k[0] == "lantern_live"

func _look_t(k: Array) -> float:
	return float(k[2]) if _live(k) else float(k[0])

func _look_at(k: Array) -> Vector3:
	if _live(k):
		return reach.system.world("lantern")
	return _world(k)

func _place(tau: float) -> void:
	var sys: ReachSystem = reach.system
	sys.place()
	var p := _spline(tau)
	var f := _aim(tau, p)
	# Up: the Nadir's disk in space, the ground's near Hearthstone.
	var dup: Vector3 = reach.nadir.global_basis.y if reach.nadir else Vector3.UP
	var hc := sys.world("hearthstone")
	var radial := (p - hc).normalized()
	var k := smoothstep(2600.0, 900.0, p.distance_to(hc))
	var up := dup.lerp(radial, k).normalized()
	if absf(f.dot(up)) > 0.995:
		up = up.cross(f).cross(f).normalized() * -1.0
	_cam.global_position = p
	_cam.global_basis = Basis.looking_at(f, up)
	if not _cam.current:
		_cam.make_current()

func _frame(tau: float) -> void:
	var sys: ReachSystem = reach.system
	# The morning racing past, eased in, held just short of the end (the
	# real end of a loop is the loop's, not the film's).
	if tau >= 44.0:
		var k := clampf((tau - 44.0) / 9.5, 0.0, 1.0)
		# Evenly (eased only out of the start): midday over the village,
		# then the long red evening.
		sys.t = lerpf(T0, T_END, ((k - 0.075) if k > 0.15 else k * k / 0.3) / 0.925)
	var lan: Lantern = reach.lantern
	if tau >= NOVA_AT - 3.2 and not _collapsing:
		_collapsing = true
		var ct := create_tween()
		ct.tween_property(lan, "collapse", 1.0, 3.2).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	if tau >= NOVA_AT and not _nova:
		_nova = true
		lan.nova()
	_place(tau)
	# The gleam burns brighter while the camera rides it.
	_gleam_power(1.0 + 2.6 * smoothstep(12.0, 18.0, tau) * (1.0 - smoothstep(27.0, 33.0, tau)))
	# The lens: long on the hole, wide down the gleam, normal at home.
	_cam.fov = lerpf(40.0, 64.0, smoothstep(13.0, 21.0, tau)) if tau < 27.0 else lerpf(64.0, 56.0, smoothstep(27.0, 36.0, tau))
	# Light and dark: up from black, the shell's white, then black for the
	# title.
	var black := 1.0 - smoothstep(0.0, 4.5, tau)
	var white := 0.0
	if _nova:
		var d := _cam.global_position.distance_to(sys.world("lantern"))
		white = clampf((lan.nova_r - (d - 900.0)) / 900.0, 0.0, 1.0)
		white = maxf(white, smoothstep(NOVA_AT, NOVA_AT + 0.12, tau) * 0.45 * (1.0 - smoothstep(NOVA_AT + 0.15, NOVA_AT + 0.9, tau)))
	var to_black := smoothstep(59.9, 60.3, tau)
	if to_black > 0.0:
		_veil.color = Color(0.85, 0.93, 1.0).lerp(Color(0, 0, 0), to_black)
		_veil.color.a = 1.0
	elif white > 0.0:
		_veil.color = Color(0.85, 0.93, 1.0, white)
	else:
		_veil.color = Color(0, 0, 0, black)
	# Words.
	var shown := ""
	var a := 0.0
	for w: Array in WORDS:
		if tau >= float(w[0]) and tau <= float(w[1]):
			shown = String(w[2])
			a = smoothstep(float(w[0]), float(w[0]) + 0.9, tau) * (1.0 - smoothstep(float(w[1]) - 0.8, float(w[1]), tau))
	if shown != "":
		_caption.text = shown
	_caption.modulate.a = a
	_hint.modulate.a = 1.0 - smoothstep(5.0, 6.5, tau)
	# The title: its letters drawing in out of the black.
	var ta := smoothstep(60.6, 62.8, tau)
	_title.modulate.a = ta
	_glow.modulate.a = ta * (0.75 + 0.25 * sin(tau * 1.7))
	_glow.scale = Vector2.ONE * lerpf(0.6, 1.0, ta)
	_title_font.spacing_glyph = int(lerpf(42.0, 8.0, 1.0 - pow(1.0 - smoothstep(60.4, 64.5, tau), 3.0)))
	_sub.modulate.a = smoothstep(63.0, 64.6, tau)

func _gleam_power(k: float) -> void:
	if reach.nadir and reach.nadir._gleam_mat:
		reach.nadir._gleam_mat.set_shader_parameter("power", k)
