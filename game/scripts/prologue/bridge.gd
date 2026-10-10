extends Node3D
## Prologue, part one-and-a-half: the bridge. The player meets Captain Hale
## and Renn Ayers in person, learns what the convoy carries and what has
## been happening to convoys, and is sent to the flight deck.

var _walker: Walker
var _hale: Person
var _renn: Person
var _talk: Interactable
var _hatch: Interactable
var _talked := false
var _leaving := false

func _ready() -> void:
	add_child(AsterBridge.new())
	_hale = Person.make("hale")
	add_child(_hale)
	_hale.position = Vector3(0.0, 0.0, -8.1)
	_hale.rotation.y = PI       # at the window, back to the room
	_renn = Person.make("renn")
	add_child(_renn)
	_renn.position = Vector3(-1.7, 0.0, -4.35)
	_renn.rotation.y = PI       # at her console
	_walker = Walker.new()
	add_child(_walker)
	_walker.position = Vector3(2.0, 0.1, -1.0)
	_walker.face(Vector3(0.0, 1.6, -8.1))
	_talk = Interactable.new(Vector3(1.4, 2.0, 1.4), "[E] Talk to Captain Hale")
	_talk.position = Vector3(0.0, 1.0, -8.1)
	add_child(_talk)
	_talk.activated.connect(_briefing)
	_hatch = Interactable.new(Vector3(0.6, 2.2, 1.4), "[E] Open the hatch to the flight deck")
	_hatch.position = Vector3(5.0, 1.1, -3.7)
	_hatch.set_meta("prompt", "The hatch is sealed until the captain has briefed you")
	add_child(_hatch)
	_hatch.activated.connect(_leave)
	Flow.music(false)
	_enter()
	if "--talk" in OS.get_cmdline_user_args():
		_walker.position = Vector3(0.5, 0.1, -6.2)
		_walker.face(Vector3(0.0, 1.6, -8.1))
		_briefing()

func _enter() -> void:
	await get_tree().create_timer(0.8).timeout
	Hud.objective("Report to Captain Hale", "On the bridge, by the window")

func _briefing() -> void:
	if _talked:
		return
	_talked = true
	_talk.set_meta("prompt", "")
	_talk.queue_free()
	var eye := _walker.camera
	_hale.face(_walker.global_position)
	await get_tree().create_timer(0.6).timeout
	_hale.talk(true)
	await Hud.say("Captain Hale", "There's my escort. Welcome aboard the Aster.")
	await Hud.say("Captain Hale", "Six ships, and our holds are full of vaccine for the lunar colonies. Ninety minutes to the Moon corridor.")
	_hale.talk(false)
	_renn.face(_walker.global_position)
	await get_tree().create_timer(0.5).timeout
	_renn.talk(true)
	await Hud.say("Renn Ayers", "And the Hollow have hit three convoys this month. Out past the Moon, all of them.")
	_renn.talk(false)
	_hale.talk(true)
	await Hud.say("Captain Hale", "None of them on our route, Renn. Nobody knows our route.")
	await Hud.say("Captain Hale", "Your Kestrel's on the flight deck, starboard hatch. Fly close and watch the sun.")
	_hale.talk(false)
	_hale.face(_hale.global_position + Vector3(0, 0, -5))
	_renn.face(_renn.global_position + Vector3(0, 0, -5))
	_hatch.set_meta("prompt", "[E] Open the hatch to the flight deck")
	Hud.objective("Board your Kestrel", "Starboard hatch")

func _leave() -> void:
	if not _talked or _leaving:
		return
	_leaving = true
	_walker.enabled = false
	Hud.clear_prompt()
	Sfx.play("door", -2.0)
	Flow.go("hangar")
