class_name Raider
extends Hull
## A Hollow raider: attack run on its target, break off past it, come round
## again. Leads its shots; steers clear of the big ships. Shot at, it jinks:
## a hard weave off the line of fire for a second or two. The gunship
## variant (`gunship = true`) is bigger, slower, tougher, and fires missiles
## at the player, which a barrel roll shakes off.

var target: Hull
var speed := 82.0
var turn := 1.35
var bolts: Bolts
var missiles: Missiles
var gunship := false
## The prologue's raiders: fewer hit points, slower, wider to hit, worse
## shots. The first fight teaches; it should not grind.
var rookie := false
var avoid: Array = []
var damage_to_player := 4.0
var _mode := "attack"
var _timer := 0.0
var _break_dir := Vector3.ZERO
var _cool := 0.0
var _mcool := 6.0
var _jink := Vector3.ZERO
var _jink_t := 0.0
var _jink_cool := 0.0

func _ready() -> void:
	team = "hollow"
	if gunship:
		display_name = "Hollow gunship"
		ship_class = "Assault frigate"
		radius = 12.0
		speed = 64.0
		turn = 0.9
		max_shield = 70.0
		max_armor = 60.0
		max_integrity = 90.0
	else:
		display_name = "Hollow raider"
		ship_class = "Interceptor"
		radius = 7.5
		max_shield = 18.0
		max_armor = 14.0
		max_integrity = 28.0
	speed *= randf_range(0.92, 1.12)
	if rookie:
		max_shield = 8.0
		max_armor = 6.0
		max_integrity = 18.0
		radius = 9.5
		speed *= 0.82
		turn *= 0.85
		damage_to_player = 2.5
	shield = max_shield
	armor = max_armor
	integrity = max_integrity
	body = Hull.model("raider")
	if gunship:
		body.scale = Vector3.ONE * 1.7
	add_child(body)
	make_solid(4.5 * (1.7 if gunship else 1.0))
	_engines()
	velocity = -global_basis.z * speed
	damaged.connect(_on_hit)

## Two burning engines astern, so a raider reads at a distance and its
## heading shows at a glance.
func _engines() -> void:
	var k := 1.7 if gunship else 1.0
	for x in [-1.6, 1.6]:
		var c := CylinderMesh.new()
		c.top_radius = 0.55 * k
		c.bottom_radius = 0.05
		c.height = 7.0 * k
		c.radial_segments = 12
		c.rings = 1
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/plume.gdshader")
		m.set_shader_parameter("power", 1.1)
		m.set_shader_parameter("hot", Color(1.0, 0.75, 0.45))
		m.set_shader_parameter("cool", Color(1.0, 0.25, 0.08))
		c.material = m
		var mi := MeshInstance3D.new()
		mi.mesh = c
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.rotation_degrees = Vector3(-90, 0, 0)
		mi.position = Vector3(x * k, 0.1 * k, 7.5 * k + c.height / 2.0)
		body.add_child(mi)

## Under fire: weave off the shooter's line for a moment.
func _on_hit(_amount: float) -> void:
	if _jink_cool > 0.0 or not alive:
		return
	_jink_cool = randf_range(2.5, 4.5) * (1.6 if gunship else 1.0) * (2.2 if rookie else 1.0)
	_jink_t = randf_range(1.0, 2.0)
	var fwd := -global_basis.z
	var side := fwd.cross(Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)).normalized()).normalized()
	_jink = (fwd * 0.4 + side).normalized()

func _physics_process(dt: float) -> void:
	if not alive:
		return
	regenerate(dt, 6.0, 3.0)
	var fwd := -global_basis.z
	var want := fwd
	_timer -= dt
	_jink_t -= dt
	_jink_cool -= dt
	var pace := speed
	if target and is_instance_valid(target) and target.alive:
		var to := target.global_position - global_position
		var dist := to.length()
		if _mode == "attack":
			var lead := target.global_position + target.velocity * (dist / Bolts.SPEED)
			want = (lead - global_position).normalized()
			if dist < (220.0 if gunship else 140.0) + target.radius:
				_mode = "break"
				_timer = randf_range(2.2, 3.4)
				_break_dir = (fwd + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 1.4).normalized()
			_cool -= dt
			if _cool <= 0.0 and fwd.angle_to(want) < 0.13 and dist < 700.0:
				_cool = 0.42 if gunship else 0.3
				var dmg := damage_to_player * (1.5 if gunship else 1.0) if target is PlayerShip else 0.6
				var s := (2.2 if randf() < 0.5 else -2.2) * (1.7 if gunship else 1.0)
				Fx.muzzle(self, Vector3(s, -0.25, -10.6 * (1.7 if gunship else 1.0)), Color(2.0, 0.6, 0.2))
				bolts.fire(global_position + fwd * 11.0, (want + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * (0.06 if rookie else 0.03)).normalized(), velocity, "hollow", dmg)
		else:
			want = _break_dir
			if _timer <= 0.0:
				_mode = "attack"
		# The gunship's missiles, at the player, every few seconds in range.
		if gunship and missiles and target is PlayerShip:
			_mcool -= dt
			if _mcool <= 0.0 and dist < 1400.0 and dist > 200.0:
				_mcool = randf_range(7.0, 10.0)
				missiles.launch(global_position + global_basis.y * -3.0, (to.normalized() + fwd).normalized(), velocity, "hollow", target, 20.0)
	if _jink_t > 0.0:
		want = (want * 0.3 + _jink).normalized()
		pace *= 1.25
	for big in avoid:
		if is_instance_valid(big):
			var away: Vector3 = global_position - big.global_position
			var clear: float = big.get("radius") + 45.0 if big.get("radius") != null else 120.0
			if away.length() < clear:
				want = (want + away.normalized() * 2.0).normalized()
	var angle := fwd.angle_to(want)
	if angle > 0.001:
		var axis := fwd.cross(want).normalized()
		if axis.length() > 0.5:
			global_basis = (Basis(axis, minf(angle, turn * (1.6 if _jink_t > 0.0 else 1.0) * dt)) * global_basis).orthonormalized()
	velocity = velocity.move_toward(-global_basis.z * pace, 120.0 * dt)
	global_position += velocity * dt
