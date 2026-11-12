class_name Lore
## What can be learned in the Reach, and the people who say it. Knowledge is
## all that survives the loop: facts learned are saved (Flow progress
## "reach_facts") and the ship's log shows them, place by place, with the
## rumours that point from one place to the next.

const PLACES := {
	"hearth": {"title": "Hearth Village", "body": "hearthstone", "pos": Vector2(0.0, 0.0)},
	"verdance": {"title": "Verdance", "body": "verdance", "pos": Vector2(1.0, -0.55)},
	"ashfall": {"title": "The Aster's Wreck", "body": "ashfall", "pos": Vector2(1.05, 0.55)},
	"phantom": {"title": "The Phantom", "body": "phantom", "pos": Vector2(-0.95, -0.55)},
	"wanderer": {"title": "The Wanderer", "body": "wanderer", "pos": Vector2(-0.95, 0.55)},
	"nadir": {"title": "The Nadir", "body": "nadir", "pos": Vector2(0.0, 1.05)},
}

## id: [place, text, leads to (a place this is a rumour of, or "")]
const FACTS := {
	"hearth_crash": ["hearth", "Your Kestrel came down outside Hearth three days ago, burning, half an hour after the Aster's distress call. The village pulled you out.", ""],
	"hearth_codes": ["hearth", "Mara gave you the Kestrel's launch codes (Okafor left them with her). She waits on top of the launch tower: the lift at its foot goes up.", ""],
	"hearth_loop": ["hearth", "You woke at the campfire again, the same morning. Nobody else remembers.", ""],
	"hearth_meteor": ["hearth", "Stones fall on Hearthstone every morning from eight: the Lantern is shedding. Where they land they leave starstones, still warm.", ""],
	"hearth_rimrun": ["hearth", "Isa keeps a ring course in the crater, the Rim Run: the Kestrel through every ring, against the clock.", ""],
	"hearth_zerog": ["hearth", "You flew the five rings in the Zero-G cave, on the crater floor. The jetpack is second nature now.", ""],
	"hearth_lantern": ["hearth", "Okafor says the Lantern is dying: it flickered three nights ago and has been swelling since.", ""],
	"hearth_choir": ["hearth", "The Founders, Hearth's first settlers a century ago, left recorders all over the Reach, still playing. Okafor's player plays them.", ""],
	"hearth_phantom": ["hearth", "Fen says the small moon nearest the Lantern won't stay put. Okafor swears it moves when nobody is looking.", "phantom"],
	"hearth_renn": ["hearth", "A suit beacon on Verdance, at a camp under a waterfall: someone from the Aster is alive down there.", "verdance"],
	"hearth_vex": ["hearth", "Vex, a salvager, works the Aster's wreck on Ashfall. She plays hand drums when she thinks no one can hear.", "ashfall"],
	"hearth_songline": ["hearth", "A Founders' recording deep in the old mine: \"The Wanderer carries the Engine. At its nearest pass to the Lantern, its door opens.\"", "wanderer"],
	"verd_renn": ["verdance", "Renn Ayers is alive. Her escape pod came down on Verdance; she hides at a camp under the falls.", ""],
	"verd_sold": ["verdance", "Renn sold the Aster's route to Rook to clear her brother's debt. Rook promised no one would be hurt.", ""],
	"verd_cargo": ["verdance", "Renn says the Aster's \"vaccine\" crates hummed. Hale knew what was in them, and his bridge recorder will say.", "ashfall"],
	"verd_engine": ["verdance", "The Founders' pillar city: \"The Engine sings back the last twenty-two minutes, over and over, until it is given a core.\"", "wanderer"],
	"verd_why": ["verdance", "Another recording in the pillars: \"Those who carry the Engine's song in them remember. The rest begin again.\" Your Kestrel's recorder hums the same note.", ""],
	"ash_vex": ["ashfall", "Vex salvages the Aster. Rook's drones guard the wreck and sweep it with searchlights; stay out of their light.", ""],
	"ash_hale": ["ashfall", "Hale's recorder: the crates hold the Founders' core, lost beyond the Fold a century ago and bought back by Hale to bring it home. Rook wants it. The cargo vault's code is 0412.", ""],
	"ash_core": ["ashfall", "You took the Founders' core from the Aster's vault. It hums like their recordings.", ""],
	"ash_rook": ["ashfall", "Rook, on the drones' channel: \"Let the pilot dig. They'll carry it where I can't.\"", ""],
	"ph_moves": ["phantom", "The Phantom was not where it had been when you looked away.", ""],
	"ph_photo": ["phantom", "Fen worked it out: lock onto the Phantom with the Kestrel (T) and it holds still while the lock holds.", ""],
	"ph_shrine": ["phantom", "The Phantom's recording: \"Board the Wanderer as it passes Periapsis Zero, the core in hand, and give it to the Engine.\"", "wanderer"],
	"ash_rook_loops": ["ashfall", "Rook remembers. He has been living this morning longer than you have, and every morning he waits for someone to open the vault for him.", ""],
	"wan_rook": ["wanderer", "At the Engine, Rook made his offer: the core for a place on his carrier through the Fold, for you and for Hearth. He has never been known to keep one.", ""],
	"wan_door": ["wanderer", "The Engine's door on the Wanderer is sealed. It opens only around Periapsis Zero, the Wanderer's closest pass to the Lantern: from 20:00 to 21:15 on the clock.", ""],
	"wan_end": ["wanderer", "You gave the Engine the core.", ""],
	"hearth_nadir": ["hearth", "Okafor's telescope keeps finding a ring of bent starlight at the Reach's edge, where a thread of gold runs out of the Lantern. Something there is heavier than a star.", "nadir"],
	"nad_well": ["nadir", "The Nadir: a black hole at the edge of the Reach, the Lantern's light pouring into it. Near it time runs slow. Every minute down there, the clock outside races on.", ""],
	"nad_tock": ["nadir", "Tock, the Ferreiras' robot, keeps a relay buoy at the Nadir's lip. He has counted a hundred and four years since the Tern went down. For the family, it has been eleven hours.", ""],
	"nad_tern": ["nadir", "The Tern holds still three hundred metres over the Nadir, on the last of her fuel. Pip Ferreira, eleven, keeps watch while her parents sleep. For her, the Founders left Hearth this morning.", ""],
	"nad_gleam": ["nadir", "Abe Ferreira's log: the Lantern is not old, it is being drunk. The gleam, motes of living light, feed on it and carry its light down into the Nadir. The one thing they flee is the Engine's song.", ""],
	"nad_message": ["nadir", "Pip heard Tock's count, all of it. She gave you three words to carry back up to him: come home, Tock.", ""],
	"wan_song": ["wanderer", "The Engine will not wake for a core alone. It has to be sung to, and the Founders hid its song in five parts, one on each world they touched: the Phantom, Hearth, Ashfall, Verdance and the Nadir.", ""],
	"wan_order": ["wanderer", "The Engine's own recording: sing the parts in order, from the world nearest the Lantern out to the dark. (The map, M, shows whose orbit is whose.)", ""],
	"wan_broken": ["wanderer", "You sang the Engine a wrong song. It went dark, and the clock leapt two minutes on.", ""],
	"song_phantom": ["phantom", "The Phantom's part of the Engine's song: glass.", ""],
	"song_hearth": ["hearth", "Past the fifth ring of the Zero-G cave, a Founders' carving: Hearth's part of the Engine's song is ember.", ""],
	"song_ashfall": ["ashfall", "Carved on the core's cradle in the Aster's vault, older than the ship: Ashfall's part of the Engine's song is iron.", ""],
	"song_verdance": ["verdance", "On the high pillar: Verdance's part of the Engine's song is rain.", ""],
	"song_nadir": ["nadir", "Abe's log: the Founders' song for the Nadir, the note the gleam flee, is deep.", ""],
	"keep_found": ["hearth", "Beside the old mine lies a machine of no make you know, thrown down the night you fell. Its light still turns. It could be mended with ferrite and lumen.", ""],
	"keep_mended": ["hearth", "You mended the fallen machine. The Keeper goes where you go now, and it remembers every morning, as you do.", ""],
	"keep_makers": ["wanderer", "The Keeper, at the Engine: its makers built the Engine to hold a dying star's last morning until help could come, and set it to keep it. The Founders did not build the Engine. They found it.", ""],
	"keep_core": ["ashfall", "The Keeper followed the core for a hundred years, through the Fold and back, and rode the Aster's vault beside it. It was thrown clear over Hearthstone the night she fell.", ""],
	"nad_together": ["nadir", "Tock left the buoy and let the Nadir take him down to the Tern. For him it was a long fall. For the Ferreiras, he was home in a minute.", ""],
}

# --- The Choir's songlines --------------------------------------------------
#
# A songline is a conversation carved as branching spirals: each verse is
# [speaker, text, the verse it answers (-1 for the first), fact learned
# when read ("" none)]. The translator reads them (Translator).

const SONGLINES := {
	"mine": {"title": "Recording: the old mine", "verses": [
		["Ilse", "The Lantern is tired. We have measured its breathing for a hundred years, and every year it breathes more slowly.", -1, ""],
		["Sadie", "Then we have less time than we thought. Is the Engine ready?", 0, ""],
		["Ilse", "Nearly. We have set it aboard the Wanderer. At the Wanderer's nearest pass to the Lantern, its door opens to us.", 1, "hearth_songline"],
		["Orrin", "Who dug this tunnel? Ilse, your small digging has come up through my garden.", 0, ""],
	]},
	"pillars": {"title": "Recording: the pillar city", "verses": [
		["Tamsin", "Today we woke the Engine for the first time. It sang the last twenty-two minutes back to us, and we lived them again.", -1, ""],
		["Pell", "I lived them three times. I burned my bread three times. I would like to stop now.", 0, ""],
		["Tamsin", "The Engine sings back the last twenty-two minutes, over and over, until it is given a core. Without one it can only repeat. With one, it can carry.", 0, "verd_engine"],
		["Venn", "Carry what?", 2, ""],
		["Tamsin", "Us. Out through the Fold, before the Lantern falls.", 3, ""],
	]},
	"pillar_top": {"title": "Recording: the high pillar", "verses": [
		["Orrin", "I climbed up here to be alone, and found Venn already here, being alone.", -1, ""],
		["Venn", "The Engine does not wake everyone. Those who carry its song in them remember each turning. The rest begin again, and never know.", 0, "verd_why"],
		["Orrin", "Then whoever remembers must be the one to finish it.", 1, ""],
		["Venn", "We sang Verdance's part of the Engine's song up here, where the falls begin. It is rain. Carry it down with you.", 1, "song_verdance"],
	]},
	"shrine": {"title": "Recording: the Phantom's shrine", "verses": [
		["Sadie", "The little moon will not hold still for us. Pell says it is shy. I say it is only quantum.", -1, ""],
		["Pell", "It holds still while it is seen. So we keep a picture of it, and fly.", 0, ""],
		["Sadie", "For whoever comes after us: board the Wanderer as it passes Periapsis Zero, the core in hand, and give it to the Engine.", 0, "ph_shrine"],
		["Pell", "And if no one comes?", 2, ""],
		["Sadie", "Then the Lantern falls, the morning comes back, and the song goes on without us.", 3, ""],
		["Pell", "And this little moon keeps its part of the Engine's song. Ours is glass. Say it back to the Engine, when the time comes: glass.", 1, "song_phantom"],
	]},
	"engine_door": {"title": "Recording: the Engine's door", "verses": [
		["Ilse", "The door stays sealed while the Wanderer is far from the Lantern, so the Engine keeps its warmth.", -1, ""],
		["Ilse", "It opens at Periapsis Zero, the Wanderer's closest pass, twenty minutes into the song, and closes at a quarter past. Do not be late. We were, once.", 0, "wan_door"],
		["Ilse", "And a core alone will not wake it. The Engine must be sung to. We hid its song in five parts, one on every world we touched: the Phantom, Hearth, Ashfall, Verdance and the Nadir. Gather them all.", 0, "wan_song"],
	]},
	"engine": {"title": "Recording: the Engine", "verses": [
		["Tamsin", "We never found a core of our own. We made one, long ago, and lost it on a journey far beyond the Fold.", -1, ""],
		["Sadie", "Perhaps someone will bring it back.", 0, ""],
		["Tamsin", "Then this is for them. Set the core in the Engine's heart. It will stop repeating the morning and sing the whole song once, all the way through.", 1, ""],
		["Tamsin", "But sing it first. Part by part, from the world nearest the Lantern out to the dark. Sung out of order, it will not listen.", 2, "wan_order"],
	]},
}

## Verses read ("id:n"), kept like facts.
static var _read: Array = []
static var _read_loaded := false

static func read(id: String, n: int) -> bool:
	if not _read_loaded:
		var r = Flow.progress("reach_read", [])
		_read = r if r is Array else []
		_read_loaded = true
	return ("%s:%d" % [id, n]) in _read

static func mark_read(id: String, n: int) -> void:
	if read(id, n):
		return
	_read.append("%s:%d" % [id, n])
	Flow.set_progress("reach_read", _read)
	Season.note("verse")

static func all_read(id: String) -> bool:
	for n in (SONGLINES[id].verses as Array).size():
		if not read(id, n):
			return false
	return true

static func known(id: String) -> bool:
	return id in _facts()

## Read from the save once, then kept (the log asks every frame).
static var _cache: Array = []
static var _loaded := false

static func _facts() -> Array:
	if not _loaded:
		var f = Flow.progress("reach_facts", [])
		_cache = f if f is Array else []
		_loaded = true
	return _cache

## Learn a fact (once). Returns true when it is new.
static func learn(id: String) -> bool:
	if not FACTS.has(id) or known(id):
		return false
	_facts().append(id)
	Flow.set_progress("reach_facts", _cache)
	Season.note("fact")
	if id == "wan_end":
		Season.note("ending", "ending")
	return true

static func place_known(place: String) -> bool:
	for id in _facts():
		if FACTS[id][0] == place:
			return true
	return false

## A place is rumoured when a known fact leads to it.
static func place_rumoured(place: String) -> bool:
	for id in _facts():
		if FACTS[id][2] == place:
			return true
	return false

static func forget_all() -> void:
	_cache = []
	_loaded = true
	Flow.set_progress("reach_facts", [])
	_read = []
	_read_loaded = true
	Flow.set_progress("reach_read", [])

# --- Who says what ----------------------------------------------------------
#
# A conversation: nodes of lines and choices. A line is [speaker, text]. A
# choice is [text, next node, "if" fact (shown only when known, "" always),
# "not" fact (hidden once known, "" never)]. "learn" teaches facts when the
# node's lines finish; "end" closes. "start" may redirect ("first", in
# order, the first that holds wins): a fact known, or "@who" for having
# talked to them already this loop.

const TALK := {
	"mara": {
		"start": {"first": [["hearth_loop", "again"], ["@mara", "short"]], "lines": [
			["Mara Voss", "There you are. Sleep well? You came down burning three days ago, pilot, half an hour after the Aster called mayday. We pulled you out of the cockpit."],
			["Mara Voss", "Your Kestrel's patched and fuelled, up on the launch tower. If anyone off the Aster is still alive out there, she's how you'll find them."],
			["Mara Voss", "Here: her launch codes. Okafor left them with me; he'd have kept you talking till noon. Take the lift at the foot of the tower and go and fly."],
			["Mara Voss", "When you're back, call on him at the observatory, the glass dome on the rise. He's been watching the Lantern, and he doesn't like what he sees."],
		], "learn": ["hearth_crash", "hearth_codes"], "choices": [
			["How do I get up to the ship?", "codes", "", ""],
			["What is this place?", "place", "", ""],
			["The Aster. Were there other survivors?", "aster", "", ""],
		]},
		"codes": {"lines": [
			["Mara Voss", "The lift at the foot of the tower: step on and it takes you up to her. The codes are in your suit now."],
			["Mara Voss", "Take it slow off the deck. Gravity's light here and the air is thin; she'll want to climb."],
		], "choices": [["Thank you, Mara.", "bye", "", ""]]},
		"place": {"lines": [
			["Mara Voss", "Hearth. Forty souls on a rock you can walk round before lunch. We mine the ice in the hills and sell it to whoever comes through the Fold."],
			["Mara Voss", "Which is nobody, mostly. The Reach is off every chart that matters. That's why we like it."],
		], "choices": [["How do I get up to the ship?", "codes", "", "hearth_codes"], ["The Aster?", "aster", "", ""], ["I'll look around.", "bye", "", ""]]},
		"aster": {"lines": [
			["Mara Voss", "We saw her come apart over Ashfall, the grey moon. Six ships in the convoy. Five burned in the Fold. She made it here and then she didn't."],
			["Mara Voss", "Elias Hale was her captain. I flew his wing for eleven years. If anyone could have brought her down whole, it was him."],
		], "choices": [["I'm sorry.", "bye", "", ""], ["How do I get up to the ship?", "codes", "", "hearth_codes"]]},
		"again": {"lines": [
			["Mara Voss", "You look like you've seen a ghost, pilot. Sit by the fire a minute. Your ship's up on the tower, same as she was."],
		], "choices": [
			["Mara, I've lived this morning before.", "loop", "hearth_loop", ""],
			["Hale left a recording. The vault code was 0412.", "hale", "ash_hale", ""],
			["What do you know about the Founders?", "choir", "", ""],
			["Thanks. I'll go.", "bye", "", ""],
		]},
		"hale": {"lines": [
			["Mara Voss", "Zero four one two. April the twelfth."],
			["Mara Voss", "The day Elias and I flew our first wing together. And the day, eleven years on, I told him I was done flying it."],
			["Mara Voss", "He kept that. Of course he did. Then whatever he locked away, pilot, it was worth more to him than his ship. Go and finish what he couldn't."],
		], "choices": [["I will.", "bye", "", ""]]},
		"loop": {"lines": [
			["Mara Voss", "...You mean that? Every morning the same, and you the only one who knows it."],
			["Mara Voss", "Okafor would say it's the Founders. He says that about everything. Ask him anyway. And whatever you're doing out there, do it faster."],
		], "choices": [["I'll try.", "bye", "", ""]]},
		"choir": {"lines": [
			["Mara Voss", "Hearth's first settlers, a hundred years back. They left recorders all over the Reach, still playing if you knock them. There's one down the old mine, past the lake."],
			["Mara Voss", "Okafor reads them. I just mine round them."],
		], "choices": [["Thanks.", "bye", "", ""]]},
		"short": {"lines": [["Mara Voss", "Okafor's up at the observatory, pilot. The lift's at the foot of the tower. The sky won't wait."]], "choices": [["Hale left a recording. The vault code was 0412.", "hale", "ash_hale", ""], ["The Founders?", "choir", "", ""], ["On my way.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Mara Voss", "Go on. The fire's here when you get back."]]},
	},
	"okafor": {
		"start": {"lines": [
			["Okafor", "Ah, the pilot who fell out of the sky. Come in, mind the telescope. Your launch codes: there, keyed into your suit. The Kestrel will answer to you now."],
			["Okafor", "Have a look round the stands before you go; they'll tell you more about the Reach than I can in a morning. I've been watching the Lantern, our star."],
			["Okafor", "Three nights ago it flickered. It's been swelling ever since. Stars don't do that, not on any clock we'd notice."],
			["Okafor", "As for the Aster's people: listen before you look. Your suit's signalscope, X. Start there."],
		], "learn": ["hearth_codes", "hearth_lantern", "hearth_nadir"], "choices": [
			["Can you help me find anyone else?", "scope", "", ""],
			["What are the old recorders I keep seeing?", "choir", "", ""],
			["Is the Lantern going to die?", "die", "", ""],
		]},
		"scope": {"lines": [
			["Okafor", "Your suit has a signalscope. Press X; the wheel, or Z and C, to change the frequency. On Distress you'll hear what's left of the Aster."],
			["Okafor", "Her bridge recorder on Ashfall, still talking. Vex salvages the wreck there: she knows it. And since three days ago, a suit beacon on Verdance. Somebody lived."],
		], "learn": ["hearth_renn", "hearth_vex"], "choices": [["The Founders?", "choir", "", ""], ["Thank you.", "bye", "", ""]]},
		"choir": {"lines": [
			["Okafor", "The Founders. Hearth's first settlers, a century gone. They talked to recorders the way we talk to each other, left them everywhere, and they built something they called the Engine."],
			["Okafor", "Your suit has my player in it now: look at a recorder and press E. There's one in the old mine. I've never got past its first track."],
		], "learn": ["hearth_choir"], "choices": [["The Lantern?", "die", "", ""], ["Thank you.", "bye", "", ""]]},
		"die": {"lines": [
			["Okafor", "Everything dies, pilot. But this one is in a hurry. If I had to guess, a day. Maybe less."],
			["Okafor", "Fen keeps telling me the little moon by the Lantern moves when no one looks at it. I keep telling Fen to look at it. Fen says that's the point."],
		], "learn": ["hearth_phantom"], "choices": [["Thank you.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Okafor", "Clear skies. While we have them."]]},
	},
	"fen": {
		"start": {"lines": [
			["Fen", "You're the crash! I helped carry you. You were heavier than you look."],
			["Fen", "Have you seen the little moon? The purple one, close to the Lantern. It moves. I looked away and it was somewhere else."],
		], "learn": ["hearth_phantom"], "choices": [["Maybe you blinked.", "blink", "", ""], ["How do you catch it?", "catch", "", ""]]},
		"blink": {"lines": [["Fen", "Okafor said that too. But the barges' radar held it. Locked on, and it STAYED. Because something kept measuring it. That's what I think."]], "learn": ["ph_photo"], "choices": [["Smart.", "bye", "", ""]]},
		"catch": {"lines": [["Fen", "Lock onto it! In your ship, look at it and press T. The lock keeps it measured, and measured, it can't jump. That's my theory. Somebody's stuck up there, too. Go and get them."]], "learn": ["ph_photo"], "choices": [["I will.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Fen", "Bye! Don't crash again!"]]},
	},
	"miner": {
		"start": {"lines": [
			["Tull", "Ice in the hills, ice in the hills. Forty years. The Lantern used to be whiter, you know. Now look at it. Gone all orange in the face."],
			["Tull", "Old mine's past the lake, if you're the curious kind. Old recorder on the far wall. Never liked the way it hums."],
		], "choices": [["Thanks, Tull.", "", "", ""]]},
	},
	"hauler": {
		"start": {"lines": [
			["Isa", "Your ship's the talk of the village. Nobody's flown a fighter through the Fold in years. Mostly it's ice barges and regret."],
			["Isa", "If you go to Ashfall, mind the drones. They showed up with the wreck and they haven't left."],
		], "choices": [["I'll be careful.", "", "", ""]]},
	},
	"renn": {
		"start": {"first": [["verd_sold", "known"]], "lines": [
			["Renn Ayers", "...Kestrel? You're alive. God. I heard the harmonica carry and I thought, someone will come, but I didn't think it'd be you."],
			["Renn Ayers", "My pod came down here. I've been living on rainwater and guilt."],
		], "learn": ["verd_renn"], "choices": [["Renn, why did the Hollow know our route?", "sold", "", ""], ["Are you hurt?", "hurt", "", ""]]},
		"hurt": {"lines": [["Renn Ayers", "Not where you can see. Ask me the thing you came to ask, Kestrel."]], "choices": [["Who sold the route?", "sold", "", ""]]},
		"sold": {"lines": [
			["Renn Ayers", "I did. I sold it to Rook. My brother owed him more than he'd ever earn, and Rook said he'd take cargo, not lives."],
			["Renn Ayers", "I went aft before the attack. I launched the pod. I watched the Aster burn from inside a window the size of my hand."],
		], "learn": ["verd_sold"], "choices": [["What did Rook want so badly?", "cargo", "", ""]]},
		"cargo": {"lines": [
			["Renn Ayers", "The manifest said vaccine. But I stood next to those crates for a week, and they hummed. Like singing, under the engines."],
			["Renn Ayers", "Hale knew. He wouldn't say. If his bridge recorder survived on Ashfall, it'll say what he wouldn't."],
			["Renn Ayers", "And the old recorder in the pillars here hums the same note. Go and listen."],
		], "learn": ["verd_cargo"], "choices": [["I'll find it.", "bye", "", ""]]},
		"known": {"lines": [
			["Renn Ayers", "...You look at me like you already know. You do, don't you. The route. Rook. All of it."],
		], "choices": [["Tell me again what Rook wanted.", "cargo", "", ""], ["Does Rook remember too?", "rook", "ash_rook_loops", ""], ["Not now.", "bye", "", ""]]},
		"rook": {"lines": [
			["Renn Ayers", "...He called me. Three mornings ago, the first time, he said: 'Again, Ayers.' I didn't know what he meant. I do now."],
			["Renn Ayers", "He touched it, Kestrel. When the Hollow boarded, before Hale got it into the vault. Whatever's in that core sang to him too. He's been doing this longer than you."],
		], "choices": [["Then I'll be faster.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Renn Ayers", "I'm not going anywhere. I don't think any of us are."]]},
	},
	"hale_rec": {
		"start": {"lines": [
			["Hale's recorder", "...recording. This is Elias Hale, master of the Aster. We are coming down on Ashfall. The Hollow were waiting at the Fold. Somebody sold our route."],
			["Hale's recorder", "For whoever finds this: the vaccine crates are a cover. There is one crate that matters. It holds the Founders' core, dug out of the Moon's south pole, and Rook wants it more than he wants any of us."],
			["Hale's recorder", "I have locked it in the cargo vault. The code is zero four one two. Mara will know why."],
			["Hale's recorder", "Mara, if this reaches you: I'm sorry about the wing. Keep the fire lit. ...End recording."],
		], "learn": ["ash_hale"], "end": true},
	},
	"engine_song": {
		"start": {"lines": [["The Engine", "The core settles into the socket and the Engine waits, humming. Sing it its song, one part at a time."]], "choices": [["Rain", "broken", "song_verdance", ""], ["Deep", "broken", "song_nadir", ""], ["Ember", "broken", "song_hearth", ""], ["Glass", "s2", "song_phantom", ""], ["Iron", "broken", "song_ashfall", ""], ["Not yet.", "wait", "", ""]]},
		"s2": {"lines": [["The Engine", "The first part rings round the chamber. The rings stir."]], "choices": [["Rain", "broken", "song_verdance", ""], ["Deep", "broken", "song_nadir", ""], ["Ember", "s3", "song_hearth", ""], ["Glass", "broken", "song_phantom", ""], ["Iron", "broken", "song_ashfall", ""], ["Not yet.", "wait", "", ""]]},
		"s3": {"lines": [["The Engine", "Two parts. The ribs of light climb the walls."]], "choices": [["Rain", "broken", "song_verdance", ""], ["Deep", "broken", "song_nadir", ""], ["Ember", "broken", "song_hearth", ""], ["Glass", "broken", "song_phantom", ""], ["Iron", "s4", "song_ashfall", ""], ["Not yet.", "wait", "", ""]]},
		"s4": {"lines": [["The Engine", "Three. The Engine is singing along now."]], "choices": [["Rain", "s5", "song_verdance", ""], ["Deep", "broken", "song_nadir", ""], ["Ember", "broken", "song_hearth", ""], ["Glass", "broken", "song_phantom", ""], ["Iron", "broken", "song_ashfall", ""], ["Not yet.", "wait", "", ""]]},
		"s5": {"lines": [["The Engine", "Four. One part left."]], "choices": [["Rain", "broken", "song_verdance", ""], ["Deep", "sung", "song_nadir", ""], ["Ember", "broken", "song_hearth", ""], ["Glass", "broken", "song_phantom", ""], ["Iron", "broken", "song_ashfall", ""], ["Not yet.", "wait", "", ""]]},
		"sung": {"outcome": "sung", "end": true, "lines": [["The Engine", "The fifth part, and the whole song at once. The chamber is full of light, and the Engine is listening."]]},
		"broken": {"outcome": "broken", "learn": ["wan_broken"], "end": true, "lines": [["The Engine", "Wrong. The note grinds against the others and the song breaks. The rings stop. The light goes out of the walls."]]},
		"wait": {"end": true, "lines": [["The Engine", "It hums on, waiting."]]},
	},
	"engine_choice": {
		"start": {"lines": [
			["Rook", "Pilot. Before you put it in. Hear me, once. I've listened to you every morning; you can listen to me this one."],
			["Rook", "That machine stops the morning. Fine. It also sends Hearth through the Fold in barges built for ice, behind a star going out. Half of them won't make it."],
			["Rook", "Give the core to my drone, and my carrier takes the whole village through, and you. Clean. You'd never have to see this morning again."],
		], "learn": ["wan_rook"], "choices": [
			["Give the Engine the core.", "engine", "", ""],
			["Take Rook's offer.", "rook", "", ""],
			["Not yet.", "wait", "", ""],
		]},
		"engine": {"outcome": "engine", "end": true, "lines": [["You", "Mara's barges have made it through worse. Goodbye, Rook."]]},
		"rook": {"outcome": "rook", "end": true, "lines": [["Rook", "Sensible. I always knew you would be, eventually. Hold it up."]]},
		"wait": {"end": true, "lines": [["Rook", "Take your time. You and I have nothing else."]]},
	},
	"vex": {
		"start": {"lines": [
			["Vex", "Careful where you put your feet, pilot. Rook's drones sweep this wreck every couple of minutes. Get caught in their light and they shoot."],
			["Vex", "I'm Vex. I take what nobody's using. The Aster has a lot nobody's using now."],
		], "learn": ["ash_vex"], "choices": [["Hale's recorder. Where is it?", "core", "", ""], ["Rook's drones?", "rook", "", ""]]},
		"core": {"lines": [
			["Vex", "Hear that ping? Tune your scope to Distress. The bridge section is down in the crater, past the cargo spine. The captain's recorder is still talking."],
			["Vex", "The vault's in the cargo spine too. Sealed tight. I've been at it for days. Needs a code, and the captain took it with him."],
		], "choices": [["Rook's drones?", "rook", "", ""], ["Thanks.", "bye", "", ""]]},
		"rook": {"lines": [["Vex", "They came the day the Aster fell. They don't take anything. They just watch the vault. Like they're waiting for someone to open it for them."]], "choices": [["Thanks.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Vex", "Stay out of the light."]]},
	},
	"tock": {
		"start": {"first": [["nad_together", "again"], ["nad_message", "message"], ["@tock", "short"]], "lines": [
			["Tock", "A visitor. A visitor! Hello. Forgive me: I have not said hello in one hundred and four years, two hundred and nine days and eleven hours. I kept count. Counting is what I am for."],
			["Tock", "I am Tock. I belong to the Ferreiras. Their skiff, the Tern, is down there, three hundred metres over the Nadir. Look down. The small light, holding still."],
			["Tock", "Abe took her down after the gleam. He said: Tock, stay at the lip and keep the relay lit. We will be an hour."],
		], "learn": ["nad_well"], "choices": [["An hour?", "hour", "", ""], ["What is the gleam?", "gleam", "", ""]]},
		"gleam": {"lines": [
			["Tock", "The lights in the river, there: running out of the Lantern, all the way here, and down. Abe called them the gleam. He said they are why the Lantern is dimming, and that he would find out how."],
		], "choices": [["An hour, you said?", "hour", "", ""]]},
		"hour": {"lines": [
			["Tock", "Near the Nadir, time goes slowly. They went deep, nearly to the edge, and their one hour was all of my hundred years. Now they hold higher, on the last of their fuel. Each of their minutes is six of mine."],
			["Tock", "For them it is still the morning the Founders left Hearth. Pip will be twelve tomorrow. I made her a present. It took me forty years."],
		], "learn": ["nad_tock"], "choices": [["I'll go down to them.", "go", "", ""], ["Why don't you go?", "why", "", ""]]},
		"why": {"lines": [["Tock", "Abe told me to stay. I am very good at being told to stay."]], "choices": [["I'll go down to them.", "go", "", ""]]},
		"go": {"end": true, "lines": [
			["Tock", "Then take my count down with you. All of it. Tell Pip I kept it."],
			["Tock", "And land on her deck, not past it. Under the Tern the Nadir does not give anything back. Not light. Not you."],
		]},
		"short": {"end": true, "lines": [["Tock", "The Tern is the small light under us. Every minute down there is six up here. Go carefully."]]},
		"message": {"lines": [
			["Tock", "You went down. You are back already: for you, minutes. For them, less than one. ...Did she hear it? The count?"],
			["You", "All of it. She said: come home, Tock."],
			["Tock", "...Come home."],
			["Tock", "I would fall slowly, the whole way, and for me it would take a long time. For them I would arrive in a minute. That is the best arithmetic I have ever done."],
		], "choices": [["Go home, Tock.", "fall", "", ""], ["Wait. Not yet.", "wait", "", ""]]},
		"fall": {"end": true, "learn": ["nad_together"], "outcome": "tock_falls", "lines": [["Tock", "Keep the relay lit for me. It is the only thing I was ever told to do that I am stopping."]]},
		"wait": {"end": true, "lines": [["Tock", "I have waited a hundred years. I can wait while you decide."]]},
		"again": {"lines": [
			["Tock", "You look at me as though you know me. Strange: I feel I have just been told something wonderful, and I cannot remember what."],
		], "choices": [["Pip says: come home, Tock.", "fall", "", ""]]},
	},
	"pip": {
		"start": {"first": [["nad_message", "after"], ["@pip", "short"]], "lines": [
			["Pip", "Who's there? Who are you? You're not from the ark. Is that a ship? Nobody has a ship like that."],
			["Pip", "I'm Pip. I'm on watch. Mum and Dad are asleep; they've been awake since we left Hearth this morning. Dad says we can go home as soon as he's finished counting the gleam."],
			["Pip", "Did Gran send you? Tell her the Lantern's light all goes into the hole. Dad worked it out. He's put it in his log, there on the console."],
		], "learn": ["nad_tern"], "choices": [["Pip, how long do you think you've been down here?", "time", "", ""], ["Tock sent me.", "tock", "nad_tock", ""]]},
		"time": {"lines": [
			["Pip", "Eleven hours. Dad's clock says so. Why?"],
			["You", "Up there, it's been a hundred and four years."],
			["Pip", "...That isn't funny."],
			["Pip", "That isn't funny. Gran's at home. Gran was waving. I saw her waving."],
		], "choices": [["Tock sent me.", "tock", "nad_tock", ""], ["I'm sorry.", "sorry", "", ""]]},
		"sorry": {"end": true, "lines": [["Pip", "Go away. Go and tell Gran we're coming. Go and tell her."]]},
		"tock": {"lines": [
			["Pip", "Tock? Tock's at the buoy. He's keeping the light on. Is he all right?"],
			["You", "He kept count for you. One hundred and four years, two hundred and nine days, eleven hours. He made you a present. It took him forty years."],
			["Pip", "...He's been on his own all that time? Just waiting? Because Dad told him to?"],
			["Pip", "Tell him to come home. Tell him: come home, Tock. We'll make room. Dad can fix anything with Tock helping."],
		], "learn": ["nad_message"], "end": true},
		"after": {"end": true, "lines": [["Pip", "Did you tell him? Is he coming? I'm watching the window. I'll see him first, I always do."]]},
		"short": {"end": true, "lines": [["Pip", "Dad's log is on the console. He'd want somebody to read it."]]},
	},
	"abe_log": {
		"start": {"lines": [
			["Abe's log", "Ferreira, Abe. Survey skiff Tern. Eleventh hour. We've followed the gleam from the Lantern all the way down. Nell's flying; Pip's on the scope and won't sleep."],
			["Abe's log", "My mother has measured the Lantern's breathing all her life and thinks it is ageing. It isn't. It's being drunk. The gleam are alive: a bloom, feeding on its light, carrying it here, and spending it in the Nadir."],
			["Abe's log", "We can't kill them. There are more of them than stars. But they scatter from one sound, every time: the note the Founders' Engine sings. If the Engine ever sang for good, they'd go, and the Lantern would breathe again."],
			["Abe's log", "Mum taught Pip the Founders' word for this place when she was tiny, the Nadir's part of their song. Deep. Pip sang it at the window and the gleam broke apart like startled fish."],
			["Abe's log", "We went too deep to get a clean count. Something's wrong with the clock. Climbing back now, on what fuel we have. Tock will have kept the relay lit. He always does. ...End log."],
		], "learn": ["nad_gleam", "song_nadir"], "end": true},
	},
}
