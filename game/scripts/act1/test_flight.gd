extends FlightScene
## Act One, first job: Mara's test flight. Out of Hearth's bay, through six
## beacons round the station against the clock, and back into the bay.
## Station traffic runs its lanes; Hearth Traffic Control keeps weapons
## locked inside its zone. Halfway round, Rook calls. Paid on docking (a
## fast run pays a bonus), and then Mara has news that will not wait.

const SUN := Vector3(0.5, 0.35, 0.8)
const PAR := 100.0
const BAY := Vector3(0, 0, -92)
const BEACONS := [Vector3(0, 15, -420), Vector3(150, 30, -120), Vector3(170, -20, 40), Vector3(40, 110, 30),
	Vector3(-150, 20, 20), Vector3(-90, -40, -150)]

var station: Node3D
var _spin: Node3D
var _beacons: Array[MeshInstance3D] = []
var _next := 0
var _clock := 0.0
var _timing := false
var _docking := false
var _rook_called := false
var _timer_label: Label

func _ready() -> void:
	setup_flight(SUN, 1.0)
	add_child(Earth.toward(Vector3(-0.3, -0.5, 1.0), 9_000_000.0, SUN, 0.003))
	station = load("res://art/station-hearth.glb").instantiate()
	add_child(station)
	Surfaces.apply(station)
	Surfaces.collide(station)
	FlightHud.mark(station, "Hearth Station", "Station · L1", "structure")
	_spin = station.find_child("ring", true, false)
	var traffic := Traffic.new()
	traffic.lanes = [[Vector3(-600, 80, -500), Vector3(2600, 300, -2600)], [Vector3(500, -120, 300), Vector3(-2600, -400, 2400)],
		[Vector3(-400, 200, 400), Vector3(-1800, 900, -2600)]]
	add_child(traffic)
	ship.floor_integrity = 30.0
	ship.weapons = false
	ship.global_position = Vector3(0, 0, -112)
	ship.look_at(Vector3(0, 0, -300))
	ship.aim = -ship.global_basis.z
	ship.velocity = -ship.global_basis.z * 8.0
	ship.cruise = 8.0
	_timer_label = Style.label("", 30, Style.BONE, Style.mono_bold)
	_timer_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_timer_label.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_timer_label.offset_top = 30
	_timer_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_timer_label.add_theme_constant_override("outline_size", 8)
	_timer_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	overlay.add_child(_timer_label)
	for i in BEACONS.size():
		var b := _beacon()
		add_child(b)
		b.global_position = BEACONS[i]
		_beacons.append(b)
	Flow.music(true)
	if "--passed" in OS.get_cmdline_user_args():
		_clock = 84.2
		_dock()
		return
	_start()

func _beacon() -> MeshInstance3D:
	var t := TorusMesh.new()
	t.inner_radius = 13.0
	t.outer_radius = 15.0
	t.rings = 48
	t.ring_segments = 8
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(0.4, 0.4, 0.45)
	t.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = t
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

func _light(i: int) -> void:
	for k in _beacons.size():
		var m := (_beacons[k].mesh as TorusMesh).material as StandardMaterial3D
		FlightHud.unmark(_beacons[k])
		if k < i:
			_beacons[k].visible = false
		elif k == i:
			m.albedo_color = Color(Style.ION.r * 2.5, Style.ION.g * 2.5, Style.ION.b * 2.5)
			FlightHud.mark(_beacons[k], "Beacon %d" % (k + 1), "Course marker", "objective")
		else:
			m.albedo_color = Color(0.45, 0.45, 0.5)
	if i < _beacons.size():
		set_goal(_beacons[i].global_position, "BEACON %d" % (i + 1), false)

func _start() -> void:
	await wait(0.8)
	Hud.card("Test Flight", "HEARTH STATION · FOR MARA VOSS", 2.2)
	Hud.prompt("Click to take the controls", 6.0)
	await Hud.say("Hearth Traffic", "Kestrel, Hearth Traffic. You're out of berth nine. Weapons stay locked inside ten kilometres, station rules.")
	await Hud.say("Hearth Traffic", "Mind the tugs. They don't mind you.")
	await Hud.say("Mara Voss", "Six beacons, in order, then back into the bay. The clock starts at the first one. Show me what the yard fixed.")
	Hud.objective("Fly through the [beacons]", "0 / 6")
	_light(0)

func _process(dt: float) -> void:
	super(dt)
	if _spin:
		_spin.rotate_object_local(Vector3.UP, dt * 0.04)
	if _timing:
		_clock += dt
	_timer_label.text = ("%d:%04.1f" % [int(_clock) / 60, fmod(_clock, 60.0)]) if _clock > 0.0 else ""
	# Each beacon turns its open face to the ship.
	for b in _beacons:
		if b.visible:
			b.look_at(ship.global_position, Vector3.UP)
			b.rotate_object_local(Vector3.RIGHT, PI / 2)
	if _next < BEACONS.size():
		if ship.global_position.distance_to(BEACONS[_next]) < 15.0:
			Sfx.play("objective", -4.0, 1.0 + _next * 0.08)
			if _next == 0:
				_timing = true
			_next += 1
			Hud.objective_extra("%d / 6" % _next)
			_light(_next)
			if _next == 3 and not _rook_called:
				_rook()
			if _next == BEACONS.size():
				_return()
	elif not _docking and ship.global_position.distance_to(BAY) < 30.0:
		_dock()

## Rook introduces himself.
func _rook() -> void:
	_rook_called = true
	await wait(1.0)
	await Hud.say("Rook", "Pilot. Don't hang up, it's rude, and I paid for your lungs.")
	await Hud.say("Rook", "Forty thousand to drag you out of that field. I'm not a charity. I'm an investor.")
	await Hud.say("Rook", "When I call, you'll fly for me. Until then, enjoy the station. It's lovely this time of year.")
	await Hud.say("Mara Voss", "Was that Rook? Don't answer him again. Fly.")

func _return() -> void:
	set_goal(BAY, "HEARTH BAY", false)
	Hud.objective("Fly back into [Hearth's bay]", "The lit ring at the station's nose")
	await Hud.say("Hearth Traffic", "Kestrel, you're cleared to berth nine. Slow on the approach, the bay's tighter than it looks.")

func _dock() -> void:
	_docking = true
	_timing = false
	ship.controls = false
	clear_goal()
	hud.visible = false
	Hud.clear_objective()
	var from := ship.global_transform
	var to := Transform3D(Basis.looking_at(Vector3(0, 0, 1)), Vector3(0, 0, -86))
	var t := create_tween()
	t.tween_method(func(k: float):
		ship.global_transform = from.interpolate_with(to, k)
		ship.velocity = Vector3.ZERO, 0.0, 1.0, 3.0).set_trans(Tween.TRANS_SINE)
	Sfx.play("door", -4.0, 0.7)
	await t.finished
	var bonus := 1500 if _clock < PAR else 0
	var pay := 2500 + bonus
	var split := Flow.earn(pay)
	Flow.set_progress("test_flight_best", minf(float(Flow.progress("test_flight_best", 9999.0)), _clock))
	Flow.set_progress("act1_test_flight", true)
	await Hud.say("Mara Voss", "She flies. %s" % ("And so do you. Fast, too." if bonus > 0 else "So do you, mostly."), 3.0)
	_timer_label.visible = false
	await Hud.mission_passed("Test Flight · %d:%04.1f%s" % [int(_clock) / 60, fmod(_clock, 60.0), "  ·  fast-run bonus" if bonus > 0 else ""], split[0], split[1], Flow.debt())
	# Mara has come from the yard, and it will not wait.
	await Hud.say("Mara Voss", "Stay in the seat. I've just come from the yard.")
	await Hud.say("Mara Voss", "Your recorder's been wiped. Clean. Somebody on this station did it while you were in the medbay.")
	await Hud.say("Mara Voss", "But the Aster carried two. There's a crash core in the bridge, and it'll still be pinging out in that field.")
	await Hud.say("Mara Voss", "Go now, before whoever wiped yours goes looking for it. I'll talk you through it.")
	Flow.go("blackbox")
