import { useEffect, useState, useSyncExternalStore } from 'react'
import { setUi, useUi } from '../sim/store.js'
import { CAMPAIGN_ORDER, WORLDS } from '../sim/worlds.js'
import { bank, buyUpgrade, campaignState, CHAPTERS, completedCount, FINALE, finaleOpen, nextWorld, subscribeCampaign, totalStars, unlocked, upgradeCost, UPGRADES } from '../sim/campaign.js'
import './campaign.css'

/**
 * The campaign, laid over the simulator.
 *
 * The solar system behind this panel is the simulator's own, at today's real
 * positions: choosing a world flies the camera there, and the briefing opens
 * beside it. "Begin descent" hands over to the surface mission (ui/Surface.jsx,
 * mounted by App.jsx), and its result comes back into the campaign.
 */
const INTRO_KEY = 'pz-campaign-intro-v1'

export function CampaignPanel() {
  const state = useSyncExternalStore(subscribeCampaign, campaignState)
  const focus = useUi((s) => s.focus)
  const lastResult = useUi((s) => s.campaignResult)
  const [selected, setSelected] = useState(() => nextWorld() ?? 'moon')
  const [shop, setShop] = useState(false)
  const [finale, setFinale] = useState(false)
  const [intro, setIntro] = useState(() => { try { return !localStorage.getItem(INTRO_KEY) } catch { return false } })
  const choose = (id) => { setSelected(id); setFinale(false); setUi({ focus: id, map: false, broadcast: false }) }
  const begin = (id, mode = 'campaign') => setUi({ surface: { world: id, mode, upgrades: campaignState().upgrades }, campaignResult: null })
  const ending = state.finale?.done
  // Open looking at the world the briefing is about.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setUi({ focus: selected, map: false, broadcast: false }) }, [])

  const w = WORLDS[selected], ch = CHAPTERS[selected], record = state.worlds[selected]
  const open = unlocked(selected)
  return <div className="cp-root">
    <aside className="cp-panel" aria-label="Campaign">
      <header>
        <span className="cp-eyebrow">Campaign</span>
        <h1>Station Zero</h1>
        <p>Survey the solar system. Choose where humanity builds its first station beyond the Moon.</p>
        <div className="cp-stats"><span><strong>{completedCount()}</strong>/12 surveyed</span><span><strong>{totalStars()}</strong>/36 ★</span><span className="ion"><strong>{bank()}</strong> science</span></div>
      </header>
      <ol className="cp-worlds">
        {CAMPAIGN_ORDER.map((id, i) => {
          const r = state.worlds[id], can = unlocked(id)
          return <li key={id}><button className={`${selected === id && !finale ? 'on' : ''} ${can ? '' : 'locked'}`} onClick={() => choose(id)} aria-current={selected === id ? 'true' : undefined}>
            <span className="n">{String(i + 1).padStart(2, '0')}</span>
            <span className="name">{WORLDS[id].name}<small>{can ? CHAPTERS[id].title : 'Locked'}</small></span>
            <span className="stars" aria-label={`${r?.stars ?? 0} stars`}>{can ? [1, 2, 3].map((k) => <i key={k} className={(r?.stars ?? 0) >= k ? 'on' : ''}>★</i>) : '🔒'}</span>
          </button></li>
        })}
        <li><button className={`finale ${finale ? 'on' : ''} ${finaleOpen() ? '' : 'locked'}`} onClick={() => { setFinale(true); setUi({ focus: 'earth' }) }}>
          <span className="n">★</span><span className="name">{FINALE.title}<small>{finaleOpen() ? (ending ? 'Built' : 'Choose the site') : `After ${FINALE.minimum} surveys`}</small></span>
        </button></li>
      </ol>
      <footer>
        <button className="cp-ghost" onClick={() => setShop(true)}>Upgrades · {bank()}</button>
        <button className="cp-ghost" onClick={() => { window.location.hash = '#flight' }}>Free simulator →</button>
      </footer>
    </aside>

    {!finale && <section className="cp-brief" aria-label={`${w.name} briefing`}>
      <img src={`${import.meta.env.BASE_URL}stills/world-${selected}.webp`} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      <div className="cp-brief-body">
        <span className="cp-eyebrow">{w.name} · {w.site}</span>
        <h2>{ch.title}</h2>
        <p className="cp-from">{ch.from}</p>
        <p>{ch.brief}</p>
        <ul className="cp-facts">
          <li><span>Gravity</span>{w.gravity < 0.1 ? w.gravity.toFixed(4) : w.gravity.toFixed(2)} m/s²</li>
          <li><span>Air</span>{w.air ? `${w.air.rho} kg/m³` : 'none'}</li>
          <li><span>Survey</span>{w.hopper ? 'Hop the lander' : 'Rover'}</li>
          {w.survival && <li><span>Time limit</span>{w.survival / 60} min</li>}
        </ul>
        {record && <p className="cp-best">Best {record.best} · {record.stars} ★</p>}
        {lastResult?.world === selected && <p className="cp-earned">+{lastResult.earned} science{lastResult.earned === 0 ? ' (beat your best to earn more)' : ''}</p>}
        <button className="cp-go" disabled={!open} onClick={() => begin(selected)}>{open ? (record ? 'Fly it again' : 'Begin descent') : 'Finish the previous survey first'}</button>
        {focus !== selected && <button className="cp-ghost small" onClick={() => setUi({ focus: selected })}>Show {w.name} in the sky</button>}
      </div>
    </section>}

    {finale && <section className="cp-brief" aria-label="Station Zero">
      <div className="cp-brief-body">
        <span className="cp-eyebrow">The finale</span>
        <h2>{FINALE.title}</h2>
        <p className="cp-from">{FINALE.from}</p>
        <p>{FINALE.brief}</p>
        {finaleOpen() ? <>
          <p>Where should it go? Any world you have surveyed:</p>
          <div className="cp-sites">{CAMPAIGN_ORDER.filter((id) => (state.worlds[id]?.stars ?? 0) >= 1).map((id) => <button key={id} onClick={() => begin(id, 'finale')}>{WORLDS[id].name}</button>)}</div>
        </> : <p className="cp-best">Survey {FINALE.minimum} worlds to open the finale. {completedCount()} so far.</p>}
      </div>
    </section>}

    {shop && <div className="cp-modal" role="dialog" aria-modal="true" aria-label="Upgrades"><section>
      <span className="cp-eyebrow">Upgrades</span>
      <h2>{bank()} science to spend</h2>
      <p>Earned by beating your best score on a world. Upgrades apply to every mission after.</p>
      <ul className="cp-shop">{UPGRADES.map((u) => {
        const level = state.upgrades[u.id] ?? 0, cost = upgradeCost(u.id)
        return <li key={u.id}><div><strong>{u.name}</strong><small>{u.effect}</small><span className="lv">{[0, 1, 2].map((k) => <i key={k} className={level > k ? 'on' : ''} />)}</span></div>
          <button disabled={cost === null || bank() < cost} onClick={() => buyUpgrade(u.id)}>{cost === null ? 'Max' : `${cost}`}</button></li>
      })}</ul>
      <div className="cp-actions"><button className="cp-go" onClick={() => setShop(false)}>Done</button></div>
    </section></div>}

    {intro && <div className="cp-modal" role="dialog" aria-modal="true" aria-label="Campaign"><section>
      <span className="cp-eyebrow">Campaign</span>
      <h2>Find a home for Station Zero.</h2>
      <p>Twelve worlds, each a real place in the simulator behind this panel. On each one: land, survey it, and lift off. Every survey unlocks the next world and earns science for upgrades. After nine, you choose where the station goes.</p>
      <p>About five minutes a world. Landing assist is always available.</p>
      <div className="cp-actions"><button className="cp-go" onClick={() => { try { localStorage.setItem(INTRO_KEY, '1') } catch { /* fine */ } setIntro(false); choose(selected) }}>Start with the {WORLDS[selected].name}</button></div>
    </section></div>}

    {ending && state.finale && lastResult?.finale && <div className="cp-modal" role="dialog" aria-modal="true" aria-label="Station Zero is built"><section>
      <span className="cp-eyebrow">Station Zero</span>
      <h2>The program has a home.</h2>
      <p>The first module of Station Zero stands on {WORLDS[state.finale.site].name}, on ground you surveyed. Every world you landed on is in the station's charts: {completedCount()} surveys, {totalStars()} stars.</p>
      <p>Thank you for flying. The simulator is still out there: every planet where it really is today.</p>
      <div className="cp-actions"><button className="cp-go" onClick={() => setUi({ campaignResult: null })}>Keep flying</button></div>
    </section></div>}
  </div>
}
