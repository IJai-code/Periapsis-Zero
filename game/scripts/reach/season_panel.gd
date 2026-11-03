class_name SeasonPanel
## The season, in the pause menu: its name and how long it has left, the
## orbit of tiers (each a bead, the rewards bigger, the Kestrel on the one
## you have reached), the week's three challenges, what you wear, and the
## transmissions from the Fold so far.

static func make(pause: ReachPause) -> Control:
	var p := pause._card()
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size = Vector2(600, 640)
	p.add_child(scroll)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	v.custom_minimum_size = Vector2(600, 0)
	scroll.add_child(v)
	p.set_meta("fill", func(): _fill(v, pause))
	_fill(v, pause)
	return p

static func _head(v: VBoxContainer, text: String) -> void:
	var h := ReachStyle.label(text, 15, ReachStyle.EMBER)
	h.add_theme_font_override("font", ReachStyle.round_bold)
	v.add_child(h)

static func _para(v: VBoxContainer, text: String, size := 17, col := ReachStyle.BONE) -> Label:
	var l := ReachStyle.label(text, size, col)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(590, 0)
	v.add_child(l)
	return l

static func _fill(v: VBoxContainer, pause: ReachPause) -> void:
	for c in v.get_children():
		c.queue_free()
	var s := Season.current()
	var title := ReachStyle.title("Season %d: %s" % [s.n, s.name], 38, Color("#ffd9a0"))
	v.add_child(title)
	_para(v, s.line, 17, ReachStyle.MUTE)
	var left := Season.event_at() - Season.now()
	var when := "Week %d.  " % Season.week()
	if s.id == "s1":
		when += "The live event, the Homecoming: in %s (Saturday 23 January, 19:00 UTC). Be in the Reach when it happens." % Season.span(left) if left > 0 else "The Homecoming has happened."
	else:
		when += "Season %d ends in %s." % [s.n, Season.span(left)]
	_para(v, when, 17, Color(0.75, 0.9, 1.0))
	if Season.now() >= Season.homecoming_at():
		var again := Button.new()
		again.text = "Watch the Homecoming again"
		ReachStyle.choice(again, 19)
		again.pressed.connect(func():
			var r := pause.get_tree().get_first_node_in_group("reach_root")
			if r and r.get("homecoming"):
				pause.resume.emit()
				r.homecoming.play())
		v.add_child(again)
	# The orbit of tiers.
	var orbit := Control.new()
	orbit.custom_minimum_size = Vector2(590, 210)
	orbit.draw.connect(func(): _draw_orbit(orbit))
	v.add_child(orbit)
	_para(v, "Tier %d of %d.  %d of %d starlight to the next." % [Season.tier(), Season.TIERS, Season.xp() % Season.TIER_XP, Season.TIER_XP], 17)
	var next := ""
	for t in range(Season.tier() + 1, Season.TIERS + 1):
		if Season.REWARDS.has(t):
			next = "Next reward, tier %d: %s." % [t, Season.reward_name(Season.REWARDS[t])]
			break
	if next != "":
		_para(v, next, 16, ReachStyle.MUTE)
	_head(v, "THIS WEEK'S CHALLENGES")
	for id: String in Season.this_week():
		var ch: Array = Season.CHALLENGES[id]
		var n := mini(Season.progress_of(id), int(ch[1]))
		var done := n >= int(ch[1])
		_para(v, "%s  %s   %d/%d   +%d" % ["done " if done else "•", ch[3], n, ch[1], ch[2]], 17, ReachStyle.PINE if done else ReachStyle.BONE)
	_para(v, "New challenges every Monday, the same for every traveller. Starlight also comes from everything you learn, every verse you read, every starstone and every run.", 15, ReachStyle.MUTE)
	_head(v, "WHAT YOU WEAR")
	for row in [["livery", "Kestrel paint"], ["flame", "Campfire"], ["title", "Echo title"]]:
		var kind: String = row[0]
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 12)
		var l := ReachStyle.label(row[1], 18, ReachStyle.BONE)
		l.custom_minimum_size = Vector2(160, 0)
		h.add_child(l)
		var b := Button.new()
		b.text = "‹  %s  ›" % _name(kind, Season.equipped(kind))
		ReachStyle.choice(b, 18)
		b.pressed.connect(func():
			var have := Season.owned(kind)
			var i := have.find(Season.equipped(kind))
			Season.wear(kind, have[(i + 1) % have.size()])
			b.text = "‹  %s  ›" % _name(kind, Season.equipped(kind)))
		h.add_child(b)
		var count := ReachStyle.label("%d of %d" % [Season.owned(kind).size(), _all(kind)], 15, ReachStyle.MUTE)
		h.add_child(count)
		v.add_child(h)
	_head(v, "TRANSMISSIONS FROM THE FOLD")
	var trs := Season.transmissions()
	if trs.is_empty():
		_para(v, "Nothing yet. Listen to the Fold.", 16, ReachStyle.MUTE)
	var body := _para(v, "", 17)
	for i in trs.size():
		var tr: Array = trs[i]
		var b := Button.new()
		b.text = "Week %d: %s%s" % [tr[0], tr[1], "" if Season.heard(i + 1) else "   (new)"]
		ReachStyle.choice(b, 18)
		b.pressed.connect(func():
			var words := PackedStringArray()
			for line: Array in tr[2]:
				words.append("%s:  %s" % [line[0], line[1]])
			body.text = "\n\n".join(words)
			Season.mark_heard(maxi(i + 1, 0))
			b.text = "Week %d: %s" % [tr[0], tr[1]])
		v.add_child(b)
		v.move_child(body, v.get_child_count() - 1)
	var more: int = (Season.TRANSMISSIONS.get(s.id, []) as Array).size() - trs.size()
	if more > 0:
		_para(v, "%d more to come, a week apart." % more, 15, ReachStyle.MUTE)
	_head(v, "ECHOES")
	_para(v, "The faint lights you see are other travellers, living their own mornings right now. Press K to wave; they see a ring of light where you are. Turn echoes off in Settings.", 15, ReachStyle.MUTE)

static func _name(kind: String, id: String) -> String:
	match kind:
		"livery": return Season.LIVERIES[id][0]
		"flame": return Season.FLAMES[id][0]
	return Season.TITLES[id]

static func _all(kind: String) -> int:
	return {"livery": Season.LIVERIES, "flame": Season.FLAMES, "title": Season.TITLES}[kind].size()

## Thirty beads round an ink ellipse, the first at the top, clockwise.
static func _draw_orbit(o: Control) -> void:
	var c := o.size * 0.5
	var rx := o.size.x * 0.44
	var ry := o.size.y * 0.36
	var pts := PackedVector2Array()
	for i in 97:
		var a := TAU * i / 96.0 - PI * 0.5
		pts.append(c + Vector2(cos(a) * rx, sin(a) * ry))
	o.draw_polyline(pts, ReachStyle.CHARCOAL, 9.0, true)
	var tier := Season.tier()
	var frac := float(Season.xp() % Season.TIER_XP) / Season.TIER_XP
	var lit := PackedVector2Array()
	var upto := (tier - 1 + (frac if tier < Season.TIERS else 0.0)) / float(Season.TIERS - 1)
	for i in int(upto * 96.0) + 1:
		lit.append(pts[i])
	if lit.size() > 1:
		o.draw_polyline(lit, ReachStyle.EMBER, 4.0, true)
	var font: Font = ReachStyle.round_bold
	for t in range(1, Season.TIERS + 1):
		var a := TAU * (t - 1) / float(Season.TIERS - 1) * (95.0 / 96.0) - PI * 0.5
		var at := c + Vector2(cos(a) * rx, sin(a) * ry)
		var got := t <= tier
		var r := 5.0
		var col := Color(ReachStyle.BONE, 0.85) if got else Color(ReachStyle.BONE, 0.25)
		if Season.REWARDS.has(t):
			r = 10.0
			var rw: Array = Season.REWARDS[t]
			match rw[0]:
				"livery": col = Season.LIVERIES[rw[1]][1]
				"flame": col = Season.FLAMES[rw[1]][1]
				"title": col = ReachStyle.PINE
			if not got:
				col = Color(col, 0.35)
		o.draw_circle(at, r + 2.5, ReachStyle.CHARCOAL)
		o.draw_circle(at, r, col)
		if Season.REWARDS.has(t) and t % 5 == 0:
			o.draw_string(font, at + Vector2(-8, r + 18), str(t), HORIZONTAL_ALIGNMENT_LEFT, -1, 13, ReachStyle.MUTE)
		if t == tier:
			o.draw_arc(at, r + 7.0, 0.0, TAU, 24, Color("#ffd9a0"), 2.5, true)
	# The Lantern in the middle, the season's name round it.
	o.draw_circle(c, 18.0, Color(1.0, 0.55, 0.2, 0.25))
	o.draw_circle(c, 11.0, Color(1.0, 0.7, 0.35))
	var label := "%d / %d" % [tier, Season.TIERS]
	o.draw_string(font, c + Vector2(-font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 18).x * 0.5, 44), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("#ffd9a0"))
