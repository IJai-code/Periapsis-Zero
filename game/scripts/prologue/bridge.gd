extends Node3D
## Prologue, part one-and-a-half: the bridge. The player meets Captain Hale
## and Renn Ayers in person, learns what the convoy carries and what has
## been happening to convoys, and is sent to the flight deck.

var _walker: Player
var _hale: Person
var _renn: Person
var _talk: Interactable
var _hatch: AutoDoor
var _talked := false
var _leaving := false

func _ready() -> void:
	var room := AsterBridge.new()
	add_child(room)
	# The doors open for the pilot (the set's own are taken out): the hatch
	# to the flight deck once the captain has briefed them, the way back aft
	# stays shut.
	Surfaces.remove_named(room, "doors")
	var aft := AutoDoor.make(Vector3(0.0, 0.0, -0.05), PI, Vector2(1.2, 2.1))
	aft.locked = true
	add_child(aft)
	_hale = Person.make("hale")
	add_child(_hale)
	_hale.position = Vector3(0.0, 0.0, -8.1)
	_hale.rotation.y = PI       # at the window, back to the room
	_renn = Person.make("renn")
	add_child(_renn)
	_renn.position = Vector3(-2.2, 0.0, -4.35)
	_renn.rotation.y = PI       # at her console
	_walker = Player.new()
	add_child(_walker)
	_walker.position = Vector3(1.0, 0.1, -1.6)
	_walker.face(Vector3(0.0, 1.6, -8.1))
	_talk = Interactable.new(Vector3(1.4, 2.0, 1.4), "[E] Talk to Captain Hale")
	_talk.position = Vector3(0.0, 1.0, -8.1)
	add_child(_talk)
	_talk.activated.connect(_briefing)
	_hatch = AutoDoor.make(Vector3(5.16, 0.0, -3.7), -PI / 2.0, Vector2(1.2, 2.1), 2.4)
	_hatch.locked = true
	_hatch.lock_text = "The hatch is sealed until the captain has briefed you"
	add_child(_hatch)
	_hatch.passed.connect(_leave)
	# The captain's chair, and the two crew seats at the forward consoles.
	var chair := Seat.make(Vector3(0.0, 0.12, -2.5), 0.0, "Sit in the captain's chair")
	add_child(chair)
	if "--sit" in OS.get_cmdline_user_args():
		get_tree().create_timer(1.0).timeout.connect(func(): _walker.sit(chair))
	Flow.music(false)
	_enter()
	# For checks: `-- --talk`, or /play/#bridge/talk in the browser.
	if "--talk" in OS.get_cmdline_user_args() or Flow.beat == "talk":
		Flow.beat = ""
		_walker.position = Vector3(0.3, 0.1, -6.6)
		_walker.face(Vector3(0.0, 1.6, -8.1))
		_briefing()

func _enter() -> void:
	await get_tree().create_timer(0.8).timeout
	Hud.objective("Report to [Captain Hale]", "On the bridge, by the window")
	Hud.waypoint(_hale, "CAPTAIN HALE", 2.15)

func _briefing() -> void:
	if _talked:
		return
	_talked = true
	_talk.set_meta("prompt", "")
	_talk.queue_free()
	Hud.clear_prompt()
	Hud.waypoint(null)
	_walker.enabled = false
	_walker.face(_hale.global_position + Vector3(0, 1.6, 0))
	var me := _walker.global_position
	_hale.face(me)
	_renn.face(me)
	await get_tree().create_timer(0.6).timeout
	# A conversation, shot over the pilot's shoulder.
	var cam := Shot3D.open(self)
	var hale_face := _hale.global_position + Vector3(0, 1.66, 0)
	var renn_face := _renn.global_position + Vector3(0, 1.56, 0)
	var my_head := me + Vector3(0, 1.6, 0)
	Hud.letterbox(true)
	cam.frame(my_head, hale_face)
	_hale.talk(true)
	await Hud.say("Captain Hale", "There's my escort. Elias Hale. Welcome aboard the Aster.")
	await Hud.say("Captain Hale", "Six ships. Vaccine for the Tycho outbreak, forty thousand doses. Ninety minutes to the Moon corridor.")
	await Hud.say("Captain Hale", "Mara Voss vouched for you. She flew on my wing for eleven years, so that's worth something. Don't make her a liar.")
	_hale.talk(false)
	cam.frame(my_head, renn_face, -1.0)
	_renn.talk(true)
	await Hud.say("Renn Ayers", "The Hollow have hit three convoys this month, Captain. Medical cargo, every one. Out past the Moon.")
	_renn.talk(false)
	cam.frame(my_head, hale_face)
	_hale.talk(true)
	await Hud.say("Captain Hale", "Which is why we filed a false flight plan and told nobody the real one. Nobody, Renn. Not even the convoy.")
	await Hud.say("Captain Hale", "Your Kestrel's on the flight deck, starboard hatch. Fly close, keep the sun behind you, and if anything shows up without a transponder, kill it.")
	_hale.talk(false)
	cam.frame(my_head, renn_face, -1.0)
	_renn.talk(true)
	await Hud.say("Renn Ayers", "...Nobody. Right.")
	_renn.talk(false)
	cam.done()
	Hud.letterbox(false)
	_walker.enabled = true
	_hale.face(_hale.global_position + Vector3(0, 0, -5))
	_renn.face(_renn.global_position + Vector3(0, 0, -5))
	_hatch.locked = false
	Hud.objective("Go to the [flight deck]", "Starboard hatch")
	Hud.waypoint(_hatch, "FLIGHT DECK")

func _leave() -> void:
	if not _talked or _leaving:
		return
	_leaving = true
	Report.line("DOOR passed")
	Hud.clear_prompt()
	Hud.waypoint(null)
	Flow.go("hangar")
