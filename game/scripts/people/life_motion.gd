class_name LifeMotion
extends SkeletonModifier3D
## Life on top of whatever a person's animation is doing, so nobody talks
## by waving their hands alone: while talking, nods in time with the words,
## a head tilted now and then, a weight shift from foot to foot, a shrug, a
## lean in for emphasis, and the gestures varied (the arms carried a little
## higher or lower each phrase). Idle, a breath, and the head turning to
## look about. Small rotations about the body's own axes, added after the
## animation.
##
## On top of that, two things the person is asked for (Person.look and
## Person.gesture): the head (and a little of the chest) turned to follow a
## point, as people follow you with their eyes without turning on the spot;
## and a gesture now and then: a wave, a stretch, a scratch of the head,
## hands held out to a fire, a hand shading the eyes. Arms are aimed (a bone
## turned so it points a given way), so the rig's own bone axes never
## matter.

var person: Node
var _t := 0.0
var _phase := 0.0
var _talk := 0.0
var _b := {}
# The head's turn toward Person.look's point, eased.
var _yaw := 0.0
var _pitch := 0.0
var _look_k := 0.0
# Which way is the body's right in the skeleton's space (+1 or -1 on X).
var _right := -1.0

func _ready() -> void:
	_phase = randf() * 100.0
	var sk := get_skeleton()
	for n in ["pelvis", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r"]:
		var i := sk.find_bone(n)
		if i >= 0:
			_b[n] = i
	if _b.has("upperarm_r"):
		_right = signf(sk.get_bone_global_rest(_b["upperarm_r"]).origin.x)

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
	_follow(sk, delta)
	_gesture(sk)

## The head after Person.look's point: up to seventy degrees aside (the
## chest takes a fifth of it), a little up or down; eased in and out.
func _follow(sk: Skeleton3D, delta: float) -> void:
	var want := 0.0
	var wy := 0.0
	var wp := 0.0
	if person != null and person.look_at_point != Vector3.INF and _b.has("head"):
		var p: Vector3 = sk.global_transform.affine_inverse() * (person.look_at_point as Vector3)
		var d: Vector3 = p - sk.get_bone_global_pose(_b["head"]).origin
		wy = atan2(d.x, d.z)
		# Behind them: they do not wrench their neck round; the body turns
		# (Npc) or they let it go.
		if absf(wy) < 2.0:
			want = 1.0
			wy = clampf(wy, -1.2, 1.2)
			wp = clampf(atan2(d.y, Vector2(d.x, d.z).length()), -0.5, 0.45)
	_look_k = move_toward(_look_k, want, delta * 1.6)
	var rate := minf(1.0, delta * 4.0)
	_yaw = lerpf(_yaw, wy if want > 0.0 else _yaw, rate)
	_pitch = lerpf(_pitch, wp if want > 0.0 else _pitch, rate)
	var k := smoothstep(0.0, 1.0, _look_k)
	if k <= 0.001:
		return
	_rot(sk, "spine_03", Vector3(0, 1, 0), _yaw * 0.2 * k)
	_rot(sk, "neck_01", Vector3(0, 1, 0), _yaw * 0.35 * k)
	_rot(sk, "head", Vector3(0, 1, 0), _yaw * 0.45 * k)
	_rot(sk, "neck_01", Vector3(1, 0, 0), -_pitch * 0.4 * k)
	_rot(sk, "head", Vector3(1, 0, 0), -_pitch * 0.6 * k)

## The gesture Person.gesture started, in, held and out: arms aimed by
## where they should point, in the body's own terms.
func _gesture(sk: Skeleton3D) -> void:
	if person == null or person.gesture_name == "":
		return
	var g: String = person.gesture_name
	var e: float = person.gesture_t
	var dur: float = person.gesture_len
	var w := smoothstep(0.0, 0.45, e) * (1.0 - smoothstep(dur - 0.55, dur, e))
	if w <= 0.001:
		return
	var up := Vector3.UP
	var fw := Vector3(0, 0, 1)
	var r := Vector3(_right, 0, 0)
	var l := -r
	match g:
		"wave":
			# The right hand up beside the head, the forearm swinging.
			_aim(sk, "upperarm_r", "lowerarm_r", r * 0.75 + up * 0.55 + fw * 0.2, w)
			_aim(sk, "lowerarm_r", "hand_r", up + r * (0.15 + 0.45 * sin(e * 9.0)), w)
			_rot(sk, "head", Vector3(0, 0, 1), 0.08 * w * _right)
		"stretch":
			# Both arms up over the head, the back arched.
			_rot(sk, "spine_02", Vector3(1, 0, 0), -0.18 * w)
			_aim(sk, "upperarm_r", "lowerarm_r", up + r * 0.25, w)
			_aim(sk, "upperarm_l", "lowerarm_l", up + l * 0.25, w)
			_aim(sk, "lowerarm_r", "hand_r", up + l * 0.15, w)
			_aim(sk, "lowerarm_l", "hand_l", up + r * 0.15, w)
			_rot(sk, "head", Vector3(1, 0, 0), -0.25 * w)
		"scratch":
			# A hand to the back of the head: puzzled, or just itchy.
			_aim(sk, "upperarm_r", "lowerarm_r", r * 0.8 + up * 0.45 + fw * 0.1, w)
			if _b.has("head") and _b.has("lowerarm_r"):
				var to := sk.get_bone_global_pose(_b["head"]).origin + up * 0.08 - fw * 0.06 - sk.get_bone_global_pose(_b["lowerarm_r"]).origin
				_aim(sk, "lowerarm_r", "hand_r", to + fw * 0.05 * sin(e * 11.0), w)
			_rot(sk, "head", Vector3(1, 0, 0), 0.12 * w)
			_rot(sk, "head", Vector3(0, 0, 1), -0.1 * w * _right)
		"warm":
			# Hands held out to the fire, rubbed now and then.
			var rub := 0.06 * sin(e * 7.0) * smoothstep(0.4, 0.6, fmod(e, 3.0) / 3.0)
			_aim(sk, "upperarm_r", "lowerarm_r", fw * 0.75 - up * 0.6 + r * 0.12, w)
			_aim(sk, "upperarm_l", "lowerarm_l", fw * 0.75 - up * 0.6 + l * 0.12, w)
			_aim(sk, "lowerarm_r", "hand_r", fw + up * 0.05 + l * (0.3 + rub), w)
			_aim(sk, "lowerarm_l", "hand_l", fw + up * 0.05 + r * (0.3 - rub), w)
			_rot(sk, "spine_02", Vector3(1, 0, 0), 0.08 * w)
		"shade":
			# A hand at the brow, looking up and out (at the Lantern).
			_rot(sk, "head", Vector3(1, 0, 0), -0.3 * w)
			_aim(sk, "upperarm_r", "lowerarm_r", fw * 0.55 + up * 0.35 + r * 0.6, w)
			if _b.has("head") and _b.has("lowerarm_r"):
				var to2 := sk.get_bone_global_pose(_b["head"]).origin + up * 0.1 + fw * 0.12 - sk.get_bone_global_pose(_b["lowerarm_r"]).origin
				_aim(sk, "lowerarm_r", "hand_r", to2, w)
		"shrug":
			# Palms out, shoulders up: who knows?
			_rot(sk, "clavicle_l", Vector3(0, 0, 1), 0.22 * w * _right)
			_rot(sk, "clavicle_r", Vector3(0, 0, 1), -0.22 * w * _right)
			_aim(sk, "lowerarm_r", "hand_r", fw * 0.8 + r * 0.6 + up * 0.1, w)
			_aim(sk, "lowerarm_l", "hand_l", fw * 0.8 + l * 0.6 + up * 0.1, w)

## Turn a bone so it points (from its head to its child's) along `dir`, in
## the skeleton's space, by `w` of the way.
func _aim(sk: Skeleton3D, bone: String, child: String, dir: Vector3, w: float) -> void:
	if not _b.has(bone) or not _b.has(child) or dir.length() < 0.001:
		return
	var i: int = _b[bone]
	var g := sk.get_bone_global_pose(i)
	var cur := sk.get_bone_global_pose(_b[child]).origin - g.origin
	if cur.length() < 0.0001:
		return
	var q := Quaternion(cur.normalized(), dir.normalized())
	g.basis = Basis(Quaternion.IDENTITY.slerp(q, w)) * g.basis
	sk.set_bone_global_pose(i, g)

## Turn a bone by `angle` about `axis` in the skeleton's own space (the
## body's: X right, Y up, Z forward), after its animated pose.
func _rot(sk: Skeleton3D, bone: String, axis: Vector3, angle: float) -> void:
	if absf(angle) < 0.0005 or not _b.has(bone):
		return
	var i: int = _b[bone]
	var g := sk.get_bone_global_pose(i)
	g.basis = Basis(axis, angle) * g.basis
	sk.set_bone_global_pose(i, g)

