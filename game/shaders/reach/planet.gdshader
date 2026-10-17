shader_type spatial;
render_mode cull_back;
// The body you are on: lit by the engine (shadows, the flashlight).
#include "res://shaders/reach/planet_inc.gdshaderinc"

void vertex() {
	lpos = VERTEX;
	lnrm = NORMAL;
	tint = COLOR;
}

void fragment() {
	ALBEDO = surface_albedo(length(VERTEX));
	ROUGHNESS = mix(0.95, 0.8, tint.a);
	SPECULAR = 0.25;
}
