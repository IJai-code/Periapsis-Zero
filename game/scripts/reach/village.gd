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
var zerog: ZeroGCave

func reset_loop() -> void:
	if zerog:
		zerog.reset_loop()
var tower: Node3D
## Where the Kestrel rests each morning: on the tower's deck.
var ship_rest: Transform3D
## Built a piece at a time, a frame between the big steps, so a browser
## stays answerable while the village is made (it is the longest single
## piece of work in the game). Tests and the desktop build it in one go.
var chunk := false
var done := false
signal built

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
	_build()

func _build() -> void:
	var pad := _flat("pad")
	var obs := _flat("observatory")
	var cave := _flat("cave")
	var pond := _flat("pond")
	# Round the fire: benches, Mara's rocking chair, her woodpile.
	for k in 3:
		var a := TAU * k / 3.0 + 0.9
		put("valley-logbench", Vector2(cos(a), sin(a)) * 3.3, Vector2.ZERO, true, 1.0, 0.04)
	put("ph/ph-Rockingchair_01", Vector2(-3.1, -1.5), Vector2.ZERO, true, 1.05)
	# The houses, their porches toward the fire; Mara's beside it.
	for house in [["valley-house_b", Vector2(-15.0, 3.0)], ["valley-house_a", Vector2(4.0, 18.0)], ["valley-house_a", Vector2(14.0, -14.0)]]:
		if chunk:
			await get_tree().process_frame
		put(house[0], house[1])
	put("valley-woodpile", Vector2(-9.5, -2.5), Vector2(-15.0, 3.0))
	# (A frame between the pieces of work: a browser builds the village on
	# its only thread, and a second without one is "page unresponsive" on a
	# slower PC.)
	if chunk:
		await get_tree().process_frame
	for spec in [["crate", Vector2(10.0, -8.0)], ["crate", Vector2(10.8, -8.6)], ["barrel", Vector2(-5.5, -13.0)],
			]:
		put("village-" + spec[0], spec[1])
	# Poly Haven's scanned pieces (CC0, art/godot/polyhaven.py): a table and
	# barrels about the houses, stumps and fallen trunks at the clearing's
	# edge, mossy rocks under the crater's walls, ferns and shrubs by the
	# porches. [model, (east, north), scale, solid]
	var rng := RandomNumberGenerator.new()
	rng.seed = 41
	var placed := 0
	for spec in [["WoodenTable_01", Vector2(-6.0, 9.0), 1.0, true], ["Barrel_01", Vector2(11.6, -9.4), 1.15, true],
			["Barrel_01", Vector2(-17.6, -0.6), 1.15, true], ["Barrel_01", Vector2(-18.4, 0.3), 1.1, true],
			["tree_stump_01", Vector2(-30.0, 14.0), 1.5, true], ["tree_stump_02", Vector2(26.0, -24.0), 1.4, true],
			["tree_stump_01", Vector2(36.0, 9.0), 1.3, true], ["dead_tree_trunk", Vector2(-35.0, -19.0), 2.2, true],
			["dead_tree_trunk", Vector2(31.0, 27.0), 2.0, true], ["rock_moss_set_01", Vector2(-52.0, 32.0), 1.4, true],
			["rock_moss_set_02", Vector2(70.0, -55.0), 1.5, true], ["rock_moss_set_01", Vector2(46.0, 44.0), 1.2, true],
			["rock_moss_set_02", Vector2(-60.0, -62.0), 1.3, true], ["fern_02", Vector2(-19.5, 6.5), 1.0, false],
			["fern_02", Vector2(7.5, 22.0), 1.0, false], ["fern_02", Vector2(18.0, -17.5), 1.0, false],
			["fern_02", Vector2(-11.5, 6.0), 0.9, false], ["shrub_02", Vector2(-27.0, 23.0), 1.0, false],
			["shrub_02", Vector2(25.0, 17.0), 0.9, false]]:
		var a := rng.randf() * TAU
		var at: Vector2 = spec[1]
		put("ph/ph-" + spec[0], at, at + Vector2(cos(a), sin(a)) * 5.0, spec[3], spec[2], 0.05)
		placed += 1
		if chunk and placed % 4 == 0:
			await get_tree().process_frame
	# The well on the square; Mara's garden behind her house, fenced; an ore
	# cart on its rails on the way to the mine.
	put("valley-well", Vector2(9.5, 5.5), Vector2.ZERO)
	put("valley-garden", Vector2(-22.0, -4.0), Vector2(-15.0, 3.0))
	for spec in [[Vector2(-22.0, -8.6), Vector2(-22.0, -20.0)], [Vector2(-22.0, 0.6), Vector2(-22.0, 20.0)],
			[Vector2(-26.6, -2.0), Vector2(-40.0, -2.0)], [Vector2(-26.6, -6.0), Vector2(-40.0, -6.0)]]:
		put("valley-fence", spec[0], spec[1], true, 1.0, 0.1)
	put("valley-orecart", cave * 0.62 + cave.orthogonal().normalized() * 3.2, cave * 0.9, true, 1.0, 0.04)
	if chunk:
		await get_tree().process_frame
	# Paths from the fire, lanterns along them, a signpost where they part.
	_find_pier()
	var routes := {"tower": pad * 0.86, "observatory": obs * 0.88, "pond": pier_shore_flat, "mine": cave * 0.9}
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
		if chunk:
			await get_tree().process_frame
	_signpost(Vector2(6.5, -2.0), {"Launch tower": pad, "Observatory": obs, "Old mine": cave, "Pond": pond, "Zero-G cave": _flat("zerog")})
	# The Zero-G cave (ZeroGCave), its dome on the crater floor.
	if chunk:
		await get_tree().process_frame
	var zm := put_near("valley-zerog_cave", Worlds.place(body, "zerog"), Vector3.ZERO, center.origin, true, 1.0, 0.0)
	zerog = ZeroGCave.new()
	zm.add_child(zerog)
	if chunk:
		await get_tree().process_frame
	_dress_dome(zm)
	Flow.step("village: houses, paths, lamps, dome")
	if chunk:
		await get_tree().process_frame
	_tower()
	Flow.step("village: tower")
	if chunk:
		await get_tree().process_frame
	_observatory()
	Flow.step("village: observatory")
	_lake()
	put_near("village-lookout", Worlds.place(body, "lookout"), Vector3.ZERO, center.origin)
	Flow.step("village: lake, lookout")
	_mine()
	Flow.step("village: mine")
	if chunk:
		await get_tree().process_frame
	await _crater()
	Flow.step("village: crater")
	if chunk:
		await get_tree().process_frame
	# The people: Mara by the fire, Fen by a porch, Tull on the mine path,
	# Isa at the tower's foot, Okafor in the observatory. Each has a few
	# metres of errands around their post: a village is people doing things,
	# not people waiting to be talked to. The paths keep clear of the fire,
	# the benches, the chair and the well.
	var mine_dir := cave.normalized()
	var mine_side := mine_dir.orthogonal()
	var tull := cave * 0.55 + Vector2(2.0, 1.0)
	var pad_side := pad.normalized().orthogonal()
	var isa := pad * 0.8 + pad_side * 3.0
	person("mara", "mara", Vector2(-2.6, 1.4), Vector2.ZERO, false,
		[Vector2(-2.6, 1.4), Vector2(-4.2, 2.8), Vector2(-4.8, -0.2), Vector2(-6.4, -2.4)])
	person("fen", "crowd2", Vector2(7.0, 12.5), Vector2.ZERO, false,
		[Vector2(7.0, 12.5), Vector2(5.6, 9.8), Vector2(6.4, 7.2)])
	person("miner", "crowd3", tull, Vector2.ZERO, false,
		[tull, tull - mine_dir * 3.2 + mine_side * 0.7, tull - mine_dir * 6.4 - mine_side * 0.5, tull + mine_dir * 1.6])
	person("hauler", "crowd1", isa, pad, false,
		[isa, isa + pad_side * 2.2, isa - pad_side * 1.8])
	Flow.step("village: people")

	if chunk:
		await get_tree().process_frame
	# Strings of little lanterns across the square, porch to porch.
	_strings([Vector2(-15.0, 3.0), Vector2(4.0, 18.0), Vector2(14.0, -14.0)])
	# Smoke from the chimneys.
	for n in get_children():
		if n is Node3D and String(n.scene_file_path).contains("valley-house"):
			_chimney(n as Node3D)
	# Grass and wildflowers everywhere people do not walk. In the title's
	# backdrop the camera is 26 m out on the pier and never moves: a fifth
	# of the tufts is indistinguishable from all of them there, and it is
	# most of the seconds the title takes to build on a small machine.
	Flow.step("village: strings, chimneys")
	clear.append_array(footprints())
	clear.append([center.origin, 4.4])
	if chunk:
		await Grass.field(self, center, 64.0 if not backdrop else 40.0, 16000 if not backdrop else 4000, clear, 11, true)
	else:
		Grass.field(self, center, 64.0 if not backdrop else 40.0, 16000 if not backdrop else 4000, clear, 11)
	# Everything above is placed and never moves again: draw the repeated
	# pieces (lamps, cliffs, benches, houses of a kind) as a handful of
	# multimeshes rather than a hundred submissions.
	# `-- --nomerge` draws every piece as itself, for an A/B of the merge.
	Flow.step("village: grass")
	var saved := 0 if "--nomerge" in OS.get_cmdline_user_args() else merge_pieces()
	Flow.step("village: merge")
	var culled := cull_small()
	Flow.step("village: cull")
	if "--count" in OS.get_cmdline_user_args():
		print("MERGE village saved %d draws, %d small things drawn only near" % [saved, culled])
	done = true
	built.emit()

## Strings of bulbs hung between the houses' porches, sagging, warm: one
## drawing for every bulb (a multimesh) and one for the wire.
func _strings(houses: Array) -> void:
	var bulbs: Array[Transform3D] = []
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in houses.size():
		var a: Vector2 = houses[i]
		var b: Vector2 = houses[(i + 1) % houses.size()]
		# From a little in front of each porch, toward the fire.
		var pa: Vector2 = a - a.normalized() * 5.0
		var pb: Vector2 = b - b.normalized() * 5.0
		var ga := ground(pa)
		var gb := ground(pb)
		var h0 := ga.origin + ga.basis.y * 4.6
		var h1 := gb.origin + gb.basis.y * 4.6
		var n := int(h0.distance_to(h1) / 0.4)
		var prev := h0
		for k in range(1, n + 1):
			var t := float(k) / n
			var up := (h0.lerp(h1, t)).normalized()
			var p := h0.lerp(h1, t) - up * (sin(PI * t) * 1.6)
			# The wire: a thin ribbon facing up.
			var side := (p - prev).cross(up).normalized() * 0.015
			for v in [prev - side, prev + side, p + side, prev - side, p + side, p - side]:
				st.set_normal(up)
				st.add_vertex(v)
			if k % 3 == 0 and k < n:
				bulbs.append(Transform3D(Basis(), p - up * 0.12))
			prev = p
	var wire := MeshInstance3D.new()
	wire.mesh = st.commit()
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color(0.08, 0.07, 0.06)
	wm.cull_mode = BaseMaterial3D.CULL_DISABLED
	wire.material_override = wm
	wire.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(wire)
	var bm := SphereMesh.new()
	bm.radius = 0.09
	bm.height = 0.2
	bm.radial_segments = 8
	bm.rings = 4
	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color(1.0, 0.72, 0.36)
	bm.material = glow
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = bm
	mm.instance_count = bulbs.size()
	for i in bulbs.size():
		mm.set_instance_transform(i, bulbs[i])
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

var pier_xf: Transform3D
var pier_shore_flat := Vector2.ZERO
var _boat: Node3D

## Where the pier stands: on the lake's bank opposite the waterfall, its
## deck (1.1 m over the water) meeting the ground there, running out toward
## the middle.
func _find_pier() -> void:
	var lake := Worlds.place(body, "pond").origin.normalized()
	var falls := Worlds.place(body, "falls").origin.normalized()
	var away := lake - falls
	away = (away - lake * away.dot(lake)).normalized()
	var deck_h := body.sea + 1.1
	var shore := lake
	for k in 80:
		var d := lake.rotated(lake.cross(away).normalized(), float(k) * 0.4 / body.radius)
		if Worlds.height(body.key, d, body.radius) >= deck_h:
			shore = d
			break
	var out := (lake - shore)
	out = (out - shore * out.dot(shore)).normalized()
	# Its +Z (Blender -Y) toward the shore, its length out over the water.
	pier_xf = Transform3D(Site.upright(shore, -out), shore * (body.radius + deck_h))
	var local := center.basis.inverse() * (pier_xf.origin - center.origin)
	pier_shore_flat = Vector2(local.x, -local.z) - Vector2(local.x, -local.z).normalized() * 1.5

## The lake: the pier, its lantern, a coil of rope and a crate on it, the
## boat tied alongside.
func _lake() -> void:
	var pier := piece("valley-pier", pier_xf, true, 1.0, 0.0)
	Lamp.make(self, pier.transform * Vector3(-3.9, 2.66, -19.1), Color(1.0, 0.68, 0.38), 1.6, 9.0)
	var up := pier_xf.basis.y
	var at := func(x: float, y: float, z: float) -> Vector3:
		return pier.transform * Vector3(x, z, -y)
	var facing := -pier_xf.basis.x
	piece("valley-ropecoil", Transform3D(Site.upright(up, facing), at.call(-0.6, 8.0, 0.0)), false)
	piece("village-crate", Transform3D(Site.upright(up, facing), at.call(3.0, 21.4, 0.0)), true)
	_boat = piece("valley-rowboat", Transform3D(Site.upright(up, facing.rotated(up, 0.12)), at.call(2.6, 11.0, -1.12)), true)

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
		label.double_sided = false
		add_child(label)
		var up := g.basis.y
		var b := Basis(world_dir, up, world_dir.cross(up).normalized())
		var on := g.origin + up * (2.55 - k * 0.42) + world_dir * 0.75
		label.global_transform = Transform3D(b, on + b.z * 0.03)
		# The board's other face reads the right way round too.
		var back := label.duplicate() as Label3D
		back.text = "‹  " + title
		add_child(back)
		back.global_transform = Transform3D(Basis(-world_dir, up, -b.z), on - b.z * 0.03)
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

## The crater's walls: carved cliff all round (art/godot/hearth_valley.py),
## but for the mine's notch; at the falls, the gorge piece, the water
## coming down it (Falls) into the pool, its mist and its roar.
## The Zero-G cave's dome was a smooth ball under a rock texture: scanned
## boulders and a rock face or two bedded into its outside (not over its
## mouth, which is +Z), solid like the dome.
func _dress_dome(dome: Node3D) -> void:
	var box := AABB()
	var first := true
	for mi: MeshInstance3D in dome.find_children("*", "MeshInstance3D", true, false):
		var b := mi.transform * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
	var r := maxf(box.size.x, box.size.z) * 0.5
	var mid := Vector3(box.get_center().x, box.position.y, box.get_center().z)
	var rng := RandomNumberGenerator.new()
	rng.seed = 23
	var k := 0
	while k < 11:
		var az := rng.randf() * TAU
		# Clear of the mouth (+Z) by 50 degrees either side.
		if absf(angle_difference(az, 0.0)) < deg_to_rad(50.0):
			continue
		var el := rng.randf_range(0.1, 1.05)
		var out := Vector3(sin(az) * cos(el), sin(el), cos(az) * cos(el))
		var model := "ph/ph-namaqualand_boulder_03" if k % 3 != 0 else "ph/ph-cliff_face_b"
		var n: Node3D = load("res://art/%s.glb" % model).instantiate()
		dome.add_child(n)
		var sc := rng.randf_range(2.6, 4.2) if k % 3 != 0 else rng.randf_range(3.0, 4.0)
		var y := out
		var x := y.cross(Vector3.UP if absf(y.y) < 0.95 else Vector3.RIGHT).normalized()
		var b2 := Basis(x, y, x.cross(y)).rotated(y, rng.randf() * TAU).scaled(Vector3.ONE * sc)
		n.transform = Transform3D(b2, mid + Vector3(0, r * 0.15, 0) + out * r * 0.86)
		Surfaces.collide(n)
		k += 1

func _crater() -> void:
	var k := 0
	var az := 8.0
	var walls: Array[Node3D] = []
	while az < 368.0:
		var a := fmod(az, 360.0)
		if absf(angle_difference(deg_to_rad(a), deg_to_rad(300.0))) > deg_to_rad(14.0) and absf(angle_difference(deg_to_rad(a), deg_to_rad(40.0))) > deg_to_rad(11.0):
			var d := Worlds.crater_dir(a, 112.5)
			var cliff := put_dir("valley-cliff_a" if k % 2 == 0 else "valley-cliff_b", d, center.origin, true, 1.0, 0.6)
			cliff.rotate_object_local(Vector3.UP, (k % 3 - 1) * 0.03)
			walls.append(cliff)
		k += 1
		az += 25.0
	# The gap the falls used to stand in: one more stretch of wall beside
	# them, and the gorge piece itself.
	walls.append(put_dir("valley-cliff_b", Worlds.crater_dir(19.0, 112.5), center.origin, true, 1.0, 0.6))
	# The wall as it is seen: Poly Haven's scanned rock faces (stratified
	# sandstone, art/godot/polyhaven.py, squashed front to back), stood a
	# dozen times their size and overlapping, so the crater is ringed by
	# real rock and no seam shows. The carved strips stay behind them,
	# unseen, as the wall you cannot walk through.
	for w in walls:
		for mi: MeshInstance3D in w.find_children("*", "MeshInstance3D", true, false):
			mi.visible = false
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	# [model, width, depth, height] as exported.
	var faces := [["ph/ph-cliff_face_a", 4.95, 1.72, 3.57], ["ph/ph-cliff_face_b", 2.71, 1.07, 2.48]]
	# The gaps: the mine's mouth and the falls, [azimuth, half-width deg].
	var gaps := [[300.0, 4.5], [40.0, 2.2]]
	var place_face := func(f: Array, a: float, h: float, squeeze: float, turn: float) -> void:
		var sc := h / float(f[3])
		# Its face at the wall's foot (its origin is the middle of its
		# depth), stood on the crater floor's own height there: on the
		# slope behind, it showed the bare slope under and in front of it.
		var depth := float(f[2]) * sc
		var dp := Worlds.crater_dir(a, 105.0 + depth * 0.5)
		var floor_h := Worlds.height(body.key, Worlds.crater_dir(a, 99.0), body.radius)
		var base := dp * (body.radius + floor_h)
		var rock := piece(f[0], Transform3D(upright(dp, center.origin - base), base), true, sc, 3.0)
		rock.rotate_object_local(Vector3.UP, turn)
		if squeeze < 1.0:
			rock.scale = Vector3(rock.scale.x * squeeze, rock.scale.y, rock.scale.z)
	# Each gap flanked by a narrower face either side, turned a little to
	# make the sides of a gorge.
	var flank := 20.0
	for g: Array in gaps:
		for side in [-1.0, 1.0]:
			var fb: Array = faces[1]
			var h := rng.randf_range(50.0, 56.0)
			var full := float(fb[1]) * h / float(fb[3])
			var a: float = float(g[0]) + side * (float(g[1]) + rad_to_deg(flank * 0.5 / 112.5))
			place_face.call(fb, a, h, flank / full, -side * 0.35)
	# Room for a face's half-width before the nearest gap (degrees).
	var room := func(a: float) -> float:
		var best := INF
		for g: Array in gaps:
			best = minf(best, absf(rad_to_deg(angle_difference(deg_to_rad(a), deg_to_rad(float(g[0]))))) - float(g[1]) - 0.8)
		return best
	var at := 2.0
	var i := 0
	while at < 362.0:
		var a := fmod(at, 360.0)
		var f: Array = faces[i % 2 if rng.randf() > 0.25 else (i + 1) % 2]
		var h := rng.randf_range(52.0, 60.0)
		var width := float(f[1]) * h / float(f[3])
		# Next to a gap it is narrowed to stop at the gap's edge, not left
		# out (left out, the bare slope showed beside the mine's mouth).
		var hw := rad_to_deg(width * 0.5 / 112.5)
		var space: float = room.call(a)
		if space > hw * 0.3:
			place_face.call(f, a, h, minf(1.0, space / hw), rng.randf_range(-0.22, 0.22) if space > hw else 0.0)
			# (Each face is a scanned rock made solid: a few a frame.)
			if chunk and i % 3 == 0:
				await get_tree().process_frame
		# On round the ring, each overlapping the last by two fifths.
		at += rad_to_deg(width * 0.6 / 112.5) if space > hw else 2.5
		i += 1
	# Boulders fallen from it, at its foot.
	for b in 14:
		var a2 := rng.randf() * 360.0
		if absf(angle_difference(deg_to_rad(a2), deg_to_rad(300.0))) < deg_to_rad(16.0) or absf(angle_difference(deg_to_rad(a2), deg_to_rad(40.0))) < deg_to_rad(12.0):
			continue
		var bd := Worlds.crater_dir(a2, rng.randf_range(95.0, 100.0))
		var boulder := put_dir("ph/ph-namaqualand_boulder_03", bd, center.origin, true, rng.randf_range(2.2, 4.2), 0.5)
		boulder.rotate_object_local(Vector3.UP, rng.randf() * TAU)
		if chunk and b % 4 == 0:
			await get_tree().process_frame
	if chunk:
		await get_tree().process_frame
	var gorge := put_dir("valley-cliff_falls", Worlds.crater_dir(40.0, 112.5), center.origin, true, 1.0, 0.6)
	# Where the gorge's lip and foot are, read off the rock itself.
	var lip := Vector3(0.0, 39.0, 0.0)
	var foot_z := 0.0
	for mi: MeshInstance3D in gorge.find_children("*", "MeshInstance3D", true, false):
		if not String(mi.name).contains("face"):
			continue
		var vs: PackedVector3Array = mi.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
		var best := -INF
		for v in vs:
			var lv := mi.transform * v
			if absf(lv.x) < 0.9 and lv.y > 38.2 and lv.y < 39.6 and lv.z > best:
				best = lv.z
				lip = lv
			if absf(lv.x) < 1.5 and lv.y > -0.5 and lv.y < 1.0:
				foot_z = maxf(foot_z, lv.z)
	var up := gorge.global_basis.y.normalized()
	var out := gorge.global_basis.z.normalized()
	var lip_w := gorge.global_transform * (lip + Vector3(0.0, 0.15, 0.3))
	var water := body.radius + body.sea
	var drop := lip_w.length() - water
	falls = Falls.make(self, lip_w, drop, up, out, 4.6, body.surface_gravity())
	var foot := lip_w - up * drop + out * 8.0
	var mist := VerdanceSite._mist(Vector3.ZERO)
	mist.amount = 40
	mist.emission_box_extents = Vector3(4.0, 0.3, 2.0)
	add_child(mist)
	mist.global_transform = Transform3D(Site.upright(up, out), foot + up * 0.6)
	if chunk:
		await get_tree().process_frame
	var roar := AudioStreamPlayer3D.new()
	roar.stream = ReachSounds.falls()
	roar.unit_size = 10.0
	roar.max_distance = 110.0
	roar.volume_db = -4.0
	roar.autoplay = true
	add_child(roar)
	roar.global_position = foot + up * 3.0

var falls: Falls

## The old mine past the lake: its mouth toward the village, the tunnel
## running back under its mound, a songline at the far end.
func _mine() -> void:
	var cave := Worlds.place(body, "cave")
	var m := put_near("site-mine_tunnel", cave, Vector3.ZERO, center.origin)
	for z in [-2.0, -8.0, -13.0]:
		lamp(m, Vector3(1.1, 2.3, z), Color(1.0, 0.66, 0.34), 0.9, 6.0)
	songline_at("mine", m.transform * Transform3D(Basis(), Vector3(0, 0, -14.1)))
