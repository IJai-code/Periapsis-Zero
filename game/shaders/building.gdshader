shader_type spatial;
// A tower at night: storeys of windows laid out in the building's own
// space (so instanced towers each light differently), a share of them lit
// warm or cool behind the glass, the rest dark and glossy, a concrete frame
// between with the facade scan's grime in it.

uniform sampler2D grime : source_color, filter_linear_mipmap, repeat_enable;
uniform vec2 cell = vec2(1.8, 3.2);
// The first storey's floor, in the model's own height.
uniform float floor0 = 5.0;
uniform float lit = 0.32;
uniform vec3 frame : source_color = vec3(0.32, 0.31, 0.34);
uniform float seed = 0.0;

varying vec3 lpos;
varying vec3 lnrm;
varying float inst;

float hash(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.1, 0.71, 0.113));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void vertex() {
	lpos = VERTEX;
	lnrm = NORMAL;
	inst = float(INSTANCE_ID) + seed;
}

void fragment() {
	vec3 n = normalize(lnrm);
	// Roofs and floors: plain concrete.
	if (abs(n.y) > 0.5) {
		ALBEDO = frame * 0.8 * texture(grime, lpos.xz * 0.12).rgb;
		ROUGHNESS = 0.9;
	} else {
		float u = abs(n.x) > abs(n.z) ? lpos.z : lpos.x;
		vec2 g = vec2(u, lpos.y - floor0) / cell;
		vec2 id = floor(g);
		vec2 f = fract(g);
		float face = abs(n.x) > abs(n.z) ? sign(n.x) * 2.0 : sign(n.z) * 3.0;
		float glass = step(0.1, f.x) * step(f.x, 0.9) * step(0.2, f.y) * step(f.y, 0.86);
		float h = hash(vec3(id, face + inst * 7.31));
		float on = step(h, lit) * glass;
		// Warm rooms, cool screens, a few ember and ion signs in windows.
		vec3 warm = vec3(1.0, 0.72, 0.42);
		vec3 cool = vec3(0.55, 0.75, 1.0);
		vec3 room = mix(warm, cool, step(0.6, fract(h * 13.7)));
		room = mix(room, vec3(1.0, 0.42, 0.17), step(0.94, fract(h * 31.1)));
		room = mix(room, vec3(0.18, 0.83, 1.0), step(0.97, fract(h * 71.3)));
		// Blinds: a lit window dims toward its top in steps.
		float blind = mix(1.0, 0.55, step(0.5, fract(h * 5.3)) * step(0.55, f.y));
		vec3 dirt = texture(grime, g * vec2(0.17, 0.11)).rgb;
		ALBEDO = mix(frame * dirt * 1.4, vec3(0.02, 0.025, 0.03), glass);
		ROUGHNESS = mix(0.85, 0.08, glass);
		METALLIC = glass * 0.4;
		EMISSION = room * on * blind * (1.4 + 1.6 * fract(h * 3.7));
	}
}
