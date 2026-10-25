class_name QuantumMoon
extends Node
## The Phantom moves when no one is looking. Each time it goes from seen to
## unseen (out of view, or behind another body), it is somewhere else on
## its orbit: a quarter, a half or three quarters round. The Kestrel's
## target lock (T) holds it: a ship's radar keeps it measured, so it stays
## put while it is locked. Close by (half a kilometre) or standing
## on it, it is always seen.

var reach: Node
var body: ReachBody
var locked := false
var _m0 := 0.0
var _was_seen := false
var _last_seen := -100.0
var _cool := 0.0
var _t := 0.0

func _ready() -> void:
	body = reach.system.bodies["phantom"]
	_m0 = body.orbit.m0

func reset() -> void:
	body.orbit.m0 = _m0
	locked = false
	_was_seen = false

func _process(dt: float) -> void:
	_t += dt
	_cool -= dt
	var ship: ReachShip = reach.ship
	locked = ship != null and ship.target == "phantom"
	if reach.system.ref == "phantom":
		_was_seen = true
		return
	var seen := observed()
	if seen:
		# Looked at, not merely in the corner of the eye.
		var cam := get_viewport().get_camera_3d()
		if (-cam.global_basis.z).dot((body.node.global_position - cam.global_position).normalized()) > 0.97:
			_last_seen = _t
	elif _was_seen and not locked and _cool <= 0.0:
		_jump()
	_was_seen = seen

## Whether the camera sees the Phantom now: close, or in view and not
## hidden behind a body or the Lantern.
func observed() -> bool:
	var cam := get_viewport().get_camera_3d()
	if not cam:
		return false
	var from := cam.global_position
	var at := body.node.global_position
	var d := from.distance_to(at)
	if d < 500.0:
		return true
	if not cam.is_position_in_frustum(at):
		return false
	var dir := (at - from) / d
	for key in reach.system.order:
		if key == "phantom":
			continue
		var b: ReachBody = reach.system.bodies[key]
		var c := b.node.global_position - from
		var along := c.dot(dir)
		if along <= 0.0 or along >= d:
			continue
		if (c - dir * along).length() < b.radius:
			return false
	return true

func _jump() -> void:
	_cool = 0.5
	body.orbit.m0 += TAU * float(1 + randi() % 3) / 4.0
	# Someone was watching it a moment ago, near enough to notice.
	var cam := get_viewport().get_camera_3d()
	if cam and _t - _last_seen < 4.0 and cam.global_position.distance_to(body.node.global_position) < 7000.0:
		if Lore.learn("ph_moves") and reach.hud:
			reach.hud.toast("SHIP LOG UPDATED")
