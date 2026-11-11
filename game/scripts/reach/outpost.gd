class_name Outpost
extends Node3D
## Gather and build. Every world carries ore: ferrite in its rock, lumen
## where the light pools, resin where things grow. The cutter (hold the left
## mouse on a deposit) takes it into the pack; B opens the build kit, and
## what you build stands where you put it, on any world, through every loop
## and every session. The loop takes the day back. It does not take the work.
##
## Models: art/game-outpost/build.py (Blender) into art/outpost/.

const ORES := ["ferrite", "lumen", "resin"]
const ORE_NAMES := {"ferrite": "Ferrite", "lumen": "Lumen", "resin": "Resin"}
const ORE_COLORS := {"ferrite": Color(1.0, 0.55, 0.25), "lumen": Color(0.45, 0.92, 1.0), "resin": Color(1.0, 0.78, 0.3)}
## What a deposit gives before it is spent (it grows back with the loop).
const YIELD := 5
const CUT_TIME := 0.42
## The kit: [name, model, cost, what it is for].
const KIT := [
	["Lamp", "lamp", {"ferrite": 1, "lumen": 1}, "a light that stays lit"],
	["Beacon", "beacon", {"ferrite": 4, "lumen": 1}, "marks this place on the visor, from anywhere on the world"],
	["Hab", "hab", {"ferrite": 10, "lumen": 2, "resin": 4}, "air, power and patching at its lock"],
	["Landing pad", "pad", {"ferrite": 8, "lumen": 2}, "a lit, level place to set the Kestrel down"],
	["Extractor", "extractor", {"ferrite": 6, "lumen": 3}, "drills ferrite by itself, every loop"],
	["Deck", "deck", {"ferrite": 2}, "a platform; decks join edge to edge"],
	["Wall", "wall", {"ferrite": 2}, "stands along a deck's edge"],
	["Stairs", "stairs", {"ferrite": 1}, "up to a deck"],
	["Crate", "crate", {"ferrite": 1}, "a place to sit, a thing to stack"],
]
const MAX_PIECES := 90
const DEPOSITS := 34
const REACH := 14.0

var reach: Node
## What is carried: ore -> units. Kept in the save.
var pack := {"ferrite": 0, "lumen": 0, "resin": 0}
## Everything built: {k: kit index, w: world, p: Vector3 (in the world's
## own space), q: Quaternion}.
var built: Array = []
var building := false
## Units cut since the game started (the checks read it).
var cut_total := 0

var _world := ""
var _root: Node3D
var _deposits: Array = []
## Units already taken this loop: "world:index" -> n.
var _taken := {}
var _hopper_taken := {}
var _nodes: Array = []
var _pick := 0
var _turn := 0.0
var _ghost: Node3D
var _ghost_kind := -1
var _ghost_ok := false
var _ghost_xf := Transform3D.IDENTITY
var _ghost_mat: StandardMaterial3D
var _aim: Node3D
var _cut := 0.0
var _beam: MeshInstance3D
var _beam_mat: StandardMaterial3D
var _sparks: CPUParticles3D
var _tool: Node3D
var _hum: AudioStreamPlayer
var _ui: CanvasLayer
var _pack_label: Label
var _pack_fade := 0.0
var _panel: PanelContainer
var _rows: Array = []
var _what: Label
var _note: Label
var _lights_t := 0.0
var _hinted := false
var _ray: PhysicsRayQueryParameters3D

# --- The save ---------------------------------------------------------------

func _ready() -> void:
	var p = Flow.progress("reach_pack", {})
	if p is Dictionary:
		for k in ORES:
			pack[k] = int(p.get(k, 0))
	var b = Flow.progress("reach_built", [])
	if b is Array:
		for r in b:
			if r is Array and r.size() == 9:
				built.append({"k": int(r[0]), "w": String(r[1]), "p": Vector3(r[2], r[3], r[4]), "q": Quaternion(r[5], r[6], r[7], r[8])})
	_hinted = bool(Flow.progress("reach_build_hint", false))
	_make_ui()
	_make_tool()

## Off for the capture beats, which must not write into anyone's save.
var saving := true

func _save() -> void:
	if not saving:
		return
	Flow.set_progress("reach_pack", pack)
	var out := []
	for r in built:
		var p: Vector3 = r.p
		var q: Quaternion = r.q
		out.append([r.k, r.w, p.x, p.y, p.z, q.x, q.y, q.z, q.w])
	Flow.set_progress("reach_built", out)

## A new morning: the ore is back in the ground, the hoppers start again.
func new_loop() -> void:
	_taken.clear()
	_hopper_taken.clear()
	_world = ""

static func can_afford(have: Dictionary, cost: Dictionary) -> bool:
	for k in cost:
		if int(have.get(k, 0)) < int(cost[k]):
			return false
	return true

static func cost_text(cost: Dictionary) -> String:
	var parts := []
	for k in ORES:
		if cost.has(k):
			parts.append("%d %s" % [cost[k], ORE_NAMES[k].to_lower()])
	return ", ".join(parts)

# --- The world underfoot ------------------------------------------------------

## Where a world's ore lies: the same places every loop. Half of it within
## a walk of where people are, the rest wherever there is ground above the sea.
static func lodes(b: ReachBody) -> Array:
	var out := []
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(b.key) + 9
	var homes := []
	for m in Worlds.landmarks(b.key):
		homes.append(Worlds.place(b, m).origin.normalized())
	var tries := 0
	while out.size() < DEPOSITS and tries < 400:
		tries += 1
		var d := Vector3(rng.randfn(), rng.randfn(), rng.randfn()).normalized()
		if not homes.is_empty() and out.size() < DEPOSITS / 2:
			var home: Vector3 = homes[out.size() % homes.size()]
			var side := home.cross(d).normalized()
			d = home.rotated(side, rng.randf_range(26.0, 150.0) / b.radius)
		var h := Worlds.height(b.key, d, b.radius)
		if b.sea != 0.0 and h < b.sea + 0.6:
			continue
		var kind := "ferrite"
		var roll := rng.randf()
		if b.air:
			kind = "resin" if roll < 0.36 else ("lumen" if roll < 0.52 else "ferrite")
		else:
			kind = "lumen" if roll < 0.4 else "ferrite"
		out.append({"d": d, "h": h, "kind": kind, "turn": rng.randf() * TAU, "size": rng.randf_range(0.85, 1.35)})
	return out

func _enter(b: ReachBody) -> void:
	if _root and is_instance_valid(_root):
		_root.queue_free()
	_deposits.clear()
	_nodes.clear()
	_world = b.key
	_root = null
	var host: Node3D = reach.planets.get(b.key, null)
	if host == null:
		return
	_root = Node3D.new()
	_root.name = "Outpost"
	host.add_child(_root)
	var i := 0
	for l: Dictionary in lodes(b):
		_deposit(b, l, i)
		i += 1
	for r: Dictionary in built:
		if r.w == b.key:
			_stand(r)

func _deposit(b: ReachBody, l: Dictionary, index: int) -> void:
	var n: Node3D = load("res://art/outpost/ore-%s.glb" % l.kind).instantiate()
	var up: Vector3 = l.d
	var toward := up.cross(Vector3.UP if absf(up.y) < 0.9 else Vector3.RIGHT).rotated(up, l.turn)
	n.transform = Transform3D(Site.upright(up, toward), up * (b.radius + l.h - 0.12))
	_root.add_child(n)
	# A rock's shadow is not missed; its draw into the shadow map is. And
	# past 150 m a deposit is a speck: not drawn at all.
	_cheap(n, false, 150.0)
	var u := Usable.sphere("", 1.0)
	u.position = Vector3(0, 0.45, 0)
	u.reach = 4.2
	u.set_meta("lode", index)
	n.add_child(u)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var s := SphereShape3D.new()
	s.radius = 0.55
	cs.shape = s
	cs.position = Vector3(0, 0.2, 0)
	body.add_child(cs)
	n.add_child(body)
	var d := {"node": n, "use": u, "kind": l.kind, "index": index, "size": l.size}
	_deposits.append(d)
	_dress(d)

func _left(d: Dictionary) -> int:
	return YIELD - int(_taken.get("%s:%d" % [_world, d.index], 0))

## A deposit shows what is left in it: cut down, it sinks toward bare rock.
func _dress(d: Dictionary) -> void:
	var left := _left(d)
	var u: Usable = d.use
	u.prompt = ("Hold the left mouse: cut %s" % String(ORE_NAMES[d.kind]).to_lower()) if left > 0 else ""
	(d.node as Node3D).scale = Vector3.ONE * float(d.size) * lerpf(0.5, 1.0, float(left) / YIELD)

# --- What is built ------------------------------------------------------------

func _stand(r: Dictionary) -> Node3D:
	var kit: Array = KIT[r.k]
	var n: Node3D = load("res://art/outpost/%s.glb" % kit[1]).instantiate()
	n.transform = Transform3D(Basis(r.q as Quaternion), r.p as Vector3)
	_root.add_child(n)
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).create_trimesh_collision()
	for sb in n.find_children("*", "StaticBody3D", true, false):
		sb.set_meta("built", r)
	n.set_meta("built", r)
	_nodes.append(n)
	# The big pieces throw shadows; the small ones would only add draws.
	_cheap(n, String(kit[1]) in ["hab", "pad", "beacon", "extractor", "deck", "wall"], 420.0)
	match String(kit[1]):
		"lamp":
			_light(n, Vector3(0, 2.36, 0), Color(1.0, 0.72, 0.4), 1.6, 11.0)
		"beacon":
			_light(n, Vector3(0, 5.2, 0), Color(0.5, 0.88, 1.0), 1.2, 9.0)
		"pad":
			_light(n, Vector3(0, 2.2, 0), Color(0.7, 0.86, 1.0), 1.3, 13.0)
		"hab":
			_light(n, Vector3(0, 1.4, 4.2), Color(1.0, 0.74, 0.44), 1.5, 9.0)
			var u := Usable.box("Step into the lock: air, power and patching", Vector3(1.4, 2.0, 0.9))
			u.position = Vector3(0, 1.1, 3.9)
			u.reach = 4.0
			n.add_child(u)
			u.used.connect(_rest)
		"extractor":
			var u2 := Usable.box("The hopper is empty", Vector3(1.0, 0.9, 0.9))
			u2.position = Vector3(1.15, 0.6, 0)
			u2.reach = 4.0
			u2.set_meta("hopper", r)
			n.add_child(u2)
			u2.used.connect(func(_by): _empty(r))
	return n

## Anti-lag: whether a piece draws into the shadow map, and how far off it
## stops being drawn.
func _cheap(n: Node3D, shadows: bool, far: float) -> void:
	for mi: MeshInstance3D in n.find_children("*", "MeshInstance3D", true, false):
		if not shadows:
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visibility_range_end = far
		mi.visibility_range_end_margin = 10.0

func _light(on: Node3D, at: Vector3, c: Color, energy: float, far: float) -> void:
	var l := OmniLight3D.new()
	l.position = at
	l.light_color = c
	l.light_energy = energy
	l.omni_range = far
	l.shadow_enabled = false
	l.visible = false
	l.add_to_group("outpost_light")
	on.add_child(l)

func _rest(by: Node) -> void:
	var p := by as Explorer
	if p == null:
		return
	p.oxygen = Explorer.OXY_MAX
	p.fuel = Explorer.FUEL_MAX
	p.health = 100.0
	Sfx.play("click", -6.0, 0.7)
	if reach.hud:
		reach.hud.toast("Air, power and suit made whole")

## What an extractor has drilled so far this loop (one every 24 s, 14 at most).
func hopper(r: Dictionary) -> int:
	var t: float = reach.system.t
	return clampi(int(t / 24.0), 0, 14) - int(_hopper_taken.get(built.find(r), 0))

func _empty(r: Dictionary) -> void:
	var n := hopper(r)
	if n <= 0:
		if reach.hud:
			reach.hud.toast("The hopper is empty. It fills as the loop goes on")
		return
	var i := built.find(r)
	_hopper_taken[i] = int(_hopper_taken.get(i, 0)) + n
	gain("ferrite", n)
	Sfx.play("click", -6.0, 1.2)

func gain(kind: String, n: int) -> void:
	pack[kind] = int(pack[kind]) + n
	cut_total += n
	_save()
	_show_pack()
	if not _hinted and int(pack.ferrite) >= 2:
		_hinted = true
		Flow.set_progress("reach_build_hint", true)
		if reach.hud:
			reach.hud.hint("B opens the build kit. What you build stays through every loop.", 14.0)

## Stand a new piece: pays for it, keeps it. False when it cannot be done.
func place(kind: int, xf: Transform3D) -> bool:
	var kit: Array = KIT[kind]
	if not can_afford(pack, kit[2]) or built.size() >= MAX_PIECES or _root == null or not is_instance_valid(_root):
		return false
	for k in kit[2]:
		pack[k] = int(pack[k]) - int(kit[2][k])
	var local := _root.global_transform.affine_inverse() * xf
	var r := {"k": kind, "w": _world, "p": local.origin, "q": local.basis.orthonormalized().get_rotation_quaternion()}
	built.append(r)
	_stand(r)
	_save()
	_show_pack()
	Season.note("built")
	return true

## Take a piece down again: everything it cost comes back.
func dismantle(r: Dictionary) -> void:
	var i := built.find(r)
	if i < 0:
		return
	for k in KIT[r.k][2]:
		pack[k] = int(pack[k]) + int(KIT[r.k][2][k])
	built.remove_at(i)
	_hopper_taken.clear()
	for n in _nodes:
		if is_instance_valid(n) and n.get_meta("built") == r:
			n.queue_free()
	_save()
	_show_pack()

## The beacons and habs on this world, for the marks on the visor.
func pins() -> Array:
	var out := []
	var count := 0
	for node in _nodes:
		if not is_instance_valid(node):
			continue
		var n3 := node as Node3D
		var kind := String(KIT[node.get_meta("built").k][1])
		if kind == "beacon":
			count += 1
			out.append({"at": n3.global_position + n3.global_basis.y * 5.4, "label": "Beacon %d" % count})
		elif kind == "hab":
			out.append({"at": n3.global_position + n3.global_basis.y * 4.0, "label": "Hab"})
	return out

## A small outpost stood in front of someone (the "build" beat).
func demo(p: Explorer) -> void:
	if _root == null or not is_instance_valid(_root):
		_enter(reach.system.ruling())
	var up := p.global_basis.y
	var fwd := -p.global_basis.z
	var right := p.global_basis.x
	var c := _root.global_position
	var r: float = reach.system.ruling().radius
	var lay := [[2, 16.0, 0.0], [1, 12.0, -9.0], [4, 13.0, 9.0], [0, 8.0, -4.0], [0, 8.0, 4.0], [5, 22.0, 12.0], [8, 9.0, 6.5]]
	for l: Array in lay:
		var ahead: float = l[1]
		var across: float = l[2]
		var d: Vector3 = (p.global_position + fwd * ahead + right * across - c).normalized()
		var local_d: Vector3 = (_root.global_transform.affine_inverse().basis * d).normalized()
		var at: Vector3 = c + d * (r + Worlds.height(_world, local_d, r))
		place(int(l[0]), Transform3D(Site.upright(d, -fwd), at))

# --- Each frame ---------------------------------------------------------------

func _process(dt: float) -> void:
	if reach == null or reach.system == null:
		return
	var b: ReachBody = reach.system.ruling()
	if b.key != _world and reach.planets.has(b.key):
		_enter(b)
	var p: Explorer = reach.player
	var on_foot: bool = p != null and p.enabled and not reach.talking and reach.ship != null and not reach.ship.piloted
	if building and not on_foot:
		_set_building(false)
	_mine(dt, p, on_foot and not building)
	if building:
		_aim_ghost(p)
	if _tool.visible and p != null:
		_tool.global_transform = p.camera.global_transform * Transform3D((Basis(Vector3.RIGHT, 0.05) * Basis(Vector3.UP, 0.06)).scaled(Vector3.ONE * 0.8), Vector3(0.3, -0.25, -0.72))
	_lights_t -= dt
	if _lights_t <= 0.0:
		_lights_t = 0.5
		var cam := get_viewport().get_camera_3d()
		if cam:
			for l: OmniLight3D in get_tree().get_nodes_in_group("outpost_light"):
				l.visible = l.global_position.distance_to(cam.global_position) < 60.0
		# The extractors' hoppers say what is in them.
		for node in _nodes:
			if is_instance_valid(node):
				for u in node.get_children():
					if u is Usable and u.has_meta("hopper"):
						var n := hopper(u.get_meta("hopper"))
						(u as Usable).prompt = ("Empty the hopper: %d ferrite" % n) if n > 0 else "The hopper is empty"
	_pack_fade = maxf(0.0, _pack_fade - dt)
	_pack_label.modulate.a = 1.0 if building else clampf(_pack_fade, 0.0, 1.0)

func _mine(dt: float, p: Explorer, can: bool) -> void:
	var d := {}
	if can and p.focus != null and p.focus.has_meta("lode") and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var i: int = p.focus.get_meta("lode")
		if i < _deposits.size() and _left(_deposits[i]) > 0:
			d = _deposits[i]
	var on := not d.is_empty()
	_tool.visible = on or building
	_beam.visible = on
	_sparks.emitting = on
	_hum.volume_db = lerpf(_hum.volume_db, (-15.0 + Flow.sfx_db()) if on else -80.0, minf(1.0, dt * 14.0))
	if not on:
		_cut = 0.0
		return
	var cam := p.camera
	var from := cam.global_position + cam.global_basis * Vector3(0.24, -0.2, -0.75)
	var rock := d.node as Node3D
	var to := rock.global_position + rock.global_basis.y.normalized() * 0.45
	var span := from.distance_to(to)
	var aim := Basis.looking_at((to - from).normalized(), cam.global_basis.y) * Basis(Vector3.RIGHT, -PI / 2.0)
	_beam.global_transform = Transform3D(aim.scaled_local(Vector3(1.0, span, 1.0)), (from + to) * 0.5)
	_beam_mat.emission = ORE_COLORS[d.kind]
	_beam_mat.albedo_color = ORE_COLORS[d.kind]
	_sparks.global_position = to
	_sparks.color = ORE_COLORS[d.kind]
	_cut += dt
	if _cut >= CUT_TIME:
		_cut = 0.0
		cut_once(d.index)
		Sfx.play("click", -10.0, 1.5 + randf() * 0.4)

## One unit off a deposit, as the cutter takes it.
func cut_once(index: int) -> bool:
	if index >= _deposits.size() or _left(_deposits[index]) <= 0:
		return false
	var d: Dictionary = _deposits[index]
	var key := "%s:%d" % [_world, d.index]
	_taken[key] = int(_taken.get(key, 0)) + 1
	_dress(d)
	gain(d.kind, 1)
	return true

# --- Building -----------------------------------------------------------------

func _input(e: InputEvent) -> void:
	if reach == null or reach.player == null or reach.ship == null:
		return
	var p: Explorer = reach.player
	if e is InputEventKey and e.pressed and not e.echo:
		var k: int = (e as InputEventKey).keycode
		if k == KEY_B and p.enabled and not reach.talking and not reach.ship.piloted:
			_set_building(not building)
			get_viewport().set_input_as_handled()
			return
		if not building:
			return
		if k >= KEY_1 and k <= KEY_9 and k - KEY_1 < KIT.size():
			_pick = k - KEY_1
			Sfx.play("click", -12.0, 1.2)
			_paint_panel()
			get_viewport().set_input_as_handled()
		elif k == KEY_R:
			_turn += PI / 8.0
			get_viewport().set_input_as_handled()
		elif k == KEY_X:
			if _aim != null and is_instance_valid(_aim):
				var r: Dictionary = _aim.get_meta("built")
				dismantle(r)
				Sfx.play("click", -6.0, 0.6)
				_say("%s taken down; its ore is back in the pack" % KIT[r.k][0])
			get_viewport().set_input_as_handled()
	elif building and e is InputEventMouseButton and e.pressed and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			_try_place()
			get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_turn += (PI / 8.0) * (1.0 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1.0)
			get_viewport().set_input_as_handled()

func _set_building(on: bool) -> void:
	building = on
	_panel.visible = on
	if _ghost and is_instance_valid(_ghost):
		_ghost.queue_free()
	_ghost = null
	_ghost_kind = -1
	_aim = null
	Sfx.play("click", -10.0, 1.0 if on else 0.8)
	if on:
		_paint_panel()

func _try_place() -> void:
	var kit: Array = KIT[_pick]
	if not _ghost_ok:
		_say("Nowhere to stand it there")
	elif not can_afford(pack, kit[2]):
		_say("Not enough ore: %s needs %s" % [kit[0], cost_text(kit[2])])
	elif built.size() >= MAX_PIECES:
		_say("The kit is spent: take something down first")
	elif place(_pick, _ghost_xf):
		Sfx.play("click", -4.0, 0.75)
		_say("%s built" % kit[0])
		_paint_panel()

func _say(t: String) -> void:
	_note.text = t
	_note.modulate.a = 1.0
	var tw := create_tween()
	tw.tween_interval(2.2)
	tw.tween_property(_note, "modulate:a", 0.0, 0.6)

## Where the chosen piece would stand: on the ground the view meets, upright
## on the world, turned by R; decks, walls and stairs join a deck near by.
func _aim_ghost(p: Explorer) -> void:
	if _ghost_kind != _pick:
		if _ghost and is_instance_valid(_ghost):
			_ghost.queue_free()
		_ghost = load("res://art/outpost/%s.glb" % KIT[_pick][1]).instantiate()
		_ghost_kind = _pick
		if _ghost_mat == null:
			_ghost_mat = StandardMaterial3D.new()
			_ghost_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			_ghost_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			_ghost_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		for mi in _ghost.find_children("*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).material_override = _ghost_mat
			(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_ghost)
	var cam := p.camera
	if _ray == null:
		_ray = PhysicsRayQueryParameters3D.new()
		_ray.collision_mask = 1
	_ray.from = cam.global_position
	_ray.to = cam.global_position - cam.global_basis.z * REACH
	_ray.exclude = [p.get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(_ray)
	_aim = null
	_ghost_ok = false
	if hit.is_empty() or _root == null or not is_instance_valid(_root):
		_ghost.visible = false
		return
	# Looking at something already built: X takes it down.
	var col: Object = hit.collider
	if col is Node and (col as Node).has_meta("built"):
		for n in _nodes:
			if is_instance_valid(n) and n.get_meta("built") == (col as Node).get_meta("built"):
				_aim = n
	var at: Vector3 = hit.position
	var up := (at - _root.global_position).normalized()
	var stand := Site.upright(up, cam.global_basis.z).rotated(up, _turn)
	var kind := String(KIT[_pick][1])
	var ok := (hit.normal as Vector3).dot(up) > 0.5 or _aim != null
	if kind in ["deck", "wall", "stairs"]:
		var near := _near_deck(at)
		if near != null:
			var snap := _join(kind, near, at)
			stand = snap.basis
			at = snap.origin
			ok = true
	_ghost.visible = true
	_ghost_xf = Transform3D(stand, at)
	_ghost.global_transform = _ghost_xf
	_ghost_ok = ok and at.distance_to(p.global_position) > 1.2
	var good := _ghost_ok and can_afford(pack, KIT[_pick][2])
	_ghost_mat.albedo_color = Color(0.4, 1.0, 0.75, 0.42) if good else Color(1.0, 0.35, 0.25, 0.4)

func _near_deck(at: Vector3) -> Node3D:
	var best: Node3D = null
	var bd := 7.5
	for n in _nodes:
		if is_instance_valid(n) and String(KIT[n.get_meta("built").k][1]) == "deck":
			var d := (n as Node3D).global_position.distance_to(at)
			if d < bd:
				bd = d
				best = n
	return best

## A piece fitted to a deck: in the deck's own squares (4 m), a wall on the
## nearest edge of the square looked at, stairs outside an edge facing in.
func _join(kind: String, deck: Node3D, at: Vector3) -> Transform3D:
	var l := deck.global_transform.affine_inverse() * at
	var cx := roundf(l.x / 4.0) * 4.0
	var cz := roundf(l.z / 4.0) * 4.0
	if kind == "deck":
		return deck.global_transform * Transform3D(Basis.IDENTITY, Vector3(cx, 0, cz))
	var ox := l.x - cx
	var oz := l.z - cz
	var quarter := 0
	var off := Vector3(0, 0, 2.0)
	if absf(ox) > absf(oz):
		quarter = 1 if ox > 0.0 else 3
		off = Vector3(2.0 * signf(ox), 0, 0)
	else:
		quarter = 0 if oz > 0.0 else 2
		off = Vector3(0, 0, 2.0 * signf(oz))
	var turn := Basis(Vector3.UP, quarter * PI / 2.0)
	if kind == "wall":
		return deck.global_transform * Transform3D(turn, Vector3(cx, 1.03, cz) + off)
	return deck.global_transform * Transform3D(turn * Basis(Vector3.UP, PI), Vector3(cx, 0, cz) + off)

# --- The cutter in the hand, and the kit on the visor ----------------------------

func _make_tool() -> void:
	_tool = load("res://art/outpost/cutter.glb").instantiate()
	_tool.visible = false
	add_child(_tool)
	_beam = MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = 0.012
	c.bottom_radius = 0.02
	c.height = 1.0
	c.radial_segments = 6
	c.rings = 1
	_beam.mesh = c
	_beam_mat = StandardMaterial3D.new()
	_beam_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_beam_mat.emission_enabled = true
	_beam_mat.emission_energy_multiplier = 4.0
	_beam.material_override = _beam_mat
	_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_beam.visible = false
	add_child(_beam)
	_sparks = CPUParticles3D.new()
	_sparks.amount = 26
	_sparks.lifetime = 0.5
	_sparks.emitting = false
	_sparks.direction = Vector3.UP
	_sparks.spread = 70.0
	_sparks.initial_velocity_min = 1.5
	_sparks.initial_velocity_max = 4.0
	_sparks.gravity = Vector3.ZERO
	var sm := SphereMesh.new()
	sm.radius = 0.02
	sm.height = 0.04
	sm.radial_segments = 4
	sm.rings = 2
	var smm := StandardMaterial3D.new()
	smm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smm.vertex_color_use_as_albedo = true
	sm.material = smm
	_sparks.mesh = sm
	add_child(_sparks)
	_hum = AudioStreamPlayer.new()
	_hum.stream = _cut_stream()
	_hum.volume_db = -80.0
	_hum.autoplay = true
	add_child(_hum)

## The cutter's note: a low buzz with an edge on it.
static func _cut_stream() -> AudioStreamWAV:
	var rate := 11025
	var n := rate
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var t := float(i) / rate
		var v := 0.5 * signf(sin(TAU * 110.0 * t)) * (0.6 + 0.4 * sin(TAU * 7.0 * t)) + 0.3 * sin(TAU * 220.0 * t) + 0.12 * sin(TAU * 1320.0 * t)
		data.encode_s16(i * 2, int(clampf(v * 0.5, -1.0, 1.0) * 20000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.data = data
	s.loop_mode = AudioStreamWAV.LOOP_FORWARD
	s.loop_end = n
	return s

func _make_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 6
	add_child(_ui)
	_pack_label = ReachStyle.label("", 20)
	_pack_label.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	_pack_label.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_pack_label.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_pack_label.position -= Vector2(28, 26)
	_pack_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_pack_label.modulate.a = 0.0
	_ui.add_child(_pack_label)
	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override("panel", ReachStyle.panel())
	_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER_RIGHT)
	_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	_panel.position.x -= 26
	_panel.visible = false
	_ui.add_child(_panel)
	var m := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		m.add_theme_constant_override("margin_" + side, 16)
	_panel.add_child(m)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 5)
	m.add_child(v)
	v.add_child(ReachStyle.title("Build kit", 26))
	for i in KIT.size():
		var l := ReachStyle.label("", 19)
		v.add_child(l)
		_rows.append(l)
	_what = ReachStyle.label("", 16, Color(0.8, 0.82, 0.86))
	_what.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_what.custom_minimum_size = Vector2(320, 44)
	v.add_child(_what)
	v.add_child(ReachStyle.label("Left mouse build   R or wheel turn\nX take down what you look at   B put the kit away", 15, Color(0.7, 0.74, 0.8)))
	_note = ReachStyle.label("", 18, Color(1.0, 0.86, 0.6))
	_note.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	_note.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_note.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_note.position.y -= 150
	_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_note.modulate.a = 0.0
	_ui.add_child(_note)
	_show_pack()
	_pack_fade = 0.0

func _show_pack() -> void:
	var parts := []
	for k in ORES:
		parts.append("%s %d" % [ORE_NAMES[k], pack[k]])
	_pack_label.text = "   ".join(parts)
	_pack_fade = 6.0
	if building:
		_paint_panel()

func _paint_panel() -> void:
	for i in KIT.size():
		var kit: Array = KIT[i]
		var l: Label = _rows[i]
		var can := can_afford(pack, kit[2])
		l.text = "%s%d  %s   %s" % ["> " if i == _pick else "   ", i + 1, kit[0], cost_text(kit[2])]
		l.add_theme_color_override("font_color", (Color(1.0, 0.86, 0.6) if i == _pick else ReachStyle.BONE) if can else Color(0.55, 0.56, 0.6))
	_what.text = "%s: %s.\n%d of %d pieces standing." % [KIT[_pick][0], KIT[_pick][3], built.size(), MAX_PIECES]
