extends Node
## Automated walking checks, run with `-- --walktest <plan>`:
## steers the player to each waypoint in turn, then reports where they got
## to and what the HUD offered. Plans are below.

const PLANS := {
	"hangar_ladder": [Vector3(-4.5, 0, -10.0), Vector3(-3.3, 0, -16.6)],
	"hangar_wing": [Vector3(-2.0, 0, -8.0), Vector3(-6.0, 0, -15.0)],
	"bridge_hale": [Vector3(1.0, 0, -3.9), Vector3(0.3, 0, -6.7)],
	"bridge_back": [Vector3(0.0, 0, 3.0)],
	"bridge_chair": [Vector3(0.0, 0, -1.9)],
	"corridor_back": [Vector3(0.0, 0, 4.0)],
	"hearth_mara": [Vector3(-1.6, 0, -20.0), Vector3(-1.0, 0, -39.6)],
	"corridor_door": [Vector3(0.0, 0, -15.0)],
}

var plan: Array = []
var _i := 0
var _t := 0.0
var _player: Node3D

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if "--movementtest" in args:
		set_process(false)
		_movement_checks.call_deferred()
		return
	var i := args.find("--walktest")
	if i < 0:
		set_process(false)
		return
	plan = PLANS[args[i + 1]]

func _process(dt: float) -> void:
	_t += dt
	if _t < 2.5:
		return
	if not _player:
		var ps := get_tree().get_nodes_in_group("player")
		if ps.is_empty():
			return
		_player = ps[0]
	if _i >= plan.size():
		return
	var target: Vector3 = plan[_i]
	var d := target - _player.global_position
	d.y = 0.0
	_player._yaw = atan2(-d.x, -d.z)
	_player._auto = "walk"
	if d.length() < 0.35 or _t > 2.5 + 12.0 * (_i + 1):
		_i += 1
		Report.line("WALKTEST reached %d at %s (wanted %s), prompt: '%s'" % [_i, _player.global_position.snapped(Vector3.ONE * 0.01), target, Hud.focus_text()])
		if _i >= plan.size():
			_player._auto = ""
			await get_tree().create_timer(0.6).timeout
			Report.line("WALKTEST final %s prompt: '%s'" % [_player.global_position.snapped(Vector3.ONE * 0.01), Hud.focus_text()])
			# With `--shot`, stay for the picture.
			if not "--shot" in OS.get_cmdline_user_args():
				Report.finish(get_tree())

var _failed := 0

func _check(ok: bool, label: String) -> void:
	if not ok:
		_failed += 1
	Report.line("MOVEMENTTEST %s %s" % ["ok" if ok else "FAIL", label])

func _movement_checks() -> void:
	await get_tree().create_timer(2.5).timeout
	var player: Player = get_tree().get_first_node_in_group("player")
	_check(player != null, "scene has a player")
	if not player:
		Report.finish(get_tree(), 1)
		return
	var person := player.body
	person.locomote(1.6)
	person._anim.seek(person._anim.get_animation("walk").length * 0.4, true)
	person.locomote(4.4)
	_check(person._gait == "run" and absf(person._anim.current_animation_position / person._anim.get_animation("run").length - 0.4) < 0.01, "walk to run retains stride phase")
	person.talk(true)
	person.talk(false)
	person.locomote(1.6)
	_check(person._anim.current_animation == "walk", "walking resumes after dialogue")
	player._set_crouch(true)
	_check(player.crouched and is_equal_approx(player._cap.height, 1.15), "crouch reduces collision height")
	player._set_crouch(false)
	_check(not player.crouched and is_equal_approx(player._cap.height, 1.75), "standing restores collision height")
	var walker := Wanderer.new()
	walker.points = [Vector3(30, 0, 30)]
	get_tree().current_scene.add_child(walker)
	walker.set_physics_process(false)
	walker.rotation.y = PI / 2.0
	walker._person.face(walker.to_global(Vector3(0, 0, 4)))
	_check(absf(walker._person._yaw_target) < 0.01, "conversation facing accounts for rotated parent")
	walker._person._yaw_target = 1.3
	walker._person.follow_route()
	_check(is_zero_approx(walker._person._yaw_target), "walking clears conversation heading")
	# Keep the test mesh alive until shutdown; freeing newly submitted
	# material RIDs mid-frame races Forward+'s render-list preparation.
	walker.visible = false
	player._yaw = 0.0
	player._auto = "walk"
	await get_tree().create_timer(0.4).timeout
	_check(absf(Vector2(player.velocity.x, player.velocity.z).length() - Player.WALK) < 0.05, "walking reaches expected speed")
	player._auto = "run"
	await get_tree().create_timer(0.4).timeout
	_check(absf(Vector2(player.velocity.x, player.velocity.z).length() - Player.RUN) < 0.05, "running reaches expected speed")
	player._set_crouch(true)
	await get_tree().create_timer(0.4).timeout
	_check(absf(Vector2(player.velocity.x, player.velocity.z).length() - Player.CROUCH) < 0.05 and person._gait == "crouch_walk", "crouch walking reaches expected speed and clip")
	player._auto = ""
	player._set_crouch(false)
	await get_tree().create_timer(0.4).timeout
	player.velocity.y = Player.JUMP
	await get_tree().physics_frame
	await get_tree().physics_frame
	_check(person._gait == "jump", "jump uses airborne clip")
	await get_tree().create_timer(1.0).timeout
	_check(player.is_on_floor() and person._gait == "idle", "landing restores grounded idle")
	Report.line("MOVEMENTTEST %d failed" % _failed)
	Report.finish(get_tree(), 1 if _failed else 0)
