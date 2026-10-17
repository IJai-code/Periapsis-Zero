class_name HollowDrone
extends Node3D
## One of Rook's drones over the Aster's wreck: it flies a loop, its
## searchlight sweeping the ground ahead. Caught in the light (in its cone,
## nothing between), it stops, turns red, and after a moment fires until
## you are out of sight again. Only someone on foot is hunted.

const RANGE := 26.0
const CONE := 0.36          # half angle, radians
const SPOT_TIME := 0.8      # seconds in the light before it fires
const SHOT_EVERY := 0.75
const DAMAGE := 24.0

var reach: Node
var path_center: Transform3D  # a ground frame on Ashfall
var path_radius := 14.0
var path_height := 9.0
var speed := 0.32               # radians per second round the loop
var phase := 0.0
var _model: Node3D
var _light: SpotLight3D
var _cone: MeshInstance3D
var _cone_mat: StandardMaterial3D
var _seen := 0.0
var _lost := 0.0
var _shot := 0.0
var _alert := false
var _hum: AudioStreamPlayer3D

func _ready() -> void:
	_model = load("res://art/site-drone.glb").instantiate()
	Surfaces.apply(_model)
	add_child(_model)
	_light = SpotLight3D.new()
	_light.spot_range = RANGE + 4.0
	_light.spot_angle = rad_to_deg(CONE) + 3.0
	_light.light_energy = 6.0
	_light.light_color = Color(1.0, 0.92, 0.75)
	_light.shadow_enabled = false
	# A spot shines down its -Z; the drone's lamp looks along its +Z.
	_light.rotation = Vector3(0, PI, 0)
	_light.position = Vector3(0, 0, 0.9)
	_model.add_child(_light)
	_cone = MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = 0.2
	c.bottom_radius = tan(CONE) * RANGE
	c.height = RANGE
	c.radial_segments = 20
	c.cap_top = false
	c.cap_bottom = false
	_cone_mat = StandardMaterial3D.new()
	_cone_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_cone_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_cone_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_cone_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_cone_mat.albedo_color = Color(1.0, 0.85, 0.6, 0.07)
	_cone_mat.no_depth_test = false
	c.material = _cone_mat
	_cone.mesh = c
	_cone.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Along +Z, its narrow end at the lamp.
	_cone.transform = Transform3D(Basis(Vector3.RIGHT, -PI / 2.0), Vector3(0, 0, 0.9 + RANGE / 2.0))
	_model.add_child(_cone)
	_hum = AudioStreamPlayer3D.new()
	_hum.stream = ReachSounds.drone_hum()
	_hum.unit_size = 5.0
	_hum.max_distance = 45.0
	_hum.volume_db = -10.0
	_hum.autoplay = true
	add_child(_hum)
	_place(0.0)

## Back to its loop (a new morning).
func reset() -> void:
	_seen = 0.0
	_lost = 0.0
	_alert = false
	_place(0.0)

func _place(dt: float) -> void:
	phase += speed * dt
	var up := path_center.basis.y
	var a := phase
	var east := path_center.basis.x
	var south := path_center.basis.z
	var out := (east * cos(a) + south * sin(a)).normalized()
	var at := path_center.origin + out * path_radius + up * (path_height + sin(phase * 2.3) * 0.8)
	var ahead := (-east * sin(a) + south * cos(a)).normalized() * signf(speed)
	# Lamp ahead, in toward the middle and down: the spot sweeps a ring
	# inside the drone's loop, across every way in.
	var look := (ahead * 0.45 - out * 0.55 - up * 0.75).normalized()
	position = at
	if not _alert:
		# Its +Z (the lamp) along `look`.
		_model.basis = Basis.looking_at(-look, up)

func _physics_process(dt: float) -> void:
	if not reach or not reach.player:
		return
	var p: Explorer = reach.player
	var on_foot: bool = p.enabled and not (reach.ship as ReachShip).piloted
	var seen := false
	if on_foot and not p._dead:
		var lamp := _model.global_position + _model.global_basis.z * 0.9
		var chest := p.global_position + p.global_basis.y * 1.2
		var to := chest - lamp
		var d := to.length()
		var ahead := _model.global_basis.z
		if d < RANGE and ahead.dot(to / d) > cos(CONE):
			var q := PhysicsRayQueryParameters3D.create(lamp, chest, 1)
			q.exclude = [p.get_rid()]
			seen = get_world_3d().direct_space_state.intersect_ray(q).is_empty()
	if seen:
		_seen += dt
		_lost = 0.0
	else:
		_lost += dt
		_seen = maxf(0.0, _seen - dt * 0.5)
	if not _alert and _seen > SPOT_TIME:
		_alert = true
		_shot = 0.3
		Sfx.play("alarm", -10.0, 1.3)
		if reach.hud:
			reach.hud.caption("A drone has you in its light.", 2.0)
	if _alert:
		var chest := p.global_position + p.global_basis.y * 1.2
		var want := (chest - _model.global_position).normalized()
		_model.global_basis = _model.global_basis.slerp(Basis.looking_at(-want, path_center.basis.y), minf(1.0, dt * 5.0))
		_shot -= dt
		if seen and _shot <= 0.0:
			_shot = SHOT_EVERY
			_fire(chest)
		if _lost > 2.5:
			_alert = false
	else:
		_place(dt)
	var red := 1.0 if _alert else clampf(_seen / SPOT_TIME, 0.0, 1.0)
	_light.light_color = Color(1.0, 0.92, 0.75).lerp(Color(1.0, 0.2, 0.1), red)
	_cone_mat.albedo_color = Color(Color(1.0, 0.85, 0.6).lerp(Color(1.0, 0.2, 0.1), red), 0.07 + red * 0.05)

func _fire(at: Vector3) -> void:
	Sfx.play("laser", -6.0, 0.8)
	var bolt := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.09
	s.height = 0.18
	bolt.mesh = s
	bolt.material_override = Surfaces.get_material("glow_hollow")
	add_child(bolt)
	var from := _model.global_position + _model.global_basis.z * 1.0
	bolt.global_position = from
	var t := create_tween()
	t.tween_property(bolt, "global_position", at, from.distance_to(at) / 60.0)
	t.tween_callback(func():
		bolt.queue_free()
		var p: Explorer = reach.player
		if p.global_position.distance_to(at) < 2.5 and not p._dead:
			p.hurt(DAMAGE, "drones"))
