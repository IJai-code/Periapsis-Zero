shader_type spatial;
// A photo-scanned material (ambientCG) laid triplanar in world space: no UVs,
// even texel density everywhere. `paint` takes the scan's own colour out and
// keeps its light and dark (wear, grime, scratches) under `tint`, so any scan
// can wear the palette; done here so the browser build has no image work to
// do on load.

uniform sampler2D albedo_map : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_map : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rough_map : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D metal_map : hint_default_black, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0);
uniform float tint_gain = 1.0;
uniform float paint = 0.0;
uniform float scale = 1.0;
uniform float metal = 0.0;
// The browser draws every surface pixel six times less: the roughness and
// metalness maps are the two that read the least (a surface's sheen barely
// changes across a plank) and their uniforms stand in for them.
uniform float detail = 1.0;
uniform float rough = 0.62;
// Map in the object's own space (things standing on a small world, whose
// up is not the world's), not the world's.
uniform float object_space = 0.0;

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	if (object_space > 0.5) {
		wpos = VERTEX;
		wnrm = NORMAL;
	}
}

vec4 tri(sampler2D t, vec3 p, vec3 w) {
	return texture(t, p.zy) * w.x + texture(t, p.xz) * w.y + texture(t, p.xy) * w.z;
}

void fragment() {
	vec3 n = normalize(wnrm);
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	vec3 p = wpos * scale;
	vec3 c = tri(albedo_map, p, w).rgb;
	float r = rough;
	float mt = 0.7;
	if (detail > 0.5) {
		r = tri(rough_map, p, w).r;
		mt = tri(metal_map, p, w).r;
	}
	if (paint > 0.5) {
		// Paint over metal: the scan's grime kept faint, about its own mean
		// (the smallest mip), so at a ship's scale it reads as wear and not
		// as speckle; a semi-gloss coat with a little metal flake in it.
		float l = dot(c, vec3(0.299, 0.587, 0.114));
		float mean = dot(textureLod(albedo_map, vec2(0.5), 12.0).rgb, vec3(0.299, 0.587, 0.114));
		c = vec3(clamp(0.82 + (l - mean) * 0.7, 0.0, 1.2));
		// Grime in broad drifts, metres across: the same scan, sampled
		// large and smoothed, darkens and dulls the paint in patches.
		float drift = dot(tri(albedo_map, wpos * 0.045, w).rgb, vec3(0.333));
		float grime = smoothstep(mean - 0.08, mean + 0.12, drift);
		c *= mix(0.72, 1.0, grime);
		r = mix(0.3, 0.6, r) + (1.0 - grime) * 0.18;
	}
	ALBEDO = c * tint * tint_gain;
	ROUGHNESS = r;
	METALLIC = paint > 0.5 ? 0.3 : metal * mt;
	// Whiteout-blended triplanar normals, world space, then to view.
	vec3 tx = texture(normal_map, p.zy).xyz * 2.0 - 1.0;
	vec3 ty = texture(normal_map, p.xz).xyz * 2.0 - 1.0;
	vec3 tz = texture(normal_map, p.xy).xyz * 2.0 - 1.0;
	vec3 nx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
	vec3 ny = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
	vec3 nz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
	vec3 wn = normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
	if (object_space > 0.5) {
		wn = normalize((MODEL_MATRIX * vec4(wn, 0.0)).xyz);
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
}
