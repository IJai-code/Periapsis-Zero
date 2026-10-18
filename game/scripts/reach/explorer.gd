class_name Explorer
extends CharacterBody3D
## The player on foot, in first person. Gravity pulls toward the body whose
## sphere you are in, and you stand up along it, so you can walk all the way
## round a small world. Space jumps; held in the air it fires the jetpack;
## in free fall (no body near enough to pull) the jetpack moves you any way
## (WASD, Space up, Shift down, Q/E roll) and the mouse turns you freely.
##
## The suit: oxygen (refills in breathable air and in the ship), jetpack
## fuel (refills in the ship and slowly on the ground), health (a hard
## landing hurts). Running out of oxygen, or a landing too hard, kills.
## F: the flashlight. E: use what you look at (Usable, collision layer 4).
##
## Water: wading slows you; deeper, you swim (the suit floats you with your
## head just out; W/A/S/D swim, Space up, Shift dives), with a splash going
## in and rings spreading where you move. Under it, the world goes green-blue
## and muffled (Reach._air, ReachHud.underwater) and bubbles go up.

signal died(cause: String)
signal used_thing(what: Usable)

const WALK := 4.6
const RUN := 7.0
## A jump: a tap is small; held while crouching (to CHARGE seconds), big.
const JUMP := 3.6
const JUMP_MAX := 7.4
const CHARGE := 0.75
const JET := 11.0
const JET_SIDE := 6.5
const JET_FREE := 4.5
const OXY_MAX := 240.0
const FUEL_MAX := 100.0
const HURT_FROM := 10.0
const KILL_AT := 22.0

var system: ReachSystem
var head: Node3D
var camera: Camera3D
var flashlight: SpotLight3D
var enabled := true
var oxygen := OXY_MAX
var fuel := FUEL_MAX
var health := 100.0
## Breathable air round the suit now (set each tick).
var breathing := true
var free_fall := false
var focus: Usable
var _pitch := 0.0
var _was_floor := false
var _last_vel := Vector3.ZERO
var _step := 0.0
var _jet_t := 0.0
var _hurt_t := 0.0
var _dead := false
var _ladder: Node3D
var _jet_sound: AudioStreamPlayer
## The jump being charged (seconds held, -1 not crouching); whether Space
## has been let go since leaving the ground (a second press is the jetpack).
var _charge := -1.0
var _space_free := true
## The view's own movement: crouch, a dip on landing, a bob with the steps.
var _crouch := 0.0
var _dip := 0.0
var _dip_v := 0.0
var _bob := 0.0
## What E would use is looked for a dozen times a second, with one query
## object reused, rather than sixty times a second with a new one each time.
var _look_t := 0.0
var _q: PhysicsRayQueryParameters3D
## Grit at the boots, a ring of puffs on a landing or the first burn.
var _dust: CPUParticles3D
var _jet_was := false
## How deep the water is at the feet (negative: dry), and whether the eyes
## are under it.
var wet := -1.0
var underwater := false
var _was_wet := -1.0
var _ripple_t := 0.0
var _stroke_t := 0.0
var _bubble_t := 0.0

func wants_mouse() -> bool:
	return enabled and not _dead

func _ready() -> void:
	add_to_group("reach_dynamic")
	add_to_group("mouse_look")
	add_to_group("player")
	motion_mode = CharacterBody3D.MOTION_MODE_GROUNDED
	floor_max_angle = deg_to_rad(52.0)
	floor_snap_length = 0.45
	floor_stop_on_slope = true
	collision_mask = 1
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.34
	cap.height = 1.8
	cs.shape = cap
	cs.position.y = 0.9
	add_child(cs)
	head = Node3D.new()
	head.top_level = true
	head.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(head)
	camera = Camera3D.new()
	camera.fov = 74.0
	camera.near = 0.05
	camera.far = 60000.0
	head.add_child(camera)
	flashlight = SpotLight3D.new()
	flashlight.spot_range = 38.0
	flashlight.spot_angle = 30.0
	flashlight.light_energy = 3.0
	flashlight.light_color = Color(1.0, 0.95, 0.85)
	flashlight.shadow_enabled = Flow.high_quality()
	flashlight.visible = false
	flashlight.position = Vector3(0.18, -0.15, 0.0)
	camera.add_child(flashlight)
	_jet_sound = AudioStreamPlayer.new()
	_jet_sound.stream = _jet_stream()
	_jet_sound.volume_db = -80.0
	add_child(_jet_sound)
	_jet_sound.play()

func _unhandled_input(e: InputEvent) -> void:
	if not enabled or _dead:
		return
	if e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s := 0.0022 * float(Flow.settings.mouse)
		var dx: float = e.relative.x * s
		var dy: float = e.relative.y * s * (-1.0 if Flow.settings.invert else 1.0)
		global_basis = Basis(global_basis.y, -dx) * global_basis
		if free_fall:
			global_basis = Basis(global_basis.x, -dy) * global_basis
		else:
			_pitch = clampf(_pitch - dy, -1.5, 1.5)
		global_basis = global_basis.orthonormalized()
	elif e is InputEventKey and e.pressed and not e.echo:
		match (e as InputEventKey).keycode:
			KEY_E:
				if focus:
					Sfx.play("click", -8.0)
					focus.use(self)
					used_thing.emit(focus)
			KEY_F:
				flashlight.visible = not flashlight.visible
				Sfx.play("click", -12.0, 1.4)

func _physics_process(dt: float) -> void:
	if _dead or not system:
		return
	var g := system.gravity(global_position)
	var gl := g.length()
	free_fall = gl < 0.35 and not is_on_floor()
	if not free_fall and gl > 0.001:
		_align(-g / gl, dt)
	up_direction = global_basis.y
	var b := global_basis
	var right := b.x
	var up := b.y
	var fwd := -b.z
	var mv := Input.get_vector("left", "right", "forward", "back") if enabled else Vector2.ZERO
	var jet_on := false
	var space := enabled and Input.is_key_pressed(KEY_SPACE)
	var shift := enabled and Input.is_key_pressed(KEY_SHIFT)
	if _ladder and is_instance_valid(_ladder):
		# On a ladder: forward and back climb it.
		var lup: Vector3 = _ladder.global_basis.y
		velocity = lup * (-mv.y) * 2.4 + right * mv.x * 1.2
		if space:
			velocity += up * 3.0 - fwd * 2.0
			_ladder = null
	elif _water(g, gl, mv, space, shift, dt):
		pass
	elif free_fall:
		var t := right * mv.x + fwd * (-mv.y) + up * (float(space) - float(shift))
		if t.length() > 0.01 and fuel > 0.0:
			velocity += t.normalized() * JET_FREE * dt
			fuel = maxf(0.0, fuel - 3.0 * dt)
			jet_on = true
		var roll := float(Input.is_key_pressed(KEY_Q)) - float(Input.is_key_pressed(KEY_E))
		if enabled and roll != 0.0:
			global_basis = Basis(fwd, roll * 1.4 * dt) * global_basis
		velocity += g * dt
	else:
		var vert := up * velocity.dot(up)
		var horiz := velocity - vert
		var wish := right * mv.x + fwd * (-mv.y)
		if wish.length() > 1.0:
			wish = wish.normalized()
		if is_on_floor():
			var target := wish * (RUN if shift and _charge < 0.0 else WALK)
			# Wading: the water drags at the legs.
			if wet > 0.0:
				target *= lerpf(1.0, 0.5, clampf(wet / 0.9, 0.0, 1.0))
			if _charge >= 0.0:
				target *= 0.45
			horiz = horiz.move_toward(target, (30.0 if wish.length() > 0.1 else 24.0) * dt)
			# Space down: crouch and charge; let go: jump.
			if space and _jet_t <= 0.0:
				_charge = minf((_charge if _charge >= 0.0 else 0.0) + dt, CHARGE)
			elif _charge >= 0.0:
				var k := clampf(_charge / CHARGE, 0.0, 1.0)
				vert = up * lerpf(JUMP, JUMP_MAX, k * k * (3.0 - 2.0 * k))
				_charge = -1.0
				_jet_t = 0.25
				_space_free = false
				Sfx.play("step", -12.0, 0.7)
			_space_free = not space
		else:
			_charge = -1.0
			if not space:
				_space_free = true
			# The jetpack: Space up (pressed again after the jump), Shift
			# down, the move keys sideways; all on the suit's fuel.
			var thrust := wish * JET_SIDE
			if space and _space_free and _jet_t <= 0.0:
				thrust += up * JET
			if shift:
				thrust -= up * JET * 0.7
			if thrust.length() > 0.01 and fuel > 0.0:
				vert += up * thrust.dot(up) * dt
				horiz += (thrust - up * thrust.dot(up)) * dt
				fuel = maxf(0.0, fuel - (3.0 + thrust.length() * 0.45) * dt)
				jet_on = true
		_jet_t -= dt
		velocity = horiz + vert + g * dt
	_last_vel = velocity
	move_and_slide()
	_landing()
	_suit(dt)
	_sounds(dt, jet_on)
	_was_floor = is_on_floor()
	# The pack lighting throws grit off whatever is underfoot.
	if jet_on and not _jet_was:
		_boot_dust(0.5)
	_jet_was = jet_on
	_look_t -= dt
	if _look_t <= 0.0:
		_look_t = 0.083
		_look()

## How deep the water is here, and swimming when it is deep enough: true if
## this tick was spent swimming.
func _water(g: Vector3, gl: float, mv: Vector2, space: bool, shift: bool, dt: float) -> bool:
	var b := system.ruling()
	wet = -1.0
	underwater = false
	if b.sea == 0.0 or b.key == "lantern" or gl < 0.35:
		_splash_check()
		return false
	var c := b.node.global_position
	var up := global_basis.y
	var level := b.radius + b.sea
	wet = level - (global_position - c).length()
	underwater = (camera.global_position - c).length() < level - 0.05
	_splash_check()
	# Deep enough to float: chest under.
	var depth := level - (global_position + up * 1.2 - c).length()
	if depth < -0.1 and is_on_floor():
		return false
	if wet < 1.0:
		return false
	var right := global_basis.x
	var fwd := -global_basis.z
	# The suit floats: pushed up toward chest-deep, slowed by the water.
	# (Diving, the suit's float is let out.)
	var buoy := clampf(depth * 7.0, -3.0, 9.0) * (0.15 if shift else 1.0)
	velocity -= g * dt
	velocity += up * (buoy - gl * 0.35) * dt
	var look := -camera.global_basis.z
	var wish := right * mv.x + (look if underwater else fwd) * (-mv.y)
	if wish.length() > 1.0:
		wish = wish.normalized()
	wish += up * ((1.0 if space else 0.0) - (1.0 if shift else 0.0)) * 0.9
	velocity += wish * 9.0 * dt
	velocity *= exp(-2.6 * dt)
	velocity = velocity.limit_length(4.2)
	_charge = -1.0
	_jet_t = 0.0
	# A stroke's sound now and then, rings where you move on the surface,
	# bubbles under it.
	var moving := mv.length() > 0.1 or space or shift
	_stroke_t -= dt
	if moving and _stroke_t <= 0.0:
		_stroke_t = 0.75
		Sfx.play("swim", -12.0 if not underwater else -18.0, randf_range(0.85, 1.1))
	_ripple_t -= dt
	if not underwater and _ripple_t <= 0.0:
		_ripple_t = 0.55 if moving else 1.6
		_ripple(c + (global_position + up * 1.2 - c).normalized() * (level + 0.04), 0.7 if moving else 0.4)
	_bubble_t -= dt
	if underwater and _bubble_t <= 0.0:
		_bubble_t = randf_range(0.6, 1.4)
		Sfx.play("bubble", -16.0, randf_range(0.8, 1.3))
	return true

## Going in fast enough: a splash where the water was broken.
func _splash_check() -> void:
	if wet > 0.05 and _was_wet <= 0.05:
		var into := -_last_vel.dot(global_basis.y)
		if into > 1.5:
			Sfx.play("splash", clampf(-14.0 + into * 1.2, -14.0, -2.0), randf_range(0.9, 1.1))
			var b := system.ruling()
			var c := b.node.global_position
			var surf := c + (global_position - c).normalized() * (b.radius + b.sea + 0.05)
			LaunchFx.splash(get_parent(), surf, (surf - c).normalized(), clampf(into / 6.0, 0.4, 1.5))
			_ripple(surf, 1.3)
	_was_wet = wet

## A ring spreading on the water's surface and fading.
func _ripple(at: Vector3, size: float) -> void:
	var mi := MeshInstance3D.new()
	var q := PlaneMesh.new()
	q.size = Vector2(1.0, 1.0)
	mi.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_texture = _ring()
	m.albedo_color = Color(0.86, 0.93, 1.0, 0.6)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	get_parent().add_child(mi)
	var up := (at - system.ruling().node.global_position).normalized()
	mi.global_transform = Transform3D(Site.upright(up, global_basis.x), at)
	mi.scale = Vector3.ONE * size
	var t := mi.create_tween()
	t.set_parallel(true)
	t.tween_property(mi, "scale", Vector3.ONE * size * 4.5, 1.8).set_ease(Tween.EASE_OUT)
	t.tween_property(m, "albedo_color:a", 0.0, 1.8)
	t.chain().tween_callback(mi.queue_free)

static var _ring_tex: Texture2D

## A thin bright ring with a fainter one inside it, made once.
static func _ring() -> Texture2D:
	if _ring_tex:
		return _ring_tex
	var n := 64
	var img := Image.create(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var r := Vector2(x - n * 0.5 + 0.5, y - n * 0.5 + 0.5).length() / (n * 0.5)
			var a := clampf(1.0 - absf(r - 0.85) / 0.07, 0.0, 1.0) + clampf(1.0 - absf(r - 0.62) / 0.05, 0.0, 1.0) * 0.45
			img.set_pixel(x, y, Color(1, 1, 1, clampf(a, 0.0, 1.0)))
	img.generate_mipmaps()
	_ring_tex = ImageTexture.create_from_image(img)
	return _ring_tex

## Turn so that up is `want`, smoothly (fast enough for a walk round a moon).
func _align(want: Vector3, dt: float) -> void:
	var cur := global_basis.y
	var ang := cur.angle_to(want)
	if ang < 0.0005:
		return
	var axis := cur.cross(want)
	if axis.length() < 0.0001:
		axis = global_basis.x
	global_basis = Basis(axis.normalized(), minf(ang, maxf(3.0, ang * 6.0) * dt)) * global_basis
	global_basis = global_basis.orthonormalized()

## Landing or striking something hard: hurt by the speed into it.
func _landing() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var into := -_last_vel.dot(c.get_normal())
		if into > HURT_FROM and _hurt_t <= 0.0:
			_hurt_t = 0.4
			if into >= KILL_AT:
				die("impact")
				return
			health -= (into - HURT_FROM) * 9.0
			Sfx.play("hit", -4.0, 0.7)
			if health <= 0.0:
				die("impact")
				return
	if is_on_floor() and not _was_floor:
		Sfx.play("step", -10.0, 0.8)
		# The view dips with the landing, harder the faster; a hard one
		# throws dust off the ground too.
		var fall := clampf(-_last_vel.dot(up_direction), 0.0, 14.0)
		_dip_v -= fall * 0.55
		if fall > 3.0:
			_boot_dust(clampf(fall / 12.0, 0.25, 1.0))

func _suit(dt: float) -> void:
	_hurt_t -= dt
	var b := system.ruling()
	breathing = b.air and global_position.distance_to(b.node.position) < b.atmo
	if breathing:
		oxygen = minf(OXY_MAX, oxygen + 60.0 * dt)
		if is_on_floor():
			fuel = minf(FUEL_MAX, fuel + 4.0 * dt)
	else:
		oxygen -= dt
		if oxygen <= 0.0:
			die("suffocation")
	health = minf(100.0, health + 1.5 * dt)

func _sounds(dt: float, jet_on: bool) -> void:
	_jet_sound.volume_db = lerpf(_jet_sound.volume_db, -16.0 if jet_on else -80.0, minf(1.0, dt * 10.0))
	if is_on_floor():
		var speed := (velocity - up_direction * velocity.dot(up_direction)).length()
		_step += speed * dt
		if _step > (0.8 if speed < 4.5 else 1.15):
			_step = 0.0
			Sfx.play("step", -18.0 if speed < 4.5 else -14.0, randf_range(0.85, 1.1))

## Grit at the boots: a low ring of puffs, thrown out and settling. The
## dust stays where it was thrown rather than following the suit.
func _boot_dust(k: float) -> void:
	if _dust == null:
		_dust = CPUParticles3D.new()
		_dust.top_level = true
		var q := QuadMesh.new()
		q.size = Vector2(0.3, 0.3)
		q.material = LaunchFx.dust_material()
		_dust.mesh = q
		_dust.emitting = false
		_dust.one_shot = true
		_dust.amount = 12
		_dust.lifetime = 1.0
		_dust.explosiveness = 0.95
		_dust.local_coords = false
		_dust.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
		_dust.emission_ring_axis = Vector3.UP
		_dust.emission_ring_radius = 0.34
		_dust.emission_ring_inner_radius = 0.12
		_dust.emission_ring_height = 0.04
		_dust.direction = Vector3.UP
		_dust.spread = 80.0
		_dust.initial_velocity_min = 0.7
		_dust.initial_velocity_max = 2.2
		_dust.damping_min = 1.6
		_dust.damping_max = 3.2
		_dust.gravity = Vector3(0, -0.9, 0)
		_dust.scale_amount_min = 0.45
		_dust.scale_amount_max = 1.3
		_dust.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var c := Curve.new()
		c.add_point(Vector2(0.0, 0.3))
		c.add_point(Vector2(0.25, 1.0))
		c.add_point(Vector2(1.0, 1.9))
		_dust.scale_amount_curve = c
		var g := Gradient.new()
		g.offsets = PackedFloat32Array([0.0, 0.18, 0.6, 1.0])
		g.colors = PackedColorArray([Color(0.6, 0.54, 0.45, 0.0), Color(0.6, 0.54, 0.45, 0.52),
			Color(0.52, 0.47, 0.4, 0.28), Color(0.45, 0.41, 0.36, 0.0)])
		_dust.color_ramp = g
		add_child(_dust)
	var up := global_basis.y
	_dust.global_transform = Transform3D(global_basis, global_position + up * 0.1)
	_dust.gravity = -up * 0.9
	_dust.scale = Vector3.ONE * lerpf(0.7, 1.4, clampf(k, 0.0, 1.0))
	_dust.restart()

## What is looked at, within reach.
func _look() -> void:
	var space := get_world_3d().direct_space_state
	var from := camera.global_position
	if _q == null:
		_q = PhysicsRayQueryParameters3D.new()
		_q.collision_mask = 8
		_q.collide_with_areas = true
		_q.collide_with_bodies = false
	_q.from = from
	_q.to = from - camera.global_basis.z * 3.4
	var hit := space.intersect_ray(_q)
	var u: Usable = null
	if not hit.is_empty() and hit.collider is Usable:
		var cand := hit.collider as Usable
		if cand.prompt != "" and from.distance_to(hit.position) <= cand.reach:
			u = cand
	focus = u

func _process(dt: float) -> void:
	# The head follows the body's drawn position, turned by the body's own
	# (not interpolated) facing, so the mouse answers at once.
	var at := get_global_transform_interpolated().origin
	var b := global_basis
	# Crouched while a jump charges; a sprung dip on landing; a small bob.
	_crouch = move_toward(_crouch, 0.42 if _charge >= 0.0 else 0.0, dt * (1.6 if _charge >= 0.0 else 4.0))
	_dip_v += (-_dip * 60.0 - _dip_v * 11.0) * dt
	_dip = clampf(_dip + _dip_v * dt, -0.5, 0.2)
	var speed := (velocity - up_direction * velocity.dot(up_direction)).length() if is_on_floor() else 0.0
	_bob += dt * speed * 1.9
	var bob := sin(_bob * 2.0) * 0.022 * clampf(speed / WALK, 0.0, 1.4)
	head.global_transform = Transform3D(b * Basis(Vector3.RIGHT, _pitch), at + b.y * (1.62 - _crouch + _dip + bob))

## The world's frame moved (Reach): move with it.
func frame_shift(dp: Vector3, dv: Vector3) -> void:
	global_position += dp
	velocity += dv
	_last_vel += dv
	reset_physics_interpolation()

## Hurt by something (a drone's shot): dies of `cause` at nothing left.
func hurt(amount: float, cause: String) -> void:
	if _dead:
		return
	health -= amount
	Sfx.play("hit", -6.0, 0.9)
	if health <= 0.0:
		die(cause)

func set_ladder(l: Node3D) -> void:
	_ladder = l

func die(cause: String) -> void:
	if _dead:
		return
	_dead = true
	enabled = false
	died.emit(cause)

## Stand somewhere new (waking, leaving the ship): place, face, reset.
func place(xf: Transform3D, look_dir := Vector3.ZERO) -> void:
	global_transform = xf
	if look_dir.length() > 0.01:
		var up := xf.basis.y
		var f := (look_dir - up * look_dir.dot(up)).normalized()
		global_basis = Basis(f.cross(up).normalized(), up, -f).orthonormalized()
	velocity = Vector3.ZERO
	_pitch = 0.0
	_dead = false
	enabled = true
	oxygen = OXY_MAX
	fuel = FUEL_MAX
	health = 100.0
	reset_physics_interpolation()

func set_pitch(p: float) -> void:
	_pitch = p

## The jetpack's hiss: filtered noise, looping.
static func _jet_stream() -> AudioStreamWAV:
	var rate := 22050
	var n := rate * 2
	var data := PackedByteArray()
	data.resize(n * 2)
	var lp := 0.0
	for i in n:
		lp += (randf() * 2.0 - 1.0 - lp) * 0.18
		data.encode_s16(i * 2, int(clampf(lp * 2.2, -1.0, 1.0) * 26000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.data = data
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_end = n
	return s
