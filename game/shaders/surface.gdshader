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

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
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
	c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), paint);
	ALBEDO = c * tint * tint_gain;
	ROUGHNESS = tri(rough_map, p, w).r;
	METALLIC = metal * tri(metal_map, p, w).r;
	// Whiteout-blended triplanar normals, world space, then to view.
	vec3 tx = texture(normal_map, p.zy).xyz * 2.0 - 1.0;
	vec3 ty = texture(normal_map, p.xz).xyz * 2.0 - 1.0;
	vec3 tz = texture(normal_map, p.xy).xyz * 2.0 - 1.0;
	vec3 nx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
	vec3 ny = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
	vec3 nz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
	vec3 wn = normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
}
