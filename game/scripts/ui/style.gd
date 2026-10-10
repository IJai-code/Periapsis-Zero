class_name Style
## The game's look in one place: the site's palette and fonts (Bricolage
## Grotesque for words, Space Mono for labels and keys; both OFL, game/fonts).

const VOID := Color("#120b22")
const BONE := Color("#f4e8cf")
const EMBER := Color("#ff6b2c")
const ION := Color("#2fd3ff")
const MUTE := Color(0.957, 0.91, 0.812, 0.62)
const PANEL := Color(0.07, 0.045, 0.13, 0.78)

static var sans: FontVariation
static var sans_bold: FontVariation
static var mono: FontFile
static var mono_bold: FontFile

static func _static_init() -> void:
	var base: FontFile = load("res://fonts/BricolageGrotesque.ttf")
	sans = FontVariation.new()
	sans.base_font = base
	sans.variation_opentype = {"wght": 420}
	sans_bold = FontVariation.new()
	sans_bold.base_font = base
	sans_bold.variation_opentype = {"wght": 760}
	mono = load("res://fonts/SpaceMono-Regular.ttf")
	mono_bold = load("res://fonts/SpaceMono-Bold.ttf")

static func label(text: String, size: int, color := BONE, font: Font = null) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font if font else sans)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l

static func panel(radius := 10) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = PANEL
	s.set_corner_radius_all(radius)
	s.content_margin_left = 18
	s.content_margin_right = 18
	s.content_margin_top = 12
	s.content_margin_bottom = 12
	return s

static func theme() -> Theme:
	var t := Theme.new()
	t.default_font = sans
	t.default_font_size = 22
	var normal := StyleBoxFlat.new()
	normal.bg_color = Color(BONE, 0.06)
	normal.border_color = Color(BONE, 0.22)
	normal.set_border_width_all(1)
	normal.set_corner_radius_all(8)
	normal.content_margin_left = 26
	normal.content_margin_right = 26
	normal.content_margin_top = 12
	normal.content_margin_bottom = 12
	var hover := normal.duplicate()
	hover.bg_color = Color(EMBER, 0.9)
	hover.border_color = EMBER
	var pressed := hover.duplicate()
	pressed.bg_color = EMBER.darkened(0.2)
	var focus := normal.duplicate()
	focus.border_color = ION
	focus.set_border_width_all(2)
	focus.bg_color = Color(0, 0, 0, 0)
	t.set_stylebox("normal", "Button", normal)
	t.set_stylebox("hover", "Button", hover)
	t.set_stylebox("pressed", "Button", pressed)
	t.set_stylebox("focus", "Button", focus)
	t.set_color("font_color", "Button", BONE)
	t.set_color("font_hover_color", "Button", VOID)
	t.set_color("font_pressed_color", "Button", VOID)
	t.set_color("font_focus_color", "Button", BONE)
	t.set_font("font", "Button", sans_bold)
	t.set_font_size("font_size", "Button", 22)
	return t
