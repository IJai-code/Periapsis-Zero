class_name MeteorStorm
extends Node3D
## Every morning from 8:00 to 10:30 the dying Lantern sheds stones onto
## Hearthstone: streaks across the sky, a flash and a boom where each comes
## down, the ground shaking under you, a crater of glowing rock left behind.
## Now and then one comes in close, with a whistle a couple of seconds
## before: get clear. Each leaves a starstone in its crater to take while
## it is warm (counted across every loop; the first is a line in the ship
## log). Lives on Hearthstone's Planet; only while it is the frame's body.

const FROM := 480.0
const TO := 630.0
## How long a crater glows, and how many are kept at once.
const COOL := 110.0
const KEEP := 8

var reach: Node
var body: ReachBody
var _rng := RandomNumberGenerator.new()
var _next := 3.0
var _warned := false
var _last_t := 0.0
var _warmed := false
## Falling: [head, streak, light, from, to, t, duration, close].
var _falling: Array = []
## Down: [root, glow material, usable or null, age].
var _craters: Array = []
static var _ember_mesh: SphereMesh
static var _ember_mat: StandardMaterial3D
static var _smoke_mat: StandardMaterial3D

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	_rng.randomize()
	if reach and reach.system:
		body = reach.system.bodies["hearthstone"]

func _process(dt: float) -> void:
	if reach == null or body == null:
		return
	var sys: ReachSystem = reach.system
	# A new morning: the sky is quiet again, the craters gone.
	if sys.t < _last_t - 5.0:
		_clear()
	_last_t = sys.t
	var on := sys.t > FROM and sys.t < TO and sys.ref == "hearthstone" and not reach.has_meta("backdrop")
	if on and not _warned:
		_warned = true
		if reach.hud:
			reach.hud.caption("Stones falling! The Lantern is shedding. Keep clear of the glow, and listen for the whistle.", 5.0)
			Sfx.play("whistle", -14.0, 0.7)
	if not on and sys.t < FROM:
		_warned = false
	# Twenty seconds before the first stone: everything a stone shows
	# (the head, its trail, a crater's glow, embers, smoke) drawn once,
	# tiny, in front of the eye, so its shaders are compiled before the
	# first one lands, not on it (a tenth of a second's stall in a browser).
	if not _warmed and sys.t > FROM - 20.0 and sys.t < FROM and sys.ref == "hearthstone":
		_warm()
	if on:
		_next -= dt
		if _next <= 0.0:
			_next = _rng.randf_range(1.8, 4.2)
			_spawn()
	_fall(dt)
	_age(dt)

func _focus() -> Node3D:
	var sys: ReachSystem = reach.system
	return sys.focus as Node3D if sys.focus and is_instance_valid(sys.focus) else null

## A stone on its way: aimed at a point some way from you (now and then
## close), coming in on a slant from high over the crater.
func _spawn() -> void:
	var f := _focus()
	if f == null:
		return
	var c := body.node.global_position
	var up := (f.global_position - c).normalized()
	var close := _rng.randf() < 0.22
	var dist := _rng.randf_range(7.0, 13.0) if close else _rng.randf_range(35.0, 260.0)
	var side := up.cross(Vector3.UP if absf(up.y) < 0.95 else Vector3.RIGHT).normalized().rotated(up, _rng.randf() * TAU)
	var aim := (f.global_position - c + side * dist).normalized()
	# Not onto the Kestrel: a stone through her hull would end the loop
	# for nothing anyone did.
	var ship: Node3D = reach.ship
	if ship and (c + aim * body.radius).distance_to(ship.global_position) < 18.0:
		aim = (aim + side * 0.12).normalized()
	var ground := c + aim * (body.radius + Worlds.height(body.key, aim, body.radius))
	var q := PhysicsRayQueryParameters3D.create(ground + aim * 120.0, ground - aim * 6.0, 1)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty():
		ground = hit.position
	var slant := aim.cross(side).normalized()
	var from := ground + aim * 650.0 + slant * 380.0
	var head := MeshInstance3D.new()
	var hm := SphereMesh.new()
	hm.radius = 1.4
	hm.height = 2.8
	head.mesh = hm
	var hot := StandardMaterial3D.new()
	hot.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	hot.albedo_color = Color(1.0, 0.92, 0.75)
	head.material_override = hot
	head.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(head)
	var streak := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.05
	cm.bottom_radius = 1.3
	cm.height = 70.0
	streak.mesh = cm
	var trail := StandardMaterial3D.new()
	trail.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	trail.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	trail.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	trail.albedo_color = Color(1.0, 0.55, 0.22, 0.55)
	streak.material_override = trail
	streak.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(streak)
	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.62, 0.32)
	light.light_energy = 4.0
	light.omni_range = 90.0
	light.shadow_enabled = false
	add_child(light)
	var dur := 3.2
	_falling.append([head, streak, light, from, ground, 0.0, dur, close])
	if close:
		Sfx.play("whistle", -3.0, 1.0)

func _fall(dt: float) -> void:
	for i in range(_falling.size() - 1, -1, -1):
		var m: Array = _falling[i]
		m[5] = float(m[5]) + dt
		var k := clampf(float(m[5]) / float(m[6]), 0.0, 1.0)
		var from: Vector3 = m[3]
		var to: Vector3 = m[4]
		# Speeding up as it comes down.
		var at := from.lerp(to, k * 0.75 + k * k * 0.25)
		var dir := (to - from).normalized()
		(m[0] as Node3D).global_position = at
		var st := m[1] as Node3D
		var y := -dir
		var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
		st.global_transform = Transform3D(Basis(x, y, x.cross(y)), at - dir * 35.0)
		(m[2] as Node3D).global_position = at
		if k >= 1.0:
			for n in [m[0], m[1], m[2]]:
				(n as Node).queue_free()
			_falling.remove_at(i)
			_impact(to, (to - body.node.global_position).normalized())

## Where it lands: a flash, a boom as loud as it is near, embers and smoke,
## the ground shaking, a crater of glowing rock with a starstone in it.
func _impact(at: Vector3, up: Vector3) -> void:
	var f := _focus()
	var d := f.global_position.distance_to(at) if f else 999.0
	Sfx.play("boom", clampf(-2.0 - d / 22.0, -30.0, 0.0), _rng.randf_range(0.8, 1.05))
	if d < 45.0:
		Sfx.play("big", clampf(-4.0 - d / 10.0, -24.0, 0.0), 1.1)
	var flash := OmniLight3D.new()
	flash.light_color = Color(1.0, 0.7, 0.4)
	flash.light_energy = 14.0
	flash.omni_range = 120.0
	flash.shadow_enabled = false
	add_child(flash)
	flash.global_position = at + up * 4.0
	var tw := flash.create_tween()
	tw.tween_property(flash, "light_energy", 0.0, 0.7)
	tw.tween_callback(flash.queue_free)
	_burst(at, up)
	# The crater: a scanned stone, glowing from inside, cooling.
	var root := Node3D.new()
	add_child(root)
	var x := up.cross(Vector3.UP if absf(up.y) < 0.95 else Vector3.RIGHT).normalized()
	root.global_transform = Transform3D(Basis(x, up, x.cross(up)).rotated(up, _rng.randf() * TAU), at - up * 0.6)
	var rock := MeshInstance3D.new()
	rock.mesh = KenneyKit.mesh("ph/ph-moon_rock_02", Color(0.42, 0.33, 0.28))
	rock.scale = Vector3.ONE * _rng.randf_range(8.0, 12.0)
	root.add_child(rock)
	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glow.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	glow.albedo_color = Color(1.0, 0.45, 0.12, 0.85)
	rock.material_overlay = glow
	var ember := OmniLight3D.new()
	ember.light_color = Color(1.0, 0.5, 0.2)
	ember.light_energy = 2.2
	ember.omni_range = 14.0
	ember.shadow_enabled = false
	ember.position = Vector3(0, 1.4, 0)
	root.add_child(ember)
	var take := Usable.box("Take the starstone", Vector3(1.6, 1.6, 1.6))
	take.position = Vector3(0, 0.9, 0)
	root.add_child(take)
	take.used.connect(func(_by): _take(root, take))
	_craters.append([root, glow, take, 0.0, ember])
	while _craters.size() > KEEP:
		var old: Array = _craters.pop_front()
		(old[0] as Node).queue_free()
	# What it does to you.
	var ex: Explorer = reach.player
	var ship: ReachShip = reach.ship
	if ship and ship.piloted:
		var ds := ship.global_position.distance_to(at)
		if ds < 60.0:
			ship._knock = maxf(ship._knock, 1.0 - ds / 60.0)
	elif ex and ex.enabled and is_instance_valid(ex):
		var de := ex.global_position.distance_to(at)
		if de < 140.0:
			ex.jolt(1.0 - de / 140.0)
		if de < 22.0:
			var away := ex.global_position - at
			away = (away - up * away.dot(up)).normalized()
			ex.velocity += away * (22.0 - de) * 0.55 + up * (22.0 - de) * 0.3
		if de < 6.5:
			ex.hurt(45.0, "meteor")

## Embers flung out and smoke rolling up.
func _burst(at: Vector3, up: Vector3) -> void:
	if _ember_mesh == null:
		_ember_mesh = SphereMesh.new()
		_ember_mesh.radius = 0.12
		_ember_mesh.height = 0.24
		_ember_mesh.radial_segments = 6
		_ember_mesh.rings = 3
		_ember_mat = StandardMaterial3D.new()
		_ember_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_ember_mat.albedo_color = Color(1.0, 0.6, 0.25)
		_smoke_mat = StandardMaterial3D.new()
		_smoke_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_smoke_mat.albedo_color = Color(0.22, 0.2, 0.19, 0.5)
		_smoke_mat.roughness = 1.0
	for spec in [[_ember_mat, 70, 1.8, 26.0, 1.0], [_smoke_mat, 26, 4.5, 6.0, 9.0]]:
		var p := CPUParticles3D.new()
		var mesh := _ember_mesh.duplicate() as SphereMesh
		mesh.material = spec[0]
		p.mesh = mesh
		p.amount = int(spec[1])
		p.lifetime = float(spec[2])
		p.one_shot = true
		p.explosiveness = 0.95
		p.direction = Vector3(0, 1, 0)
		p.spread = 65.0
		p.initial_velocity_min = float(spec[3]) * 0.4
		p.initial_velocity_max = float(spec[3])
		p.gravity = Vector3(0, -9.0 if spec[0] == _ember_mat else 1.2, 0)
		p.scale_amount_min = float(spec[4])
		p.scale_amount_max = float(spec[4]) * 2.2
		p.local_coords = false
		add_child(p)
		var x := up.cross(Vector3.UP if absf(up.y) < 0.95 else Vector3.RIGHT).normalized()
		p.global_transform = Transform3D(Basis(x, up, x.cross(up)), at + up * 0.8)
		p.emitting = true
		get_tree().create_timer(float(spec[2]) + 0.5).timeout.connect(p.queue_free)

func _take(root: Node3D, take: Usable) -> void:
	var n := int(Flow.progress("starstones", 0)) + 1
	Flow.set_progress("starstones", n)
	Sfx.play("objective", -6.0, 1.2)
	take.queue_free()
	for c: Array in _craters:
		if c[0] == root:
			c[2] = null
	if reach.hud:
		reach.hud.caption("A starstone, still warm. %d found in all." % n, 3.0)
		if Lore.learn("hearth_meteor"):
			reach.hud.toast("SHIP LOG UPDATED")

## Craters cool: the glow fades over a couple of minutes, then they go.
func _age(dt: float) -> void:
	for i in range(_craters.size() - 1, -1, -1):
		var c: Array = _craters[i]
		c[3] = float(c[3]) + dt
		var k := 1.0 - clampf(float(c[3]) / COOL, 0.0, 1.0)
		var flicker := 0.85 + 0.15 * sin(float(c[3]) * 3.1 + i)
		(c[1] as StandardMaterial3D).albedo_color.a = 0.85 * k * k * flicker
		(c[4] as OmniLight3D).light_energy = 2.2 * k * flicker
		if k <= 0.0:
			(c[0] as Node).queue_free()
			_craters.remove_at(i)

func _warm() -> void:
	_warmed = true
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var holder := Node3D.new()
	add_child(holder)
	holder.global_transform = cam.global_transform.translated_local(Vector3(0, 0, -2.0)).scaled_local(Vector3.ONE * 0.002)
	var head := MeshInstance3D.new()
	head.mesh = SphereMesh.new()
	var hot := StandardMaterial3D.new()
	hot.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	head.material_override = hot
	holder.add_child(head)
	var streak := MeshInstance3D.new()
	streak.mesh = CylinderMesh.new()
	var trail := StandardMaterial3D.new()
	trail.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	trail.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	trail.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	streak.material_override = trail
	holder.add_child(streak)
	var rock := MeshInstance3D.new()
	rock.mesh = KenneyKit.mesh("ph/ph-moon_rock_02", Color(0.42, 0.33, 0.28))
	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glow.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	rock.material_overlay = glow
	holder.add_child(rock)
	_burst(holder.global_position, cam.global_basis.y)
	get_tree().create_timer(0.5).timeout.connect(holder.queue_free)

func _clear() -> void:
	for m: Array in _falling:
		for n in [m[0], m[1], m[2]]:
			(n as Node).queue_free()
	_falling.clear()
	_warmed = false
	for c: Array in _craters:
		(c[0] as Node).queue_free()
	_craters.clear()
	_next = 3.0
