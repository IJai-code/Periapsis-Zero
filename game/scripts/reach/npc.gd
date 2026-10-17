class_name Npc
extends Node3D
## Someone in the Reach: a person standing (or sitting) on a small world,
## who turns to the explorer and talks (Lore.TALK[key]) when used.
##
## They are not statues: within seven metres they turn to watch you, and the
## first time you come close they say a line of their own (their mouth moves
## with it). When nobody is near they look about now and then, and settle
## back to the way they were placed. Only the public Person calls are used
## (face, talk, locomote, follow_route); the animation is the person's own.

const NEAR := 7.0
const FAR := 10.0
const GREET_AT := 2.8
const GREET_EVERY := 45.0
const TICK := 0.2
const GAZE := 0.25
const SPEAK := 1.6

const GREETINGS := {
	"mara": "You are up. Kettle is on, ship is fuelled, and the star is still there. Go on then.",
	"okafor": "Come up to the observatory when you can. The Lantern is not well.",
	"renn": "Careful where you step. Most of this camp is a bad idea held together by rope.",
	"vex": "Mind the drones. They sweep the wreck on a rhythm, and they do not care who you are.",
	"fen": "The little moon moved again. I saw it. I always see it.",
	"miner": "Tunnel is back that way. Mind the loose rock, it is older than the village.",
	"hauler": "Crates are counted. Do not go counting them again.",
	"default": "Morning.",
}

var key := ""
var model := "crowd1"
var sitting := false
var person: Person
var usable: Usable

# The world and the player are looked up once and then reused. Everything
# here runs on a 0.2 s tick: a village of seven people costs fifty checks a
# second in the worst case, and none of them build a string.
var _reach
var _player: Node3D
var _tick := 0.0
var _gaze_t := 0.0
var _greet_cool := 0.0
var _speak_t := 0.0
var _glance_in := 9.0
var _glance_hold := 0.0
var _watching := false

static func make(key_: String, model_: String, sit := false) -> Npc:
	var n := Npc.new()
	n.key = key_
	n.model = model_
	n.sitting = sit
	n.name = "Npc_" + key_
	return n

func _ready() -> void:
	person = Person.make(model)
	person.solid = true
	add_child(person)
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
	if not reach or reach.talking:
		return
	var ex := by as Explorer
	if not ex:
		return
	ex.enabled = false
	person.face(ex.global_position)
	reach.talking = true
	# The greeting is over: the conversation proper takes the face.
	_speak_t = 0.0
	var t := Talk.open(reach, key, person, reach.hud)
	await t.finished
	reach.talking = false
	ex.enabled = true
	# Back to their post: sitting people sit again, everyone else faces the
	# way they were placed.
	if sitting:
		person.locomote(0.0, false, false, true)
	else:
		person.follow_route()

func _process(dt: float) -> void:
	_greet_cool -= dt
	_gaze_t -= dt
	if _speak_t > 0.0:
		_speak_t -= dt
		if _speak_t <= 0.0:
			_hush()
	if _glance_hold > 0.0:
		_glance_hold -= dt
		if _glance_hold <= 0.0 and _reach and not _reach.talking:
			person.follow_route()
	_tick -= dt
	if _tick > 0.0:
		return
	_tick = TICK
	if not is_inside_tree():
		return
	if _reach == null or not is_instance_valid(_reach):
		_reach = get_tree().get_first_node_in_group("reach_root")
		_player = null
	if _reach == null:
		return
	if _player == null or not is_instance_valid(_player):
		_player = _reach.player
	if _player == null:
		return
	# Waking (the morning) and any cutscene hold the player: leave them be.
	var ex := _player as Explorer
	if ex and not ex.enabled:
		return
	var d := global_position.distance_to(_player.global_position)
	var talking: bool = _reach.talking
	# In conversation: keep looking at whoever is speaking with them.
	if talking:
		if _gaze_t <= 0.0:
			_gaze_t = GAZE
			person.face(_player.global_position)
		_watching = true
		_glance_hold = 0.0
		return
	# Close: turn to watch the pilot, and say hello the first time (and now
	# and then after that, not on every pass).
	if d < NEAR:
		if _gaze_t <= 0.0:
			_gaze_t = GAZE
			person.face(_player.global_position)
		_watching = true
		_glance_hold = 0.0
		if d < GREET_AT and _greet_cool <= 0.0 and _speak_t <= 0.0:
			_greet()
		return
	if _watching and d > FAR:
		_watching = false
		person.follow_route()
	# Alone: look about, a little to one side, then back to the post.
	if d > FAR and _glance_hold <= 0.0:
		_glance_in -= TICK
		if _glance_in <= 0.0:
			_glance_in = randf_range(7.0, 15.0)
			var side := -1.0 if randf() < 0.5 else 1.0
			# A point a little ahead and to one side, in the person's own
			# frame, so the glance works whichever way the world turned them.
			var at := person.global_transform * Vector3(2.2 * side, 0.0, 3.0)
			person.face(at)
			_glance_hold = 1.5

## A line of their own, spoken: the mouth moves while the words are up.
func _greet() -> void:
	_greet_cool = GREET_EVERY
	_speak_t = SPEAK
	person.face(_player.global_position)
	person.talk(true)
	if _reach.hud:
		_reach.hud.caption(String(GREETINGS.get(key, GREETINGS["default"])), 3.0)

func _hush() -> void:
	person.talk(false)
	if sitting:
		person.locomote(0.0, false, false, true)
