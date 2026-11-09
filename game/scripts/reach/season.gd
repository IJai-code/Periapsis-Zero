class_name Season
## Seasons of the Reach, on the real calendar: a season runs for weeks, the
## same for everyone. Playing earns starlight, starlight climbs the season's
## orbit of tiers, and the tiers give the Kestrel her paint, the campfire
## its colour and your echo its title. Three challenges a week, the same
## three for every traveller; a transmission from the Fold each week, the
## season's story arriving a piece at a time; and at the season's end one
## live event, at one moment for everyone, after which the Reach is not as
## it was (Homecoming).
##
## Saved in Flow progress under "season_<id>_..." so a new season starts a
## fresh orbit and keeps what was won (rewards are kept for good).

const TIER_XP := 1000
const TIERS := 30
const WEEK := 604800

## id, name, start (UTC), the live event that ends it (UTC), its words.
## "" is not scheduled: Season 1 runs until the Reach has travellers enough
## for the Homecoming to mean something, and only then gets its date (and
## Season 2 its start). Set both here and in src/ui/Season.jsx together.
const SEASONS := [
	{"id": "s1", "n": 1, "name": "Embers", "start": "2026-11-02T00:00:00", "event": "",
		"line": "The Lantern is dying, the morning keeps coming back, and something is calling from inside the Fold."},
	{"id": "s2", "n": 2, "name": "Homecoming", "start": "", "event": "",
		"line": "The Long Song has come home after a hundred years. The Founders are back, and they are not who the recordings said."},
]

## What the tiers give: tier: [kind, id]. A kind's first entry is what
## everyone starts with.
const LIVERIES := {
	"hearth": ["Hearth", Color(0.86, 0.8, 0.7), Color(0.44, 0.27, 0.19)],
	"ember": ["Ember Stripe", Color(0.92, 0.55, 0.28), Color(0.2, 0.15, 0.13)],
	"pine": ["Pine", Color(0.5, 0.66, 0.46), Color(0.24, 0.2, 0.15)],
	"heron": ["Night Heron", Color(0.2, 0.27, 0.42), Color(0.85, 0.8, 0.7)],
	"brass": ["Rust and Brass", Color(0.78, 0.6, 0.3), Color(0.42, 0.18, 0.1)],
	"fold": ["Fold Violet", Color(0.5, 0.36, 0.62), Color(0.3, 0.6, 0.62)],
	"ice": ["Ice Miner", Color(0.92, 0.94, 0.95), Color(0.22, 0.5, 0.56)],
	"phantom": ["Phantom", Color(0.1, 0.1, 0.12), Color(0.7, 0.74, 0.8)],
	"lantern": ["Lantern Gold", Color(0.95, 0.75, 0.3), Color(0.5, 0.2, 0.08)],
	"longsong": ["Long Song", Color(0.96, 0.95, 0.9), Color(0.85, 0.66, 0.25)],
}
const FLAMES := {
	"campfire": ["Campfire", Color(1.0, 0.5, 0.15)],
	"copper": ["Copper Green", Color(0.3, 1.0, 0.45)],
	"fold": ["Fold Blue", Color(0.25, 0.6, 1.0)],
	"phantom": ["Phantom Violet", Color(0.7, 0.3, 1.0)],
	"starstone": ["Starstone", Color(0.9, 0.95, 1.0)],
	"lantern": ["Lantern Gold", Color(1.0, 0.8, 0.2)],
}
const TITLES := {
	"traveller": "Traveller", "rememberer": "Rememberer", "runner": "Ring Runner", "catcher": "Stone Catcher",
	"diver": "Fold Diver", "echo": "Founder's Echo", "keeper": "Keeper of the Song",
}
const REWARDS := {
	2: ["livery", "ember"], 3: ["title", "rememberer"], 4: ["flame", "copper"], 5: ["livery", "pine"],
	7: ["title", "runner"], 8: ["livery", "heron"], 9: ["flame", "fold"], 10: ["title", "catcher"],
	11: ["livery", "brass"], 13: ["flame", "phantom"], 14: ["livery", "fold"], 16: ["title", "diver"],
	17: ["livery", "ice"], 19: ["flame", "starstone"], 20: ["livery", "phantom"], 22: ["title", "echo"],
	24: ["flame", "lantern"], 25: ["livery", "lantern"], 28: ["title", "keeper"], 30: ["livery", "longsong"],
}

## The challenge pool: id: [what counts, how many, starlight, the words].
## Each week picks three, the same three for everyone.
const CHALLENGES := {
	"stones": ["starstone", 3, 800, "Take 3 starstones from the morning's craters"],
	"runs": ["rimrun", 2, 700, "Fly Isa's Rim Run twice"],
	"gold": ["rimrun_gold", 1, 1000, "Win gold on the Rim Run"],
	"verdance": ["arrive:verdance", 2, 600, "Reach Verdance in 2 different mornings"],
	"wanderer": ["arrive:wanderer", 1, 900, "Catch up with the Wanderer"],
	"phantom": ["arrive:phantom", 1, 800, "Reach the Phantom"],
	"ashfall": ["arrive:ashfall", 2, 600, "Reach Ashfall in 2 different mornings"],
	"fold": ["fold", 1, 900, "Fly into the Fold"],
	"mornings": ["loop", 4, 600, "Live 4 mornings"],
	"rest": ["rest", 2, 500, "Rest at a campfire twice"],
	"photos": ["photo", 5, 500, "Take 5 photographs"],
	"faraway": ["supernova_away", 1, 900, "Watch the Lantern fall from any world but Hearth"],
	"cave": ["zerog", 1, 700, "Fly all five rings in the Zero-G cave"],
	"wave": ["wave", 3, 600, "Wave (K) to another traveller's echo 3 times"],
}

## Starlight for what you do, once per thing where it says so.
const XP := {"fact": 150, "verse": 60, "starstone": 80, "rimrun": 120, "rimrun_gold": 200, "loop": 50,
	"rest": 40, "photo": 10, "zerog": 150, "fold": 120, "supernova_away": 100, "wave": 20, "ending": 1500, "arrive": 40}

## The Fold's transmissions: one a week from the season's start, the
## season's story. [week, title, [speaker, text]...]
const TRANSMISSIONS := {"s1": [
	[1, "A carrier wave", [["Fold signal", "…ong Song to Hearth. Long Song to Hearth. If anyone still keeps the fire, answer."],
		["Fold signal", "This is Sadie Marr. We left you a hundred years ago with the Engine's core. We are trying to bring it back."]]],
	[2, "What the Fold does to time", [["Sadie Marr", "Pell has worked it out. Inside the Fold a day for us is a year for you. We have been gone eight months. You have been waiting a century."],
		["Sadie Marr", "If you can hear this, the recorders we left are still singing. Good. Keep them singing. They are how we find you."]]],
	[3, "The raid", [["Sadie Marr", "We were tuning the core at a far star when they came. Salvagers, young, hungry. Their leader had a voice like gravel and a name like a bird."],
		["Sadie Marr", "They took the core. They took half our fuel. We have been crawling home on the rest."]]],
	[4, "Hale", [["Sadie Marr", "A convoy captain answered us last week. Elias Hale. He says the core has been sold and sold again, and he has found it. He is bringing it home on a ship called the Aster."],
		["Sadie Marr", "He says there is a woman at Hearth called Mara who will not forgive him for being late. He seemed happy about it."]]],
	[5, "The Aster is silent", [["Sadie Marr", "The Aster stopped answering. Hale's last words were coordinates: Ashfall, the grey moon."],
		["Pell", "Sadie has not slept. I have burned the bread. Some things do not change, a hundred years or eight months."]]],
	[6, "The song is wrong", [["Pell", "The Engine is singing. We can hear it from here: the same twenty-two minutes, over and over, like a needle stuck in a groove."],
		["Sadie Marr", "It only does that without its core. Someone is living the morning again and again, and does not know why."]]],
	[7, "Someone remembers", [["Sadie Marr", "Each time the song turns, a second voice turns with it. Someone who carries the Engine's note. Someone in a small ship, patched, cream and rust."],
		["Sadie Marr", "Pilot. If that is you: take the core to the Engine. Do not give it to the man who sounds like gravel."]]],
	[8, "Rook", [["Sadie Marr", "There is another voice that turns with the song. Older. Tired. It is the one who raided us. He has been living your morning longer than you have."],
		["Sadie Marr", "He does not want to stop the loop, pilot. He wants to own it."]]],
	[9, "The Fold opens", [["Pell", "We have found the way out. The Fold opens at the Lantern's last breath, the way a door opens when the house goes cold."],
		["Sadie Marr", "We will come through when the Reach is darkest. Watch the Fold, all of you. Every one of you who remembers."]]],
	[10, "We see the Lantern", [["Sadie Marr", "We see the Lantern. It is smaller than I remember. Redder. Tired."],
		["Sadie Marr", "Saturday the twenty-third of January, nineteen hundred hours by the old clock. Look to the Fold. We are coming home."]]],
]}

# --- Time -------------------------------------------------------------------

static var _offset := NAN

## Now, by the real clock (UTC). `?seasonnow=<unix>` in the browser or
## `-- --seasonnow <unix>` pretends another moment, for looking at a week
## or the live event before it happens.
static func now() -> float:
	if is_nan(_offset):
		_offset = 0.0
		var want := ""
		var args := OS.get_cmdline_user_args()
		var i := args.find("--seasonnow")
		if i >= 0 and i + 1 < args.size():
			want = args[i + 1]
		elif OS.has_feature("web"):
			var q := str(JavaScriptBridge.eval("location.search", true))
			var m := RegEx.create_from_string("seasonnow=(\\d+)").search(q)
			if m:
				want = m.get_string(1)
		if want != "":
			_offset = float(want) - Time.get_unix_time_from_system()
	return Time.get_unix_time_from_system() + _offset

static func unix(iso: String) -> float:
	if iso == "":
		return INF
	return float(Time.get_unix_time_from_datetime_string(iso))

## Whether the season's ending event has a date yet.
static func scheduled() -> bool:
	return current().event != ""

## The season running now (the last one if they have all begun).
static func current() -> Dictionary:
	var t := now()
	var pick: Dictionary = SEASONS[0]
	for s: Dictionary in SEASONS:
		if t >= unix(s.start):
			pick = s
	return pick

static func event_at() -> float:
	return unix(current().event)

## The first season's event: the Homecoming, which leaves the Long Song in
## the Reach for good.
static func homecoming_at() -> float:
	return unix(SEASONS[0].event)

static func week() -> int:
	return int(floor((now() - unix(current().start)) / WEEK)) + 1

## "3d 4h", "4h 12m", "12m 05s".
static func span(seconds: float) -> String:
	var s := int(maxf(seconds, 0.0))
	if s >= 86400:
		return "%dd %dh" % [s / 86400, (s % 86400) / 3600]
	if s >= 3600:
		return "%dh %dm" % [s / 3600, (s % 3600) / 60]
	return "%dm %02ds" % [s / 60, s % 60]

# --- Saved ------------------------------------------------------------------

static func _key(name: String) -> String:
	return "season_%s_%s" % [current().id, name]

static func xp() -> int:
	return int(Flow.progress(_key("xp"), 0))

static func tier() -> int:
	return mini(TIERS, xp() / TIER_XP + 1)

## Everything won in any season, and what is worn.
static func owned(kind: String) -> Array:
	var have = Flow.progress("season_owned_" + kind, [])
	var list: Array = have if have is Array else []
	var first: String = {"livery": "hearth", "flame": "campfire", "title": "traveller"}[kind]
	if not first in list:
		list.push_front(first)
	return list

static func equipped(kind: String) -> String:
	var e := str(Flow.progress("season_wear_" + kind, ""))
	return e if e in owned(kind) else owned(kind)[0]

static func wear(kind: String, id: String) -> void:
	if id in owned(kind):
		Flow.set_progress("season_wear_" + kind, id)
		_notify()

static func reward_name(r: Array) -> String:
	match r[0]:
		"livery": return "Kestrel paint: %s" % LIVERIES[r[1]][0]
		"flame": return "Campfire: %s" % FLAMES[r[1]][0]
		"title": return "Echo title: %s" % TITLES[r[1]]
	return ""

# --- Earning ------------------------------------------------------------------

## Something happened that the season counts: starlight for it, the week's
## challenges moved on, and a tier's reward when one is reached.
static func note(what: String, once_key := "") -> void:
	if Reach._testing(OS.get_cmdline_user_args()) and not "--seasontest" in OS.get_cmdline_user_args():
		return
	if once_key != "":
		var done = Flow.progress("season_once", [])
		var list: Array = done if done is Array else []
		if once_key in list:
			return
		list.append(once_key)
		Flow.set_progress("season_once", list)
	var gain := int(XP.get(what.get_slice(":", 0), XP.get(what, 0)))
	var words := ""
	# The week's challenges.
	var counts = Flow.progress(_week_key(), {})
	var c: Dictionary = counts if counts is Dictionary else {}
	for id: String in this_week():
		var ch: Array = CHALLENGES[id]
		if ch[0] != what:
			continue
		var before := int(c.get(id, 0))
		if before >= int(ch[1]):
			continue
		c[id] = before + 1
		if before + 1 >= int(ch[1]):
			gain += int(ch[2])
			words = "Challenge complete: %s" % ch[3]
	Flow.set_progress(_week_key(), c)
	if gain > 0:
		add(gain, words)

static func add(gain: int, words := "") -> void:
	var was := tier()
	Flow.set_progress(_key("xp"), xp() + gain)
	var now_t := tier()
	var hud := _hud()
	if hud:
		hud.starlight(gain, words, now_t, float(xp() % TIER_XP) / TIER_XP)
	for t in range(was + 1, now_t + 1):
		if REWARDS.has(t):
			var r: Array = REWARDS[t]
			var have := owned(r[0])
			if not r[1] in have:
				have.append(r[1])
				Flow.set_progress("season_owned_" + r[0], have)
			if hud:
				hud.tier_up(t, reward_name(r))
		elif hud:
			hud.tier_up(t, "")
	_notify()

static func _hud() -> ReachHud:
	var r := Engine.get_main_loop() as SceneTree
	var reach := r.get_first_node_in_group("reach_root") if r else null
	return reach.hud if reach and reach.get("hud") else null

static func _notify() -> void:
	var r := Engine.get_main_loop() as SceneTree
	if r:
		r.call_group("season_watch", "season_changed")

static func _week_key() -> String:
	return _key("w%d" % week())

## The week's three, the same for everyone: picked by the week's number.
static func this_week() -> Array:
	var ids := CHALLENGES.keys()
	ids.sort()
	var rng := RandomNumberGenerator.new()
	rng.seed = hash("%s-%d" % [current().id, week()])
	var pick: Array = []
	while pick.size() < 3:
		var id: String = ids[rng.randi() % ids.size()]
		if not id in pick:
			pick.append(id)
	return pick

static func progress_of(id: String) -> int:
	var counts = Flow.progress(_week_key(), {})
	return int((counts as Dictionary).get(id, 0)) if counts is Dictionary else 0

## The transmissions received so far (this season's, by the week).
static func transmissions() -> Array:
	var out: Array = []
	for tr: Array in TRANSMISSIONS.get(current().id, []):
		if int(tr[0]) <= week():
			out.append(tr)
	return out

static func heard(n: int) -> bool:
	return int(Flow.progress(_key("heard"), 0)) >= n

static func mark_heard(n: int) -> void:
	if not heard(n):
		Flow.set_progress(_key("heard"), n)
