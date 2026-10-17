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

signal died(cause: String)
signal used_thing(what: Usable)

const WALK := 3.4
const RUN := 6.2
const JUMP := 4.4
const JET := 11.0
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
			var target := wish * (RUN if shift else WALK)
			horiz = horiz.move_toward(target, (28.0 if wish.length() > 0.1 else 22.0) * dt)
			if space and _jet_t <= 0.0:
				vert = up * JUMP
				_jet_t = 0.35
		else:
			horiz += wish * 3.0 * dt
			# Held after the jump's first moment: the jetpack.
			if space and _jet_t <= 0.0 and fuel > 0.0:
				vert += up * JET * dt
				fuel = maxf(0.0, fuel - 7.0 * dt)
				jet_on = true
		_jet_t -= dt
		velocity = horiz + vert + g * dt
	_last_vel = velocity
	move_and_slide()
	_landing()
	_suit(dt)
	_sounds(dt, jet_on)
	_was_floor = is_on_floor()
	_look()

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

## What is looked at, within reach.
func _look() -> void:
	var space := get_world_3d().direct_space_state
	var from := camera.global_position
	var q := PhysicsRayQueryParameters3D.create(from, from - camera.global_basis.z * 3.4, 8)
	q.collide_with_areas = true
	q.collide_with_bodies = false
	var hit := space.intersect_ray(q)
	var u: Usable = null
	if not hit.is_empty() and hit.collider is Usable:
		var cand := hit.collider as Usable
		if cand.prompt != "" and from.distance_to(hit.position) <= cand.reach:
			u = cand
	focus = u

func _process(_dt: float) -> void:
	# The head follows the body's drawn position, turned by the body's own
	# (not interpolated) facing, so the mouse answers at once.
	var at := get_global_transform_interpolated().origin
	var b := global_basis
	head.global_transform = Transform3D(b * Basis(Vector3.RIGHT, _pitch), at + b.y * 1.62)

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
