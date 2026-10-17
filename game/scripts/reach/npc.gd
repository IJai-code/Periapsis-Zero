class_name Npc
extends Node3D
## Someone in the Reach: a person standing (or sitting) on a small world,
## who turns to the explorer and talks (Lore.TALK[key]) when used.

var key := ""
var model := "crowd1"
var sitting := false
var person: Person
var usable: Usable

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
	ex.enabled = false
	person.face(ex.global_position)
	reach.talking = true
	var t := Talk.open(reach, key, person, reach.hud)
	await t.finished
	reach.talking = false
	ex.enabled = true
	person.follow_route()
