class_name LifeMotion
extends SkeletonModifier3D
## Life on top of whatever a person's animation is doing, so nobody talks
## by waving their hands alone: while talking, nods in time with the words,
## a head tilted now and then, a weight shift from foot to foot, a shrug, a
## lean in for emphasis, and the gestures varied (the arms carried a little
## higher or lower each phrase). Idle, a breath, and the head turning to
## look about. Small rotations about the body's own axes, added after the
## animation.

var person: Node
var _t := 0.0
var _phase := 0.0
var _talk := 0.0
var _b := {}

func _ready() -> void:
	_phase = randf() * 100.0
	var sk := get_skeleton()
	for n in ["pelvis", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r"]:
		var i := sk.find_bone(n)
		if i >= 0:
			_b[n] = i

func _process_modification_with_delta(delta: float) -> void:
	var sk := get_skeleton()
	if sk == null or _b.is_empty():
		return
	_t += delta
	var talking: bool = person != null and bool(person.get("_talking"))
	_talk = move_toward(_talk, 1.0 if talking else 0.0, delta * 2.0)
	var t := _t + _phase
	var k := _talk
	# Phrases: emphasis comes in pulses every couple of seconds.
	var beat := pow(maxf(sin(t * 2.6), 0.0), 6.0)
	var phrase := 0.5 + 0.5 * sin(t * 0.37)
	var shrug := pow(maxf(sin(t * 0.55 + 1.3), 0.0), 12.0)
	# The whole body: breathing; talking, a weight shift and a lean.
	_rot(sk, "pelvis", Vector3(0, 0, 1), 0.035 * sin(t * 0.42) * k)
	_rot(sk, "spine_02", Vector3(1, 0, 0), 0.012 * sin(t * 1.7) + (0.05 * beat - 0.02) * k)
	_rot(sk, "spine_03", Vector3(0, 1, 0), 0.06 * sin(t * 0.33) * k)
	_rot(sk, "spine_03", Vector3(0, 0, 1), 0.03 * sin(t * 0.51) * k)
	# The head: nods with the words and harder on the beat, a tilt, a turn;
	# idle, slow looks about.
	var nod := (0.035 * sin(t * 6.3) * (0.4 + 0.6 * phrase) + 0.12 * beat) * k
	var look := (1.0 - k) * (0.22 * sin(t * 0.21) + 0.12 * sin(t * 0.53 + 2.0))
	_rot(sk, "neck_01", Vector3(1, 0, 0), nod * 0.5)
	_rot(sk, "head", Vector3(1, 0, 0), nod * 0.6 + (1.0 - k) * 0.04 * sin(t * 0.27))
	_rot(sk, "head", Vector3(0, 0, 1), 0.09 * sin(t * 0.71) * k)
	_rot(sk, "head", Vector3(0, 1, 0), 0.12 * sin(t * 0.43) * k + look)
	# A shrug, now and then.
	_rot(sk, "clavicle_l", Vector3(0, 0, 1), 0.14 * shrug * k)
	_rot(sk, "clavicle_r", Vector3(0, 0, 1), -0.14 * shrug * k)
	# Gestures: the same loop carried differently each phrase.
	_rot(sk, "upperarm_r", Vector3(1, 0, 0), (0.25 * sin(t * 0.61) - 0.1) * k)
	_rot(sk, "upperarm_l", Vector3(1, 0, 0), (0.2 * sin(t * 0.47 + 1.7) - 0.1) * k)
	_rot(sk, "lowerarm_r", Vector3(1, 0, 0), 0.25 * sin(t * 0.83 + 0.4) * k)
	_rot(sk, "lowerarm_l", Vector3(1, 0, 0), 0.2 * sin(t * 0.77 + 2.4) * k)

## Turn a bone by `angle` about `axis` in the skeleton's own space (the
## body's: X right, Y up, Z forward), after its animated pose.
func _rot(sk: Skeleton3D, bone: String, axis: Vector3, angle: float) -> void:
	if absf(angle) < 0.0005 or not _b.has(bone):
		return
	var i: int = _b[bone]
	var g := sk.get_bone_global_pose(i)
	g.basis = Basis(axis, angle) * g.basis
	sk.set_bone_global_pose(i, g)

