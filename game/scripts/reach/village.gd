class_name Village
extends Site
## Hearth: a mining village on the floor of a crater, its walls 46 m of
## stratified rock, a waterfall down one side into the river and the pond.
## Stilt houses round the campfire, Mara's beside it; dirt paths lit by
## lanterns out to the launch tower (a lift up it to the Kestrel on top),
## to the observatory on its rise (a museum inside: what the Reach is and
## how to get about it), to the pond's dock and to the old mine in the
## wall. Pieces: art/godot/hearth_valley.py, reach_sites.py and
## hearth_village.py.

var lift: TowerLift
var tower: Node3D
## Where the Kestrel rests each morning: on the tower's deck.
var ship_rest: Transform3D

static func make(b: ReachBody) -> Village:
	var v := Village.new(b, "village")
	v.name = "Village"
	return v

## A landmark as (east, north) metres in the village's own frame.
func _flat(name: String) -> Vector2:
	var at := Worlds.place(body, name).origin
	var local := center.basis.inverse() * (at - center.origin)
	return Vector2(local.x, -local.z)

func _ready() -> void:
	var pad := _flat("pad")
	var obs := _flat("observatory")
	var cave := _flat("cave")
	var pond := _flat("pond")
	# Round the fire: benches, Mara's rocking chair, her woodpile.
	for k in 3:
		var a := TAU * k / 3.0 + 0.9
		put("village-bench", Vector2(cos(a), sin(a)) * 3.2, Vector2.ZERO, false)
	put("valley-chair", Vector2(-3.1, -1.5), Vector2.ZERO, false)
	# The houses, their porches toward the fire; Mara's beside it.
	put("valley-house_b", Vector2(-15.0, 3.0))
	put("valley-house_a", Vector2(4.0, 18.0))
	put("valley-house_a", Vector2(14.0, -14.0))
	put("valley-house_b", Vector2(-9.0, -18.5))
	put("valley-house_a", Vector2(19.0, 6.0))
	put("valley-woodpile", Vector2(-9.5, -2.5), Vector2(-15.0, 3.0))
	for spec in [["crate", Vector2(10.0, -8.0)], ["crate", Vector2(10.8, -8.6)], ["barrel", Vector2(-5.5, -13.0)],
			["barrel", Vector2(13.0, 12.0)], ["table", Vector2(-6.0, 9.0)], ["mast", Vector2(-24.0, -26.0)]]:
		put("village-" + spec[0], spec[1])
	# Paths from the fire, lanterns along them, a signpost where they part.
	var routes := {"tower": pad * 0.86, "observatory": obs * 0.88, "pond": pond * 0.8, "mine": cave * 0.9}
	var clear := []
	for key in routes:
		var to: Vector2 = routes[key]
		var start: Vector2 = to.normalized() * 4.5
		var dirs := []
		var steps := 6
		for k in steps + 1:
			var p: Vector2 = start.lerp(to, float(k) / steps)
			# A little wander.
			p += to.normalized().orthogonal() * sin(k * 1.7 + to.x) * 1.2 * sin(PI * float(k) / steps)
			dirs.append(ground(p).origin)
			clear.append([ground(p).origin, 2.2])
		path(dirs, 2.4)
		var lamps := int(start.distance_to(to) / 13.0)
		for k in range(1, lamps + 1):
			var p: Vector2 = start.lerp(to, float(k) / (lamps + 1)) + to.normalized().orthogonal() * (2.4 if k % 2 == 0 else -2.4)
			lamp(put("valley-lamp2", p, p + to.normalized().orthogonal() * (-1.0 if k % 2 == 0 else 1.0)), Vector3(0, 2.25, 0.72), Color(1.0, 0.7, 0.4), 1.4, 8.0)
	_signpost(Vector2(6.5, -2.0), {"Launch tower": pad, "Observatory": obs, "Old mine": cave, "Pond": pond})
	_tower()
	_observatory()
	put("valley-dock", pond + (Vector2.ZERO - pond).normalized() * 7.5, pond)
	put_near("village-lookout", Worlds.place(body, "lookout"), Vector3.ZERO, center.origin)
	_mine()
	_crater()
	# The people: Mara by the fire, Fen by a porch, Tull on the mine path,
	# Isa at the tower's foot, Okafor in the observatory.
	person("mara", "mara", Vector2(-2.6, 1.4), Vector2.ZERO)
	person("fen", "crowd2", Vector2(7.0, 12.5), Vector2.ZERO)
	person("miner", "crowd3", cave * 0.55 + Vector2(2.0, 1.0), Vector2.ZERO)
	person("hauler", "crowd1", pad * 0.8 + pad.orthogonal().normalized() * 3.0, pad)
	# Smoke from the chimneys.
	for n in get_children():
		if n is Node3D and String(n.scene_file_path).contains("valley-house"):
			_chimney(n as Node3D)
	# Grass and wildflowers everywhere people do not walk.
	clear.append_array(footprints())
	clear.append([center.origin, 4.4])
	Grass.field(self, center, 64.0, 15000, clear, 11)

## A signpost with a board toward each place, its name on it.
func _signpost(at: Vector2, places: Dictionary) -> void:
	var post := put("valley-signpost", at, at + Vector2(0, 5))
	var k := 0
	for title in places:
		var to: Vector2 = places[title]
		var dir2 := (to - at).normalized()
		var g := ground(at)
		var world_dir := (g.basis.x * dir2.x - g.basis.z * dir2.y).normalized()
		var label := Label3D.new()
		label.text = title + "  ›"
		label.font = ReachStyle.serif_bold
		label.font_size = 54
		label.pixel_size = 0.0045
		label.modulate = Color(0.95, 0.9, 0.78)
		label.outline_size = 10
		label.outline_modulate = Color(0.2, 0.13, 0.08)
		label.double_sided = true
		add_child(label)
		var up := g.basis.y
		var side := up.cross(world_dir).normalized()
		label.global_transform = Transform3D(Basis(world_dir, up, world_dir.cross(up).normalized()), g.origin + up * (2.55 - k * 0.42) + world_dir * 0.75)
		k += 1

## The launch tower over the pad, its lift, and the Kestrel's rest on top.
func _tower() -> void:
	var pad := Worlds.place(body, "pad")
	tower = put_near("valley-tower2", pad, Vector3.ZERO, center.origin)
	lift = TowerLift.new()
	tower.add_child(lift)
	ship_rest = Transform3D(tower.basis.orthonormalized(), tower.position + tower.basis.y.normalized() * (30.2 + 1.95))

## The observatory on its rise; inside, the museum and Okafor.
func _observatory() -> void:
	var mark := Worlds.place(body, "observatory")
	var o := put_near("valley-observatory2", mark, Vector3.ZERO, center.origin)
	var museum := Museum.new()
	o.add_child(museum)
	# Okafor by the telescope's pier, facing the door.
	var d := (o.transform * Vector3(-1.6, 0.6, 1.8)).normalized()
	var at := o.transform * Vector3(-1.6, 0.6, 1.8)
	var n := Npc.make("okafor", "okafor")
	add_child(n)
	n.transform = Transform3D(Site.upright(d, o.transform * Vector3(0, 0.6, 8.0) - at), at)

func _chimney(cabin: Node3D) -> void:
	var two := String(cabin.scene_file_path).contains("house_b")
	var p := VerdanceSite._mist(Vector3(-2.0, 11.4, -3.2) if two else Vector3(-2.9, 9.3, -3.0))
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

## The crater's walls: segments of stratified cliff all round, but for the
## mine's notch and the waterfall; the falls themselves, their pool's mist.
func _crater() -> void:
	var k := 0
	var az := 8.0
	while az < 368.0:
		var a := fmod(az, 360.0)
		if absf(angle_difference(deg_to_rad(a), deg_to_rad(300.0))) > deg_to_rad(14.0) and absf(angle_difference(deg_to_rad(a), deg_to_rad(40.0))) > deg_to_rad(11.0):
			var d := Worlds.crater_dir(a, 112.5)
			var cliff := put_dir("valley-cliff_a" if k % 2 == 0 else "valley-cliff_b", d, center.origin, true, 1.0, 0.6)
			cliff.rotate_object_local(Vector3.UP, (k % 3 - 1) * 0.03)
		k += 1
		az += 25.0
	# The falls: over the crest and down the wall into the pool.
	var top_d := Worlds.crater_dir(40.0, 126.0)
	var foot_d := Worlds.crater_dir(40.0, 106.0)
	var top := top_d * (body.radius + Worlds.height(body.key, top_d, body.radius) + 1.0)
	var foot := foot_d * (body.radius + Worlds.height(body.key, foot_d, body.radius) - 2.0)
	var along := top - foot
	var up := along.normalized()
	var face := (center.origin - foot)
	face = (face - up * face.dot(up)).normalized()
	var sheet := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(8.0, along.length())
	sheet.mesh = q
	var wm := ShaderMaterial.new()
	wm.shader = load("res://shaders/reach/waterfall.gdshader")
	sheet.material_override = wm
	sheet.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(sheet)
	sheet.global_transform = Transform3D(Basis(up.cross(face).normalized(), up, face), foot + along * 0.5)
	var mist := VerdanceSite._mist(Vector3.ZERO)
	mist.amount = 40
	mist.emission_box_extents = Vector3(4.0, 0.3, 2.0)
	add_child(mist)
	mist.transform = Transform3D(Site.upright(foot_d, face), foot + foot_d * 0.6)
	var roar := AudioStreamPlayer3D.new()
	roar.stream = ReachSounds.falls()
	roar.unit_size = 10.0
	roar.max_distance = 110.0
	roar.volume_db = -4.0
	roar.autoplay = true
	add_child(roar)
	roar.position = foot + foot_d * 3.0

## The old mine past the lake: its mouth toward the village, the tunnel
## running back under its mound, a songline at the far end.
func _mine() -> void:
	var cave := Worlds.place(body, "cave")
	var m := put_near("site-mine_tunnel", cave, Vector3.ZERO, center.origin)
	for z in [-2.0, -8.0, -13.0]:
		lamp(m, Vector3(1.1, 2.3, z), Color(1.0, 0.66, 0.34), 0.9, 6.0)
	songline_at("mine", m.transform * Transform3D(Basis(), Vector3(0, 0, -14.1)))
