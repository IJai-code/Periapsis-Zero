extends Node
## Automated flight checks, `-- --flytest <plan>`: holds full thrust toward
## a point for a while and reports the closest the ship came to it and
## whether the ship's centre ever ended up inside something solid.

const PLANS := {
	"ram_station": Vector3(0, 0, 0),      # Hearth's hub, test flight scene
	"ram_aster": Vector3(0, 0, 0),        # the Aster, prologue flight
}

var _target := Vector3.ZERO
var _t := 0.0
var _ship: Node3D
var _closest := 1e9
var _inside := 0

func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--flytest")
	if i < 0:
		set_process(false)
		return
	_target = PLANS[args[i + 1]]

func _process(dt: float) -> void:
	_t += dt
	if not _ship:
		for n in get_tree().get_nodes_in_group("mouse_look"):
			if n is PlayerShip:
				_ship = n
		return
	if _t < 1.0:
		return
	_ship.controls = true
	_ship.aim = (_target - _ship.global_position).normalized()
	_ship.cruise = PlayerShip.MAX
	_closest = minf(_closest, _ship.global_position.distance_to(_target))
	var space := _ship.get_world_3d().direct_space_state
	var q := PhysicsPointQueryParameters3D.new()
	q.position = _ship.global_position
	if space.intersect_point(q, 1).size() > 0:
		_inside += 1
	if _t > 14.0:
		Report.line("FLYTEST closest %.1f m, frames inside solid %d, hull %.0f, speed now %.1f" % [_closest, _inside, _ship.integrity, _ship.velocity.length()])
		Report.finish(get_tree())
