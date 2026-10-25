class_name Songline
extends Node3D
## A Founders' recording: an old recorder, a century weathered, bolted to a
## standing stone (or a wall) where Hearth's first settlers left it. Look at
## it and press E to play it with Okafor's player (Translator). Its lamp
## pulses faintly until every track has been played, then shines.
## (The stones were carved with glowing writing once; that is gone: the
## recorders are what speak now.)

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
	_glyph.emission = Color(1.0, 0.62, 0.3)
	var box := AABB()
	var first := true
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		var b := mi.transform * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i)
			if src and src.resource_name == "choir_glyph":
				# The old carving is gone: the recorders are what speak now.
				mi.set_surface_override_material(i, _gone())
	var wall := path == "site-songline_wall"
	_recorder(Vector3(0.0, clampf(box.get_center().y, 1.0, 1.6), box.end.z + 0.02))
	usable = Usable.box("Play the recording", Vector3(4.6 if wall else 1.6, 2.6, 1.2))
	usable.position = Vector3(0, 1.5, 0.2)
	add_child(usable)
	usable.used.connect(_read)

## The recorder: a battered metal case with a speaker grille, a reel window,
## a stub of an antenna and a lamp (the light that tells what is played).
func _recorder(at: Vector3) -> void:
	var root := Node3D.new()
	root.position = at
	add_child(root)
	var metal := Surfaces.get_material("metal")
	var dark := Surfaces.get_material("paint_dark")
	var parts := [
		[BoxMesh.new(), Vector3(0.62, 0.42, 0.22), Vector3(0, 0, 0.11), dark],
		[CylinderMesh.new(), Vector3(0.24, 0.03, 0.24), Vector3(-0.14, 0.0, 0.235), metal],
		[CylinderMesh.new(), Vector3(0.12, 0.03, 0.12), Vector3(0.17, 0.06, 0.235), metal],
		[CylinderMesh.new(), Vector3(0.012, 0.42, 0.012), Vector3(0.24, 0.42, 0.06), metal],
		[SphereMesh.new(), Vector3(0.06, 0.06, 0.06), Vector3(0.17, -0.11, 0.23), _glyph],
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		var m: PrimitiveMesh = p[0]
		if m is BoxMesh:
			(m as BoxMesh).size = p[1]
		elif m is CylinderMesh:
			(m as CylinderMesh).top_radius = (p[1] as Vector3).x * 0.5
			(m as CylinderMesh).bottom_radius = (p[1] as Vector3).x * 0.5
			(m as CylinderMesh).height = (p[1] as Vector3).y
		elif m is SphereMesh:
			(m as SphereMesh).radius = (p[1] as Vector3).x * 0.5
			(m as SphereMesh).height = (p[1] as Vector3).x
		mi.mesh = m
		mi.material_override = p[3]
		mi.position = p[2]
		# Speaker and reel discs face out.
		if m is CylinderMesh and (p[1] as Vector3).y < 0.1:
			mi.rotation = Vector3(PI / 2.0, 0, 0)
		root.add_child(mi)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.6, 0.3)
	lamp.light_energy = 0.6
	lamp.omni_range = 2.5
	lamp.shadow_enabled = false
	lamp.position = Vector3(0.17, -0.11, 0.4)
	root.add_child(lamp)
	_lamp = lamp

var _lamp: OmniLight3D
static var _gone_mat: StandardMaterial3D

static func _gone() -> StandardMaterial3D:
	if _gone_mat == null:
		_gone_mat = StandardMaterial3D.new()
		_gone_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_gone_mat.albedo_color = Color(0, 0, 0, 0)
		_gone_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return _gone_mat

func _process(dt: float) -> void:
	_t += dt
	var done := Lore.all_read(id)
	_glyph.emission_energy_multiplier = 2.6 if done else 0.9 + 0.5 * (0.5 + 0.5 * sin(_t * 1.7))
	_glyph.emission = Color(1.0, 0.85, 0.55) if done else Color(1.0, 0.55, 0.25)
	if _lamp:
		_lamp.light_energy = 1.2 if done else 0.35 + 0.3 * (0.5 + 0.5 * sin(_t * 1.7))

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
