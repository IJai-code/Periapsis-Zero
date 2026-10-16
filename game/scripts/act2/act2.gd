class_name Act2
## Act Two, the governor: where the story stands, and the work Lowdeck
## offers between its missions.
##
## Stages (Flow progress "act2_stage"):
##   0  back on Hearth with Renn: get her to the Lantern unseen
##   1  at the Lantern: Renn and the ledger; find Vex
##   2  Vex wants paying: two jobs from the board (the Rim opens)
##   3  Vex has found Okafor: bring his shuttle in past the Warden
##   4  Okafor has the ledger (to be continued)

const JOBS_FOR_VEX := 2

## For checks: `-- --act2stage N` sets the stage, `--job <kind>` takes the
## first job of that kind from the board.
static func test_setup() -> void:
	var args := OS.get_cmdline_user_args()
	# The same from a link in the browser: /play/index.html#rim/dock,
	# #rim/stage3, #lowdeck/stage0.
	var beat := Flow.beat
	if beat.begins_with("stage"):
		args = ["--act2stage", beat.trim_prefix("stage")]
		Flow.beat = ""
	elif beat in ["bounty", "courier", "race", "salvage", "dock", "docknear"]:
		args = ["--act2stage", "2", "--job", beat.trim_suffix("near")]
		if beat.ends_with("near"):
			args.append("--near")
		Flow.beat = ""
	if "--near" in args:
		Flow.set_meta("near", true)
	var i := args.find("--act2stage")
	if i >= 0 and i + 1 < args.size():
		set_stage(int(args[i + 1]))
	var j := args.find("--job")
	if j >= 0 and j + 1 < args.size():
		for job in board_all():
			if job.kind == args[j + 1]:
				take(job)
				break

static func stage() -> int:
	return int(Flow.progress("act2_stage", 0))

static func set_stage(s: int) -> void:
	Flow.set_progress("act2_stage", s)

static func jobs_done() -> int:
	return int(Flow.progress("act2_jobs_done", 0))

## The job taken, or {}.
static func active() -> Dictionary:
	var j = Flow.progress("act2_job", {})
	return j if j is Dictionary else {}

static func take(job: Dictionary) -> void:
	Flow.set_progress("act2_job", job)

static func clear() -> void:
	Flow.set_progress("act2_job", {})

## A finished job: paid, counted, the board turned over.
static func complete(job: Dictionary, bonus := 0) -> Array:
	clear()
	Flow.set_progress("act2_jobs_done", jobs_done() + 1)
	Flow.set_progress("act2_board_seed", int(Flow.progress("act2_board_seed", 1)) + 1)
	return Flow.earn(int(job.get("pay", 0)) + bonus)

## Lowdeck's job board: four jobs, a different four after each one done.
## Kinds: bounty, courier (some carrying what Security scans for), race,
## salvage, dock (rendezvous in orbit, flown by the orbits, not by eye).
static func board() -> Array:
	var rng := RandomNumberGenerator.new()
	rng.seed = int(Flow.progress("act2_board_seed", 1)) * 7919
	var pool := board_all()
	var out: Array = []
	for i in 4:
		out.append(pool.pop_at(rng.randi() % pool.size()))
	return out

## Every job the board can offer.
static func board_all() -> Array:
	return [
		{"kind": "bounty", "title": "Bounty: Kade Marrow", "giver": "Hearth Security (quietly)", "pay": 3500,
			"text": "A Hollow ace has been picking off ore haulers past the Drift. He flies with two escorts. Hearth wants him gone and doesn't want to know how.",
			"target": "Kade Marrow"},
		{"kind": "bounty", "title": "Bounty: the Lantern Fish", "giver": "Rim Charters", "pay": 2800,
			"text": "Three Hollow raiders lying in wait in the salvage field. The charter lines lost two shuttles there this week.",
			"target": "Hollow pack"},
		{"kind": "courier", "title": "Courier: medical cold-pack", "giver": "Clinic 24H", "pay": 1600,
			"text": "Insulin for the Harbor relay, eight kilometres out, before it warms. Nothing to hide.", "contraband": false, "time": 150.0},
		{"kind": "courier", "title": "Courier: no questions", "giver": "Vex", "pay": 3200,
			"text": "A sealed case for the Harbor relay. Don't let a Security patrol scan you on the way, or they'll want to know what's in it. So will you.",
			"contraband": true, "time": 180.0},
		{"kind": "race", "title": "Race: the Hearth Loop", "giver": "Rim Charters", "pay": 2000,
			"text": "Twelve rings round Hearth's superstructure, against the clock. Gold under 75 seconds pays double."},
		{"kind": "salvage", "title": "Salvage: lost containers", "giver": "Dock Supply", "pay": 2400,
			"text": "Four containers broke loose in the salvage field. Pull each one in with the tractor and tow it to the depot buoy."},
		{"kind": "dock", "title": "Rendezvous: the tanker Calla", "giver": "Hearth Water", "pay": 3000,
			"text": "The ice tanker Calla is coasting in a lower orbit with her docking computer dead. Match her and dock by hand. In orbit, thrusting toward her raises you and you fall behind: fly the orbits, as the flight school teaches."},
	]
