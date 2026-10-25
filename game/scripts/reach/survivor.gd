class_name Survivor
extends Node3D
## One of the Aster's crew (Crew): a person in the ship's rust-orange flight
## suit, standing where they were found, who can be talked to.

var id := ""
var title := ""
var model := "crowd1"
var crew: Crew
var person: Person
var use: Usable

func _ready() -> void:
	person = Person.make(model)
	person.suit_tint = Crew.SUIT
	add_child(person)
	use = Usable.box("Talk to " + title, Vector3(1.0, 1.9, 1.0))
	use.position = Vector3(0, 0.95, 0)
	add_child(use)
	use.used.connect(func(by: Node): crew.talk(self, by))
