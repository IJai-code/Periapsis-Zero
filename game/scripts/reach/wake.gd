class_name Wake
extends Node
## The morning: you are lying on the ground beside Hearth's fire with your
## eyes shut. The lids open slowly, twice, on a sky full of stars and the
## Lantern low over the pines. Then you sit up, the fire and Mara come into
## the world, and you stand.

## Metres: the eye while lying, while sitting, and standing (the suit's own).
const LIE := 0.30
const SIT := 0.95

var reach: Node
var cam: Camera3D
## How shut the eyes are: 0 open, 1 shut.
var lid: float:
	get: return _lid
	set(v): _set_lid(v)
var _lid := 1.0
## The path along the morning, 0 lying to 1 standing. Driven by a tween.
var p := 0.0

var _keys: Array = []
var _overlay: ColorRect
var _mat: ShaderMaterial
var _up := Vector3.UP
var _roll := 0.0
var _t := 0.0
var _done := false
var _saved_exposure := 1.0

func _ready() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 9
	add_child(layer)
	_overlay = ColorRect.new()
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://shaders/reach/blink.gdshader")
	_overlay.material = _mat
	layer.add_child(_overlay)

func _set_lid(v: float) -> void:
	_lid = clampf(v, 0.0, 1.0)
	if _mat:
		_mat.set_shader_parameter("lid", _lid)
	if _overlay:
		_overlay.visible = _lid > 0.002

## A later morning: in the Kestrel's seat on the launch tower. The lids
## open twice on the cockpit's screens and the sky over the canopy.
func in_cockpit() -> void:
	var ship: ReachShip = reach.ship
	ship.seat_now()
	lid = 1.0
	reach.hud.fade_to(Color(0, 0, 0, 0), 0.6)
	var t := create_tween()
	t.tween_property(self, "lid", 0.35, 1.4).set_trans(Tween.TRANS_SINE)
	t.tween_property(self, "lid", 0.8, 0.5).set_trans(Tween.TRANS_SINE)
	t.tween_property(self, "lid", 0.0, 1.2).set_trans(Tween.TRANS_SINE)
	await t.finished
	if reach.hud:
		reach.hud.caption("The same morning. You wake in the Kestrel's seat, up on the tower. Hold Space to lift off.", 5.0)
	queue_free()

## The morning. `first` is the true first waking, which opens slower and
## says the loop number afterwards; every later loop wakes the same way.
func morning(first: bool) -> void:
	var ex: Explorer = reach.player
	var home: ReachBody = reach.system.bodies["hearthstone"]
	var fire := Worlds.place(home, "village")
	_up = fire.basis.y
	var pad := fire.basis.x
	# Where you were lying: a couple of paces from the fire, head toward it.
	var lie_at := fire.origin + pad * 2.15 + _up * LIE
	var sit_at := fire.origin + pad * 1.55 + _up * SIT
	var stand_at := fire.origin + pad * 2.4 + _up * 0.0
	# Look directions, in the order you find them.
	var up_sky := (_up * 0.86 - pad * 0.34 + fire.basis.z * 0.18).normalized()
	var to_fire := (-pad * 0.94 - _up * 0.20).normalized()
	var to_mara := (-pad * 0.62 - fire.basis.z * 0.72 - _up * 0.14).normalized()
	# Stand first (hidden), so the final pose is the player's own camera and
	# control is handed over without a single frame of movement.
	ex.place(Transform3D(fire.basis, stand_at), -pad)
	ex.enabled = false
	await get_tree().process_frame
	var stand_eye := ex.camera.global_transform
	var stand_look := -stand_eye.basis.z
	_keys = [
		[0.00, _pose(lie_at, up_sky, 0.0)],
		[0.07, _pose(lie_at, up_sky, 0.10)],
		[0.33, _pose(sit_at, to_fire, -0.05)],
		[0.50, _pose(sit_at, to_fire, 0.02)],
		[0.62, _pose(sit_at, to_mara, 0.0)],
		[0.86, _pose(stand_at + _up * 1.62, stand_look, 0.0)],
		[1.00, stand_eye],
	]
	# The camera you wake through.
	cam = Camera3D.new()
	cam.fov = 72.0
	cam.near = 0.05
	cam.far = 60000.0
	cam.top_level = true
	reach.add_child(cam)
	cam.global_transform = _at(0.0)
	cam.make_current()
	# Focus comes back with the eyes: a far blur that clears as you wake,
	# and low exposure at first. Depth of field lives on the camera's own
	# attributes, so it ends when this camera does.
	var attr := CameraAttributesPractical.new()
	attr.dof_blur_far_enabled = true
	attr.dof_blur_far_distance = 26.0
	attr.dof_blur_far_transition = 18.0
	attr.dof_blur_amount = 0.09
	cam.attributes = attr
	var env: Environment = reach.env
	_saved_exposure = env.tonemap_exposure
	env.tonemap_exposure = _saved_exposure * 0.55
	_set_lid(1.0)
	_overlay.visible = true
	# The morning's black is the eyelids, not the HUD's fade: give the fade
	# back so the first thing that opens is the sky.
	if reach.hud:
		reach.hud.fade_to(Color(0, 0, 0, 0), 0.5)
	# The music of waking, quiet under the fire.
	var total := 9.2 if first else 8.2
	var tw := create_tween()
	tw.tween_property(self, "p", 1.0, total).set_trans(Tween.TRANS_LINEAR)
	var fe := create_tween()
	fe.tween_property(env, "tonemap_exposure", _saved_exposure, total * 0.55).set_trans(Tween.TRANS_SINE)
	fe.parallel().tween_property(attr, "dof_blur_amount", 0.0, total * 0.7).set_trans(Tween.TRANS_SINE)
	_eyes(first)
	await tw.finished
	if _done:
		return
	_hand_over()

## The lids: a slow first crack, then two blinks that settle into open.
func _eyes(first: bool) -> void:
	var t := create_tween()
	t.tween_method(_set_lid, 1.0, 0.72, 0.75).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	t.tween_method(_set_lid, 0.72, 0.94, 0.10)
	t.tween_method(_set_lid, 0.94, 0.30, 0.16).set_trans(Tween.TRANS_SINE)
	t.tween_method(_set_lid, 0.30, 0.88, 0.09)
	if first:
		t.tween_interval(0.35)
		t.tween_method(_set_lid, 0.88, 0.24, 0.13)
	t.tween_method(_set_lid, 0.24, 0.0, 0.85).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)

func _hand_over() -> void:
	if _done:
		return
	_done = true
	_set_lid(0.0)
	if is_instance_valid(cam):
		cam.queue_free()
	var ex: Explorer = reach.player
	ex.camera.make_current()
	ex.enabled = true
	queue_free()

## Skip the morning (a test, or a link straight into the Reach).
func skip() -> void:
	if _done:
		return
	_hand_over()

func _pose(at: Vector3, look: Vector3, roll: float) -> Transform3D:
	var b := Basis.looking_at(look.normalized(), _up)
	if absf(roll) > 0.0001:
		b = b.rotated(look.normalized(), roll)
	return Transform3D(b, at)

## The path, with breathing: still while lying, more as you sit and stand.
func _at(q: float) -> Transform3D:
	if _keys.is_empty():
		return Transform3D.IDENTITY
	var i := 0
	while i < _keys.size() - 2 and q > float((_keys[i + 1] as Array)[0]):
		i += 1
	var a: Array = _keys[i]
	var b: Array = _keys[i + 1]
	var span := float(b[0]) - float(a[0])
	var k := 0.0 if span <= 0.0 else clampf((q - float(a[0])) / span, 0.0, 1.0)
	k = k * k * (3.0 - 2.0 * k)
	var xf: Transform3D = (a[1] as Transform3D).interpolate_with(b[1], k)
	var sway := sin(_t * 1.7) * 0.004 + sin(_t * 0.61) * 0.002
	var lift := sin(_t * 1.7) * (0.003 + q * 0.004)
	xf.origin += _up * lift + xf.basis.x * sway
	return xf

func _process(dt: float) -> void:
	_t += dt
	if cam and not _done:
		cam.global_transform = _at(p)
