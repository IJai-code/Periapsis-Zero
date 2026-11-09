// The Nadir: a black hole drawn on the inside of a sphere round it. Every
// pixel's ray is bent along a Schwarzschild photon path (units of the
// horizon radius); where it crosses the disk plane inside the disk it picks
// up the disk's light (hot, beamed toward you on the side that comes at
// you), where it falls in it goes black, and where it leaves it shows the
// screen behind, read from where the bent ray points. Far off the hole a
// ray only needs the weak-field bend, which is cheap; the march runs only
// near it. Only the sphere's far wall is drawn (both faces kept, the near
// one discarded), so it works from outside the sphere or inside it.
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix, fog_disabled, shadows_disabled;

uniform sampler2D screen : hint_screen_texture, filter_linear;
uniform float rs = 36.0;          // horizon radius, metres
uniform float extent = 1100.0;    // this sphere's radius, metres
uniform float disk_in = 2.6;      // the disk's inner and outer edge, in rs
uniform float disk_out = 12.0;
uniform int steps = 64;           // the march's length (lower on weak machines)
uniform float step_k = 0.12;      // each step, as a share of the radius
uniform float glow = 1.0;         // the disk's brightness
uniform float spin = 1.0;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

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

float fbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		s += vnoise(p) * a;
		p = mat2(vec2(1.6, 1.2), vec2(-1.2, 1.6)) * p;
		a *= 0.5;
	}
	return s;
}

// The disk's gas at a point q of the plane (q.xz, units of rs), sheared by
// its own Keplerian spin: two layers half a cycle apart, crossfaded, so the
// shear never winds up into noise.
float gas(vec2 q, float r) {
	float om = spin * 2.2 / pow(r, 1.5);
	float cyc = 9.0;
	float ph = TIME / cyc;
	float s = 0.0;
	for (int k = 0; k < 2; k++) {
		float f = fract(ph + float(k) * 0.5);
		float w = 1.0 - abs(f * 2.0 - 1.0);
		float a = om * f * cyc + float(k) * 1.7;
		vec2 p = mat2(vec2(cos(a), sin(a)), vec2(-sin(a), cos(a))) * q;
		// Streaks: stretched round the hole, tight across it.
		float ang = atan(p.y, p.x);
		vec2 uv = vec2(r * 2.2, 0.0) + vec2(cos(ang), sin(ang)) * 3.0;
		s += w * (fbm(p * 0.9 + uv * 0.35) * 0.7 + fbm(vec2(r * 3.1, 0.0) + p * 0.25) * 0.5);
	}
	return s;
}

// What the disk gives a ray that crosses it at q, travelling along v.
vec4 disk(vec3 q, vec3 v) {
	float r = length(q.xz);
	if (r < disk_in || r > disk_out) {
		return vec4(0.0);
	}
	float x = (r - disk_in) / (disk_out - disk_in);
	float g = gas(q.xz, r);
	// The gas comes round counter-clockwise seen from above; the side
	// coming at you is brighter and bluer (relativistic beaming).
	vec3 tang = normalize(vec3(-q.z, 0.0, q.x));
	float beta = clamp(0.62 / sqrt(r / disk_in), 0.0, 0.75);
	float dop = 1.0 / (1.0 - beta * dot(tang, -normalize(v)));
	dop = clamp(dop * sqrt(1.0 - beta * beta), 0.35, 2.6);
	float heat = pow(disk_in / r, 0.85) * dop;
	vec3 c = mix(vec3(1.0, 0.28, 0.05), vec3(1.0, 0.62, 0.26), smoothstep(0.15, 0.55, heat));
	c = mix(c, vec3(1.0, 0.93, 0.8), smoothstep(0.5, 1.0, heat));
	c = mix(c, vec3(0.75, 0.86, 1.25), smoothstep(1.05, 1.8, heat));
	float lum = (0.35 + 1.4 * g * g) * pow(dop, 3.0) * heat * 2.4 * glow;
	float a = smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.55, 1.0, x)) * clamp(0.35 + g * 0.9, 0.0, 1.0);
	return vec4(c * lum, clamp(a, 0.0, 0.97));
}

vec2 ndc(mat4 vp, vec3 p) {
	vec4 c = vp * vec4(p, 1.0);
	return c.xy / max(c.w, 1e-4);
}

void fragment() {
	vec3 C = NODE_POSITION_WORLD;
	mat3 B = mat3(normalize(MODEL_MATRIX[0].xyz), normalize(MODEL_MATRIX[1].xyz), normalize(MODEL_MATRIX[2].xyz));
	mat3 Bt = transpose(B);
	vec3 cam = CAMERA_POSITION_WORLD;
	vec3 rd = normalize(wpos - cam);
	vec3 o = Bt * (cam - C) / rs;
	vec3 d = Bt * rd;
	float R = extent / rs;
	float od = dot(o, d);
	float oo = dot(o, o);
	// One layer only: the sphere's far wall, from outside it or in.
	if (oo > R * R && dot(wpos - cam, wpos - C) < 0.0) {
		discard;
	}
	// Into the sphere (or from the eye, inside it).
	vec3 p = o;
	if (oo > R * R) {
		float disc = od * od - (oo - R * R);
		p = o + d * max(-od - sqrt(max(disc, 0.0)), 0.0);
	}
	float b = length(cross(o, d));
	vec3 col = vec3(0.0);
	float trans = 1.0;
	bool fell = false;
	vec3 v = d;
	float rmin = 1e4;
	if (b > disk_out * 1.6) {
		// Weak field: bent toward the hole by what the pull does along this
		// ray's chord of the sphere (2 rs / b over the whole of an endless
		// line), the same stretch the march covers, so the two meet without
		// a seam.
		vec3 toward = normalize(-o + d * od);
		float L = sqrt(max(R * R - b * b, 0.0));
		float s0 = max(od, -L);
		float bend = (L / sqrt(b * b + L * L) - s0 / sqrt(b * b + s0 * s0)) / b;
		v = normalize(d + toward * bend);
		rmin = b;
	} else {
		float h2 = dot(cross(p, v), cross(p, v));
		for (int i = 0; i < 160; i++) {
			if (i >= steps) {
				break;
			}
			float r = length(p);
			rmin = min(rmin, r);
			if (r < 1.0) {
				fell = true;
				break;
			}
			if (r > R * 1.001 && dot(p, v) > 0.0) {
				break;
			}
			float dt = clamp(step_k * r, 0.02, 3.0);
			// Near the disk plane, never step across it by much.
			if (abs(p.y) < 2.0 && r < disk_out + 2.0) {
				dt = min(dt, max(abs(p.y) * 0.8, 0.05) + 0.04);
			}
			vec3 acc = -1.5 * h2 * p / pow(r, 5.0);
			vec3 vn = v + acc * dt;
			vec3 pn = p + vn * dt;
			if (sign(p.y) != sign(pn.y) && trans > 0.01) {
				float f = p.y / (p.y - pn.y);
				vec4 dk = disk(mix(p, pn, f), vn);
				col += trans * dk.rgb * dk.a;
				trans *= 1.0 - dk.a;
			}
			p = pn;
			v = normalize(vn);
		}
		// Rays that circled close and ran out of steps went in.
		if (!fell && length(p) < 3.0) {
			fell = true;
		}
	}
	// The photon ring: light skimming 1.5 rs, a hair-thin glow.
	col += trans * vec3(1.0, 0.82, 0.6) * exp(-pow((rmin - 1.55) * 7.0, 2.0)) * 0.8 * glow;
	vec3 back = vec3(0.0);
	if (!fell) {
		vec3 dw = normalize(B * v);
		// The bend fades to nothing toward the sphere's edge, so the
		// picture meets the plain sky there without a seam.
		float k = 1.0 - smoothstep(R * 0.55, R * 0.97, b);
		dw = normalize(mix(rd, dw, k));
		mat4 vp = PROJECTION_MATRIX * VIEW_MATRIX;
		vec2 n0 = ndc(vp, cam + rd * 100.0);
		vec2 n1 = ndc(vp, cam + dw * 100.0);
		// Which way up the screen texture is, from this pixel itself.
		vec2 u0 = n0 * 0.5 + 0.5;
		float flip = abs(u0.y - SCREEN_UV.y) <= abs(1.0 - u0.y - SCREEN_UV.y) ? 1.0 : -1.0;
		vec2 uv = SCREEN_UV + (n1 - n0) * 0.5 * vec2(1.0, flip);
		bool behind = dot(dw, -normalize(INV_VIEW_MATRIX[2].xyz)) < 0.05;
		vec2 cl = clamp(uv, vec2(0.001), vec2(0.999));
		float off = behind ? 1.0 : clamp(length(uv - cl) * 6.0, 0.0, 1.0);
		back = textureLod(screen, cl, 0.0).rgb * (1.0 - off);
		// Off the screen: a few stars, so the lensed sky is never empty.
		vec3 sd = dw * 180.0;
		float st = step(0.985, hash(floor(sd.xy) + floor(sd.z) * 17.0)) * off;
		back += vec3(st) * 0.6;
	}
	// Only where the bend shows does this replace what is there: further
	// out the scene's own transparent things (air, glows, the gleam) stay.
	float lens_a = 1.0 - smoothstep(R * 0.3, R * 0.8, b);
	float a = fell ? 1.0 : max(lens_a, 1.0 - trans);
	ALBEDO = (col + back * trans * lens_a) / max(a, 1e-3);
	ALPHA = clamp(a, 0.0, 1.0);
}
