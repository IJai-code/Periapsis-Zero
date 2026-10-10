extends Node3D
## Prologue, part two: escort, ambush, the loss of the Aster, escape.
## Teaches flying (mouse, thrust, strafe, roll), fighting (fire, lead,
## barrel roll) and boost, each the moment it is needed. The player cannot
## die here; the story decides how this ends.
##
## For checks, `-- --beat ambush|strike|escape` starts partway in.

const SUN := Vector3(0.6, 0.3, 0.75)
const FORMATION := Vector3(-95.0, 6.0, -20.0)

var ship: PlayerShip
var aster: Hull
var bolts: Bolts
var hud: FlightHud
var raiders: Array = []
var kills := 0
var _beat := ""
var _goal: Node3D
var _ring: MeshInstance3D
var _clock := 0.0

func _ready() -> void:
	Space.environment(self, SUN, 1.05)
	add_child(Earth.below(420_000.0, SUN))
	bolts = Bolts.new()
	add_child(bolts)
	_convoy()
	ship = PlayerShip.new()
	ship.bolts = bolts
	ship.floor_integrity = 12.0
	add_child(ship)
	ship.global_position = Vector3(40.0, -30.0, 150.0)
	ship.look_at(Vector3(-40.0, -10.0, 0.0))
	ship.aim = -ship.global_basis.z
	ship.velocity = -ship.global_basis.z * 30.0
	ship.damaged.connect(func(_a):
		hud.flash()
		ship.shake = maxf(ship.shake, 0.6))
	var layer := CanvasLayer.new()
	layer.layer = 5
	add_child(layer)
	hud = FlightHud.new()
	hud.ship = ship
	hud.enemies = raiders
	layer.add_child(hud)
	_goal = Node3D.new()
	add_child(_goal)
	_ring = _make_ring()
	add_child(_ring)
	_ring.visible = false
	Flow.music(true)
	var args := OS.get_cmdline_user_args()
	var i := args.find("--beat")
	var start: String = args[i + 1] if i >= 0 and i + 1 < args.size() else Flow.beat
	match start:
		"ambush": _ambush()
		"strike": _strike()
		"escape": _escape()
		_: _launch()

func _process(dt: float) -> void:
	_clock += dt
	_ring.global_position = _goal.global_position
	if _ring.visible:
		_ring.look_at(ship.camera.global_position)
		_ring.rotate_object_local(Vector3.RIGHT, PI / 2)

# --- The convoy -------------------------------------------------------------

func _convoy() -> void:
	aster = Hull.new()
	aster.team = "player"
	aster.radius = 48.0
	aster.integrity = 100.0
	aster.max_integrity = 100.0
	aster.floor_integrity = 8.0
	var m := Hull.model("freighter")
	m.scale = Vector3.ONE * 1.15
	aster.add_child(m)
	add_child(aster)
	aster.rotation_degrees = Vector3(0.0, 8.0, 0.0)
	for c in [["mule", Vector3(130.0, -25.0, 90.0), 1.2], ["freighter", Vector3(-170.0, 35.0, 190.0), 0.95], ["mule", Vector3(70.0, 45.0, 290.0), 1.2], ["mule", Vector3(-60.0, -50.0, 380.0), 1.2]]:
		var other := Hull.model(c[0])
		other.scale = Vector3.ONE * c[2]
		add_child(other)
		other.position = c[1]
		other.rotation_degrees = Vector3(0.0, randf_range(4.0, 12.0), 0.0)

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

func _set_goal(at: Vector3, label: String) -> void:
	_goal.global_position = at
	hud.goal = _goal
	hud.goal_label = label
	_ring.visible = true

func _clear_goal() -> void:
	hud.goal = null
	_ring.visible = false

func _wait(seconds: float) -> void:
	await get_tree().create_timer(seconds).timeout

# --- Beats ------------------------------------------------------------------

func _launch() -> void:
	_beat = "launch"
	await _wait(0.8)
	Hud.prompt("Click to take the controls", 0.0)
	await Hud.say("Captain Hale", "Kestrel, Aster. You're clear of the deck. Take station off our port side.")
	_set_goal(aster.to_global(FORMATION), "STATION")
	Hud.objective("Take station beside the Aster")
	Hud.prompt("[Mouse] steer    [W] thrust    [S] slow down", 0.0)
	var taught_strafe := false
	while ship.global_position.distance_to(_goal.global_position) > 30.0:
		await get_tree().process_frame
		if not taught_strafe and _clock > 12.0:
			taught_strafe = true
			Hud.prompt("[A][D] slide sideways    [Q][E] roll    [W][S] speed", 0.0)
	Sfx.play("objective", -6.0)
	_hold()

func _hold() -> void:
	_beat = "hold"
	Hud.objective("Fly escort", "Hold station by the Aster")
	Hud.prompt("Match the convoy: ease off with [S]", 6.0)
	await Hud.say("Captain Hale", "Good. Ninety minutes to the Moon corridor.")
	await Hud.say("Renn Ayers", "Medical cargo and six old ships. Nobody bothers a convoy like this.")
	await Hud.say("Captain Hale", "The Hollow have hit three convoys this month, Renn. None of them on our route.")
	await _wait(1.5)
	_ambush()

func _ambush() -> void:
	_beat = "ambush"
	_clear_goal()
	Sfx.play("alarm", -4.0)
	hud.protect = aster
	await Hud.say("Captain Hale", "Contacts! Four ships out of the sun. No transponders. Weapons free, Kestrel!", 4.0)
	for i in 4:
		_spawn_raider(aster.global_position + SUN.normalized() * 1400.0 + Vector3(randf_range(-150, 150), randf_range(-100, 100), randf_range(-150, 150)), aster if i % 2 == 0 else ship)
	Hud.objective("Protect the Aster", "0 / 4 raiders")
	Hud.prompt("[Click] fire    Aim at the ◇ to lead your shots", 0.0)

func _spawn_raider(at: Vector3, target: Hull) -> Raider:
	var r := Raider.new()
	r.bolts = bolts
	r.target = target
	r.avoid = [aster]
	add_child(r)
	r.global_position = at
	r.look_at(target.global_position)
	r.died.connect(_raider_down.bind(r))
	raiders.append(r)
	return r

func _raider_down(r: Raider) -> void:
	Fx.explode(self, r.global_position, 9.0)
	Fx.debris(self, r.global_position, 8, 1.5, 40.0, Surfaces.get_material("hull"))
	raiders.erase(r)
	r.queue_free()
	kills += 1
	ship.shake = maxf(ship.shake, 0.3)
	if _beat == "ambush":
		Hud.objective_extra("%d / 4 raiders" % kills)
		if kills == 1:
			Hud.prompt("Under fire? Double-tap [A] or [D] to barrel roll", 7.0)
			Hud.say("Renn Ayers", "Good kill! They're not after the cargo. They're going for our engines.")
		if kills >= 3:
			_strike()

func _strike() -> void:
	if _beat == "strike" or _beat == "escape":
		return
	_beat = "strike"
	hud.protect = aster
	for i in 2:
		_spawn_raider(aster.global_position + Vector3(randf_range(-300, 300), randf_range(-200, 200), -600.0), aster)
	Sfx.play("alarm", 0.0)
	# Turn the player to watch it happen; they can look away.
	ship.aim = (aster.global_position - ship.global_position).normalized()
	await Hud.say("Captain Hale", "Torpedoes, two of them, under the keel. Brace, brace!", 3.0)
	for k in 6:
		var at := aster.global_position + aster.global_basis * Vector3(randf_range(-14, 14), randf_range(-8, 8), randf_range(-45, 45))
		Fx.explode(self, at, randf_range(10.0, 18.0))
		aster.integrity = maxf(aster.floor_integrity, aster.integrity - 15.0)
		ship.shake = maxf(ship.shake, 0.5)
		await _wait(randf_range(0.4, 0.8))
	Hud.say("Captain Hale", "They knew our route. Kestrel, they knew exactly wh—", 3.0)
	await _wait(2.4)
	Hud.silence()
	# The reactor goes.
	Fx.explode(self, aster.global_position, 60.0)
	Fx.debris(self, aster.global_position, 70, 7.0, 55.0, Surfaces.get_material("hull"))
	Fx.debris(self, aster.global_position, 30, 3.0, 90.0, Surfaces.get_material("frame"))
	var flash := OmniLight3D.new()
	flash.light_energy = 40.0
	flash.omni_range = 900.0
	flash.light_color = Color(1.0, 0.75, 0.5)
	add_child(flash)
	flash.global_position = aster.global_position
	create_tween().tween_property(flash, "light_energy", 0.0, 3.0)
	aster.visible = false
	aster.alive = false
	hud.protect = null
	ship.shake = 1.2
	await _wait(1.6)
	_escape()

func _escape() -> void:
	_beat = "escape"
	hud.protect = null
	if aster.visible:
		aster.visible = false
		aster.alive = false
	var away := (ship.global_position - aster.global_position)
	away.y = 0.0
	away = (away.normalized() if away.length() > 1.0 else Vector3.BACK)
	_set_goal(aster.global_position + away * 1500.0 + Vector3(0, -200, 0), "CLEAR")
	Hud.objective("Get clear of the wreck")
	Hud.prompt("Hold [Shift] to boost", 0.0)
	for r in raiders:
		r.target = ship
	await Hud.say("Renn Ayers", "Kestrel, this is Renn, I'm in a pod. The fuel tanks are next. Get out of there!", 4.5)
	var t := 0.0
	while ship.global_position.distance_to(aster.global_position) < 900.0 and t < 35.0:
		await get_tree().process_frame
		t += get_process_delta_time()
	_end()

func _end() -> void:
	_beat = "end"
	_clear_goal()
	Hud.clear_prompt()
	Hud.clear_objective()
	ship.controls = false
	# The second blast catches the Kestrel anyway.
	Fx.explode(self, ship.global_position + Vector3(randf_range(-30, 30), 20.0, 60.0), 40.0)
	ship.shake = 1.5
	hud.flash()
	Sfx.play("alarm", -2.0)
	await Hud.say("Kestrel", "Hull breach. Main power lost. Beacon active.", 3.2)
	await _wait(0.6)
	Flow.go("arrival")
