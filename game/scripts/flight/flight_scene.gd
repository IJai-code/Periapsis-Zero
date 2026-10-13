class_name FlightScene
extends Node3D
## What every flight chapter has: space lit by the Sun, the Kestrel with its
## guns and missiles, the overlay, the combat log wired to every hit, goal
## markers, and the warp drive. Missions extend this and write their beats.

var ship: PlayerShip
var hud: FlightHud
var bolts: Bolts
var missiles: Missiles
var overlay: CanvasLayer
var sun_light: DirectionalLight3D
var _goal_node: Node3D
var _ring: MeshInstance3D
var _tunnel: MeshInstance3D
var warping := false

## Build the common parts. Call first in `_ready`.
func setup_flight(sun: Vector3, exposure := 1.0, space := true, region := "harbor") -> void:
	if space:
		sun_light = Space.environment(self, sun, exposure, region)
	bolts = Bolts.new()
	add_child(bolts)
	missiles = Missiles.new()
	add_child(missiles)
	ship = PlayerShip.new()
	ship.bolts = bolts
	ship.missiles = missiles
	add_child(ship)
	overlay = CanvasLayer.new()
	overlay.layer = 5
	add_child(overlay)
	hud = FlightHud.new()
	hud.ship = ship
	hud.missiles = missiles
	overlay.add_child(hud)
	Hud.flight_layout(true)
	_goal_node = Node3D.new()
	add_child(_goal_node)
	_ring = _make_ring()
	add_child(_ring)
	_ring.visible = false
	bolts.struck.connect(_on_struck.bind("gun"))
	missiles.struck.connect(_on_struck.bind("missile"))
	missiles.launched.connect(func(team, target):
		if team == "hollow" and target == ship:
			hud.log_line("Missile launch detected", Style.EMBER))
	ship.damaged.connect(func(_a):
		ship.shake = maxf(ship.shake, 0.5))
	_warm_effects.call_deferred()
	ship.lock_changed.connect(func(t):
		if t:
			hud.log_line("Locked  %s" % t.display_name, Style.EMBER))

func _on_struck(team: String, target: Node3D, damage: float, layer: String, kind: String) -> void:
	if team == "player":
		hud.outgoing(target, damage, layer, kind)
		Sfx.play("hit", -14.0, 1.6 if layer == "shield" else 1.2)
	elif target == ship:
		hud.incoming("Hollow missile" if kind == "missile" else "Hollow guns", damage, layer, ship.last_from)

func _process(_dt: float) -> void:
	if _ring.visible and ship:
		_ring.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
		_ring.global_position = _goal_node.global_position
		_ring.look_at(ship.camera.global_position)
		_ring.rotate_object_local(Vector3.RIGHT, PI / 2)

func _make_ring() -> MeshInstance3D:
	var t := TorusMesh.new()
	t.inner_radius = 9.0
	t.outer_radius = 10.0
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(Style.ION.r * 2.0, Style.ION.g * 2.0, Style.ION.b * 2.0, 0.6)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	t.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = t
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

## Change which part of space surrounds the ship (after a warp).
func set_sky(region: String) -> void:
	for we in find_children("*", "WorldEnvironment", true, false):
		var env: Environment = (we as WorldEnvironment).environment
		if env and env.sky:
			env.sky.sky_material = Space.sky_material(region)

func set_goal(at: Vector3, label: String, ring := true) -> void:
	_goal_node.global_position = at
	hud.goal = _goal_node
	hud.goal_label = label
	_ring.visible = ring

func clear_goal() -> void:
	hud.goal = null
	_ring.visible = false

func wait(seconds: float) -> void:
	await get_tree().create_timer(seconds).timeout

func spawn_raider(at: Vector3, target: Hull, gunship := false, avoid: Array = [], rookie := false) -> Raider:
	var r := Raider.new()
	r.rookie = rookie
	r.bolts = bolts
	r.missiles = missiles
	r.gunship = gunship
	r.target = target
	r.avoid = avoid
	add_child(r)
	r.global_position = at
	r.look_at(target.global_position)
	return r

func _warm_effects() -> void:
	await get_tree().process_frame
	if is_instance_valid(ship) and ship.camera:
		Fx.warm(self, ship.camera.global_position - ship.camera.global_basis.z * 120.0)

var _streak := 0
var _streak_t := -99.0

## Blow up a raider that has died: the blast, the hit-stop, the
## confirmation, and a callout when kills come close together.
func raider_destroyed(r: Raider) -> void:
	r.destroy(16.0 if r.gunship else 11.0, 32.0)
	r.get_tree().create_timer(0.1).timeout.connect(r.queue_free)
	ship.shake = maxf(ship.shake, 0.55)
	hud.kill()
	hud.log_line("%s destroyed" % r.display_name, Style.EMBER)
	var now := Time.get_ticks_msec() / 1000.0
	_streak = _streak + 1 if now - _streak_t < 5.0 else 1
	_streak_t = now
	hud.pop(["", "+250  SPLASH ONE", "+500  DOUBLE KILL", "+800  TRIPLE KILL", "+1200  ACE"][mini(_streak, 4)] if _streak > 1 else "+250  SPLASH ONE", Style.EMBER)
	Fx.hitstop(get_tree(), 0.09 if _streak < 2 else 0.14, 0.12)

# --- The warp drive -----------------------------------------------------------

## Align to `dir`, warp, and come out. `arrive` is called at the middle of
## the jump, hidden by the tunnel: the scene moves the world there. Awaitable.
func warp(dir: Vector3, seconds: float, arrive: Callable, label := "") -> void:
	warping = true
	dir = dir.normalized()
	ship.controls = false
	ship.weapons = false
	ship.aim = dir
	ship.cruise = PlayerShip.MAX
	hud.log_line("Aligning%s" % ("  to  " + label if label != "" else ""), Style.ION)
	Hud.objective_extra("Aligning")
	var t := 0.0
	while (ship.global_basis.z * -1.0).angle_to(dir) > 0.04 or ship.velocity.length() < PlayerShip.MAX * 0.7:
		ship.aim = dir
		await get_tree().physics_frame
		t += get_physics_process_delta_time()
		if t > 8.0:
			break
	hud.log_line("Warp drive active", Style.ION)
	Hud.objective_extra("Warp drive active")
	Sfx.play("warp", -2.0)
	if not _tunnel:
		var c := CylinderMesh.new()
		c.top_radius = 26.0
		c.bottom_radius = 26.0
		c.height = 900.0
		c.radial_segments = 48
		c.rings = 1
		c.cap_top = false
		c.cap_bottom = false
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/warp_tunnel.gdshader")
		c.material = m
		_tunnel = MeshInstance3D.new()
		_tunnel.mesh = c
		_tunnel.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_tunnel.top_level = true
		add_child(_tunnel)
	var tm := (_tunnel.mesh as CylinderMesh).material as ShaderMaterial
	_tunnel.visible = true
	_tunnel.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	ship.set_physics_process(false)
	var go := create_tween()
	go.tween_method(func(k: float):
		tm.set_shader_parameter("strength", k)
		ship.camera.fov = lerpf(68.0, 104.0, k)
		ship.velocity = dir * lerpf(PlayerShip.MAX, 4000.0, k), 0.0, 1.0, 1.4).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	var stay := 0.0
	var swapped := false
	while stay < seconds:
		_tunnel.global_transform = Transform3D(Basis.looking_at(dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT) * Basis(Vector3.RIGHT, PI / 2), ship.global_position)
		ship.shake = maxf(ship.shake, 0.25)
		if not swapped and stay > seconds * 0.5:
			swapped = true
			arrive.call()
			dir = -ship.global_basis.z
		await get_tree().process_frame
		stay += get_process_delta_time()
	Sfx.play("warp_out", -2.0)
	var out := create_tween()
	out.tween_method(func(k: float):
		tm.set_shader_parameter("strength", 1.0 - k)
		ship.camera.fov = lerpf(104.0, 68.0, k)
		ship.velocity = dir * lerpf(4000.0, 40.0, k), 0.0, 1.0, 1.2).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	await out.finished
	_tunnel.visible = false
	ship.cruise = 40.0
	ship.aim = -ship.global_basis.z
	ship.set_physics_process(true)
	ship.controls = true
	ship.weapons = true
	ship.shake = 0.6
	Hud.objective_extra("")
	warping = false
