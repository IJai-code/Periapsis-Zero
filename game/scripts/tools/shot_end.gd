extends Node
## Runs after every other node's _process (shot.gd times the span).

func _process(_dt: float) -> void:
	get_meta("shot")._end_of_process()
