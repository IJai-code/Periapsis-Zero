extends Node3D
## Act One: Hearth. Out of the medical bay into the concourse; people about
## their day; Mara at the far end by the docking bay. She has a first job:
## take the repaired Kestrel round the station and prove she still flies.

## What the crowd says to a passing pilot.
const CHATTER := [
	["That's the one they pulled out of the Aster field.", "Nine days on a beacon. I'd have gone mad.", "Water's up again. Third time this month."],
	["Don't stand there, I've got a shift.", "Rook's people were in the yard again last night.", "If you're flying for Mara, check your own seals."],
	["They say the Hollow don't take prisoners. They say a lot.", "The Moon colonies won't see that vaccine now.", "Mind the bench, it's wet."],
]

var _set: HearthConcourse
var _player: Player
var _mara: Person
var _talk: Interactable
var _door: Interactable
var _talked := false
var _leaving := false

func _ready() -> void:
	_set = HearthConcourse.new()
	add_child(_set)
	# The crowd: station people going about their day on paths baked from
	# the concourse's collision, so they walk round the benches and planters.
	Walkways.bake(self, _set)
	var spots := [Vector3(-1.6, 0, -4), Vector3(-1.6, 0, -16), Vector3(-1.6, 0, -28), Vector3(-2.6, 0, -37),
		Vector3(3.7, 0, -6), Vector3(3.7, 0, -18), Vector3(3.7, 0, -30), Vector3(3.7, 0, -40),
		Vector3(-4.5, 0, -10), Vector3(-4.5, 0, -26), Vector3(5.0, 0, -12), Vector3(5.0, 0, -36)]
	var i := 0
	for who in ["crowd1", "crowd2", "crowd3", "crowd1", "crowd2", "crowd3"]:
		add_child(Wanderer.make(who, spots, _set.benches, CHATTER[i % CHATTER.size()]))
		i += 1
	_mara = Person.make("mara")
	add_child(_mara)
	_mara.position = Vector3(-0.5, 0.0, -41.0)
	_mara.rotation.y = 0.0
	_mara.add_to_group("walker")
	_player = Player.new()
	add_child(_player)
	_player.position = Vector3(-1.0, 0.05, -1.2)
	_player.face(Vector3(-1.0, 1.6, -20.0))
	_talk = Interactable.new(Vector3(1.0, 2.0, 1.0), "[E] Talk to Mara", 1.6)
	_talk.position = Vector3(-0.5, 1.0, -41.0)
	add_child(_talk)
	_talk.activated.connect(_job)
	_door = Interactable.new(Vector3(3.2, 3.0, 0.6), "", 2.0)
	_door.position = Vector3(-1.0, 1.5, -43.6)
	add_child(_door)
	_door.activated.connect(_leave)
	Flow.music(false)
	_script()

func _script() -> void:
	await get_tree().create_timer(0.8).timeout
	Hud.card("ACT ONE", "HEARTH STATION · EARTH-MOON L1", 2.4)
	await get_tree().create_timer(1.4).timeout
	Hud.objective("Find [Mara] by the docking bay", "Along the concourse")
	Hud.waypoint(_mara, "MARA", 2.1)
	Hud.prompt("[C] Crouch    [Space] Jump    [E] Sit on a bench", 6.0)
	_announcements()

## The station's public address, every so often, while the player is here.
func _announcements() -> void:
	var lines := [
		"Hearth Station reminds residents that water rationing begins at eighteen hundred.",
		"The Calloway Star is now boarding at berth four for Harbor and the Moon.",
		"A memorial for the crews of the Aster convoy will be held in the chapel, deck two.",
		"Residents are reminded that unlicensed lending is a crime on Hearth. Report it.",
	]
	var i := 0
	await get_tree().create_timer(14.0).timeout
	while is_inside_tree() and not _leaving:
		if not Hud.cinematic:
			Sfx.play("objective", -18.0, 0.7)
			Hud.say("Hearth PA", lines[i % lines.size()], 5.0)
		i += 1
		await get_tree().create_timer(32.0).timeout

func _process(_dt: float) -> void:
	if not _talked:
		Hud.objective_extra("%d m" % int(maxf(0.0, _player.global_position.distance_to(_mara.global_position) - 1.0)))

func _job() -> void:
	if _talked:
		return
	_talked = true
	_talk.set_meta("prompt", "")
	Hud.clear_prompt()
	Hud.waypoint(null)
	Hud.silence()
	_player.enabled = false
	_player.face(_mara.global_position + Vector3(0, 1.6, 0))
	_mara.face(_player.global_position)
	await get_tree().create_timer(0.5).timeout
	var cam := Shot3D.open(self)
	Hud.letterbox(true)
	cam.frame(_player.global_position + Vector3(0, 1.6, 0), _mara.global_position + Vector3(0, 1.62, 0))
	_mara.talk(true)
	await Hud.say("Mara Voss", "On your feet. Good. Your Kestrel's out of the yard, patched and fuelled. Rook's paying for that too, by the way.")
	await Hud.say("Mara Voss", "His people will find you before the day's out. When they do, don't sign anything.")
	await Hud.say("Mara Voss", "Before I send you after anyone, I want to see you fly. Take her round Hearth. Six beacons, tight.")
	await Hud.say("Mara Voss", "Bring her back in one piece and I'll pay you. It's not charity. You'll need every credit.")
	_mara.talk(false)
	cam.done()
	Hud.letterbox(false)
	_player.enabled = true
	_door.set_meta("prompt", "[E] Go through to the docking bay")
	Hud.objective("Go to the [docking bay]", "The big door behind Mara")
	Hud.waypoint(_door, "DOCKING BAY", 0.6)

func _leave() -> void:
	if not _talked or _leaving:
		return
	_leaving = true
	_player.enabled = false
	Hud.clear_prompt()
	Hud.waypoint(null)
	Sfx.play("door", -2.0)
	Flow.go("hearth_bay")
