class_name ZeroGCave
extends Node3D
## The Founders' dome on Hearth's crater floor: a hollow of rock, quiet and
## lit warm inside, where the Founders left the recording that holds
## Hearth's part of the Engine's song (a Songline, "dome", placed by the
## village at its back wall). Walk in, play it, done: nothing to fly. A
## sign at the mouth names it. (The class keeps its old name: the village,
## the landmark and the save know it as "zerog".) Hung on the dome's model:
## +Z is out of its mouth.

const CENTER := Vector3(0, 4.0, 0)

var reach: Node
var _told := false

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.75, 0.45)
	l.light_energy = 1.4
	l.omni_range = 11.0
	l.shadow_enabled = false
	l.position = CENTER + Vector3(0, 1.0, -1.5)
	add_child(l)
	var post := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(1.0, 0.7, 0.08)
	post.mesh = bm
	post.material_override = Surfaces.get_material("planks")
	post.position = Vector3(2.6, 1.5, 12.5)
	add_child(post)
	var label := Label3D.new()
	label.text = "THE FOUNDERS' DOME\na recording inside"
	label.font = ReachStyle.serif_bold
	label.font_size = 40
	label.pixel_size = 0.004
	label.modulate = Color(0.95, 0.9, 0.78)
	label.outline_size = 8
	label.outline_modulate = Color(0.2, 0.13, 0.08)
	label.position = Vector3(2.6, 1.5, 12.56)
	add_child(label)

func reset_loop() -> void:
	_told = false

var _noted := false

func _process(_dt: float) -> void:
	if not reach or not reach.player or not reach.hud:
		return
	# Its recording played: the season's task for the dome.
	if not _noted and Lore.known("song_hearth"):
		_noted = true
		Season.note("zerog", "dome_recording")
	# Arriving at its mouth with its recording unplayed: say what is inside.
	var near := (reach.player as Node3D).global_position.distance_to(global_transform * CENTER) < 16.0
	if near and not _told and not Lore.known("song_hearth"):
		_told = true
		reach.hud.caption("The Founders' dome. A recording stands at the back: walk up to it, look at it and press E.", 6.0)
