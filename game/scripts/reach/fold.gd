class_name Fold
extends Node3D
## The Fold, where the Reach opens onto the rest of the sky: a nebula at
## the system's edge, beyond the Wanderer's farthest swing, that ships come
## through. Seen from every world's night side as a glowing cloud; flown
## into, it parts round the Kestrel in sheets of teal, rose and gold.
## Hangs off the Lantern's node (fixed among the stars, not orbiting).

const AT := Vector3(11800.0, 2600.0, -9400.0)
const RADIUS := 1700.0
const CLOUDS := 34

var _mm: MultiMeshInstance3D

func _ready() -> void:
	position = AT
	var noise := FastNoiseLite.new()
	noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	noise.fractal_type = FastNoiseLite.FRACTAL_FBM
	noise.fractal_octaves = 5
	noise.frequency = 0.012
	var tex := NoiseTexture2D.new()
	tex.width = 256
	tex.height = 256
	tex.seamless = true
	tex.noise = noise
	tex.generate_mipmaps = true
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/reach/fold.gdshader")
	mat.set_shader_parameter("noise_tex", tex)
	var q := QuadMesh.new()
	q.size = Vector2(2.0, 2.0)
	q.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = q
	mm.instance_count = CLOUDS
	var rng := RandomNumberGenerator.new()
	rng.seed = 1702
	for i in CLOUDS:
		# Crowded toward the middle, flattened a little: a lens of cloud.
		var d := Vector3(rng.randfn(), rng.randfn() * 0.55, rng.randfn()).normalized()
		var r := RADIUS * pow(rng.randf(), 0.7)
		var s := rng.randf_range(420.0, 1300.0) * (1.25 - r / RADIUS * 0.5)
		mm.set_instance_transform(i, Transform3D(Basis().scaled(Vector3.ONE * s), d * r * Vector3(1.0, 0.6, 1.0)))
		mm.set_instance_custom_data(i, Color(rng.randf(), rng.randf(), rng.randf_range(0.3, 1.0), rng.randf()))
	_mm = MultiMeshInstance3D.new()
	_mm.multimesh = mm
	_mm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_mm.extra_cull_margin = RADIUS * 2.0
	add_child(_mm)

## How deep inside the camera (world point) is: 0 outside, 1 at the heart.
func depth(at: Vector3) -> float:
	var d := (at - global_position) / Vector3(1.0, 0.6, 1.0)
	return clampf(1.0 - d.length() / RADIUS, 0.0, 1.0)
