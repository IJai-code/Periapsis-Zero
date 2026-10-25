class_name Person
extends Node3D
## A character from art/godot/people.py: plays "idle" or "talk" and turns
## to face someone.

var who := ""
## Solid people block whoever walks into them; the player's own body is not.
var solid := true
## The work suit's colour, multiplied over its denim.
var suit_tint := Color(0.62, 0.6, 0.58)
var _anim: AnimationPlayer
var _gait := "idle"
var _yaw_target := NAN
## Faces: every mesh carrying the expression keys (body, lashes, brows,
## teeth, tongue), so they move together.
## Each entry: [mesh, blend-shape index for each name in SHAPES (-1 if absent)].
## Looked up once when the person is built, not by name every frame.
const SHAPES := ["blink_l", "blink_r", "mouth_open", "purse", "smile", "brow_l", "brow_r"]
var _faces: Array = []
var _vals := PackedFloat32Array([0, 0, 0, 0, 0, 0, 0])
var _applied := PackedFloat32Array([INF, INF, INF, INF, INF, INF, INF])
const STRIDES := ["walk", "run", "crouch_walk"]
var _talking := false
var _mouth := 0.0
var _blink_in := 2.0
var _blink := 0.0
var _brow := 0.0
var _t := 0.0
## Where the head turns to (LifeMotion), Vector3.INF for nowhere.
var look_at_point := Vector3.INF
## The gesture under way (LifeMotion), how far in and how long it lasts.
var gesture_name := ""
var gesture_t := 0.0
var gesture_len := 0.0

## The Reach's people are Quaternius's (art/godot/crew_people.py): who is
## built from which, and the colour of their flight suit.
const QUAT := {
	"mara": ["mara", Color(0.62, 0.3, 0.18)], "okafor": ["okafor", Color(0.18, 0.26, 0.42)],
	"crowd2": ["fen", Color(0.35, 0.5, 0.32)], "crowd3": ["tull", Color(0.55, 0.45, 0.28)],
	"crowd1": ["isa", Color(0.75, 0.48, 0.16)], "renn": ["renn", Color(0.72, 0.38, 0.2)],
	"vex": ["vex", Color(0.28, 0.3, 0.32)], "pilot": ["pilot", Color(0.2, 0.32, 0.5)],
	"fen": ["fen", Color(0.35, 0.5, 0.32)], "tull": ["tull", Color(0.55, 0.45, 0.28)], "isa": ["isa", Color(0.75, 0.48, 0.16)],
	"hale": ["hale", Color(0.3, 0.32, 0.4)], "warden": ["warden", Color(0.4, 0.3, 0.25)],
}
var _quat := false
## Hair colour, by who (Quaternius's hair is a grey texture to be tinted).
const HAIR := {"mara": Color(0.22, 0.14, 0.1), "okafor": Color(0.08, 0.07, 0.07), "fen": Color(0.78, 0.6, 0.35),
	"tull": Color(0.45, 0.42, 0.4), "isa": Color(0.12, 0.09, 0.08), "renn": Color(0.55, 0.25, 0.12),
	"vex": Color(0.75, 0.75, 0.78), "pilot": Color(0.25, 0.17, 0.11), "hale": Color(0.5, 0.48, 0.46), "warden": Color(0.1, 0.08, 0.07)}

static func make(name: String) -> Person:
	var p := Person.new()
	p.who = name
	return p

func _ready() -> void:
	# The body turns to face within _process (see below); only the local
	# transform is excluded, so the interpolation of the walking parent
	# underneath still moves the figure smoothly.
	physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	# Desktop gets the subdivided body; the browser the plain one.
	var hd := "res://art/person-%s_hd.glb" % who
	var path := hd if Flow.high_quality() and ResourceLoader.exists(hd) and not "--nohd" in OS.get_cmdline_user_args() else "res://art/person-%s.glb" % who
	if QUAT.has(who) and ResourceLoader.exists("res://art/people/q-%s.gltf" % QUAT[who][0]):
		path = "res://art/people/q-%s.gltf" % QUAT[who][0]
		_quat = true
	var body: Node3D = load(path).instantiate()
	add_child(body)
	if solid:
		var sb := AnimatableBody3D.new()
		sb.sync_to_physics = false
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = 0.3
		cap.height = 1.7
		cs.shape = cap
		cs.position.y = 0.85
		sb.add_child(cs)
		add_child(sb)
	if _quat:
		_suit(body)
	else:
		_dress(body)
	# The small parts of a face (eyes, lashes, brows, teeth, tongue) are each
	# their own draw, and a pixel or two past 25 m: drawn only near.
	for mi: MeshInstance3D in body.find_children("*", "MeshInstance3D", true, false):
		var part := String(mi.name).to_lower()
		for small in ["eye", "lash", "brow", "teeth", "tongue", "poly"]:
			if part.contains(small):
				mi.visibility_range_end = 25.0
				mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				break
	for mi: MeshInstance3D in body.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh and mi.find_blend_shape_by_name("blink_l") >= 0:
			var idx := PackedInt32Array()
			for s in SHAPES:
				idx.append(mi.find_blend_shape_by_name(s))
			_faces.append([mi, idx])
	_blink_in = randf_range(0.5, 3.0)
	var players := body.find_children("*", "AnimationPlayer", true, false)
	if players.size() > 0:
		_anim = players[0]
		for a in ["idle", "talk", "walk", "run", "sprint", "crouch", "crouch_walk", "sit", "sit_talk", "climb", "swim", "swim_idle", "work", "dance"]:
			if _anim.has_animation(a):
				_anim.get_animation(a).loop_mode = Animation.LOOP_LINEAR
		_anim.play("idle")
		_anim.seek(randf() * 3.0)
	# Nods, tilts, shrugs and breath on top of the animation (LifeMotion).
	var sks := body.find_children("*", "Skeleton3D", true, false)
	if sks.size() > 0:
		var life := LifeMotion.new()
		life.active = not "--nolife" in OS.get_cmdline_user_args()
		life.person = self
		sks[0].add_child(life)

## MakeHuman exports every material as layered transparency, which is
## slow, sorts badly and rules out subsurface scattering. Each part gets
## the material it should have: skin, opaque cloth, cut-out hair, wet eyes.
func _dress(body: Node3D) -> void:
	var skin_shader: Shader = load("res://shaders/skin.gdshader")
	for mi: MeshInstance3D in body.find_children("*", "MeshInstance3D", true, false):
		var part := String(mi.name).to_lower()
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i) as StandardMaterial3D
			if not src:
				continue
			if part == "human":
				var skin := ShaderMaterial.new()
				skin.shader = skin_shader
				skin.set_shader_parameter("albedo_tex", src.albedo_texture)
				mi.set_surface_override_material(i, skin)
				continue
			# The eye is two layers, a clear cornea over the iris: keep it as made.
			if part.contains("high-poly") or part.contains("low-poly"):
				continue
			var m := src.duplicate() as StandardMaterial3D
			m.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
			m.cull_mode = BaseMaterial3D.CULL_BACK
			if part.contains("teeth"):
				# Teeth and gums sit in the mouth's shadow: dimmed, so they
				# read as a mouth and not as a grin of bright points.
				m.albedo_color = Color(0.5, 0.47, 0.44)
				m.roughness = 0.4
				m.metallic_specular = 0.3
			elif part.contains("eyebrow") or part.contains("eyelash") or _is_hair(part):
				m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				m.alpha_scissor_threshold = 0.35
				m.alpha_antialiasing_mode = BaseMaterial3D.ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE
				m.cull_mode = BaseMaterial3D.CULL_DISABLED
				if _is_hair(part):
					m.roughness = 0.42
					m.metallic_specular = 0.55
					m.anisotropy_enabled = true
					m.anisotropy = 0.6
			else:
				m.roughness = maxf(m.roughness, 0.7)
				if part.contains("worksuit"):
					m.albedo_color = suit_tint
			mi.set_surface_override_material(i, m)

## Quaternius's people: their own materials (the outfit's scanned cloth and
## leather, a little of each person's colour over it), the hair tinted and
## cut out.
func _suit(body: Node3D) -> void:
	var colour: Color = QUAT[who][1]
	for mi: MeshInstance3D in body.find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		for i in mi.mesh.get_surface_count():
			var src := mi.mesh.surface_get_material(i) as StandardMaterial3D
			if not src:
				continue
			var n := String(src.resource_name).to_lower()
			if n.contains("hair") or n.contains("brow") or n.contains("beard"):
				var h := src.duplicate() as StandardMaterial3D
				h.albedo_color = HAIR.get(QUAT[who][0], Color(0.2, 0.15, 0.1)) * 2.2
				h.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
				h.alpha_scissor_threshold = 0.4
				h.cull_mode = BaseMaterial3D.CULL_DISABLED
				h.roughness = 0.55
				mi.set_surface_override_material(i, h)
			elif n.contains("peasant") or n.contains("ranger"):
				var o := src.duplicate() as StandardMaterial3D
				o.albedo_color = Color(1, 1, 1).lerp(colour * 1.6, 0.3)
				mi.set_surface_override_material(i, o)

static func _is_hair(part: String) -> bool:
	for h in ["short0", "ponytail", "braid", "bob0", "long0", "afro"]:
		if part.contains(h):
			return true
	return false

## Start or stop talking (the talk loop: head and a hand).
func talk(on: bool) -> void:
	_talking = on
	# The talk and idle loops replace the gait: forget it, so the next
	# locomote plays the walk or run again instead of standing still.
	_gait = ""
	if _anim:
		_anim.play("talk" if on else "idle", 0.4)

## Hand over hand up a ladder (the walking people have the clip), or stop.
func climb(on: bool) -> void:
	if not _anim or not _anim.has_animation("climb"):
		return
	_gait = "climb" if on else "idle"
	_anim.speed_scale = 1.0
	_anim.play("climb" if on else "idle", 0.25)

## Walking pace in metres a second: idle, walk or run, the cycle's speed
## matched to the ground covered (see _animate_speed).
func locomote(speed: float, crouched := false, airborne := false, seated := false) -> void:
	if not _anim or _talking:
		return
	var gait := "idle" if speed < 0.25 else ("walk" if speed < 3.0 else "run")
	if crouched:
		gait = "crouch" if speed < 0.2 else "crouch_walk"
	if airborne:
		gait = "jump"
	if seated:
		gait = "sit"
	if gait != _gait and _anim.has_animation(gait):
		# Changing pace keeps the stride: walk, run and crouch-walk are the
		# same body cycle, so carry the phase across proportionally and the
		# legs do not snap back to the start of the new animation.
		if _gait in STRIDES and gait in STRIDES:
			var from := _anim.get_animation(_gait).length
			var to := _anim.get_animation(gait).length
			if from > 0.0 and to > 0.0:
				var phase := _anim.current_animation_position / from
				_anim.play(gait, 0.25)
				_anim.seek(phase * to, true)
				_gait = gait
				_animate_speed(gait, speed)
				return
		_gait = gait
		_anim.play(gait, 0.25)
	_animate_speed(gait, speed)

## Pace the gait to the speed covered, so a planted foot stays planted:
## each stride clip covers the ground speed measured from its own feet when
## it was baked (art/godot/people.py writes art/person-gait.json).
static var _gaits := {}

func _natural(gait: String) -> float:
	if _gaits.is_empty():
		var f := FileAccess.open("res://art/person-gait.json", FileAccess.READ)
		var d = JSON.parse_string(f.get_as_text()) if f else null
		_gaits = d if d is Dictionary else {"_": {}}
	var mine: Dictionary = _gaits.get(who, _gaits.get("pilot", {}))
	return float(mine.get(gait, {"walk": 1.45, "run": 3.9, "crouch_walk": 0.66}.get(gait, 1.0)))

func _animate_speed(gait: String, speed: float) -> void:
	if gait in STRIDES:
		_anim.speed_scale = clampf(speed / _natural(gait), 0.5, 1.8)
	else:
		_anim.speed_scale = 1.0

## Follow a point with the head (Vector3.INF: look ahead again).
func look(point: Vector3) -> void:
	look_at_point = point

## A wave, a stretch, a scratch of the head, hands out to a fire, a hand
## shading the eyes, a shrug (LifeMotion). Ignored while one is under way.
const GESTURES := {"wave": 2.4, "stretch": 3.2, "scratch": 2.6, "warm": 7.0, "shade": 4.5, "shrug": 1.8}
func gesture(name: String) -> bool:
	if gesture_name != "" or not GESTURES.has(name):
		return false
	gesture_name = name
	gesture_t = 0.0
	gesture_len = GESTURES[name]
	return true

## Turn the whole body to face a point, over a second or so.
func face(point: Vector3) -> void:
	var parent := get_parent_node_3d()
	var d := (parent.to_local(point) if parent else point) - position
	_yaw_target = atan2(d.x, d.z)

## The moving parent supplies the route heading; undo a conversation turn
## before walking or sitting so the figure does not travel sideways.
func follow_route() -> void:
	_yaw_target = 0.0

## Far from the camera a person is animated less often (ten times a
## second past 30 m, not at all past 120 m) and their face not at all:
## skinning a body is the costliest thing a browser does for one.
var _lod_t := 0.0
var _far := false
var _gone := false
var _anim_acc := 0.0

func _process(dt: float) -> void:
	if gesture_name != "":
		gesture_t += dt
		if gesture_t >= gesture_len:
			gesture_name = ""
	if not is_nan(_yaw_target):
		rotation.y = lerp_angle(rotation.y, _yaw_target, minf(1.0, dt * 3.0))
	_lod_t -= dt
	if _lod_t <= 0.0:
		_lod_t = 0.3 + randf() * 0.1
		var cam := get_viewport().get_camera_3d()
		var d := cam.global_position.distance_to(global_position) if cam else 0.0
		_far = d > 30.0
		_gone = d > 120.0 or not is_visible_in_tree()
		if _anim:
			_anim.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL if _far else AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_IDLE
	if _far:
		if _anim and not _gone:
			_anim_acc += dt
			if _anim_acc >= 0.1:
				_anim.advance(_anim_acc)
				_anim_acc = 0.0
		return
	_t += dt
	# Blinks: every two to five seconds, about a sixth of a second each.
	_blink_in -= dt
	if _blink_in <= 0.0:
		_blink_in = randf_range(2.0, 5.0) if randf() > 0.15 else 0.25
		_blink = 0.16
	var lid := 0.0
	if _blink > 0.0:
		_blink -= dt
		lid = sin(clampf(1.0 - _blink / 0.16, 0.0, 1.0) * PI)
	# Talking: syllables at a speaking rate, uneven, pausing now and then.
	var want := 0.0
	if _talking:
		var syl := 0.5 + 0.5 * sin(_t * 13.0 + sin(_t * 3.1) * 2.5)
		var phrase := smoothstep(-0.6, 0.2, sin(_t * 1.7) + sin(_t * 0.63))
		want = 0.04 + 0.24 * syl * phrase
	_mouth = lerpf(_mouth, want, minf(1.0, dt * 18.0))
	if has_meta("hold_mouth"):
		_mouth = float(get_meta("hold_mouth"))
		lid = 0.0
	_brow = lerpf(_brow, 0.35 if _talking and sin(_t * 0.9) > 0.7 else 0.0, minf(1.0, dt * 4.0))
	# Same order as SHAPES. The open-mouth shape pulls the corners down;
	# the smile value lifts them back level.
	_vals[0] = lid
	_vals[1] = lid
	_vals[2] = _mouth
	_vals[3] = _mouth * 0.25 * (0.5 + 0.5 * sin(_t * 7.0))
	_vals[4] = _mouth * 0.45
	_vals[5] = _brow
	_vals[6] = _brow
	# Idle faces have mostly unchanged weights. Rewriting zero weights still
	# dirties the mesh's morph data; submit only expressions that changed.
	for k in SHAPES.size():
		if _applied[k] == _vals[k]:
			continue
		_applied[k] = _vals[k]
		for f in _faces:
			var mi: MeshInstance3D = f[0]
			var idx: PackedInt32Array = f[1]
			if idx[k] >= 0:
				mi.set_blend_shape_value(idx[k], _vals[k])
