shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_never, specular_schlick_ggx;
// Falling water (Falls): UV.x across the sheet, UV.y from the lip (0) to the
// pool (1). Near the lip it is a glassy, dark, smooth tongue; as it falls it
// breaks up into white ropes and streaks that run faster the lower they are
// (it is accelerating), and the edges fray into separate threads. Lit, so it
// takes the Lantern's colour by day and goes dim at night, with a breath of
// its own light so it never vanishes.

uniform vec3 deep : source_color = vec3(0.18, 0.34, 0.4);
uniform vec3 white : source_color = vec3(0.92, 0.96, 1.0);
uniform float flow = 1.0;
uniform float opacity = 1.0;
uniform float seed = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	// A slow wobble across the sheet, more as it falls.
	VERTEX.x += sin(TIME * 1.7 + VERTEX.y * 0.4 + seed) * 0.12 * UV.y;
	VERTEX.z += sin(TIME * 2.3 + VERTEX.y * 0.3 + seed * 2.0) * 0.18 * UV.y;
}

void fragment() {
	vec2 uv = UV;
	// Distance fallen grows with the square of time: scroll in sqrt-space so
	// the pattern visibly speeds up on its way down.
	float fall = sqrt(uv.y);
	float t = TIME * flow;
	float x = uv.x + seed;
	float ropes = noise(vec2(x * 18.0, fall * 6.0 - t * 2.6));
	float fine = noise(vec2(x * 55.0, fall * 18.0 - t * 4.2));
	float breakup = noise(vec2(x * 9.0, fall * 3.0 - t * 1.4));
	float streak = ropes * 0.6 + fine * 0.4;
	// White grows with the fall: glassy at the lip, all foam at the bottom.
	float aer = smoothstep(0.05, 0.6, uv.y);
	float foam = clamp(smoothstep(0.42, 0.8, streak) * (0.4 + aer) + aer * 0.35 + smoothstep(0.85, 1.0, uv.y) * 0.4, 0.0, 1.0);
	vec3 c = mix(deep, white, foam);
	// Frayed edges: threads separate toward the sides and the bottom.
	float edge = abs(uv.x - 0.5) * 2.0;
	float fray = smoothstep(1.0, 0.55 - 0.25 * uv.y, edge + (breakup - 0.5) * 0.5 * (0.3 + uv.y));
	float a = (0.55 + streak * 0.45) * fray;
	a *= smoothstep(0.0, 0.02, uv.y) * mix(1.0, 0.55, smoothstep(0.85, 1.0, uv.y));
	ALBEDO = c;
	ROUGHNESS = mix(0.05, 0.6, foam);
	SPECULAR = 0.7;
	EMISSION = c * 0.12;
	ALPHA = clamp(a * opacity, 0.0, 0.95);
}
