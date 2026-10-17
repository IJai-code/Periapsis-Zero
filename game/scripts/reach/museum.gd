class_name Museum
extends Node3D
## Inside the observatory (valley-observatory2, floor at y 0.6): stands
## round the walls, each a plaque to read with E, about the Reach and how
## to get about it; and on a table a working model of the Reach, its
## worlds on wires round a glowing Lantern.

const FLOOR := 0.6
const STANDS := [
	["The Reach", "Five small worlds round a dying star we call the Lantern. Hearthstone is home. Verdance is green and wet, Ashfall grey and cratered; the Phantom and the Wanderer keep their own strange hours. Everything rides its rails round the Lantern: press M to see where it all is, and where you are falling."],
	["The Lantern", "It flickered three nights ago and has been swelling since. Okafor gives it a day. When it starts to stutter, it is almost out of time."],
	["Listening", "Press X for the signalscope. Point it at the sky and tune it with Z and C, or the wheel. Travellers play the same old song: find them by their instruments. Distress beacons, chatter and stranger things share the band."],
	["The Choir", "Spirals cut in stone all over the Reach: the writing of the people who were here first. Look at one and press E, and Okafor's translator reads it to you a verse at a time."],
	["Flying the Kestrel", "W burns forward and S slows; A and D slide; Space and Shift rise and sink. The mouse turns her, Q and E roll. T locks onto a world and holding F matches your speed to it. Come down slower than eight metres a second, on her gear."],
	["Your suit", "Air, fuel and the suit itself, bottom left. Hold Space to crouch, let go to jump: the longer you hold, the higher. In the air, Space again fires the jetpack up, Shift down, and the move keys push you sideways. Out of the air the oxygen counts down; the Kestrel refills both. P takes a photograph; L opens the ship's log."],
	["The Fold", "Beyond the Wanderer's farthest swing lies a nebula we call the Fold. Every ship that ever came to the Reach came through it."],
]

var _model: Node3D
var _arms: Array = []
var _t := 0.0

func _ready() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 12
	for i in STANDS.size():
		# Round the wall, the door's side left clear.
		var a := deg_to_rad(-140.0 + 280.0 * i / (STANDS.size() - 1)) + PI
		var at := Vector3(sin(a) * 6.4, FLOOR, cos(a) * 6.4)
		var stand: Node3D = load("res://art/valley-exhibit.glb").instantiate()
		Surfaces.apply(stand)
		add_child(stand)
		stand.transform = Transform3D(Site.upright(Vector3.UP, -at), at)
		Surfaces.collide(stand)
		var use := Usable.box("Read: " + STANDS[i][0], Vector3(1.0, 1.6, 1.0))
		use.position = Vector3(0, 0.9, 0)
		stand.add_child(use)
		var title: String = STANDS[i][0]
		var text: String = STANDS[i][1]
		use.used.connect(func(_by: Node):
			var reach := get_tree().get_first_node_in_group("reach_root")
			if reach and reach.hud:
				reach.hud.plaque(title, text, stand.global_position)
				Sfx.play("click", -12.0, 1.2))
		var light := OmniLight3D.new()
		light.light_color = Color(1.0, 0.82, 0.6)
		light.light_energy = 0.7
		light.omni_range = 3.0
		light.position = Vector3(0, 2.2, 0.4)
		stand.add_child(light)
	_orrery(Vector3(3.4, FLOOR, 2.2))
	# Warm lamps round the hall, and the dome's light from above.
	for k in 4:
		var a := TAU * k / 4.0 + PI / 4.0
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.78, 0.55)
		l.light_energy = 1.6
		l.omni_range = 8.0
		l.position = Vector3(cos(a) * 5.0, 3.6, sin(a) * 5.0)
		add_child(l)
	var hall := OmniLight3D.new()
	hall.light_color = Color(0.85, 0.9, 1.0)
	hall.light_energy = 1.4
	hall.omni_range = 14.0
	hall.position = Vector3(0, 8.0, 0)
	add_child(hall)

## The model of the Reach: a lamp for the Lantern, a ball on a wire for
## each world, turning at its own pace (a minute to a few).
func _orrery(at: Vector3) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 21
	_model = Node3D.new()
	add_child(_model)
	_model.position = at
	var table := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = 1.25
	c.bottom_radius = 1.1
	c.height = 0.9
	c.material = Surfaces.get_material("planks")
	table.mesh = c
	table.position = Vector3(0, 0.45, 0)
	_model.add_child(table)
	var sb := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = 1.25
	cyl.height = 0.9
	cs.shape = cyl
	cs.position = Vector3(0, 0.45, 0)
	sb.add_child(cs)
	_model.add_child(sb)
	var star := MeshInstance3D.new()
	var ss := SphereMesh.new()
	ss.radius = 0.16
	ss.height = 0.32
	var glow := StandardMaterial3D.new()
	glow.emission_enabled = true
	glow.emission = Color(1.0, 0.75, 0.4)
	glow.emission_energy_multiplier = 3.0
	glow.albedo_color = Color(1.0, 0.8, 0.5)
	ss.material = glow
	star.mesh = ss
	star.position = Vector3(0, 1.25, 0)
	_model.add_child(star)
	var lamp := OmniLight3D.new()
	lamp.light_color = Color(1.0, 0.75, 0.45)
	lamp.light_energy = 0.8
	lamp.omni_range = 2.5
	star.add_child(lamp)
	var bodies := ReachSystem.define()
	var k := 0
	for b: ReachBody in bodies:
		if b.key == "lantern":
			continue
		k += 1
		var arm := Node3D.new()
		arm.position = Vector3(0, 1.25, 0)
		_model.add_child(arm)
		var r := 0.32 + k * 0.17
		var wire := MeshInstance3D.new()
		var w := BoxMesh.new()
		w.size = Vector3(r, 0.008, 0.008)
		w.material = Surfaces.get_material("metal")
		wire.mesh = w
		wire.position = Vector3(r / 2.0, 0, 0)
		arm.add_child(wire)
		var ball := MeshInstance3D.new()
		var bs := SphereMesh.new()
		bs.radius = 0.035 + b.radius / 6000.0
		bs.height = bs.radius * 2.0
		var m := StandardMaterial3D.new()
		m.albedo_color = b.tint
		bs.material = m
		ball.mesh = bs
		ball.position = Vector3(r, 0, 0)
		arm.add_child(ball)
		_arms.append([arm, TAU / maxf(b.orbit.period() / 12.0, 10.0), rng.randf() * TAU])
	var use := Usable.box("Read: The Reach", Vector3(2.6, 1.8, 2.6))
	use.position = Vector3(0, 1.0, 0)
	_model.add_child(use)
	use.used.connect(func(_by: Node):
		var reach := get_tree().get_first_node_in_group("reach_root")
		if reach and reach.hud:
			reach.hud.plaque(STANDS[0][0], STANDS[0][1], _model.global_position))

func _process(dt: float) -> void:
	_t += dt
	for a in _arms:
		(a[0] as Node3D).rotation.y = float(a[2]) + _t * float(a[1])
