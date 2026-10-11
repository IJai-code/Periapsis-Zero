extends FlightScene
## Act One, last mission: Down the Well. Renn is alive and on Earth, in the
## pillar country nobody has flown for forty years. Come down through the
## cloud, follow her markers low through the pillars, under the old arch,
## down the drowned city's river with Rook's hunter drones behind, up the
## waterfall where they lose you, and land by her shuttle. Then walk over
## and hear it from her.
##
## It is flown first person from the nose, fast and close: grazing rock
## pays (CLOSE CALL), flying above the pillar tops brings Rook's net down.
## For checks: `-- --autofly` flies the markers and reports; `--beat cp2`
## starts at a checkpoint; `--beat land` starts on the pad.

const CHECKPOINTS := [0, 9, 10, 16]
const CEILING := 470.0

var wilds: Wilds
var _rings: Array[MeshInstance3D] = []
var _next := 0
var _hit := 0
var _missed := 0
var _close := 0
var _near := false
var _near_cool := 0.0
var _clock := 0.0
var _high_t := 0.0
var _flak_t := 0.0
var _crumbs: Array[Vector3] = []
var _crumb_t := 0.0
var _hunters: Array = []
var _hunters_lost := false
var _fell := false
var _beat := ""
var _auto := "--autofly" in OS.get_cmdline_user_args()
var _glow: MeshInstance3D
var _renn: Person
var _player: Player
var _talk: Interactable
var _shuttle: Node3D

func _ready() -> void:
	setup_flight(Wilds.SUN, 1.0, false)
	sun_light = Wilds.environment(self)
	wilds = Wilds.new()
	add_child(wilds)
	ship.top_speed = 230.0
	ship.boost_speed = 380.0
	ship.turn_rate = 3.3
	ship.min_speed = 60.0
	ship.level_assist = true
	ship.use_fpv()
	ship.floor_integrity = 0.0
	ship.missile_count = 0
	ship.died.connect(_ship_lost)
	for i in wilds.gates.size():
		var r := _marker_ring()
		add_child(r)
		r.global_position = wilds.gates[i]
		var dir := (wilds.gates[i] - (wilds.gates[i - 1] if i > 0 else wilds.gates[i] + Vector3(0, 300, 1200))).normalized()
		r.global_basis = Basis.looking_at(dir, Vector3.UP if absf(dir.y) < 0.95 else Vector3.BACK) * Basis(Vector3.RIGHT, PI / 2)
		_rings.append(r)
	# Renn's shuttle on the plateau, its beacon going.
	# A Hollow lander: the one she walked out of Rook's hold in.
	var shuttle := Hull.model("raider")
	add_child(shuttle)
	shuttle.global_position = wilds.shuttle_spot + Vector3(0, 3.2, 0)
	shuttle.rotation.y = 0.6
	Surfaces.collide(shuttle)
	_shuttle = shuttle
	Flow.music(true)
	var args := OS.get_cmdline_user_args()
	var i := args.find("--beat")
	var start: String = args[i + 1] if i >= 0 and i + 1 < args.size() else Flow.beat
	Flow.beat = ""
	if start == "land":
		_place_at(wilds.gates.size())
		_land()
		return
	var cp := 0
	if start.begins_with("cp"):
		cp = clampi(int(start.substr(2)), 0, CHECKPOINTS.size() - 1)
	_place_at(CHECKPOINTS[cp])
	if CHECKPOINTS[cp] == 0:
		_entry()
	else:
		_light(_next)
		Hud.objective("Follow Renn's [markers]", "%d / %d" % [_next, wilds.gates.size()])

func _marker_ring() -> MeshInstance3D:
	var t := TorusMesh.new()
	t.inner_radius = 19.0
	t.outer_radius = 21.5
	t.rings = 40
	t.ring_segments = 8
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.4, 0.4, 0.45, 0.5)
	t.material = m
	var mi := MeshInstance3D.new()
	mi.mesh = t
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

func _light(i: int) -> void:
	for k in _rings.size():
		var m := (_rings[k].mesh as TorusMesh).material as StandardMaterial3D
		_rings[k].visible = k >= i and k < i + 4
		if k == i:
			m.albedo_color = Color(Style.ION.r * 2.6, Style.ION.g * 2.6, Style.ION.b * 2.6, 0.95)
		else:
			m.albedo_color = Color(0.9, 0.95, 1.0, 0.35)
	if i < wilds.gates.size():
		set_goal(wilds.gates[i], "MARKER %d" % (i + 1), false)

## Put the ship just before gate `i`, aimed at it.
func _place_at(i: int) -> void:
	_next = i
	var to: Vector3
	var from: Vector3
	if i == 0:
		from = Vector3(Wilds.centre_x(500.0), 760.0, 500.0)
		to = wilds.gates[0]
	elif i >= wilds.gates.size():
		from = wilds.gates[wilds.gates.size() - 1]
		to = wilds.pad
	else:
		to = wilds.gates[i]
		from = wilds.gates[i - 1].lerp(to, 0.2)
	ship.global_position = from
	ship.look_at(to, Vector3.UP)
	ship.aim = -ship.global_basis.z
	ship.cruise = 160.0
	ship.velocity = -ship.global_basis.z * 160.0

# --- Coming down ---------------------------------------------------------------

func _entry() -> void:
	_beat = "entry"
	# The heat of entry round the hull, fading as she slows.
	_glow = MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = 7.0
	s.height = 14.0
	var m := ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = "shader_type spatial;\nrender_mode unshaded, blend_add, cull_back, depth_draw_never;\nuniform float heat = 1.0;\nvoid fragment(){ float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 2.0); ALBEDO = vec3(2.4, 0.9, 0.3) * rim * heat; }"
	m.shader = sh
	s.material = m
	_glow.mesh = s
	_glow.scale = Vector3(1.4, 1.1, 2.6)
	ship.add_child(_glow)
	ship.shake = 1.2
	Sfx.play("big", -6.0, 0.6)
	var t := create_tween()
	t.tween_method(func(v: float):
		m.set_shader_parameter("heat", v)
		ship.shake = maxf(ship.shake, v * 0.8), 1.0, 0.0, 7.0)
	t.tween_callback(_glow.queue_free)
	Hud.card("Down the Well", "EARTH · THE WULINGYUAN QUARANTINE", 3.0)
	await Hud.say("Mara Voss", "You're in the atmosphere. Nobody's flown down there in forty years, Kestrel. Hold her steady.")
	_light(0)
	Hud.objective("Follow Renn's [markers]", "0 / %d" % wilds.gates.size())
	Hud.prompt("[Mouse] steer    [W][S] speed    [Shift] boost    [V] camera", 8.0)
	await Hud.say("Renn Ayers", "Kestrel. Follow my markers. And stay below the pillar tops, Rook's net watches the open sky.")

# --- Each frame -----------------------------------------------------------------

func _process(dt: float) -> void:
	super(dt)
	_clock += dt
	if _beat == "walk" or _beat == "talk" or _beat == "done":
		return
	var p := ship.global_position
	var ground := wilds.height(p.x, p.z)
	hud.altitude = maxf(0.0, p.y - maxf(ground, Wilds.WATER_Y))
	if _auto and ship.controls:
		var to := wilds.gates[_next] if _next < wilds.gates.size() else wilds.pad + Vector3(0, 30, 0)
		ship.aim = (to - p).normalized()
		ship.cruise = 120.0
	_gates()
	_ceiling(dt)
	_hunt(dt)
	if not _fell and wilds.rockfall_tower and _next >= 13 and p.distance_to(wilds.rockfall_tower.global_position) < 650.0:
		_rockfall()
	if _next >= wilds.gates.size() and _beat != "landing":
		var flat := Vector2(p.x - wilds.pad.x, p.z - wilds.pad.z).length()
		if flat < 180.0 and p.y < wilds.pad.y + 160.0:
			_land()

var _bumps_seen := 0

func _physics_process(dt: float) -> void:
	if ship.bumps != _bumps_seen:
		_bumps_seen = ship.bumps
		Report.line("DESCENT bump near marker %d at %s" % [_next + 1, ship.global_position.snapped(Vector3.ONE)])
	if not ship.controls or _beat in ["landing", "walk", "talk", "done"]:
		return
	# Close calls: rock within fifteen metres at speed, once per pass.
	_near_cool -= dt
	if ship.velocity.length() > 70.0:
		var q := PhysicsShapeQueryParameters3D.new()
		var sp := SphereShape3D.new()
		sp.radius = 15.0
		q.shape = sp
		q.collision_mask = 1
		q.transform = Transform3D(Basis(), ship.global_position)
		var near := not get_world_3d().direct_space_state.intersect_shape(q, 1).is_empty()
		if near and not _near and _near_cool <= 0.0:
			_close += 1
			_near_cool = 0.8
			ship.capacitor = minf(ship.max_capacitor, ship.capacitor + 20.0)
			hud.pop("CLOSE CALL", Style.EMBER)
			Sfx.play("roll", -4.0, 1.4)
		_near = near

func _gates() -> void:
	if _next >= wilds.gates.size():
		return
	var g := wilds.gates[_next]
	var p := ship.global_position
	var prev := wilds.gates[_next - 1] if _next > 0 else g + Vector3(0, 300, 1200)
	var dir := (g - prev).normalized()
	var passed := (p - g).dot(dir) > 0.0
	if p.distance_to(g) < 26.0 or (passed and p.distance_to(g) < 60.0):
		_hit += 1
		Sfx.play("objective", -6.0, 1.0 + _next * 0.03)
		hud.pop("MARKER", Style.ION)
		_advance()
	elif passed and p.distance_to(g) < 400.0:
		_missed += 1
		Report.line("DESCENT missed marker %d (%.0f m off)" % [_next + 1, p.distance_to(g)])
		hud.pop("MISSED", Style.MUTE)
		_advance()

func _advance() -> void:
	_next += 1
	Hud.objective_extra("%d / %d" % [_next, wilds.gates.size()])
	_light(_next)
	match _next:
		2: Hud.say("Renn Ayers", "Two hundred years ago this was a park. Now it's the only quiet place left.")
		4: Hud.say("Mara Voss", "...It's beautiful.")
		7: Hud.say("Renn Ayers", "Low and fast. Thread the pillars, they hide you.")
		9: Hud.say("Renn Ayers", "Through the old gate. Don't look down.")
		11:
			Hud.say("Renn Ayers", "This was a city once. The river took it back.")
			_release_hunters()
		13: Hud.say("Renn Ayers", "Under the fallen tower. Keep it tight!")
		16:
			Hud.say("Renn Ayers", "Climb! Straight up the falls!")
			_lose_hunters()
		19: Hud.say("Renn Ayers", "There. The plateau. My lander's by the pad.")
	if _next >= wilds.gates.size():
		clear_goal()
		set_goal(wilds.pad + Vector3(0, 6, 0), "LANDING PAD", false)
		FlightHud.mark(_shuttle, "Renn's lander", "Stolen Hollow lander", "objective")
		Hud.objective("Land by Renn's [lander]", "The pad on the plateau")
		Report.line("DESCENT markers %d hit %d missed, %d bumps, %d close calls" % [_hit, _missed, ship.bumps, _close])

## Above the pillar tops, Rook's net sees you: a warning, then flak.
func _ceiling(dt: float) -> void:
	var p := ship.global_position
	var zone := _next >= 1 and p.z < -400.0 and p.z > Wilds.CLIFF_Z
	if zone and p.y > CEILING:
		_high_t += dt
		if _high_t < dt * 1.5:
			Sfx.play("alarm", -6.0)
			hud.log_line("Rook's net: you are painted", Style.EMBER)
			Hud.say("Renn Ayers", "Too high! Get down below the pillars!", 2.5)
		if _high_t > 2.5:
			_flak_t -= dt
			if _flak_t <= 0.0:
				_flak_t = 0.5
				var at := p + Vector3(randf_range(-30, 30), randf_range(-20, 20), randf_range(-40, 10))
				Fx.explode(self, at, 6.0, true)
				ship.hit(9.0, at, at)
				ship.shake = maxf(ship.shake, 0.6)
	else:
		_high_t = 0.0

# --- Rook's hunters -----------------------------------------------------------

func _release_hunters() -> void:
	Sfx.play("alarm", -4.0)
	await Hud.say("Mara Voss", "Contacts behind you! Hunter drones. Rook's.")
	for k in 3:
		var h := Hunter.new()
		h.bolts = bolts
		h.target = ship
		h.lag = 14 + k * 5
		add_child(h)
		h.global_position = ship.global_position - (-ship.global_basis.z) * (300.0 + k * 60.0) + Vector3(randf_range(-20, 20), 20, 0)
		h.died.connect(func():
			_hunters.erase(h)
			raider_like_down(h))
		_hunters.append(h)
	await Hud.say("Renn Ayers", "They followed me down. Make for the falls. They're blind in the spray.")

func raider_like_down(h: Hull) -> void:
	h.destroy(6.0, 20.0)
	h.get_tree().create_timer(0.1).timeout.connect(h.queue_free)
	hud.kill()
	hud.log_line("Hunter drone destroyed", Style.EMBER)

func _hunt(dt: float) -> void:
	_crumb_t -= dt
	if _crumb_t <= 0.0:
		_crumb_t = 0.1
		_crumbs.push_front(ship.global_position)
		if _crumbs.size() > 80:
			_crumbs.pop_back()
	for h in _hunters:
		if is_instance_valid(h) and not h.lost:
			h.trail = _crumbs

## In the spray the drones lose the ship and fly into the cliff.
func _lose_hunters() -> void:
	if _hunters_lost:
		return
	_hunters_lost = true
	var k := 0
	for h in _hunters.duplicate():
		if not is_instance_valid(h):
			continue
		h.lost = true
		var into := Vector3(Wilds.centre_x(Wilds.CLIFF_Z) + randf_range(-80, 80), randf_range(60, 200), Wilds.CLIFF_Z - 30.0)
		var t := create_tween()
		t.tween_interval(0.4 + k * 0.5)
		t.tween_property(h, "global_position", into, 1.2)
		t.tween_callback(func():
			if is_instance_valid(h) and h.alive:
				h.alive = false
				Fx.explode(self, h.global_position, 12.0, true)
				h.died.emit())
		k += 1
	await get_tree().create_timer(3.4).timeout
	if k > 0:
		Hud.say("Renn Ayers", "Ha! Never trust a drone in the mist.")

# --- The tower --------------------------------------------------------------------

## A tower ahead gives way and comes down along the river bank.
func _rockfall() -> void:
	_fell = true
	var t := wilds.rockfall_tower
	Sfx.play("big", -2.0, 0.8)
	Hud.say("Mara Voss", "Watch the tower!", 2.0)
	var base := t.global_basis
	var tip := -1.25
	# Fall away from the river if falling downstream would cross the line.
	var top := t.global_position + Basis(Vector3.RIGHT, tip) * base * Vector3(0, 150, 0)
	if wilds.route_clearance(top.x, top.z) < 50.0:
		tip = 1.25
	var tw := create_tween()
	tw.tween_method(func(a: float): t.global_basis = Basis(Vector3.RIGHT, a) * base, 0.0, tip, 3.2).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.tween_callback(func():
		var where := t.global_position + t.global_basis * Vector3(0, 90, 0)
		for i in 4:
			Fx.explode(self, where + Vector3(randf_range(-30, 30), 0, randf_range(-60, 60)), 18.0, i == 0)
		ship.shake = maxf(ship.shake, 1.0))

# --- Down -----------------------------------------------------------------------

func _land() -> void:
	_beat = "landing"
	clear_goal()
	Hud.clear_prompt()
	Hud.clear_objective()
	for r in _rings:
		r.visible = false
	ship.park(true)
	ship.fpv = false
	ship._model.visible = true
	var spot := wilds.pad + Vector3(0, 2.6, 0)
	var from := ship.global_transform
	var face := (wilds.shuttle_spot - spot)
	face.y = 0.0
	var to := Transform3D(Basis.looking_at(face.normalized(), Vector3.UP), spot)
	var tw := create_tween()
	tw.tween_method(func(k: float): ship.global_transform = from.interpolate_with(to, k), 0.0, 1.0, 4.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	Sfx.play("door", -6.0, 0.6)
	await tw.finished
	Fx.explode(self, spot + Vector3(0, -2, 0), 3.0, false)
	Surfaces.collide(ship._model)
	await Hud.fade_out(0.6)
	_on_foot()
	await Hud.fade_in(0.8)

func _on_foot() -> void:
	_beat = "walk"
	hud.visible = false
	Hud.flight_layout(false)
	_renn = Person.make("renn")
	add_child(_renn)
	_renn.global_position = wilds.pad.lerp(wilds.shuttle_spot, 0.55) + Vector3(0.0, 0.0, 4.0)
	_renn.global_position.y = wilds.height(_renn.global_position.x, _renn.global_position.z)
	_player = Player.new()
	add_child(_player)
	var side := ship.global_basis.x * -9.0
	_player.global_position = wilds.pad + side + Vector3(0, 0.6, 0)
	_player.global_position.y = wilds.height(_player.global_position.x, _player.global_position.z) + 0.3
	_player.face(_renn.global_position + Vector3(0, 1.6, 0))
	_player.camera.make_current()
	_renn.face(_player.global_position)
	_talk = Interactable.new(Vector3(1.4, 2.0, 1.4), "[E] Talk to Renn", 1.8)
	add_child(_talk)
	_talk.global_position = _renn.global_position + Vector3(0, 1.0, 0)
	_talk.activated.connect(_meet)
	Hud.objective("Talk to [Renn]", "By her lander")
	Hud.waypoint(_renn, "RENN", 2.1)
	Sfx.play("objective", -6.0)
	if _auto:
		# The check walks over and talks, as a player would.
		await get_tree().create_timer(1.5).timeout
		_player.global_position = _renn.global_position + (_player.global_position - _renn.global_position).normalized() * 1.6
		await get_tree().create_timer(0.5).timeout
		Report.line("DESCENT on foot, prompt '%s'" % Hud.focus_text())
		_meet()

func _meet() -> void:
	if _beat != "walk":
		return
	_beat = "talk"
	_talk.set_meta("prompt", "")
	Hud.waypoint(null)
	Hud.clear_objective()
	_player.enabled = false
	_player.face(_renn.global_position + Vector3(0, 1.6, 0))
	_renn.face(_player.global_position)
	await get_tree().create_timer(0.5).timeout
	var cam := Shot3D.open(self)
	Hud.letterbox(true)
	var me := _player.global_position + Vector3(0, 1.6, 0)
	var her := _renn.global_position + Vector3(0, 1.55, 0)
	cam.frame(me, her)
	_renn.talk(true)
	await Hud.say("Renn Ayers", "You came. Alone? ...Good.")
	await Hud.say("Renn Ayers", "I sent the route. I'm not going to pretend I didn't. Rook had my brother's debt, and he said cargo. Nobody hurt.")
	await Hud.say("Renn Ayers", "Then I watched the Aster burn from a pod window. Two hundred and twelve people.")
	await Hud.say("Renn Ayers", "His crew pulled my pod in. Two days later I walked out of their hold in their own lander, and I didn't stop until the ground.")
	await Hud.say("Renn Ayers", "This is his ledger. Every convoy, every payment. The Hollow aren't pirates, Kestrel. They're Rook's.")
	await Hud.say("Renn Ayers", "And look whose seal is on the permits that let his ships through.")
	_renn.talk(false)
	await Hud.say("Mara Voss", "...That's the governor's seal. Hearth's own governor.")
	_renn.talk(true)
	await Hud.say("Renn Ayers", "Now you know why I came down here. Up there, they own everything.")
	_renn.talk(false)
	await Hud.say("Mara Voss", "Bring her home. Both of you. Quietly.")
	cam.done()
	Hud.letterbox(false)
	_beat = "done"
	var pay := 8000 + _close * 100
	var split := Flow.earn(pay)
	Flow.set_progress("act1_descent", true)
	Flow.set_progress("descent_close_calls", maxi(int(Flow.progress("descent_close_calls", 0)), _close))
	Report.line("DESCENT passed")
	await Hud.mission_passed("Down the Well · %d markers · %d close calls" % [_hit, _close], split[0], split[1], Flow.debt())
	Flow.go("act1_end")

func _ship_lost() -> void:
	if _beat == "lost":
		return
	_beat = "lost"
	Report.line("DESCENT ship lost at marker %d" % _next)
	ship.controls = false
	ship.set_process(false)
	ship.set_physics_process(false)
	ship.destroy(14.0, 30.0)
	hud.visible = false
	Hud.silence()
	await wait(1.4)
	await Hud.mission_failed("The Kestrel hit the ground")
	var cp := 0
	for k in CHECKPOINTS.size():
		if _next >= CHECKPOINTS[k]:
			cp = k
	Flow.beat = "cp%d" % cp
	Flow.go("descent")

## One of Rook's hunters: follows the ship's own path a second or two
## behind (so it never hits what the ship missed), firing when it has a line.
class Hunter extends Hull:
	var bolts: Bolts
	var target: Node3D
	var trail: Array[Vector3] = []
	var lag := 15
	var lost := false
	var _cool := 1.0

	func _ready() -> void:
		team = "hollow"
		display_name = "Hunter drone"
		ship_class = "Drone"
		radius = 4.5
		max_shield = 8.0
		shield = 8.0
		max_integrity = 14.0
		integrity = 14.0
		body = Hull.model("raider")
		body.scale = Vector3.ONE * 0.45
		add_child(body)

	func _physics_process(dt: float) -> void:
		if not alive or lost or trail.size() <= lag:
			return
		var want: Vector3 = trail[lag]
		var to := want - global_position
		var spd := maxf(90.0, (target.get("velocity") as Vector3).length() * 1.05)
		velocity = to.normalized() * minf(spd, to.length() / dt)
		global_position += velocity * dt
		if velocity.length() > 1.0:
			look_at(global_position + velocity, Vector3.UP)
		_cool -= dt
		var aim := target.global_position - global_position
		if _cool <= 0.0 and aim.length() < 500.0 and (-global_basis.z).angle_to(aim) < 0.35:
			_cool = randf_range(0.5, 0.9)
			Fx.muzzle(self, Vector3(0, -0.2, -4.0), Color(2.0, 0.6, 0.2))
			bolts.fire(global_position - global_basis.z * 5.0, (aim.normalized() + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.04).normalized(), velocity, "hollow", 3.0)
