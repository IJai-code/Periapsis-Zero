extends Node3D
## Prologue, part one: the Aster, eleven minutes before departure. Walk the
## crew corridor to the flight deck. Teaches walking and looking, introduces
## the captain and Renn, and shows Earth through the one window.

var _walker: Player
var _window_done := false
var _door: AutoDoor
var _leaving := false

func _ready() -> void:
	var set := AsterCorridor.new()
	add_child(set)
	# The fore door opens for the pilot; walking through is going to the bridge.
	Surfaces.remove_named(set, "door_fore")
	_door = AutoDoor.make(Vector3(0.0, 0.25, -15.94), 0.0, Vector2(1.1, 2.1), 2.6)
	add_child(_door)
	_door.passed.connect(_leave)
	_walker = Player.new()
	add_child(_walker)
	_walker.position = Vector3(0.0, 0.3, -1.2)
	_walker.face(Vector3(0.0, 1.6, -16.0))
	Flow.music(false)
	_script()

func _script() -> void:
	await get_tree().create_timer(1.0).timeout
	await Hud.card("THE ASTER", "PROLOGUE · HARBOR ORBIT · 3091", 2.2)
	Hud.prompt("[W][A][S][D] Walk      [Shift] Run\n[Mouse] Look around      Click the game to take control", 10.0)
	await Hud.say("Captain Hale", "All hands, this is the captain. We leave Harbor orbit in ten minutes.")
	Hud.objective("Report to the [bridge]", "Forward, through deck 2")
	Hud.waypoint(_door, "BRIDGE")
	await Hud.say("Captain Hale", "Forty thousand doses for Tycho in our holds. The outbreak there won't wait for us, so we don't wait for anyone.")
	await Hud.say("Captain Hale", "Escort pilot to the bridge, please. Before I change my mind about hiring you.")

func _process(_dt: float) -> void:
	if not _walker:
		return
	var z := _walker.global_position.z
	if not _leaving:
		Hud.objective_extra("%d m ahead" % int(maxf(0.0, z + 15.0)))
	if not _window_done and z < -8.5:
		_window_done = true
		_window()

func _window() -> void:
	Hud.prompt("Look out of the window", 4.0)
	await Hud.say("Renn Ayers", "Engineering. You're the new escort? Renn Ayers. I keep this old girl in one piece.")
	await Hud.say("Renn Ayers", "Don't mind the clicking on the comm. I've got the long-range set open tonight. Checking the relays.")
	await Hud.say("Renn Ayers", "Go on up, the captain hates waiting. I'll be right behind you.")

func _leave() -> void:
	if _leaving:
		return
	_leaving = true
	Report.line("DOOR passed")
	Hud.clear_prompt()
	Hud.waypoint(null)
	Hud.silence()
	Flow.go("bridge")
