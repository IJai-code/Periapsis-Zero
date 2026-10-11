shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_never, unshaded, shadows_disabled;
// Soft banks of mist and cloud: always face the camera, made of noise,
// warm where the sun is behind them, fading out up close so a ship can fly
// straight through.

uniform vec3 sun_dir = vec3(0.0, 0.3, -1.0);
uniform vec3 lit : source_color = vec3(1.0, 0.9, 0.78);
uniform vec3 shade : source_color = vec3(0.62, 0.68, 0.76);
uniform float density = 0.75;

varying float seed;

void vertex() {
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0), vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
	seed = fract(MODEL_MATRIX[3].x * 0.0137 + MODEL_MATRIX[3].z * 0.0071);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.1; a *= 0.5; } return s; }

void fragment() {
	vec2 uv = UV - 0.5;
	float r = length(uv * vec2(1.0, 1.6));
	float body = smoothstep(0.5, 0.1, r);
	float n = fbm(UV * 4.0 + vec2(seed * 17.0, TIME * 0.01));
	float a = clamp(body * (n * 1.6 - 0.35), 0.0, 1.0) * density;
	// Thin out near the camera rather than pop.
	float d = length(VERTEX);
	a *= smoothstep(30.0, 160.0, d);
	vec3 view_dir = normalize((INV_VIEW_MATRIX * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
	float back = clamp(dot(view_dir, normalize(sun_dir)), 0.0, 1.0);
	ALBEDO = mix(shade, lit, 0.35 + 0.65 * back * n) * (0.9 + n * 0.3);
	ALPHA = a;
}
