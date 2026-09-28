/**
 * The worlds, one surface function each.
 *
 * Every recipe below is `void surface(vec3 p, float fp, out vec3 albedo, out
 * float height)`: given the unit direction to a point on the body (object
 * space, y north, x on the prime meridian) and the angle one pixel spans there,
 * it returns the reflectance and the relief in metres. Nothing is read from an
 * image, so there is nothing to pixelate: `fp` decides how many octaves the
 * pixel can hold, and a close approach simply resolves more of them.
 *
 * What is placed by name is placed where it is — the Great Red Spot in the
 * South Tropical Zone at 22.4°S, Olympus Mons at 18.65°N 226.2°E, Tombaugh
 * Regio's Sputnik Planitia at 20°N 180°E, Caloris at 30.5°N 170°E. What is
 * statistical is statistical: craters, eddies, lineae. Band latitudes are the
 * planetographic latitudes of the belts and zones as the Voyager, Galileo and
 * Cassini imaging teams named them.
 *
 * `uOct` is the tier's octave ceiling (sim/device.js). Colours are written in
 * sRGB, as they would be picked from a calibrated image, and linearised by
 * SRGB() at compile time.
 */

export const WORLD_COMMON = /* glsl */ `
#define SRGB(r, g, b) pow(vec3(r, g, b), vec3(2.2))
uniform float uOct;
uniform float uTime;
uniform float uRadius;

/** Smooth elliptical mask in a feature's own degrees: 1 inside, 0 outside. */
float blobDeg(vec3 p, float lat, float lon, float rx, float ry, float soft) {
  vec2 d = localDeg(p, lat, lon) / vec2(rx, ry);
  return 1.0 - smoothstep(1.0 - soft, 1.0 + soft, length(d));
}

/** Rotate p about a unit axis — for vortices, whose clouds circle their centre. */
vec3 swirl(vec3 p, vec3 axis, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

/**
 * One decade of impact craters, as (height in metres, brightness).
 *
 * Every feature point in the 27 cells round p contributes, and each crater's
 * reach is held inside one cell, so none is ever cut off at the edge of a
 * Voronoi region — taking only the nearest point drew those edges as dashed
 * lines across the plains. Depth follows the morphometry of real craters:
 * simple bowls are a fifth as deep as they are wide, and big complex craters
 * flatten out towards a few kilometres however wide they get, so a 400 km
 * basin on Mars is 3 km deep rather than the 180 km a fixed ratio would dig.
 * A crater's third random number is its age: the young are bright and rayed.
 */
vec2 craters(vec3 p, float freq, float density, float fp) {
  float fade = octaveFade(freq * 0.5, fp);
  if (fade <= 0.0) return vec2(0.0);
  vec3 x = p * freq;
  vec3 i = floor(x);
  vec3 f = fract(x);
  float bowl = 0.0;
  float rim = 0.0;
  float bright = 0.0;
  for (int a = -1; a <= 1; a++) {
    for (int b = -1; b <= 1; b++) {
      for (int c = -1; c <= 1; c++) {
        vec3 g = vec3(float(a), float(b), float(c));
        vec3 r = pz_hash33(i + g);
        if (r.x > density) continue;
        float rad = mix(0.08, 0.38, r.y * r.y);
        float t = length(g + pz_hash33(i + g + 71.3) - f) / rad;
        if (t > 2.5) continue;
        float diam = 2.0 * rad / freq * uRadius;
        float depth = 0.2 * diam * 9000.0 / (9000.0 + diam);
        float pb = t < 1.0 ? (t * t - 1.0) : 0.0;
        float pr = exp(-pow((t - 0.96) / 0.14, 2.0)) * 0.32 + (t > 1.0 ? exp(-(t - 1.0) * 2.6) * 0.1 : 0.0);
        bowl = min(bowl, pb * depth);
        rim += pr * depth;
        float fresh = r.z * r.z * r.z;
        bright += fresh * ((t < 1.25 ? 0.35 : 0.0) + exp(-max(t - 1.0, 0.0) * 1.7) * 0.3);
      }
    }
  }
  return vec2((bowl + rim) * fade, min(bright, 1.2) * fade);
}

/** A crease: thin where the noise crosses zero, drawn wider but fainter once it is under a pixel. */
float crease(vec3 q, float freq, float width, float fp) {
  float n = abs(snoise(q * freq));
  float px = fp * freq * 2.5;
  float w = max(width, px);
  return (1.0 - smoothstep(0.0, w, n)) * (width / w) * octaveFade(freq * 0.25, fp);
}

vec3 dirDeg(float latDeg, float lonDeg) {
  float la = radians(latDeg);
  float lo = radians(lonDeg);
  return vec3(cos(la) * cos(lo), sin(la), -cos(la) * sin(lo));
}

/**
 * A vortex: returns its core mask and writes the swirled sample point. The
 * rotation falls off with distance from the centre, so the clouds wind into
 * it the way they do round the Great Red Spot.
 */
float vortex(vec3 p, float lat, float lon, float rx, float ry, float spin, inout vec3 q) {
  vec2 d = localDeg(p, lat, lon) / vec2(rx, ry);
  float r = length(d);
  float ang = spin * exp(-r * r * 1.1);
  q = swirl(q, dirDeg(lat, lon), ang);
  return r;
}
`

/* ------------------------------------------------------------------ *
 * The giants
 * ------------------------------------------------------------------ */

/**
 * Jupiter, as Cassini saw it at the turn of the millennium: cream zones,
 * red-brown belts, the North Equatorial Belt darkest of all with blue-grey
 * festoons trailing off its southern edge into the Equatorial Zone, the Great
 * Red Spot in its bay in the South Equatorial Belt, white ovals in the south
 * temperate latitudes, and polar regions mottled grey with small storms.
 */
const JUPITER = /* glsl */ `
vec3 jupiterBands(float lat) {
  vec3 polar = SRGB(0.60, 0.58, 0.55);
  vec3 zone = SRGB(0.93, 0.89, 0.81);
  vec3 zoneW = SRGB(0.90, 0.82, 0.68);
  vec3 belt = SRGB(0.76, 0.62, 0.49);
  vec3 beltD = SRGB(0.64, 0.48, 0.36);
  vec3 beltL = SRGB(0.83, 0.74, 0.62);
  float w = 1.5;
  vec3 c = polar;
  c = mix(c, beltL, smoothstep(-52.0 - w, -52.0 + w, lat));
  c = mix(c, zone,  smoothstep(-47.0 - w, -47.0 + w, lat));
  c = mix(c, beltL, smoothstep(-43.0 - w, -43.0 + w, lat));   // SSTB
  c = mix(c, zone,  smoothstep(-38.5 - w, -38.5 + w, lat));   // STZ
  c = mix(c, belt,  smoothstep(-34.5 - w, -34.5 + w, lat));   // STB
  c = mix(c, zoneW, smoothstep(-29.5 - w, -29.5 + w, lat));   // STrZ
  c = mix(c, beltD, smoothstep(-19.5 - w, -19.5 + w, lat));   // SEBs
  c = mix(c, belt,  smoothstep(-15.0 - w, -15.0 + w, lat));   // SEB centre
  c = mix(c, beltD, smoothstep(-11.5 - w, -11.5 + w, lat));   // SEBn
  c = mix(c, zoneW, smoothstep(-7.5 - w, -7.5 + w, lat));     // EZ(s)
  c = mix(c, zone,  smoothstep(-4.0 - w, -4.0 + w, lat));
  c = mix(c, SRGB(0.86, 0.78, 0.64), smoothstep(-1.2 - w, -1.2 + w, lat)); // the equatorial band
  c = mix(c, zone,  smoothstep(1.2 - w, 1.2 + w, lat));
  c = mix(c, zoneW, smoothstep(4.5 - w, 4.5 + w, lat));
  c = mix(c, beltD, smoothstep(7.5 - w, 7.5 + w, lat));       // NEB
  c = mix(c, SRGB(0.58, 0.42, 0.31), smoothstep(11.0 - w, 11.0 + w, lat));
  c = mix(c, belt,  smoothstep(15.0 - w, 15.0 + w, lat));
  c = mix(c, zone,  smoothstep(18.0 - w, 18.0 + w, lat));     // NTrZ
  c = mix(c, belt,  smoothstep(24.0 - w, 24.0 + w, lat));     // NTB
  c = mix(c, zone,  smoothstep(29.0 - w, 29.0 + w, lat));     // NTZ
  c = mix(c, beltL, smoothstep(35.0 - w, 35.0 + w, lat));     // NNTB
  c = mix(c, zoneW, smoothstep(39.5 - w, 39.5 + w, lat));     // NNTZ
  c = mix(c, beltL, smoothstep(43.5 - w, 43.5 + w, lat));
  c = mix(c, zone,  smoothstep(47.0 - w, 47.0 + w, lat));
  c = mix(c, polar, smoothstep(50.0 - 4.0, 50.0 + 4.0, lat));
  return c;
}

/** How hard each latitude churns: the belts and the shear at every edge, and the poles. */
float jupiterShear(float lat) {
  float a = abs(lat);
  return 0.5 + 0.6 * smoothstep(42.0, 58.0, a)
    + 0.4 * (1.0 - smoothstep(0.0, 5.0, abs(lat - 11.0)))
    + 0.45 * (1.0 - smoothstep(0.0, 7.0, abs(lat + 15.0)))
    + 0.3 * (1.0 - smoothstep(0.0, 3.0, abs(lat - 24.0)));
}

void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float latDeg = degrees(asin(clamp(p.y, -1.0, 1.0)));

  // Vortices first: they bend the flow the bands are drawn from.
  vec3 q = p;
  float grs = vortex(p, -22.4, 58.0, 10.5, 5.8, 3.4, q);
  float ba = vortex(p, -33.2, 172.0, 3.4, 2.4, 2.6, q);
  float ov1 = vortex(p, -40.5, 260.0, 2.2, 1.6, 2.2, q);
  float ov2 = vortex(p, 41.0, 310.0, 1.8, 1.4, 2.0, q);
  float ov3 = vortex(p, -43.5, 20.0, 1.6, 1.2, 2.0, q);

  // Zonal flow: latitude compressed, so every eddy is drawn out east-west.
  float stretch = 3.6;
  vec3 z = vec3(q.x, q.y * stretch, q.z);
  float zfp = fp * stretch;
  float w1 = fbmAA(z, 2.4, oct, zfp, 0.58);
  float w2 = fbmAA(z + vec3(5.2, 1.3, -2.8), 2.4, oct, zfp, 0.58);
  vec3 zz = z + vec3(w1, w2 * 0.2, -w1) * 0.34;
  float turb = fbmAA(zz, 5.0, oct, zfp, 0.62);
  float fine = fbmAA(zz * 2.3 + 7.1, 9.0, oct, zfp * 2.3, 0.6);
  // Kelvin-Helmholtz waves along the band edges.
  vec2 ll = latLon(p);
  float waves = sin(ll.y * 38.0 + turb * 6.0) * 0.35 + sin(ll.y * 71.0 - fine * 5.0) * 0.2;
  float shear = jupiterShear(latDeg);
  float lat = latDeg + (turb * 2.4 + fine * 0.9 + waves * 0.5) * shear;

  vec3 c = jupiterBands(lat);

  // Marbling: the dye the flow carries, advected twice over, so every band is
  // textured through rather than filled flat between its edges.
  float marble = fbmAA(zz * 1.4 + vec3(w2, 0.0, w1) * 0.7, 3.2, oct, zfp * 1.4, 0.64);
  float marble2 = fbmAA(zz * 3.1 - vec3(w1, 0.0, w2) * 0.5, 7.0, oct, zfp * 3.1, 0.62);
  c *= 1.0 + marble * 0.3 * shear + marble2 * 0.12;

  // Fine banding inside the bands, and filaments along the flow.
  c *= 1.0 + 0.06 * sin(radians(lat) * 70.0 + fine * 3.0);
  float streak = fbmAA(vec3(q.x, q.y * 16.0, q.z), 11.0, oct, fp * 16.0, 0.64);
  float fil = ridgedAA(zz * 1.8, 6.0, oct, zfp * 1.8, 0.58);
  c *= 1.0 + streak * 0.14 + (fil - 0.3) * 0.12;

  // Festoons: blue-grey plumes trailing off the NEB's southern edge into the EZ.
  float fest = sin(ll.y * 12.0 + turb * 3.5 + p.y * 45.0);
  float festMask = smoothstep(0.6, 0.97, fest) * (1.0 - smoothstep(0.0, 3.0, abs(lat - 5.8)));
  c = mix(c, SRGB(0.47, 0.49, 0.53), festMask * 0.6);

  // Small ovals and brown barges at their usual latitudes.
  vec4 cell = worley(vec3(q.x * 9.0, q.y * 28.0, q.z * 9.0));
  float small = (1.0 - smoothstep(0.09, 0.16, cell.x)) * octaveFade(28.0, fp);
  float whiteLat = (1.0 - smoothstep(0.0, 4.0, abs(abs(latDeg) - 39.0))) + (1.0 - smoothstep(0.0, 3.0, abs(latDeg + 27.0)));
  c = mix(c, SRGB(0.95, 0.93, 0.89), small * step(cell.y, 0.35) * clamp(whiteLat, 0.0, 1.0) * 0.8);
  float bargeLat = 1.0 - smoothstep(0.0, 2.0, abs(latDeg - 14.0));
  c = mix(c, SRGB(0.45, 0.30, 0.22), small * step(cell.y, 0.25) * bargeLat * 0.8);

  // Polar mottling: a field of small cyclones, bluer and greyer than the bands.
  float pole = smoothstep(46.0, 62.0, abs(latDeg));
  if (pole > 0.0) {
    vec4 pc = worley(p * 40.0 + turb * 0.3);
    float storm = 1.0 - smoothstep(0.1, 0.32, pc.x);
    c = mix(c, c * (0.78 + 0.35 * pc.y), pole * storm * 0.75);
    c = mix(c, c * SRGB(0.93, 0.96, 1.0), pole * 0.5);
  }

  // The Great Red Spot, its pale collar, and the white ovals.
  float n = fbmAA(q * 2.0, 12.0, oct, fp, 0.58);
  float core = 1.0 - smoothstep(0.5, 1.0, grs + n * 0.2);
  float collar = (1.0 - smoothstep(1.0, 1.4, grs)) * (1.0 - core);
  vec3 red = mix(SRGB(0.80, 0.46, 0.32), SRGB(0.88, 0.58, 0.42), smoothstep(-0.3, 0.3, n));
  c = mix(c, red, core);
  c = mix(c, SRGB(0.95, 0.91, 0.84), collar * 0.7);
  c = mix(c, SRGB(0.97, 0.95, 0.92), (1.0 - smoothstep(0.65, 1.05, ba + n * 0.22)) * 0.9);
  c = mix(c, SRGB(0.97, 0.95, 0.92), (1.0 - smoothstep(0.65, 1.05, ov1 + n * 0.22)) * 0.85);
  c = mix(c, SRGB(0.96, 0.94, 0.91), (1.0 - smoothstep(0.65, 1.05, ov2 + n * 0.22)) * 0.8);
  c = mix(c, SRGB(0.96, 0.94, 0.91), (1.0 - smoothstep(0.65, 1.05, ov3 + n * 0.22)) * 0.75);

  albedo = c;
  // Cloud tops tower by a few kilometres in the storms; the rest is haze.
  height = (turb * 0.4 + fil * 0.8 + core * 0.8 + small * 0.4) * 3.0e3;
}
`

/**
 * Saturn: the same machinery at a fraction of the contrast — Saturn's haze
 * layer mutes everything — with the hexagon round the north pole, a jet
 * stream six-sided since Voyager, and the polar vortex at its centre.
 */
const SATURN = /* glsl */ `
vec3 saturnBands(float lat) {
  vec3 zone = SRGB(0.92, 0.85, 0.68);
  vec3 zoneB = SRGB(0.95, 0.90, 0.74);
  vec3 belt = SRGB(0.87, 0.78, 0.60);
  vec3 beltD = SRGB(0.83, 0.72, 0.53);
  vec3 polarS = SRGB(0.76, 0.72, 0.62);
  float w = 2.6;
  vec3 c = polarS;
  c = mix(c, belt,  smoothstep(-62.0 - w, -62.0 + w, lat));
  c = mix(c, zone,  smoothstep(-52.0 - w, -52.0 + w, lat));
  c = mix(c, beltD, smoothstep(-42.0 - w, -42.0 + w, lat));
  c = mix(c, zone,  smoothstep(-35.0 - w, -35.0 + w, lat));
  c = mix(c, belt,  smoothstep(-26.0 - w, -26.0 + w, lat));
  c = mix(c, zoneB, smoothstep(-18.0 - w, -18.0 + w, lat));
  c = mix(c, zoneB, smoothstep(18.0 - w, 18.0 + w, lat));
  c = mix(c, beltD, smoothstep(20.0 - w, 20.0 + w, lat));
  c = mix(c, zone,  smoothstep(30.0 - w, 30.0 + w, lat));
  c = mix(c, belt,  smoothstep(38.0 - w, 38.0 + w, lat));
  c = mix(c, zone,  smoothstep(46.0 - w, 46.0 + w, lat));
  c = mix(c, beltD, smoothstep(56.0 - w, 56.0 + w, lat));
  c = mix(c, SRGB(0.70, 0.70, 0.66), smoothstep(66.0 - 3.0, 66.0 + 3.0, lat));
  return c;
}

void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float latDeg = degrees(asin(clamp(p.y, -1.0, 1.0)));
  vec3 q = p;
  // The Great White Spot is episodic; a few small ovals are always there.
  float o1 = vortex(p, -42.0, 120.0, 2.2, 1.6, 2.0, q);
  float o2 = vortex(p, 33.0, 300.0, 1.8, 1.3, 2.0, q);

  float stretch = 4.2;
  vec3 z = vec3(q.x, q.y * stretch, q.z);
  float zfp = fp * stretch;
  float w1 = fbmAA(z, 2.0, oct, zfp, 0.5);
  vec3 zz = z + vec3(w1, 0.0, -w1) * 0.25;
  float turb = fbmAA(zz, 5.0, oct, zfp, 0.55);
  float lat = latDeg + turb * 1.4;
  vec3 c = saturnBands(lat);
  float streak = fbmAA(vec3(q.x, q.y * 18.0, q.z), 10.0, oct, fp * 18.0, 0.6);
  float marble = fbmAA(zz * 1.6 + vec3(w1, 0.0, -w1) * 0.5, 3.0, oct, zfp * 1.6, 0.62);
  c *= 1.0 + streak * 0.07 + turb * 0.04 + marble * 0.08;
  c *= 1.0 + 0.035 * sin(radians(lat) * 90.0 + turb * 2.0);

  // The hexagon: a regular six-sided jet at 78°N, bluer inside, a dark eye at the pole.
  if (latDeg > 64.0) {
    float rho = 90.0 - latDeg;
    float th = atan(-p.z, p.x) + 0.35;
    float sector = mod(th, 1.0471976) - 0.5235988;
    float edge = 12.8 / cos(sector);
    float wob = fbmAA(p * 30.0, 1.0, oct, fp * 30.0, 0.5) * 0.8;
    float inside = 1.0 - smoothstep(edge - 0.6, edge + 0.6, rho + wob);
    c = mix(c, SRGB(0.62, 0.66, 0.70), inside * 0.75);
    float jet = 1.0 - smoothstep(0.0, 1.1, abs(rho + wob - edge));
    c = mix(c, SRGB(0.58, 0.55, 0.50), jet * 0.45);
    float eye = 1.0 - smoothstep(0.6, 2.4, rho);
    c = mix(c, SRGB(0.30, 0.30, 0.32), eye * 0.8);
  }
  float n = fbmAA(q * 3.0, 8.0, oct, fp, 0.5);
  c = mix(c, SRGB(0.97, 0.95, 0.90), (1.0 - smoothstep(0.6, 1.05, o1 + n * 0.25)) * 0.7);
  c = mix(c, SRGB(0.97, 0.95, 0.90), (1.0 - smoothstep(0.6, 1.05, o2 + n * 0.25)) * 0.6);
  albedo = c;
  height = turb * 2.5e3;
}
`

/**
 * Uranus: methane takes the red out of the light and leaves a pale cyan
 * almost without features. What there is — a brighter collar near 45° south,
 * lit at the turn of the millennium, and faint banding — is kept faint.
 */
const URANUS = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float latDeg = degrees(asin(clamp(p.y, -1.0, 1.0)));
  vec3 z = vec3(p.x, p.y * 5.0, p.z);
  float turb = fbmAA(z, 3.0, oct, fp * 5.0, 0.5);
  float lat = latDeg + turb * 2.0;
  vec3 c = SRGB(0.66, 0.85, 0.88);
  c *= 1.0 + 0.025 * sin(radians(lat) * 18.0);
  float collar = (1.0 - smoothstep(0.0, 6.0, abs(lat + 47.0)));
  c = mix(c, SRGB(0.78, 0.92, 0.93), collar * 0.5);
  float cap = smoothstep(-58.0, -75.0, lat);
  c = mix(c, SRGB(0.74, 0.90, 0.92), cap * 0.35);
  // A few bright methane clouds at mid latitudes.
  float cl = fbmAA(vec3(p.x, p.y * 3.0, p.z) * 1.0, 9.0, oct, fp * 3.0, 0.55);
  c = mix(c, SRGB(0.92, 0.98, 0.98), smoothstep(0.42, 0.62, cl) * (1.0 - smoothstep(20.0, 40.0, abs(latDeg - 30.0))) * 0.6);
  albedo = c;
  height = turb * 1.5e3;
}
`

/**
 * Neptune: deeper blue than Uranus for a reason nobody has fully settled —
 * a thinner haze — with high white methane cirrus casting shadows on the deck
 * below, a dark vortex in the northern mid-latitudes where Hubble found one in
 * 1994, and its bright companion cloud.
 */
const NEPTUNE = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float latDeg = degrees(asin(clamp(p.y, -1.0, 1.0)));
  vec3 q = p;
  float spot = vortex(p, 32.0, 210.0, 6.0, 3.0, 2.6, q);
  vec3 z = vec3(q.x, q.y * 4.5, q.z);
  float zfp = fp * 4.5;
  float w1 = fbmAA(z, 2.0, oct, zfp, 0.55);
  vec3 zz = z + vec3(w1, 0.0, -w1) * 0.35;
  float turb = fbmAA(zz, 4.5, oct, zfp, 0.58);
  float lat = latDeg + turb * 3.0;
  vec3 c = SRGB(0.33, 0.49, 0.86);
  c = mix(c, SRGB(0.26, 0.40, 0.78), (1.0 - smoothstep(0.0, 9.0, abs(lat + 25.0))) * 0.5);
  c = mix(c, SRGB(0.42, 0.58, 0.90), smoothstep(-55.0, -70.0, lat) * 0.5);
  c *= 1.0 + turb * 0.08;
  // Cirrus: bright, thin, drawn out east–west at ±20–45°.
  float ci = fbmAA(vec3(q.x, q.y * 9.0, q.z), 7.0, oct, fp * 9.0, 0.6);
  float band = (1.0 - smoothstep(8.0, 16.0, abs(abs(latDeg) - 31.0)));
  float cirrus = smoothstep(0.30, 0.55, ci) * band;
  c = mix(c, SRGB(0.93, 0.96, 1.0), cirrus * 0.85);
  // The dark spot, and the bright cloud that rides its southern flank.
  float n = fbmAA(q * 4.0, 8.0, oct, fp, 0.5);
  c = mix(c, SRGB(0.14, 0.22, 0.52), (1.0 - smoothstep(0.55, 1.0, spot + n * 0.2)) * 0.85);
  float comp = blobDeg(p, 27.5, 212.0, 3.5, 1.2, 0.4);
  c = mix(c, SRGB(0.95, 0.97, 1.0), comp * 0.8);
  albedo = c;
  height = (turb + cirrus * 1.5) * 3.0e3;
}
`

/* ------------------------------------------------------------------ *
 * The rocky and icy worlds
 * ------------------------------------------------------------------ */

/**
 * Mercury: grey-brown, cratered at every scale, with bright young rays, the
 * darker low-reflectance material MESSENGER mapped, the smooth volcanic plains,
 * and Caloris — 1,550 km across, its floor paler and its rim a ring of
 * mountains.
 */
const MERCURY = /* glsl */ `
float rays(vec3 p, float lat, float lon, float reach, float fp) {
  float a = angleTo(p, lat, lon);
  if (a > reach) return 0.0;
  vec2 d = localDeg(p, lat, lon);
  float az = atan(d.y, d.x);
  float streaks = pow(max(0.0, snoise(vec3(cos(az) * 9.0, sin(az) * 9.0, lat))), 3.0);
  return streaks * (1.0 - a / reach) * smoothstep(0.004, 0.012, a);
}

void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float n = fbmAA(p, 3.0, oct, fp, 0.55);
  float lrm = smoothstep(0.05, 0.35, fbmAA(p + 3.1, 1.6, 4, fp, 0.5));
  vec3 c = mix(SRGB(0.60, 0.57, 0.53), SRGB(0.47, 0.46, 0.45), lrm);
  c *= 1.0 + n * 0.12;
  float h = n * 1500.0;
  // Four decades of craters; smooth plains hold fewer.
  float plains = smoothstep(0.1, 0.4, fbmAA(p - 7.3, 1.2, 3, fp, 0.5));
  vec2 k1 = craters(p, 5.0, 0.55, fp);
  vec2 k2 = craters(p, 12.0, 0.6 - plains * 0.3, fp);
  vec2 k3 = craters(p, 28.0, 0.65 - plains * 0.35, fp);
  vec2 k4 = craters(p, 64.0, 0.7 - plains * 0.4, fp);
  vec2 k5 = craters(p, 150.0, 0.7, fp);
  h += k1.x + k2.x + k3.x + k4.x + k5.x;
  c *= 1.0 + (k1.y + k2.y + k3.y + k4.y + k5.y) * 0.5;
  // Caloris: pale floor, a mountain ring at its rim.
  float cal = angleTo(p, 30.5, 170.2);
  c = mix(c, SRGB(0.66, 0.60, 0.52), (1.0 - smoothstep(0.26, 0.32, cal)) * 0.6);
  h += exp(-pow((cal - 0.318) / 0.02, 2.0)) * 2500.0 - (1.0 - smoothstep(0.2, 0.32, cal)) * 1500.0;
  // Bright rays from the youngest large craters: Hokusai, Kuiper, Debussy.
  float r = rays(p, 57.8, 16.8, 0.9, fp) + rays(p, -11.4, 328.6, 0.6, fp) + rays(p, -33.9, 347.5, 0.7, fp);
  c = mix(c, SRGB(0.82, 0.80, 0.76), clamp(r, 0.0, 1.0) * 0.55);
  albedo = c;
  height = h;
}
`

/**
 * Venus: the cloud deck, which is all that visible light ever sees. Nearly
 * featureless — a pale cream-yellow — with the faint dark chevrons and banding
 * the ultraviolet makes obvious, kept at the few per cent they are in visible
 * light, and turned once every four days by the super-rotating winds.
 */
const VENUS = /* glsl */ `
uniform float uCloudTurn;
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float c1 = cos(uCloudTurn);
  float s1 = sin(uCloudTurn);
  vec3 q = vec3(c1 * p.x + s1 * p.z, p.y, -s1 * p.x + c1 * p.z);
  float latDeg = degrees(asin(clamp(q.y, -1.0, 1.0)));
  float lon = atan(-q.z, q.x);
  vec3 z = vec3(q.x, q.y * 2.4, q.z);
  float w = fbmAA(z, 1.8, oct, fp * 2.4, 0.55);
  float band = fbmAA(z + vec3(w * 0.6, 0.0, -w * 0.6), 3.5, oct, fp * 2.4, 0.6);
  // The Y: dark chevrons opening westward from the equator.
  float chev = sin(lon * 1.0 + abs(radians(latDeg)) * 3.2 + w * 1.5);
  vec3 c = SRGB(0.96, 0.92, 0.80);
  c = mix(c, SRGB(0.88, 0.82, 0.66), smoothstep(0.2, 0.9, chev) * 0.18 * (1.0 - smoothstep(35.0, 60.0, abs(latDeg))));
  c *= 1.0 + band * 0.05;
  // Polar collars: brighter rings round each pole.
  c = mix(c, SRGB(0.99, 0.97, 0.90), (1.0 - smoothstep(0.0, 8.0, abs(abs(latDeg) - 65.0))) * 0.25);
  albedo = c;
  height = band * 1500.0;
}
`

/**
 * Mars. The dark albedo features every telescope since Schiaparelli has drawn,
 * each where it is; the relief the Mars Orbiter Laser Altimeter measured
 * underneath them — the Tharsis volcanoes, Olympus Mons 21 km high inside its
 * cliff, Valles Marineris four thousand kilometres long, the Hellas and Argyre
 * basins, the hemispheric dichotomy; cratered southern highlands; and the
 * residual polar caps, the northern one scored by its spiral troughs.
 */
const MARS = /* glsl */ `
float shield(vec3 p, float lat, float lon, float radius, float peak) {
  float a = angleTo(p, lat, lon) / radius;
  if (a > 1.35) return 0.0;
  float body = peak * pow(max(0.0, 1.0 - a), 1.6);
  float caldera = (1.0 - smoothstep(0.03, 0.09, a)) * peak * 0.14;
  return body - caldera;
}

void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  vec2 ll = degrees(latLon(p));
  float lat = ll.x;
  float n = fbmAA(p, 2.2, oct, fp, 0.55);
  float n2 = fbmAA(p + 11.3, 6.5, oct, fp, 0.58);
  float n3 = fbmAA(p - 4.9, 19.0, oct, fp, 0.6);

  // The classical dark markings, each where the maps put it — looked up
  // through a warped direction, so no marking keeps the ellipse it was placed as.
  vec3 pw = normalize(p + vec3(fbmAA(p + 1.7, 3.0, 5, fp, 0.55), fbmAA(p - 2.9, 3.0, 5, fp, 0.55), fbmAA(p + 6.1, 3.0, 5, fp, 0.55)) * 0.16);
  vec3 p0 = p;
  p = pw;
  float dark = 0.0;
  dark += blobDeg(p, 9.0, 69.0, 7.0, 14.0, 0.6);           // Syrtis Major
  dark += blobDeg(p, -7.0, 22.0, 22.0, 5.0, 0.6);          // Sinus Sabaeus
  dark += blobDeg(p, -2.5, 358.0, 9.0, 3.5, 0.6);          // Sinus Meridiani
  dark += blobDeg(p, 47.0, 330.0, 15.0, 10.0, 0.6) * 0.8;  // Mare Acidalium
  dark += blobDeg(p, -25.0, 334.0, 19.0, 8.0, 0.6) * 0.85; // Mare Erythraeum
  dark += blobDeg(p, -18.0, 100.0, 19.0, 7.0, 0.6) * 0.75; // Mare Tyrrhenum
  dark += blobDeg(p, -23.0, 148.0, 20.0, 7.0, 0.6) * 0.8;  // Mare Cimmerium
  dark += blobDeg(p, -31.0, 200.0, 18.0, 6.5, 0.6) * 0.75; // Mare Sirenum
  dark += blobDeg(p, -26.0, 272.0, 4.5, 3.2, 0.6) * 0.85;  // Solis Lacus
  dark += blobDeg(p, -12.0, 307.0, 8.0, 4.0, 0.6) * 0.6;   // Aurorae Sinus
  dark += blobDeg(p, 44.0, 108.0, 22.0, 9.0, 0.6) * 0.4;   // Utopia
  dark += blobDeg(p, 20.0, 290.0, 6.0, 3.0, 0.6) * 0.4;    // Lunae Palus edge
  dark += blobDeg(p, 71.0, 0.0, 180.0, 5.0, 0.6) * 0.45;   // the north polar erg
  dark -= blobDeg(p, -42.0, 70.0, 16.0, 12.0, 0.5) * 1.1;  // Hellas, bright with frost and dust
  dark -= blobDeg(p, -50.0, 318.0, 9.0, 7.0, 0.5) * 0.9;   // Argyre
  dark -= blobDeg(p, 22.0, 20.0, 22.0, 12.0, 0.6) * 0.5;   // Arabia Terra
  dark -= blobDeg(p, 25.0, 147.0, 10.0, 8.0, 0.6) * 0.5;   // Elysium
  dark -= blobDeg(p, 5.0, 245.0, 28.0, 22.0, 0.6) * 0.45;  // Tharsis
  dark -= blobDeg(p, 12.0, 200.0, 14.0, 10.0, 0.6) * 0.5;  // Amazonis
  p = p0;
  float d = smoothstep(0.28, 0.8, dark + n * 0.3 + n2 * 0.2 + n3 * 0.1);

  // Relief: the dichotomy, the basins, the volcanoes, the canyon.
  float south = smoothstep(-0.2, 0.2, -dot(p, dirDeg(58.0, 190.0)) + 0.12 + n * 0.25);
  float h = mix(-4000.0, 1500.0, south) + n * 1400.0 + n2 * 500.0;
  float hel = angleTo(p, -42.0, 70.0);
  h -= (1.0 - smoothstep(0.1, 0.36, hel)) * 7000.0;
  h += exp(-pow((hel - 0.38) / 0.05, 2.0)) * 1500.0;
  h -= (1.0 - smoothstep(0.05, 0.25, angleTo(p, -50.0, 318.0))) * 3500.0;
  h += (1.0 - smoothstep(0.1, 0.5, angleTo(p, 2.0, 250.0))) * 6000.0;       // the Tharsis rise
  float olyA = angleTo(p, 18.65, 226.2);
  float olympus = shield(p, 18.65, 226.2, 0.088, 21000.0) * (smoothstep(0.094, 0.086, olyA) + 0.02);
  h += olympus;
  h += shield(p, -8.3, 238.9, 0.06, 14000.0);                               // Arsia
  h += shield(p, 1.5, 247.3, 0.05, 11000.0);                                // Pavonis
  h += shield(p, 11.8, 255.9, 0.055, 14000.0);                              // Ascraeus
  h += shield(p, 40.5, 250.4, 0.2, 5000.0);                                 // Alba
  h += shield(p, 24.8, 146.9, 0.045, 11000.0);                              // Elysium Mons
  // Valles Marineris: a trough 4,000 km long, braided at its western end.
  vec2 v = localDeg(p, -10.0, 290.0);
  float along = v.x / 30.0;
  float wob = snoise(vec3(v.x * 0.12, 0.0, 3.0)) * 1.4;
  float across = abs(v.y + along * 3.0 - wob);
  float canyon = (1.0 - smoothstep(0.7, 2.4, across)) * (1.0 - smoothstep(0.85, 1.1, abs(along)));
  float laby = (1.0 - smoothstep(0.0, 6.0, length(localDeg(p, -7.0, 258.0)))) * crease(p, 60.0, 0.12, fp);
  h -= canyon * 7000.0 + laby * 2000.0;
  d = max(d, canyon * 0.55);

  // Craters, thicker in the old south.
  vec2 k1 = craters(p, 7.0, 0.3 + south * 0.3, fp);
  vec2 k2 = craters(p, 18.0, 0.25 + south * 0.4, fp);
  vec2 k3 = craters(p, 45.0, 0.2 + south * 0.45, fp);
  vec2 k4 = craters(p, 110.0, 0.35, fp);
  vec2 k5 = craters(p, 280.0, 0.4, fp);
  h += k1.x + k2.x + k3.x + k4.x + k5.x;

  vec3 bright = SRGB(0.80, 0.56, 0.38);
  vec3 mid = SRGB(0.70, 0.46, 0.31);
  vec3 darkC = SRGB(0.47, 0.34, 0.26);
  vec3 c = mix(bright, mid, smoothstep(-0.3, 0.6, n2 * 0.45 + south * 0.35));
  c = mix(c, darkC, d * 0.9);
  c *= 1.0 + n3 * 0.05 + (k1.y + k2.y + k3.y + k4.y) * 0.05;
  // Wind streaks: bright tails downwind of craters, the dust moved by the seasons.
  c = mix(c, c * 1.08, smoothstep(0.2, 0.6, n3) * 0.5);

  // The residual caps. North: 1,000 km of water ice, spiral troughs cut in it.
  float capN = smoothstep(79.0, 82.5, lat + n2 * 3.0 + n3);
  if (capN > 0.0) {
    float rho = 90.0 - lat;
    float th = atan(-p.z, p.x);
    float trough = smoothstep(0.55, 0.92, sin(th * 2.0 + rho * 0.9 + n * 3.0));
    vec3 ice = SRGB(0.95, 0.94, 0.92) * (1.0 - trough * 0.3);
    c = mix(c, ice, capN);
    h += capN * 2000.0 - trough * capN * 500.0;
  }
  float capS = 1.0 - smoothstep(3.5, 5.5, degrees(angleTo(p, -87.0, 315.0)) + n2 * 1.5 + n3 * 0.6);
  c = mix(c, SRGB(0.93, 0.93, 0.94), capS);
  albedo = c;
  height = h;
}
`

/**
 * Io: sulphur in every colour it comes in — yellow, orange, the red of short
 * sulphur chains round the poles, white sulphur-dioxide frost — pocked with
 * the black calderas of four hundred volcanoes, Pele's red ring and dark Loki.
 */
const IO = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float lat = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float n = fbmAA(p, 2.5, oct, fp, 0.55);
  float n2 = fbmAA(p + 4.7, 7.0, oct, fp, 0.55);
  vec3 c = mix(SRGB(0.93, 0.86, 0.52), SRGB(0.95, 0.72, 0.36), smoothstep(-0.2, 0.5, n));
  c = mix(c, SRGB(0.96, 0.95, 0.88), smoothstep(0.25, 0.55, n2) * 0.7);
  c = mix(c, SRGB(0.62, 0.40, 0.26), smoothstep(50.0, 75.0, abs(lat) + n * 12.0) * 0.75);
  float h = n * 2000.0;
  // Paterae: black floors, and haloes of fresh sulphur round some of them.
  vec4 v1 = worley(p * 14.0);
  vec4 v2 = worley(p * 36.0);
  float pat1 = (1.0 - smoothstep(0.05, 0.12, v1.x)) * step(v1.y, 0.45);
  float halo1 = (1.0 - smoothstep(0.12, 0.34, v1.x)) * step(v1.y, 0.45) * step(0.6, v1.z);
  float pat2 = (1.0 - smoothstep(0.06, 0.13, v2.x)) * step(v2.y, 0.3);
  c = mix(c, SRGB(0.85, 0.42, 0.20), halo1 * 0.5);
  c = mix(c, SRGB(0.12, 0.10, 0.08), max(pat1, pat2 * octaveFade(36.0, fp)));
  h -= (pat1 + pat2) * 800.0;
  // Pele's plume ring, 1,200 km across; Loki, the largest caldera.
  float pele = angleTo(p, -18.7, 104.6);
  c = mix(c, SRGB(0.78, 0.30, 0.16), exp(-pow((pele - 0.3) / 0.06, 2.0)) * 0.75);
  c = mix(c, SRGB(0.10, 0.09, 0.08), blobDeg(p, 12.6, 51.0, 3.5, 2.2, 0.3));
  albedo = c;
  height = h;
}
`

/**
 * Europa: ice the colour of old ivory, cut by lineae — the reddish-brown
 * double ridges that run for hundreds of kilometres — with chaos terrain
 * where the ice has broken up, a darker, redder trailing hemisphere, and
 * Pwyll's bright rays.
 */
const EUROPA = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float n = fbmAA(p, 2.0, oct, fp, 0.55);
  float n2 = fbmAA(p + 3.7, 9.0, oct, fp, 0.55);
  // The trailing hemisphere (centred on 90°E here) is darker and redder:
  // sulphur from Io, driven into the ice by Jupiter's magnetosphere.
  float trailing = 0.5 + 0.5 * dot(p, dirDeg(0.0, 90.0));
  vec3 ice = mix(SRGB(0.95, 0.93, 0.88), SRGB(0.84, 0.77, 0.66), trailing * 0.55 + n * 0.15);
  ice *= 1.0 + n2 * 0.05;
  // Lineae: long, gently curving cracks crossing one another for hundreds of
  // kilometres — arcs of small circles, each with a slight cycloidal wobble,
  // a dark reddish centre and a diffuse brown margin — over a finer network
  // that only resolves up close.
  float lines = 0.0;
  float halo = 0.0;
  for (int i = 0; i < 56; i++) {
    vec3 h = pz_hash33(vec3(float(i) * 3.17, 1.3, 7.7));
    vec3 h2 = pz_hash33(vec3(float(i) * 1.71, 5.1, 2.3));
    vec3 nrm = normalize(h * 2.0 - 1.0);
    vec3 mid = normalize(h2 * 2.0 - 1.0);
    float off = (h.x - 0.5) * 0.35;
    float onp = dot(p, nrm);
    vec3 a = p - nrm * onp;
    vec3 b = mid - nrm * dot(mid, nrm);
    float along = acos(clamp(dot(normalize(a), normalize(b)), -1.0, 1.0));
    float len = mix(0.25, 1.4, h2.z * h2.z);
    float seg = 1.0 - smoothstep(len * 0.75, len, along);
    float d = abs(onp - off + 0.008 * sin(along * 26.0 + float(i)));
    float w = mix(0.0008, 0.004, h.y * h.y);
    float we = max(w, fp * 1.2);
    lines = max(lines, (1.0 - smoothstep(we * 0.4, we, d)) * (w / we) * seg);
    halo = max(halo, (1.0 - smoothstep(w, w * 5.0, d)) * seg);
  }
  float fineL = crease(p + 0.9, 27.0, 0.04, fp) * 0.5 + crease(p - 3.3, 61.0, 0.05, fp) * 0.4;
  vec3 c = mix(ice, SRGB(0.72, 0.56, 0.42), halo * 0.35 * (0.7 + trailing * 0.3));
  c = mix(c, SRGB(0.55, 0.35, 0.24), clamp(lines + fineL, 0.0, 1.0) * (0.78 + trailing * 0.15));
  // Chaos terrain: broken rafts of ice in a brown matrix, in patches.
  float chaos = smoothstep(0.42, 0.6, fbmAA(p + 9.1, 3.2, oct, fp, 0.55)) * (0.35 + trailing * 0.65);
  if (chaos > 0.0) {
    vec4 raft = worley(p * 90.0);
    float matrix = smoothstep(0.18, 0.3, raft.x);
    vec3 cc = mix(SRGB(0.88, 0.84, 0.76), SRGB(0.58, 0.42, 0.31), matrix * (0.6 + 0.4 * raft.y));
    c = mix(c, cc, chaos * 0.85);
  }
  // Pwyll: a young crater whose bright rays run a thousand kilometres.
  float pw = angleTo(p, -25.2, 89.0);
  vec2 dv = localDeg(p, -25.2, 89.0);
  float az = atan(dv.y, dv.x);
  float ray = pow(max(0.0, snoise(vec3(cos(az) * 7.0, sin(az) * 7.0, 1.3))), 2.0);
  c = mix(c, SRGB(0.98, 0.98, 0.97), (1.0 - smoothstep(0.02, 0.5, pw)) * (0.35 + 0.65 * ray) * 0.6);
  albedo = c;
  height = (lines + fineL) * 250.0 + halo * 80.0 - chaos * 150.0 + n * 400.0;
}
`

/**
 * Ganymede: the largest moon in the solar system is two terrains — dark,
 * ancient, crater-saturated regions like Galileo Regio, and bright younger
 * bands scored with parallel grooves — with frost caps above the forties and
 * bright rayed craters.
 */
const GANYMEDE = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float lat = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float n = fbmAA(p, 2.0, oct, fp, 0.55);
  float darkTerrain = smoothstep(-0.05, 0.15, fbmAA(p + 3.3, 1.6, 4, fp, 0.5) + blobDeg(p, 35.0, 215.0, 40.0, 30.0, 0.5) * 0.3);
  vec3 darkC = SRGB(0.40, 0.36, 0.31);
  vec3 brightC = SRGB(0.66, 0.64, 0.61);
  // Grooves: parallel ridges whose direction wanders from band to band.
  float ang = snoise(p * 3.0) * 3.14;
  vec3 dir = normalize(vec3(cos(ang), sin(ang) * 0.3, sin(ang)));
  float grooves = 0.5 + 0.5 * sin(dot(p, dir) * 900.0 + n * 20.0);
  grooves *= octaveFade(143.0, fp);
  vec3 c = mix(brightC * (0.92 + grooves * 0.12), darkC, darkTerrain);
  vec2 k1 = craters(p, 10.0, 0.5 + darkTerrain * 0.3, fp);
  vec2 k2 = craters(p, 26.0, 0.5 + darkTerrain * 0.3, fp);
  vec2 k3 = craters(p, 70.0, 0.6, fp);
  c *= 1.0 + (k1.y + k2.y + k3.y) * 0.9;
  float frost = smoothstep(38.0, 52.0, abs(lat) + n * 8.0);
  c = mix(c, SRGB(0.86, 0.87, 0.90), frost * 0.7);
  albedo = c;
  height = k1.x + k2.x + k3.x + grooves * (1.0 - darkTerrain) * 250.0 + n * 700.0;
}
`

/**
 * Callisto: the most cratered surface known, dark with dust and speckled with
 * the bright ice every fresh impact exposes, and Valhalla — a bright centre
 * 600 km across inside rings of scarps reaching out almost 2,000 km.
 */
const CALLISTO = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float n = fbmAA(p, 2.5, oct, fp, 0.55);
  float n2 = fbmAA(p + 5.1, 12.0, oct, fp, 0.55);
  vec3 c = SRGB(0.44, 0.40, 0.35) * (1.0 + n * 0.12 + n2 * 0.06);
  vec2 k1 = craters(p, 8.0, 0.6, fp);
  vec2 k2 = craters(p, 20.0, 0.75, fp);
  vec2 k3 = craters(p, 50.0, 0.85, fp);
  vec2 k4 = craters(p, 120.0, 0.85, fp);
  vec2 k5 = craters(p, 300.0, 0.85, fp);
  // Every fresh impact digs through the dark lag to clean ice.
  float spots = k1.y + k2.y + k3.y + k4.y + k5.y;
  c = mix(c, SRGB(0.82, 0.80, 0.76), clamp(spots * 0.9, 0.0, 0.85));
  float val = angleTo(p, 18.0, 303.0);
  c = mix(c, SRGB(0.64, 0.62, 0.58), (1.0 - smoothstep(0.1, 0.28, val)) * 0.8);
  float rings = pow(max(0.0, sin(val * 110.0)), 6.0) * (1.0 - smoothstep(0.3, 0.8, val)) * smoothstep(0.26, 0.32, val);
  c = mix(c, SRGB(0.58, 0.55, 0.50), rings * 0.5);
  albedo = c;
  height = k1.x + k2.x + k3.x + k4.x + k5.x + n * 500.0;
}
`

/**
 * Titan: an orange ball of haze. Under it, seen faintly at the wavelengths the
 * haze lets through, the dark equatorial dune seas — Shangri-La, Belet — and
 * brighter Xanadu. At visible wavelengths they barely show, and they are kept
 * barely showing; the haze shell does the rest.
 */
const TITAN = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float lat = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float n = fbmAA(p, 2.0, min(oct, 5), fp, 0.55);
  float dunes = (1.0 - smoothstep(10.0, 30.0, abs(lat))) * smoothstep(-0.1, 0.3, n);
  float xanadu = blobDeg(p, -10.0, 260.0, 30.0, 18.0, 0.5);
  vec3 c = SRGB(0.84, 0.60, 0.30);
  c = mix(c, SRGB(0.72, 0.50, 0.24), dunes * 0.2);
  c = mix(c, SRGB(0.88, 0.66, 0.36), xanadu * 0.15);
  // The north polar hood: darker, bluer at the top of the haze.
  c = mix(c, SRGB(0.70, 0.56, 0.36), smoothstep(55.0, 80.0, lat) * 0.35);
  albedo = c;
  height = 0.0;
}
`

/**
 * Pluto, as New Horizons found it in 2015: the pale nitrogen-ice heart of
 * Tombaugh Regio — Sputnik Planitia its western lobe, tiled with convection
 * cells tens of kilometres across — the dark red tholins of Cthulhu along the
 * equator, and mid-latitudes the colour of old paper.
 */
const PLUTO = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float lat = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float n = fbmAA(p, 2.5, oct, fp, 0.55);
  float n2 = fbmAA(p + 6.2, 8.0, oct, fp, 0.58);
  float n3 = fbmAA(p - 2.2, 22.0, oct, fp, 0.6);
  vec3 c = mix(SRGB(0.86, 0.74, 0.60), SRGB(0.74, 0.54, 0.40), smoothstep(-0.3, 0.4, n + n3 * 0.2));
  // Northern mid and high latitudes: greyer, bluer, with methane frost.
  c = mix(c, SRGB(0.74, 0.70, 0.66), smoothstep(40.0, 70.0, lat + n * 8.0) * 0.55);
  // Cthulhu: the dark red whale along the equator.
  float cth = blobDeg(p, -10.0, 60.0, 50.0, 14.0, 0.5) + blobDeg(p, -5.0, 120.0, 25.0, 12.0, 0.55) * 0.7;
  c = mix(c, SRGB(0.34, 0.19, 0.13), smoothstep(0.38, 0.78, cth + n2 * 0.25 + n3 * 0.1) * 0.9);
  // The heart: Sputnik Planitia, then the rest of Tombaugh Regio.
  float sp = blobDeg(p, 20.0, 177.0, 17.0, 22.0, 0.35);
  float tr = blobDeg(p, 15.0, 205.0, 22.0, 20.0, 0.55);
  float heart = smoothstep(0.3, 0.72, clamp(sp + tr * 0.8, 0.0, 1.0) + n2 * 0.22 + n3 * 0.08);
  c = mix(c, SRGB(0.95, 0.92, 0.87), heart);
  // Sputnik's convection cells, tens of kilometres across, outlined by troughs.
  vec4 cell = worley(p * 70.0 + n * 0.2);
  float edge = 1.0 - smoothstep(0.03, 0.09, abs(cell.x - 0.38));
  c = mix(c, c * 0.84, edge * sp * octaveFade(70.0, fp));
  // Al-Idrisi's blocky mountains on the heart's western shore.
  float ai = blobDeg(p, 35.0, 158.0, 6.0, 5.0, 0.5) * smoothstep(0.2, 0.5, n3);
  c = mix(c, SRGB(0.70, 0.58, 0.48), ai * 0.6);
  vec2 k1 = craters(p, 12.0, 0.3 * (1.0 - sp), fp);
  vec2 k2 = craters(p, 30.0, 0.4 * (1.0 - sp), fp);
  vec2 k3 = craters(p, 80.0, 0.45 * (1.0 - sp), fp);
  albedo = c;
  height = k1.x + k2.x + k3.x + n * 1500.0 * (1.0 - sp) - sp * 2000.0 + ai * 2500.0;
}
`

/** Phobos, Deimos, a comet's nucleus: dark, dusty, cratered small bodies. */
const SMALL = /* glsl */ `
void surface(vec3 p, float fp, out vec3 albedo, out float height) {
  int oct = int(uOct);
  float n = fbmAA(p, 3.0, oct, fp, 0.55);
  vec3 c = SRGB(0.33, 0.31, 0.29) * (1.0 + n * 0.15);
  vec2 k1 = craters(p, 4.0, 0.5, fp);
  vec2 k2 = craters(p, 11.0, 0.6, fp);
  vec2 k3 = craters(p, 30.0, 0.7, fp);
  c *= 1.0 + (k1.y + k2.y + k3.y) * 0.4;
#ifdef PHOBOS
  // Stickney, 9 km across on a moon 22 km wide, and the grooves radiating from it.
  float st = angleTo(p, -1.0, 311.0);
  c = mix(c, SRGB(0.40, 0.37, 0.34), (1.0 - smoothstep(0.55, 0.7, st)) * 0.4);
  float grooves = pow(max(0.0, sin(dot(p, normalize(vec3(0.2, 0.9, 0.3))) * 120.0)), 8.0) * smoothstep(0.7, 1.6, st);
  c *= 1.0 - grooves * 0.25;
#endif
  albedo = c;
  height = k1.x + k2.x + k3.x + n * uRadius * 0.02;
}
`

export const RECIPES = {
  jupiter: JUPITER,
  saturn: SATURN,
  uranus: URANUS,
  neptune: NEPTUNE,
  mercury: MERCURY,
  venus: VENUS,
  mars: MARS,
  io: IO,
  europa: EUROPA,
  ganymede: GANYMEDE,
  callisto: CALLISTO,
  titan: TITAN,
  pluto: PLUTO,
  phobos: SMALL,
  deimos: SMALL,
  nucleus: SMALL,
}

/**
 * How each recipe reflects light. `minnaert` is the limb-darkening exponent a
 * cloud deck follows; airless bodies use Lommel–Seeliger with an opposition
 * surge, the law the regolith of the Moon and Mercury obeys; `wrap` softens
 * the terminator where an atmosphere scatters light past it.
 */
export const PHOTOMETRY = {
  jupiter: { model: 'cloud', minnaert: 0.92, wrap: 0.04 },
  saturn: { model: 'cloud', minnaert: 0.94, wrap: 0.04 },
  uranus: { model: 'cloud', minnaert: 1.0, wrap: 0.05 },
  neptune: { model: 'cloud', minnaert: 0.96, wrap: 0.05 },
  venus: { model: 'cloud', minnaert: 0.86, wrap: 0.08 },
  titan: { model: 'cloud', minnaert: 1.0, wrap: 0.12 },
  mars: { model: 'lambert', wrap: 0.02 },
  pluto: { model: 'lambert', wrap: 0.02 },
  mercury: { model: 'regolith' },
  io: { model: 'regolith' },
  europa: { model: 'ice' },
  ganymede: { model: 'regolith' },
  callisto: { model: 'regolith' },
  phobos: { model: 'regolith' },
  deimos: { model: 'regolith' },
  nucleus: { model: 'regolith' },
}
