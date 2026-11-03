class_name Homecoming
extends Node3D
## The first season's live event, at one moment for everyone (Season
## SEASONS[0].event): the Fold opens and the Long Song, the Founders' ark,
## a hundred years gone, comes home. It slides out of the cloud, sweeps
## Hearth with its searchlight and settles at the Fold's mouth, where it
## stays: from then on every traveller's Reach has it in the sky. Ten
## minutes before, the countdown; after, the Season page plays it again.
## Hangs off the Fold (which hangs off the Lantern), so it rides every
## frame change with the cloud.

const LENGTH := 1600.0
const RUN := 150.0
## Where it settles: out of the cloud toward the Lantern, in the Fold's
## own space.
var PARK := -Fold.AT.normalized() * (Fold.RADIUS + 1500.0) + Vector3(0, 300, 0)

var reach: Node
var _ark: Node3D
var _rings: Array[Node3D] = []
var _lights: Array[MeshInstance3D] = []
var _beam: MeshInstance3D
var _beam_mat: StandardMaterial3D
var _flash: MeshInstance3D
var _flash_mat: StandardMaterial3D
var _music: AudioStreamPlayer
var playing := false
var _t := 0.0
var _auto_done := false
var _blink := 0.0
## For looking at it (`#reach/homecoming:watch`): a camera above Hearth's
## crater that follows the ark.
var watch: Camera3D

const LINES := [
	[4.0, "The Fold is opening. Something is coming through."],
	[14.0, "Sadie Marr, on every channel: Long Song to Hearth. We see your fire."],
	[30.0, "Sadie Marr: A hundred years. Pell, look at it. Look at the lake."],
	[46.0, "Pell: The Engine is still singing. Someone kept it singing all this time."],
	[62.0, "Sadie Marr: To whoever remembers the mornings: thank you. We will take it from here."],
	[80.0, "Sadie Marr: Pell. The core. Where is the core?"],
	[98.0, "Rook, on the drones' channel: Welcome home, Sadie. You're late. I kept your seat warm."],
	[118.0, "Sadie Marr: Hearth, do not trust that voice. Whatever he offers you."],
	[136.0, "The Long Song is home. Season 2: Homecoming."],
]

func _ready() -> void:
	_build()
	_ark.visible = false
	_place(1.0)

func _build() -> void:
	_ark = Node3D.new()
	add_child(_ark)
	var hull := StandardMaterial3D.new()
	hull.albedo_color = Color(0.82, 0.8, 0.74)
	hull.metallic = 0.6
	hull.roughness = 0.45
	hull.emission_enabled = true
	hull.emission = Color(0.25, 0.22, 0.2)
	var dark := hull.duplicate() as StandardMaterial3D
	dark.albedo_color = Color(0.3, 0.27, 0.25)
	dark.emission = Color(0.06, 0.05, 0.05)
	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color(1.4, 1.1, 0.7)
	var engine := StandardMaterial3D.new()
	engine.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	engine.albedo_color = Color(0.6, 0.85, 1.6)
	# The spine, the length of the ark, forward along -Z.
	var spine := _part(CylinderMesh.new(), hull, Vector3.ZERO, Vector3(90, LENGTH, 90), Vector3(PI * 0.5, 0, 0))
	(spine.mesh as CylinderMesh).radial_segments = 20
	# The bow: a long blunt nose with a lit band.
	var bow := SphereMesh.new()
	bow.radial_segments = 24
	bow.rings = 12
	_part(bow, hull, Vector3(0, 0, -LENGTH * 0.5), Vector3(150, 150, 340))
	_part(CylinderMesh.new(), glow, Vector3(0, 0, -LENGTH * 0.5 + 90), Vector3(154, 10, 154), Vector3(PI * 0.5, 0, 0))
	# Three habitat rings that turn, on spokes.
	for k in 3:
		var ring := Node3D.new()
		ring.position = Vector3(0, 0, -LENGTH * 0.25 + k * 300.0)
		_ark.add_child(ring)
		var tor := TorusMesh.new()
		tor.inner_radius = 0.86
		tor.outer_radius = 1.0
		tor.rings = 48
		tor.ring_segments = 10
		var t := MeshInstance3D.new()
		t.mesh = tor
		t.material_override = hull
		t.scale = Vector3.ONE * 300.0
		t.rotation = Vector3(PI * 0.5, 0, 0)
		ring.add_child(t)
		# Windows round the ring: a lit band.
		var band := MeshInstance3D.new()
		var bt := TorusMesh.new()
		bt.inner_radius = 0.995
		bt.outer_radius = 1.005
		bt.rings = 48
		band.mesh = bt
		band.material_override = glow
		band.scale = Vector3(301, 40, 301)
		band.rotation = Vector3(PI * 0.5, 0, 0)
		ring.add_child(band)
		for s in 4:
			var spoke := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(14, 560, 14)
			spoke.mesh = bm
			spoke.material_override = dark
			spoke.rotation = Vector3(0, 0, PI * 0.25 * s)
			ring.add_child(spoke)
		_rings.append(ring)
	# Cargo pods along the spine.
	for k in 10:
		var a := TAU * k / 10.0
		_part(BoxMesh.new(), dark if k % 2 else hull, Vector3(cos(a) * 70.0, sin(a) * 70.0, LENGTH * 0.18 + (k % 3) * 60.0), Vector3(40, 40, 140))
	# The engines: four bells and their light.
	for k in 4:
		var a := TAU * k / 4.0 + PI * 0.25
		var at := Vector3(cos(a) * 80.0, sin(a) * 80.0, LENGTH * 0.5 + 40.0)
		_part(CylinderMesh.new(), dark, at, Vector3(70, 120, 70), Vector3(PI * 0.5, 0, 0))
		var plume := _part(SphereMesh.new(), engine, at + Vector3(0, 0, 90), Vector3(60, 60, 220))
		plume.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Running lights, red and green, blinking.
	for k in 8:
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.albedo_color = Color(2.0, 0.3, 0.2) if k % 2 else Color(0.3, 2.0, 0.5)
		var s := SphereMesh.new()
		s.radial_segments = 8
		s.rings = 4
		_lights.append(_part(s, m, Vector3(110.0 * (1 if k % 2 else -1), 0, -LENGTH * 0.4 + k * 190.0), Vector3.ONE * 18.0))
	# The searchlight: a long faint cone from the bow toward Hearth.
	_beam = MeshInstance3D.new()
	var cone := CylinderMesh.new()
	cone.top_radius = 0.0
	cone.bottom_radius = 1.0
	cone.height = 1.0
	cone.radial_segments = 24
	cone.cap_top = false
	cone.cap_bottom = false
	_beam.mesh = cone
	_beam_mat = StandardMaterial3D.new()
	_beam_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_beam_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_beam_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_beam_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_beam_mat.albedo_color = Color(1.0, 0.9, 0.7, 0.0)
	_beam.material_override = _beam_mat
	_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_beam.visible = false
	add_child(_beam)
	# The Fold's flash as it opens.
	_flash = MeshInstance3D.new()
	var fs := SphereMesh.new()
	fs.radial_segments = 24
	fs.rings = 12
	_flash.mesh = fs
	_flash_mat = StandardMaterial3D.new()
	_flash_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_flash_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_flash_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_flash_mat.albedo_color = Color(0.7, 0.9, 1.0, 0.0)
	_flash.material_override = _flash_mat
	_flash.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_flash.visible = false
	add_child(_flash)
	for gi: GeometryInstance3D in _ark.find_children("*", "GeometryInstance3D", true, false):
		gi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

func _part(mesh: Mesh, mat: Material, at: Vector3, scale_by: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = at
	mi.rotation = rot
	if mesh is CylinderMesh:
		(mesh as CylinderMesh).top_radius = 0.5
		(mesh as CylinderMesh).bottom_radius = 0.5
		(mesh as CylinderMesh).height = 1.0
	elif mesh is SphereMesh:
		(mesh as SphereMesh).radius = 0.5
		(mesh as SphereMesh).height = 1.0
	elif mesh is BoxMesh:
		(mesh as BoxMesh).size = Vector3.ONE
	mi.scale = scale_by
	_ark.add_child(mi)
	return mi

## Along the way out of the cloud: 0 in its heart, 1 parked.
func _place(k: float) -> void:
	var e := 1.0 - pow(1.0 - clampf(k, 0.0, 1.0), 3.0)
	var at := Vector3.ZERO.lerp(PARK, e)
	_ark.position = at
	var dir := PARK.normalized()
	# Nose along the way out, then turned a little toward the Lantern, as
	# though looking at it.
	_ark.basis = Basis.looking_at(dir, Vector3.UP).slerp(Basis.looking_at(-Fold.AT.normalized(), Vector3.UP), e * 0.5)
	_ark.scale = Vector3.ONE * lerpf(0.35, 1.0, minf(1.0, k * 3.0))

func _process(dt: float) -> void:
	_blink += dt
	for i in _lights.size():
		_lights[i].visible = fmod(_blink + i * 0.13, 1.6) < 0.25
	for i in _rings.size():
		_rings[i].rotate_object_local(Vector3.FORWARD, dt * (0.05 + i * 0.01))
	if playing:
		_run(dt)
		return
	var now := Season.now()
	var at := Season.homecoming_at()
	var hud: ReachHud = reach.hud if reach else null
	_ark.visible = now >= at
	if hud and hud.season:
		var left := at - now
		hud.season.countdown("The Fold is stirring. The Homecoming in %s" % Season.span(left) if left > 0.0 and left < 600.0 else "")
	# It happens to whoever is here when it does (within twenty minutes of
	# the moment, so a loading page or a loop's end does not miss it).
	if not _auto_done and now >= at and now < at + 1200.0 and reach and reach.loop and not reach.loop.ending and not reach.talking and reach.player:
		_auto_done = true
		play()

## Where the pass goes over: above whoever is watching, on the world they
## are on (as a body key and a place on it, so it rides the frames).
var _over_key := ""
var _over := Vector3.ZERO
var _side := Vector3.RIGHT
var _from_end := Vector3.ZERO
var _last := Vector3.ZERO

func play() -> void:
	if playing:
		return
	playing = true
	_t = 0.0
	_ark.visible = true
	_place(0.0)
	_aim_watch()
	var cam := get_viewport().get_camera_3d()
	var sys: ReachSystem = reach.system if reach else null
	if sys and cam:
		_over_key = sys.ref
		var base := sys.world(_over_key)
		var me := (watch.global_position if watch else cam.global_position) - base
		if _over_key == "lantern":
			_over = me + (global_position - cam.global_position).normalized() * 3500.0
			_side = (global_position - cam.global_position).cross(Vector3.UP).normalized()
		else:
			var b: ReachBody = sys.bodies[_over_key]
			var up := me.normalized()
			_over = up * (maxf(me.length(), b.radius) + 2400.0)
			_side = up.cross((global_position - base).normalized()).normalized()
			if _side.length() < 0.5:
				_side = up.cross(Vector3.RIGHT).normalized()
	_last = _ark.global_position
	_flash.visible = true
	_line_i = 0
	if reach:
		(reach.system as ReachSystem).running = false
		if reach.hud and reach.hud.season:
			reach.hud.season.countdown("")
	Sfx.play("warp", -2.0, 0.7)
	_music = AudioStreamPlayer.new()
	_music.stream = load("res://audio/reach/choir.wav")
	_music.volume_db = -4.0 + Flow.music_db()
	add_child(_music)
	_music.play()

var _line_i := 0

## Out of the Fold to over the watcher (a third of the run), slowly across
## their sky (a fifth), then back to its place at the Fold's mouth.
func _fly(k: float) -> void:
	if _over_key == "" or not reach:
		_place(k)
		return
	var sys: ReachSystem = reach.system
	var over := sys.world(_over_key) + _over
	var fold_at := global_position
	var park := to_global(PARK)
	var at: Vector3
	if k < 0.35:
		var e := smoothstep(0.0, 1.0, k / 0.35)
		var mid := fold_at.lerp(over, 0.5) + (over - sys.world(_over_key)).normalized() * 4000.0
		at = fold_at.lerp(mid, e).lerp(mid.lerp(over, e), e)
		_ark.scale = Vector3.ONE * lerpf(0.35, 1.0, minf(1.0, k * 8.0))
	elif k < 0.6:
		at = over + _side * lerpf(-900.0, 900.0, (k - 0.35) / 0.25)
		_from_end = at
	else:
		var e := smoothstep(0.0, 1.0, (k - 0.6) / 0.4)
		var start := over + _side * 900.0
		var mid := start.lerp(park, 0.5) + (start - sys.world(_over_key)).normalized() * 3000.0
		at = start.lerp(mid, e).lerp(mid.lerp(park, e), e)
	_ark.global_position = at
	var v := at - _last
	if v.length() > 0.01:
		var want := Basis.looking_at(v.normalized(), (over - sys.world(_over_key)).normalized() if _over_key != "lantern" else Vector3.UP)
		_ark.global_basis = _ark.global_basis.orthonormalized().slerp(want, minf(1.0, get_process_delta_time() * 1.5)).scaled(_ark.scale)
	_last = at

func _run(dt: float) -> void:
	_t += dt
	_fly(_t / RUN)
	# The cloud flashes open, then lets go of it.
	var f := clampf(1.0 - absf(_t - 3.0) / 3.0, 0.0, 1.0)
	_flash_mat.albedo_color.a = f * 0.55
	_flash.scale = Vector3.ONE * Fold.RADIUS * (0.6 + _t * 0.08)
	_flash.visible = f > 0.0
	# The searchlight on Hearth, from forty seconds to a hundred and ten.
	var beam := smoothstep(44.0, 54.0, _t) * (1.0 - smoothstep(86.0, 94.0, _t))
	_beam.visible = beam > 0.0 and reach != null
	if _beam.visible:
		var from := _ark.global_position + _ark.global_basis.z * -LENGTH * 0.5 * _ark.scale.x
		var sys: ReachSystem = reach.system
		var to: Vector3 = sys.world(_over_key) + _over.normalized() * (_over.length() - 2400.0) if _over_key not in ["", "lantern"] else sys.world("hearthstone")
		var d := to - from
		var len := d.length()
		var up := d / len
		var side := up.cross(Vector3.RIGHT if absf(up.x) < 0.9 else Vector3.FORWARD).normalized()
		# A cylinder's axis is its Y; its narrow end (top) at the bow.
		_beam.global_transform = Transform3D(Basis(side * len * 0.03, -up * len, side.cross(-up) * len * 0.03), from + d * 0.5)
		_beam_mat.albedo_color.a = 0.07 * beam
	_aim_watch()
	while _line_i < LINES.size() and _t >= float(LINES[_line_i][0]):
		if reach and reach.hud:
			reach.hud.caption(LINES[_line_i][1], 9.0)
		_line_i += 1
	if _t >= RUN:
		_end()

func _aim_watch() -> void:
	if not watch:
		return
	if not watch.current:
		watch.make_current()
	# Off to the side of the pass, high, the world below.
	var sys: ReachSystem = reach.system
	var hearth := sys.world("hearthstone")
	var fire := hearth + Worlds.place(sys.bodies["hearthstone"], "village").origin
	var up := (fire - hearth).normalized()
	var side := up.cross(Vector3.RIGHT).normalized()
	watch.global_position = fire + up * 1200.0 + side * 5000.0
	watch.look_at(_ark.global_position, up)

func _end() -> void:
	playing = false
	_ark.scale = Vector3.ONE
	_beam.visible = false
	_flash.visible = false
	_place(1.0)
	if _music:
		var tw := _music.create_tween()
		tw.tween_property(_music, "volume_db", -60.0, 6.0)
		tw.tween_callback(_music.queue_free)
		_music = null
	if reach:
		(reach.system as ReachSystem).running = true
	if not bool(Flow.progress("homecoming_seen", false)):
		Flow.set_progress("homecoming_seen", true)
		Season.add(2500, "You saw the Homecoming")
	_ark.visible = Season.now() >= Season.homecoming_at()
