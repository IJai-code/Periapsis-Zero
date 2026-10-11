class_name Player
extends CharacterBody3D
## The pilot in third person: the camera over the right shoulder, steered
## with the mouse; WASD moves relative to it and the body turns to the way
## it goes, walking or (Shift) running. The camera pulls in when a wall is
## behind. Interactables are what the camera centres on, within reach.
## Same surface as Walker (enabled, camera, face, used) so scenes can swap.

signal used(target: Node)

const WALK := 1.7
const RUN := 4.4
const CROUCH := 1.0
const JUMP := 3.3
const ARM := 2.4
const SHOULDER := Vector3(0.38, 1.66, 0.0)

var enabled := true
var camera: Camera3D
var body: Person
var _yaw := 0.0
var _pitch := -0.16
var _pivot: Node3D
var _arm: SpringArm3D
var _focus: Node = null
var _step := 0.0
var crouched := false
var seated := false
var _seat: Node3D = null
var _cap: CapsuleShape3D
var _shape: CollisionShape3D
var _shoulder_y := 1.66
var _ground_y := 0.0
var _auto := ""

func _ready() -> void:
	add_to_group("player")
	_shape = CollisionShape3D.new()
	_cap = CapsuleShape3D.new()
	_cap.radius = 0.3
	_cap.height = 1.75
	_shape.shape = _cap
	_shape.position.y = 0.875
	add_child(_shape)
	body = Person.make("pilot")
	body.suit_tint = Color(0.42, 0.45, 0.36)
	add_child(body)
	_pivot = Node3D.new()
	_pivot.top_level = true
	add_child(_pivot)
	_arm = SpringArm3D.new()
	_arm.spring_length = ARM
	_arm.margin = 0.15
	var probe := SphereShape3D.new()
	probe.radius = 0.18
	_arm.shape = probe
	_arm.add_excluded_object(get_rid())
	_pivot.add_child(_arm)
	camera = Camera3D.new()
	camera.fov = 62.0
	camera.near = 0.05
	camera.far = 120_000.0
	_arm.add_child(camera)
	var args := OS.get_cmdline_user_args()
	_auto = "run" if "--autorun" in args else ("walk" if "--autowalk" in args else "")
	# Render checks for the other movements.
	if "--crouch" in args:
		_set_crouch.call_deferred(true)
	if "--jump" in args:
		get_tree().create_timer(2.0).timeout.connect(func(): velocity.y = JUMP)
	_yaw = rotation.y
	rotation = Vector3.ZERO
	_ground_y = global_position.y
	# MakeHuman figures face +Z in Godot; the camera looks down -Z.
	body.rotation.y = _yaw + PI

func _unhandled_input(e: InputEvent) -> void:
	if not enabled:
		return
	if e is InputEventMouseButton and e.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s := 0.0022 * float(Flow.settings.mouse)
		_yaw -= e.relative.x * s
		_pitch -= e.relative.y * s * (-1.0 if Flow.settings.invert else 1.0)
		_pitch = clampf(_pitch, -1.1, 0.7)
	elif e.is_action_pressed("crouch") and not seated:
		_set_crouch(not crouched)
	elif e.is_action_pressed("jump") and is_on_floor() and not seated:
		if crouched:
			_set_crouch(false)
		else:
			velocity.y = JUMP
	elif seated and (e.is_action_pressed("interact") or e.is_action_pressed("forward") or e.is_action_pressed("jump")):
		stand()
		get_viewport().set_input_as_handled()
	elif e.is_action_pressed("interact") and _focus:
		Sfx.play("click", -6.0)
		_focus.interact()
		used.emit(_focus)

func _physics_process(dt: float) -> void:
	var input := Vector2.ZERO
	if enabled:
		input = Input.get_vector("left", "right", "forward", "back")
	var run := Input.is_action_pressed("boost") and not crouched
	# For render checks: `-- --autowalk` or `--autorun` walks straight ahead.
	if _auto != "":
		input = Vector2(0, -1)
		run = _auto == "run"
	var dir := (Basis(Vector3.UP, _yaw) * Vector3(input.x, 0, input.y))
	if dir.length() > 1.0:
		dir = dir.normalized()
	if seated:
		dir = Vector3.ZERO
	var target := dir * (CROUCH if crouched else (RUN if run else WALK))
	velocity.x = move_toward(velocity.x, target.x, (18.0 if run else 12.0) * dt)
	velocity.z = move_toward(velocity.z, target.z, (18.0 if run else 12.0) * dt)
	if not seated:
		if not is_on_floor():
			velocity.y -= 12.0 * dt
		elif velocity.y < 0.0:
			velocity.y = 0.0
		move_and_slide()
	var flat := Vector2(velocity.x, velocity.z)
	var speed := flat.length()
	# The body turns toward where it is going.
	if speed > 0.2:
		var want := atan2(velocity.x, velocity.z)
		body.rotation.y = lerp_angle(body.rotation.y, want, minf(1.0, dt * 10.0))
	var airborne := not seated and not is_on_floor() and absf(velocity.y) > 0.6
	body.locomote(speed, crouched, airborne, seated)
	_step += speed * dt
	if _step > (0.75 if speed < 3.0 else 1.05):
		_step = 0.0
		Sfx.play("step", -18.0 if speed < 3.0 else -13.0, randf_range(0.85, 1.1))

func _process(_dt: float) -> void:
	# The camera rig follows the body without inheriting its turns.
	_shoulder_y = lerpf(_shoulder_y, 1.18 if crouched else (1.5 if seated else 1.66), minf(1.0, _dt * 8.0))
	# The camera follows the body's height softly, so a jump does not throw it.
	_ground_y = lerpf(_ground_y, global_position.y, minf(1.0, _dt * (3.0 if is_on_floor() else 1.2)))
	var base := Vector3(global_position.x, _ground_y, global_position.z)
	_pivot.global_position = base + Basis(Vector3.UP, _yaw) * Vector3(SHOULDER.x, _shoulder_y, 0.0)
	_pivot.rotation = Vector3(_pitch, _yaw, 0.0)
	_look()

## The nearest interactable within reach, in front of the pilot.
func _look() -> void:
	var target: Interactable = null
	var best := 99.0
	if enabled:
		var fwd := -camera.global_basis.z
		fwd.y = 0.0
		fwd = fwd.normalized()
		var chest := global_position + Vector3(0, 1.0, 0)
		for n in get_tree().get_nodes_in_group("interactable"):
			var it := n as Interactable
			if not it or it.prompt_text() == "" or not it.is_inside_tree():
				continue
			var d := it.distance_to(chest)
			if d > it.reach:
				continue
			var to := it.global_position - global_position
			to.y = 0.0
			if to.length() > 0.6 and to.normalized().dot(fwd) < -0.1:
				continue
			if d < best:
				best = d
				target = it
	if target != _focus:
		_focus = target
		if _focus:
			Hud.prompt((_focus as Interactable).prompt_text())
		else:
			Hud.clear_prompt()

func _set_crouch(on: bool) -> void:
	if not on:
		# Only stand up where there is room overhead.
		var q := PhysicsShapeQueryParameters3D.new()
		var tall := CapsuleShape3D.new()
		tall.radius = 0.28
		tall.height = 1.75
		q.shape = tall
		q.transform = Transform3D(Basis(), global_position + Vector3(0, 0.9, 0))
		q.exclude = [get_rid()]
		if get_world_3d().direct_space_state.intersect_shape(q, 1).size() > 0:
			return
	crouched = on
	_cap.height = 1.15 if on else 1.75
	_shape.position.y = _cap.height / 2.0

## Sit on a seat: `seat` is where the hips go, its -Z the way the sitter faces.
func sit(seat: Node3D) -> void:
	seated = true
	_seat = seat
	_set_crouch(false)
	velocity = Vector3.ZERO
	global_position = seat.global_position
	body.rotation.y = seat.global_rotation.y + PI
	# Swing round to a three-quarter view from the front: from behind, the
	# seat back would hide the sitter.
	_yaw = seat.global_rotation.y + PI * 0.78
	_pitch = -0.32
	Hud.prompt("[E] Stand up", 4.0)

func stand() -> void:
	seated = false
	if _seat:
		global_position = _seat.global_position + _seat.global_basis * Vector3(0, 0, -0.7)
	_seat = null

## Turn to face a point (on spawn, or for a scripted look).
func face(point: Vector3) -> void:
	var d := point - global_position
	_yaw = atan2(-d.x, -d.z)
	if body:
		body.rotation.y = _yaw + PI
