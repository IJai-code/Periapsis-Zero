class_name AsterHangar
extends Node3D
## The Aster's flight deck (art/godot/aster_hangar.py): a tall ribbed bay,
## the Kestrel on her cradle mid-floor, outer doors open on space and Earth
## at the far end. Runs along -Z from the bridge door (z = 0) to the opening
## (z = -34). `kestrel` is the parked ship, for the launch.

const SUN_DIR := Vector3(0.4, 0.55, -0.73)
var kestrel: Node3D
## The Kestrel's boarding ladder (add_ladder): its own node, so it can
## retract into the hull before she lifts.
var ladder: Node3D
var ladder_foot := Vector3.ZERO
var ladder_top := Vector3.ZERO

## A boarding ladder leaning on the ship, its foot at `foot`.
func add_ladder(foot: Vector3) -> void:
	var m := Surfaces.get_material("paint_ember")
	var top := foot + Vector3(1.2, 3.0, 0.0)
	ladder_foot = foot
	ladder_top = top
	ladder = Node3D.new()
	ladder.name = "Ladder"
	add_child(ladder)
	for dz in [-0.28, 0.28]:
		var rail := MeshInstance3D.new()
		var c := CylinderMesh.new()
		c.top_radius = 0.03
		c.bottom_radius = 0.03
		c.height = (top - foot).length()
		c.material = m
		rail.mesh = c
		ladder.add_child(rail)
		rail.position = (foot + top) / 2.0 + Vector3(0, 0, dz)
		rail.basis = Basis(Vector3.BACK, -atan2(top.x - foot.x, top.y - foot.y))
	for k in range(1, 10):
		var t := k / 10.0
		var rung := MeshInstance3D.new()
		var r := CylinderMesh.new()
		r.top_radius = 0.02
		r.bottom_radius = 0.02
		r.height = 0.56
		r.material = Surfaces.get_material("metal")
		rung.mesh = r
		ladder.add_child(rung)
		rung.position = foot.lerp(top, t)
		rung.rotation_degrees = Vector3(90, 0, 0)

## The pilot climbs aboard by themselves: up to the foot of the ladder,
## hand over hand up it, over the sill and down into the seat. Awaitable;
## the pilot is hidden in the cockpit at the end.
func climb_aboard(player: Player) -> void:
	player.enabled = false
	player.set_physics_process(false)
	player.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	player.velocity = Vector3.ZERO
	var axis := (ladder_top - ladder_foot).normalized()
	var face := Vector3(axis.x, 0.0, axis.z).normalized()
	# Stand at the foot, facing the ship.
	var start := ladder_foot - face * 0.3
	var t := create_tween()
	t.tween_property(player, "global_position", start, maxf(0.25, player.global_position.distance_to(start) / 1.4))
	player.body.rotation.y = atan2(face.x, face.z)
	player.body.locomote(1.4)
	await t.finished
	player.body.climb(true)
	Sfx.play("step", -12.0, 0.7)
	# Up the rungs: the feet ride the ladder's lean.
	var top := ladder_top - face * 0.3 - axis * 0.9
	t = create_tween()
	t.tween_property(player, "global_position", top, 3.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	var clank := func():
		for i in 6:
			await get_tree().create_timer(0.55).timeout
			Sfx.play("step", -14.0, 1.25)
	clank.call()
	await t.finished
	# Over the sill and down into the seat.
	player.body.climb(false)
	var seat := ladder_top + face * 1.25 + Vector3(0, 0.15, 0)
	t = create_tween()
	t.tween_property(player, "global_position", seat + Vector3(0, 0.55, 0), 0.7).set_trans(Tween.TRANS_SINE)
	t.tween_property(player, "global_position", seat - Vector3(0, 0.5, 0), 0.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
	await t.finished
	player.body.visible = false
	Sfx.play("door", -10.0, 0.6)

## Before lift-off the ladder slides up into the hull and stays with her.
func retract_ladder() -> void:
	if not ladder:
		return
	var xf := ladder.global_transform
	remove_child(ladder)
	kestrel.add_child(ladder)
	ladder.global_transform = xf
	var axis := kestrel.global_basis.inverse() * (ladder_top - ladder_foot).normalized()
	var t := create_tween()
	t.tween_property(ladder, "position", ladder.position + axis * 2.9, 1.1).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN)
	Sfx.play("door", -8.0, 0.8)
	await t.finished
	ladder.visible = false

func _ready() -> void:
	var hq := Flow.high_quality()
	var bay: Node3D = load("res://art/aster_hangar.glb").instantiate()
	add_child(bay)
	Surfaces.apply(bay)
	Surfaces.collide(bay)
	kestrel = Hull.model("kestrel")
	add_child(kestrel)
	# High enough on the cradle to walk under the wings.
	kestrel.position = Vector3(0.0, 2.45, -14.0)
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := Space.sky_material("harbor")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.6, 0.7)
	env.ambient_light_energy = 0.18 if hq else 0.6
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.25
	env.glow_enabled = true
	env.glow_intensity = 0.55
	if hq:
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.ssao_enabled = true
		env.ssil_enabled = true
		env.ssr_enabled = true
		env.volumetric_fog_enabled = true
		env.volumetric_fog_density = 0.0
		var fv := FogVolume.new()
		fv.size = Vector3(17.0, 9.5, 33.0)
		fv.position = Vector3(0.0, 4.8, -16.5)
		var fm := FogMaterial.new()
		fm.density = 0.02
		fm.edge_fade = 0.2
		fv.material = fm
		add_child(fv)
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 4.0
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 80.0
	sun.light_volumetric_fog_energy = 2.5
	add_child(sun)
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)
	for z in [-6.0, -14.0, -22.0, -30.0]:
		var s := SpotLight3D.new()
		s.position = Vector3(0.0, 9.6, z)
		s.rotation_degrees = Vector3(-90, 0, 0)
		s.spot_angle = 55.0
		s.spot_range = 13.0
		s.light_energy = 6.0 if hq else 9.0
		s.light_color = Color(1.0, 0.9, 0.78)
		s.shadow_enabled = hq or z == -14.0
		add_child(s)
	add_child(Earth.toward(Vector3(0.0, -0.55, -1.0), 2_500_000.0, SUN_DIR, 0.003))
