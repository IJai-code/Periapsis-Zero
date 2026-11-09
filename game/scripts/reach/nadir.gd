class_name Nadir
extends Node3D
## The Nadir, at the Reach's edge: a black hole (the lens and its disk,
## black_hole.gdshader, on a sphere round it), the gleam pouring into it out
## of the Lantern (gleam.gdshader), and two places over it. The relay buoy
## at the lip, 1100 m out, where Tock has kept the beacon lit for a hundred
## and four years; and the Tern, 300 m over the horizon, where time runs six
## times slow and Pip Ferreira keeps watch while her parents sleep.
##
## Its disk lies in this node's XZ plane. Both decks face away from the
## hole, so the hole's pull is their floor's down; ReachSystem.decks gives
## them a walkable strength. Too deep and nothing comes back (Reach).

const EXTENT := 1250.0
const TERN_R := 300.0
const BUOY_R := 1100.0
const TERN_DIR := Vector3(0.55, 0.62, 0.55)
const BUOY_DIR := Vector3(-0.32, 0.42, 0.85)
const DECK_G := 6.0
## The march's length, by quality tier (0 the best).
const STEPS := [72, 60, 48, 36, 28]

var reach: Node
var tern: Node3D
var buoy: Node3D
var tock: Node3D
var _tock_head: Node3D
var _tock_home := Transform3D()
var _tock_use: Usable
var _tock_light: OmniLight3D
var _falling := -1.0
var pip: Person
var _pip_use: Usable
var _log_use: Usable
var _lens: MeshInstance3D
var _lens_mat: ShaderMaterial
var _gleam: MeshInstance3D
var _gleam_mat: ShaderMaterial
var _tier_t := 0.0
## The Tern's cabin holds air (world space test, as ZeroGCave.inside).
static var _cabin: Node3D

static func air_at(p: Vector3) -> bool:
	return is_instance_valid(_cabin) and _cabin.is_inside_tree() and p.distance_to(_cabin.global_transform * Vector3(0, 1.6, -11.0)) < 4.2
var _t := 0.0

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	# The disk tilted off the Reach's plane, so it is seen open from the worlds.
	basis = Basis(Vector3.RIGHT, 0.38) * Basis(Vector3.FORWARD, 0.16)
	_make_lens()
	_make_light()
	tern = _place("res://art/nadir-tern.glb", TERN_DIR, TERN_R, Vector3(0.0, 0.0, 1.0))
	buoy = _place("res://art/nadir-buoy.glb", BUOY_DIR, BUOY_R, Vector3(1.0, 0.0, 0.0))
	var sys: ReachSystem = reach.system if reach else null
	if sys:
		sys.decks.append([tern, 22.0, DECK_G])
		sys.decks.append([buoy, 16.0, DECK_G])
	_make_tock()
	_make_pip()
	_cabin = tern
	_make_gleam()

## A piece stood on its deck at `r` metres along `dir`, its deck facing out.
func _place(path: String, dir: Vector3, r: float, ahead: Vector3) -> Node3D:
	var n: Node3D = load(path).instantiate()
	Surfaces.apply(n)
	add_child(n)
	var up := dir.normalized()
	n.transform = Transform3D(Site.upright(up, ahead), up * r)
	Surfaces.collide(n)
	return n

func _make_lens() -> void:
	_lens = MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = EXTENT
	sm.height = EXTENT * 2.0
	sm.radial_segments = 48
	sm.rings = 24
	_lens.mesh = sm
	_lens_mat = ShaderMaterial.new()
	_lens_mat.shader = load("res://shaders/black_hole.gdshader")
	_lens_mat.set_shader_parameter("rs", ReachSystem.NADIR_RS)
	_lens_mat.set_shader_parameter("extent", EXTENT)
	# Last of all the see-through things, so nothing glows through its
	# shadow (the Lantern's halo was drawn over it).
	_lens_mat.render_priority = 100
	_lens.material_override = _lens_mat
	_lens.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Drawn last of the far things: what it bends is what is behind it.
	_lens.sorting_offset = -EXTENT
	add_child(_lens)

## The disk lights everything near it, warm, from below.
func _make_light() -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.62, 0.32)
	l.light_energy = 6.0
	l.omni_range = 1500.0
	l.omni_attenuation = 0.7
	l.shadow_enabled = false
	add_child(l)

## Tock: a stout old robot on a ring of light, by the buoy's bench, who
## turns his head to you and bobs as he talks.
func _make_tock() -> void:
	tock = Node3D.new()
	tock.name = "Tock"
	buoy.add_child(tock)
	tock.position = Vector3(-9.0, 0.0, 0.4)
	_tock_home = tock.transform
	var body: Node3D = load("res://art/nadir-tock_body.glb").instantiate()
	Surfaces.apply(body)
	tock.add_child(body)
	_tock_head = load("res://art/nadir-tock_head.glb").instantiate()
	Surfaces.apply(_tock_head)
	tock.add_child(_tock_head)
	_tock_head.position = Vector3(0, 1.62, 0)
	_tock_light = OmniLight3D.new()
	_tock_light.light_color = Color(1.0, 0.78, 0.45)
	_tock_light.light_energy = 0.8
	_tock_light.omni_range = 5.0
	_tock_light.shadow_enabled = false
	tock.add_child(_tock_light)
	_tock_light.position = Vector3(0, 1.2, 0.8)
	var flood := OmniLight3D.new()
	flood.light_color = Color(0.95, 0.92, 0.85)
	flood.light_energy = 1.5
	flood.omni_range = 24.0
	flood.shadow_enabled = false
	buoy.add_child(flood)
	flood.position = Vector3(0, 9.0, -6.0)
	_tock_use = Usable.box("Talk to Tock", Vector3(1.4, 2.0, 1.4))
	_tock_use.position = Vector3(0, 1.0, 0)
	tock.add_child(_tock_use)
	_tock_use.used.connect(func(by): _talk("tock", null, by))

## Pip at the Tern's console under the glass, and her father's log beside her.
func _make_pip() -> void:
	pip = Person.make("fen")
	pip.solid = false
	tern.add_child(pip)
	pip.scale = Vector3.ONE * 0.78
	pip.position = Vector3(0.0, 0.62, -10.1)
	pip.locomote(0.0, false, false, true)
	_pip_use = Usable.box("Talk to Pip", Vector3(1.2, 1.6, 1.2))
	_pip_use.position = Vector3(0.0, 1.1, -10.1)
	tern.add_child(_pip_use)
	_pip_use.used.connect(func(by): _talk("pip", pip, by))
	_log_use = Usable.box("Play Abe's log", Vector3(1.0, 0.8, 0.6))
	_log_use.position = Vector3(0.6, 1.1, -8.8)
	tern.add_child(_log_use)
	_log_use.used.connect(func(by): _talk("abe_log", null, by))
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.86, 0.66)
	lamp.light_energy = 1.4
	lamp.omni_range = 9.0
	lamp.shadow_enabled = false
	tern.add_child(lamp)
	lamp.position = Vector3(0, 3.6, -11.0)
	# Floodlights from the mast over the deck, so it can be walked and seen.
	var flood := OmniLight3D.new()
	flood.light_color = Color(0.9, 0.95, 1.0)
	flood.light_energy = 1.6
	flood.omni_range = 22.0
	flood.shadow_enabled = false
	tern.add_child(flood)
	flood.position = Vector3(0, 7.0, 4.0)

func _talk(key: String, who: Person, by: Node) -> void:
	var ex := by as Explorer
	if ex == null or reach.talking:
		return
	ex.enabled = false
	reach.talking = true
	if who:
		who.face(ex.global_position)
	var t := Talk.open(reach, key, who, reach.hud)
	await t.finished
	reach.talking = false
	ex.enabled = true
	if t.outcome == "tock_falls":
		_falling = 0.0
		Season.add(400)

## The gleam: three strands winding out of the Lantern, across the Reach,
## and down into the Nadir, as camera-facing ribbons. Its rail is a
## circle, so the length never changes; only where it lies is set each frame.
func _make_gleam() -> void:
	var length := 16500.0
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 260
	for strand in 3:
		var ph := TAU * strand / 3.0
		var prev := Vector3.ZERO
		var pts: Array[Vector3] = []
		for i in n + 1:
			var s := float(i) / n
			var amp := 520.0 * pow(sin(PI * s), 0.8) * (1.0 - 0.6 * s)
			var a := ph + s * TAU * 2.3
			# A slow wave through all three, so the river meanders.
			var wave := Vector3(sin(s * 7.0 + 1.3) * 380.0, cos(s * 5.0) * 260.0, 0.0) * sin(PI * s)
			pts.append(Vector3(cos(a) * amp, sin(a) * amp, s * length) + wave)
		for i in n:
			var s0 := float(i) / n
			var s1 := float(i + 1) / n
			var t0 := (pts[mini(i + 1, n)] - pts[maxi(i - 1, 0)]).normalized()
			var t1 := (pts[mini(i + 2, n)] - pts[i]).normalized()
			var w0 := _gleam_width(s0)
			var w1 := _gleam_width(s1)
			for q in [[pts[i], t0, s0, 0.0, w0], [pts[i + 1], t1, s1, 0.0, w1], [pts[i + 1], t1, s1, 1.0, w1],
					[pts[i], t0, s0, 0.0, w0], [pts[i + 1], t1, s1, 1.0, w1], [pts[i], t0, s0, 1.0, w0]]:
				st.set_normal(q[1])
				st.set_uv(Vector2(q[2], q[3]))
				st.set_color(Color(q[4], 0, 0))
				st.add_vertex(q[0])
		prev = pts[n]
	_gleam = MeshInstance3D.new()
	_gleam.mesh = st.commit()
	_gleam_mat = ShaderMaterial.new()
	_gleam_mat.shader = load("res://shaders/gleam.gdshader")
	_gleam.material_override = _gleam_mat
	_gleam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_gleam.custom_aabb = AABB(Vector3(-2000, -2000, -500), Vector3(4000, 4000, length + 1000))
	_gleam.top_level = true
	add_child(_gleam)

static func _gleam_width(s: float) -> float:
	return 0.5 + 1.3 * sin(PI * minf(s * 1.15, 1.0)) + 0.3 * smoothstep(0.9, 1.0, s)

## Where things are, for the marker and the autopilot (world space).
func spot(name: String) -> Vector3:
	match name:
		"tern":
			return tern.global_transform * Vector3(0, 2.0, 5.5)
		"abe":
			return tern.global_transform * Vector3(0.6, 1.4, -8.8)
		"pip":
			return tern.global_transform * Vector3(0, 1.6, -10.1)
		"tock":
			return tock.global_transform * Vector3(0, 1.8, 0)
		"approach":
			return buoy.global_transform * Vector3(0, 40.0, 0)
	return buoy.global_transform * Vector3(0, 2.0, 0)

func _process(dt: float) -> void:
	_t += dt
	var sys: ReachSystem = reach.system if reach else null
	if not sys:
		return
	# The gleam runs from the Lantern to here, wherever the frame has them.
	var from := sys.world("lantern")
	var to := global_position
	if from.distance_to(to) > 1.0:
		_gleam.global_transform = Transform3D(Basis.looking_at(-(to - from), Vector3.UP), from)
	_tier_t -= dt
	if _tier_t <= 0.0:
		_tier_t = 2.0
		var tier := clampi(Flow.tier, 0, STEPS.size() - 1)
		_lens_mat.set_shader_parameter("steps", STEPS[tier])
		_lens_mat.set_shader_parameter("step_k", 0.12 if tier < 2 else 0.17)
	_tock_motion(dt)

func _tock_motion(dt: float) -> void:
	if not tock or not tock.is_inside_tree():
		return
	var ex: Node3D = reach.player
	if _falling >= 0.0:
		# Up off the deck, out over the edge, and down toward the Tern's
		# light, his own lamp growing small.
		_falling += dt
		var start := buoy.global_transform * _tock_home.origin
		var high := start + buoy.global_basis.y * 18.0
		var end := tern.global_transform * Vector3(0, 2.0, 0)
		var k := clampf(_falling / 40.0, 0.0, 1.0)
		var p := high.lerp(end, smoothstep(0.0, 1.0, k)) if _falling > 4.0 else start.lerp(high, smoothstep(0.0, 1.0, _falling / 4.0))
		tock.global_position = p
		_tock_light.light_energy = 2.5
		_tock_light.omni_range = 14.0
		_tock_use.collision_layer = 0
		if k >= 1.0:
			tock.visible = false
			_falling = -2.0
		return
	if _falling == -2.0:
		return
	tock.transform.origin = _tock_home.origin + Vector3(0, 0.12 + 0.08 * sin(_t * 1.7), 0)
	if ex and ex.is_inside_tree() and ex.global_position.distance_to(tock.global_position) < 14.0:
		var local := tock.global_transform.affine_inverse() * ex.global_position
		var want := atan2(-local.x, -local.z)
		_tock_head.rotation.y = lerp_angle(_tock_head.rotation.y, want + PI, minf(1.0, dt * 3.0))

## A new morning: Tock home at his bench, the relay lit.
func reset_loop() -> void:
	_falling = -1.0
	if tock:
		tock.visible = true
		tock.transform = _tock_home
		_tock_use.collision_layer = 8
		_tock_light.light_energy = 0.8
		_tock_light.omni_range = 5.0
