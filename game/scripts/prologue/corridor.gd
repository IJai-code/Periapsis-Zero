extends Node3D
## Prologue, part one: the Aster, eleven minutes before departure. Walk the
## crew corridor to the flight deck. Teaches walking and looking, introduces
## the captain and Renn, and shows Earth through the one window.

var _walker: Walker
var _window_done := false
var _door: Interactable
var _leaving := false

func _ready() -> void:
	add_child(AsterCorridor.new())
	_walker = Walker.new()
	add_child(_walker)
	_walker.position = Vector3(0.0, 0.3, -1.2)
	_walker.face(Vector3(0.0, 1.6, -16.0))
	_door = Interactable.new(Vector3(1.4, 2.2, 0.6), "[E] Open the door to the bridge")
	_door.position = Vector3(0.0, 1.3, -15.6)
	add_child(_door)
	_door.activated.connect(_leave)
	Flow.music(false)
	_script()

func _script() -> void:
	await get_tree().create_timer(1.0).timeout
	await Hud.card("THE ASTER", "PROLOGUE · HARBOR ORBIT · 3091", 2.2)
	Hud.prompt("[W][A][S][D] walk    [Mouse] look    [Shift] run    Click to capture the mouse", 9.0)
	await Hud.say("Captain Hale", "All hands, this is the captain. We leave Harbor orbit in ten minutes.")
	Hud.objective("Report to the bridge", "Forward, through deck 2")
	await Hud.say("Captain Hale", "Six ships, medical cargo, Moon by Thursday. Escort pilot to the bridge, please.")

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
	await Hud.say("Renn Ayers", "Engineering here. You're the new escort? The captain wants you on the bridge.")
	await Hud.say("Renn Ayers", "I'll meet you up there. Your Kestrel's fuelled and warm.")

func _leave() -> void:
	if _leaving:
		return
	_leaving = true
	_walker.enabled = false
	Hud.clear_prompt()
	Sfx.play("door", -2.0)
	Hud.silence()
	Flow.go("bridge")
