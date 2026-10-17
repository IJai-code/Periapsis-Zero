class_name ReachBody
extends RefCounted
## One body of the Reach: its size, its pull and where its rail runs.

var key := ""
var title := ""
var radius := 100.0
## Gravitational parameter, m^3/s^2 (surface gravity is gm / radius^2).
var gm := 1.0
## Sphere of influence: inside it only this body pulls.
var soi := 0.0
## Top of the air (0 for none), and whether it is breathable.
var atmo := 0.0
var air := false
## Sea level as a radius (0 for none).
var sea := 0.0
## The rail about the Lantern (null for the Lantern itself).
var orbit: Orbit
## The atmosphere's colour by day and at dusk, for the sky shader.
var sky_day := Color(0.36, 0.58, 1.0)
var sky_dusk := Color(1.0, 0.45, 0.2)
## Drawn as a dot of this colour on the map.
var tint := Color(1, 1, 1)
## The node it is drawn under (set by the system).
var node: Node3D

func surface_gravity() -> float:
	return gm / (radius * radius)

static func make(key_: String, title_: String, radius_: float, g: float, soi_: float, orbit_: Orbit) -> ReachBody:
	var b := ReachBody.new()
	b.key = key_
	b.title = title_
	b.radius = radius_
	b.gm = g * radius_ * radius_
	b.soi = soi_
	b.orbit = orbit_
	return b
