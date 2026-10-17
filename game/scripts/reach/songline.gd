class_name Songline
extends Node3D
## A songline: Choir writing carved as branching spirals on stone. Look at
## it and press E to read it with Okafor's translator (Translator). Its
## glyphs glow faintly until every verse has been read, then shine.

var id := ""
var path := "site-songline"
var usable: Usable
var _glyph: StandardMaterial3D
var _t := 0.0

static func make(id_: String, path_ := "site-songline") -> Songline:
	var s := Songline.new()
	s.id = id_
	s.path = path_
	s.name = "Songline_" + id_
	return s

func _ready() -> void:
	var n: Node3D = load("res://art/%s.glb" % path).instantiate()
	Surfaces.apply(n)
	add_child(n)
	Surfaces.collide(n)
	# Its own glyph material, to light as it is read.
	_glyph = (Surfaces.get_material("choir_glyph") as StandardMaterial3D).duplicate()
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i)
			if src and src.resource_name == "choir_glyph":
				mi.set_surface_override_material(i, _glyph)
	var wall := path == "site-songline_wall"
	usable = Usable.box("Translate the songline", Vector3(4.6 if wall else 1.6, 2.6, 1.2))
	usable.position = Vector3(0, 1.5, 0.2)
	add_child(usable)
	usable.used.connect(_read)

func _process(dt: float) -> void:
	_t += dt
	var done := Lore.all_read(id)
	_glyph.emission_energy_multiplier = 2.6 if done else 0.9 + 0.5 * (0.5 + 0.5 * sin(_t * 1.7))
	_glyph.emission = Color(0.78, 0.92, 1.0) if done else Color(0.5, 0.78, 1.0)

func _read(by: Node) -> void:
	var reach := get_tree().get_first_node_in_group("reach_root")
	if not reach or reach.talking:
		return
	var ex := by as Explorer
	ex.enabled = false
	reach.talking = true
	var t := Translator.open(reach, id, reach.hud)
	await t.finished
	reach.talking = false
	ex.enabled = true
