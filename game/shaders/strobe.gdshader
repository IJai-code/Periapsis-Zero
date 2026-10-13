shader_type spatial;
render_mode unshaded, shadows_disabled;
// A running light that flashes: a short bright blink, a faint glow between.
// The phase runs with position, so a row of lights chases along a hull.

uniform vec3 color : source_color = vec3(1.0);
uniform float energy = 8.0;
uniform float rate = 0.8;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float t = fract(TIME * rate - dot(wpos, vec3(0.004, 0.003, 0.006)));
	float flash = smoothstep(0.0, 0.015, t) * (1.0 - smoothstep(0.06, 0.1, t));
	ALBEDO = color * energy * (0.06 + flash);
}
