extends FlightScene
## Act One: Black Box. Out of Hearth, warp to where the Aster died, find her
## bridge recorder by its signal among the wreckage, pull it aboard, and
## survive the ships that come for it. Then play it back.
##
## For checks: `-- --beat field|ambush|reveal` starts partway in.

const SUN := Vector3(0.5, 0.35, 0.8)
const FIELD_DIR := Vector3(0.55, -0.12, -0.83)

var station: Node3D
var traffic: Traffic
var hostiles: Array = []
var kills := 0
var _beat := ""
var _field: Node3D
var _marker: Node3D
var _core: Node3D
var _core_light: MeshInstance3D
var _beam: MeshInstance3D
var _ping_t := 0.0
var _pull := 0.0
var _have_core := false
var _earth: Earth
var _pull_hint := false
## For checks: `--autofight` also flies to the recorder and pulls it in.
var _auto := "--autofight" in OS.get_cmdline_user_args()

func _ready() -> void:
	setup_flight(SUN, 1.0, true, "hearth")
	ship.floor_integrity = 0.0
	ship.died.connect(_ship_lost)
	Flow.music(true)
	var args := OS.get_cmdline_user_args()
	var i := args.find("--beat")
	var start: String = args[i + 1] if i >= 0 and i + 1 < args.size() else Flow.beat
	Flow.beat = ""
	match start:
		"field":
			_build_field(Vector3.ZERO)
			_place_in_field()
			_search()
		"ambush":
			_build_field(Vector3.ZERO)
			_place_in_field()
			_have_core = true
			_core.visible = false
			_ambush()
		"reveal":
			_build_field(Vector3.ZERO)
			_place_in_field()
			_have_core = true
			_core.visible = false
			_reveal()
		_:
			_build_hearth()
			_depart()

# --- Hearth -------------------------------------------------------------------

func _build_hearth() -> void:
	_earth = Earth.toward(Vector3(-0.3, -0.5, 1.0), 9_000_000.0, SUN, 0.003)
	add_child(_earth)
	station = load("res://art/station-hearth.glb").instantiate()
	add_child(station)
	Surfaces.apply(station)
	Surfaces.collide(station)
	FlightHud.mark(station, "Hearth Station", "Station · L1", "structure")
	traffic = Traffic.new()
	traffic.lanes = [[Vector3(-600, 80, -500), Vector3(2600, 300, -2600)], [Vector3(500, -120, 300), Vector3(-2600, -400, 2400)]]
	add_child(traffic)
	ship.global_position = Vector3(0, 0, -150)
	ship.look_at(Vector3(0, 0, -400))
	ship.aim = -ship.global_basis.z
	ship.velocity = -ship.global_basis.z * 25.0
	ship.cruise = 25.0
	ship.weapons = false
	_marker = Node3D.new()
	add_child(_marker)
	_marker.global_position = ship.global_position + FIELD_DIR.normalized() * 90_000.0
	FlightHud.mark(_marker, "Aster wreck field", "Distress beacon", "objective")
	_marker.set_meta("ov_range", "41,000 km")

func _depart() -> void:
	_beat = "depart"
	await wait(0.8)
	Hud.card("Black Box", "THE ASTER FIELD · 41,000 KM", 2.4)
	await Hud.say("Hearth Traffic", "Kestrel, you're not on my board. ...Fine. You're cleared. Lane three, and try to come back in one piece this time.")
	await Hud.say("Mara Voss", "The field's forty-one thousand kilometres out. Too far to fly, so you'll jump.")
	set_goal(_marker.global_position, "ASTER FIELD", false)
	Hud.objective("Warp to the [Aster field]", "Press G")
	Hud.prompt("[G] Warp drive: the ship aligns to the marker by itself, then jumps", 0.0)
	await Hud.say("Mara Voss", "Point her at the beacon and light the drive. And Kestrel? Whatever's out there, it's just metal now.")

func _unhandled_input(e: InputEvent) -> void:
	if e.is_action_pressed("warp") and not warping:
		if _beat == "depart":
			_go_to_field()
		elif _beat == "home":
			_go_home()

func _go_to_field() -> void:
	_beat = "warping"
	Hud.clear_prompt()
	clear_goal()
	await warp(FIELD_DIR, 4.5, func():
		# Hidden by the tunnel: Hearth goes, the field arrives round the ship.
		for n in [station, traffic, _earth, _marker]:
			if is_instance_valid(n):
				n.queue_free()
		_build_field(ship.global_position + FIELD_DIR.normalized() * 700.0), "Aster wreck field")
	_search()

# --- The field ------------------------------------------------------------------

## The Aster's grave: her modules torn apart and tumbling, her cargo spilled,
## a haze of fragments, Earth vast and close. Dark: nothing here has power.
func _build_field(center: Vector3) -> void:
	set_sky("field")
	_field = Node3D.new()
	add_child(_field)
	_field.global_position = center
	_earth = Earth.toward(FIELD_DIR + Vector3(-0.2, -0.75, 0.2), 5_500_000.0, SUN, 0.003)
	add_child(_earth)
	var model := Hull.model("freighter", false)
	var holder: Node = model
	while holder.get_child_count() == 1:
		holder = holder.get_child(0)
	var parts: Array = []
	for c in holder.get_children():
		if c is Node3D:
			parts.append(c)
	var k := 0
	for c: Node3D in parts:
		for dead in ["drive_glow", "lights", "windows", "bridge_windows"]:
			for n in c.find_children(dead, "", true, false):
				n.visible = false
			if c.name == dead:
				c.visible = false
		var box := _bounds(c)
		var pivot := Tumbler.new()
		_field.add_child(pivot)
		for n in [c] + c.find_children("*", "", true, false):
			n.owner = null
		holder.remove_child(c)
		pivot.add_child(c)
		c.position = -box.get_center()
		var out := box.get_center().normalized() if box.get_center().length() > 1.0 else Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)).normalized()
		pivot.position = box.get_center() * 1.6 + out * randf_range(20.0, 90.0) + Vector3(0, (k % 3 - 1) * 25.0, 0)
		pivot.rotation = Vector3(randf_range(-0.6, 0.6), randf_range(-PI, PI), randf_range(-0.8, 0.8))
		# The big sections are solid and hold still (moving solids that size
		# cost the browser's physics every frame); the cargo drifts.
		Surfaces.collide(pivot)
		# Torn ends still venting and burning.
		if k % 3 == 0:
			var fire := Fx.trail(pivot, true)
			fire.local_coords = true
			fire.position = out * 6.0
		if c.name == "command":
			_core_near(pivot)
		k += 1
	model.queue_free()
	FlightHud.mark(_field, "Aster", "Wreck · bulk freighter", "structure")
	# Spilled cargo: refrigerated containers, some still blinking.
	var crate := BoxMesh.new()
	crate.size = Vector3(2.6, 2.6, 6.2)
	crate.material = Surfaces.get_material("container_bone")
	var crate2 := crate.duplicate() as BoxMesh
	crate2.material = Surfaces.get_material("container_ion")
	for i in 40:
		var mi := MeshInstance3D.new()
		mi.mesh = crate if i % 3 else crate2
		var t := Tumbler.new()
		t.add_child(mi)
		_field.add_child(t)
		t.position = Vector3(randf_range(-1, 1), randf_range(-0.5, 0.5), randf_range(-1, 1)).normalized() * randf_range(60.0, 420.0)
		t.rotation = Vector3(randf(), randf(), randf()) * TAU
		t.spin = Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.15
		if i % 5 == 0:
			var lamp := MeshInstance3D.new()
			var s := SphereMesh.new()
			s.radius = 0.25
			s.height = 0.5
			var lm := StandardMaterial3D.new()
			lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			lm.albedo_color = Color(0.4, 2.2, 4.0)
			s.material = lm
			lamp.mesh = s
			lamp.position = Vector3(0, 1.4, 2.8)
			mi.add_child(lamp)
	# A haze of fragments.
	var frag := MultiMeshInstance3D.new()
	var fm := MultiMesh.new()
	fm.transform_format = MultiMesh.TRANSFORM_3D
	var plate := BoxMesh.new()
	plate.size = Vector3(1.2, 0.08, 2.0)
	plate.material = Surfaces.get_material("seam")
	fm.mesh = plate
	fm.instance_count = 320
	for i in fm.instance_count:
		var p := Vector3(randf_range(-1, 1), randf_range(-0.6, 0.6), randf_range(-1, 1)) * randf_range(30.0, 520.0)
		var b := Basis.from_euler(Vector3(randf(), randf(), randf()) * TAU).scaled(Vector3(randf_range(0.5, 4.0), randf_range(0.6, 2.0), randf_range(0.5, 3.0)))
		fm.set_instance_transform(i, Transform3D(b, p))
	frag.multimesh = fm
	frag.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_field.add_child(frag)

## The box of a piece's meshes in its own space: each mesh's box carried
## through the transforms between it and the piece (the parts sit at their
## own positions in the model, so a mesh's box alone is in the wrong place).
func _bounds(n: Node3D) -> AABB:
	var box := AABB()
	var first := true
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		var b := _to_space(mi, n)
		box = b if first else box.merge(b)
		first = false
	if n is MeshInstance3D:
		var own := (n as MeshInstance3D).get_aabb()
		box = own if first else box.merge(own)
	return box

## A mesh's box in `root`'s space, walking up from the mesh to `root`.
static func _to_space(mi: MeshInstance3D, root: Node3D) -> AABB:
	var t := Transform3D.IDENTITY
	var node: Node = mi
	while node and node != root:
		if node is Node3D:
			t = (node as Node3D).transform * t
		node = node.get_parent()
	return t * mi.get_aabb()

## The recorder: an orange crash core lodged by the bridge, its strobe going.
func _core_near(bridge: Node3D) -> void:
	_core = Node3D.new()
	_field.add_child(_core)
	_core.position = bridge.position + Vector3(14.0, 9.0, 18.0)
	var body := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.7
	cyl.bottom_radius = 0.7
	cyl.height = 1.6
	cyl.material = Surfaces.get_material("paint_ember")
	body.mesh = cyl
	body.rotation_degrees = Vector3(70, 20, 0)
	_core.add_child(body)
	_core_light = MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 0.35
	s.height = 0.7
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.albedo_color = Color(6.0, 2.2, 0.6)
	s.material = lm
	_core_light.mesh = s
	_core_light.position = Vector3(0, 0.9, 0)
	_core.add_child(_core_light)
	var glow := OmniLight3D.new()
	glow.light_color = Color(1.0, 0.5, 0.2)
	glow.light_energy = 3.0
	glow.omni_range = 14.0
	_core.add_child(glow)

func _place_in_field() -> void:
	ship.global_position = _field.global_position - FIELD_DIR.normalized() * 700.0
	ship.look_at(_field.global_position)
	ship.aim = -ship.global_basis.z
	ship.velocity = -ship.global_basis.z * 30.0
	ship.cruise = 30.0

# --- The search -------------------------------------------------------------

func _search() -> void:
	_beat = "search"
	ship.weapons = true
	Hud.objective("Find the Aster's [flight recorder]", "Signal 0%")
	Hud.prompt("Follow the signal: the pings come faster as you close on it", 8.0)
	await Hud.say("Mara Voss", "...God. Elias.")
	await Hud.say("Mara Voss", "All right. The core sends a ping every few seconds. Your board will tell you how strong. Get close and pull it in.")

func _process(dt: float) -> void:
	super(dt)
	if _beat == "search" and _core and is_instance_valid(_core):
		var to := _core.global_position - ship.global_position
		var dist := to.length()
		var facing := maxf(0.0, (-ship.global_basis.z).dot(to.normalized()))
		var strength := clampf(1.0 - dist / 1600.0, 0.0, 1.0) * 0.75 + facing * 0.25
		Hud.objective_extra("Signal %d%%" % int(strength * 100.0))
		_core_light.visible = fmod(Time.get_ticks_msec() * 0.001, 1.0) < 0.2
		_ping_t -= dt
		if _ping_t <= 0.0:
			_ping_t = lerpf(1.8, 0.25, strength)
			Sfx.play("ping", lerpf(-16.0, -4.0, strength), 1.0 + strength * 0.2)
		if dist < 500.0 and not _core.is_in_group("overview"):
			FlightHud.mark(_core, "Bridge core recorder", "Crash recorder", "objective")
			set_goal(_core.global_position, "RECORDER", false)
			hud.log_line("Signal acquired: bridge core recorder", Style.ION)
		if _auto:
			ship.aim = to.normalized()
			ship.cruise = clampf(dist * 0.3, 0.0, 70.0)
		if dist < 45.0:
			if Input.is_action_pressed("interact") or _auto:
				_pull += dt
				_tractor(true)
			else:
				_pull = maxf(0.0, _pull - dt * 0.5)
				_tractor(false)
			if not _pull_hint:
				_pull_hint = true
				Hud.prompt("Hold [E] to pull the recorder aboard", 0.0)
			Hud.objective_extra("Tractor %d%%" % int(_pull / 3.0 * 100.0))
			if _pull >= 3.0:
				_got_core()
		else:
			_tractor(false)
	if _beat == "fight" and hostiles.is_empty():
		_reveal()

func _tractor(on: bool) -> void:
	if not _beam:
		_beam = MeshInstance3D.new()
		# Its ends follow the ship per rendered frame in _tractor.
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
		var a := ship.global_position + ship.global_basis.y * -1.2
		var b := _core.global_position
		_beam.global_position = (a + b) / 2.0
		_beam.look_at(b, Vector3.UP if absf((b - a).normalized().y) < 0.99 else Vector3.RIGHT)
		_beam.rotate_object_local(Vector3.RIGHT, PI / 2)
		_beam.scale = Vector3(1, a.distance_to(b), 1)
		_core.global_position = _core.global_position.move_toward(a, 4.0 * get_process_delta_time())

func _got_core() -> void:
	_beat = "got"
	Report.line("BLACKBOX recorder aboard")
	_have_core = true
	_tractor(false)
	_core.visible = false
	FlightHud.unmark(_core)
	clear_goal()
	Hud.clear_prompt()
	Sfx.play("objective", -2.0)
	hud.log_line("Bridge core recorder aboard", Style.ION)
	Hud.objective("Recorder aboard")
	await Hud.say("Mara Voss", "You've got it? Good. Now get out of th—")
	_ambush()

# --- The ambush ---------------------------------------------------------------

func _ambush() -> void:
	_beat = "ambush"
	Sfx.play("alarm", -2.0)
	var around := ship.global_position
	var kinds := [false, false, false, true]
	for k in kinds.size():
		var dir := Vector3(randf_range(-1, 1), randf_range(-0.3, 0.3), randf_range(-1, 1)).normalized()
		var at := around + dir * randf_range(900.0, 1200.0)
		Fx.explode(self, at, 6.0, false)
		var r := spawn_raider(at, ship, kinds[k])
		r.died.connect(_down.bind(r))
		hostiles.append(r)
	hud.log_line("Warp signatures: four contacts", Style.EMBER)
	Hud.objective("Destroy the [Hollow] ships", "0 / 4")
	_beat = "fight"
	await Hud.say("Rook", "I did ask nicely. Well. I didn't ask. Give my people the box, pilot.")
	await Hud.say("Mara Voss", "Those are Hollow ships, with Rook on the channel. Kestrel, don't you dare let them have that core.")
	Hud.prompt("[T] lock    [Right click] missiles    Missile coming? Double-tap [A] or [D]", 9.0)

func _down(r: Raider) -> void:
	hostiles.erase(r)
	raider_destroyed(r)
	kills += 1
	Hud.objective_extra("%d / 4" % kills)
	if r.gunship:
		Hud.say("Mara Voss", "The big one's down! Finish them!")

func _ship_lost() -> void:
	if _beat == "lost":
		return
	_beat = "lost"
	Report.line("BLACKBOX ship lost")
	if "--verify-exit" in OS.get_cmdline_user_args():
		Report.finish(get_tree(), 1)
		return
	ship.controls = false
	ship.set_process(false)
	ship.set_physics_process(false)
	ship.destroy(14.0, 30.0)
	hud.visible = false
	Hud.silence()
	await wait(1.4)
	await Hud.mission_failed("The Kestrel was destroyed")
	Flow.beat = "ambush" if _have_core else "field"
	Flow.go("blackbox")

# --- The truth ------------------------------------------------------------------

func _reveal() -> void:
	if _beat == "reveal" or _beat == "home":
		return
	_beat = "reveal"
	Report.line("BLACKBOX reveal after %d kills" % kills)
	if "--verify-exit" in OS.get_cmdline_user_args():
		Report.finish(get_tree())
		return
	Hud.clear_prompt()
	Hud.objective("Play the [recording]")
	await wait(1.5)
	await Hud.say("Mara Voss", "That's the last of them. Play it. Now, while I'm listening.")
	await Hud.say("Flight recorder", "Bridge core. Aster. Day two-one-four, zero five four eight.")
	await Hud.say("Captain Hale", "Captain's log. Real flight plan sealed. It lives on my console and nowhere else.", 4.0)
	await Hud.say("Flight recorder", "Zero five five two. Outbound transmission, long-range set, engineering. Encrypted.")
	await Hud.say("Flight recorder", "Destination: private relay, Hearth Station. Authorisation: R. Ayers.", 4.5)
	await Hud.say("Flight recorder", "Zero six one one. Pod launch, aft section. Zero six one two. Hull breach, keel.")
	await wait(0.6)
	await Hud.say("Mara Voss", "Renn.")
	await Hud.say("Mara Voss", "Renn Ayers sent your route to Hearth an hour before the Hollow came. And then she got in a pod.")
	await Hud.say("Mara Voss", "That pod salvage logged as empty? Rook's crew picked it up first. Rook has her, Kestrel. Rook has had her all along.")
	await Hud.say("Mara Voss", "Come home. We have work to do.")
	_beat = "home"
	Hud.objective("Warp back to [Hearth]", "Press G")
	Hud.prompt("[G] Warp drive", 0.0)

func _go_home() -> void:
	_beat = "going"
	Hud.clear_prompt()
	var dir := -FIELD_DIR.normalized()
	await warp(dir, 3.5, func():
		Hud.fade_out(0.6), "Hearth Station")
	var split := Flow.earn(6000)
	Flow.set_progress("act1_blackbox", true)
	Hud.fade_in(0.4)
	ship.park(true)
	await Hud.mission_passed("Black Box", split[0], split[1], Flow.debt())
	# A call nobody expected, from somewhere nobody goes.
	Sfx.play("alarm", -10.0, 1.4)
	await Hud.say("Hearth Traffic", "Kestrel, I've got a call for you routing up from... the surface? That can't be right.")
	await Hud.say("Renn Ayers", "Kestrel. It's Renn. Whatever you've heard, I'm not Rook's prisoner. I ran.")
	await Hud.say("Renn Ayers", "I'm on the ground, in the pillar country. Come alone and I'll give you Rook. I'll lay markers for you.")
	await Hud.say("Mara Voss", "Nobody goes down the well, Kestrel. ...Go anyway. I'll be on the channel.")
	Flow.go("descent")

## A slowly tumbling piece of wreckage.
class Tumbler extends Node3D:
	var spin := Vector3.ZERO
	func _ready() -> void:
		# Turning is per rendered frame (see _process below); interpolation
		# would render the same orientation between ticks.
		physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	func _process(dt: float) -> void:
		rotation += spin * dt
