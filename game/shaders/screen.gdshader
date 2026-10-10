shader_type spatial;
render_mode unshaded;
// A console screen: a dark glass face with a working display on it, made
// up as it goes (no textures): a grid, a scrolling trace, rows of readouts
// that flicker, a highlighted panel. `round` draws a plot table instead: a
// sweeping radar with contacts.

uniform vec3 ion : source_color = vec3(0.18, 0.83, 1.0);
uniform vec3 ember : source_color = vec3(1.0, 0.42, 0.17);
uniform float round = 0.0;
uniform float seed = 0.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	// Screens are boxes without UVs: lay the display out in world space.
	vec2 uv = fract(vec2(wpos.x / 1.25 + 0.5, wpos.y / 0.6 + 0.5 + wpos.z * 0.001));
	float s = floor(wpos.x * 3.0) + floor(wpos.z * 2.0) + seed;
	vec3 c = vec3(0.01, 0.02, 0.035);
	if (round > 0.5) {
		vec2 p = (wpos.xz - vec2(0.0, -3.9)) / 0.52;
		float r = length(p);
		float a = atan(p.y, p.x);
		float sweep = fract((a / 6.2832) - TIME * 0.25);
		c += ion * (smoothstep(0.02, 0.0, abs(fract(r * 4.0) - 0.5) - 0.48) * 0.25 + pow(1.0 - sweep, 18.0) * 0.6) * step(r, 1.0);
		for (int i = 0; i < 6; i++) {
			vec2 q = vec2(hash(vec2(float(i), 1.0)), hash(vec2(float(i), 2.0))) * 1.4 - 0.7;
			c += (i < 2 ? ember : ion) * smoothstep(0.05, 0.0, length(p - q)) * 1.5;
		}
		ALBEDO = c * 2.0;
	} else {
		vec2 g = fract(uv * vec2(24.0, 12.0));
		c += ion * 0.06 * (step(g.x, 0.04) + step(g.y, 0.06));
		// A trace across the lower half.
		float y = 0.28 + 0.12 * sin(uv.x * 18.0 + TIME * 2.0 + s) * sin(uv.x * 5.0 - TIME * 0.7);
		c += ion * smoothstep(0.012, 0.0, abs(uv.y - y)) * step(uv.y, 0.5);
		// Rows of readouts top right, flickering as values change.
		vec2 cell = floor(uv * vec2(10.0, 14.0));
		float on = step(0.45, hash(cell + floor(TIME * 2.0 + s)));
		c += mix(ion, ember, step(0.92, hash(cell + s))) * on * 0.5 * step(0.55, uv.x) * step(0.55, uv.y) * step(0.3, fract(uv.x * 10.0)) * step(0.35, fract(uv.y * 14.0));
		// A framed panel top left.
		vec2 b = abs(uv - vec2(0.27, 0.75)) - vec2(0.22, 0.17);
		c += ember * 0.7 * smoothstep(0.006, 0.0, abs(max(b.x, b.y)));
		ALBEDO = c * 1.8;
	}
}
