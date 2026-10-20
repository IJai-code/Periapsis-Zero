class_name Npc
extends Node3D
## Someone in the Reach: a person with a post, a few places they move
## between, and something to do when they get there. They turn to the
## explorer when you come close, but not for ever: after a look, a word or
## two, they go back to what they were doing. Their lines change with how
## the loop is going, and a new morning puts the whole day back.
##
## Only the public Person calls are used (face, talk, locomote,
## follow_route); the animation is the person's own.

const NEAR := 7.0
const FAR := 10.5
const GREET_AT := 3.0
## Seconds before the same person says hello again. Long on purpose: people
## do not greet you every time you walk past them in your own kitchen.
const GREET_EVERY := 240.0
const TICK := 0.2
const GAZE := 0.3
const SPEAK := 2.2
## How long a passing pilot holds their attention, and then how long they
## leave them be before looking up again.
const NOTICE := 3.0
const COOL := 12.0
const WALK := 1.15

const LINES := {
	"mara": {
		"first": ["You are up. Kettle is on, ship is fuelled, and the star is still there. Go on, then."],
		"pass": ["Mind the embers.", "Water is in the barrel.", "Ship will not fly itself.", "Fen is on her porch again. Ask her about the moon."],
		"late": ["Do you feel that? The light is going thin.", "The Lantern has never looked like that. Get moving."],
	},
	"okafor": {
		"first": ["You are the pilot. Good. Come up to the observatory when you can — the Lantern is not well."],
		"pass": ["The instrument is older than the village. It still works.", "I have been watching that star for thirty years. It has never done this.", "Bring me what the Choir left and I will make sense of it."],
		"late": ["The readings are past the end of the scale. Go, pilot.", "I am staying. Someone has to write it down."],
	},
	"renn": {
		"first": ["The pilot. I heard the lift. Sit, if you are staying."],
		"pass": ["Quiet out here. The falls drown most of it.", "I have been listening to the Reach. It is not just us.", "You get used to the cold. Mostly."],
		"late": ["The Choir is singing again. Can you hear it?", "Whatever you are planning — do it before the light goes."],
	},
	"vex": {
		"first": ["Do not touch the drums. The drones do not like new sounds."],
		"pass": ["Wreck is picked clean near the hatch. Try the spine.", "Rook's sweep is every forty seconds. Count it.", "I heard you land. Half the Reach heard you land."],
		"late": ["The drones are pulling back. That is worse, not better.", "The Lantern is spitting. Keep your head down."],
	},
	"fen": {
		"first": ["You are the pilot. Good. The little moon moved again last night — I saw it."],
		"pass": ["Still here, then.", "The Lantern is dimming. Look at it long enough and you can see it.", "Sky is clear. For now."],
		"late": ["It is pulling, is it not? Even the grass leans.", "I am not going inside. Not tonight."],
	},
	"miner": {
		"first": ["Mara said you would be down here. Wind is wrong for the mine today."],
		"pass": ["Loose rock past the cart. Mind your feet.", "This seam is older than the village. Older than the ship, maybe.", "Cart is full. Do not touch it."],
		"late": ["Rock has been singing all morning. That is not the wind.", "I am not going back in. Not with the light like that."],
	},
	"hauler": {
		"first": ["You are the one with the Kestrel. She is fuelled and lashed. Mostly."],
		"pass": ["Crates are counted. Do not count them again.", "Tower lift is slow. Do not stand under it.", "If you are flying, take the north lane. Wind is kinder."],
		"late": ["Everything is tied down. Everything that can be.", "Ship is ready when you are. I would go soon."],
	},
	"default": {
		"first": ["You are up."],
		"pass": ["Morning.", "Careful out there."],
		"late": ["The light is wrong."],
	},
}

var key := ""
var model := "crowd1"
var sitting := false
var person: Person
var usable: Usable
## Places they move between, as (east, north) metres from the site's
## centre. Empty: they keep their post.
var roam: Array = []
## Where the site put them, in the same flat coordinates.
var home_flat := Vector2.ZERO
var site: Site

# The world and the player are looked up once and then reused. The routine
# walks every frame (it is the only thing here that must not stutter); the
# player is looked at ten times a second, and nothing builds a string in a
# tick.
var _reach
var _player: Node3D
var _tick := 0.0
var _gaze_t := 0.0
var _greet_cool := 0.0
var _speak_t := 0.0
var _glance_in := 9.0
var _glance_hold := 0.0
var _notice := 0.0
var _cool := 0.0
var _glance_player := 0.0
var _in_talk := false
var _watching := false
var _look_up := 8.0
var _look_hold := 0.0
var _last_t := 0.0
var _spoke_first := false
var _last_pick := -1

# The routine.
var _flat := Vector2.ZERO
var _leg := 0
var _walking := false
var _walk_speed := WALK
var _dwell := 6.0
var _work := 0.0

static func make(key_: String, model_: String, sit := false, roam_: Array = []) -> Npc:
	var n := Npc.new()
	n.key = key_
	n.model = model_
	n.sitting = sit
	n.roam = roam_
	n.name = "Npc_" + key_
	return n

func _ready() -> void:
	person = Person.make(model)
	person.solid = true
	add_child(person)
	_flat = home_flat
	_walk_speed = WALK * randf_range(0.9, 1.12)
	# Start mid-chore, so the whole village does not set off at once.
	_dwell = randf_range(2.0, 13.0)
	if sitting:
		person.locomote(0.0, false, false, true)
	usable = Usable.box("Talk to " + _title(), Vector3(1.0, 1.9, 1.0))
	usable.position = Vector3(0, 0.95, 0)
	add_child(usable)
	usable.used.connect(_talk)
	_glance_in = randf_range(7.0, 15.0)

func _title() -> String:
	match key:
		"mara": return "Mara"
		"okafor": return "Okafor"
		"renn": return "Renn"
		"vex": return "Vex"
		"fen": return "Fen"
		"miner": return "Tull"
		"hauler": return "Isa"
	return key.capitalize()

func _talk(by: Node) -> void:
	var reach := get_tree().get_first_node_in_group("reach_root")
	if not reach or reach.talking or _in_talk:
		return
	var ex := by as Explorer
	if not ex:
		return
	ex.enabled = false
	_in_talk = true
	_notice = 0.0
	_look_hold = 0.0
	# Whatever they were doing can wait; they stop and give you their face.
	if _walking:
		person.locomote(0.0)
	else:
		person.locomote(0.0, _work > 0.0)
	person.face(ex.global_position)
	reach.talking = true
	# The greeting is over: the conversation proper takes the face.
	_speak_t = 0.0
	var t := Talk.open(reach, key, person, reach.hud)
	await t.finished
	reach.talking = false
	_in_talk = false
	_cool = 8.0
	ex.enabled = true
	# Back to their post, their errand, or their seat: no snap to attention.
	_resume()

func _process(dt: float) -> void:
	_greet_cool -= dt
	_gaze_t -= dt
	_glance_player -= dt
	_cool -= dt
	if _notice > 0.0:
		_notice -= dt
		if _notice <= 0.0:
			# Their look is over: back to the job, and no more staring for a
			# while even if the pilot stays put.
			_cool = COOL + randf_range(0.0, 5.0)
			_rest_face()
	if _look_hold > 0.0:
		_look_hold -= dt
		if _look_hold <= 0.0:
			_rest_face()
	if _glance_hold > 0.0:
		_glance_hold -= dt
		if _glance_hold <= 0.0 and _notice <= 0.0:
			_rest_face()
	if _speak_t > 0.0:
		_speak_t -= dt
		if _speak_t <= 0.0:
			_hush()
	if _in_talk:
		if _gaze_t <= 0.0:
			_gaze_t = GAZE
			if _player and is_instance_valid(_player):
				person.face(_player.global_position)
		return
	_tick -= dt
	if _tick <= 0.0:
		_tick = TICK
		_think()
	# Held by the pilot's arrival: stop and look, do not walk on.
	if _notice > 0.0:
		return
	_routine(dt)

## Ten times a second: is anyone there?
func _think() -> void:
	if _reach == null or not is_instance_valid(_reach):
		_reach = get_tree().get_first_node_in_group("reach_root")
		_player = null
	if _reach == null:
		return
	if _player == null or not is_instance_valid(_player):
		_player = _reach.player
	if _player == null:
		return
	var sys: ReachSystem = _reach.system
	var t := sys.t
	# A new morning (the loop's clock went back): the day starts again.
	if t < _last_t - 5.0:
		_spoke_first = false
		_greet_cool = 0.0
		_cool = 0.0
		_notice = 0.0
	_last_t = t
	var ex := _player as Explorer
	# Even when a cutscene holds the pilot, the village keeps working; it
	# just has no one to look at.
	if ex and not ex.enabled:
		_notice = 0.0
		return
	var d := global_position.distance_to(_player.global_position)
	if d > FAR:
		_watching = false
		_notice = 0.0
		return
	if d < NEAR:
		if _notice <= 0.0 and _cool <= 0.0:
			_notice = NOTICE + randf_range(0.0, 1.4)
			_watching = true
			if _gaze_t <= 0.0:
				_gaze_t = GAZE
				person.face(_player.global_position)
			# Walking stopped, not forgotten: _routine picks it up again.
			if _walking:
				person.locomote(0.0)
			return
		# Close enough to talk, whether or not they have finished looking.
		if d < GREET_AT and _greet_cool <= 0.0 and not _reach.talking and _speak_t <= 0.0:
			var speed := ex.velocity.length() if ex else 0.0
			# Someone running past gets a nod, not a speech.
			if speed < 4.0 or randf() < 0.35:
				_greet()
				_notice = maxf(_notice, SPEAK + 1.0)
			return
		# Already had their look: let them glance up now and then, but get on.
		if d < GREET_AT and _glance_player <= 0.0:
			_glance_player = randf_range(4.0, 7.0)
			person.face(_player.global_position)
			_glance_hold = 1.2
		return
	# The Lantern reddening late in the loop: people stop and watch it.
	if _late():
		_look_up -= TICK
		if _look_up <= 0.0:
			_look_up = randf_range(6.0, 12.0)
			if _walking:
				person.locomote(0.0)
			person.face(sys.world("lantern"))
			_look_hold = randf_range(3.5, 6.5)
		return
	# Back to their own business once you are far enough away.
	if _notice <= 0.0 and _cool <= 0.0:
		_watching = false

## The small life of the village: walk to the next place, do something
## there, stand, and go on. Every frame, so the walk is smooth.
func _routine(dt: float) -> void:
	if sitting:
		return
	if _late():
		# Wound down: they stay where they are (the sky is watched in
		# _think), rather than setting off on another errand.
		if _walking:
			_walking = false
			person.locomote(0.0)
		return
	if _walking:
		_walk(dt)
		return
	if _work > 0.0:
		_work -= dt
		if _work <= 0.0:
			person.locomote(0.0)
	_dwell -= dt
	if _dwell <= 0.0:
		_next_stop()

func _walk(dt: float) -> void:
	if roam.size() < 2 or site == null:
		_walking = false
		return
	var target: Vector2 = roam[_leg]
	var delta := target - _flat
	var step := _walk_speed * dt
	if delta.length() <= step:
		_flat = target
		_walking = false
		_dwell = randf_range(7.0, 16.0)
		_rest_face()
		if _task() == "work":
			_work = randf_range(3.0, 5.5)
			person.locomote(0.0, true)
		else:
			person.locomote(0.0)
		return
	_flat += delta.normalized() * step
	var xf := site.ground(_flat)
	var ahead := site.ground(target).origin - xf.origin
	if ahead.length() < 0.001:
		ahead = xf.basis.z
	global_transform = Transform3D(Site.upright(xf.basis.y, ahead), xf.origin)
	person.locomote(_walk_speed)

func _next_stop() -> void:
	if roam.size() < 2:
		_dwell = 10.0
		return
	_leg = (_leg + 1) % roam.size()
	_walking = true
	_work = 0.0
	person.follow_route()

## What they do when they arrive: a few are hands-on, the rest just stop
## and take in the view (Fen never stops looking up).
func _task() -> String:
	match key:
		"mara": return "work" if _leg % 2 == 0 else "look"
		"miner", "hauler": return "work" if _leg % 2 == 1 else "look"
		"fen": return "look"
		"renn", "vex": return "work" if _leg % 2 == 1 else "look"
	return "look"

func _rest_face() -> void:
	if _late():
		return
	if key == "fen" and _reach:
		person.face(_reach.system.world("lantern"))
	else:
		person.face(site.center.origin if site else global_position + global_basis.z)

func _late() -> bool:
	var sys: ReachSystem = _reach.system if _reach else null
	return sys != null and sys.t > ReachSystem.LOOP * 0.84

## Stop what they are doing and come back to it, after a look or a talk.
func _resume() -> void:
	if _in_talk:
		return
	if _walking:
		person.locomote(_walk_speed)
	elif _work > 0.0:
		person.locomote(0.0, true)
	elif sitting:
		person.locomote(0.0, false, false, true)
	else:
		person.locomote(0.0)

## A line of their own, spoken: the mouth moves while the words are up.
func _greet() -> void:
	_greet_cool = GREET_EVERY
	_speak_t = SPEAK
	person.face(_player.global_position)
	person.talk(true)
	if _reach and _reach.hud:
		_reach.hud.caption(_line(), 3.0)

## A greeting from the book, chosen so the same one does not come twice.
func _line() -> String:
	var book: Dictionary = LINES.get(key, LINES["default"])
	var list: Array
	if _late():
		list = book.get("late", book["pass"])
	elif not _spoke_first:
		list = book.get("first", book["pass"])
	else:
		list = book["pass"]
	_spoke_first = true
	if list.is_empty():
		return ""
	var i := int(randi() % list.size())
	if list.size() > 1 and i == _last_pick:
		i = (i + 1) % list.size()
	_last_pick = i
	return list[i]

func _hush() -> void:
	person.talk(false)
	_resume()
