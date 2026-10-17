class_name Village
extends Site
## Hearth village on Hearthstone: cabins round the campfire, lamps along the
## paths, the launch tower by the Kestrel's pad, the observatory and the
## lookout on their hills, and past the lake the old mine, a songline at
## the end of its tunnel. Everything stands on the sphere along its own up
## (art/godot/hearth_village.py and reach_sites.py have the pieces).

static func make(b: ReachBody) -> Village:
	var v := Village.new(b, "village")
	v.name = "Village"
	return v

func _ready() -> void:
	# Benches round the fire, facing it.
	for k in 4:
		var a := TAU * k / 4.0 + 0.4
		put("village-bench", Vector2(cos(a), sin(a)) * 3.0, Vector2.ZERO, false)
	# Cabins in a loose ring, porches toward the fire.
	for spec in [["cabin_a", Vector2(-15, 11)], ["cabin_a", Vector2(17, 12)], ["cabin_b", Vector2(-19, -9)],
			["cabin_b", Vector2(13, -17)], ["cabin_a", Vector2(-3, 24)], ["cabin_b", Vector2(26, -2)]]:
		put("village-" + spec[0], spec[1])
	for p in [Vector2(5.5, 0.5), Vector2(-6.5, 5.5), Vector2(8, -8.5), Vector2(-1, -12), Vector2(-11, -2), Vector2(11, 6.5), Vector2(3, 15)]:
		lamp(put("village-lamp", p), Vector3(0, 1.9, 0.55))
	for spec in [["fence", Vector2(-21, 8), Vector2(-21, 30)], ["fence", Vector2(-24, 4), Vector2(-40, 4)], ["fence", Vector2(22, 17), Vector2(40, 17)],
			["fence", Vector2(25.5, 14), Vector2(25.5, 40)], ["crate", Vector2(-12.5, 7.2), Vector2.ZERO], ["crate", Vector2(-11.6, 7.8), Vector2.ZERO],
			["barrel", Vector2(14.5, 8.8), Vector2.ZERO], ["barrel", Vector2(20.5, 9.5), Vector2.ZERO], ["barrel", Vector2(-16, -6.2), Vector2.ZERO],
			["table", Vector2(9.5, -12), Vector2.ZERO], ["sign", Vector2(5.5, -4.5), Vector2(40, -20)], ["mast", Vector2(30, -14), Vector2.ZERO]]:
		put("village-" + spec[0], spec[1], spec[2])
	# The launch tower beside the pad, its arm over the Kestrel.
	var pad := Worlds.place(body, "pad")
	put_near("village-tower", pad, Vector3(-11.0, 0.0, 0.0), pad.origin)
	for k in 3:
		put_near("village-crate", pad, Vector3(-8.0 + k * 0.9, 0.0, 5.0 + (k % 2) * 0.7), pad.origin)
	var obs := Worlds.place(body, "observatory")
	put_near("village-observatory", obs, Vector3.ZERO, center.origin)
	put_near("village-lookout", Worlds.place(body, "lookout"), Vector3.ZERO, center.origin)
	_mine()
	# The people: Mara by the fire, Fen on a cabin porch, a miner and a
	# hauler about the village, Okafor at the observatory's door.
	# Mara sits by her own fire with the banjo, the first thing you see.
	person("mara", "mara", Vector2(-2.6, 1.4), Vector2.ZERO, true)
	person("fen", "crowd2", Vector2(-13.0, 6.0), Vector2.ZERO)
	person("miner", "crowd3", Vector2(10.5, -11.0), Vector2(9.5, -12.0))
	person("hauler", "crowd1", Vector2(18.0, 7.0), Vector2(14.5, 8.8))
	var door := Transform3D(Site.upright(obs.basis.y, center.origin - obs.origin), obs.origin)
	var o := Npc.make("okafor", "okafor")
	add_child(o)
	var at := door * Vector3(0, 0, 5.5)
	var d := at.normalized()
	o.transform = Transform3D(Site.upright(d, center.origin - at), d * (body.radius + Worlds.height(body.key, d, body.radius)))
	# Smoke from the chimneys of the big cabins.
	for n in get_children():
		if n is Node3D and String(n.scene_file_path).ends_with("village-cabin_a.glb"):
			_chimney(n as Node3D)
	# Grass and wildflowers everywhere people do not walk.
	var clear := footprints()
	clear.append([center.origin, 4.2])
	clear.append([pad.origin, 9.0])
	Grass.field(self, center, 64.0, 15000, clear, 11)

func _chimney(cabin: Node3D) -> void:
	var p := VerdanceSite._mist(Vector3(-2.6, 6.2, -1.9))
	p.amount = 14
	p.lifetime = 7.0
	p.emission_box_extents = Vector3(0.15, 0.1, 0.15)
	p.spread = 12.0
	p.gravity = Vector3(0.12, 0.35, 0.0)
	p.initial_velocity_min = 0.3
	p.initial_velocity_max = 0.6
	p.scale_amount_min = 0.6
	p.scale_amount_max = 2.2
	((p.mesh as QuadMesh).material as StandardMaterial3D).albedo_color = Color(0.7, 0.7, 0.72, 0.2)
	cabin.add_child(p)

## The old mine past the lake: its mouth toward the village, the tunnel
## running back under its mound, a songline at the far end.
func _mine() -> void:
	var cave := Worlds.place(body, "cave")
	var m := put_near("site-mine_tunnel", cave, Vector3.ZERO, center.origin)
	for z in [-2.0, -8.0, -13.0]:
		lamp(m, Vector3(1.1, 2.3, z), Color(1.0, 0.66, 0.34), 0.9, 6.0)
	songline_at("mine", m.transform * Transform3D(Basis(), Vector3(0, 0, -14.1)))
