extends Node3D
## Act Two: Lowdeck, on foot. Hearth's lower ring at night: the street, its
## people, the job board, the noodle stall, the Ninth Orbit where Vex sells
## work, the Lantern where Renn hides, and the lift up to the Kestrel's
## berth. The hub the second act runs through (Act2 has the stages).

const CROWD := ["crowd1", "crowd2", "crowd3", "crowd1", "crowd2", "crowd3", "crowd1", "crowd3", "crowd2", "crowd1"]
const CHATTER := [
	"Security's doubled the drones since the Aster. Like that helps anyone.",
	"Water ration's down again. Somebody upstairs is drinking ours.",
	"Rook's people were in the noodle bar last night. Nobody ordered after.",
	"You flying? Rim Charters pays double for anyone who'll go out to the Drift.",
	"Don't look at the drones. They log faces now.",
	"The rain's not rain, you know. It's the ring sweating.",
]

var set: Lowdeck
var player: Player
var renn: Companion
var vex: Person
var _talk_vex: Interactable
var _lantern: AutoDoor
var _lift: AutoDoor
var _seen := 0.0
var _busy := false
var _seen_label: Label3D
var _board_node: Node3D

func _ready() -> void:
	Act2.test_setup()
	set = Lowdeck.new()
	add_child(set)
	Walkways.bake(self, set.street, 0.5, AABB(Vector3(-11.5, -1.0, -58.0), Vector3(38.0, 4.0, 116.0)))
	var route: Array = []
	for z in range(-50, 54, 8):
		route.append(Vector3(-7.4 + randf_range(-1.2, 1.2), 0.15, z))
		route.append(Vector3(7.4 + randf_range(-1.2, 1.2), 0.15, z + 4))
	var n := CROWD.size() if Flow.high_quality() else 6
	for i in n:
		add_child(Wanderer.make(CROWD[i], route, set.benches, [CHATTER[i % CHATTER.size()]]))
	player = Player.new()
	add_child(player)
	var from_lift := Flow.beat == "lift"
	Flow.beat = ""
	player.position = set.spots["start"]
	player.face(Vector3(0.0, 1.6, 0.0))
	_places()
	Flow.music(false)
	match Act2.stage():
		0:
			_escort()
		1:
			_find_vex()
		2, 3, 4:
			_roam(from_lift)

# --- The places --------------------------------------------------------------------

func _places() -> void:
	# The Lantern: a door at the end of the alley nearest the clinic, a
	# small room behind it.
	var best: Node3D = null
	for a: Node3D in set.markers.get("alley", []):
		if a.global_position.x > 0.0 and (best == null or absf(a.global_position.z + 38.0) < absf(best.global_position.z + 38.0)):
			best = a
	var z := best.global_position.z if best else -38.0
	var x0 := 20.6
	_lantern = AutoDoor.make(Vector3(x0, 0.1, z), -PI / 2.0, Vector2(1.2, 2.1), 0.0)
	_lantern.locked = true
	_lantern.lock_text = "The Lantern's door is locked"
	add_child(_lantern)
	_lantern.passed.connect(_at_lantern)
	_room(Vector3(x0, 0.1, z))
	var sign := Label3D.new()
	sign.text = "THE LANTERN"
	sign.font = Style.sans_bold
	sign.font_size = 90
	sign.pixel_size = 0.006
	sign.modulate = Color(4.0, 1.4, 0.5)
	sign.position = Vector3(x0 - 0.1, 2.75, z)
	sign.rotation.y = -PI / 2.0
	add_child(sign)
	set.spots["safehouse"] = Vector3(x0 - 1.2, 0.15, z)
	# The Ninth Orbit's sign, where Vex works.
	set.rename_sign(set.spots["bar"], "THE NINTH ORBIT", Color(1.0, 0.25, 0.62))
	# The job board: a kiosk on the pavement.
	var t: Vector3 = set.spots["terminal"]
	var kiosk := MeshInstance3D.new()
	var km := BoxMesh.new()
	km.size = Vector3(0.6, 2.0, 1.2)
	km.material = Surfaces.get_material("metal_dark")
	kiosk.mesh = km
	kiosk.position = t + Vector3(0, 1.0, 0)
	add_child(kiosk)
	var screen := MeshInstance3D.new()
	var sm := BoxMesh.new()
	sm.size = Vector3(0.04, 0.8, 1.0)
	sm.material = Surfaces.get_material("screen")
	screen.mesh = sm
	screen.position = t + Vector3(0.31, 1.35, 0)
	add_child(screen)
	var jobs := Label3D.new()
	jobs.text = "JOBS"
	jobs.font = Style.mono_bold
	jobs.font_size = 72
	jobs.pixel_size = 0.006
	jobs.modulate = Color(0.7, 3.0, 3.6)
	jobs.position = t + Vector3(0.0, 2.25, 0)
	jobs.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	add_child(jobs)
	var board := Interactable.new(Vector3(1.0, 2.0, 1.4), "[E] Job board", 1.8)
	board.position = t + Vector3(0.6, 1.0, 0)
	add_child(board)
	board.activated.connect(_board)
	_board_node = board
	# The lift to the Kestrel's berth.
	var l: Vector3 = set.spots["lift"]
	_lift = AutoDoor.make(l, PI, Vector2(1.6, 2.4), 2.6)
	_lift.lock_text = "Your berth is on lockdown until you've seen Vex"
	add_child(_lift)
	_lift.passed.connect(_to_berth)
	var lift_sign := Label3D.new()
	lift_sign.text = "BERTH LIFT  ·  KESTREL"
	lift_sign.font = Style.mono_bold
	lift_sign.font_size = 64
	lift_sign.pixel_size = 0.006
	lift_sign.modulate = Color(0.7, 3.0, 3.6)
	lift_sign.position = l + Vector3(0, 2.9, -0.1)
	lift_sign.rotation.y = 0.0
	add_child(lift_sign)
	# The noodle stall: a cook, and something hot for twenty credits.
	var stalls: Array = set.markers.get("stall", [])
	if not stalls.is_empty():
		var s: Node3D = stalls[0]
		var cook := Person.make("crowd3")
		add_child(cook)
		var side := signf(s.global_position.x)
		cook.position = s.global_position + Vector3(side * 2.4, 0.0, 0.0)
		cook.rotation.y = -side * PI / 2.0
		var eat := Interactable.new(Vector3(1.4, 2.0, 2.6), "[E] Noodles  ·  ₡ 20", 1.8)
		eat.position = s.global_position + Vector3(0, 1.0, 0)
		add_child(eat)
		eat.activated.connect(_noodles)

## The Lantern's back room: walls, a ceiling, a cot, a table, one lamp.
func _room(door: Vector3) -> void:
	var depth := 4.0
	var w := 2.9
	var parts := [
		[Vector3(depth / 2.0, 2.9, 0.0), Vector3(depth, 0.1, w), "panel"],
		[Vector3(depth, 1.45, 0.0), Vector3(0.1, 2.9, w), "brick"],
		[Vector3(depth / 2.0, 1.45, -w / 2.0), Vector3(depth, 2.9, 0.1), "brick"],
		[Vector3(depth / 2.0, 1.45, w / 2.0), Vector3(depth, 2.9, 0.1), "brick"],
		[Vector3(0.0, 1.45, -1.05), Vector3(0.15, 2.9, 0.85), "brick"],
		[Vector3(0.0, 1.45, 1.05), Vector3(0.15, 2.9, 0.85), "brick"],
		[Vector3(0.0, 2.5, 0.0), Vector3(0.15, 0.8, 1.3), "brick"],
		[Vector3(depth - 0.6, 0.35, 0.8), Vector3(1.0, 0.4, 2.0), "linen"],
		[Vector3(depth - 1.7, 0.75, -0.8), Vector3(0.9, 0.06, 1.0), "counter"],
		[Vector3(depth - 0.08, 1.4, -0.7), Vector3(0.04, 0.6, 0.9), "screen"],
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = p[1]
		b.material = Surfaces.get_material(p[2])
		mi.mesh = b
		mi.position = door + p[0]
		add_child(mi)
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = p[1]
		cs.shape = shape
		body.add_child(cs)
		mi.add_child(body)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.7, 0.45)
	lamp.light_energy = 1.4
	lamp.omni_range = 5.0
	lamp.position = door + Vector3(depth / 2.0, 2.4, 0.0)
	add_child(lamp)

# --- Stage 0: Renn to the Lantern, unseen ----------------------------------------------------

func _escort() -> void:
	renn = Companion.make("renn", player)
	add_child(renn)
	renn.global_position = player.global_position + Vector3(-1.0, 0.0, 1.0)
	_seen_label = Label3D.new()
	_seen_label.font = Style.mono_bold
	_seen_label.font_size = 48
	_seen_label.pixel_size = 0.004
	_seen_label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_seen_label.no_depth_test = true
	_seen_label.position = Vector3(0, 2.2, 0)
	renn.add_child(_seen_label)
	_lantern.locked = false
	_lift.locked = true
	await get_tree().create_timer(0.8).timeout
	Hud.card("ACT TWO", "THE GOVERNOR  ·  HEARTH  ·  LOWDECK", 2.6)
	await get_tree().create_timer(2.8).timeout
	Hud.objective("Get Renn to [the Lantern] unseen", "Down the right side, the alley past the clinic")
	Hud.waypoint(_lantern, "THE LANTERN", 2.4)
	Hud.say("Mara Voss", "You're in Lowdeck. The Warden's drones log every face under their lights, and Renn's is on a list.")
	Hud.say("Mara Voss", "Keep her out of the beams. Wait for a drone to pass, then move. The Lantern's at the end of an alley, right side.")
	Hud.prompt("Drones sweep the street. Keep Renn out of their light: wait, then move", 8.0)

func _process(dt: float) -> void:
	if Act2.stage() == 0 and renn and not _busy:
		var lit := false
		for d: Node3D in get_tree().get_nodes_in_group("security_drone"):
			var off := Vector2(d.global_position.x - renn.global_position.x, d.global_position.z - renn.global_position.z)
			if off.length() < 2.6:
				lit = true
		_seen = clampf(_seen + (dt * 0.55 if lit else -dt * 0.25), 0.0, 1.0)
		_seen_label.visible = _seen > 0.02
		_seen_label.text = "SEEN %d%%" % int(_seen * 100.0)
		_seen_label.modulate = Color(4.0, 1.2, 0.4) if lit else Color(3.0, 2.8, 2.4)
		if lit and Engine.get_process_frames() % 30 == 0:
			Sfx.play("warn", -10.0)
		if _seen >= 1.0:
			_logged()

func _logged() -> void:
	_busy = true
	Report.line("LOWDECK renn logged")
	player.enabled = false
	Sfx.play("alarm", -4.0)
	await Hud.say("Hearth Security", "Face match: Ayers, Renn. Units to Lowdeck, level one.")
	await Hud.mission_failed("Renn was logged by a Security drone")
	Flow.go("lowdeck")

func _at_lantern() -> void:
	if _busy:
		return
	if Act2.stage() == 0:
		if renn and renn.global_position.distance_to(player.global_position) > 6.0:
			Hud.prompt("Wait for Renn", 2.0)
			_lantern.set("_passed", false)
			return
		_busy = true
		Report.line("LOWDECK lantern reached")
		Hud.waypoint(null)
		Hud.clear_prompt()
		player.enabled = false
		await get_tree().create_timer(0.6).timeout
		var cam := Shot3D.open(self)
		Hud.letterbox(true)
		renn.person.face(player.global_position)
		cam.frame(player.global_position + Vector3(0, 1.6, 0), renn.global_position + Vector3(0, 1.55, 0))
		renn.person.talk(true)
		await Hud.say("Renn Ayers", "Two days ago I was hiding in a hole in the ground. This is better. Barely.")
		await Hud.say("Renn Ayers", "Rook's ledger is on this drive. Every payment, every permit. But it's locked, and I can't open it.")
		await Hud.say("Renn Ayers", "There's a fixer upstairs, Vex, at the Ninth Orbit. She can break anything if you pay her enough.")
		await Hud.say("Mara Voss", "Vex. Of course it's Vex. Go and see her, Kestrel. I'll sit with Renn.")
		renn.person.talk(false)
		cam.done()
		Hud.letterbox(false)
		player.enabled = true
		renn.leader = null
		_seen_label.visible = false
		Act2.set_stage(1)
		_busy = false
		_find_vex()

# --- Stage 1: Vex -------------------------------------------------------------------------

func _place_vex() -> void:
	vex = Person.make("vex")
	add_child(vex)
	var b: Vector3 = set.spots["bar"]
	vex.position = b + Vector3(0.6, 0.0, 0.0)
	vex.rotation.y = PI / 2.0
	_talk_vex = Interactable.new(Vector3(1.2, 2.0, 1.2), "[E] Talk to Vex", 1.8)
	_talk_vex.position = vex.position + Vector3(0, 1.0, 0)
	add_child(_talk_vex)
	_talk_vex.activated.connect(_vex)

func _find_vex() -> void:
	_place_vex()
	_lift.locked = true
	await get_tree().create_timer(0.6).timeout
	Hud.objective("Find [Vex] at the Ninth Orbit", "Left side, under the pink sign")
	Hud.waypoint(vex, "VEX", 2.1)

func _vex() -> void:
	if _busy:
		return
	var s := Act2.stage()
	if s == 1:
		_busy = true
		Hud.waypoint(null)
		player.enabled = false
		var cam := Shot3D.open(self)
		Hud.letterbox(true)
		vex.face(player.global_position)
		cam.frame(player.global_position + Vector3(0, 1.6, 0), vex.global_position + Vector3(0, 1.6, 0))
		vex.talk(true)
		await Hud.say("Vex", "The Aster's ghost. Everybody on this ring knows your face, pilot. Sit with your back to the wall.")
		await Hud.say("Vex", "Rook's ledger? That's governor's business. Governor's business costs.")
		await Hud.say("Vex", "I don't want your money. You haven't got any. I want two jobs done, my board, your ship. Then we talk.")
		vex.talk(false)
		cam.done()
		Hud.letterbox(false)
		player.enabled = true
		Act2.set_stage(2)
		_busy = false
		_roam(false)
	elif s == 2:
		Hud.say("Vex", "%d of two. The board's by the kiosk, the lift's at the end." % Act2.jobs_done())
	elif s >= 3:
		Hud.say("Vex", "Okafor's waiting on you, not me. Go.")

# --- Stage 2 and on: the street is yours ---------------------------------------------------------

func _roam(from_lift: bool) -> void:
	if vex == null:
		_place_vex()
	_lift.locked = false
	if from_lift:
		player.position = set.spots["lift"] + Vector3(0, 0, -2.0)
		player.face(Vector3(0, 1.6, 0))
	await get_tree().create_timer(0.8).timeout
	var s := Act2.stage()
	if s == 2 and Act2.jobs_done() >= Act2.JOBS_FOR_VEX:
		Act2.set_stage(3)
		s = 3
		Sfx.play("objective", -6.0)
		await Hud.say("Vex", "Two jobs, clean. Fine. I've cracked the first layer of the ledger, and there's a name in it nobody owns: Okafor. A journalist.")
		await Hud.say("Vex", "He's coming in on a shuttle tonight, and the Warden knows. Get to him before Security does. Take the lift.")
	var held := Act2.active()
	if s == 3:
		Hud.objective("Meet [Okafor]'s shuttle in the Rim", "Take the lift to the Kestrel")
		Hud.waypoint(_lift, "LIFT", 2.6)
	elif not held.is_empty():
		Hud.objective("Job: [%s]" % held.title, "Take the lift to the Kestrel")
		Hud.waypoint(_lift, "LIFT", 2.6)
	elif s == 2:
		Hud.objective("Take a job from [the board]", "%d of %d for Vex" % [Act2.jobs_done(), Act2.JOBS_FOR_VEX])
		Hud.waypoint(_board_node, "JOBS", 2.2)
	else:
		Hud.objective("Lowdeck", "The board has work. The lift goes to the Kestrel.")
	if s == 4 and not Flow.progress("act2_part1_seen", false):
		Flow.set_progress("act2_part1_seen", true)
		Hud.card("ACT TWO", "PART ONE COMPLETE  ·  THE LEDGER IS OUT", 3.0)

func _board() -> void:
	var b := JobBoard.open(self)
	b.taken.connect(func(job: Dictionary):
		Sfx.play("objective", -6.0)
		Hud.objective("Job: [%s]" % job.title, "Take the lift to the Kestrel")
		Hud.waypoint(_lift, "LIFT", 2.6))

func _noodles() -> void:
	if not Flow.spend(20):
		Hud.say("Cook", "Twenty. You haven't got twenty. Come back when you have.")
		return
	Sfx.play("click", -4.0, 0.8)
	Hud.say("Cook", ["Extra chilli. You look like you need it.", "Eat it hot. The rain's cold tonight.", "The Aster pilot! On the house. ...No, it isn't."][randi() % 3])

func _to_berth() -> void:
	if _busy:
		return
	_busy = true
	Report.line("LOWDECK lift")
	Hud.waypoint(null)
	Flow.go("rim")
