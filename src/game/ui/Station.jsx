import { useState } from 'react'
import { acceptJob, abandonJob, buyHull, buyUpgrade, cargoUsed, offers, payDebt, refuel, refuelCost, repair, repairCost, trade } from '../core/game.js'
import { STATIONS, PLACES } from '../core/world.js'
import { GOODS, GOOD_ORDER, buyPrice, sellPrice } from '../core/economy.js'
import { HULLS, PLAYER_HULLS, UPGRADES } from '../core/ships.js'
import { CHARACTERS, chooseStory, mission, startStory, storyOffers, storyNext } from '../core/story.js'
import { fine } from '../core/heat.js'
import { Hint } from './keys.jsx'
import { clock } from './Hud.jsx'
import { play } from '../audio.js'

/**
 * Docked: the station's services, over a view of your ship in its berth.
 * Tabs down the left like a terminal; the big button launches.
 */
const TABS = [['missions', 'Contacts'], ['jobs', 'Job board'], ['market', 'Market'], ['shipyard', 'Shipyard'], ['outfit', 'Outfitting'], ['services', 'Services'], ['pilot', 'Pilot']]

export function Station({ game: g, touch, onLaunch, onOverlay }) {
  const st = STATIONS[g.docked]
  const storyHere = storyOffers(g, st.id)
  const [tab, setTab] = useState(() => (storyHere.length || g.story.active ? 'missions' : 'jobs'))
  const [msg, setMsg] = useState(null)
  const act = (fn) => { const r = fn(); setMsg(r); play(r ? 'denied' : 'click') }
  const tabs = TABS.filter(([id]) => id !== 'shipyard' || st.services.includes('shipyard')).filter(([id]) => id !== 'outfit' || st.services.includes('outfit'))
  return <div className="st-root">
    <header className="st-top">
      <div><span className="st-eyebrow">{st.faction === 'compact' ? 'Lunar Compact' : st.faction === 'hollow' ? 'No flag' : 'Free port'} · {PLACES[st.place].where}</span><h1>{st.name}</h1></div>
      <div className="st-clock">{clock(g.time)}</div>
      <div className="st-money"><strong>₡ {Math.round(g.credits).toLocaleString()}</strong>{g.debt > 0 && <small>Owed to Rook: ₡ {g.debt.toLocaleString()}</small>}</div>
    </header>
    <nav className="st-tabs">
      {tabs.map(([id, label]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setMsg(null); play('click') }}>
        {label}{id === 'missions' && (storyHere.length > 0 || g.choice) && <i className="st-dot" />}
      </button>)}
      <div className="st-tabs-foot">
        <button onClick={() => onOverlay('map')}>Map</button>
        <button onClick={() => onOverlay('pause')}>Menu</button>
      </div>
    </nav>
    <section className="st-panel">
      {msg && <p className="st-msg">{msg}</p>}
      {tab === 'missions' && <Missions g={g} st={st} touch={touch} offersHere={storyHere} act={act} />}
      {tab === 'jobs' && <Jobs g={g} st={st} act={act} />}
      {tab === 'market' && <Market g={g} st={st} act={act} />}
      {tab === 'shipyard' && <Shipyard g={g} act={act} />}
      {tab === 'outfit' && <Outfit g={g} act={act} />}
      {tab === 'services' && <Services g={g} st={st} act={act} />}
      {tab === 'pilot' && <Pilot g={g} />}
    </section>
    <div className="st-launch">
      <ShipCard g={g} />
      <button className="st-go" onClick={onLaunch}>Launch<kbd className="gk">{touch ? '' : 'Enter'}</kbd></button>
    </div>
  </div>
}

function Portrait({ who, big }) {
  const c = CHARACTERS[who]
  return <span className={`portrait ${who} ${big ? 'big' : ''}`} aria-hidden><img src={`${import.meta.env.BASE_URL}game/portrait-${who}.webp`} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /><b>{c?.name?.split(' ').map((w) => w[0]).join('').slice(0, 2)}</b></span>
}

function Missions({ g, st, touch, offersHere, act }) {
  const active = g.story.active ? mission(g.story.active) : null
  const elsewhere = storyNext(g).filter((m) => m.at !== st.id)
  return <div className="st-missions">
    {g.choice && <div className="st-choice">
      <h2>{g.choice.prompt}</h2>
      <div>{g.choice.options.map((o) => <button key={o.id} onClick={() => { chooseStory(g, o.id); play('objective') }}>{o.label}</button>)}</div>
    </div>}
    {active && !g.choice && <article className="st-card active">
      <Portrait who={typeof active.giver === 'function' ? active.giver(g) : active.giver} />
      <div><span className="st-eyebrow">In progress</span><h2>{active.title}</h2><p><Hint text={g.objective?.text} touch={touch} /></p></div>
    </article>}
    {offersHere.map((m) => {
      const who = typeof m.giver === 'function' ? m.giver(g) : m.giver
      return <article key={m.id} className="st-card">
        <Portrait who={who} big />
        <div>
          <span className="st-eyebrow">{CHARACTERS[who].name} · {CHARACTERS[who].role}</span>
          <h2>{m.title}</h2>
          <p>{m.pitch}</p>
          <p className="st-reward">{rewardText(m.reward)}</p>
          <button className="st-primary" disabled={Boolean(g.story.active)} onClick={() => act(() => startStory(g, m.id))}>{g.story.active ? 'Finish your current mission first' : 'Take the mission'}</button>
        </div>
      </article>
    })}
    {!active && !offersHere.length && <p className="st-empty">Nobody here has story work for you right now.</p>}
    {elsewhere.length > 0 && <div className="st-elsewhere"><h3>Waiting elsewhere</h3>{elsewhere.map((m) => <p key={m.id}><Portrait who={m.giver} /><span><strong>{m.title}</strong> · {CHARACTERS[m.giver].name} at {STATIONS[m.at].name}</span></p>)}</div>}
    {g.story.done.includes('periapsis') && <p className="st-empty">Act One is complete. The lanes are yours; the job board never closes.</p>}
  </div>
}
const rewardText = (r) => [r.credits && `₡ ${r.credits.toLocaleString()}`, r.debt && `₡ ${r.debt.toLocaleString()} off your debt`, r.clearDebt && 'your debt cleared'].filter(Boolean).join(' · ') || 'No pay. Something better.'

function Jobs({ g, st, act }) {
  const list = offers(g, st.id)
  return <div className="st-jobs">
    {g.jobs.length > 0 && <>
      <h3>Your jobs ({g.jobs.length} of 3)</h3>
      {g.jobs.map((j) => <article key={j.id} className={`st-job mine ${j.legal ? '' : 'grey'}`}>
        <div><h2>{j.title}</h2><p>{jobProgress(j)}</p><small>Paid at {STATIONS[j.to].name} · ₡ {j.reward.toLocaleString()} · due {clock(j.deadline)}</small></div>
        <button onClick={() => act(() => { g.track = j.id; return null })} className={g.track === j.id ? 'on' : ''}>{g.track === j.id ? 'Tracking' : 'Track'}</button>
        <button className="st-ghost" onClick={() => act(() => abandonJob(g, j.id))}>Drop</button>
      </article>)}
    </>}
    <h3>Posted at {st.name}</h3>
    {list.length === 0 && <p className="st-empty">Board's empty until tomorrow.</p>}
    {list.map((j) => <article key={j.id} className={`st-job ${j.legal ? '' : 'grey'}`}>
      <div>
        <span className="st-eyebrow">{j.legal ? j.type : 'No questions asked'}</span>
        <h2>{j.title}</h2><p>{j.brief}</p>
        <small>₡ {j.reward.toLocaleString()} · due {clock(j.deadline)}</small>
      </div>
      <button className="st-primary" onClick={() => act(() => acceptJob(g, j))}>Accept</button>
    </article>)}
  </div>
}
function jobProgress(j) {
  switch (j.type) {
    case 'salvage': return `${j.got} of ${j.n} canisters`
    case 'bounty': return `${j.kills} of ${j.n} raiders`
    case 'race': return j.best ? `Best ${j.best.toFixed(1)} s (par ${j.par})` : 'Not flown yet'
    case 'survey': return j.stars ? `${j.stars} stars` : 'Not landed yet'
    default: return j.n ? `${j.n} × ${GOODS[j.good].name}` : 'Deliver in person'
  }
}

function Market({ g, st, act }) {
  const used = cargoUsed(g), cap = g.player.stats.cargo
  return <div className="st-market">
    <h3>Hold: {used} of {cap}</h3>
    <table>
      <thead><tr><th>Goods</th><th>Buy</th><th>Sell</th><th>Hold</th><th /></tr></thead>
      <tbody>{GOOD_ORDER.map((k) => {
        const b = buyPrice(st.id, k, g.time), s = sellPrice(st.id, k, g.time), have = g.ship.cargo[k] ?? 0
        return <tr key={k} className={GOODS[k].contraband ? 'grey' : ''}>
          <td>{GOODS[k].name}{GOODS[k].contraband && <em> contraband</em>}</td>
          <td>{b == null ? '—' : `₡ ${b}`}</td><td>{s == null ? '—' : `₡ ${s}`}</td><td>{have || ''}</td>
          <td className="st-trade">
            <button disabled={b == null} onClick={() => act(() => trade(g, k, 1))}>Buy 1</button>
            <button disabled={b == null} onClick={() => act(() => trade(g, k, 99))}>Max</button>
            <button disabled={s == null || !have} onClick={() => act(() => trade(g, k, -1))}>Sell 1</button>
            <button disabled={s == null || !have} onClick={() => act(() => trade(g, k, -999))}>All</button>
          </td>
        </tr>
      })}</tbody>
    </table>
    {(g.ship.cargo.salvage ?? 0) > 0 && <p className="st-empty">{g.ship.cargo.salvage} salvage canister(s) aboard: turn them in where the job says.</p>}
  </div>
}

function Shipyard({ g, act }) {
  return <div className="st-yard">{PLAYER_HULLS.map((id) => {
    const h = HULLS[id], mine = g.ship.hull === id
    const trade = Math.round(HULLS[g.ship.hull].price * 0.5)
    return <article key={id} className={`st-hull ${mine ? 'mine' : ''}`}>
      <img src={`${import.meta.env.BASE_URL}game/hull-${id}.webp`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
      <h2>{h.name}</h2><span className="st-eyebrow">{h.role}</span>
      <p>{h.blurb}</p>
      <dl>
        <div><dt>Top speed</dt><dd>{h.maxSpeed} m/s</dd></div><div><dt>Thrust</dt><dd>{(h.accel / 9.81).toFixed(1)} g</dd></div>
        <div><dt>Shield / hull</dt><dd>{h.shield} / {h.hull}</dd></div><div><dt>Guns</dt><dd>{h.guns}</dd></div>
        <div><dt>Hold</dt><dd>{h.cargo}</dd></div><div><dt>Drive</dt><dd>{(h.drive / 9.81).toFixed(1)} g, {(h.tank / 1000).toFixed(0)} km/s</dd></div>
      </dl>
      {mine ? <button disabled>Your ship</button> : <button className="st-primary" onClick={() => act(() => buyHull(g, id))}>Buy · ₡ {(h.price - trade).toLocaleString()} with trade-in</button>}
    </article>
  })}</div>
}

function Outfit({ g, act }) {
  return <div className="st-outfit">{Object.entries(UPGRADES).map(([id, u]) => {
    const lvl = g.ship.up[id] ?? 0, cost = u.costs[lvl]
    return <article key={id} className="st-up">
      <div><h2>{u.name}</h2><p>{u.effect}</p><span className="st-levels">{u.costs.map((_, k) => <i key={k} className={k < lvl ? 'on' : ''} />)}</span></div>
      <button className="st-primary" disabled={cost == null} onClick={() => act(() => buyUpgrade(g, id))}>{cost == null ? 'Fitted' : `₡ ${cost.toLocaleString()}`}</button>
    </article>
  })}</div>
}

function Services({ g, st, act }) {
  const rc = repairCost(g), fc = refuelCost(g)
  return <div className="st-services">
    <article className="st-up"><div><h2>Repair</h2><p>Hull {Math.round(g.player.hull / g.player.stats.hull * 100)}%</p></div><button className="st-primary" disabled={rc <= 0} onClick={() => act(() => repair(g))}>{rc > 0 ? `₡ ${rc.toLocaleString()}` : 'Sound'}</button></article>
    <article className="st-up"><div><h2>Propellant</h2><p>{(g.ship.prop / 1000).toFixed(0)} of {((g.player.stats.tank ?? 0) / 1000).toFixed(0)} km/s of delta-v</p></div><button className="st-primary" disabled={fc <= 0} onClick={() => act(() => refuel(g))}>{fc > 0 ? `Fill · ₡ ${fc.toLocaleString()}` : 'Full'}</button></article>
    {st.id === 'shackle' && g.debt > 0 && <article className="st-up"><div><h2>Pay Rook</h2><p>You owe ₡ {g.debt.toLocaleString()}. He is in no hurry. He says.</p></div>
      <span className="st-pay">{[1000, 5000].map((n) => <button key={n} className="st-primary" onClick={() => act(() => payDebt(g, n))}>₡ {n.toLocaleString()}</button>)}</span></article>}
    {st.services.includes('fines') && g.heat.level > 0 && <article className="st-up"><div><h2>Settle with the Compact</h2></div><button className="st-primary" onClick={() => act(() => { fine(g); return null })}>Pay the fine</button></article>}
  </div>
}

function Pilot({ g }) {
  const s = g.stats
  return <div className="st-pilot">
    <h2>{g.pilot.name}</h2>
    <dl>
      <div><dt>Earned</dt><dd>₡ {s.earned.toLocaleString()}</dd></div><div><dt>Jobs done</dt><dd>{s.jobs}</dd></div>
      <div><dt>Transfers flown</dt><dd>{s.trips}</dd></div><div><dt>Kills</dt><dd>{s.kills}</dd></div>
      <div><dt>Ships lost</dt><dd>{s.deaths}</dd></div><div><dt>Story</dt><dd>{g.story.done.length} of 8 missions</dd></div>
    </dl>
  </div>
}

function ShipCard({ g }) {
  const p = g.player
  return <div className="st-ship"><strong>{HULLS[g.ship.hull].name}</strong><span>Hull {Math.round(p.hull / p.stats.hull * 100)}% · Prop {Math.round(g.ship.prop / (p.stats.tank ?? 1) * 100)}% · Hold {cargoUsed(g)}/{p.stats.cargo}</span></div>
}
