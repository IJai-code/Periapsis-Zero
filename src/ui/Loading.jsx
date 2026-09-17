const STEPS = [
  'galactic structure',
  'starfield',
  'elevation',
  'surface',
  'terrain relief',
  'city lights',
  'cloud sheet',
  'lunar highlands',
  'impact cratering',
  'lunar surface',
]

export function Loading({ progress, label }) {
  const pct = Math.round(progress * 100)
  const index = STEPS.indexOf(label)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="w-[min(30rem,86vw)] px-6">
        <div className="mb-1 font-display text-3xl font-semibold tracking-[0.3em] text-hud">
          PERIAPSIS ZERO
        </div>
        <div className="rule mb-8">Sol · Terra · Luna — RK4 N-body</div>

        <div className="relative h-px w-full overflow-hidden bg-white/10">
          <div
            className="h-full bg-hud transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%`, boxShadow: '0 0 12px 1px currentColor' }}
          />
          <div
            className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-white/50 to-transparent"
            style={{ animation: 'sweep 1.6s linear infinite' }}
          />
        </div>

        <div className="mt-3 flex items-baseline justify-between font-mono text-[11px]">
          <span className="text-hud-dim">synthesising {label}…</span>
          <span className="tabular-nums text-hud">{String(pct).padStart(3, ' ')}%</span>
        </div>

        <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[10px]">
          {STEPS.map((step, i) => (
            <li
              key={step}
              className={
                i < index
                  ? 'text-hud-dim/70'
                  : i === index
                    ? 'text-hud'
                    : 'text-white/15'
              }
            >
              <span className="mr-2">{i < index ? '✓' : i === index ? '▸' : '·'}</span>
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
