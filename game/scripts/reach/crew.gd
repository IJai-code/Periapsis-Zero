class_name Crew
extends Node
## The Aster's survivors, the heart of the Reach: four of her crew are
## alive out there, each in danger, and each morning you can bring them
## home. Captain Hale is sealed in the wreck's bridge on Ashfall (his air
## runs out at 13:00); Renn hides under Verdance's falls (Rook's drones find
## her at 15:30); Navigator Sato is stranded on the Phantom (it swings too
## near the Lantern at 18:00); Pip, the cargo hand, is shut in the Engine's
## chamber on the Wanderer, whose door opens only at its closest pass.
##
## Talk to one (and say the right thing) and they come aboard the Kestrel;
## land at Hearth and they walk to the fire. Their suit beacons are on the
## signalscope's first frequency until they are aboard, home, or lost.
## The morning puts them all back where they were: what carries over is
## what you know (where they are, what each needs to hear).

const ROSTER := {
	"hale": {"name": "Captain Hale", "model": "hale", "world": "ashfall", "until": 780.0, "beacon": "Captain Hale's suit beacon", "rate": 1.3},
	"renn": {"name": "Renn", "model": "renn", "world": "verdance", "until": 930.0, "beacon": "Renn's suit beacon", "rate": 0.9},
	"sato": {"name": "Navigator Sato", "model": "crowd3", "world": "phantom", "until": 1080.0, "beacon": "Sato's suit beacon", "rate": 1.7},
	"pip": {"name": "Pip", "model": "crowd1", "world": "wanderer", "until": INF, "beacon": "Pip's suit beacon", "rate": 2.2},
}
## The Aster's crew wear her colours: rust-orange flight suits.
const SUIT := Color(0.78, 0.42, 0.22)
## How far from Hearth's fire a landing counts as bringing them home.
const HOME_RANGE := 280.0

var reach: Node
## id -> "waiting", "aboard", "home" or "lost".
var state := {}
var _people := {}
var _beacons := {}
var _home: Array[Node3D] = []
var _last_t := 0.0
var _landed_t := 0.0

func _ready() -> void:
	reach = get_tree().get_first_node_in_group("reach_root")
	for id in ROSTER:
		state[id] = "waiting"
	_place.call_deferred()

func _site(world: String) -> Site:
	if not reach.planets.has(world):
		return null
	var pl: Planet = reach.planets[world]
	return pl.sites[0] if pl.sites.size() > 0 else null

## Each survivor where they are found, and their beacon there.
## (In the browser the worlds' sites are built a piece at a time after the
## crew exists: whoever's site is not there yet is placed on a later frame.)
func _place() -> void:
	for id in ROSTER:
		if _people.has(id):
			continue
		var r: Dictionary = ROSTER[id]
		var site := _site(r.world)
		if site == null or not site.is_node_ready():
			continue
		var xf := Transform3D()
		match id:
			"hale":
				var ash := site as AshfallSite
				# On the bridge, in front of the captain's chair, facing aft.
				xf = ash.bridge_xf * Transform3D(Basis(Vector3.UP, PI), Vector3(0.6, 0.02, -1.3))
			"renn":
				xf = (site as VerdanceSite).renn_xf
			"sato":
				xf = site.stand_at(Vector2(2.6, -6.0), Vector2(0.0, -16.0))
			"pip":
				var wan := site as WandererSite
				xf = wan.engine.transform * Transform3D(Basis(), Vector3(-2.4, 0.05, -1.8))
		var s := Survivor.new()
		s.id = id
		if state[id] != "waiting":
			s.visible = false
		s.crew = self
		s.title = r.name
		s.model = r.model
		site.add_child(s)
		s.transform = xf
		_people[id] = s
		if reach.scope:
			_beacons[id] = reach.scope.add_source(site, "crew_" + id, r.beacon, 0, ReachSounds.beacon(float(r.rate)), xf.origin + xf.basis.y * 1.2, 16.0)

func _process(dt: float) -> void:
	if reach == null or reach.system == null:
		return
	if _people.size() < ROSTER.size():
		_place()
	var t: float = reach.system.t
	if t < _last_t - 5.0:
		_morning()
	_last_t = t
	# Out of time: lost, this morning.
	for id in ROSTER:
		if state[id] == "waiting" and t > float(ROSTER[id].until):
			_lose(id)
	# Down at Hearth with people aboard: they go home.
	var ship: ReachShip = reach.ship
	if ship and ship.landed and reach.system.ref == "hearthstone" and not aboard().is_empty():
		var hb: ReachBody = reach.system.bodies["hearthstone"]
		var fire: Vector3 = reach.system.world("hearthstone") + Worlds.place(hb, "village").origin
		if ship.global_position.distance_to(fire) < HOME_RANGE:
			_landed_t += dt
			if _landed_t > 1.5:
				_bring_home()
		else:
			_landed_t = 0.0
	else:
		_landed_t = 0.0

func aboard() -> Array:
	var out := []
	for id in ROSTER:
		if state[id] == "aboard":
			out.append(id)
	return out

func home() -> Array:
	var out := []
	for id in ROSTER:
		if state[id] == "home":
			out.append(id)
	return out

## Talked to: the conversation for where they are; if it ends with them
## agreeing, aboard they come.
func talk(s: Survivor, by: Node) -> void:
	var ex := by as Explorer
	if ex == null or reach.talking:
		return
	ex.enabled = false
	reach.talking = true
	s.person.face(ex.global_position)
	var key: String = s.id + ("_home" if state[s.id] == "home" else "")
	var t := Talk.open(reach, key, s.person, reach.hud)
	await t.finished
	reach.talking = false
	ex.enabled = true
	if t.boarded and state[s.id] == "waiting":
		board(s.id)

func board(id: String) -> void:
	state[id] = "aboard"
	var s: Survivor = _people[id]
	s.visible = false
	s.use.prompt = ""
	if _beacons.has(id):
		(_beacons[id] as SignalSource).silence(true)
	Sfx.play("door", -8.0, 1.2)
	if reach.hud:
		reach.hud.caption("%s is aboard the Kestrel. Fly them home: land by Hearth's fire." % ROSTER[id].name, 4.0)

func _bring_home() -> void:
	var village: Village = _site("hearthstone") as Village
	var names := []
	for id in aboard():
		state[id] = "home"
		names.append(ROSTER[id].name)
		# By the fire, a place each round it.
		var k := ["hale", "renn", "sato", "pip"].find(id)
		var a := 0.6 + k * 1.3
		var p := Survivor.new()
		p.id = id
		p.crew = self
		p.title = ROSTER[id].name
		p.model = ROSTER[id].model
		village.add_child(p)
		p.transform = village.stand_at(Vector2(cos(a), sin(a)) * 5.2, Vector2.ZERO)
		_home.append(p)
		Lore.learn("saved_" + id)
	Sfx.play("objective", -4.0, 1.0)
	if reach.hud:
		reach.hud.toast("SHIP LOG UPDATED")
		var n := home().size()
		reach.hud.caption("%s %s safe at Hearth. %d of the Aster's crew home this morning." % [" and ".join(names), "is" if names.size() == 1 else "are", n], 5.0)

func _lose(id: String) -> void:
	state[id] = "lost"
	var s: Survivor = _people.get(id)
	if s:
		s.visible = false
		s.use.prompt = ""
	if _beacons.has(id):
		(_beacons[id] as SignalSource).silence(true)
	# Only news to someone who knows the beacon was there.
	if reach.hud and Lore.known("hearth_" + id):
		reach.hud.caption("%s on %s has gone silent." % [ROSTER[id].beacon, (reach.system.bodies[ROSTER[id].world] as ReachBody).title], 4.0)
		Sfx.play("warn", -10.0, 0.6)

## A new morning: everyone back where they were found.
func _morning() -> void:
	for p in _home:
		if is_instance_valid(p):
			p.queue_free()
	_home.clear()
	for id in ROSTER:
		state[id] = "waiting"
		var s: Survivor = _people.get(id)
		if s:
			s.visible = true
			s.use.prompt = "Talk to " + s.title
		if _beacons.has(id):
			(_beacons[id] as SignalSource).silence(false)

## Pip is with you at the end, whatever else: he was in the Engine's chamber.
func at_engine() -> void:
	if state["pip"] == "waiting":
		state["pip"] = "home"
