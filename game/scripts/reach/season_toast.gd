class_name SeasonToast
extends Control
## Starlight as it is earned: a small ink orbit low on the screen, the bead
## on it sliding round toward the next tier, "+150 starlight" beside it.
## A tier reached is a banner across the top with what it gave. And in the
## last ten minutes before a live event, the countdown.

var _t := 0.0
var _show := 0.0
var _frac := 0.0
var _frac_to := 0.0
var _gain := 0
var _words := ""
var _tier := 1
var _banner := 0.0
var _banner_title := ""
var _banner_sub := ""
var _count := ""

func _init() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func starlight(gain: int, words: String, tier: int, frac: float) -> void:
	_gain = gain if _show <= 0.0 else _gain + gain
	_words = words if words != "" else _words if _show > 0.0 else ""
	if tier != _tier:
		_frac = 0.0
	_tier = tier
	_frac_to = frac
	_show = 4.5 if words == "" else 7.0
	Sfx.play("ping", -18.0, 1.6)

func tier_up(tier: int, reward: String) -> void:
	_banner_title = "Season tier %d" % tier
	_banner_sub = reward if reward != "" else "Keep climbing: the next reward is a few tiers on"
	_banner = 6.0
	Sfx.play("objective", -8.0, 1.2)

## The live event's countdown ("" hides it).
func countdown(text: String) -> void:
	_count = text

func _process(dt: float) -> void:
	_t += dt
	_show -= dt
	_banner -= dt
	_frac = lerpf(_frac, _frac_to, minf(1.0, dt * 3.0))
	if _show > -1.0 or _banner > -1.0 or _count != "":
		queue_redraw()

func _draw() -> void:
	var font: Font = ReachStyle.round_bold
	var vs := size
	if _show > -0.5:
		var a := clampf(_show * 2.0, 0.0, 1.0)
		var c := Vector2(vs.x * 0.5 - 150.0, vs.y - 112.0)
		# The orbit: an ellipse in ink, its lit part ember up to the bead.
		draw_set_transform(c, -0.25, Vector2(1.0, 0.42))
		draw_arc(Vector2.ZERO, 30.0, 0.0, TAU, 48, Color(ReachStyle.CHARCOAL, 0.8 * a), 7.0, true)
		draw_arc(Vector2.ZERO, 30.0, -PI * 0.5, -PI * 0.5 + TAU * _frac, 48, Color(ReachStyle.EMBER, a), 3.5, true)
		var ang := -PI * 0.5 + TAU * _frac
		var bead := Vector2(cos(ang), sin(ang)) * 30.0
		draw_set_transform(Vector2.ZERO)
		var bp := c + Vector2(bead.x * cos(-0.25) - bead.y * 0.42 * sin(-0.25), bead.x * sin(-0.25) + bead.y * 0.42 * cos(-0.25))
		draw_circle(c, 9.0, Color(ReachStyle.CHARCOAL, a))
		draw_circle(c, 6.5, Color(ReachStyle.PINE, a))
		draw_circle(bp, 6.0, Color(ReachStyle.CHARCOAL, a))
		draw_circle(bp, 4.0, Color(1.0, 0.85, 0.55, a))
		var line := "+%d starlight" % _gain
		_ink(font, c + Vector2(48, 4), line, 24, Color(1.0, 0.86, 0.6, a))
		var sub := _words if _words != "" else "Tier %d, %d%% to the next" % [_tier, int(_frac_to * 100.0)]
		_ink(ReachStyle.round, c + Vector2(48, 30), sub, 17, Color(ReachStyle.BONE, a * 0.9))
	if _banner > -0.5:
		var a := clampf(_banner * 1.5, 0.0, 1.0)
		var y := 120.0 - (1.0 - a) * 30.0
		var w := maxf(font.get_string_size(_banner_title, HORIZONTAL_ALIGNMENT_LEFT, -1, 44).x, ReachStyle.round.get_string_size(_banner_sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 20).x) + 80.0
		draw_rect(Rect2(vs.x * 0.5 - w * 0.5, y - 50, w, 92), Color(0.09, 0.08, 0.07, 0.86 * a))
		draw_rect(Rect2(vs.x * 0.5 - w * 0.5, y + 40, w, 3), Color(ReachStyle.EMBER, a))
		_ink(font, Vector2(vs.x * 0.5 - font.get_string_size(_banner_title, HORIZONTAL_ALIGNMENT_LEFT, -1, 44).x * 0.5, y), _banner_title, 44, Color(1.0, 0.86, 0.6, a))
		_ink(ReachStyle.round, Vector2(vs.x * 0.5 - ReachStyle.round.get_string_size(_banner_sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 20).x * 0.5, y + 30), _banner_sub, 20, Color(ReachStyle.BONE, a))
	if _count != "":
		var pulse := 0.75 + 0.25 * sin(_t * 3.0)
		var w := font.get_string_size(_count, HORIZONTAL_ALIGNMENT_LEFT, -1, 22).x
		_ink(font, Vector2(vs.x * 0.5 - w * 0.5, 64), _count, 22, Color(0.75, 0.9, 1.0, pulse))

func _ink(font: Font, at: Vector2, text: String, fs: int, col: Color) -> void:
	draw_string_outline(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 8, Color(ReachStyle.CHARCOAL, col.a * 0.9))
	draw_string(font, at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
