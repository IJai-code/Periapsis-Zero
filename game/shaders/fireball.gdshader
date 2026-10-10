shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled;
// One puff of an explosion: a billboard whose edge is torn by moving noise,
// hot white at the core going through orange and red as the particle ages
// (COLOR, from the emitter's ramp). `smoke` switches to dark, mixed puffs.

uniform float smoke = 0.0;
uniform float heat = 1.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
	float s = 0.0, a = 0.5;
	for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; }
	return s;
}

varying float seed;

void vertex() {
	// Face the camera, keep the particle's scale.
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0, 0, 0), vec4(0, length(MODEL_MATRIX[1].xyz), 0, 0), vec4(0, 0, length(MODEL_MATRIX[2].xyz), 0), vec4(0, 0, 0, 1));
	seed = INSTANCE_CUSTOM.x;
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float n = fbm(p * 2.6 + vec2(seed * 7.3, seed * 3.1) + TIME * 0.5);
	float m = fbm(p * 6.0 - vec2(seed * 2.1, TIME * 0.8));
	float r = length(p) + (n - 0.5) * 1.1 + (m - 0.5) * 0.35;
	float a = smoothstep(1.0, 0.25, r) * smoothstep(1.0, 0.72, length(p)) * COLOR.a;
	float core = smoothstep(0.55, 0.0, r);
	vec3 c = COLOR.rgb * (0.6 + n * 0.8) + vec3(1.0, 0.7, 0.35) * core * heat * COLOR.a * 0.6;
	ALBEDO = mix(c, COLOR.rgb * (0.4 + n * 0.6), smoke);
	ALPHA = a;
}
