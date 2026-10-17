class_name Orbit
extends RefCounted
## A Kepler orbit about a body of gravitational parameter `gm`: position and
## velocity at any time, exactly (bodies in the Reach ride these rails).
##
## The orbit plane is the XZ plane tilted by `inc` about the line of nodes;
## motion is counterclockwise seen from +Y. `m0` is the mean anomaly at t = 0
## (the moment the player wakes), radians.

var gm := 1.0
var a := 1.0
var e := 0.0
var inc := 0.0
var node := 0.0   # longitude of the ascending node
var peri := 0.0   # argument of periapsis
var m0 := 0.0

static func make(gm_: float, a_: float, e_ := 0.0, m0_ := 0.0, peri_ := 0.0, inc_ := 0.0, node_ := 0.0) -> Orbit:
	var o := Orbit.new()
	o.gm = gm_
	o.a = a_
	o.e = e_
	o.m0 = m0_
	o.peri = peri_
	o.inc = inc_
	o.node = node_
	return o

func period() -> float:
	return TAU * sqrt(a * a * a / gm)

func mean_motion() -> float:
	return sqrt(gm / (a * a * a))

## Solve Kepler's equation E - e sin E = M for E (Newton, then a guard).
static func eccentric(m: float, e_: float) -> float:
	m = wrapf(m, -PI, PI)
	var ea := m if e_ < 0.8 else PI * signf(m)
	for i in 30:
		var f := ea - e_ * sin(ea) - m
		var d := 1.0 - e_ * cos(ea)
		var step := f / d
		ea -= step
		if absf(step) < 1e-9:
			break
	return ea

func _basis() -> Basis:
	return Basis(Vector3.UP, node) * Basis(Vector3.RIGHT, inc) * Basis(Vector3.UP, peri)

## The time (in loop seconds) of the periapsis passage nearest `t`.
func periapsis_time(t: float) -> float:
	var n := mean_motion()
	var m := m0 + n * t
	var k := roundf(m / TAU)
	return t - (m - k * TAU) / n

## Position relative to the parent at time t.
func position(t: float) -> Vector3:
	var ea := eccentric(m0 + mean_motion() * t, e)
	var x := a * (cos(ea) - e)
	var y := a * sqrt(1.0 - e * e) * sin(ea)
	return _basis() * Vector3(x, 0.0, -y)

## Velocity relative to the parent at time t.
func velocity(t: float) -> Vector3:
	var n := mean_motion()
	var ea := eccentric(m0 + n * t, e)
	var de := n / (1.0 - e * cos(ea))
	var vx := -a * sin(ea) * de
	var vy := a * sqrt(1.0 - e * e) * cos(ea) * de
	return _basis() * Vector3(vx, 0.0, -vy)

## Points round the whole orbit (for drawing it), relative to the parent.
func points(count := 128) -> PackedVector3Array:
	var out := PackedVector3Array()
	var b := _basis()
	for i in count + 1:
		var ea := TAU * float(i) / count
		out.append(b * Vector3(a * (cos(ea) - e), 0.0, -a * sqrt(1.0 - e * e) * sin(ea)))
	return out

## The conic through a state (r, v) about a body of `gm_`: periapsis and
## apoapsis distances (apoapsis INF when unbound), and the eccentricity.
static func apsides(r: Vector3, v: Vector3, gm_: float) -> Dictionary:
	var h := r.cross(v)
	var ev := v.cross(h) / gm_ - r.normalized()
	var ecc := ev.length()
	var energy := v.length_squared() / 2.0 - gm_ / r.length()
	var p := h.length_squared() / gm_
	var peri_d := p / (1.0 + ecc)
	var apo_d := INF if ecc >= 1.0 or energy >= 0.0 else p / (1.0 - ecc)
	return {"peri": peri_d, "apo": apo_d, "e": ecc, "dir": ev.normalized() if ecc > 1e-6 else r.normalized()}
