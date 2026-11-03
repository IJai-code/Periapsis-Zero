class_name Echoes
extends Node3D
## Other travellers, playing right now, seen as faint lights: "those who
## carry the Engine's song remember", and each of them is living a morning
## of their own. Over Supabase Realtime (the Phoenix protocol, as the
## website's src/game/net/realtime.js speaks it): one room for the whole
## Reach (presence: how many are here) and a room per world, where each
## traveller says where they stand on it every second and a half. Nothing
## is said in open space, where every loop's worlds are somewhere else.
## Anonymous: a random id each session, a place, a paint and a title.

const URL := "wss://hgrkqvfqpcafthjmemfj.supabase.co/realtime/v1/websocket"
## The publishable key: public by design (the website ships it too).
const KEY := "sb_publishable_OwKxu794cp34gaZmQmFkrw_x3t1Ksau"
const LOBBY := "realtime:pz-reach"
const SAY_EVERY := 1.5
const STALE := 6.0

var reach: Node
var _ws: WebSocketPeer
var _open := false
var _ref := 0
var _id := ""
var _room := ""
var _joined := {}
var _say_t := 0.0
var _beat_t := 0.0
var _retry_t := 0.0
var _tries := 0
## id: {"p": body-local, "c": Color, "t": title, "seen": time, "node": Node3D}
var _others := {}
var count := 0
var _told := false
var _enabled := true

func _ready() -> void:
	add_to_group("echoes")
	add_to_group("reach_dynamic")
	_id = "%08x" % (randi() ^ Time.get_ticks_usec())
	_enabled = bool(Flow.settings.get("echoes", true))

func set_enabled(on: bool) -> void:
	_enabled = on
	if not on:
		_close()

func _close() -> void:
	if _ws:
		_ws.close()
	_ws = null
	_open = false
	_joined.clear()
	_room = ""
	for id in _others.keys():
		_drop(id)
	count = 0

func _connect() -> void:
	_ws = WebSocketPeer.new()
	_ws.connect_to_url("%s?apikey=%s&vsn=1.0.0" % [URL, KEY])
	_open = false
	_tries += 1

func _send(topic: String, event: String, payload: Dictionary, join := false) -> void:
	if not _ws or _ws.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return
	_ref += 1
	var m := {"topic": topic, "event": event, "payload": payload, "ref": str(_ref)}
	if join:
		m["join_ref"] = str(_ref)
	_ws.send_text(JSON.stringify(m))

func _join(topic: String, presence: bool) -> void:
	_send(topic, "phx_join", {"config": {"broadcast": {"self": false, "ack": false}, "presence": {"key": _id if presence else "", "enabled": presence}, "private": false}}, true)
	_joined[topic] = "joined" if presence else "room"

func _leave(topic: String) -> void:
	_send(topic, "phx_leave", {})
	_joined.erase(topic)

func _process(dt: float) -> void:
	if not _enabled or not reach or not reach.system:
		return
	if not _ws:
		_retry_t -= dt
		if _retry_t <= 0.0 and _tries < 6:
			_connect()
		return
	_ws.poll()
	var st := _ws.get_ready_state()
	if st == WebSocketPeer.STATE_CLOSED:
		_ws = null
		_open = false
		_joined.clear()
		_room = ""
		_retry_t = 5.0 * _tries
		return
	if st != WebSocketPeer.STATE_OPEN:
		return
	if not _open:
		_open = true
		_tries = 0
		_join(LOBBY, true)
	while _ws.get_available_packet_count() > 0:
		_receive(_ws.get_packet().get_string_from_utf8())
	_beat_t -= dt
	if _beat_t <= 0.0:
		_beat_t = 25.0
		_send("phoenix", "heartbeat", {})
	# The room of the world you are on.
	var sys: ReachSystem = reach.system
	var want := "" if sys.ref == "lantern" else "realtime:pz-reach-" + sys.ref
	if want != _room:
		if _room != "":
			_leave(_room)
		for id in _others.keys():
			_drop(id)
		_room = want
		if want != "":
			_join(want, false)
	_say_t -= dt
	if _say_t <= 0.0 and _room != "":
		_say_t = SAY_EVERY
		var at := _here()
		if at != Vector3.INF:
			var c: Color = Season.LIVERIES[Season.equipped("livery")][1]
			_send(_room, "broadcast", {"type": "broadcast", "event": "p", "payload": {"i": _id, "p": [snappedf(at.x, 0.1), snappedf(at.y, 0.1), snappedf(at.z, 0.1)], "c": c.to_html(false), "t": Season.TITLES[Season.equipped("title")]}})
	_draw_others(dt)

## Where you are on the world you are on (the ship's place while flying).
func _here() -> Vector3:
	var cam := get_viewport().get_camera_3d()
	if not cam:
		return Vector3.INF
	return cam.global_position - (reach.system as ReachSystem).world(reach.system.ref)

func _receive(text: String) -> void:
	var m = JSON.parse_string(text)
	if not m is Dictionary:
		return
	var ev := str(m.get("event", ""))
	var topic := str(m.get("topic", ""))
	var pl = m.get("payload", {})
	if not pl is Dictionary:
		return
	if ev == "phx_reply" and topic == LOBBY and str((pl as Dictionary).get("status", "")) == "ok" and str(_joined.get(LOBBY, "")) == "joined":
		_joined[LOBBY] = "tracked"
		_send(LOBBY, "presence", {"type": "presence", "event": "track", "payload": {"t": Season.TITLES[Season.equipped("title")]}})
	elif ev == "presence_state" and topic == LOBBY:
		count = maxi(0, (pl as Dictionary).size() - 1)
		_tell()
	elif ev == "presence_diff" and topic == LOBBY:
		count = maxi(0, count + ((pl as Dictionary).get("joins", {}) as Dictionary).size() - ((pl as Dictionary).get("leaves", {}) as Dictionary).size())
	elif ev == "broadcast" and topic == _room:
		var inner = pl.get("payload", {})
		if not inner is Dictionary or str(inner.get("i", "")) == _id:
			return
		var p = inner.get("p", [])
		if not p is Array or (p as Array).size() != 3:
			return
		var at := Vector3(float(p[0]), float(p[1]), float(p[2]))
		var id := str(inner.get("i", ""))
		match str(pl.get("event", "")):
			"p":
				_place(id, at, Color.from_string(str(inner.get("c", "efe3c9")), ReachStyle.BONE), str(inner.get("t", "Traveller")).left(24))
			"w":
				_ring(at, Color.from_string(str(inner.get("c", "efe3c9")), ReachStyle.BONE))
				Sfx.play("ping", -12.0, 0.8)

## Once a session: how many are here with you.
func _tell() -> void:
	if _told or count <= 0 or not reach.hud:
		return
	_told = true
	reach.hud.caption("%d other %s in the Reach right now. Their echoes are the faint lights." % [count, "traveller is" if count == 1 else "travellers are"], 5.0)

func _place(id: String, at: Vector3, c: Color, title: String) -> void:
	var o: Dictionary = _others.get(id, {})
	if o.is_empty():
		o = {"node": _wisp(c, title), "p": at, "shown": at}
		_others[id] = o
	o["p"] = at
	o["seen"] = Time.get_ticks_msec() * 0.001

func _drop(id: String) -> void:
	var o: Dictionary = _others[id]
	if is_instance_valid(o.node):
		(o.node as Node).queue_free()
	_others.erase(id)

func _draw_others(dt: float) -> void:
	var now := Time.get_ticks_msec() * 0.001
	var base := (reach.system as ReachSystem).world(reach.system.ref)
	var cam := get_viewport().get_camera_3d()
	for id in _others.keys():
		var o: Dictionary = _others[id]
		if now - float(o.get("seen", now)) > STALE:
			_drop(id)
			continue
		o["shown"] = (o.shown as Vector3).lerp(o.p, minf(1.0, dt * 1.6))
		var n: Node3D = o.node
		n.global_position = base + (o.shown as Vector3)
		var lab: Label3D = n.get_child(1)
		lab.visible = cam != null and cam.global_position.distance_to(n.global_position) < 60.0

## A soft light the size of a person, its title above it when near.
func _wisp(c: Color, title: String) -> Node3D:
	var n := Node3D.new()
	add_child(n)
	var q := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size = Vector2(1.6, 1.6)
	q.mesh = quad
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.no_depth_test = false
	m.albedo_texture = _glow()
	m.albedo_color = Color(c.lerp(Color.WHITE, 0.35), 0.9)
	q.material_override = m
	q.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	n.add_child(q)
	var l := Label3D.new()
	l.text = title
	l.font = ReachStyle.round_bold
	l.font_size = 48
	l.pixel_size = 0.004
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.modulate = Color(ReachStyle.BONE, 0.85)
	l.outline_modulate = Color(ReachStyle.CHARCOAL, 0.8)
	l.position = Vector3(0, 1.3, 0)
	l.visible = false
	n.add_child(l)
	return n

static var _glow_tex: Texture2D
static func _glow() -> Texture2D:
	if _glow_tex:
		return _glow_tex
	var g := GradientTexture2D.new()
	g.fill = GradientTexture2D.FILL_RADIAL
	g.fill_from = Vector2(0.5, 0.5)
	g.fill_to = Vector2(0.5, 0.0)
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 1, 1))
	grad.set_color(1, Color(1, 1, 1, 0))
	grad.add_point(0.25, Color(1, 1, 1, 0.55))
	g.gradient = grad
	g.width = 64
	g.height = 64
	_glow_tex = g
	return g

## K: a ring of light where you stand, seen by everyone on this world.
func wave() -> void:
	var at := _here()
	if at == Vector3.INF:
		return
	var c: Color = Season.LIVERIES[Season.equipped("livery")][1]
	_ring(at, c)
	Sfx.play("ping", -10.0, 1.2)
	if _room != "":
		_send(_room, "broadcast", {"type": "broadcast", "event": "w", "payload": {"i": _id, "p": [at.x, at.y, at.z], "c": c.to_html(false)}})
	# It counts when there is someone near to see it.
	for o: Dictionary in _others.values():
		if (o.p as Vector3).distance_to(at) < 300.0:
			Season.note("wave")
			break

func _ring(at: Vector3, c: Color) -> void:
	var sys: ReachSystem = reach.system
	var up := at.normalized() if sys.ref != "lantern" else Vector3.UP
	var mi := MeshInstance3D.new()
	var t := TorusMesh.new()
	t.inner_radius = 0.9
	t.outer_radius = 1.0
	t.rings = 48
	mi.mesh = t
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(c.lerp(Color.WHITE, 0.4), 1.0)
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var side := up.cross(Vector3.RIGHT if absf(up.x) < 0.9 else Vector3.FORWARD).normalized()
	mi.global_transform = Transform3D(Basis(side, up, side.cross(up)), sys.world(sys.ref) + at)
	var tw := mi.create_tween()
	tw.set_parallel(true)
	tw.tween_property(mi, "scale", Vector3.ONE * 14.0, 2.2).from(Vector3.ONE * 0.5).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	tw.tween_property(m, "albedo_color:a", 0.0, 2.2)
	tw.chain().tween_callback(mi.queue_free)

## Frames move the world under everything (ReachSystem.switch): the wisps
## are placed from their world every frame, so nothing to do here.
func frame_shift(_dp: Vector3, _dv: Vector3) -> void:
	pass
