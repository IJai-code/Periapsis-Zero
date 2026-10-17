shader_type spatial;
render_mode unshaded, cull_back;
// A body seen from elsewhere: lit by hand from the Lantern's real position
// (the scene's one sun light points at the body you are on, not this one),
// with a thin bright limb where its air is.
#include "res://shaders/reach/planet_inc.gdshaderinc"

uniform vec3 star_pos = vec3(0.0);
uniform vec3 air_color : source_color = vec3(0.4, 0.6, 1.0);
uniform float air = 0.0;
uniform float star_power = 1.0;

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	lpos = VERTEX;
	lnrm = NORMAL;
	tint = COLOR;
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 l = normalize(star_pos - wpos);
	float ndl = dot(normalize(wnrm), l);
	vec3 col = surface_albedo(length(VERTEX)) * (max(ndl, 0.0) * 1.15 * star_power + 0.02);
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	col += air_color * rim * air * smoothstep(-0.2, 0.3, ndl) * 0.8;
	ALBEDO = col;
}
