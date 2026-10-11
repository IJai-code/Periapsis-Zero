class_name HearthConcourse
extends Node3D
## Hearth's concourse (art/godot/hearth_concourse.py): the station's main
## street, a wall of window onto Earth, shops on two levels, people about.
## Runs along -Z from the medical bay door (z = 0) to the docking bay door
## (z = -44). Benches face the window and can be sat on.

const SUN_DIR := Vector3(0.55, 0.45, -0.7)
const D := 44.0
var benches: Array = []

func _ready() -> void:
	var hq := Flow.high_quality()
	var room: Node3D = load("res://art/hearth_concourse.glb").instantiate()
	add_child(room)
	Surfaces.apply(room)
	Surfaces.collide(room)
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://shaders/space_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.7, 0.72, 0.78)
	env.ambient_light_energy = 0.22 if hq else 0.45
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.2
	env.glow_enabled = true
	env.glow_intensity = 0.5
	if hq:
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.ssao_enabled = true
		env.ssil_enabled = true
		env.ssr_enabled = true
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 3.0
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 70.0
	add_child(sun)
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)
	for z in kit_range(-4.0, -40.0, -8.0):
		var s := OmniLight3D.new()
		s.position = Vector3(0.0, 7.0, z)
		s.omni_range = 9.0
		s.light_energy = 1.5
		s.light_color = Color(1.0, 0.92, 0.82)
		s.shadow_enabled = hq and int(z) % 16 == 0
		add_child(s)
		var shop := OmniLight3D.new()
		shop.position = Vector3(7.5, 2.2, z + 0.4)
		shop.omni_range = 5.0
		shop.light_energy = 1.2
		shop.light_color = Color(1.0, 0.72, 0.45)
		add_child(shop)
	# Earth fills the window, Hearth being well out toward L1.
	add_child(Earth.toward(Vector3(-1.0, -0.3, -0.9), 9_000_000.0, SUN_DIR, 0.003))
	_signs()
	for z in kit_range(-6.0, -38.0, -8.0):
		for dz in [-0.6, 0.6]:
			var seat := Seat.make(Vector3(-3.3, 0.5, z + dz), 90.0, "Sit on the bench")
			add_child(seat)
			benches.append(seat)

func _signs() -> void:
	var names := ["NOODLE BAR", "PARTS & SALVAGE", "LUNAR COMPACT", "HEARTH MEDICAL", "THE LAST ORBIT", "SUITS & SEALS"]
	var i := 0
	for z in kit_range(-3.4, -38.0, -6.5):
		if i >= names.size():
			break
		var l := Label3D.new()
		l.text = names[i]
		l.font = Style.sans_bold
		l.pixel_size = 0.004
		l.font_size = 96
		l.modulate = Color(1.0, 0.85, 0.7)
		l.position = Vector3(5.97, 3.6, z)
		l.rotation_degrees = Vector3(0, -90, 0)
		add_child(l)
		i += 1
	var board := Label3D.new()
	board.text = "HEARTH  ·  EARTH-MOON L1\nDEPARTURES   HARBOR 14:20   GATEWAY 15:05   DRIFT  —"
	board.font = Style.mono_bold
	board.pixel_size = 0.0025
	board.font_size = 64
	board.modulate = Surfaces.ION
	board.position = Vector3(-0.12, 6.6, -22.0)
	board.rotation_degrees = Vector3(0, -90, 0)
	add_child(board)

static func kit_range(a: float, b: float, step: float) -> Array:
	var out := []
	var x := a
	while (step < 0.0 and x >= b) or (step > 0.0 and x <= b):
		out.append(x)
		x += step
	return out
