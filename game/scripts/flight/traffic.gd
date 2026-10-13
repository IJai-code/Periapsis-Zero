class_name Traffic
extends Node3D
## Station traffic: freighters and shuttles running the lanes in and out,
## slow and steady, nav lights blinking (red to port, green to starboard,
## white strobe aft). They are on the overview as neutral ships and solid,
## so a careless pilot bounces off them.

var lanes: Array = []        # [from, to] pairs of world points
var count := 5
var _ships: Array = []

func _ready() -> void:
	for i in count:
		var lane: Array = lanes[i % lanes.size()]
		var big := i % 3 == 0
		var h := Hull.new()
		h.team = "neutral"
		h.display_name = ["Calloway Star", "Tug 14", "Ossian Bulk", "Shuttle 9", "Tern", "Halvard", "Tug 7"][i % 7]
		h.ship_class = "Bulk freighter" if big else ("Tug" if i % 3 == 1 else "Shuttle")
		h.radius = 30.0 if big else 9.0
		h.integrity = 1e6
		h.max_integrity = 1e6
		h.floor_integrity = 1e6
		var m := Hull.model("freighter2" if big else "freighter3")
		m.scale = Vector3.ONE * (0.7 if big else 0.18)
		h.add_child(m)
		h.body = m
		# _place in _process positions each one every rendered frame; the same
		# reason the title ship opts out.
		h.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
		h.make_solid(h.radius * 0.8)
		_lights(h, h.radius)
		add_child(h)
		var k := float(i) / count
		h.set_meta("lane", lane)
		h.set_meta("t", k)
		h.set_meta("speed", (14.0 if big else 32.0) / lane[0].distance_to(lane[1]))
		_ships.append(h)
		_place(h)

func _lights(h: Node3D, r: float) -> void:
	for spec in [[Vector3(-r * 0.6, 0, 0), Color(4, 0.3, 0.2)], [Vector3(r * 0.6, 0, 0), Color(0.3, 4, 0.6)], [Vector3(0, r * 0.2, r * 0.9), Color(5, 5, 5)]]:
		var s := SphereMesh.new()
		s.radius = maxf(0.4, r * 0.025)
		s.height = s.radius * 2.0
		s.radial_segments = 8
		s.rings = 4
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.albedo_color = spec[1]
		s.material = mat
		var mi := MeshInstance3D.new()
		mi.mesh = s
		mi.position = spec[0]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.set_meta("blink", spec[0].z > 0.0)
		h.add_child(mi)

func _place(h: Hull) -> void:
	var lane: Array = h.get_meta("lane")
	var t: float = h.get_meta("t")
	# Out along the lane, then back the other way.
	var k := pingpong(t * 2.0, 1.0)
	var a: Vector3 = lane[0]
	var b: Vector3 = lane[1]
	var dir := (b - a).normalized() * (1.0 if fmod(t * 2.0, 2.0) < 1.0 else -1.0)
	var p := a.lerp(b, k)
	h.velocity = dir * a.distance_to(b) * float(h.get_meta("speed")) * 2.0
	h.global_position = p
	h.look_at(p + dir, Vector3.UP)

func _process(dt: float) -> void:
	var blink := fmod(Time.get_ticks_msec() * 0.001, 1.6) < 0.12
	for h: Hull in _ships:
		h.set_meta("t", fmod(float(h.get_meta("t")) + dt * float(h.get_meta("speed")), 1.0))
		_place(h)
		for c in h.get_children():
			if c is MeshInstance3D and c.get_meta("blink", false):
				c.visible = blink
