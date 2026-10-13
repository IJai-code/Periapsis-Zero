shader_type canvas_item;
// Bakes one space panorama (equirectangular, see scripts/tools/sky_bake.gd):
// the Milky Way's glow from NASA's Deep Star Map, blurred to its structure,
// and nebulae: domain-warped clouds in two or three colours, lit from
// within, cut by dark dust lanes, gathered in a few places rather than
// spread evenly. Stars are not baked (the live sky draws them sharp).

uniform sampler2D stars : filter_linear_mipmap;
uniform vec3 col_a : source_color = vec3(0.35, 0.2, 0.9);
uniform vec3 col_b : source_color = vec3(0.9, 0.25, 0.55);
uniform vec3 col_c : source_color = vec3(0.2, 0.7, 0.9);
uniform vec3 focus = vec3(0.4, 0.2, -0.9);
uniform float seed = 1.0;
uniform float milky = 1.0;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
	vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 8; i++) { s += a * noise(p); p = p * 2.03 + 0.17; a *= 0.5; } return s; }

void fragment() {
	float lon = (UV.x - 0.5) * 6.2831853;
	float lat = (0.5 - UV.y) * 3.1415927;
	vec3 d = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
	// The Milky Way: NASA's map, blurred so only its glow and dust remain.
	vec3 mw = textureLod(stars, UV, 4.5).rgb * 1.6 + textureLod(stars, UV, 6.5).rgb * 1.2;
	mw = mw / (1.0 + mw) * milky;
	// Nebulae: warped clouds, strongest around `focus` and two lesser places.
	vec3 p = d * 2.2 + seed * 7.13;
	vec3 w = vec3(fbm(p + 1.7), fbm(p + 9.2), fbm(p + 4.4));
	float n = fbm(p * 1.4 + w * 2.2);
	float n2 = fbm(p * 3.1 + w * 1.4 + 3.0);
	float dust = smoothstep(0.42, 0.68, fbm(p * 2.6 + w * 3.0 + 11.0));
	float near = pow(max(0.0, dot(d, normalize(focus)) * 0.5 + 0.5), 4.0);
	float near2 = pow(max(0.0, dot(d, normalize(vec3(-focus.z, focus.y * -0.5, focus.x)))), 3.0);
	float mass = smoothstep(0.32, 0.8, n) * (near * 2.2 + near2 * 1.2 + 0.12);
	vec3 neb = mix(col_a, col_b, smoothstep(0.35, 0.7, n2)) * mass;
	neb += col_c * smoothstep(0.55, 0.9, n2) * mass * 0.8;
	// Hot cores where the cloud is thickest.
	neb += mix(col_b, vec3(1.0, 0.85, 0.7), 0.5) * pow(max(0.0, n - 0.55), 2.0) * 6.0 * (near + near2 * 0.5);
	neb *= 1.0 - dust * 0.85;
	vec3 col = mw * 1.8 * (1.0 - dust * 0.5) + neb * 1.5;
	col = col / (1.0 + col * 0.35);
	// A faint floor of colour so no part of the sky is dead black.
	col += mix(col_a, col_c, 0.5) * 0.012 * fbm(d * 3.0 + 40.0);
	COLOR = vec4(col, 1.0);
}
