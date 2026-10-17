class_name ReachStyle
## The Reach's look: warm space-punk. Charcoal, campfire orange, pine green
## and bone, on panels like oiled wood.

const CHARCOAL := Color("#1d1a17")
const PANEL := Color(0.11, 0.1, 0.09, 0.86)
const EMBER := Color("#e8853d")
const PINE := Color("#7fae74")
const BONE := Color("#efe3c9")
const MUTE := Color(0.937, 0.89, 0.788, 0.62)
const FAINT := Color(0.937, 0.89, 0.788, 0.28)

static func panel(radius := 8) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = PANEL
	s.set_corner_radius_all(radius)
	s.border_color = Color(EMBER, 0.5)
	s.border_width_top = 2
	s.content_margin_left = 22
	s.content_margin_right = 22
	s.content_margin_top = 16
	s.content_margin_bottom = 16
	return s

static func label(text: String, size: int, color := BONE, mono := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_font_override("font", Style.mono if mono else Style.sans)
	return l

static func theme() -> Theme:
	var t := Style.theme().duplicate() as Theme
	var b := StyleBoxFlat.new()
	b.bg_color = Color(EMBER, 0.14)
	b.border_color = Color(EMBER, 0.6)
	b.set_border_width_all(1)
	b.set_corner_radius_all(6)
	b.content_margin_left = 16
	b.content_margin_right = 16
	b.content_margin_top = 8
	b.content_margin_bottom = 8
	t.set_stylebox("normal", "Button", b)
	var h := b.duplicate() as StyleBoxFlat
	h.bg_color = Color(EMBER, 0.32)
	t.set_stylebox("hover", "Button", h)
	t.set_stylebox("focus", "Button", h)
	t.set_color("font_color", "Button", BONE)
	return t
