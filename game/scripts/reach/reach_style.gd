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

## A storybook serif for titles, place names, the Choir's words (Fraunces,
## OFL, game/fonts), soft and a little wonky, as a hand-lettered log would be.
static var serif: FontVariation
static var serif_bold: FontVariation
static var serif_italic: FontVariation

static func _static_init() -> void:
	var roman: FontFile = load("res://fonts/Fraunces.ttf")
	var italic: FontFile = load("res://fonts/Fraunces-Italic.ttf")
	serif = FontVariation.new()
	serif.base_font = roman
	serif.variation_opentype = {"wght": 420, "SOFT": 100, "WONK": 1, "opsz": 36}
	serif_bold = FontVariation.new()
	serif_bold.base_font = roman
	serif_bold.variation_opentype = {"wght": 700, "SOFT": 100, "WONK": 1, "opsz": 72}
	serif_italic = FontVariation.new()
	serif_italic.base_font = italic
	serif_italic.variation_opentype = {"wght": 400, "SOFT": 100, "WONK": 1, "opsz": 24}

## A label in the serif (titles, names, the Choir).
static func title(text: String, size: int, color := BONE, bold := true) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_font_override("font", serif_bold if bold else serif)
	return l

## A key on the keyboard, for prompts: bone, rounded, a darker lip below.
static func keycap() -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = BONE
	s.set_corner_radius_all(5)
	s.border_color = Color(0.55, 0.5, 0.42)
	s.border_width_bottom = 3
	s.content_margin_left = 9
	s.content_margin_right = 9
	s.content_margin_top = 2
	s.content_margin_bottom = 1
	return s

## A choice in a list (a conversation, a menu): words, not boxes; ember
## with a marker while it has the focus or the mouse.
static func choice(b: Button, size := 19) -> void:
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	var none := StyleBoxEmpty.new()
	none.content_margin_left = 22
	none.content_margin_top = 3
	none.content_margin_bottom = 3
	for st in ["normal", "hover", "focus", "pressed", "hover_pressed"]:
		b.add_theme_stylebox_override(st, none)
	b.add_theme_font_override("font", Style.sans)
	b.add_theme_font_size_override("font_size", size)
	b.add_theme_color_override("font_color", Color(BONE, 0.82))
	for st in ["font_hover_color", "font_focus_color", "font_pressed_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(st, EMBER)
	var mark := label("›", size + 4, EMBER)
	mark.add_theme_font_override("font", serif_bold)
	mark.position = Vector2(2, -3)
	mark.visible = false
	b.add_child(mark)
	b.focus_entered.connect(func(): mark.visible = true)
	b.focus_exited.connect(func(): mark.visible = false)
	b.mouse_entered.connect(func(): b.grab_focus())

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
