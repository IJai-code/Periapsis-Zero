class_name AshfallSite
extends Site
## Ashfall: the Aster's wreck in its crater. The hull lies broken across
## the crater floor; her bridge section came down beyond it, torn off aft,
## and Hale's recorder still runs on the captain's chair. The cargo vault
## lies on the other side, sealed (code 0412, Hale's log), the Choir core
## in its cradle. Vex camps on the crater's rim. Two of Rook's drones fly
## loops over the wreck, searchlights sweeping.

var _vault: Node3D
var _door: Node3D
var _door_shut: Vector3
var _keypad: Usable
var _core: Node3D
var _core_use: Usable
var drones: Array[HollowDrone] = []
var recorder_at := Vector3.ZERO
## The bridge room's transform (site space).
var bridge_xf: Transform3D
var _fires: Array[OmniLight3D] = []
var _t := 0.0
var reach: Node

static func make(b: ReachBody) -> AshfallSite:
	var a := AshfallSite.new(b, "wreck")
	a.name = "Ashfall"
	return a

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	center = Worlds.place(body, "wreck")
	var vault_mark := Worlds.place(body, "vault")
	var to_vault := vault_mark.origin - center.origin
	to_vault -= center.basis.y * to_vault.dot(center.basis.y)
	var away := -to_vault.normalized()
	var along := center.basis.y.cross(away).normalized()
	_hull(away, along)
	_bridge(away, along)
	_vault_at(vault_mark)
	_vex()
	_debris(away, along)
	_drones(vault_mark)

## A ground frame `east`, `north` metres off the wreck's centre along two
## directions in the tangent plane.
func _off(a: Vector3, da: float, b: Vector3, db: float) -> Transform3D:
	var p := center.origin + a * da + b * db
	var d := p.normalized()
	return Transform3D(Site.upright(d, b), d * (body.radius + Worlds.height(body.key, d, body.radius)))

func _hull(away: Vector3, along: Vector3) -> void:
	var g := _off(away, 9.0, along, 0.0)
	# Her keel 1.5 m into the ground (her origin is 3.6 m above it at this
	# scale), rolled onto her side a little.
	var hull := piece("ship-freighter3", Transform3D(Site.upright(g.basis.y, along), g.origin), true, 0.42, -2.1)
	hull.rotate_object_local(Vector3.FORWARD, 0.24)
	hull.rotate_object_local(Vector3.RIGHT, -0.05)
	# Her lights are out.
	for mi: MeshInstance3D in hull.find_children("*", "MeshInstance3D", true, false):
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i)
			if src and src.resource_name in ["window_glow", "glow_engine", "nav_white"]:
				mi.set_surface_override_material(i, Surfaces.get_material("seam"))
	# Smoke, and still burning here and there (placed in her space, which
	# is scaled, so put on the site).
	var up := g.basis.y
	_smoke(self, hull.transform * Vector3(0, 4.0, 12.0))
	_smoke(self, hull.transform * Vector3(-3.0, 3.0, -20.0))
	for at in [Vector3(2.0, 6.5, 10.0), Vector3(-4.0, 3.5, -18.0), Vector3(6.0, 1.0, 26.0)]:
		_fire(hull.transform * at, up)

func _fire(at: Vector3, up: Vector3) -> void:
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.55, 0.22)
	l.light_energy = 2.2
	l.omni_range = 9.0
	l.position = at + up * 1.0
	add_child(l)
	_fires.append(l)
	var p := CPUParticles3D.new()
	p.amount = 22
	p.lifetime = 0.9
	p.transform = Transform3D(Site.upright(up, up.cross(Vector3.RIGHT) if absf(up.x) < 0.9 else up.cross(Vector3.UP)), at)
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.9
	p.direction = Vector3.UP
	p.spread = 12.0
	p.gravity = Vector3(0, 2.0, 0)
	p.initial_velocity_min = 0.8
	p.initial_velocity_max = 1.8
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.1
	var q := QuadMesh.new()
	q.size = Vector2(1.0, 1.4)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	q.material = m
	p.mesh = q
	var ramp := Gradient.new()
	ramp.set_color(0, Color(1.0, 0.85, 0.4, 0.9))
	ramp.add_point(0.4, Color(1.0, 0.45, 0.12, 0.7))
	ramp.set_color(ramp.get_point_count() - 1, Color(0.4, 0.1, 0.05, 0.0))
	p.color_ramp = ramp
	p.local_coords = true
	add_child(p)

func _process(dt: float) -> void:
	_t += dt
	for i in _fires.size():
		_fires[i].light_energy = 2.0 + sin(_t * 9.0 + i * 2.1) * 0.35 + sin(_t * 23.0 + i) * 0.2

func _bridge(away: Vector3, along: Vector3) -> void:
	var g := _off(away, 4.0, along, 34.0)
	# The hatch (her starboard side, +X) faces back toward the crater.
	var b := Site.upright(g.basis.y, along.rotated(g.basis.y, 0.5))
	var xf := Transform3D(b.rotated(b.z, 0.06), g.origin - g.basis.y * 0.15)
	var room: Node3D = load("res://art/aster_bridge.glb").instantiate()
	Surfaces.remove_named(room, "doors")
	Surfaces.apply(room)
	add_child(room)
	room.transform = xf
	bridge_xf = xf
	Surfaces.collide(room)
	piece("site-bridge_shell", xf, true, 1.0, 0.0)
	# Emergency light, and the recorder on the captain's chair.
	lamp(room, Vector3(0, 2.8, -4.5), Color(1.0, 0.35, 0.2), 1.6, 9.0)
	var rec := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.34, 0.16, 0.26)
	rec.mesh = box
	rec.material_override = Surfaces.get_material("paint_ember")
	room.add_child(rec)
	rec.position = Vector3(0, 0.74, -2.5)
	recorder_at = xf * rec.position
	var blink := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.03
	s.height = 0.06
	blink.mesh = s
	blink.material_override = Surfaces.get_material("nav_red")
	rec.add_child(blink)
	blink.position = Vector3(0.12, 0.09, 0.08)
	var use := Usable.box("Play Hale's recorder", Vector3(0.9, 0.8, 0.9))
	rec.add_child(use)
	use.used.connect(func(by: Node): _play_recorder(by as Explorer))

func _play_recorder(ex: Explorer) -> void:
	if not reach or reach.talking:
		return
	ex.enabled = false
	reach.talking = true
	var t := Talk.open(reach, "hale_rec", null, reach.hud)
	await t.finished
	reach.talking = false
	ex.enabled = true

func _vault_at(mark: Transform3D) -> void:
	var b := Site.upright(mark.basis.y, center.origin - mark.origin)
	_vault = piece("site-vault", Transform3D(b.rotated(b.z, -0.05), mark.origin), true, 1.0, 0.25)
	_door = load("res://art/site-vault_door.glb").instantiate()
	Surfaces.apply(_door)
	_vault.add_child(_door)
	_door_shut = Vector3(0, 0.02, 2.33)
	_door.position = _door_shut
	Surfaces.collide(_door)
	lamp(_vault, Vector3(0, 2.6, 0.4), Color(0.85, 0.92, 1.0), 0.9, 6.0)
	_keypad = Usable.box("Enter the vault's code", Vector3(0.6, 0.7, 0.5))
	_vault.add_child(_keypad)
	_keypad.position = Vector3(1.5, 1.45, 2.65)
	_keypad.used.connect(func(_by: Node): _code())
	_core = load("res://art/site-core.glb").instantiate()
	Surfaces.apply(_core)
	_vault.add_child(_core)
	_core.position = Vector3(0, 1.55, -1.3)
	var glow := OmniLight3D.new()
	glow.light_color = Color(0.6, 0.85, 1.0)
	glow.light_energy = 1.4
	glow.omni_range = 4.0
	_core.add_child(glow)
	_core_use = Usable.sphere("Take the Founders' core", 0.5)
	_core.add_child(_core_use)
	_core_use.used.connect(func(_by: Node): _take_core())

func _code() -> void:
	if _door.position != _door_shut:
		return
	if not Lore.known("ash_hale"):
		Sfx.play("beep", -8.0, 0.6)
		reach.hud.caption("A keypad: four digits. You don't know the code.", 2.5)
		return
	for k in 4:
		Sfx.play("beep", -10.0, 1.0 + k * 0.08)
		await get_tree().create_timer(0.18).timeout
	reach.hud.caption("0 4 1 2", 1.5)
	Sfx.play("door", -4.0, 0.8)
	_keypad.prompt = ""
	var t := create_tween()
	t.tween_property(_door, "position", _door_shut + Vector3(2.0, 0, 0), 1.6).set_trans(Tween.TRANS_SINE)

func _take_core() -> void:
	if not _core.visible:
		return
	_core.visible = false
	_core_use.prompt = ""
	reach.take_core()
	Sfx.play("objective", -6.0, 0.8)
	var news := Lore.learn("ash_core")
	await get_tree().create_timer(2.5).timeout
	if Lore.learn("ash_rook") or news:
		reach.hud.toast("SHIP LOG UPDATED")
	reach.hud.caption("Rook, on the drones' channel: \"Let the pilot dig. They'll carry it where I can't.\"", 5.0)

## A new morning: the vault shut, the core in its cradle, drones on their loops.
func reset_loop() -> void:
	_door.position = _door_shut
	_keypad.prompt = "Enter the vault's code"
	_core.visible = true
	_core_use.prompt = "Take the Founders' core"
	for d in drones:
		d.reset()

## A morning after the core was taken: the cradle stays empty (the core
## came back through the loop with the pilot), the vault open.
func core_gone() -> void:
	_core.visible = false
	_core_use.prompt = ""
	_keypad.prompt = ""
	_door.position = _door_shut + Vector3(2.0, 0, 0)

func _vex() -> void:
	center = Worlds.place(body, "vex")
	put("site-tent", Vector2(-3.0, 2.0), Vector2(2, -2))
	lamp(put("village-lamp", Vector2(1.6, 2.2), Vector2.ZERO), Vector3(0, 1.9, 0.55), Color(1.0, 0.8, 0.55), 1.4, 8.0)
	put("village-barrel", Vector2(1.2, -1.0), Vector2.ZERO)
	put("village-barrel", Vector2(1.9, -0.6), Vector2.ZERO)
	put("site-debris_truss", Vector2(-5.0, -3.5), Vector2(0, 5), true, 0.7)
	put("village-crate", Vector2(-1.5, 3.4), Vector2.ZERO)
	person("vex", "vex", Vector2(0.4, -0.2), Vector2(-6, -14))
	center = Worlds.place(body, "wreck")

func _debris(away: Vector3, along: Vector3) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 9
	for k in 9:
		var g := _off(away, rng.randf_range(-20.0, 24.0), along, rng.randf_range(-30.0, 30.0))
		if g.origin.distance_to(Worlds.place(body, "vault").origin) < 9.0:
			continue
		var kind := "site-debris_plate" if k % 2 == 0 else "site-debris_truss"
		piece(kind, Transform3D(g.basis.rotated(g.basis.y, rng.randf() * TAU), g.origin), true, rng.randf_range(0.6, 1.1))

func _drones(vault_mark: Transform3D) -> void:
	for spec in [[vault_mark, 11.0, 8.5, 0.34, 0.0], [center, 22.0, 11.0, -0.22, 2.0]]:
		var d := HollowDrone.new()
		d.reach = reach
		d.path_center = spec[0]
		d.path_radius = spec[1]
		d.path_height = spec[2]
		d.speed = spec[3]
		d.phase = spec[4]
		add_child(d)
		drones.append(d)

## Smoke rising from a burning wreck (rising along the site's up there).
func _smoke(on: Node3D, at: Vector3) -> void:
	var s := VerdanceSite._mist(Vector3.ZERO)
	var up := at.normalized()
	s.transform = Transform3D(Site.upright(up, up.cross(Vector3.RIGHT) if absf(up.x) < 0.9 else up.cross(Vector3.UP)), at)
	s.local_coords = true
	s.amount = 16
	s.lifetime = 7.0
	s.gravity = Vector3(0, 0.5, 0)
	s.scale_amount_min = 2.0
	s.scale_amount_max = 5.0
	s.emission_box_extents = Vector3(1.0, 0.2, 1.0)
	((s.mesh as QuadMesh).material as StandardMaterial3D).albedo_color = Color(0.16, 0.15, 0.15, 0.3)
	on.add_child(s)
