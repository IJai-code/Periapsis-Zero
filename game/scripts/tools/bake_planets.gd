extends SceneTree
## Bake the Reach's bodies (Worlds has their shapes) into meshes the game
## loads at once:
##   godot --headless --path game --script res://scripts/tools/bake_planets.gd [key...]
##
## Each body: art/planets/<key>-hi.res (the surface walked on, five to eight
## metres a cell) and <key>-lo.res (seen from afar), cube-spheres with
## normals from the shape itself (so the six faces meet without a seam),
## vertex colour (rgb) and bare rock (alpha). The hi mesh carries, as
## metadata, where plants and rocks stand ("deco": kind -> 8 floats each:
## position, up, turn, scale).

const HI := {"hearthstone": 96, "verdance": 120, "ashfall": 72, "phantom": 40, "wanderer": 48}
const LO := 18

func _init() -> void:
	var want := []
	for a in OS.get_cmdline_user_args():
		want.append(a)
	DirAccess.make_dir_recursive_absolute("res://art/planets")
	for b: ReachBody in ReachSystem.define():
		if b.key == "lantern" or (not want.is_empty() and not b.key in want):
			continue
		var t := Time.get_ticks_msec()
		var hi := _mesh(b, HI[b.key])
		hi.set_meta("deco", _deco(b))
		ResourceSaver.save(hi, "res://art/planets/%s-hi.res" % b.key, ResourceSaver.FLAG_COMPRESS)
		ResourceSaver.save(_mesh(b, LO), "res://art/planets/%s-lo.res" % b.key, ResourceSaver.FLAG_COMPRESS)
		print("baked %s in %d ms" % [b.key, Time.get_ticks_msec() - t])
	quit()

const FACES := [
	[Vector3.RIGHT, Vector3.UP, Vector3.BACK], [Vector3.LEFT, Vector3.UP, Vector3.FORWARD],
	[Vector3.UP, Vector3.BACK, Vector3.RIGHT], [Vector3.DOWN, Vector3.FORWARD, Vector3.RIGHT],
	[Vector3.BACK, Vector3.UP, Vector3.LEFT], [Vector3.FORWARD, Vector3.UP, Vector3.RIGHT],
]

func _mesh(b: ReachBody, n: int) -> ArrayMesh:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var e := (PI / 2.0) / n * 0.5
	for f in FACES:
		var normal: Vector3 = f[0]
		var au: Vector3 = f[1]
		var av: Vector3 = f[2]
		var base := verts.size()
		for j in n + 1:
			for i in n + 1:
				var u := -1.0 + 2.0 * i / n
				var v := -1.0 + 2.0 * j / n
				# Equal-angle cube mapping: cells of nearly even size.
				var d := (normal + au * tan(u * PI / 4.0) + av * tan(v * PI / 4.0)).normalized()
				var h := Worlds.height(b.key, d, b.radius)
				var p := d * (b.radius + h)
				var t1 := d.cross(Vector3.UP if absf(d.y) < 0.99 else Vector3.RIGHT).normalized()
				var t2 := d.cross(t1)
				var d1 := (d + t1 * e).normalized()
				var d2 := (d + t2 * e).normalized()
				var p1 := d1 * (b.radius + Worlds.height(b.key, d1, b.radius))
				var p2 := d2 * (b.radius + Worlds.height(b.key, d2, b.radius))
				var nn := (p1 - p).cross(p2 - p).normalized()
				if nn.dot(d) < 0.0:
					nn = -nn
				verts.append(p)
				norms.append(nn)
				cols.append(Worlds.paint(b.key, d, h, nn.dot(d), b.sea, b.radius))
		for j in n:
			for i in n:
				var a := base + j * (n + 1) + i
				var bb := a + 1
				var c := a + n + 1
				var dd := c + 1
				# Wound so the outside faces out.
				var mid := (verts[a] + verts[dd]) * 0.5
				var face_n := (verts[bb] - verts[a]).cross(verts[c] - verts[a])
				if face_n.dot(mid) < 0.0:
					idx.append_array([a, bb, c, bb, dd, c])
				else:
					idx.append_array([a, c, bb, bb, c, dd])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_COLOR] = cols
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

## Where the plants and rocks stand, by kind: [count, rule].
func _deco(b: ReachBody) -> Dictionary:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(b.key)
	var spec := {}
	match b.key:
		"hearthstone":
			spec = {"pine": 1500, "bush": 500, "rock": 200, "stump": 30}
		"verdance":
			spec = {"giant": 300, "tree": 1300, "palm": 350, "fern": 2400, "bush": 1200, "rock": 350}
		"ashfall":
			spec = {"rock": 420, "shard": 60}
		"phantom":
			spec = {"shard": 90, "rock": 40}
		"wanderer":
			spec = {"shard": 140}
	var marks := Worlds.landmarks(b.key)
	var out := {}
	for kind in spec:
		var data := PackedFloat32Array()
		var placed := 0
		var tries := 0
		while placed < int(spec[kind]) and tries < int(spec[kind]) * 8:
			tries += 1
			var d := Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1))
			if d.length() < 0.05 or d.length() > 1.0:
				continue
			d = d.normalized()
			# Groves: trees cluster, by a slow noise.
			if kind in ["pine", "tree", "giant", "palm"] and Worlds._n(b.key, 31, 0.012, 2).get_noise_3dv(d * b.radius) < -0.05:
				continue
			var blocked := false
			for name in marks:
				var l: Array = marks[name]
				var clear := maxf(float(l[1]) * 1.15, 10.0) if kind != "rock" else float(l[1])
				if acos(clampf(d.dot(l[0]), -1.0, 1.0)) * b.radius < clear:
					blocked = true
			if blocked:
				continue
			var h := Worlds.height(b.key, d, b.radius)
			if b.sea != 0.0 and h < b.sea + 0.8 and kind != "shard":
				continue
			# Slope: compare with a nearby point.
			var t1 := d.cross(Vector3.UP if absf(d.y) < 0.99 else Vector3.RIGHT).normalized()
			var h2 := Worlds.height(b.key, (d + t1 * (3.0 / b.radius)).normalized(), b.radius)
			var steep := absf(h2 - h) / 3.0
			if kind in ["pine", "tree", "giant", "palm", "fern", "bush", "stump"] and steep > 0.55:
				continue
			if kind == "palm" and h > b.sea + 6.0:
				continue
			var p := d * (b.radius + h - 0.3)
			# The valley's pines are tall (19 to 30 m at scale 1).
			var s := rng.randf_range(0.6, 1.05) if kind == "pine" else rng.randf_range(0.75, 1.35)
			data.append_array([p.x, p.y, p.z, d.x, d.y, d.z, rng.randf() * TAU, s])
			placed += 1
		out[kind] = data
	return out
