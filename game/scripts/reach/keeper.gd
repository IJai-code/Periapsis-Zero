class_name Keeper
extends Node3D
## The Keeper: one of the machines that kept the Engine. It rode the Aster
## in her vault, guarding the core the Founders once carried off, and was
## thrown clear over Hearthstone the night she fell. It lies by the old
## mine, still warm. Mended (6 ferrite, 3 lumen: Outpost), it goes where you
## go: it hangs at your shoulder, says what it sees coming (sinking ash, the
## drones' light, thin air, rain, the star failing), puts itself between
## you and Rook's drones and strikes them dark, hauls you out of the ash,
## and closes your suit's wounds when things are quiet. It is of the
## Engine's make and outside time: it remembers every morning, as you do.
## Its story comes out where it matters (the Engine's door, the core).
##
## Model: art/game-keeper/build.py (Blender) into art/keeper/keeper.glb.

const COST := {"ferrite": 6, "lumen": 3}
const CALM := Color(0.35, 0.8, 1.0)
const WARY := Color(1.0, 0.7, 0.25)
const ANGRY := Color(1.0, 0.18, 0.08)
const STRIKE_EVERY := 2.6
const STRIKE_RANGE := 46.0
const STUN := 14.0

var reach: Node
## Mended and with you (kept in the ship's log as a fact).
var awake := false
## Told to wait where it is.
var waiting := false
## For the checks: warnings said, drones struck, hauls out of the ash.
var warned := 0
var struck := 0
var hauled := 0

var _model: Node3D
var _rings: Array[Node3D] = []
var _blades: Array[Node3D] = []
var _eye_mat: StandardMaterial3D
var _eye_light: OmniLight3D
var _use: Usable
var _t := 0.0
var _mood := 0.0          # 0 calm, 1 wary, 2 angry
var _mood_want := 0.0
var _said := {}           # warning -> when it may be said again (seconds of _t)
var _think := 0.0
var _strike := 0.0
var _haul := 0.0
var _world := ""
var _voice: AudioStreamPlayer3D
var _arc: MeshInstance3D
var _arc_t := 0.0
var _smoke: CPUParticles3D
var _was_piloted := false
var _noticed := false

func _ready() -> void:
	_model = load("res://art/keeper/keeper.glb").instantiate()
	add_child(_model)
	for n in ["ring_a", "ring_b"]:
		_rings.append(_model.find_child(n, true, false))
	for i in 4:
		_blades.append(_model.find_child("blade_%d" % i, true, false))
	var eye := _model.find_child("eye", true, false) as MeshInstance3D
	_eye_mat = StandardMaterial3D.new()
	_eye_mat.emission_enabled = true
	_eye_mat.albedo_color = CALM
	_eye_mat.emission = CALM
	_eye_mat.emission_energy_multiplier = 4.0
	if eye:
		eye.material_override = _eye_mat
	_eye_light = OmniLight3D.new()
	_eye_light.position = Vector3(0, 2.5, 0.3)
	_eye_light.omni_range = 7.0
	_eye_light.light_energy = 0.9
	_eye_light.shadow_enabled = false
	add_child(_eye_light)
	_use = Usable.box("", Vector3(1.6, 3.0, 1.6))
	_use.position = Vector3(0, 1.5, 0)
	_use.reach = 4.5
	add_child(_use)
	_use.used.connect(_used)
	_voice = AudioStreamPlayer3D.new()
	_voice.stream = _voice_stream()
	_voice.unit_size = 9.0
	_voice.max_distance = 70.0
	_voice.volume_db = -4.0
	add_child(_voice)
	_arc = MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.top_radius = 0.03
	c.bottom_radius = 0.05
	c.height = 1.0
	c.radial_segments = 5
	c.rings = 1
	var am := StandardMaterial3D.new()
	am.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	am.albedo_color = Color(0.7, 0.95, 1.0)
	c.material = am
	_arc.mesh = c
	_arc.top_level = true
	_arc.visible = false
	_arc.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_arc)
	_smoke = CPUParticles3D.new()
	_smoke.amount = 10
	_smoke.lifetime = 3.0
	_smoke.direction = Vector3.UP
	_smoke.spread = 12.0
	_smoke.gravity = Vector3(0, 0.3, 0)
	_smoke.initial_velocity_min = 0.3
	_smoke.initial_velocity_max = 0.7
	_smoke.scale_amount_min = 0.5
	_smoke.scale_amount_max = 1.2
	var q := QuadMesh.new()
	q.size = Vector2(0.7, 0.7)
	var qm := StandardMaterial3D.new()
	qm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	qm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	qm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	qm.albedo_color = Color(0.2, 0.2, 0.22, 0.25)
	q.material = qm
	_smoke.mesh = q
	_smoke.position = Vector3(0, 0.6, 0)
	add_child(_smoke)
	for mi: MeshInstance3D in _model.find_children("*", "MeshInstance3D", true, false):
		mi.visibility_range_end = 260.0
	awake = Lore.known("keep_mended")
	new_loop()

## A new morning. Mended, it is already at the fire when you wake (it
## remembers); not yet mended, it lies where it fell.
func new_loop() -> void:
	waiting = false
	_said.clear()
	_mood_want = 0.0
	_world = ""
	awake = Lore.known("keep_mended")
	_pose()

## Where it fell: beside the old mine's mouth, half into the ground.
func _wreck_xf() -> Transform3D:
	var planet := reach.planets.get("hearthstone") as Planet
	if planet == null:
		return Transform3D.IDENTITY
	var cave := Worlds.place(reach.system.bodies["hearthstone"], "cave")
	var home := Worlds.place(reach.system.bodies["hearthstone"], "village").origin
	var d0 := cave.origin.normalized()
	var toward := (home - cave.origin)
	toward = (toward - d0 * toward.dot(d0)).normalized()
	var side := d0.cross(toward).normalized()
	var d := (cave.origin + toward * 17.0 + side * 9.0).normalized()
	var r: float = reach.system.bodies["hearthstone"].radius
	var at := d * (r + Worlds.height("hearthstone", d, r))
	# Lying over on its side, sunk a little.
	var up := Site.upright(d, toward)
	return planet.global_transform * Transform3D(up * Basis(Vector3.RIGHT, 1.25) * Basis(Vector3.UP, 0.6), at + d * 0.25)

func _pose() -> void:
	if reach == null or reach.system == null:
		return
	if not awake:
		_use.prompt = "A fallen machine, still warm. Mend it (%s)" % Outpost.cost_text(COST)
		_smoke.emitting = true
		_set_eye(CALM, 0.35)
	else:
		_use.prompt = "Tell the Keeper to wait here"
		_smoke.emitting = false
		_set_eye(CALM, 4.0)

func _set_eye(c: Color, energy: float) -> void:
	_eye_mat.albedo_color = c
	_eye_mat.emission = c
	_eye_mat.emission_energy_multiplier = energy
	_eye_light.light_color = c
	_eye_light.light_energy = energy * 0.22

# --- Meeting it ---------------------------------------------------------------

func _used(_by: Node) -> void:
	if not awake:
		if not Lore.known("keep_found"):
			Lore.learn("keep_found")
			reach.hud.toast("SHIP LOG UPDATED")
		var out: Outpost = reach.outpost
		if out == null or not Outpost.can_afford(out.pack, COST):
			reach.hud.caption("A machine, not of any make you know, thrown down here the night you fell. Its light still turns, faintly. It could be mended: %s. (Ore lies in the rocks round here: hold the left mouse on a deposit to cut it.)" % Outpost.cost_text(COST), 9.0)
			return
		for k in COST:
			out.pack[k] = int(out.pack[k]) - int(COST[k])
		out._save()
		out._show_pack()
		mend()
		return
	waiting = not waiting
	_use.prompt = "Call the Keeper to follow" if waiting else "Tell the Keeper to wait here"
	say("I wait." if waiting else "I follow.", 0.0)

## Mended: it wakes, looks at you, and is yours (and you its).
func mend() -> void:
	awake = true
	Lore.learn("keep_mended")
	Season.note("keeper")
	_pose()
	Sfx.play("objective", -6.0)
	reach.hud.toast("SHIP LOG UPDATED")
	reach.hud.guide("The Keeper", "The machine rights itself and hangs in the air, a head taller than you, its light turning to find your face.\n\nIt will go where you go. It warns of what it sees coming, stands between you and the drones, and will not let the ash have you.\n\nLook at it and press E to have it wait or follow.", 18.0)
	say("You mended me. I keep what mends me.", 1.5)

## Its voice: a low two-note call, and words on the visor.
func say(text: String, delay := 0.0, seconds := 5.0) -> void:
	if delay > 0.0:
		await get_tree().create_timer(delay).timeout
	if not is_inside_tree():
		return
	_voice.pitch_scale = randf_range(0.92, 1.06)
	_voice.play()
	if reach and reach.hud:
		reach.hud.caption("THE KEEPER   %s" % text, seconds)

func _warn(key: String, text: String, again := 45.0, mood := 1.0) -> bool:
	if float(_said.get(key, -1.0)) > _t:
		return false
	_said[key] = _t + again
	warned += 1
	_mood_want = maxf(_mood_want, mood)
	say(text)
	return true

# --- Each frame ---------------------------------------------------------------

func _process(dt: float) -> void:
	if reach == null or reach.system == null or reach.player == null:
		return
	_t += dt
	var p: Explorer = reach.player
	var piloted: bool = reach.ship != null and reach.ship.piloted
	if not awake:
		# Where it fell, only while Hearthstone is underfoot.
		visible = reach.system.ruling().key == "hearthstone"
		if visible:
			global_transform = _wreck_xf()
			_eye_mat.emission_energy_multiplier = 0.25 + 0.2 * sin(_t * 1.3)
			# Walking by: it is worth a look.
			if not _noticed and not Lore.known("keep_found") and p.enabled and not piloted and global_position.distance_to(p.global_position) < 40.0:
				_noticed = true
				reach.hud.caption("Something lies smoking in the grass beside the old mine, a light turning in it.", 6.0)
		return
	# Aboard with you while you fly; beside you when you step down.
	if piloted:
		visible = false
		_was_piloted = true
		return
	var b: ReachBody = reach.system.ruling()
	var up: Vector3 = reach.system.up_at(p.global_position)
	if _was_piloted or b.key != _world or not visible or (not waiting and global_position.distance_to(p.global_position) > 30.0):
		_was_piloted = false
		_world = b.key
		visible = true
		global_position = _ground(p.global_position + p.global_basis.x * 2.2 + p.global_basis.z * 1.5, up)
		waiting = false
		_use.prompt = "Tell the Keeper to wait here"
	_move(dt, p, up)
	_animate(dt, p, up)
	_think -= dt
	if _think <= 0.0:
		_think = 0.4
		_watch(p, b, up)
	_fight(dt, p)
	_rescue(dt, p)

## A point on whatever is underfoot there (ground, decks, floors).
func _ground(at: Vector3, up: Vector3) -> Vector3:
	var q := PhysicsRayQueryParameters3D.create(at + up * 4.0, at - up * 30.0, 1)
	if reach.player:
		q.exclude = [reach.player.get_rid()]
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	return hit.position if not hit.is_empty() else at

func _move(dt: float, p: Explorer, up: Vector3) -> void:
	var want := global_position
	if not waiting:
		# At your right shoulder, a step behind; between you and a drone
		# that has seen you.
		want = p.global_position + p.global_basis.x * 2.0 + p.global_basis.z * 1.6
		var foe := _foe(p)
		if foe:
			var to := (foe.global_position - p.global_position)
			to = (to - up * to.dot(up)).normalized()
			want = p.global_position + to * 3.2
	var far := global_position.distance_to(want)
	if far > 0.6:
		var speed := clampf(far * 2.2, 1.5, 13.0)
		var next := global_position.move_toward(want, speed * dt)
		global_position = global_position.lerp(_ground(next, up), minf(1.0, dt * 12.0))

func _animate(dt: float, p: Explorer, up: Vector3) -> void:
	_mood = move_toward(_mood, _mood_want, dt * 1.5)
	_mood_want = move_toward(_mood_want, 0.0, dt * 0.12)
	var c := CALM.lerp(WARY, clampf(_mood, 0.0, 1.0)).lerp(ANGRY, clampf(_mood - 1.0, 0.0, 1.0))
	_set_eye(c, 4.0 + _mood * 1.5 + 0.6 * sin(_t * 2.0))
	# Upright on the world, its light toward you (or what it fights).
	var look := p.global_position + up * 1.5
	var foe := _foe(p)
	if foe:
		look = foe.global_position
	var to := look - global_position
	to -= up * to.dot(up)
	if to.length() > 0.05:
		var facing := Site.upright(up, to.normalized())
		global_basis = global_basis.slerp(facing, minf(1.0, dt * 4.0)).orthonormalized()
	# It hangs in the air and breathes; the rings turn, faster when roused.
	_model.position = Vector3(0, 0.45 + 0.09 * sin(_t * 1.4), 0)
	if _rings[0]:
		_rings[0].rotate_y(dt * (0.5 + _mood * 1.6))
	if _rings[1]:
		_rings[1].rotate_y(-dt * (0.8 + _mood * 2.2))
	# Blades held close; spread when roused.
	for i in _blades.size():
		var bl := _blades[i]
		if bl:
			var a := TAU * i / 4.0 + PI / 4.0
			var axis := Vector3(-sin(a), 0, -cos(a))
			bl.basis = Basis(axis.normalized(), -0.5 * clampf(_mood - 0.6, 0.0, 1.4))
	if _arc_t > 0.0:
		_arc_t -= dt
		_arc.visible = _arc_t > 0.0

## What it sees coming, said once and again only after a while.
func _watch(p: Explorer, b: ReachBody, up: Vector3) -> void:
	var at := p.global_position
	# Sinking ash ahead.
	var ahead := at - p.global_basis.z * 7.0
	if AshSink.pull(ahead) > 0.0 and AshSink.pull(at) <= 0.0:
		_warn("ash", "Hazard. The ground ahead swallows. Go round the embers.", 20.0)
	# The drones: their light near, before they have you.
	for d in _drones():
		if d.stunned <= 0.0 and not d._alert and d.global_position.distance_to(at) < 42.0:
			_warn("drones", "Watchers. Keep out of their light. If they see you, stay behind me.", 60.0)
	if p.oxygen < 60.0 and not p.breathing:
		_warn("air", "Your air is thin. Go back to your ship.", 40.0)
	if p.health < 45.0:
		_warn("hurt", "You are hurt. Stay by me. I will close it.", 40.0)
	var t: float = reach.system.t
	if Weather.FRONTS.has(b.key) and Weather.rain_at(b.key, t) < 0.05 and Weather.rain_at(b.key, t + 70.0) > 0.3:
		_warn("rain", "Rain is coming over. A minute, no more.", 300.0, 0.4)
	if t > ReachLoop.FLICKER_AT:
		_warn("star", "The star is failing. Two minutes. I will be at the fire when you wake.", 1000.0)
	# Its story, where it matters.
	if b.key == "wanderer" and not Lore.known("keep_makers"):
		var w: WandererSite = (reach.planets["wanderer"] as Planet).sites[0]
		if w and at.distance_to(w.engine.global_position) < 34.0:
			Lore.learn("keep_makers")
			reach.hud.toast("SHIP LOG UPDATED")
			say("This is the Engine. My makers built it to hold a dying star's last morning until help could come. I kept it. Then its core was carried off, and I went after it.", 0.0, 10.0)
	if reach.carrying_core and not Lore.known("keep_core"):
		Lore.learn("keep_core")
		reach.hud.toast("SHIP LOG UPDATED")
		say("The core. A hundred years I followed it, through the Fold and back, and rode the Aster's vault beside it. Bring it home. I will not let them take it from you.", 2.0, 10.0)
	# Quiet: it closes your suit's wounds.
	if _foe(p) == null and p.health < 100.0 and global_position.distance_to(at) < 6.0:
		p.health = minf(100.0, p.health + 1.6)

func _drones() -> Array:
	if reach.system.ruling().key != "ashfall" or not reach.planets.has("ashfall"):
		return []
	var sites: Array = (reach.planets["ashfall"] as Planet).sites
	if sites.is_empty():
		return []
	return (sites[0] as AshfallSite).drones

## The nearest drone that has you in its light.
func _foe(p: Explorer) -> HollowDrone:
	var best: HollowDrone = null
	var bd := STRIKE_RANGE
	for d: HollowDrone in _drones():
		if d._alert and d.stunned <= 0.0:
			var far := d.global_position.distance_to(p.global_position)
			if far < bd:
				bd = far
				best = d
	return best

## It strikes the drone that hunts you dark.
func _fight(dt: float, p: Explorer) -> void:
	_strike = maxf(0.0, _strike - dt)
	var foe := _foe(p)
	if foe == null or waiting:
		return
	_mood_want = 2.0
	if _warn("fight", "Behind me.", 25.0, 2.0):
		_strike = 0.9
	if _strike <= 0.0:
		_strike = STRIKE_EVERY
		strike(foe)

func strike(d: HollowDrone) -> void:
	struck += 1
	d.stun(STUN)
	Sfx.play("laser", -3.0, 0.45)
	var from := global_position + global_basis.y * 2.9
	var to := d.global_position
	var span := from.distance_to(to)
	if span > 0.1:
		var aim := Basis.looking_at((to - from).normalized(), global_basis.y) * Basis(Vector3.RIGHT, -PI / 2.0)
		_arc.global_transform = Transform3D(aim.scaled_local(Vector3(1.0, span, 1.0)), (from + to) * 0.5)
		_arc.visible = true
		_arc_t = 0.18

## It will not let the ash have you.
func _rescue(dt: float, p: Explorer) -> void:
	_haul = maxf(0.0, _haul - dt)
	if p.sunk > 0.75 and not p._dead and not waiting and global_position.distance_to(p.global_position) < 16.0:
		if _haul <= 0.0:
			_haul = 30.0
			hauled += 1
			_mood_want = 1.5
			say("I have you.")
			Sfx.play("hit", -10.0, 0.6)
		if _haul > 26.0:
			p.sunk = maxf(0.0, p.sunk - dt * 1.6)
			# Out of the pit, toward where it stands.
			var out := (global_position - p.global_position)
			out -= p.up_direction * out.dot(p.up_direction)
			if out.length() > 1.0:
				p.velocity += out.normalized() * 26.0 * dt

## A low two-note call: a struck bowl, then a fifth under it.
static func _voice_stream() -> AudioStreamWAV:
	var rate := 22050
	var n := int(rate * 1.1)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var t := float(i) / rate
		var a := sin(TAU * 196.0 * t) * exp(-t * 4.0) + 0.4 * sin(TAU * 392.5 * t) * exp(-t * 7.0)
		var t2 := maxf(0.0, t - 0.28)
		var b := (sin(TAU * 130.8 * t2) + 0.35 * sin(TAU * 262.4 * t2)) * exp(-t2 * 3.2) * (1.0 if t > 0.28 else 0.0)
		data.encode_s16(i * 2, int(clampf((a + b) * 0.42, -1.0, 1.0) * 26000.0))
	var s := AudioStreamWAV.new()
	s.format = AudioStreamWAV.FORMAT_16_BITS
	s.mix_rate = rate
	s.data = data
	return s
