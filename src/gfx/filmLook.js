import { Vector3 } from 'three'
import { Effect } from 'postprocessing'
import { scalarUniform } from './scalarUniform.js'

/**
 * What the picture was recorded on.
 *
 * A 1968 launch reached people through a tracking camera's 16 mm colour
 * reversal film or a network's television chain, and each of those put its
 * own fingerprint on every frame: film has grain that changes every twenty-
 * fourth of a second, a frame that weaves in the gate, dust, a warm fade and
 * highlights that halate; the lunar surface camera had interlaced scan lines,
 * a soft picture, colour that smeared sideways and a bright surface that
 * bloomed. A modern camera has almost none of it. The broadcast feed
 * (`sim/broadcast.js`) says which kind of picture each view would have been;
 * this is the effect that makes it look like one.
 *
 * One effect, one shader, five sets of numbers. A cut between cameras changes
 * the numbers and never the program, so switching looks recompiles nothing.
 * The per-frame cost is the library's own `time` uniform and nothing of this
 * module's — `setLook` writes uniforms on a cut, the frame writes none.
 *
 * ── the order things are done in ──────────────────────────────────────
 *
 * The composer renders without tone mapping (it sets `NoToneMapping` while it
 * is mounted), so what arrives here is linear light and can exceed one. The
 * grade is done in a display-like space — a 2.2 power — because lift, gain
 * and contrast are perceptual operations, and done in linear light a black
 * lift of 0.03 is invisible while the same figure in display space is the
 * faded black of old reversal film. It goes back to linear on the way out.
 *
 * The softness, the chroma smear and the halation are read from the pass's
 * input rather than from the colour that has come through the bloom, because
 * an effect in a merged pass cannot read its neighbours' results; the
 * difference each makes is then applied to the colour that has. Two pixels'
 * worth of bloom on a blur is not a thing a viewer can see.
 *
 * Grain, flicker and weave step at the medium's own frame rate — 24 for film,
 * 30 for television — rather than the display's, which is most of what makes
 * grain read as film rather than as noise.
 */

const FRAGMENT = /* glsl */ `
uniform float amount;
uniform float grain;
uniform float grainSize;
uniform float fps;
uniform float weave;
uniform float flicker;
uniform float dust;
uniform float scan;
uniform float hum;
uniform float bleed;
uniform float soft;
uniform float vignette;
uniform float halation;
uniform float saturation;
uniform float contrast;
uniform float fade;
uniform vec3 lift;
uniform vec3 gain;

float pzHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainUv(inout vec2 uv) {
  if (amount > 0.0 && weave > 0.0) {
    // Gate weave: a slow drift with a per-frame jitter on top, both a pixel
    // or so — the frame sitting a little differently in the gate each time.
    float t = mod(time, 600.0);
    float f = floor(t * fps);
    vec2 jitter = vec2(pzHash(vec2(f, 1.3)), pzHash(vec2(f, 7.7))) - 0.5;
    float drift = sin(t * 1.31) * 0.6 + sin(t * 2.87 + 1.7) * 0.4;
    uv += (jitter * 0.7 + vec2(drift * 0.25, drift)) * weave * texelSize * amount;
  }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (amount <= 0.0) {
    outputColor = inputColor;
    return;
  }
  float t = mod(time, 600.0);
  float frame = floor(t * fps);
  vec3 c = inputColor.rgb;

  if (soft > 0.0 || bleed > 0.0 || halation > 0.0) {
    vec2 dx = vec2(texelSize.x, 0.0);
    vec2 dy = vec2(0.0, texelSize.y);
    vec3 centre = texture2D(inputBuffer, uv).rgb;
    vec3 blur = 0.25 * (
      texture2D(inputBuffer, uv + dx * 1.5).rgb + texture2D(inputBuffer, uv - dx * 1.5).rgb +
      texture2D(inputBuffer, uv + dy * 1.5).rgb + texture2D(inputBuffer, uv - dy * 1.5).rgb);
    c += (blur - centre) * soft;
    if (bleed > 0.0) {
      // Colour smears sideways, brightness does not: the chroma of a pixel
      // is taken from a short run to its left, the luma is its own.
      vec3 smear = 0.5 * (texture2D(inputBuffer, uv - dx * bleed).rgb + texture2D(inputBuffer, uv - dx * bleed * 0.5).rgb);
      float ys = dot(smear, vec3(0.299, 0.587, 0.114));
      float yc = dot(c, vec3(0.299, 0.587, 0.114));
      c = vec3(yc) + (smear - vec3(ys));
    }
    // Halation: light through the emulsion reflecting off the film base
    // comes back red-orange around anything bright.
    float over = max(0.0, dot(blur, vec3(0.3333)) - 0.8);
    c += vec3(1.0, 0.42, 0.18) * over * halation;
  }

  // Grade, in a display-like space.
  vec3 d = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  float y = dot(d, vec3(0.2126, 0.7152, 0.0722));
  d = mix(vec3(y), d, saturation);
  d = (d - 0.45) * contrast + 0.45;
  d = d * gain + lift * (1.0 - clamp(d, 0.0, 1.0));
  d = fade + d * (1.0 - fade);

  // The exposure breathing from frame to frame.
  d *= 1.0 + (pzHash(vec2(frame, 3.1)) - 0.5) * flicker;

  // Television: interlaced lines, alternate fields, and a hum bar rolling up
  // the picture — mains frequency beating against the field rate.
  if (scan > 0.0) {
    float row = floor(uv.y * resolution.y * 0.5);
    float field = mod(row + frame, 2.0);
    d *= 1.0 - scan * field;
    d *= 1.0 - hum * (0.5 + 0.5 * sin((uv.y + t * 0.12) * 6.2832));
  }

  // Grain, strongest in the mid-tones where film shows it most.
  vec2 gp = floor(uv * resolution / grainSize);
  float g = pzHash(gp + frame * vec2(17.13, 31.71)) + pzHash(gp * 1.37 + frame * 3.07) - 1.0;
  float lum = clamp(dot(d, vec3(0.3333)), 0.0, 1.0);
  d += g * grain * (0.35 + 0.65 * (1.0 - abs(lum * 2.0 - 1.0)));

  // Dust on the film and the odd scratch down it.
  if (dust > 0.0) {
    // A fleck is a soft round thing a few pixels across, not a pixel: cells of
    // six, one in tens of thousands occupied on any frame, the fleck drawn as a
    // disc inside its cell. Mostly dark — dirt on a reversal original prints
    // black — with the odd bright one from a scratch through the emulsion.
    float size = 6.0 * grainSize;
    vec2 cellUv = uv * resolution / size;
    vec2 cell = floor(cellUv);
    float speck = pzHash(cell + frame * 13.7);
    if (speck > 1.0 - dust * 0.00004) {
      vec2 centre = vec2(pzHash(cell + 0.37), pzHash(cell + 0.71)) * 0.6 + 0.2;
      float r = 0.18 + 0.22 * pzHash(cell * 1.9 + frame);
      float disc = smoothstep(r, r * 0.45, length(fract(cellUv) - centre));
      float bright = step(0.85, pzHash(cell * 0.7 + frame));
      d = mix(d, vec3(bright * 0.95 + 0.02), disc * 0.8);
    }
    float epoch = floor(t * 1.5);
    float x = pzHash(vec2(epoch, 5.0));
    float on = step(0.9, pzHash(vec2(epoch, 9.0)));
    float line = on * max(0.0, 1.0 - abs(uv.x - x) * resolution.x * 0.9);
    d += line * 0.18 * dust;
  }

  // The lens and the projector: darker to the corners.
  vec2 q = uv - 0.5;
  d *= 1.0 - vignette * dot(q, q) * 2.0;

  vec3 graded = pow(max(d, vec3(0.0)), vec3(2.2));
  outputColor = vec4(mix(inputColor.rgb, graded, amount), inputColor.a);
}
`

/**
 * The looks. Every figure is a drawing decision, and each is written against
 * what the medium is known to do rather than against a reference frame: film
 * warms its highlights and fades its blacks toward cyan, the surface camera's
 * chroma bandwidth was a fraction of its luma's, and a present-day sensor adds
 * only a little noise in the shadows.
 */
export const LOOK_PROFILES = {
  film: {
    amount: 1, grain: 0.05, grainSize: 1.6, fps: 24, weave: 0.9, flicker: 0.04, dust: 1, scan: 0, hum: 0,
    bleed: 0, soft: 0.35, vignette: 0.38, halation: 0.35, saturation: 0.86, contrast: 1.07, fade: 0.035,
    lift: [0.012, 0.026, 0.04], gain: [1.05, 1.0, 0.9],
  },
  tv: {
    amount: 1, grain: 0.05, grainSize: 1, fps: 30, weave: 0, flicker: 0.02, dust: 0, scan: 0.16, hum: 0.035,
    bleed: 2.5, soft: 0.6, vignette: 0.26, halation: 0.55, saturation: 0.62, contrast: 1.14, fade: 0.02,
    lift: [0.02, 0.02, 0.03], gain: [1.02, 1.0, 1.04],
  },
  network: {
    amount: 1, grain: 0.028, grainSize: 1, fps: 30, weave: 0, flicker: 0.015, dust: 0, scan: 0.1, hum: 0.02,
    bleed: 1.2, soft: 0.4, vignette: 0.3, halation: 0.2, saturation: 0.76, contrast: 1.05, fade: 0.025,
    lift: [0.015, 0.015, 0.02], gain: [1.0, 1.0, 0.98],
  },
  hd: {
    amount: 1, grain: 0.012, grainSize: 1, fps: 60, weave: 0, flicker: 0, dust: 0, scan: 0, hum: 0,
    bleed: 0, soft: 0.08, vignette: 0.12, halation: 0.05, saturation: 1.0, contrast: 1.03, fade: 0,
    lift: [0, 0, 0], gain: [1, 1, 1],
  },
  clean: {
    amount: 0, grain: 0, grainSize: 1, fps: 60, weave: 0, flicker: 0, dust: 0, scan: 0, hum: 0,
    bleed: 0, soft: 0, vignette: 0, halation: 0, saturation: 1, contrast: 1, fade: 0,
    lift: [0, 0, 0], gain: [1, 1, 1],
  },
}

const SCALARS = [
  'amount', 'grain', 'grainSize', 'fps', 'weave', 'flicker', 'dust', 'scan', 'hum',
  'bleed', 'soft', 'vignette', 'halation', 'saturation', 'contrast', 'fade',
]

export class FilmLookEffect extends Effect {
  constructor() {
    const uniforms = new Map()
    for (const k of SCALARS) uniforms.set(k, scalarUniform(LOOK_PROFILES.clean[k]))
    uniforms.set('lift', { value: new Vector3() })
    uniforms.set('gain', { value: new Vector3(1, 1, 1) })
    super('FilmLookEffect', FRAGMENT, { uniforms })
    this.look = 'clean'
  }

  /**
   * Put a look on the picture. Event-rate — called on a cut, never per frame.
   * `scale` is the device pixel ratio's share of the grain, so a retina panel
   * does not make the grain half the size it is on a laptop.
   */
  setLook(name, scale = 1) {
    const p = LOOK_PROFILES[name] ?? LOOK_PROFILES.clean
    this.look = LOOK_PROFILES[name] ? name : 'clean'
    for (const k of SCALARS) this.uniforms.get(k).value = p[k]
    this.uniforms.get('grainSize').value = p.grainSize * scale
    this.uniforms.get('weave').value = p.weave * scale
    this.uniforms.get('bleed').value = p.bleed * scale
    this.uniforms.get('lift').value.fromArray(p.lift)
    this.uniforms.get('gain').value.fromArray(p.gain)
  }
}
