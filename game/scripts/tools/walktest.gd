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
		Report.line("WALKTEST reached %d at %s (wanted %s), prompt: '%s'" % [_i, _player.global_position.snapped(Vector3.ONE * 0.01), target, Hud._help_text.text if Hud._help.modulate.a > 0.5 else ""])
		if _i >= plan.size():
			_player._auto = ""
			await get_tree().create_timer(0.6).timeout
			Report.line("WALKTEST final %s prompt: '%s'" % [_player.global_position.snapped(Vector3.ONE * 0.01), Hud._help_text.text if Hud._help.modulate.a > 0.5 else ""])
			get_tree().quit()
