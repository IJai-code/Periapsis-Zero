// The air burning round the Kestrel on a fast way down: a shell about her,
// bright at the bow where the air piles up, drawn out behind her in
// streaks. `power` is 0 in still air or space (the shell is hidden then).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform float power = 0.0;
// The way she is moving through the air, in her own space.
uniform vec3 heading = vec3(0.0, 0.0, -1.0);

varying float bow;
varying float tail;
varying vec2 flow;

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void vertex() {
	vec3 n = normalize(VERTEX);
	float d = dot(n, heading);
	bow = d;
	tail = max(-d, 0.0);
	// Round the bow, a long tail behind.
	VERTEX -= heading * tail * tail * 11.0 * power;
	vec3 side = n - heading * d;
	flow = vec2(atan(side.x + side.z * 0.37, side.y + 0.001) * 2.2, d * 3.0);
}

void fragment() {
	// Bright where the shell faces the eye, gone at its edges: a glow with
	// no outline, from outside her and from the seat inside it.
	float face = abs(dot(normalize(NORMAL), normalize(VIEW)));
	face = smoothstep(0.0, 0.8, face);
	float streak = vnoise(vec2(flow.x * 3.0, flow.y * 1.4 + TIME * 9.0));
	float fine = vnoise(vec2(flow.x * 9.0, flow.y * 3.0 + TIME * 16.0));
	float front = smoothstep(0.0, 1.0, bow);
	float a = front * front * (0.45 + 0.35 * fine) + smoothstep(0.0, 0.45, tail) * (1.0 - tail * tail) * (0.12 + 0.75 * streak * fine) * 1.4;
	a *= power * face * (0.75 + 0.25 * streak);
	vec3 col = mix(vec3(1.0, 0.3, 0.06), vec3(1.0, 0.82, 0.58), clamp(front * front * power * 1.2, 0.0, 1.0));
	ALBEDO = col * 1.5;
	ALPHA = clamp(a, 0.0, 0.6);
}
