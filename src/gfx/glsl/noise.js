/**
 * GPU noise for surfaces that have no edge to zoom past.
 *
 * Every procedural world here is evaluated per pixel from the direction to the
 * surface point, not read out of a texture, so there is no resolution to run
 * out of: the closer the camera, the more octaves the pixel can hold, and the
 * octave count is set by the pixel's own footprint — `fp`, the angle one pixel
 * subtends on the body, from `fwidth` of the direction. An octave whose
 * wavelength falls under two pixels would alias into shimmer, so each one fades
 * in between four pixels and two; `octaveFade` is that ramp.
 *
 * The simplex noise is the Gustavson–McEwan formulation (Ashima Arts, MIT
 * licence), which needs no texture lookups and no tables.
 */
export const NOISE_GLSL = /* glsl */ `
vec3 pz_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pz_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pz_permute(vec4 x) { return pz_mod289(((x * 34.0) + 1.0) * x); }
vec4 pz_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

/** 3D simplex noise, roughly in [-1, 1]. */
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = pz_mod289(i);
  vec4 p = pz_permute(pz_permute(pz_permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = pz_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/** 1 while an octave spans four pixels or more, 0 by the time it spans two. */
float octaveFade(float freq, float fp) {
  return clamp(-log2(max(freq * fp, 1e-12)) - 1.0, 0.0, 1.0);
}

/**
 * Fractal noise with its octaves cut at the pixel. Amplitudes are *not*
 * renormalised over the octaves that survive: a far view keeps the same
 * large-scale contrast and simply lacks the fine detail, which is the whole
 * point — renormalising would stretch two octaves to the contrast of eight.
 */
float fbmAA(vec3 p, float freq, int octaves, float fp, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 14; i++) {
    if (i >= octaves) break;
    float f = octaveFade(freq, fp);
    if (f <= 0.0) break;
    sum += amp * f * snoise(p * freq + vec3(float(i) * 17.13, float(i) * -9.71, float(i) * 3.37));
    amp *= gain;
    freq *= 2.03;
  }
  return sum;
}

/** Ridged fractal: sharp creases, for cracks, ridges and lineae. In [0, ~1]. */
float ridgedAA(vec3 p, float freq, int octaves, float fp, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  float prev = 1.0;
  for (int i = 0; i < 12; i++) {
    if (i >= octaves) break;
    float f = octaveFade(freq, fp);
    if (f <= 0.0) break;
    float n = 1.0 - abs(snoise(p * freq + vec3(float(i) * 11.7, float(i) * 5.3, float(i) * -7.9)));
    n = n * n;
    sum += amp * f * n * prev;
    prev = clamp(n * 1.6, 0.0, 1.0);
    amp *= gain;
    freq *= 2.07;
  }
  return sum;
}

vec3 pz_hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

/**
 * Cellular noise: distance to the nearest feature point (in cell units) and
 * that point's three random numbers — enough to give each crater a size, an
 * age and whether it exists at all.
 */
vec4 worley(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 8.0;
  vec3 bestR = vec3(0.0);
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 r = pz_hash33(i + g);
        vec3 d = g + r - f;
        float dd = dot(d, d);
        if (dd < best) {
          best = dd;
          bestR = r;
        }
      }
    }
  }
  return vec4(sqrt(best), bestR);
}

/** Latitude and longitude of a unit object-space direction (y north), radians. */
vec2 latLon(vec3 p) {
  return vec2(asin(clamp(p.y, -1.0, 1.0)), atan(-p.z, p.x));
}

/** Angular distance on the sphere from a point given as latitude/longitude in degrees. */
float angleTo(vec3 p, float latDeg, float lonDeg) {
  float la = radians(latDeg);
  float lo = radians(lonDeg);
  vec3 c = vec3(cos(la) * cos(lo), sin(la), -cos(la) * sin(lo));
  return acos(clamp(dot(p, c), -1.0, 1.0));
}

/**
 * Local east/north offsets from a centre, in degrees, for features shaped in
 * the map projection a planetary scientist would describe them in.
 */
vec2 localDeg(vec3 p, float latDeg, float lonDeg) {
  vec2 ll = degrees(latLon(p));
  float dlon = mod(ll.y - lonDeg + 540.0, 360.0) - 180.0;
  return vec2(dlon * cos(radians(latDeg)), ll.x - latDeg);
}
`
