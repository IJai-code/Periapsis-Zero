class_name Falls
extends Node3D
## A waterfall, built to the rock it comes off: the water leaves the gorge's
## lip with a little speed, arcs out and falls, the way water does (a
## parabola, not a plane), in three sheets: the glassy body, a thinner faster
## braid over it, and a wider veil of spray that fans out toward the bottom.
## At the foot, churning foam on the pool, spray going up and drifting, and
## the roar. The sheets are lit (they catch the Lantern and darken at night)
## with a little light of their own so they still read in the dark.

static func make(parent: Node3D, lip: Vector3, foot_y: float, up: Vector3, out: Vector3, width: float, g: float) -> Falls:
	var f := Falls.new()
	parent.add_child(f)
	f.global_transform = Transform3D(Basis(up.cross(out).normalized(), up, out), lip)
	f._build(foot_y, width, g)
	return f

## In the falls' own frame: +Y up, +Z out from the rock, the lip at the
## origin; `drop` is how far down the pool is.
func _build(drop: float, width: float, g: float) -> void:
	var sh := load("res://shaders/reach/waterfall.gdshader") as Shader
	for spec in [
		# [width, speed off the lip, layer offset, flow speed, alpha, spread at the foot, seed]
		[width, 2.6, 0.0, 1.0, 1.0, 1.15, 0.0],
		[width * 0.7, 3.2, 0.25, 1.35, 0.75, 1.0, 3.7],
		[width * 1.25, 2.2, -0.35, 0.8, 0.45, 1.9, 7.1],
	]:
		var m := ShaderMaterial.new()
		m.shader = sh
		m.set_shader_parameter("flow", spec[3])
		m.set_shader_parameter("opacity", spec[4])
		m.set_shader_parameter("seed", spec[6])
		var mi := MeshInstance3D.new()
		mi.mesh = _sheet(drop, spec[0], spec[1], spec[2], spec[5], g)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
	_foot(drop, width, g)

## A sheet along the water's path: columns across, rows down it, its UV.y
## running 0 at the lip to 1 at the pool.
func _sheet(drop: float, w: float, v0: float, lift: float, spread: float, g: float) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var t_end := sqrt(2.0 * drop / g)
	var cols := 10
	var rows := 28
	var pts := []
	for j in rows + 1:
		var k := float(j) / rows
		# More rows near the lip, where it curves.
		var t := t_end * k * k * 0.35 + t_end * k * 0.65
		var y := -0.5 * g * t * t
		var z := v0 * t + lift * k
		var half := w * 0.5 * lerpf(1.0, spread, k * k)
		var row := []
		for i in cols + 1:
			var u := float(i) / cols
			var x := (u - 0.5) * 2.0 * half
			# The lip is not a ruler: the edge sags a little toward the sides.
			var sag := -0.25 * pow(absf(u - 0.5) * 2.0, 2.0) * (1.0 - k)
			row.append([Vector3(x, y + sag, z), Vector2(u, k)])
		pts.append(row)
	for j in rows:
		for i in cols:
			var a: Array = pts[j][i]
			var b: Array = pts[j][i + 1]
			var c: Array = pts[j + 1][i + 1]
			var d: Array = pts[j + 1][i]
			for v: Array in [a, b, c, a, c, d]:
				st.set_uv(v[1])
				st.set_normal(Vector3(0, 0, 1))
				st.add_vertex(v[0])
	st.generate_normals()
	return st.commit()

## The foot: a churning ring of foam on the pool, spray going up off it and
## drifting, a light mist hanging over all of it.
func _foot(drop: float, width: float, g: float) -> void:
	var t_end := sqrt(2.0 * drop / g)
	var at := Vector3(0.0, -drop + 0.08, 2.6 * t_end)
	var foam := MeshInstance3D.new()
	var q := PlaneMesh.new()
	q.size = Vector2(width * 2.6, width * 2.0)
	foam.mesh = q
	var fm := ShaderMaterial.new()
	fm.shader = load("res://shaders/reach/foam.gdshader")
	foam.material_override = fm
	foam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	foam.position = at
	add_child(foam)
	# Spray: thrown up and out from where the water lands, drifting off.
	var spray := CPUParticles3D.new()
	var sq := QuadMesh.new()
	sq.size = Vector2(1.6, 1.6)
	var sm := StandardMaterial3D.new()
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	sm.vertex_color_use_as_albedo = true
	sm.albedo_texture = _puff()
	sm.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	sq.material = sm
	spray.mesh = sq
	spray.amount = 46
	spray.lifetime = 3.2
	spray.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	spray.emission_box_extents = Vector3(width * 0.5, 0.2, 1.2)
	spray.direction = Vector3(0, 1, 0.6)
	spray.spread = 35.0
	spray.initial_velocity_min = 2.5
	spray.initial_velocity_max = 5.5
	spray.gravity = Vector3(0, -1.2, 0.4)
	spray.damping_min = 0.8
	spray.damping_max = 1.6
	spray.scale_amount_min = 1.0
	spray.scale_amount_max = 3.2
	var curve := Curve.new()
	curve.add_point(Vector2(0.0, 0.4))
	curve.add_point(Vector2(1.0, 2.2))
	spray.scale_amount_curve = curve
	var ramp := Gradient.new()
	ramp.offsets = PackedFloat32Array([0.0, 0.15, 1.0])
	ramp.colors = PackedColorArray([Color(1, 1, 1, 0.0), Color(0.92, 0.96, 1.0, 0.42), Color(0.9, 0.95, 1.0, 0.0)])
	spray.color_ramp = ramp
	spray.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	spray.position = at + Vector3(0, 0.3, 0)
	add_child(spray)

static var _puff_tex: Texture2D

## A soft round puff, made once.
static func _puff() -> Texture2D:
	if _puff_tex:
		return _puff_tex
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var d := Vector2(x - 15.5, y - 15.5).length() / 15.5
			var a := clampf(1.0 - d, 0.0, 1.0)
			img.set_pixel(x, y, Color(1, 1, 1, a * a))
	_puff_tex = ImageTexture.create_from_image(img)
	return _puff_tex
