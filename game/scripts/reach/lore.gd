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
	"hearth_choir": ["hearth", "The Choir lived in the Reach before anyone. Their writing spirals; Okafor's translator reads it.", ""],
	"hearth_phantom": ["hearth", "Fen says the small moon nearest the Lantern won't stay put. Okafor swears it moves when nobody is looking.", "phantom"],
	"hearth_renn": ["hearth", "A new player on the Travellers frequency: a harmonica, somewhere on Verdance. Nobody in Hearth plays one.", "verdance"],
	"hearth_vex": ["hearth", "Vex, a salvager, works the Aster's wreck on Ashfall. She plays hand drums when she thinks no one can hear.", "ashfall"],
	"hearth_songline": ["hearth", "A songline deep in the old mine: \"The Wanderer carries the Engine. At its nearest pass to the Lantern, its door opens.\"", "wanderer"],
	"verd_renn": ["verdance", "Renn Ayers is alive. Her escape pod came down on Verdance; she hides at a camp under the falls.", ""],
	"verd_sold": ["verdance", "Renn sold the Aster's route to Rook to clear her brother's debt. Rook promised no one would be hurt.", ""],
	"verd_cargo": ["verdance", "Renn says the Aster's \"vaccine\" crates hummed. Hale knew what was in them, and his bridge recorder will say.", "ashfall"],
	"verd_engine": ["verdance", "The Choir's pillar city: \"The Engine sings back the last twenty-two minutes, over and over, until it is given a core.\"", "wanderer"],
	"verd_why": ["verdance", "Another songline in the pillars: \"Those who carry the Engine's song in them remember. The rest begin again.\" Your Kestrel's recorder hums the same note.", ""],
	"ash_vex": ["ashfall", "Vex salvages the Aster. Rook's drones guard the wreck and sweep it with searchlights; stay out of their light.", ""],
	"ash_hale": ["ashfall", "Hale's recorder: the crates hold a Choir core dug from the Moon. Rook wants it. The cargo vault's code is 0412.", ""],
	"ash_core": ["ashfall", "You took the Choir core from the Aster's vault. It hums like the songlines.", ""],
	"ash_rook": ["ashfall", "Rook, on the drones' channel: \"Let the pilot dig. They'll carry it where I can't.\"", ""],
	"ph_moves": ["phantom", "The Phantom was not where it had been when you looked away.", ""],
	"ph_photo": ["phantom", "Fen thinks a photograph (P) holds the Phantom still: it stays put while the picture is kept.", ""],
	"ph_shrine": ["phantom", "The Phantom's shrine: \"Board the Wanderer as it passes Periapsis Zero, the core in hand, and give it to the Engine.\"", "wanderer"],
	"wan_door": ["wanderer", "The Engine's door on the Wanderer is sealed. It opens only at Periapsis Zero, the Wanderer's closest pass to the Lantern, at about 20:30.", ""],
	"wan_end": ["wanderer", "You gave the Engine the core.", ""],
}

# --- The Choir's songlines --------------------------------------------------
#
# A songline is a conversation carved as branching spirals: each verse is
# [speaker, text, the verse it answers (-1 for the first), fact learned
# when read ("" none)]. The translator reads them (Translator).

const SONGLINES := {
	"mine": {"title": "Songline: the old mine", "verses": [
		["Ilu", "The Lantern is tired. We have measured its breathing for a hundred years, and every year it breathes more slowly.", -1, ""],
		["Sae", "Then we have less time than we thought. Is the Engine ready?", 0, ""],
		["Ilu", "Nearly. We have set it aboard the Wanderer. At the Wanderer's nearest pass to the Lantern, its door opens to us.", 1, "hearth_songline"],
		["Oro", "Who dug this tunnel? Ilu, your small digging has come up through my garden.", 0, ""],
	]},
	"pillars": {"title": "Songline: the pillar city", "verses": [
		["Tamsa", "Today we woke the Engine for the first time. It sang the last twenty-two minutes back to us, and we lived them again.", -1, ""],
		["Pell", "I lived them three times. I burned my bread three times. I would like to stop now.", 0, ""],
		["Tamsa", "The Engine sings back the last twenty-two minutes, over and over, until it is given a core. Without one it can only repeat. With one, it can carry.", 0, "verd_engine"],
		["Venn", "Carry what?", 2, ""],
		["Tamsa", "Us. Out through the Fold, before the Lantern falls.", 3, ""],
	]},
	"pillar_top": {"title": "Songline: the high pillar", "verses": [
		["Oro", "I climbed up here to be alone, and found Venn already here, being alone.", -1, ""],
		["Venn", "The Engine does not wake everyone. Those who carry its song in them remember each turning. The rest begin again, and never know.", 0, "verd_why"],
		["Oro", "Then whoever remembers must be the one to finish it.", 1, ""],
	]},
	"shrine": {"title": "Songline: the Phantom's shrine", "verses": [
		["Sae", "The little moon will not hold still for us. Pell says it is shy. I say it is only quantum.", -1, ""],
		["Pell", "It holds still while it is seen. So we keep a picture of it, and fly.", 0, ""],
		["Sae", "For whoever comes after us: board the Wanderer as it passes Periapsis Zero, the core in hand, and give it to the Engine.", 0, "ph_shrine"],
		["Pell", "And if no one comes?", 2, ""],
		["Sae", "Then the Lantern falls, the morning comes back, and the song goes on without us.", 3, ""],
	]},
	"engine_door": {"title": "Songline: the Engine's door", "verses": [
		["Ilu", "The door stays sealed while the Wanderer is far from the Lantern, so the Engine keeps its warmth.", -1, ""],
		["Ilu", "It opens at Periapsis Zero, the Wanderer's closest pass, about twenty and a half minutes into the song, and closes soon after. Do not be late. We were, once.", 0, "wan_door"],
	]},
	"engine": {"title": "Songline: the Engine", "verses": [
		["Tamsa", "We never found a core of our own. We made one, long ago, and lost it on a journey far beyond the Fold.", -1, ""],
		["Sae", "Perhaps someone will bring it back.", 0, ""],
		["Tamsa", "Then this is for them. Set the core in the Engine's heart. It will stop repeating the morning and sing the whole song once, all the way through.", 1, ""],
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
			["What do you know about the Choir?", "choir", "", ""],
			["Thanks. I'll go.", "bye", "", ""],
		]},
		"hale": {"lines": [
			["Mara Voss", "Zero four one two. April the twelfth."],
			["Mara Voss", "The day Elias and I flew our first wing together. And the day, eleven years on, I told him I was done flying it."],
			["Mara Voss", "He kept that. Of course he did. Then whatever he locked away, pilot, it was worth more to him than his ship. Go and finish what he couldn't."],
		], "choices": [["I will.", "bye", "", ""]]},
		"loop": {"lines": [
			["Mara Voss", "...You mean that? Every morning the same, and you the only one who knows it."],
			["Mara Voss", "Okafor would say it's the Choir. He says that about everything. Ask him anyway. And whatever you're doing out there, do it faster."],
		], "choices": [["I'll try.", "bye", "", ""]]},
		"choir": {"lines": [
			["Mara Voss", "The ones who were here first. Spirals carved in every rock in the Reach. There's one down the old mine, past the lake."],
			["Mara Voss", "Okafor reads them. I just mine round them."],
		], "choices": [["Thanks.", "bye", "", ""]]},
		"short": {"lines": [["Mara Voss", "Okafor's up at the observatory, pilot. The lift's at the foot of the tower. The sky won't wait."]], "choices": [["Hale left a recording. The vault code was 0412.", "hale", "ash_hale", ""], ["The Choir?", "choir", "", ""], ["On my way.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Mara Voss", "Go on. The fire's here when you get back."]]},
	},
	"okafor": {
		"start": {"lines": [
			["Okafor", "Ah, the pilot who fell out of the sky. Come in, mind the telescope. Your launch codes: there, keyed into your suit. The Kestrel will answer to you now."],
			["Okafor", "Have a look round the stands before you go; they'll tell you more about the Reach than I can in a morning. I've been watching the Lantern, our star."],
			["Okafor", "Three nights ago it flickered. It's been swelling ever since. Stars don't do that, not on any clock we'd notice."],
			["Okafor", "As for the Aster's people: if any of them lived, you'll hear them before you see them. Your suit's signalscope, X. Start there."],
		], "learn": ["hearth_codes", "hearth_lantern"], "choices": [
			["Can you help me find anyone else?", "scope", "", ""],
			["What are the spirals on the rocks?", "choir", "", ""],
			["Is the Lantern going to die?", "die", "", ""],
		]},
		"scope": {"lines": [
			["Okafor", "Your suit has a signalscope. Press X. Tune it with the wheel or Z and C. On the Travellers frequency you'll hear anyone out there playing."],
			["Okafor", "Mara's banjo, here. Vex's drums out on Ashfall, at the wreck: she salvages the Aster. And since three days ago, a harmonica on Verdance. Nobody here plays the harmonica."],
		], "learn": ["hearth_renn", "hearth_vex"], "choices": [["The Choir?", "choir", "", ""], ["Thank you.", "bye", "", ""]]},
		"choir": {"lines": [
			["Okafor", "The Choir. They were here before the Lantern was old. They wrote in spirals, a song in every one, and they built something they called the Engine."],
			["Okafor", "Your suit has my translator in it now: look at a songline and press E. There's one in the old mine. I've never got past its first verse."],
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
		"blink": {"lines": [["Fen", "Okafor said that too. So I took a picture of it and it STAYED. Because it was being looked at. That's what I think."]], "learn": ["ph_photo"], "choices": [["Smart.", "bye", "", ""]]},
		"catch": {"lines": [["Fen", "Take a picture! Your suit has a camera, press P. Then keep looking at it while you fly there. That's my theory. Nobody's tested it. You should test it."]], "learn": ["ph_photo"], "choices": [["I will.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Fen", "Bye! Don't crash again!"]]},
	},
	"miner": {
		"start": {"lines": [
			["Tull", "Ice in the hills, ice in the hills. Forty years. The Lantern used to be whiter, you know. Now look at it. Gone all orange in the face."],
			["Tull", "Old mine's past the lake, if you're the curious kind. Spiral on the far wall. Never liked the way it hums."],
		], "choices": [["Thanks, Tull.", "", "", ""]]},
	},
	"hauler": {
		"start": {"lines": [
			["Isa", "Your ship's the talk of the village. Nobody's flown a fighter through the Fold in years. Mostly it's ice barges and regret."],
			["Isa", "If you go to Ashfall, mind the drones. They showed up with the wreck and they haven't left."],
		], "choices": [["I'll be careful.", "", "", ""]]},
	},
	"renn": {
		"start": {"lines": [
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
			["Renn Ayers", "And the spirals in the pillars here hum the same note. Go and look."],
		], "learn": ["verd_cargo"], "choices": [["I'll find it.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Renn Ayers", "I'm not going anywhere. I don't think any of us are."]]},
	},
	"hale": {
		"start": {"lines": [
			["Hale's recorder", "...recording. This is Elias Hale, master of the Aster. We are coming down on Ashfall. The Hollow were waiting at the Fold. Somebody sold our route."],
			["Hale's recorder", "For whoever finds this: the vaccine crates are a cover. There is one crate that matters. It holds a Choir core, dug out of the Moon's south pole, and Rook wants it more than he wants any of us."],
			["Hale's recorder", "I have locked it in the cargo vault. The code is zero four one two. Mara will know why."],
			["Hale's recorder", "Mara, if this reaches you: I'm sorry about the wing. Keep the fire lit. ...End recording."],
		], "learn": ["ash_hale"], "end": true},
	},
	"vex": {
		"start": {"lines": [
			["Vex", "Careful where you put your feet, pilot. Rook's drones sweep this wreck every couple of minutes. Get caught in their light and they shoot."],
			["Vex", "I'm Vex. I take what nobody's using. The Aster has a lot nobody's using now."],
		], "learn": ["ash_vex"], "choices": [["Hale's recorder. Where is it?", "core", "", ""], ["Rook's drones?", "rook", "", ""]]},
		"core": {"lines": [
			["Vex", "Hear that ping? Tune your scope to Distress. The bridge section is down in the crater, past the cargo spine. The recorder's still talking."],
			["Vex", "The vault's in the cargo spine too. Sealed tight. I've been at it for days. Needs a code, and the captain took it with him."],
		], "choices": [["Rook's drones?", "rook", "", ""], ["Thanks.", "bye", "", ""]]},
		"rook": {"lines": [["Vex", "They came the day the Aster fell. They don't take anything. They just watch the vault. Like they're waiting for someone to open it for them."]], "choices": [["Thanks.", "bye", "", ""]]},
		"bye": {"end": true, "lines": [["Vex", "Stay out of the light."]]},
	},
}
