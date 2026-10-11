extends FlightScene
## Prologue, part two: escort, ambush, the loss of the Aster, escape.
## Teaches flying (mouse, thrust, strafe, roll), fighting (lock, lead, fire,
## missiles, the capacitor) and boost, each the moment it is needed. The
## player cannot die here; the story decides how this ends.
##
## For checks, `-- --beat ambush|strike|escape` starts partway in.

const SUN := Vector3(0.6, 0.3, 0.75)
const FORMATION := Vector3(-95.0, 6.0, -20.0)

var aster: Hull
var raiders: Array = []
var kills := 0
var _beat := ""
var _clock := 0.0
var _taught_cap := false
var _taught_lock := false

func _ready() -> void:
	setup_flight(SUN, 1.05)
	add_child(Earth.toward(Vector3(-0.3, -0.6, -0.75), 14_000_000.0, SUN, 0.003))
	_convoy()
	ship.floor_integrity = 12.0
	ship.global_position = Vector3(40.0, -30.0, 150.0)
	ship.look_at(Vector3(-40.0, -10.0, 0.0))
	ship.aim = -ship.global_basis.z
	ship.velocity = -ship.global_basis.z * 30.0
	hud.enemies = raiders
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
	super(dt)
	_clock += dt
	if _beat == "ambush" and not _taught_cap and ship.capacitor < 35.0:
		_taught_cap = true
		Hud.prompt("Guns and boost draw on the capacitor, the ring of cells at the bottom. Fire in bursts.", 7.0)

# --- The convoy -------------------------------------------------------------

func _convoy() -> void:
	aster = Hull.new()
	aster.team = "player"
	aster.display_name = "Aster"
	aster.ship_class = "Bulk freighter"
	aster.radius = 60.0
	aster.integrity = 100.0
	aster.max_integrity = 100.0
	# The Hollow's guns scar her; the torpedoes are what kill her.
	aster.floor_integrity = 62.0
	var m := Hull.model("freighter")
	aster.add_child(m)
	aster.body = m
	Surfaces.collide(m)
	add_child(aster)
	aster.rotation_degrees = Vector3(0.0, 8.0, 0.0)
	for c in [["freighter2", Vector3(-230.0, -40.0, 90.0), "Meridian"], ["freighter3", Vector3(-180.0, 45.0, 280.0), "Calloway"], ["freighter2", Vector3(60.0, -70.0, 470.0), "Brightwater"], ["freighter3", Vector3(-320.0, 10.0, -160.0), "Juno"]]:
		var other := Hull.model(c[0])
		add_child(other)
		other.position = c[1]
		other.rotation_degrees = Vector3(0.0, randf_range(4.0, 12.0), 0.0)
		Surfaces.collide(other)
		FlightHud.mark(other, c[2], "Freighter", "friendly")

# --- Beats ------------------------------------------------------------------

func _launch() -> void:
	_beat = "launch"
	await wait(0.8)
	Hud.prompt("Click to take the controls", 0.0)
	await Hud.say("Captain Hale", "Good launch, Kestrel. Take station off our port side.")
	set_goal(aster.to_global(FORMATION), "STATION")
	Hud.objective("Take station beside the [Aster]")
	Hud.prompt("[Mouse] steer    [W] speed up    [S] slow down", 0.0)
	var taught_strafe := false
	while ship.global_position.distance_to(_goal_node.global_position) > 30.0:
		await get_tree().process_frame
		if not taught_strafe and _clock > 12.0:
			taught_strafe = true
			Hud.prompt("[A][D] slide    [Q][E] roll    [V] wider view", 0.0)
	Sfx.play("objective", -6.0)
	_hold()

func _hold() -> void:
	_beat = "hold"
	clear_goal()
	Hud.objective("Fly [escort]", "Hold station by the Aster")
	Hud.prompt("Everything in space is listed on the overview, right. Nearest first.", 7.0)
	await Hud.say("Captain Hale", "Good. Ninety minutes to the Moon corridor. Settle in.")
	await Hud.say("Tamsin", "Aster, Meridian. Holding two kilometres astern. Our reefers are running warm.")
	await Hud.say("Captain Hale", "Copy, Tamsin. Keep them cold. Every vial is a kid in Tycho.")
	await Hud.say("Captain Hale", "Renn, you're off the board. Where are you?")
	await Hud.say("Renn Ayers", "Aft relays, Captain. Something's arcing back here. Two minutes.")
	await Hud.say("Captain Hale", "Make it one.")
	await wait(2.0)
	_ambush()

func _ambush() -> void:
	_beat = "ambush"
	clear_goal()
	Sfx.play("alarm", -4.0)
	hud.protect = aster
	await Hud.say("Captain Hale", "Contacts! Four ships out of the sun, no transponders. That's the Hollow. Weapons free, Kestrel!", 4.0)
	for i in 4:
		_spawn(aster.global_position + SUN.normalized() * 1400.0 + Vector3(randf_range(-150, 150), randf_range(-100, 100), randf_range(-150, 150)), aster if i % 2 == 0 else ship)
	Hud.objective("Protect the [Aster]", "0 / 4 raiders")
	Hud.prompt("Hold the reticle on a raider to lock it, or press [T]. Then fire at the diamond: that's where it will be.", 0.0)

func _spawn(at: Vector3, target: Hull) -> Raider:
	var r := spawn_raider(at, target, false, [aster])
	r.died.connect(_raider_down.bind(r))
	raiders.append(r)
	return r

func _raider_down(r: Raider) -> void:
	raiders.erase(r)
	raider_destroyed(r)
	kills += 1
	if _beat == "ambush":
		Hud.objective_extra("%d / 4 raiders" % kills)
		if kills == 1:
			Hud.prompt("[Right click] or [R] fires missiles at the locked target. Under fire? Double-tap [A] or [D] to barrel roll.", 8.0)
			Hud.say("Renn Ayers", "Good kill! They're not after the cargo. They're going for our engines.")
		if kills >= 3:
			_strike()

func _strike() -> void:
	if _beat == "strike" or _beat == "escape":
		return
	_beat = "strike"
	hud.protect = aster
	for i in 2:
		_spawn(aster.global_position + Vector3(randf_range(-300, 300), randf_range(-200, 200), -600.0), aster)
	Sfx.play("alarm", 0.0)
	# A cutscene: the camera pulls out to watch her die.
	ship.controls = false
	ship.weapons = false
	hud.visible = false
	Hud.letterbox(true)
	var cine := Camera3D.new()
	cine.fov = 34.0
	cine.far = 120_000.0
	add_child(cine)
	var side := aster.global_basis.x
	cine.global_position = aster.global_position + side * 250.0 + Vector3(0, 170, 0) + aster.global_basis.z * 60.0
	cine.look_at(aster.global_position + Vector3(0, -5, 0))
	cine.make_current()
	create_tween().tween_property(cine, "global_position", aster.global_position + side * 200.0 + Vector3(0, 130, 0) + aster.global_basis.z * 40.0, 9.0).set_trans(Tween.TRANS_SINE)
	aster.floor_integrity = 5.0
	await Hud.say("Tamsin", "Aster, you've got a pod away! Aft section! Who's in it?", 3.0)
	await Hud.say("Captain Hale", "Torpedoes, two of them, under the keel. Brace, brace!", 3.0)
	for k in 6:
		var at := aster.global_position + aster.global_basis * Vector3(randf_range(-10, 10), randf_range(-8, 8), randf_range(-60, 50))
		Fx.explode(self, at, randf_range(12.0, 20.0))
		aster.integrity = maxf(aster.floor_integrity, aster.integrity - 15.0)
		_shake(cine, 0.4)
		await wait(randf_range(0.45, 0.8))
	Hud.say("Captain Hale", "They knew our route. Kestrel, they knew exactly wh—", 3.0)
	await wait(2.4)
	Hud.silence()
	# The reactor goes: the Aster comes apart along her modules.
	aster.destroy(55.0, 12.0)
	for k in 4:
		Fx.explode(self, aster.global_position + aster.global_basis * Vector3(randf_range(-20, 20), randf_range(-15, 15), randf_range(-70, 60)), randf_range(18.0, 28.0), k == 0)
	var flash := OmniLight3D.new()
	flash.light_energy = 40.0
	flash.omni_range = 900.0
	flash.light_color = Color(1.0, 0.75, 0.5)
	add_child(flash)
	flash.global_position = aster.global_position
	create_tween().tween_property(flash, "light_energy", 0.0, 3.0)
	_shake(cine, 1.2)
	Fx.hitstop(get_tree(), 0.9, 0.3)
	hud.protect = null
	await wait(3.2)
	# Back to the chase view, the wreck behind.
	ship.camera.make_current()
	cine.queue_free()
	Hud.letterbox(false)
	hud.visible = true
	ship.controls = true
	ship.weapons = true
	ship.shake = 1.0
	_escape()

func _shake(cam: Camera3D, amount: float) -> void:
	var base := cam.rotation
	var t := create_tween()
	for i in 6:
		t.tween_property(cam, "rotation", base + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.012 * amount * (1.0 - i / 6.0), 0.04)
	t.tween_property(cam, "rotation", base, 0.06)

func _escape() -> void:
	_beat = "escape"
	hud.protect = null
	if aster.alive:
		aster.destroy(60.0, 14.0)
	var away := (ship.global_position - aster.global_position)
	away.y = 0.0
	away = (away.normalized() if away.length() > 1.0 else Vector3.BACK)
	set_goal(aster.global_position + away * 1500.0 + Vector3(0, -200, 0), "CLEAR")
	Hud.objective("Get clear of the [wreck]")
	Hud.prompt("Hold [Shift] to boost", 0.0)
	for r in raiders:
		r.target = ship
	await Hud.say("Renn Ayers", "Kestrel, it's Renn. I'm in a pod, I got out. The fuel tanks are next. Get out of there!", 4.5)
	var t := 0.0
	while ship.global_position.distance_to(aster.global_position) < 900.0 and t < 35.0:
		await get_tree().process_frame
		t += get_process_delta_time()
	_end()

func _end() -> void:
	_beat = "end"
	clear_goal()
	Hud.clear_prompt()
	Hud.clear_objective()
	ship.controls = false
	# The second blast catches the Kestrel anyway.
	Fx.explode(self, ship.global_position + Vector3(randf_range(-30, 30), 20.0, 60.0), 40.0)
	ship.shake = 1.5
	hud.flash()
	Sfx.play("alarm", -2.0)
	await Hud.say("Kestrel", "Hull breach. Main power lost. Distress beacon active.", 3.2)
	await wait(0.6)
	Flow.go("arrival")
