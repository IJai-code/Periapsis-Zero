class_name Raider
extends Hull
## A Hollow raider: attack run on its target, break off past it, come round
## again. Leads its shots; steers clear of the big ships.

var target: Hull
var speed := 82.0
var turn := 1.35
var bolts: Bolts
var avoid: Array = []
var damage_to_player := 5.0
var _mode := "attack"
var _timer := 0.0
var _break_dir := Vector3.ZERO
var _cool := 0.0

func _ready() -> void:
	team = "hollow"
	radius = 7.5
	integrity = 40.0
	max_integrity = 40.0
	body = Hull.model("raider")
	add_child(body)
	velocity = -global_basis.z * speed

func _physics_process(dt: float) -> void:
	if not alive:
		return
	var fwd := -global_basis.z
	var want := fwd
	_timer -= dt
	if target and is_instance_valid(target) and target.alive:
		var to := target.global_position - global_position
		var dist := to.length()
		if _mode == "attack":
			var lead := target.global_position + target.velocity * (dist / Bolts.SPEED)
			want = (lead - global_position).normalized()
			if dist < 140.0 + target.radius:
				_mode = "break"
				_timer = randf_range(2.2, 3.4)
				_break_dir = (fwd + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 1.4).normalized()
			_cool -= dt
			if _cool <= 0.0 and fwd.angle_to(want) < 0.13 and dist < 700.0:
				_cool = 0.28
				var dmg := damage_to_player if target is PlayerShip else 0.6
				Fx.muzzle(self, Vector3(2.2 if randf() < 0.5 else -2.2, -0.25, -10.6), Color(2.0, 0.6, 0.2))
				bolts.fire(global_position + fwd * 11.0, (want + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.025).normalized(), velocity, "hollow", dmg)
		else:
			want = _break_dir
			if _timer <= 0.0:
				_mode = "attack"
	for big: Hull in avoid:
		if is_instance_valid(big):
			var away := global_position - big.global_position
			var clear := big.radius + 45.0
			if away.length() < clear:
				want = (want + away.normalized() * 2.0).normalized()
	var angle := fwd.angle_to(want)
	if angle > 0.001:
		var axis := fwd.cross(want).normalized()
		if axis.length() > 0.5:
			global_basis = (Basis(axis, minf(angle, turn * dt)) * global_basis).orthonormalized()
	velocity = -global_basis.z * speed
	global_position += velocity * dt
