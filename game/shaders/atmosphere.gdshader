shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back;
// The limb: a thin bright band where we look through the most air, blue on
// the day side and warming to orange along the terminator, fading into
// space just outside the planet's edge.

uniform vec3 sun_dir = vec3(1.0, 0.0, 0.0);
uniform float strength = 2.4;

varying vec3 world_n;

void vertex() {
	world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	float facing = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	// Bright in a thin band near the edge, falling off to nothing at it.
	float band = pow(1.0 - facing, 5.0) * smoothstep(0.0, 0.08, facing);
	float ndl = dot(normalize(world_n), normalize(sun_dir));
	float day = smoothstep(-0.3, 0.3, ndl);
	float dusk = exp(-ndl * ndl * 24.0);
	vec3 col = mix(vec3(1.0, 0.4, 0.12), vec3(0.3, 0.58, 1.0), smoothstep(-0.05, 0.3, ndl));
	ALBEDO = col * band * (day + dusk * 0.8) * strength * 3.0;
}
