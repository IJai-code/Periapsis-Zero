class_name AutoDoor
extends Node3D
## A powered door that opens for whoever walks up to it: two leaves slide
## apart and close again behind. No key to press and no cut: the pilot walks
## up, the door opens, the pilot walks through (`passed`), and the scene
## goes on from there.
##
## The door faces its local -Z: the way through is -Z. `locked` keeps it
## shut with its light ember (the story is not there yet; `lock_text` says
## why when the pilot walks up); the light is ion while it will open.
## `vestibule` builds a short lit space beyond, so an opening never shows
## the void where the set ends.

signal passed

var size := Vector2(1.2, 2.1)
var locked := false:
	set(v):
		locked = v
		_light_colour()
var lock_text := ""
## Metres of lit space beyond the door, or 0 for none.
var vestibule := 0.0
## How near (metres, in front or behind) the pilot opens it.
var reach := 2.4

var _leaves: Array[Node3D] = []
var _open := 0.0
var _passed := false
var _told := false
var _light: StandardMaterial3D
var _was_opening := false

## A door at `at`, facing `yaw` (radians about Y: the way through is the
## door's -Z after turning).
static func make(at: Vector3, yaw: float, door_size := Vector2(1.2, 2.1), vestibule_depth := 0.0) -> AutoDoor:
	var d := AutoDoor.new()
	d.size = door_size
	d.vestibule = vestibule_depth
	d.position = at
	d.rotation.y = yaw
	return d

func _ready() -> void:
	var mat := Surfaces.get_material("door")
	for side in [-1.0, 1.0]:
		var leaf := Node3D.new()
		var mi := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = Vector3(size.x / 2.0, size.y, 0.08)
		box.material = mat
		mi.mesh = box
		leaf.add_child(mi)
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = box.size
		cs.shape = shape
		body.add_child(cs)
		leaf.add_child(body)
		leaf.position = Vector3(side * size.x / 4.0, size.y / 2.0, 0.0)
		leaf.set_meta("closed_x", leaf.position.x)
		leaf.set_meta("side", side)
		add_child(leaf)
		_leaves.append(leaf)
		# A seam stripe down each leaf's meeting edge.
		var seam := MeshInstance3D.new()
		var sb := BoxMesh.new()
		sb.size = Vector3(0.03, size.y * 0.9, 0.09)
		sb.material = Surfaces.get_material("hazard")
		seam.mesh = sb
		seam.position = Vector3(-side * (size.x / 4.0 - 0.03), 0.0, 0.0)
		leaf.add_child(seam)
	# The status light over the door.
	var strip := MeshInstance3D.new()
	var lb := BoxMesh.new()
	lb.size = Vector3(size.x * 0.7, 0.05, 0.05)
	_light = StandardMaterial3D.new()
	_light.emission_enabled = true
	_light.emission_energy_multiplier = 3.0
	lb.material = _light
	strip.mesh = lb
	strip.position = Vector3(0, size.y + 0.12, 0.06)
	add_child(strip)
	_light_colour()
	if vestibule > 0.0:
		_build_vestibule()

func _light_colour() -> void:
	if not _light:
		return
	var c := Style.EMBER if locked else Style.ION
	_light.albedo_color = c
	_light.emission = c

## A short corridor beyond the door: floor, walls, ceiling and an end wall,
## lit, so walking in reads as walking somewhere.
func _build_vestibule() -> void:
	var w := size.x + 0.6
	var h := size.y + 0.4
	var d := vestibule
	var parts := [
		[Vector3(0, -0.02, -d / 2.0), Vector3(w, 0.04, d), "floor"],
		[Vector3(0, h, -d / 2.0), Vector3(w, 0.04, d), "wall"],
		[Vector3(-w / 2.0, h / 2.0, -d / 2.0), Vector3(0.04, h, d), "wall"],
		[Vector3(w / 2.0, h / 2.0, -d / 2.0), Vector3(0.04, h, d), "wall"],
		[Vector3(0, h / 2.0, -d), Vector3(w, h, 0.04), "door"],
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = p[1]
		b.material = Surfaces.get_material(p[2])
		mi.mesh = b
		mi.position = p[0]
		add_child(mi)
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = p[1]
		cs.shape = shape
		body.add_child(cs)
		mi.add_child(body)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(0.85, 0.92, 1.0)
	lamp.light_energy = 1.2
	lamp.omni_range = d + 1.5
	lamp.position = Vector3(0, h - 0.3, -d * 0.6)
	add_child(lamp)

func _process(dt: float) -> void:
	var player := get_tree().get_first_node_in_group("player") as Node3D
	var want := 0.0
	if player and player.is_inside_tree():
		var local := to_local(player.global_position)
		var near := Vector2(local.x, local.z).length() < reach
		if near and not locked:
			want = 1.0
		elif near and locked and lock_text != "" and not _told:
			_told = true
			Hud.prompt(lock_text, 3.0)
		elif not near:
			_told = false
		# Through: past the door's plane, inside its width.
		if not _passed and not locked and local.z < -0.7 and absf(local.x) < size.x:
			_passed = true
			passed.emit()
	var opening := want > _open
	if opening and not _was_opening:
		Sfx.play("door", -8.0, 1.15)
	_was_opening = opening
	_open = move_toward(_open, want, dt * 2.4)
	var k := smoothstep(0.0, 1.0, _open)
	for leaf in _leaves:
		var side: float = leaf.get_meta("side")
		leaf.position.x = float(leaf.get_meta("closed_x")) + side * k * size.x * 0.48
