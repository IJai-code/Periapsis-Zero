// Sinking ash (AshSink): a slow spiral of fine dark ash turning in toward
// a hollow at the middle, glinting where the lava light catches it.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_back, shadows_disabled;

uniform float spin = 0.25;

float h21(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float a = atan(p.y, p.x);
	// A spiral drawn in, turning.
	float s = sin(a * 3.0 + log(max(r, 0.02)) * 9.0 + TIME * spin * 6.0);
	float grain = h21(floor((p + vec2(TIME * 0.01)) * 90.0));
	vec3 ash = mix(vec3(0.05, 0.045, 0.045), vec3(0.16, 0.14, 0.13), 0.5 + 0.5 * s);
	ash *= 0.85 + grain * 0.3;
	// The hollow in the middle, darker, with a faint ember glow.
	ash = mix(ash, vec3(0.02, 0.015, 0.015), (1.0 - smoothstep(0.0, 0.35, r)));
	ALBEDO = ash;
	ROUGHNESS = 0.95;
	// Embers along the spiral's arms and at its heart, so a pit reads as a
	// danger even on the night side.
	float arms = smoothstep(0.75, 1.0, s) * (1.0 - smoothstep(0.4, 0.95, r)) * (0.5 + 0.5 * grain);
	EMISSION = vec3(1.0, 0.33, 0.07) * ((1.0 - smoothstep(0.0, 0.35, r)) * (0.9 + 0.5 * sin(TIME * 1.7)) + arms * 0.45);
	ALPHA = (1.0 - smoothstep(0.82, 1.0, r));
}
