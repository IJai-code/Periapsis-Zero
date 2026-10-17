class_name ReachSystem
extends Node3D
## The Reach in motion: every body on its rail round the Lantern, the loop's
## clock, gravity, and the frame the world is drawn in.
##
## The frame: the body whose sphere of influence holds the focus (the player
## or their ship) sits still at the world's origin and everything else moves
## round it. Inside a body's sphere only that body pulls; outside every
## sphere, only the Lantern (patched conics). Crossing a boundary shifts
## every dynamic object (group "reach_dynamic", `frame_shift(dp, dv)`) into
## the new frame, position and velocity, so nothing jumps.

const LOOP := 1320.0
const STAR_GM := 7.87e6
const STAR_RADIUS := 600.0

signal frame_will_change(from: String, to: String)
signal frame_changed(from: String, to: String)

## Seconds since the player woke.
var t := 0.0
var bodies := {}
var order: Array[String] = []
var ref := "lantern"
var focus: Node3D
## Extra pull toward the Lantern, m/s^2, while it collapses.
var pull := 0.0
## Rails stop while the loop resets or a cutscene holds time.
var running := true

static func define() -> Array:
	var out := []
	var star := ReachBody.new()
	star.key = "lantern"
	star.title = "The Lantern"
	star.radius = STAR_RADIUS
	star.gm = STAR_GM
	star.soi = INF
	star.tint = Color(1.0, 0.72, 0.4)
	out.append(star)
	var phantom := ReachBody.make("phantom", "The Phantom", 70.0, 2.0, 260.0, Orbit.make(STAR_GM, 2900.0, 0.0, 1.0, 0.0, 0.05))
	phantom.tint = Color(0.62, 0.55, 0.85)
	out.append(phantom)
	var hearth := ReachBody.make("hearthstone", "Hearthstone", 280.0, 8.5, 1600.0, Orbit.make(STAR_GM, 4600.0, 0.02, 0.0))
	hearth.atmo = 420.0
	hearth.air = true
	hearth.sea = -3.0
	hearth.tint = Color(0.45, 0.66, 0.38)
	out.append(hearth)
	var ash := ReachBody.make("ashfall", "Ashfall", 170.0, 4.5, 900.0, Orbit.make(STAR_GM, 7300.0, 0.05, 2.4, 0.6, 0.04))
	ash.tint = Color(0.62, 0.6, 0.58)
	out.append(ash)
	var verd := ReachBody.make("verdance", "Verdance", 440.0, 9.0, 2600.0, Orbit.make(STAR_GM, 10800.0, 0.03, 4.2, 1.1, -0.03))
	verd.atmo = 660.0
	verd.air = true
	verd.sea = -4.0
	verd.sky_day = Color(0.42, 0.7, 0.86)
	verd.sky_dusk = Color(1.0, 0.55, 0.3)
	verd.tint = Color(0.3, 0.72, 0.5)
	out.append(verd)
	# The Wanderer: a comet whose periapsis grazes the Lantern at 20:30.
	var peri_r := 1150.0
	var apo_r := 13500.0
	var a := (peri_r + apo_r) / 2.0
	var e := (apo_r - peri_r) / (apo_r + peri_r)
	var n := sqrt(STAR_GM / (a * a * a))
	var comet := ReachBody.make("wanderer", "The Wanderer", 90.0, 1.5, 300.0, Orbit.make(STAR_GM, a, e, -n * 1230.0, 2.2, 0.12, 0.4))
	comet.tint = Color(0.7, 0.88, 1.0)
	out.append(comet)
	return out

func _init() -> void:
	for b: ReachBody in define():
		bodies[b.key] = b
		order.append(b.key)
		var n := Node3D.new()
		n.name = b.key
		b.node = n
		add_child(n)

func body(key: String) -> ReachBody:
	return bodies[key]

## Position relative to the Lantern at time `at`.
func helio(key: String, at := -1.0) -> Vector3:
	if key == "lantern":
		return Vector3.ZERO
	return (bodies[key] as ReachBody).orbit.position(t if at < 0.0 else at)

func helio_vel(key: String, at := -1.0) -> Vector3:
	if key == "lantern":
		return Vector3.ZERO
	return (bodies[key] as ReachBody).orbit.velocity(t if at < 0.0 else at)

## Where a body is in the world now.
func world(key: String) -> Vector3:
	return (bodies[key] as ReachBody).node.position

## The velocity of a body in the world frame now.
func world_vel(key: String) -> Vector3:
	return helio_vel(key) - helio_vel(ref)

## How fast the loop's clock runs (sleeping by a fire runs it fast; the
## worlds ride their rails, nothing else hurries).
var warp := 1.0

func _physics_process(dt: float) -> void:
	if running:
		t += dt * warp
	place()
	_check_frame()

func place() -> void:
	var origin := helio(ref)
	for key in order:
		(bodies[key] as ReachBody).node.position = helio(key) - origin

## Gravity at a point of the world, m/s^2.
func gravity(at: Vector3) -> Vector3:
	var b: ReachBody = bodies[ref]
	var r := at - b.node.position
	var d := maxf(r.length(), b.radius * 0.5)
	var g := -r / maxf(r.length(), 0.001) * b.gm / (d * d)
	if pull > 0.0:
		var s := world("lantern") - at
		g += s / maxf(s.length(), 1.0) * pull
	return g

## The body whose gravity rules at a point (the frame's body).
func ruling() -> ReachBody:
	return bodies[ref]

## Height above a body's mean radius, and the up there.
func up_at(at: Vector3) -> Vector3:
	var r := at - (bodies[ref] as ReachBody).node.position
	return r.normalized() if r.length() > 0.001 else Vector3.UP

## The body nearest a point by its sphere (for HUDs and the map).
func nearest(at: Vector3) -> ReachBody:
	var best: ReachBody = bodies["lantern"]
	var best_k := INF
	for key in order:
		var b: ReachBody = bodies[key]
		var k := (at - b.node.position).length() - b.radius
		if k < best_k:
			best_k = k
			best = b
	return best

func _check_frame() -> void:
	if not focus or not is_instance_valid(focus):
		return
	var p := focus.global_position
	if ref == "lantern":
		var best := ""
		var best_k := 1.0
		for key in order:
			if key == "lantern":
				continue
			var b: ReachBody = bodies[key]
			var k := p.distance_to(b.node.position) / b.soi
			if k < best_k:
				best_k = k
				best = key
		if best != "":
			switch(best)
	elif p.length() > (bodies[ref] as ReachBody).soi * 1.06:
		switch("lantern")

## Move the world into another body's frame.
func switch(to: String) -> void:
	if to == ref:
		return
	frame_will_change.emit(ref, to)
	var dp := helio(ref) - helio(to)
	var dv := helio_vel(ref) - helio_vel(to)
	var from := ref
	ref = to
	place()
	for key in order:
		(bodies[key] as ReachBody).node.reset_physics_interpolation()
	for n in get_tree().get_nodes_in_group("reach_dynamic"):
		if n.has_method("frame_shift"):
			n.frame_shift(dp, dv)
	frame_changed.emit(from, to)

## Start the loop again: the clock to zero, the frame to `home`.
func reset(home: String) -> void:
	t = 0.0
	pull = 0.0
	running = true
	ref = home
	place()
	for key in order:
		(bodies[key] as ReachBody).node.reset_physics_interpolation()
