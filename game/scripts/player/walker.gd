class_name Walker
extends CharacterBody3D
## The pilot on foot, first person: walk, look, run, and use what's in reach.
## Interactables are any collider with a `prompt` meta and an `interact` method.

signal used(target: Node)

const WALK := 2.6
const RUN := 4.4
const EYE := 1.62

var enabled := true
var camera: Camera3D
var _yaw := 0.0
var _pitch := 0.0
var _bob := 0.0
var _step := 0.0
var _ray: RayCast3D
var _focus: Node = null

func _ready() -> void:
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.28
	cap.height = 1.75
	shape.shape = cap
	shape.position.y = 0.875
	add_child(shape)
	camera = Camera3D.new()
	camera.fov = 72.0
	camera.near = 0.03
	camera.far = 120_000.0
	camera.position.y = EYE
	add_child(camera)
	_ray = RayCast3D.new()
	_ray.target_position = Vector3(0, 0, -2.2)
	_ray.collide_with_areas = true
	camera.add_child(_ray)
	_yaw = rotation.y
	rotation = Vector3.ZERO

func _unhandled_input(e: InputEvent) -> void:
	if not enabled:
		return
	if e is InputEventMouseButton and e.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif e is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var s := 0.0022 * float(Flow.settings.mouse)
		_yaw -= e.relative.x * s
		_pitch -= e.relative.y * s * (-1.0 if Flow.settings.invert else 1.0)
		_pitch = clampf(_pitch, -1.35, 1.35)
	elif e.is_action_pressed("interact") and _focus:
		Sfx.play("click", -6.0)
		_focus.interact()
		used.emit(_focus)

func _physics_process(dt: float) -> void:
	var input := Vector2.ZERO
	if enabled:
		input = Input.get_vector("left", "right", "forward", "back")
	var speed := RUN if Input.is_action_pressed("boost") else WALK
	var dir := (Basis(Vector3.UP, _yaw) * Vector3(input.x, 0, input.y)).normalized()
	var target := dir * speed * minf(input.length(), 1.0)
	velocity.x = move_toward(velocity.x, target.x, 14.0 * dt)
	velocity.z = move_toward(velocity.z, target.z, 14.0 * dt)
	velocity.y = 0.0 if is_on_floor() else velocity.y - 9.8 * dt
	move_and_slide()
	# Head bob and footsteps from distance walked.
	var moved := Vector2(velocity.x, velocity.z).length()
	_bob += moved * dt * 2.1
	_step += moved * dt
	if _step > (0.78 if speed == WALK else 1.0):
		_step = 0.0
		Sfx.play("step", -20.0, randf_range(0.85, 1.1))
	var bob := sin(_bob * TAU * 0.5) * 0.03 * minf(moved / WALK, 1.3)
	camera.position.y = EYE + bob
	camera.rotation = Vector3(_pitch, _yaw, sin(_bob * PI * 0.5) * 0.004 * moved)
	_look()

func _look() -> void:
	var hit: Object = _ray.get_collider() if _ray.is_colliding() else null
	var target: Node = null
	if hit and hit.has_meta("prompt"):
		target = hit
	if target != _focus:
		_focus = target
		if _focus:
			Hud.prompt(String(_focus.get_meta("prompt")))
		else:
			Hud.clear_prompt()

## Face a point (on spawn, or for a scripted look).
func face(point: Vector3) -> void:
	var d := point - global_position
	_yaw = atan2(-d.x, -d.z)
