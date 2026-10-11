class_name Seat
extends Interactable
## A place to sit. Stand in front of it and press E; the pilot sits facing
## the seat's -Z. E, W or Space stands up again.

static func make(at: Vector3, yaw_deg := 0.0, label := "Sit down") -> Seat:
	var s := Seat.new(Vector3(0.7, 1.0, 0.7), "[E] " + label, 1.2)
	s.position = at
	s.rotation_degrees.y = yaw_deg
	return s

func interact() -> void:
	if has_meta("taken"):
		return
	for p in get_tree().get_nodes_in_group("player"):
		if not p.seated:
			set_meta("taken", p)
			p.sit(self)
	activated.emit()
