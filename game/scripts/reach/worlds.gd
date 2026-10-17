class_name Worlds
## The shapes and colours of the Reach's bodies, and where their places are.
## Used by the planet bake (scripts/tools/bake_planets.gd) to make the
## surfaces, and at run time to put things on them: a landmark's height is
## flattened into the surface at bake time, so both agree.
##
## Heights are metres above the body's radius; directions are unit vectors
## from the body's centre.

## Landmarks: [direction, flat radius (m), height (m)].
static func landmarks(key: String) -> Dictionary:
	match key:
		"hearthstone":
			# The village is on the equator, where at waking (t = 0) the
			# Lantern is 12 degrees below the horizon and rising: the last of
			# the night, the nebulae overhead, dawn in half a minute.
			# It sits on the floor of a crater 220 m across, its walls 46 m
			# of stratified rock (see raw_height; one degree is 4.9 m here).
			var f := _frame(Vector3(0.208, 0.0, 0.978))
			return {
				"village": [f.y, 24.0, 2.0],
				"pad": [f * _dir(10.6, 0.0), 14.0, 2.0],
				"observatory": [f * _dir(17.2, 130.0), 13.0, 5.0],
				"lookout": [f * _dir(29.1, 205.0), 9.0, 46.0],
				"cave": [f * _dir(23.7, 300.0), 12.0, 2.0],
				"falls": [f * _dir(21.3, 40.0), 0.0, -5.5],
				"pond": [f * _dir(12.8, 112.0), 0.0, -5.0],
				"lake": [f * _dir(40.0, 60.0), 0.0, -14.0],
			}
		"verdance":
			return {
				# Where the Lantern is up for most of the loop (it stands
				# over azimuth -121 at waking and -316 at the end).
				"renn": [_dir(68.0, 150.0), 24.0, 2.5],
				"pillars": [_dir(55.0, 128.0), 70.0, 9.0],
				"pod": [_dir(80.0, 168.0), 9.0, 3.0],
			}
		"ashfall":
			return {
				"wreck": [_dir(30.0, 90.0), 40.0, -3.0],
				"vex": [_dir(42.0, 72.0), 10.0, 1.0],
				"vault": [_dir(26.0, 110.0), 10.0, -4.0],
			}
		"phantom":
			return {"shrine": [Vector3(0, 1, 0), 10.0, 2.0]}
		"wanderer":
			return {"engine": [Vector3(0, 1, 0), 14.0, 4.0]}
	return {}

## On Hearthstone: the direction `dist` metres from the village along the
## ground, at `az` degrees round it (the landmarks' own reckoning).
static func crater_dir(az: float, dist: float) -> Vector3:
	var f := _frame(Vector3(0.208, 0.0, 0.978))
	return (f * _dir(rad_to_deg(dist / 280.0), az)).normalized()

## A frame whose +Y is `pole` (landmarks laid out round it), +X toward the
## body's north.
static func _frame(pole: Vector3) -> Basis:
	var y := pole.normalized()
	var x := Vector3.UP - y * y.dot(Vector3.UP)
	x = x.normalized() if x.length() > 0.01 else Vector3.RIGHT
	return Basis(x, y, x.cross(y).normalized())

## A direction at `polar` degrees from the body's north pole (+Y), turned
## `azimuth` degrees round it.
static func _dir(polar: float, azimuth: float) -> Vector3:
	var p := deg_to_rad(polar)
	var a := deg_to_rad(azimuth)
	return Vector3(sin(p) * cos(a), cos(p), sin(p) * sin(a)).normalized()

## A landmark's surface point and up, in the body's own space.
static func place(body: ReachBody, name: String) -> Transform3D:
	var l: Array = landmarks(body.key)[name]
	var d: Vector3 = l[0]
	var at := d * (body.radius + float(l[2]))
	var fwd := d.cross(Vector3.RIGHT if absf(d.y) > 0.9 else Vector3.UP).normalized()
	return Transform3D(Basis(fwd.cross(d).normalized(), d, -fwd).orthonormalized(), at)

# --- Shapes -------------------------------------------------------------------

static var _noise := {}

static func _n(key: String, seed: int, freq: float, octaves := 4, type := FastNoiseLite.TYPE_SIMPLEX_SMOOTH, fractal := FastNoiseLite.FRACTAL_FBM) -> FastNoiseLite:
	var k := "%s/%d" % [key, seed]
	if _noise.has(k):
		return _noise[k]
	var n := FastNoiseLite.new()
	n.seed = seed
	n.frequency = freq
	n.fractal_octaves = octaves
	n.noise_type = type
	n.fractal_type = fractal
	_noise[k] = n
	return n

## The raw height before landmarks are flattened in.
static func raw_height(key: String, d: Vector3, radius: float) -> float:
	var p := d * radius
	match key:
		"hearthstone":
			var hills := _n(key, 1, 0.006, 4).get_noise_3dv(p) * 22.0
			var ridges := (1.0 - absf(_n(key, 2, 0.011, 3).get_noise_3dv(p))) * 14.0 - 7.0
			var h := hills + maxf(ridges, 0.0) * smoothstep(0.1, 0.5, _n(key, 3, 0.004, 2).get_noise_3dv(p) + 0.3)
			# The lake: a bowl.
			var marks := landmarks(key)
			var lake: Vector3 = marks["lake"][0]
			h -= 22.0 * smoothstep(0.92, 0.985, d.dot(lake))
			# The crater the village sits in: a floor, walls rising 44 m over
			# 24 m, a crest, then down to the hills outside.
			var v: Vector3 = marks["village"][0]
			var dist := acos(clampf(d.dot(v), -1.0, 1.0)) * radius
			var floor := 2.0 + _n(key, 5, 0.03, 2).get_noise_3dv(p) * 1.2
			var crest := 46.0 + _n(key, 6, 0.02, 2).get_noise_3dv(p) * 4.0
			var inner := lerpf(floor, crest, pow(smoothstep(110.0, 134.0, dist), 0.85))
			h = lerpf(inner, maxf(h, 6.0), smoothstep(142.0, 190.0, dist))
			# The waterfall's pool at the wall's foot, the river from it to
			# the pond by the village (below the sea's level, so water).
			var falls: Vector3 = marks["falls"][0] * radius
			var pond: Vector3 = marks["pond"][0] * radius
			var at := d * radius
			var seg := pond - falls
			var u := clampf((at - falls).dot(seg) / seg.length_squared(), 0.0, 1.0)
			var off := (at - (falls + seg * u)).length()
			h = lerpf(h, -4.6, smoothstep(4.2, 1.4, off) * (1.0 - smoothstep(110.0, 118.0, dist)))
			h = lerpf(h, -5.5, smoothstep(10.0, 4.0, at.distance_to(falls)))
			# The lake: 37 m across, its shores sloping gently in.
			h = lerpf(h, -5.0, smoothstep(30.0, 12.0, at.distance_to(pond)))
			return h
		"verdance":
			var cont := _n(key, 1, 0.0028, 4).get_noise_3dv(p) * 46.0 + 6.0
			var hills := _n(key, 2, 0.012, 4).get_noise_3dv(p) * 10.0
			var mesas := smoothstep(0.25, 0.35, _n(key, 3, 0.005, 2).get_noise_3dv(p)) * 40.0
			return cont + hills + mesas
		"ashfall":
			var h := _n(key, 1, 0.012, 4).get_noise_3dv(p) * 7.0
			# Craters: a few big bowls with raised rims.
			for c in _craters(key):
				var ang := acos(clampf(d.dot(c[0]), -1.0, 1.0)) * radius / float(c[1])
				h += float(c[2]) * (smoothstep(1.2, 0.0, ang) * -1.0 + exp(-pow((ang - 1.0) / 0.18, 2.0)) * 0.45)
			return h
		"phantom":
			return _n(key, 1, 0.03, 3).get_noise_3dv(p) * 6.0
		"wanderer":
			# An icy, lumpy nucleus, stretched along X.
			return _n(key, 1, 0.025, 4).get_noise_3dv(p) * 9.0 + d.x * d.x * 34.0 - 12.0
	return 0.0

static func _craters(key: String) -> Array:
	if _noise.has(key + "/craters"):
		return _noise[key + "/craters"]
	var rng := RandomNumberGenerator.new()
	rng.seed = 77
	var out := []
	for i in 14:
		var d := Vector3(rng.randf_range(-1, 1), rng.randf_range(-1, 1), rng.randf_range(-1, 1)).normalized()
		out.append([d, rng.randf_range(14.0, 46.0), rng.randf_range(4.0, 12.0)])
	_noise[key + "/craters"] = out
	return out

## Height with the landmarks flattened in.
static func height(key: String, d: Vector3, radius: float) -> float:
	var h := raw_height(key, d, radius)
	for name in landmarks(key):
		var l: Array = landmarks(key)[name]
		var flat: float = l[1]
		if flat <= 0.0:
			continue
		var ang := acos(clampf(d.dot(l[0]), -1.0, 1.0)) * radius
		var k := smoothstep(flat * 1.9, flat, ang)
		h = lerpf(h, float(l[2]), k)
	return h

## Colour (rgb) and how much is bare rock (a), from height and slope (the
## surface normal's dot with up).
static func paint(key: String, d: Vector3, h: float, up_dot: float, sea: float, radius: float) -> Color:
	var p := d * radius
	var patch := _n(key, 9, 0.02, 2).get_noise_3dv(p) * 0.5 + 0.5
	var rocky := smoothstep(0.86, 0.66, up_dot)
	match key:
		"hearthstone":
			var meadow := Color(0.42, 0.6, 0.24).lerp(Color(0.55, 0.62, 0.3), patch)
			var forest := Color(0.2, 0.36, 0.17)
			var c := meadow.lerp(forest, smoothstep(0.45, 0.62, _n(key, 4, 0.009, 2).get_noise_3dv(p) * 0.5 + 0.5))
			var shore := smoothstep(sea + 2.5, sea + 0.5, h)
			c = c.lerp(Color(0.72, 0.65, 0.48), shore)
			c = c.lerp(Color(0.24, 0.3, 0.32), smoothstep(sea, sea - 2.0, h))
			c = c.lerp(Color(0.5, 0.47, 0.44), rocky)
			return Color(c.r, c.g, c.b, rocky)
		"verdance":
			var c := Color(0.18, 0.42, 0.16).lerp(Color(0.3, 0.52, 0.18), patch)
			c = c.lerp(Color(0.78, 0.7, 0.5), smoothstep(sea + 2.0, sea + 0.3, h))
			c = c.lerp(Color(0.12, 0.22, 0.24), smoothstep(sea, sea - 3.0, h))
			c = c.lerp(Color(0.62, 0.5, 0.38), rocky)
			return Color(c.r, c.g, c.b, rocky)
		"ashfall":
			var c := Color(0.42, 0.41, 0.4).lerp(Color(0.32, 0.31, 0.31), patch)
			return Color(c.r, c.g, c.b, 0.5 + rocky * 0.5)
		"phantom":
			var c := Color(0.36, 0.33, 0.42).lerp(Color(0.45, 0.42, 0.5), patch)
			return Color(c.r, c.g, c.b, 0.6 + rocky * 0.4)
		"wanderer":
			var c := Color(0.72, 0.82, 0.9).lerp(Color(0.25, 0.24, 0.26), smoothstep(0.4, 0.7, patch))
			return Color(c.r, c.g, c.b, 0.3 + rocky * 0.5)
	return Color(0.5, 0.5, 0.5, 0.5)
