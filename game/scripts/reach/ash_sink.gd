class_name AshSink
extends Node3D
## A pit of loose ash on Ashfall that pulls a walker down (Explorer.sunk):
## slowly while you keep moving, fast if you stand still. Jumping wrenches
## you up a little. Under to the chin, you are gone ("ash"). Seen as a slow
## dark spiral with an ember at its heart (in the ground's own shader) and dust lifting off it; heard as
## a low grinding hiss close to.

static var _all: Array[AshSink] = []

var radius := 6.0

## How far into a pit a point is: 0 outside, 1 at the heart.
static func pull(p: Vector3) -> float:
	var k := 0.0
	for s in _all:
		if is_instance_valid(s) and s.is_inside_tree() and s.is_visible_in_tree():
			var d := p.distance_to(s.global_position)
			if d < s.radius:
				k = maxf(k, 1.0 - d / s.radius)
	return k

func _enter_tree() -> void:
	_all.append(self)

func _exit_tree() -> void:
	_all.erase(self)

func _ready() -> void:
	# The pit itself is drawn into the ground (planet.gdshader, Planet.set_pits).
	var dust := CPUParticles3D.new()
	dust.amount = 18
	dust.lifetime = 4.0
	dust.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	dust.emission_sphere_radius = radius * 0.8
	dust.direction = Vector3.UP
	dust.spread = 25.0
	dust.gravity = Vector3(0, 0.15, 0)
	dust.initial_velocity_min = 0.2
	dust.initial_velocity_max = 0.6
	dust.scale_amount_min = 0.6
	dust.scale_amount_max = 1.4
	var dq := QuadMesh.new()
	dq.size = Vector2(0.9, 0.9)
	var dm := StandardMaterial3D.new()
	dm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	dm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	dm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	dm.albedo_color = Color(0.25, 0.22, 0.2, 0.18)
	dq.material = dm
	dust.mesh = dq
	dust.local_coords = true
	dust.visibility_aabb = AABB(Vector3(-radius, -1, -radius), Vector3(radius * 2, 6, radius * 2))
	add_child(dust)
	var hiss := AudioStreamPlayer3D.new()
	hiss.stream = Explorer._air_stream(false)
	hiss.pitch_scale = 0.45
	hiss.unit_size = radius * 0.6
	hiss.max_distance = radius * 4.0
	hiss.volume_db = -6.0
	hiss.autoplay = true
	add_child(hiss)
