extends FlightScene
## Act Two: the Rim, flown free. Hearth and the space round it: the lanes
## and their traffic, the Harbor relay eight kilometres out, the salvage
## field, the Hollow hideout among the rocks, the ice tanker Calla coasting
## below. Work comes from the job board (J); the map (M) shows where things
## are. Hearth Security watches: shoot the wrong ship or get caught with
## the wrong cargo and its interceptors come (heat, one to five), until
## they lose you. Fly back into Hearth's berth to walk Lowdeck again.

const SUN := Vector3(0.5, 0.35, 0.8)
const BERTH := Vector3(0.0, 0.0, -130.0)
const RELAY := Vector3(5200.0, 700.0, -4800.0)
const FIELD := Vector3(2800.0, -500.0, 2400.0)
const HIDEOUT := Vector3(-4200.0, 500.0, -2800.0)
const TANKER := Vector3(1500.0, -1100.0, -3000.0)
const DEPOT := Vector3(500.0, -120.0, 700.0)
const OKAFOR := Vector3(-3800.0, 400.0, 3600.0)

var station: Node3D
var traffic: Traffic
var heat := 0
var job := {}
var _hunters: Array = []
var _cool_t := 0.0
var _heat_layer: Control
var _map: Control
var _map_on := false
var _places := {}
var _relay: Node3D
var _tanker: Node3D
var _depot: Node3D
var _busy := false
var _docking_out := false
var _event_t := 75.0
var _event: Array = []
# Courier
var _clock := 0.0
var _limit := 0.0
var _scan := 0.0
var _patrols: Array = []
# Bounty
var _marks: Array = []
var _bounty_spawned := false
# Race
var _rings: Array = []
var _next_ring := 0
var _race_t := 0.0
var _racing := false
# Salvage
var _crates: Array = []
var _towing: Node3D = null
var _towed := 0
var _beam: MeshInstance3D
# Story: Okafor
var _shuttle: Hull
var _okafor_attackers: Array = []

func _ready() -> void:
	Act2.test_setup()
	setup_flight(SUN, 1.0, true, "hearth")
	ship.floor_integrity = 0.0
	ship.died.connect(_ship_lost)
	Flow.music(true)
	add_child(Earth.toward(Vector3(-0.3, -0.5, 1.0), 9_000_000.0, SUN, 0.003))
	station = load("res://art/station-hearth.glb").instantiate()
	add_child(station)
	Surfaces.apply(station)
	Surfaces.collide(station)
	FlightHud.mark(station, "Hearth Station", "Station · L1", "structure")
	traffic = Traffic.new()
	traffic.lanes = [[Vector3(-600, 80, -500), Vector3(2600, 300, -2600)], [Vector3(500, -120, 300), Vector3(-2600, -400, 2400)], [Vector3(300, 200, -400), Vector3(4800, 650, -4500)]]
	traffic.count = 7
	add_child(traffic)
	_build_places()
	_heat_hud()
	_map_make()
	bolts.struck.connect(_on_hit)
	# Out of the berth.
	ship.global_position = BERTH + Vector3(0, 0, -60)
	ship.look_at(BERTH + Vector3(0, 0, -400))
	ship.aim = -ship.global_basis.z
	ship.velocity = -ship.global_basis.z * 40.0
	ship.cruise = 40.0
	ship.weapons = true
	job = Act2.active()
	# For checks: start beside the job's place (--near, or #rim/docknear).
	if Flow.has_meta("near") or "--near" in OS.get_cmdline_user_args():
		Flow.remove_meta("near")
		ship.global_position = TANKER + Vector3(0, 300, 1800)
		ship.look_at(TANKER)
		ship.aim = -ship.global_basis.z
	_start()

# --- Places ---------------------------------------------------------------------------------

func _build_places() -> void:
	_relay = _buoy(RELAY, 2.4, Color(0.3, 1.0, 1.0))
	_places["Harbor relay"] = RELAY
	FlightHud.mark(_relay, "Harbor relay", "Comms relay", "structure")
	_relay.set_meta("ov_range", "")
	_depot = _buoy(DEPOT, 1.2, Color(1.0, 0.55, 0.2))
	_places["Depot buoy"] = DEPOT
	FlightHud.mark(_depot, "Depot buoy", "Cargo drop", "structure")
	_field()
	_places["Salvage field"] = FIELD
	_rocks()
	_places["The Hollow hideout"] = HIDEOUT
	_tanker = Hull.model("freighter3", true)
	add_child(_tanker)
	_tanker.global_position = TANKER
	_tanker.rotation_degrees = Vector3(0, 10, 0)
	Surfaces.collide(_tanker)
	_places["Tanker Calla"] = TANKER
	FlightHud.mark(_tanker, "Calla", "Ice tanker", "neutral")
	_places["Hearth berth"] = BERTH

## A relay or a buoy: a mast, a ring of panels, lights that blink.
func _buoy(at: Vector3, k: float, colour: Color) -> Node3D:
	var n := Node3D.new()
	add_child(n)
	n.global_position = at
	var mast := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.2 * k
	cm.bottom_radius = 1.6 * k
	cm.height = 40.0 * k
	cm.material = Surfaces.get_material("metal")
	mast.mesh = cm
	n.add_child(mast)
	for i in 4:
		var p := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(14.0 * k, 0.3, 6.0 * k)
		b.material = Surfaces.get_material("solar")
		p.mesh = b
		p.position = Vector3(cos(i * PI / 2.0) * 10.0 * k, 6.0 * k, sin(i * PI / 2.0) * 10.0 * k)
		p.rotation.y = -i * PI / 2.0
		n.add_child(p)
	var lamp := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 1.2 * k
	s.height = 2.4 * k
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.albedo_color = colour * 5.0
	s.material = lm
	lamp.mesh = s
	lamp.position = Vector3(0, 21.0 * k, 0)
	n.add_child(lamp)
	var t := create_tween().set_loops()
	t.tween_callback(func(): lamp.visible = not lamp.visible).set_delay(0.6)
	return n

## The salvage field: broken containers and plate, drifting.
func _field() -> void:
	var crate := BoxMesh.new()
	crate.size = Vector3(2.6, 2.6, 6.2)
	crate.material = Surfaces.get_material("container_grey")
	var frag := MultiMeshInstance3D.new()
	var fm := MultiMesh.new()
	fm.transform_format = MultiMesh.TRANSFORM_3D
	var plate := BoxMesh.new()
	plate.size = Vector3(1.4, 0.1, 2.4)
	plate.material = Surfaces.get_material("seam")
	fm.mesh = plate
	fm.instance_count = 260
	for i in fm.instance_count:
		var p := FIELD + Vector3(randf_range(-1, 1), randf_range(-0.5, 0.5), randf_range(-1, 1)) * randf_range(40.0, 600.0)
		var b := Basis.from_euler(Vector3(randf(), randf(), randf()) * TAU).scaled(Vector3(randf_range(0.5, 5.0), randf_range(0.6, 2.0), randf_range(0.5, 4.0)))
		fm.set_instance_transform(i, Transform3D(b, p))
	frag.multimesh = fm
	frag.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(frag)
	for i in 18:
		var mi := MeshInstance3D.new()
		mi.mesh = crate
		add_child(mi)
		mi.global_position = FIELD + Vector3(randf_range(-1, 1), randf_range(-0.4, 0.4), randf_range(-1, 1)) * randf_range(60.0, 500.0)
		mi.rotation = Vector3(randf(), randf(), randf()) * TAU

## The hideout: a cluster of rocks, the Hollow's lamps among them.
func _rocks() -> void:
	var rock_mat := Surfaces.get_material("rust")
	for i in 26:
		var r := MeshInstance3D.new()
		r.mesh = _rock_mesh(randf_range(20.0, 120.0), i)
		r.material_override = rock_mat
		add_child(r)
		r.global_position = HIDEOUT + Vector3(randf_range(-1, 1), randf_range(-0.6, 0.6), randf_range(-1, 1)) * randf_range(100.0, 900.0)
		r.rotation = Vector3(randf(), randf(), randf()) * TAU
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := SphereShape3D.new()
		sh.radius = (r.mesh as ArrayMesh).get_aabb().size.length() * 0.3
		cs.shape = sh
		body.add_child(cs)
		r.add_child(body)

## A lumpy rock: a sphere pushed in and out by a few waves.
func _rock_mesh(size: float, seed_i: int) -> ArrayMesh:
	var sphere := SphereMesh.new()
	sphere.radius = size
	sphere.height = size * 2.0
	sphere.radial_segments = 14
	sphere.rings = 8
	var arrays := sphere.get_mesh_arrays()
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_i * 31 + 7
	var waves: Array = []
	for k in 5:
		waves.append([Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)).normalized(), rng.randf_range(1.5, 4.0), rng.randf_range(0.08, 0.2)])
	for i in verts.size():
		var v := verts[i]
		var d := v.normalized()
		var k := 1.0
		for w in waves:
			k += sin(d.dot(w[0]) * w[1] * 3.0) * w[2]
		verts[i] = v * k * Vector3(1.0, 0.8, 1.1)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = null
	arrays[Mesh.ARRAY_TANGENT] = null
	var st := SurfaceTool.new()
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	st.create_from(am, 0)
	st.generate_normals()
	return st.commit()

# --- The start ------------------------------------------------------------------------------------

func _start() -> void:
	await wait(0.6)
	if Act2.stage() == 3:
		_okafor()
		return
	if job.is_empty():
		Hud.card("THE RIM", "HEARTH  ·  FREE FLIGHT", 2.4)
		Hud.objective("Fly the Rim", "[J] Job board    [M] Map    Fly into Hearth's berth to dock")
		Hud.prompt("[J] Job board    [M] Map", 6.0)
		return
	_begin(job)

func _begin(j: Dictionary) -> void:
	job = j
	Hud.card(str(j.title).to_upper(), str(j.giver).to_upper(), 2.6)
	match str(j.kind):
		"bounty":
			_bounty()
		"courier":
			_courier()
		"race":
			_race()
		"salvage":
			_salvage()
		"dock":
			_dock_job()

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo:
		if e.keycode == KEY_J and not _busy:
			get_viewport().set_input_as_handled()
			var b := JobBoard.open(self)
			b.taken.connect(func(j: Dictionary):
				_end_job_state()
				_begin(j))
		elif e.keycode == KEY_M:
			get_viewport().set_input_as_handled()
			_map_on = not _map_on
			_map.visible = _map_on

func _end_job_state() -> void:
	clear_goal()
	for r in _rings:
		if is_instance_valid(r):
			r.queue_free()
	_rings.clear()
	_racing = false
	for c in _crates:
		if is_instance_valid(c):
			c.queue_free()
	_crates.clear()
	_towing = null
	for p in _patrols:
		if is_instance_valid(p):
			p.queue_free()
	_patrols.clear()
	_limit = 0.0

func _done(bonus := 0, note := "") -> void:
	var title := str(job.get("title", "Job"))
	var split := Act2.complete(job, bonus)
	job = {}
	_end_job_state()
	Report.line("RIM job done: " + title)
	Sfx.play("objective", -2.0)
	await Hud.mission_passed(title, split[0], split[1], Flow.debt())
	if note != "":
		Hud.say("Vex", note)
	if Act2.stage() == 2 and Act2.jobs_done() >= Act2.JOBS_FOR_VEX:
		Hud.say("Vex", "That's two. Come down to the Ninth Orbit, pilot. I've got something for you.")
		Hud.objective("Dock at [Hearth]", "Vex has news")
		set_goal(BERTH, "HEARTH BERTH")
	else:
		Hud.objective("Fly the Rim", "[J] Job board    [M] Map    Hearth's berth to dock")

func _failed_job(reason: String) -> void:
	Report.line("RIM job failed: " + reason)
	Act2.clear()
	job = {}
	_end_job_state()
	Sfx.play("alarm", -6.0)
	Hud.objective("Job lost", reason)
	Hud.prompt("[J] Take another", 5.0)

# --- Bounty -----------------------------------------------------------------------------------------

func _bounty() -> void:
	var at := HIDEOUT if str(job.get("target", "")) == "Kade Marrow" else FIELD
	set_goal(at, "BOUNTY")
	Hud.objective("Find and destroy [%s]" % job.get("target", "the pack"), "Last seen at %s" % ("the Hollow hideout" if at == HIDEOUT else "the salvage field"))
	_bounty_spawned = false
	_marks.clear()

func _bounty_tick() -> void:
	var at := HIDEOUT if str(job.get("target", "")) == "Kade Marrow" else FIELD
	if not _bounty_spawned and ship.global_position.distance_to(at) < 2200.0:
		_bounty_spawned = true
		clear_goal()
		Sfx.play("alarm", -4.0)
		var ace := str(job.get("target", "")) == "Kade Marrow"
		for k in 3:
			var p := at + Vector3(randf_range(-1, 1), randf_range(-0.3, 0.3), randf_range(-1, 1)).normalized() * randf_range(300.0, 600.0)
			var r := spawn_raider(p, ship, ace and k == 0)
			if ace and k == 0:
				r.display_name = "Kade Marrow"
				r.ship_class = "Hollow ace"
			r.died.connect(func():
				_marks.erase(r)
				raider_destroyed(r)
				Hud.objective_extra("%d left" % _marks.size())
				if _marks.is_empty():
					_done(0, "Clean work. Hearth won't thank you. I will."))
			_marks.append(r)
		Hud.objective("Destroy [%s]" % ("Kade Marrow and his escorts" if ace else "the Hollow pack"), "3 left")
		Hud.say("Rook" if ace else "Hearth Traffic", "Kestrel. Kade's one of mine. You know that, don't you?" if ace else "Kestrel, three contacts lighting up in the field. Weapons free out there.")

# --- Courier ------------------------------------------------------------------------------------------

func _courier() -> void:
	_clock = 0.0
	_limit = float(job.get("time", 160.0))
	_scan = 0.0
	set_goal(RELAY, "HARBOR RELAY")
	Hud.objective("Deliver to [the Harbor relay]", "%d s" % int(_limit))
	if bool(job.get("contraband", false)):
		# Two Security patrols sit on the way out: keep clear of their
		# scanners (the blue circles on the map) or they'll want to look.
		for p in [RELAY * 0.35 + Vector3(0, 250, 0), RELAY * 0.68 + Vector3(-300, -150, 200)]:
			var pat := Hull.new()
			pat.team = "neutral"
			pat.display_name = "Security patrol"
			pat.ship_class = "Corvette"
			pat.radius = 16.0
			pat.integrity = 1e6
			pat.max_integrity = 1e6
			pat.floor_integrity = 1e6
			var m := Hull.model("raider")
			m.scale = Vector3.ONE * 1.5
			pat.add_child(m)
			pat.body = m
			add_child(pat)
			pat.global_position = p
			FlightHud.mark(pat, "Security patrol", "Scanner · 700 m", "neutral")
			_patrols.append(pat)
		Hud.prompt("Contraband aboard: keep 700 m clear of Security patrols", 7.0)

func _courier_tick(dt: float) -> void:
	_clock += dt
	var left := _limit - _clock
	Hud.objective_extra("%d s" % int(maxf(0.0, left)))
	if left <= 0.0:
		_failed_job("Too slow: the delivery was refused")
		return
	if not _patrols.is_empty() and heat == 0:
		var near := false
		for p: Node3D in _patrols:
			if p.global_position.distance_to(ship.global_position) < 700.0:
				near = true
		_scan = clampf(_scan + (dt / 3.5 if near else -dt / 6.0), 0.0, 1.0)
		if near:
			Hud.objective_extra("SCANNING %d%%" % int(_scan * 100.0))
		if _scan >= 1.0:
			_scan = 0.0
			Hud.say("Hearth Security", "Kestrel, your manifest doesn't match your mass. Heave to for inspection.")
			add_heat(2)
	if ship.global_position.distance_to(RELAY) < 150.0:
		var bonus := int(maxf(0.0, left) * 6.0)
		_done(bonus, "Delivered. I don't need to know what it was either." if bool(job.get("contraband", false)) else "")

# --- Race ---------------------------------------------------------------------------------------------

func _race() -> void:
	_rings.clear()
	for i in 12:
		var a := TAU * float(i) / 12.0
		var r := 520.0 + sin(a * 3.0) * 160.0
		var p := Vector3(cos(a) * r, sin(a * 2.0) * 140.0, sin(a) * r)
		var ring := MeshInstance3D.new()
		var t := TorusMesh.new()
		t.inner_radius = 15.0
		t.outer_radius = 17.0
		t.rings = 24
		t.ring_segments = 8
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Color(1.0, 0.42, 0.17) * 3.0
		t.material = m
		ring.mesh = t
		add_child(ring)
		ring.global_position = p
		var tangent := Vector3(-sin(a), 0.0, cos(a))
		ring.look_at(p + tangent, Vector3.UP)
		ring.rotate_object_local(Vector3.RIGHT, PI / 2.0)
		_rings.append(ring)
	_next_ring = 0
	_racing = false
	_race_t = 0.0
	_ring_goal()
	Hud.objective("The Hearth Loop: [ring 1] to start the clock", "Gold under 75 s")

func _ring_goal() -> void:
	for i in _rings.size():
		var m := (_rings[i] as MeshInstance3D).mesh.surface_get_material(0) as StandardMaterial3D
		m.albedo_color = (Color(0.18, 0.83, 1.0) if i == _next_ring else Color(1.0, 0.42, 0.17)) * (3.0 if i >= _next_ring else 0.4)
	if _next_ring < _rings.size():
		set_goal(_rings[_next_ring].global_position, "RING %d" % (_next_ring + 1), false)

func _race_tick(dt: float) -> void:
	if _racing:
		_race_t += dt
		Hud.objective_extra("%.1f s   ring %d of 12" % [_race_t, _next_ring + 1])
	if _next_ring >= _rings.size():
		return
	if ship.global_position.distance_to(_rings[_next_ring].global_position) < 17.0:
		Sfx.play("click", -2.0, 1.5)
		if _next_ring == 0:
			_racing = true
			hud.pop("GO", Style.ION)
		_next_ring += 1
		if _next_ring >= _rings.size():
			var gold := _race_t < 75.0
			hud.pop("%.1f s  ·  %s" % [_race_t, "GOLD" if gold else ("SILVER" if _race_t < 95.0 else "FINISHED")], Style.EMBER)
			_done(int(job.get("pay", 0)) if gold else (500 if _race_t < 95.0 else 0))
			return
		_ring_goal()

# --- Salvage ------------------------------------------------------------------------------------------

func _salvage() -> void:
	_crates.clear()
	_towed = 0
	var crate := BoxMesh.new()
	crate.size = Vector3(2.6, 2.6, 6.2)
	crate.material = Surfaces.get_material("container_ember")
	for i in 4:
		var mi := MeshInstance3D.new()
		mi.mesh = crate
		add_child(mi)
		mi.global_position = FIELD + Vector3(randf_range(-1, 1), randf_range(-0.3, 0.3), randf_range(-1, 1)).normalized() * randf_range(120.0, 380.0)
		mi.rotation = Vector3(randf(), randf(), randf()) * TAU
		FlightHud.mark(mi, "Lost container", "Dock Supply cargo", "objective")
		_crates.append(mi)
	set_goal(FIELD, "SALVAGE FIELD")
	Hud.objective("Tow [4 containers] to the depot buoy", "0 of 4")

func _salvage_tick(dt: float) -> void:
	if _towing:
		var hook := ship.global_position + ship.global_basis.z * 26.0
		_towing.global_position = _towing.global_position.lerp(hook, minf(1.0, dt * 1.6))
		_beam_draw(true, _towing.global_position)
		if _towing.global_position.distance_to(DEPOT) < 110.0:
			FlightHud.unmark(_towing)
			_crates.erase(_towing)
			_towing.queue_free()
			_towing = null
			_beam_draw(false, Vector3.ZERO)
			_towed += 1
			Sfx.play("objective", -6.0)
			Hud.objective_extra("%d of 4" % _towed)
			if _towed >= 4:
				_done(0, "Dock Supply says thank you. Dock Supply never says thank you.")
			else:
				set_goal(FIELD, "SALVAGE FIELD")
		return
	for c: Node3D in _crates:
		if c.global_position.distance_to(ship.global_position) < 60.0:
			Hud.prompt("Hold [E] to take it in tow", 0.5)
			if Input.is_action_pressed("interact"):
				_towing = c
				Sfx.play("door", -6.0, 1.4)
				set_goal(DEPOT, "DEPOT BUOY")
				Hud.prompt("Tow it to the depot buoy", 3.0)
			return

func _beam_draw(on: bool, to: Vector3) -> void:
	if not _beam:
		_beam = MeshInstance3D.new()
		_beam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
		var c := CylinderMesh.new()
		c.top_radius = 0.25
		c.bottom_radius = 0.6
		c.height = 1.0
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.albedo_color = Color(0.3, 1.2, 2.0, 0.5)
		c.material = m
		_beam.mesh = c
		_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_beam)
	_beam.visible = on
	if on:
		var a := ship.global_position + ship.global_basis.z * 6.0
		_beam.global_position = (a + to) / 2.0
		_beam.look_at(to, Vector3.UP if absf((to - a).normalized().y) < 0.99 else Vector3.RIGHT)
		_beam.rotate_object_local(Vector3.RIGHT, PI / 2)
		_beam.scale = Vector3(1, a.distance_to(to), 1)

# --- Dock (the orbital rendezvous) ----------------------------------------------------------------------

func _dock_job() -> void:
	if _busy:
		return
	set_goal(TANKER, "CALLA")
	Hud.objective("Rendezvous with [the Calla]", "Fly within 2 km, then dock by her orbit")

func _dock_tick() -> void:
	if ship.global_position.distance_to(TANKER) < 2000.0 and not _busy:
		_busy = true
		clear_goal()
		var d := Rendezvous.new()
		d.tanker = _tanker
		d.flight = self
		add_child(d)
		d.finished.connect(func(ok: bool):
			_busy = false
			if ok:
				_done(0, "The Calla's crew says you fly like the textbooks. They meant it nicely.")
			else:
				_failed_job("You struck the Calla"))

# --- Heat ---------------------------------------------------------------------------------------------------

func _on_hit(team: String, target: Node3D, _damage: float, _layer: String) -> void:
	if team != "player":
		return
	if target is Hull and (target as Hull).team == "neutral" and target != _tanker:
		if not target.has_meta("hit_once"):
			target.set_meta("hit_once", true)
			Hud.say("Hearth Security", "Weapons fire on a civilian. Kestrel, you're done.")
			add_heat(1)

## Hearth Security takes an interest: one to five.
func add_heat(n: int) -> void:
	heat = clampi(heat + n, 0, 5)
	_cool_t = 0.0
	Sfx.play("alarm", -6.0)
	_hunt()
	_heat_layer.queue_redraw()

func _hunt() -> void:
	var want := mini(heat, 4)
	_hunters = _hunters.filter(func(h): return is_instance_valid(h) and h.alive)
	while _hunters.size() < want:
		var from := ship.global_position + (ship.global_basis.z * 1.0 + Vector3(randf_range(-0.6, 0.6), randf_range(-0.3, 0.3), randf_range(-0.6, 0.6))).normalized() * 1500.0
		var r := Raider.new()
		r.side = "security"
		r.bolts = bolts
		r.missiles = missiles
		r.target = ship
		add_child(r)
		r.global_position = from
		r.look_at(ship.global_position)
		r.died.connect(func():
			raider_destroyed(r)
			_hunters.erase(r)
			add_heat(1 if heat < 5 else 0))
		_hunters.append(r)

func _heat_tick(dt: float) -> void:
	if heat == 0:
		return
	_hunters = _hunters.filter(func(h): return is_instance_valid(h) and h.alive)
	var seen := false
	for h: Node3D in _hunters:
		if h.global_position.distance_to(ship.global_position) < 1300.0:
			seen = true
	_cool_t = 0.0 if seen else _cool_t + dt
	if _cool_t > 14.0:
		_cool_t = 0.0
		heat -= 1
		Sfx.play("objective", -10.0, 0.8)
		if heat == 0:
			Hud.say("Hearth Security", "All units, lost contact with the Kestrel. Return to patrol.")
			for h: Node3D in _hunters:
				h.queue_free()
			_hunters.clear()
		_heat_layer.queue_redraw()
	elif Engine.get_process_frames() % 240 == 0:
		_hunt()

func _heat_hud() -> void:
	_heat_layer = Control.new()
	_heat_layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	_heat_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	overlay.add_child(_heat_layer)
	_heat_layer.draw.connect(func():
		if heat == 0:
			return
		var vp := _heat_layer.get_viewport_rect().size
		var x0 := vp.x / 2.0 - 5 * 15.0
		for i in 5:
			var c := Vector2(x0 + i * 30.0 + 15.0, 26.0)
			var on := i < heat
			var pts := PackedVector2Array()
			for k in 10:
				var a := -PI / 2.0 + k * PI / 5.0
				pts.append(c + Vector2(cos(a), sin(a)) * (10.0 if k % 2 == 0 else 4.2))
			_heat_layer.draw_colored_polygon(pts, Style.EMBER if on else Color(Style.BONE, 0.15))
		_heat_layer.draw_string(Style.mono_bold, Vector2(vp.x / 2.0 - 120, 54), "HEARTH SECURITY" if _cool_t < 1.0 else "LOSING THEM  %d" % int(14.0 - _cool_t), HORIZONTAL_ALIGNMENT_CENTER, 240, 11, Style.EMBER))

# --- The map -------------------------------------------------------------------------------------------------

func _map_make() -> void:
	_map = Control.new()
	_map.set_anchors_preset(Control.PRESET_FULL_RECT)
	_map.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_map.visible = false
	overlay.add_child(_map)
	_map.draw.connect(func():
		var vp := _map.get_viewport_rect().size
		var size := minf(vp.x, vp.y) * 0.72
		var c := vp / 2.0
		var k := size / 12000.0
		_map.draw_rect(Rect2(c - Vector2(size, size) / 2.0, Vector2(size, size)), Color(Style.VOID, 0.82))
		_map.draw_rect(Rect2(c - Vector2(size, size) / 2.0, Vector2(size, size)), Color(Style.BONE, 0.25), false, 1.5)
		_map.draw_string(Style.mono_bold, c + Vector2(-size / 2.0 + 14, -size / 2.0 + 24), "THE RIM  ·  12 KM", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Style.EMBER)
		var to_map := func(p: Vector3) -> Vector2: return c + Vector2(p.x, p.z) * k
		for name in _places:
			var p: Vector2 = to_map.call(_places[name])
			_map.draw_circle(p, 4.0, Style.BONE)
			_map.draw_string(Style.sans_bold, p + Vector2(8, 4), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(Style.BONE, 0.85))
		for p: Node3D in _patrols:
			if is_instance_valid(p):
				_map.draw_arc(to_map.call(p.global_position), 700.0 * k, 0, TAU, 32, Color(Style.ION, 0.6), 1.5)
		for h: Node3D in _hunters:
			if is_instance_valid(h):
				_map.draw_circle(to_map.call(h.global_position), 3.0, Style.EMBER)
		if hud.goal:
			_map.draw_arc(to_map.call(hud.goal.global_position), 9.0, 0, TAU, 20, Style.ION, 2.0)
		var me: Vector2 = to_map.call(ship.global_position)
		var f := -ship.global_basis.z
		var dir := Vector2(f.x, f.z).normalized() if Vector2(f.x, f.z).length() > 0.01 else Vector2(0, -1)
		var n := Vector2(-dir.y, dir.x)
		_map.draw_colored_polygon(PackedVector2Array([me + dir * 11.0, me - dir * 6.0 + n * 6.0, me - dir * 6.0 - n * 6.0]), Style.EMBER)
		_map.draw_string(Style.mono, c + Vector2(-size / 2.0 + 14, size / 2.0 - 14), "[M] close", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Style.MUTE))

# --- Random trouble: a distress call -------------------------------------------------------------------

func _event_tick(dt: float) -> void:
	_event = _event.filter(func(r): return is_instance_valid(r) and r.alive)
	if not _event.is_empty() or Act2.stage() == 3:
		return
	_event_t -= dt
	if _event_t > 0.0:
		return
	_event_t = randf_range(80.0, 140.0)
	# Raiders jump a ship in the lanes; Hearth pays a bounty on each.
	var victims := traffic.get_children().filter(func(n): return n is Hull)
	if victims.is_empty():
		return
	var v: Hull = victims[randi() % victims.size()]
	Hud.say("Hearth Traffic", "Mayday relay: %s is under attack in the lanes. Hearth pays eight hundred a raider." % v.display_name)
	for k in 2:
		var r := spawn_raider(v.global_position + Vector3(randf_range(-1, 1), randf_range(-0.3, 0.3), randf_range(-1, 1)).normalized() * 700.0, v, false, [], true)
		r.died.connect(func():
			raider_destroyed(r)
			var s := Flow.earn(800)
			hud.pop("+%d  BOUNTY" % s[0], Style.EMBER))
		_event.append(r)

# --- Okafor (story) ---------------------------------------------------------------------------------------

func _okafor() -> void:
	Hud.card("OKAFOR", "ACT TWO  ·  THE RIM", 2.6)
	_shuttle = Hull.new()
	_shuttle.team = "friendly"
	_shuttle.display_name = "Okafor's shuttle"
	_shuttle.ship_class = "Shuttle"
	_shuttle.radius = 10.0
	_shuttle.max_shield = 40.0
	_shuttle.shield = 40.0
	_shuttle.max_integrity = 160.0
	_shuttle.integrity = 160.0
	var m := Hull.model("freighter3")
	m.scale = Vector3.ONE * 0.22
	_shuttle.add_child(m)
	_shuttle.body = m
	_shuttle.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(_shuttle)
	_shuttle.global_position = OKAFOR
	_shuttle.look_at(BERTH)
	_shuttle.make_solid(8.0)
	FlightHud.mark(_shuttle, "Okafor's shuttle", "Shuttle · protect", "friendly")
	hud.protect = _shuttle
	_shuttle.died.connect(_okafor_lost)
	set_goal(OKAFOR, "OKAFOR")
	Hud.objective("Meet [Okafor's shuttle]", "Bring it in to Hearth")
	await Hud.say("Okafor", "Kestrel? Vex said you'd come. I'm told the Warden has opinions about my landing.")

func _okafor_tick(dt: float) -> void:
	if not is_instance_valid(_shuttle) or not _shuttle.alive:
		return
	var close := ship.global_position.distance_to(_shuttle.global_position) < 1200.0
	if close and _okafor_attackers.is_empty() and not _shuttle.has_meta("attacked"):
		_shuttle.set_meta("attacked", true)
		clear_goal()
		await Hud.say("The Warden", "Shuttle Kittiwake, you are carrying stolen property of the Governor of Hearth. Heave to.")
		await Hud.say("Okafor", "Stolen. Funny word for a ledger he's in.")
		for k in 4:
			var r := Raider.new()
			r.side = "security"
			r.bolts = bolts
			r.missiles = missiles
			r.target = _shuttle if k < 2 else ship
			add_child(r)
			r.global_position = _shuttle.global_position + Vector3(randf_range(-1, 1), randf_range(-0.2, 0.4), randf_range(-1, 1)).normalized() * 1100.0
			r.look_at(_shuttle.global_position)
			r.died.connect(func():
				raider_destroyed(r)
				_okafor_attackers.erase(r)
				Hud.objective_extra("%d interceptors left" % _okafor_attackers.size())
				if _okafor_attackers.is_empty():
					Hud.say("Okafor", "That's the last of them. I'm going to write that down."))
			_okafor_attackers.append(r)
		Hud.objective("Protect [Okafor's shuttle]", "4 interceptors")
	if _shuttle.has_meta("attacked"):
		var to := BERTH - _shuttle.global_position
		if to.length() > 40.0:
			_shuttle.global_position += to.normalized() * 55.0 * dt
			_shuttle.look_at(BERTH)
		elif _okafor_attackers.is_empty():
			_okafor_home()

func _okafor_home() -> void:
	if _busy:
		return
	_busy = true
	heat = 0
	_heat_layer.queue_redraw()
	hud.protect = null
	Report.line("RIM okafor home")
	Act2.set_stage(4)
	var split := Flow.earn(5000)
	await Hud.mission_passed("Okafor", split[0], split[1], Flow.debt())
	await Hud.say("Okafor", "The ledger goes out on every channel the governor doesn't own, which is three. It's enough.")
	await Hud.say("Mara Voss", "You did it, Kestrel. Dock. Renn wants to see you, and so, God help us, does Vex.")
	Hud.objective("Dock at [Hearth]", "Lowdeck")
	set_goal(BERTH, "HEARTH BERTH")
	_busy = false

func _okafor_lost() -> void:
	Report.line("RIM okafor lost")
	await Hud.mission_failed("Okafor's shuttle was destroyed")
	Flow.go("rim")

# --- Every frame ----------------------------------------------------------------------------------------------

func _process(dt: float) -> void:
	super(dt)
	if not ship or not ship.alive:
		return
	match str(job.get("kind", "")):
		"bounty":
			_bounty_tick()
		"courier":
			_courier_tick(dt)
		"race":
			_race_tick(dt)
		"salvage":
			_salvage_tick(dt)
		"dock":
			_dock_tick()
	if Act2.stage() == 3:
		_okafor_tick(dt)
	_heat_tick(dt)
	_event_tick(dt)
	if _map_on:
		_map.queue_redraw()
	# Home: into Hearth's berth, slowly.
	if not _docking_out and ship.global_position.distance_to(BERTH) < 70.0 and ship.velocity.length() < 60.0:
		if heat > 0:
			if Engine.get_process_frames() % 120 == 0:
				Hud.say("Hearth Traffic", "Berth's locked to you while Security has a hold on your ship. Lose them first.")
		else:
			_dock_home()

func _dock_home() -> void:
	_docking_out = true
	Report.line("RIM docked")
	ship.controls = false
	Hud.clear_prompt()
	Sfx.play("door", -4.0, 0.7)
	Flow.beat = "lift"
	Flow.go("lowdeck")

func _ship_lost() -> void:
	if _busy and Act2.stage() != 3:
		return
	ship.controls = false
	ship.set_process(false)
	ship.set_physics_process(false)
	ship.destroy(14.0, 30.0)
	hud.visible = false
	Hud.silence()
	await wait(1.4)
	await Hud.mission_failed("The Kestrel was destroyed")
	if not job.is_empty():
		Act2.take(job)
	Flow.go("rim")
