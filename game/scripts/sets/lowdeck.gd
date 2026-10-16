class_name Lowdeck
extends Node3D
## Lowdeck: the city on Hearth's lower ring (art/godot/lowdeck.py). A wet
## street at the bottom of a spinning habitat ring four hundred metres in
## radius: storefronts and towers down both sides, the ring's floor and its
## city curving up away in both directions until they are overhead, the
## axial light tube dimmed for the night shift along the middle. Neon on
## every sign band, rooftop signs, paper lanterns over the street, steam
## from the manholes, rain from the condensation, flying traffic in the
## lanes overhead and Hearth Security's drones sweeping the pavements.
##
## The browser gets the same street with fewer lights (a pool of six that
## follows the player), less rain, and the far city a little sparser.

const RING_R := 420.0
const RING_W := 150.0
const STREET_HALF := 58.0

## Shop signs: what Lowdeck sells.
const SHOPS := ["NOODLE KING", "SOMA BAR", "PAWN & PARTS", "LUNAR COMPACT", "BIOMOD", "CLINIC 24H",
	"KARAOKE", "CAPSULE HOTEL", "SYNTH SOUL", "TYCHO RAMEN", "DOCK SUPPLY", "RIM CHARTERS",
	"SALVAGE", "HOLO INK", "OXYGEN BAR", "LOTTERY", "DUMPLINGS", "TEA HOUSE", "ARCADE",
	"CYBERWARE", "RECYCLE", "MEDIC", "WIRE & SON", "NIGHT MARKET", "COLD STORAGE"]
const UP := ["HOTEL", "BAR", "OPEN", "24H", "SOMA", "NOODLE", "LOANS", "PAWN", "CLINIC"]
const ROOF := ["HARBOR LINES", "TYCHO BIOMED", "LUNAR COMPACT", "ROOK & SONS · LOANS", "HEARTH WATER", "RIM CHARTERS"]
const NEON := [Color(1.0, 0.42, 0.17), Color(0.18, 0.83, 1.0), Color(1.0, 0.25, 0.62), Color(1.0, 0.86, 0.28), Color(0.4, 1.0, 0.55)]

var hq := true
var street: Node3D
var markers := {}
## Named spots for the scene script: the bar, the safehouse, the lift.
var spots := {}
var benches: Array = []
var _pool: Array[OmniLight3D] = []
var _pool_at: Array = []
var _pool_t := 0.0
var _rain: GPUParticles3D
var _rain_cpu: CPUParticles3D
var _cars: MultiMesh
var _car_lanes: Array = []
var _drones: Array = []
var _signs_flicker: Array = []
var _t := 0.0
var _sign_labels: Array = []

func _ready() -> void:
	hq = Flow.high_quality()
	_environment()
	street = load("res://art/lowdeck-street.glb").instantiate()
	add_child(street)
	Surfaces.apply(street)
	Surfaces.collide(street)
	for n in street.find_children("mk_*", "", true, false):
		var kind := String(n.name).trim_prefix("mk_")
		kind = kind.substr(0, kind.rfind("_"))
		if not markers.has(kind):
			markers[kind] = []
		markers[kind].append(n)
	_ring()
	_neon()
	_lights()
	_steam()
	_benches()
	_holograms()
	_traffic()
	_drones_make()
	_rain_make()
	_spots()

func _environment() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.012, 0.01, 0.025)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.36, 0.32, 0.52)
	env.ambient_light_energy = 0.5 if hq else 0.95
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.25 if hq else 1.05
	env.glow_enabled = true
	env.glow_intensity = 0.9
	env.glow_bloom = 0.12
	env.glow_hdr_threshold = 1.0
	env.fog_enabled = true
	env.fog_light_color = Color(0.16, 0.1, 0.24)
	env.fog_density = 0.0021
	env.fog_sky_affect = 1.0
	if hq:
		env.ssao_enabled = true
		env.ssao_radius = 1.5
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.08
	env.adjustment_saturation = 1.1
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	# The axial tube, dimmed: a faint blue light from straight overhead.
	var tube := DirectionalLight3D.new()
	tube.light_color = Color(0.5, 0.58, 0.95)
	tube.light_energy = 0.25
	tube.shadow_enabled = false
	tube.basis = Basis.looking_at(Vector3(0.1, -1.0, 0.05), Vector3.FORWARD)
	add_child(tube)

# --- The ring and the far city ------------------------------------------------

## A point on the ring's floor at `angle` (0 at the street) and `x` across,
## with the floor's up (toward the axis) there.
static func ring_point(angle: float, x: float, lift := 0.0) -> Transform3D:
	var up := Vector3(0.0, cos(angle), sin(angle))
	var at := Vector3(x, RING_R - RING_R * cos(angle), -RING_R * sin(angle)) + up * lift
	var fwd := Vector3(0.0, sin(angle), -cos(angle))
	return Transform3D(Basis(fwd.cross(up).normalized(), up, -fwd), at)

func _ring() -> void:
	var ring: Node3D = load("res://art/lowdeck-ring.glb").instantiate()
	add_child(ring)
	Surfaces.apply(ring)
	# Towers all round the ring, either side of its far streets, three
	# shapes drawn as one multimesh each.
	var kinds := ["a", "b", "c"]
	var batches := {}
	for k in kinds:
		var src: Node3D = load("res://art/lowdeck-block-%s.glb" % k).instantiate()
		Surfaces.apply(src)
		var mesh := _merged_mesh(src)
		src.free()
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = mesh
		batches[k] = [mm, []]
	var rng := RandomNumberGenerator.new()
	rng.seed = 91
	var step := 15.0 / RING_R if hq else 19.0 / RING_R
	var a := (STREET_HALF + 26.0) / RING_R
	while a < TAU - (STREET_HALF + 26.0) / RING_R:
		for x in [-52.0, -34.0, 34.0, 52.0, -70.0 + rng.randf() * 4.0, 66.0]:
			if rng.randf() < 0.18:
				continue
			var k: String = kinds[rng.randi() % 3]
			var xf := ring_point(a + rng.randf_range(-0.004, 0.004), x)
			xf.basis = xf.basis.rotated(xf.basis.y, rng.randf_range(-0.2, 0.2)).scaled(Vector3(1, rng.randf_range(0.7, 1.4), 1))
			batches[k][1].append(xf)
		a += step
	# Near the street, each side, a row of towers behind the street's own.
	for z in range(-120, 140, 18):
		for x in [-36.0, 36.0]:
			var ang := -float(z) / RING_R
			if absf(z) < STREET_HALF + 20 and absf(x) < 30.0:
				continue
			batches[kinds[rng.randi() % 3]][1].append(ring_point(ang, x))
	for k in kinds:
		var mm: MultiMesh = batches[k][0]
		var xfs: Array = batches[k][1]
		mm.instance_count = xfs.size()
		for i in xfs.size():
			mm.set_instance_transform(i, xfs[i])
		var mi := MultiMeshInstance3D.new()
		mi.multimesh = mm
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
	# A glow of city light hanging in the haze over the far streets.
	if hq:
		for i in 6:
			var ang := TAU * (i + 0.5) / 6.0
			var l := OmniLight3D.new()
			l.light_color = NEON[i % NEON.size()].lerp(Color(1, 0.7, 0.5), 0.5)
			l.light_energy = 6.0
			l.omni_range = 160.0
			l.transform = ring_point(ang, 0.0, 30.0)
			add_child(l)

## The meshes of a model merged into one, each surface keeping its
## material, for instancing.
func _merged_mesh(root: Node3D) -> ArrayMesh:
	var out := ArrayMesh.new()
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		var xf := Transform3D.IDENTITY
		var n: Node = mi
		while n and n != root:
			if n is Node3D:
				xf = (n as Node3D).transform * xf
			n = n.get_parent()
		for s in mi.mesh.get_surface_count():
			var st := SurfaceTool.new()
			st.create_from(mi.mesh, s)
			st.set_material(mi.get_surface_override_material(s) if mi.get_surface_override_material(s) else mi.mesh.surface_get_material(s))
			var arrays := st.commit_to_arrays()
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var norms: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
			for i in verts.size():
				verts[i] = xf * verts[i]
				if norms.size() > i:
					norms[i] = (xf.basis * norms[i]).normalized()
			arrays[Mesh.ARRAY_VERTEX] = verts
			if norms.size():
				arrays[Mesh.ARRAY_NORMAL] = norms
			arrays[Mesh.ARRAY_TANGENT] = null
			out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			out.surface_set_material(out.get_surface_count() - 1, mi.get_surface_override_material(s) if mi.get_surface_override_material(s) else mi.mesh.surface_get_material(s))
	return out

# --- Neon -----------------------------------------------------------------------

func _label(text: String, size: int, colour: Color, at: Vector3, yaw: float, glow := 3.2) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font = Style.sans_bold
	l.font_size = size
	l.pixel_size = 0.004
	l.modulate = Color(colour.r * glow, colour.g * glow, colour.b * glow)
	l.outline_size = 10
	l.outline_modulate = Color(colour.r * 0.6, colour.g * 0.6, colour.b * 0.6, 0.55)
	l.double_sided = false
	l.no_depth_test = false
	l.shaded = false
	l.position = at
	l.rotation.y = yaw
	add_child(l)
	return l

func _neon() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var i := 0
	for n: Node3D in markers.get("sign", []):
		var side := signf(n.scale.x)
		var width := absf(n.scale.z)
		var text: String = SHOPS[(i * 7 + 3) % SHOPS.size()]
		var colour: Color = NEON[rng.randi() % NEON.size()]
		# As big as the band will take: about a metre of lettering.
		var size := clampi(int(width / (maxf(5.0, float(text.length())) * 0.62 * 0.008)), 70, 118)
		var l := _label(text, size, colour, n.global_position + Vector3(-side * 0.08, 0, 0), -side * PI / 2.0, 4.0)
		l.pixel_size = 0.008
		_sign_labels.append([n.global_position, l, width])
		if rng.randf() < 0.18:
			_signs_flicker.append(l)
		i += 1
	for n: Node3D in markers.get("vsign", []):
		var side := signf(n.scale.x)
		var word: String = UP[rng.randi() % UP.size()]
		var stacked := "\n".join(word.split(""))
		var colour: Color = NEON[rng.randi() % NEON.size()]
		# A blade sign standing out from the wall, read from down the street
		# either way.
		var l := _label(stacked, 110, colour, n.global_position, 0.0, 4.0)
		l.pixel_size = 0.006
		# Read from either way down the street: a face each side (one
		# two-sided label reads backwards from behind).
		var back := _label(stacked, 110, colour, n.global_position - Vector3(0, 0, 0.32), PI, 4.0)
		back.pixel_size = 0.006
		var box := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.9, 0.62 * word.length() + 0.4, 0.2)
		bm.material = Surfaces.get_material("signband")
		box.mesh = bm
		box.position = n.global_position + Vector3(0, -0.1, -0.16)
		add_child(box)
	for n: Node3D in markers.get("roofsign", []):
		var side := signf(n.scale.x)
		var colour: Color = NEON[rng.randi() % NEON.size()]
		var text: String = ROOF[rng.randi() % ROOF.size()]
		var l := _label(text, 300, colour, n.global_position + Vector3(0, 0.6, 0), -side * PI / 2.0, 3.6)
		l.pixel_size = 0.006
		var frame := MeshInstance3D.new()
		var fm := BoxMesh.new()
		fm.size = Vector3(0.15, 0.15, absf(n.scale.z))
		fm.material = Surfaces.get_material("metal_dark")
		frame.mesh = fm
		frame.position = n.global_position + Vector3(0, -0.9, 0)
		add_child(frame)
	for n: Node3D in markers.get("bridge", []):
		_label("HEARTH  ·  LOWDECK", 160, Color(0.18, 0.83, 1.0), n.global_position + Vector3(0, 0.0, 0.0), PI, 3.4)
		_label("HEARTH  ·  LOWDECK", 160, Color(0.18, 0.83, 1.0), n.global_position + Vector3(0, 0.0, 3.4), 0.0, 3.4)
	for n: Node3D in markers.get("checkpoint", []):
		_label("HEARTH SECURITY  ·  NO PASSAGE", 90, Color(1.0, 0.42, 0.17), n.global_position, 0.0 if n.global_position.z < 0.0 else PI, 3.0)
	# Paper lanterns strung under the cables.
	var lm := StandardMaterial3D.new()
	lm.albedo_color = Color(1.0, 0.35, 0.15)
	lm.emission_enabled = true
	lm.emission = Color(1.0, 0.4, 0.15)
	lm.emission_energy_multiplier = 3.0
	for n: Node3D in markers.get("lantern", []):
		for k in 5:
			var s := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = 0.28
			sm.height = 0.7
			sm.radial_segments = 10
			sm.rings = 6
			sm.material = lm
			s.mesh = sm
			s.position = n.global_position + Vector3(-4.0 + k * 2.0, sin(k * 1.3) * 0.3, 0)
			add_child(s)

## Give the shop sign nearest `near` new words and a colour (a place the
## story uses: the Ninth Orbit).
func rename_sign(near: Vector3, text: String, colour: Color) -> void:
	var best: Array = []
	for s in _sign_labels:
		if best.is_empty() or (s[0] as Vector3).distance_to(near) < (best[0] as Vector3).distance_to(near):
			best = s
	if best.is_empty():
		return
	var l: Label3D = best[1]
	l.text = text
	l.modulate = Color(colour.r * 4.0, colour.g * 4.0, colour.b * 4.0)
	l.outline_modulate = Color(colour.r * 0.6, colour.g * 0.6, colour.b * 0.6, 0.55)
	l.font_size = clampi(int(float(best[2]) / (float(text.length()) * 0.62 * 0.008)), 70, 118)
	_signs_flicker.erase(l)
	spots["bar"] = Vector3(best[0].x + signf(-best[0].x) * 1.6, 0.15, best[0].z)

# --- Light ------------------------------------------------------------------------

## Every light the street could have: lamps, shop interiors, sign glow.
func _lights() -> void:
	var wanted: Array = []
	for n: Node3D in markers.get("lamp", []):
		wanted.append([n.global_position, Color(0.82, 0.9, 1.0), 2.6, 12.0])
	for n: Node3D in markers.get("shoplight", []):
		wanted.append([n.global_position, Color(1.0, 0.78, 0.55), 1.6, 7.5])
	for n: Node3D in markers.get("alley", []):
		wanted.append([n.global_position, Color(1.0, 0.3, 0.55), 1.4, 8.0])
	for n: Node3D in markers.get("stall", []):
		wanted.append([n.global_position + Vector3(0, 2.4, 0), Color(1.0, 0.65, 0.35), 1.8, 7.0])
	if hq:
		for w in wanted:
			var l := OmniLight3D.new()
			l.light_color = w[1]
			l.light_energy = w[2]
			l.omni_range = w[3]
			l.position = w[0]
			add_child(l)
		return
	# The browser renderer pays per light per mesh drawn: six lights, moved
	# to whichever of these are nearest the player as they walk.
	_pool_at = wanted
	for i in 6:
		var l := OmniLight3D.new()
		l.omni_range = 9.0
		add_child(l)
		_pool.append(l)

func _process(dt: float) -> void:
	_t += dt
	var player := get_tree().get_first_node_in_group("player") as Node3D
	var at := player.global_position if player else Vector3.ZERO
	if not _pool.is_empty():
		_pool_t -= dt
		if _pool_t <= 0.0:
			_pool_t = 0.5
			var sorted := _pool_at.duplicate()
			sorted.sort_custom(func(a, b): return (a[0] as Vector3).distance_squared_to(at) < (b[0] as Vector3).distance_squared_to(at))
			for i in _pool.size():
				var w: Array = sorted[i]
				_pool[i].position = w[0]
				_pool[i].light_color = w[1]
				_pool[i].light_energy = w[2] * 1.2
				_pool[i].omni_range = w[3]
	for l: Label3D in _signs_flicker:
		var on := fmod(_t * (1.3 + l.get_instance_id() % 5 * 0.21), 4.0) > 0.25 or fmod(_t * 13.0, 1.0) > 0.5
		l.visible = on
	# Rain follows the eye.
	var cam := get_viewport().get_camera_3d()
	if cam:
		if _rain:
			_rain.global_position = cam.global_position + Vector3(0, 8, 0) - cam.global_basis.z * 6.0
		if _rain_cpu:
			_rain_cpu.global_position = cam.global_position + Vector3(0, 8, 0) - cam.global_basis.z * 5.0
	_move_traffic(dt)
	_move_drones(dt)

# --- Steam, seats, holograms ---------------------------------------------------------

func _steam() -> void:
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.vertex_color_use_as_albedo = true
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	var tex := GradientTexture2D.new()
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 0.55))
	g.set_color(1, Color(1, 1, 1, 0.0))
	tex.gradient = g
	mat.albedo_texture = tex
	var quad := QuadMesh.new()
	quad.size = Vector2(1.6, 1.6)
	quad.material = mat
	for n: Node3D in markers.get("steam", []):
		var p := CPUParticles3D.new()
		p.mesh = quad
		p.amount = 14 if hq else 8
		p.lifetime = 4.0
		p.direction = Vector3.UP
		p.spread = 12.0
		p.initial_velocity_min = 0.6
		p.initial_velocity_max = 1.2
		p.gravity = Vector3(0.15, 0.25, 0)
		p.scale_amount_min = 0.8
		p.scale_amount_max = 2.2
		var ramp := Gradient.new()
		ramp.set_color(0, Color(0.85, 0.85, 0.95, 0.0))
		ramp.add_point(0.2, Color(0.8, 0.8, 0.9, 0.35))
		ramp.set_color(ramp.get_point_count() - 1, Color(0.7, 0.7, 0.8, 0.0))
		p.color_ramp = ramp
		p.position = n.global_position
		add_child(p)

func _benches() -> void:
	for n: Node3D in markers.get("bench", []):
		for dz in [-0.45, 0.45]:
			var side := signf(n.global_position.x)
			var seat := Seat.make(n.global_position + Vector3(0, 0.3, dz), 90.0 * side, "Sit on the bench")
			add_child(seat)
			benches.append(seat)

## Two adverts: a giant hologram over the rooftops, and a turning sign over
## the food stalls.
func _holograms() -> void:
	var holo := ShaderMaterial.new()
	holo.shader = load("res://shaders/hologram.gdshader")
	holo.set_shader_parameter("tint", Color(0.25, 0.8, 1.0))
	var giant := Person.make("crowd2")
	giant.solid = false
	add_child(giant)
	giant.scale = Vector3.ONE * 9.0
	giant.position = Vector3(-26.0, 30.0, 6.0)
	giant.rotation.y = PI / 2.0 + 0.25
	for mi: MeshInstance3D in giant.find_children("*", "MeshInstance3D", true, false):
		mi.material_override = holo
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	giant.talk(true)
	var ad := _label("LUNAR COMPACT\nINSURE YOUR AIR", 260, Color(0.25, 0.8, 1.0), Vector3(-24.0, 22.0, 6.0), PI / 2.0, 2.6)
	ad.pixel_size = 0.008
	# The turning sign: a ring and a diamond in hologram light, and words.
	var pivot := Node3D.new()
	pivot.position = Vector3(6.0, 9.5, -2.0)
	add_child(pivot)
	var torus := TorusMesh.new()
	torus.inner_radius = 1.6
	torus.outer_radius = 1.75
	torus.material = holo
	var ring := MeshInstance3D.new()
	ring.mesh = torus
	ring.rotation_degrees = Vector3(90, 0, 0)
	pivot.add_child(ring)
	var dia := MeshInstance3D.new()
	var pm := PrismMesh.new()
	pm.size = Vector3(1.2, 1.6, 0.3)
	var holo2 := holo.duplicate() as ShaderMaterial
	holo2.set_shader_parameter("tint", Color(1.0, 0.42, 0.17))
	pm.material = holo2
	dia.mesh = pm
	pivot.add_child(dia)
	var words := _label("HARBOR LINES\nFLY THE LANES", 120, Color(1.0, 0.42, 0.17), Vector3(0, -2.3, 0), 0.0, 3.0)
	remove_child(words)
	pivot.add_child(words)
	words.position = Vector3(0, -2.3, 0)
	words.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	var spin := create_tween().set_loops()
	spin.tween_property(pivot, "rotation:y", TAU, 9.0).from(0.0)

# --- Traffic and drones -----------------------------------------------------------------

func _traffic() -> void:
	var body := BoxMesh.new()
	body.size = Vector3(1.8, 0.7, 4.2)
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.12, 0.12, 0.14)
	m.metallic = 0.7
	m.roughness = 0.3
	m.emission_enabled = true
	m.emission = Color(1.0, 0.25, 0.15)
	m.emission_energy_multiplier = 0.6
	body.material = m
	_cars = MultiMesh.new()
	_cars.transform_format = MultiMesh.TRANSFORM_3D
	_cars.mesh = body
	var lanes := [[-4.0, 16.0, 1.0], [4.0, 18.0, -1.0], [-9.0, 24.0, 1.0], [9.0, 27.0, -1.0], [0.0, 34.0, 1.0], [-18.0, 40.0, -1.0], [18.0, 46.0, 1.0]]
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	for lane in lanes:
		for k in (4 if hq else 3):
			_car_lanes.append([lane[0], lane[1], lane[2] * rng.randf_range(14.0, 26.0), rng.randf_range(-400.0, 400.0)])
	_cars.instance_count = _car_lanes.size()
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = _cars
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(mi)
	# Headlights: a dot of white at the front of each, as one more multimesh.
	var head := SphereMesh.new()
	head.radius = 0.25
	head.height = 0.5
	var hm := StandardMaterial3D.new()
	hm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	hm.albedo_color = Color(4.0, 3.8, 3.2)
	head.material = hm
	var hmm := MultiMesh.new()
	hmm.transform_format = MultiMesh.TRANSFORM_3D
	hmm.mesh = head
	hmm.instance_count = _car_lanes.size()
	var hi := MultiMeshInstance3D.new()
	hi.multimesh = hmm
	hi.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(hi)
	set_meta("heads", hmm)

func _move_traffic(dt: float) -> void:
	if not _cars:
		return
	var heads: MultiMesh = get_meta("heads")
	for i in _car_lanes.size():
		var c: Array = _car_lanes[i]
		c[3] += c[2] * dt
		var along: float = wrapf(c[3], -700.0, 700.0)
		var ang := along / RING_R
		var xf := ring_point(ang, c[0], c[1])
		if c[2] < 0.0:
			xf.basis = xf.basis.rotated(xf.basis.y, PI)
		_cars.set_instance_transform(i, xf)
		heads.set_instance_transform(i, xf.translated_local(Vector3(0, 0, -2.2)))

func _drones_make() -> void:
	for i in 3:
		var d := Node3D.new()
		var body := MeshInstance3D.new()
		var bm := SphereMesh.new()
		bm.radius = 0.45
		bm.height = 0.5
		bm.material = Surfaces.get_material("metal_dark")
		body.mesh = bm
		d.add_child(body)
		var blink := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.09
		sm.height = 0.18
		var bl := StandardMaterial3D.new()
		bl.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		bl.albedo_color = Color(4.0, 0.4, 0.3)
		sm.material = bl
		blink.mesh = sm
		blink.position = Vector3(0, 0.3, 0)
		d.add_child(blink)
		# The searchlight's cone, drawn as light in the rain.
		var cone := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.2
		cm.bottom_radius = 2.4
		cm.height = 9.0
		var cmat := StandardMaterial3D.new()
		cmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		cmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		cmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		cmat.albedo_color = Color(0.5, 0.65, 1.0, 0.07)
		cmat.cull_mode = BaseMaterial3D.CULL_DISABLED
		cm.material = cmat
		cone.mesh = cm
		cone.position = Vector3(0, -4.6, 0)
		cone.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		d.add_child(cone)
		if hq:
			var spot := SpotLight3D.new()
			spot.light_color = Color(0.7, 0.8, 1.0)
			spot.light_energy = 4.0
			spot.spot_range = 14.0
			spot.spot_angle = 16.0
			spot.rotation_degrees = Vector3(-90, 0, 0)
			d.add_child(spot)
		add_child(d)
		d.set_meta("phase", i * 2.1)
		d.set_meta("x", [-7.0, 7.0, 0.0][i])
		d.add_to_group("security_drone")
		_drones.append(d)

func _move_drones(_dt: float) -> void:
	for d: Node3D in _drones:
		var ph: float = d.get_meta("phase")
		var z := sin(_t * 0.05 + ph) * (STREET_HALF - 6.0)
		d.position = Vector3(float(d.get_meta("x")) + sin(_t * 0.4 + ph) * 2.0, 8.5 + sin(_t * 0.9 + ph) * 0.3, z)
		d.get_child(1).visible = fmod(_t + ph, 1.0) < 0.15

# --- Rain ----------------------------------------------------------------------------------

func _rain_make() -> void:
	var streak := QuadMesh.new()
	streak.size = Vector2(0.025, 0.7)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(0.6, 0.7, 0.9, 0.35)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	streak.material = m
	if hq:
		_rain = GPUParticles3D.new()
		var pm := ParticleProcessMaterial.new()
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
		pm.emission_box_extents = Vector3(14, 1, 14)
		pm.direction = Vector3(0.05, -1, 0)
		pm.spread = 2.0
		pm.initial_velocity_min = 14.0
		pm.initial_velocity_max = 18.0
		pm.gravity = Vector3(0, -6, 0)
		_rain.process_material = pm
		_rain.draw_pass_1 = streak
		_rain.amount = 2200
		_rain.lifetime = 1.1
		_rain.visibility_aabb = AABB(Vector3(-16, -24, -16), Vector3(32, 30, 32))
		_rain.local_coords = false
		add_child(_rain)
	else:
		_rain_cpu = CPUParticles3D.new()
		_rain_cpu.mesh = streak
		_rain_cpu.amount = 500
		_rain_cpu.lifetime = 1.0
		_rain_cpu.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		_rain_cpu.emission_box_extents = Vector3(10, 1, 10)
		_rain_cpu.direction = Vector3(0.05, -1, 0)
		_rain_cpu.spread = 2.0
		_rain_cpu.initial_velocity_min = 14.0
		_rain_cpu.initial_velocity_max = 18.0
		_rain_cpu.gravity = Vector3(0, -6, 0)
		_rain_cpu.local_coords = false
		add_child(_rain_cpu)

# --- Places --------------------------------------------------------------------------------

## Where the story's places are on the street.
func _spots() -> void:
	spots["lift"] = Vector3(5.5, 0.15, 52.0)
	spots["start"] = Vector3(2.5, 0.15, 48.0)
	spots["bar"] = Vector3(-9.6, 0.15, -6.0)
	spots["safehouse"] = Vector3(9.6, 0.15, -38.0)
	spots["terminal"] = Vector3(-8.2, 0.15, 24.0)
