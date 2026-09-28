import { NOISE_GLSL } from './noise.js'

/**
 * A galaxy as a volume: emission and absorption along each ray.
 *
 * One model draws them all — the Milky Way around the camera, the Milky Way
 * from outside, Andromeda at an angle, the Sombrero edge-on. A galaxy here is
 * what the photometry says it is: an exponential disc of old stars, a thinner
 * one of young stars and ionised gas concentrated on logarithmic spiral arms, a
 * bulge, sometimes a bar or a ring, and a dust layer thinner still that
 * reddens and dims what is behind it by the interstellar extinction law. The
 * ray integrates
 *
 *     L = ∫ j(s) T(s) ds,   T(s) = exp(−∫ κ ds'),
 *
 * with κ per colour channel in the ratio A_R : A_V : A_B = 0.75 : 1 : 1.32 —
 * the R_V = 3.1 extinction curve (Cardelli, Clayton & Mathis 1989) at the three
 * channels' effective wavelengths — which is why the far side of a dust lane
 * is red rather than grey.
 *
 * ── resolving a disc thinner than a step ──────────────────────────────
 *
 * A disc is a hundred parsecs thick and tens of kiloparsecs wide, and a ray
 * crossing it face-on spends a few steps in it at most. So the vertical profile
 * is not *sampled*, it is *integrated*: every layer is exponential in |z|, and
 * the mean of exp(−|z|/h) over a step from z_a to z_b is closed-form,
 *
 *     ⟨e^{−|z|/h}⟩ = (F(z_b) − F(z_a)) / (z_b − z_a),   F(z) = sgn(z) h (1 − e^{−|z|/h}),
 *
 * so a step that jumps the whole disc still collects exactly the light and the
 * dust in it. The radial structure — arms, knots, lanes — is read at the
 * step's middle.
 *
 * ── where the steps go ────────────────────────────────────────────────
 *
 * The step length is the smallest of three scales: a fraction of the height
 * above the midplane over the ray's vertical speed (fine through the disc,
 * long above it), a fraction of the distance to the centre (fine through the
 * bulge's cusp), and a fraction of the distance already travelled (fine near
 * the camera, which is what resolves a dark cloud 150 pc away while the far
 * side of the Galaxy is 20 kpc off). The first step is jittered per pixel so
 * the step pattern becomes grain rather than banding.
 */
export const GALAXY_GLSL = /* glsl */ `
${NOISE_GLSL}

uniform vec3 uCam;            // camera in the galaxy's frame, kpc
uniform vec3 uBox;            // half-extents of the volume, kpc
uniform float uSteps;         // most steps a ray may take
uniform float uOctaves;       // noise octaves at the finest
uniform float uGain;          // exposure
uniform float uJitterSeed;

uniform vec4 uDisc;           // old-disc weight, scale length, scale height, truncation radius
uniform vec2 uThick;          // thick-disc weight, height
uniform vec4 uBulge;          // weight, scale a, flattening q, boxiness (0 = Hernquist, 1 = boxy)
uniform vec4 uBar;            // weight, half-length, half-width, angle
uniform vec4 uArmR;           // each arm's radius at azimuth pi (0 = no arm)
uniform vec4 uArmOld;         // each arm's contrast in old stars
uniform vec4 uArmShape;       // tan(pitch), half-width, inner radius, outer radius
uniform vec4 uLocalArm;       // radius at the Sun's azimuth, tan(pitch), azimuth half-span, weight
uniform vec4 uRing;           // weight, radius, width, dust share
uniform vec4 uYoung;          // young-star weight, H II weight, flocculence, knot scale (kpc)
uniform vec4 uDust;           // kappa_V (1/kpc) at the reference radius, scale length, scale height, reference radius
uniform vec4 uDust2;          // inner hole radius, arm-lane share, clumpiness, lane offset
uniform vec3 uColOld;
uniform vec3 uColBulge;
uniform vec3 uColYoung;
uniform vec3 uColHii;
uniform vec4 uExtra;          // wind (M82), jet angle, jet weight, dust-disc tilt
uniform vec2 uField;          // star formation off the arms: young weight, knot sharpness
uniform float uSeed;

#define PI_G 3.14159265358979

/** Mean of exp(-|z|/h) between za and zb, exactly. */
float layerAvg(float za, float zb, float h) {
  float d = zb - za;
  if (abs(d) < 1e-5 * h) return exp(-abs(0.5 * (za + zb)) / h);
  float Fa = sign(za) * h * (1.0 - exp(-abs(za) / h));
  float Fb = sign(zb) * h * (1.0 - exp(-abs(zb) / h));
  return (Fb - Fa) / d;
}

/**
 * Closeness to one logarithmic arm, R(phi) = Ra exp((phi - pi) tan psi):
 * the azimuth of the arm at this radius on the nearest winding, and the
 * perpendicular distance R |dphi| sin psi, in units of the half-width.
 */
float armDistance(float lnR, float phi, float R, float Ra, float tp, float sp) {
  float wind = (lnR - log(Ra)) / tp;           // phi - pi on the arm at this radius
  float n = floor((wind - (phi - PI_G)) / (2.0 * PI_G) + 0.5);
  float dphi = (phi + 2.0 * PI_G * n - PI_G) - wind;
  return R * abs(dphi) * sp;
}

#ifdef MILKY_WAY
/*
 * The Milky Way's local dark clouds: the complexes whose silhouettes make the
 * Great Rift, the Coalsack, the dark Taurus and Ophiuchus clouds on the sky.
 * Centre (galactocentric kpc) and 1-sigma radius; peak extinction in .w of
 * the second array. Positions are approximate — the clouds are where the CO
 * surveys put them, at the distances 3D dust maps give them.
 */
#define N_CLOUDS 14
uniform vec4 uCloud[N_CLOUDS];
uniform vec4 uCloudShape[N_CLOUDS];
// The Local Bubble: the Sun sits in a cavity of hot, dust-poor gas some 150 pc
// across, and the nearest dark clouds are its walls.
uniform vec4 uBubble;

/**
 * A step short enough not to jump a cloud, and no shorter than crossing it in
 * about two dozen: a quarter of its thinner axis, or its full six-sigma span
 * over 24, whichever is longer. Finer than that and a ray through a cloud's
 * middle spent its whole budget inside it and skipped the far half — which
 * drew the Pipe Nebula as a dark ring round a bright centre.
 */
float cloudStep(vec3 p) {
  float s = 1e9;
  for (int i = 0; i < N_CLOUDS; i++) {
    vec3 sh = uCloudShape[i].xyz;
    float q = length((p - uCloud[i].xyz) / sh);
    float fine = max(0.25 * min(sh.x, sh.z), 0.25 * max(sh.x, sh.z));
    s = min(s, max((q - 3.0) * min(sh.x, sh.z), fine));
  }
  return s;
}
#endif

void sampleGalaxy(vec3 p, float za, float zb, float fp, out vec3 emit, out vec3 kappa) {
  float R = length(p.xy);
  float phi = atan(p.y, p.x);
  float lnR = log(max(R, 1e-3));
  float r3 = length(p);

  // Vertical profiles over the step.
  float Lthin = layerAvg(za, zb, uDisc.z);
  float Lthick = layerAvg(za, zb, uThick.y);
  float Lyoung = layerAvg(za, zb, uDisc.z * 0.33);
  float Ldust = layerAvg(za, zb, uDust.z);

  float edge = 1.0 - smoothstep(uDisc.w * 0.78, uDisc.w, R);
  float radial = exp(-R / uDisc.y) * edge;

  // Spiral arms.
  float tp = uArmShape.x;
  float sp = tp / sqrt(1.0 + tp * tp);
  float w = uArmShape.y;
  // Flocculent galaxies: the arm's azimuth wanders, and the arms break up.
  float wander = uYoung.z > 0.0 ? uYoung.z * snoise(vec3(p.xy * 0.18, uSeed)) * 0.9 : 0.0;
  // Feathering: spurs and branches off every arm, the substructure a density
  // wave raises in a shearing disc. A small azimuthal wander that changes
  // along the arm.
  wander += 0.035 * snoise(vec3(p.xy * 0.9, uSeed + 5.0)) + 0.015 * snoise(vec3(p.xy * 2.6, uSeed - 3.0));
  float armWindow = smoothstep(uArmShape.z * 0.8, uArmShape.z * 1.2, R) * (1.0 - smoothstep(uArmShape.w * 0.8, uArmShape.w, R));
  float armOld = 0.0;
  float armY = 0.0;
  float armD = 0.0;
  float laneShift = log(1.0 + uDust2.w);
  for (int k = 0; k < 4; k++) {
    float Ra = uArmR[k];
    if (Ra <= 0.0) continue;
    float d = armDistance(lnR, phi + wander, R, Ra, tp, sp) / w;
    float a = exp(-d * d);
    armOld += a * uArmOld[k];
    // Young stars spread off the arm as they age out of it: a broader skirt.
    armY += a + 0.35 * exp(-d * d * 0.25);
    // Dust lanes run along the inner edge of an arm: the same arm, read a
    // little further out, peaks a little further in.
    float dd = armDistance(lnR + laneShift, phi + wander, R, Ra, tp, sp) / (w * 0.6);
    armD += exp(-dd * dd);
  }
#ifdef MILKY_WAY
  // The Local Arm, the short spur the Sun sits on the inner edge of.
  {
    float d = armDistance(lnR, phi, R, uLocalArm.x, uLocalArm.y, uLocalArm.y / sqrt(1.0 + uLocalArm.y * uLocalArm.y)) / (w * 0.8);
    float span = 1.0 - smoothstep(uLocalArm.z * 0.6, uLocalArm.z, abs(phi - PI_G + (phi < 0.0 ? 2.0 * PI_G : 0.0)));
    float a = exp(-d * d) * span * uLocalArm.w;
    armY += a;
    float dd = armDistance(lnR + laneShift, phi, R, uLocalArm.x, uLocalArm.y, uLocalArm.y / sqrt(1.0 + uLocalArm.y * uLocalArm.y)) / (w * 0.5);
    armD += exp(-dd * dd) * span * uLocalArm.w;
  }
#endif
  armOld *= armWindow;
  armY *= armWindow;
  armD *= armWindow;

  // Rings: M31's star-forming ring at 10 kpc, the Sombrero's dust ring.
  float ring = uRing.x > 0.0 ? uRing.x * exp(-pow((R - uRing.y) / uRing.z, 2.0)) : 0.0;

  // Star clouds and knots: the structure inside the arms.
  float fq = 1.0 / uYoung.w;
  float oct = uOctaves;
  float cl = fbmAA(p * vec3(1.0, 1.0, 2.5) + uSeed, fq, int(oct), fp, 0.55);
  float knots = fbmAA(p * vec3(1.0, 1.0, 3.0) - uSeed * 0.7, fq * 2.3, int(oct), fp, 0.6);
  // Interstellar matter is log-normally distributed — a few dense filaments,
  // wide clear windows — and so are the star clouds that form in it.
  float clump = exp(2.1 * cl - 0.5);
  float hiiKnot = pow(smoothstep(0.05, 0.6, knots), 2.0);
  // Kiloparsec star clouds: the Scutum and Sagittarius clouds are arms seen
  // end-on through windows in the dust.
  float sc = fbmAA(p * vec3(1.0, 1.0, 1.5) + uSeed * 3.1, 0.7, 3, fp, 0.5);

  // Old stars: disc (with the major arms' density wave), thick disc.
  float jOld = uDisc.x * radial * (Lthin * (1.0 + armOld) * exp(1.3 * cl + 1.2 * sc - 0.4) + uThick.x * Lthick);

  // Young stars and ionised gas: on the arms and the ring, in knots.
  float yRad = exp(-R / (uDisc.y * 1.35)) * edge;
  // OB associations and young clusters: the arms' light comes in knots a
  // hundred parsecs across, not as a smooth ribbon.
  float assoc = 0.3 + 2.6 * pow(smoothstep(-0.05, 0.75, knots), 3.0);
  // Off the arms too: weakly in a spiral's interarm, everywhere in an
  // irregular, where it is all there is — sharp knots on a faint body.
  float field = uField.x * pow(smoothstep(0.0, 0.8, knots), uField.y);
  float jYoung = uYoung.x * yRad * Lyoung * (armY + ring + field) * clump * assoc;
  // H II regions are discrete: a few hundred parsecs of glowing gas round each
  // young cluster, strung along the arms. Cells in the disc plane, one region
  // per cell at a seeded spot, sized and lit by the cell's own numbers, and
  // only where the arm is.
  vec2 kp = p.xy / (uYoung.w * 0.9) + uSeed;
  vec2 kc = floor(kp);
  float hiiCell = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = kc + vec2(float(i), float(j));
      vec3 h = pz_hash33(vec3(c, uSeed * 3.7));
      vec2 q = kp - c - h.xy;
      float r2 = dot(q, q) / (0.02 + 0.05 * h.z);
      hiiCell += exp(-r2 * 3.0) * (0.3 + h.z * h.z * 2.5);
    }
  }
  float jHii = uYoung.y * yRad * Lyoung * (armY + ring + field) * (0.35 * hiiKnot + 1.4 * hiiCell);

  // Bulge: a Hernquist sphere (projects to de Vaucouleurs), flattened, or
  // the Milky Way's boxy bar-bulge.
  float jBulge = 0.0;
  if (uBulge.x > 0.0) {
    vec3 q = vec3(p.xy, p.z / uBulge.z);
    float m = length(q) / uBulge.y;
    float hern = 1.0 / ((m + 0.03) * pow(1.0 + m, 3.0));
    float boxy = exp(-pow(pow(abs(q.x) / uBulge.y, 4.0) + pow(abs(q.y) / uBulge.y, 4.0) + pow(abs(q.z) / uBulge.y, 4.0), 0.25) * 3.0)
      + 0.6 * exp(-length(q) / (uBulge.y * 0.12));
    // Dwarf spheroidals are cored, not cusped: a Plummer sphere (profile 2).
    float plummer = pow(1.0 + m * m, -2.5);
    jBulge = uBulge.x * (uBulge.w > 1.5 ? plummer : mix(hern, boxy, uBulge.w));
  }
  if (uBar.x > 0.0) {
    float ca = cos(uBar.w);
    float sa = sin(uBar.w);
    vec2 b = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
    float s = pow(abs(b.x) / uBar.y, 4.0) + pow(abs(b.y) / uBar.z, 2.0);
    jBulge += uBar.x * exp(-s) * layerAvg(za, zb, uDisc.z * 1.4);
  }

  // Two windows, so nothing reaches the box that bounds the march: the disc's
  // components fade by radius and height, the bulge's spherically — a box cut
  // into either drew the box.
  float winDisc = (1.0 - smoothstep(0.72, 1.0, R / uBox.x)) * (1.0 - smoothstep(0.7, 1.0, abs(p.z) / uBox.z));
  float winSph = 1.0 - smoothstep(0.55, 0.95, r3 / min(uBox.x, uBox.z));
  emit = (uColOld * jOld + uColYoung * jYoung + uColHii * jHii) * winDisc + uColBulge * jBulge * winSph;

  // Dust: exponential disc, a hole inside the bar's reach, lanes on the arms.
  float hole = smoothstep(uDust2.x * 0.7, uDust2.x, R) + exp(-r3 / 0.18) * 0.6;
  // Dust is filamentary: blobs from fractal noise, and the sheets and threads
  // a ridged fractal draws where it creases.
  float dcl = fbmAA(p * vec3(1.0, 1.0, 2.0) + uSeed * 1.9, fq * 1.6, int(oct) + 1, fp, 0.6)
    + 0.7 * (ridgedAA(p * vec3(1.0, 1.0, 1.6) - uSeed * 2.3, fq * 2.4, int(oct), fp, 0.55) - 0.35);
  float dustClump = exp(uDust2.z * 2.8 * dcl - 0.6 * uDust2.z);
  float lanes = (1.0 - uDust2.y) + uDust2.y * 3.2 * (armD + ring * uRing.w);
  float kV = uDust.x * exp(-(R - uDust.w) / uDust.y) * edge * Ldust * hole * lanes * dustClump;

#ifdef MILKY_WAY
  kV *= smoothstep(uBubble.w * 0.5, uBubble.w * 1.4, length(p - uBubble.xyz));
  for (int i = 0; i < N_CLOUDS; i++) {
    vec3 c = uCloud[i].xyz;
    vec3 sh = uCloudShape[i].xyz;
    vec3 d = (p - c) / sh;
    float q2 = dot(d, d);
    if (q2 > 9.0) continue;
    // A dark cloud is filaments round dense cores, not an ellipsoid: a ridged
    // fractal carves it, and fractal noise breaks up its edge — both in the
    // cloud's own units, so a 6 pc cloud is as intricate as a 120 pc one.
    float sc = 1.0 / min(sh.x, sh.z);
    vec3 lp = (p - c) * sc + float(i) * 7.3;
    float rid = ridgedAA(lp, 1.3, int(oct) + 2, fp * sc, 0.6);
    float brk = fbmAA(lp * 1.7 + 3.1, 1.0, int(oct) + 1, fp * sc * 1.7, 0.6);
    // Normalised so the cloud keeps its catalogued extinction on average:
    // the ridged term's mean square is about a sixth, so the mean is ~0.5.
    float tex = (0.12 + 2.6 * rid * rid) * exp(1.3 * brk) * 1.9;
    kV += uCloud[i].w * exp(-q2 * (1.0 - 0.4 * brk)) * tex;
  }
#endif

  // Starburst wind (M82): ionised gas blown out along the minor axis.
  if (uExtra.x > 0.0) {
    float cone = exp(-pow(R / (0.3 + abs(p.z) * 0.6), 1.6)) * exp(-abs(p.z) / 0.9) * smoothstep(0.05, 0.3, abs(p.z));
    float fil = 0.25 + 1.5 * pow(smoothstep(0.0, 0.7, fbmAA(p * vec3(3.0, 3.0, 1.2) + uSeed, 1.2, int(oct), fp, 0.6)), 1.5);
    emit += uColHii * uExtra.x * cone * fil * 0.18 * winSph;
  }
  // A relativistic jet (M87): a thin bright line out of the core.
  if (uExtra.z > 0.0) {
    vec2 dir = vec2(cos(uExtra.y), sin(uExtra.y));
    float along = dot(p.xy, dir);
    float across = length(p.xy - dir * along);
    float jet = step(0.0, along) * exp(-along / 1.2) * exp(-pow(across / (0.02 + along * 0.02), 2.0)) * exp(-p.z * p.z / 0.002);
    emit += vec3(0.62, 0.72, 1.0) * uExtra.z * jet * (0.6 + 0.8 * smoothstep(-0.2, 0.6, snoise(vec3(along * 6.0, 0.0, uSeed))));
  }

  kappa = vec3(0.75, 1.0, 1.32) * kV * winDisc;
}

/** Ray-box: entry and exit distances along rd, or (1, 0) for a miss. */
vec2 boxHit(vec3 ro, vec3 rd, vec3 h) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-h - ro) * inv;
  vec3 t1 = (h - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

/**
 * Per-pixel jitter for the first step. White, not interleaved-gradient: IGN is
 * built to be averaged away by a temporal filter, and a sky cube marched once
 * has none — its diagonal pattern showed through the dark clouds as hatching.
 */
float ign(vec2 px) {
  vec3 p3 = fract(vec3(px.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/**
 * Integrate one ray through the volume. Returns premultiplied radiance and,
 * in alpha, the fraction of the light behind that is absorbed (green channel).
 */
vec4 marchGalaxy(vec3 ro, vec3 rd, float jitter) {
  vec2 hit = boxHit(ro, rd, uBox);
  if (hit.x >= hit.y || hit.y <= 0.0) return vec4(0.0);
  float t = max(hit.x, 0.0);
  float tEnd = hit.y;
  float t0 = t;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  float inside = hit.x < 0.0 ? 1.0 : 0.0;
  float rz = max(abs(rd.z), 1e-3);
  float first = 1.0;
  // From inside, steps grow geometrically away from the camera at the rate
  // that spends seven tenths of the budget on exactly this ray: sum of g^i
  // over 0.7 N steps from a 1 pc first step equals the ray's length. The other
  // three tenths are for the refinements — a dark cloud crossed, the bulge's
  // core — which otherwise took their steps from the far side and left the
  // bulge behind a nearby cloud to a few kiloparsec-long steps: the Pipe
  // Nebula came out as a dark ring round a bright hole.
  float grow = log(1.0 + (tEnd - t0) / 0.001 * 0.05) / (uSteps * 0.7);
  for (int i = 0; i < 256; i++) {
    if (float(i) >= uSteps || t >= tEnd) break;
    vec3 p = ro + rd * t;
    float r = length(p);
    float byHeight = 0.35 * (abs(p.z) + uDisc.z * 0.6) / rz;
    float byCentre = 0.25 * (r + 0.08);
    float byCamera = inside > 0.0 ? grow * (t - t0) + 0.001 : 1e9;
    float dt = clamp(min(min(byHeight, byCentre), byCamera), 0.0015, 2.5);
#ifdef MILKY_WAY
    if (inside > 0.0) dt = max(min(dt, cloudStep(p)), 0.0008);
#endif
    // The far side is never cut off: as the budget runs down, a step may not
    // be shorter than a growing share of what is left, and the last takes it
    // all. Early steps stay free to be as fine as the near field needs — a
    // floor from the first step made every one 40 pc long and marched the
    // nearest dark clouds into speckle.
    float left = uSteps - float(i);
    float spent = float(i) / uSteps;
    dt = left <= 1.0 ? tEnd - t : max(dt, (tEnd - t) / left * spent * spent);
    if (first > 0.0) {
      dt *= 0.25 + jitter;
      first = 0.0;
    }
    dt = min(dt, tEnd - t);
    vec3 a = ro + rd * t;
    vec3 b = ro + rd * (t + dt);
    vec3 m = 0.5 * (a + b);
    vec3 e;
    vec3 k;
    sampleGalaxy(m, a.z, b.z, dt, e, k);
    // Exact for a step of constant emission and absorption.
    vec3 att = exp(-k * dt);
    vec3 through = mix(vec3(dt), (1.0 - att) / max(k, vec3(1e-6)), step(vec3(1e-4), k * dt));
    L += T * e * through;
    T *= att;
    t += dt;
    if (T.g < 0.004) break;
  }
  return vec4(L * uGain, 1.0 - T.g);
}
`
