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
const ARM := 2.4
const SHOULDER := Vector3(0.38, 1.66, 0.0)

var enabled := true
var camera: Camera3D
var body: Person
var _yaw := 0.0
var _pitch := -0.16
var _pivot: Node3D
var _arm: SpringArm3D
var _ray: RayCast3D
var _focus: Node = null
var _step := 0.0
var _auto := ""

func _ready() -> void:
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.75
	shape.shape = cap
	shape.position.y = 0.875
	add_child(shape)
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
	_ray = RayCast3D.new()
	_ray.target_position = Vector3(0, 0, -(ARM + 2.6))
	_ray.collide_with_areas = true
	_ray.add_exception(self)
	camera.add_child(_ray)
	var args := OS.get_cmdline_user_args()
	_auto = "run" if "--autorun" in args else ("walk" if "--autowalk" in args else "")
	_yaw = rotation.y
	rotation = Vector3.ZERO
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
	elif e.is_action_pressed("interact") and _focus:
		Sfx.play("click", -6.0)
		_focus.interact()
		used.emit(_focus)

func _physics_process(dt: float) -> void:
	var input := Vector2.ZERO
	if enabled:
		input = Input.get_vector("left", "right", "forward", "back")
	var run := Input.is_action_pressed("boost")
	# For render checks: `-- --autowalk` or `--autorun` walks straight ahead.
	if _auto != "":
		input = Vector2(0, -1)
		run = _auto == "run"
	var dir := (Basis(Vector3.UP, _yaw) * Vector3(input.x, 0, input.y))
	if dir.length() > 1.0:
		dir = dir.normalized()
	var target := dir * (RUN if run else WALK)
	velocity.x = move_toward(velocity.x, target.x, (18.0 if run else 12.0) * dt)
	velocity.z = move_toward(velocity.z, target.z, (18.0 if run else 12.0) * dt)
	velocity.y = 0.0 if is_on_floor() else velocity.y - 9.8 * dt
	move_and_slide()
	var flat := Vector2(velocity.x, velocity.z)
	var speed := flat.length()
	# The body turns toward where it is going.
	if speed > 0.2:
		var want := atan2(velocity.x, velocity.z)
		body.rotation.y = lerp_angle(body.rotation.y, want, minf(1.0, dt * 10.0))
	body.locomote(speed)
	_step += speed * dt
	if _step > (0.75 if speed < 3.0 else 1.05):
		_step = 0.0
		Sfx.play("step", -18.0 if speed < 3.0 else -13.0, randf_range(0.85, 1.1))

func _process(_dt: float) -> void:
	# The camera rig follows the body without inheriting its turns.
	_pivot.global_position = global_position + Basis(Vector3.UP, _yaw) * SHOULDER
	_pivot.rotation = Vector3(_pitch, _yaw, 0.0)
	_look()

func _look() -> void:
	var hit: Object = _ray.get_collider() if _ray.is_colliding() else null
	var target: Node = null
	if hit and hit.has_meta("prompt") and String(hit.get_meta("prompt")) != "":
		var reach: float = (hit as Node3D).global_position.distance_to(global_position) if hit is Node3D else 99.0
		if reach < 3.2:
			target = hit
	if target != _focus:
		_focus = target
		if _focus:
			Hud.prompt(String(_focus.get_meta("prompt")))
		else:
			Hud.clear_prompt()

## Turn to face a point (on spawn, or for a scripted look).
func face(point: Vector3) -> void:
	var d := point - global_position
	_yaw = atan2(-d.x, -d.z)
	if body:
		body.rotation.y = _yaw + PI
