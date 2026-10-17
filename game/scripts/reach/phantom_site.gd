class_name PhantomSite
extends Site
## The Phantom's shrine: a domed round room of Choir stone on the little
## moon's pole, a songline inside. (How the moon itself moves when no one
## is looking is QuantumMoon.)

static func make(b: ReachBody) -> PhantomSite:
	var p := PhantomSite.new(b, "shrine")
	p.name = "Phantom"
	return p

func _ready() -> void:
	var shrine := put("site-shrine", Vector2.ZERO, Vector2(0, -10))
	songline_at("shrine", shrine.transform * Transform3D(Basis(), Vector3(0, 0, -2.9)))
	lamp(shrine, Vector3(0, 2.4, -0.5), Color(0.6, 0.7, 1.0), 0.8, 7.0)
	for k in 7:
		var a := TAU * k / 7.0 + 0.5
		put("site-column", Vector2(cos(a), sin(a)) * 8.5, Vector2.ZERO, true, 0.55)
