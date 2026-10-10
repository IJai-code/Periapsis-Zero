shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_back;
// The thin blue limb: strongest where we look through the most air, on the
// day side, warming to orange along the terminator.

uniform vec3 sun_dir = vec3(1.0, 0.0, 0.0);
uniform float strength = 2.2;

varying vec3 world_n;

void vertex() {
	world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	float facing = clamp(dot(NORMAL, VIEW), 0.0, 1.0);
	float limb = pow(1.0 - facing, 4.0);
	float ndl = dot(normalize(world_n), normalize(sun_dir));
	float day = smoothstep(-0.25, 0.35, ndl);
	float dusk = exp(-ndl * ndl * 40.0);
	vec3 col = mix(vec3(1.0, 0.45, 0.15), vec3(0.28, 0.55, 1.0), smoothstep(-0.05, 0.25, ndl));
	ALBEDO = col * limb * (day + dusk * 0.6) * strength + vec3(0.2, 0.4, 0.9) * (1.0 - facing) * day * 0.05;
}
