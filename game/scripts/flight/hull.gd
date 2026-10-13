class_name Hull
extends Node3D
## Anything that can be shot: a ship or the Aster. Damage goes through three
## layers, as on any real warship: the shield (it comes back), the armour
## (it does not) and the structure (`integrity`; at zero the ship is gone).
## Bolts and missiles find these through the "hull" group; the overview
## lists them through "overview".

signal damaged(amount: float)
signal died

@export var team := "hollow"
## For the overview and the target panel.
var display_name := "Unknown contact"
var ship_class := "Frigate"
var radius := 8.0
var alive := true
var shield := 0.0
var max_shield := 0.0
var armor := 0.0
var max_armor := 0.0
var integrity := 100.0
var max_integrity := 100.0
## Below this the structure will not go: the prologue never kills the player.
var floor_integrity := 0.0
var velocity := Vector3.ZERO
## Where the last hit came from, for the damage indicator.
var last_from := Vector3.INF
## The ship's model, which breaks apart on death (Fx.shatter).
var body: Node3D
var _since_hit := 99.0
var _trail: CPUParticles3D

func _enter_tree() -> void:
	add_to_group("hull")
	add_to_group("overview")

## A round solid body the player's ship cannot fly through (small ships;
## big ones collide by their real shape, Surfaces.collide). Layer 2, so
## gunfire tests these by radius and only the rest of the world by ray.
func make_solid(r: float) -> void:
	var b := AnimatableBody3D.new()
	b.sync_to_physics = false
	b.collision_layer = 2
	b.collision_mask = 0
	var cs := CollisionShape3D.new()
	var sp := SphereShape3D.new()
	sp.radius = r
	cs.shape = sp
	b.add_child(cs)
	add_child(b)

## The layer a hit of this size lands on now: "shield", "armor" or "hull".
func layer() -> String:
	if shield > 0.5:
		return "shield"
	if armor > 0.5:
		return "armor"
	return "hull"

## Take damage at a world point, optionally from a world point (the shooter).
func hit(amount: float, at: Vector3, from := Vector3.INF) -> void:
	if not alive:
		return
	_since_hit = 0.0
	last_from = from
	var left := amount
	if shield > 0.0:
		var take := minf(shield, left)
		shield -= take
		left -= take
		# The shield's own flare says it; sparks are for bare metal.
		Fx.shield_hit(self, radius * 1.15, at)
	if left > 0.0 and armor > 0.0:
		var take := minf(armor, left)
		armor -= take
		left -= take
		Fx.sparks(get_parent(), at)
	elif left > 0.0:
		Fx.sparks(get_parent(), at, Color(5, 2.2, 0.8))
	integrity = maxf(integrity - left, floor_integrity)
	if team != "player":
		Fx.hit_flash(body)
	damaged.emit(amount)
	# Badly hurt ships burn and smoke.
	if integrity < max_integrity * 0.5 and _trail == null and radius < 30.0:
		_trail = Fx.trail(self, integrity < max_integrity * 0.3)
	if integrity <= 0.0:
		alive = false
		died.emit()

func regenerate(dt: float, delay: float, rate: float) -> void:
	_since_hit += dt
	if _since_hit > delay:
		shield = minf(max_shield, shield + rate * dt)

## Fractions for the HUD's three rings.
func fractions() -> Vector3:
	return Vector3(shield / max_shield if max_shield > 0.0 else 0.0,
		armor / max_armor if max_armor > 0.0 else 0.0,
		integrity / max_integrity)

## A ship model from art/godot/ships.py (game/art/ship-<kind>.glb), its
## named surfaces turned into real materials.
## `running`: a freighter under way burns its drive; a wreck does not.
static func model(kind: String, running := true) -> Node3D:
	var n: Node3D = load("res://art/ship-%s.glb" % kind).instantiate()
	Surfaces.apply(n)
	if running and kind.begins_with("freighter"):
		_drive_plumes(n)
	return n

## A freighter's three drive plumes, long and faint at cruise, from the
## glowing throats of its nozzles (art/godot/ships.py: the drive block).
static func _drive_plumes(n: Node3D) -> void:
	var glow := n.find_child("drive_glow", true, false) as MeshInstance3D
	if glow == null:
		return
	var xf := Transform3D.IDENTITY
	var at: Node = glow
	while at != n:
		xf = (at as Node3D).transform * xf
		at = at.get_parent()
	var throat := (xf * glow.get_aabb()).get_center().z
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/plume.gdshader")
	m.set_shader_parameter("power", 0.7)
	for p in [Vector2(0.0, 3.2), Vector2(-3.0, -2.2), Vector2(3.0, -2.2)]:
		var c := CylinderMesh.new()
		c.top_radius = 2.1
		c.bottom_radius = 0.7
		c.height = 38.0
		c.radial_segments = 16
		c.rings = 1
		c.material = m
		var mi := MeshInstance3D.new()
		mi.mesh = c
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.rotation_degrees = Vector3(-90, 0, 0)
		mi.position = Vector3(p.x, p.y, throat + 0.5 + c.height / 2.0)
		# Light, not hull: Surfaces.collide leaves it out.
		mi.set_meta("plume", true)
		n.add_child(mi)

## Break apart: the model's pieces fly, a fireball where it was.
func destroy(blast := 9.0, force := 30.0) -> void:
	alive = false
	remove_from_group("overview")
	Fx.explode(get_parent(), global_position, blast)
	if body:
		Fx.shatter(get_parent(), body, velocity, force)
		body = null
