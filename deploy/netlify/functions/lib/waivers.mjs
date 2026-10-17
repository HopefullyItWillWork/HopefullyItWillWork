/* The waiver wire — the rule, pure (tests/waivers.test.js).

   League rule (Cap rules page): "Claim order runs worst record to best, reset
   weekly. A claimed player finishes the season on a minimum contract, then
   becomes a free agent." League decisions, 2026-10-16:
     - Every free agent is on waivers until the first week of the season is
       over (opening night + 7 days, settings.opener); after that, a player
       released in season is on waivers for one day.
     - Claims are processed once a morning (waivers-daily.mjs). A player
       released on league date D clears at the run on D+1.
     - Priority is ESPN's "inverse order of standings, reset every Monday": the
       worst club claims first, ties to the club with fewer points; a club that
       wins a claim drops to the back until the next Monday. Before any night
       is scored the order is the rookie draft order (reverse order of finish).
     - A club with a full roster must name a player to drop with its claim.

   Where things live (all in the rosters slice, so they merge per club):
     cut record  c.wv = { from, till, done?, to? }  — written by the page's
                 releaseRecord() for an in-season release; `till` is the league
                 date of the run that clears him; `done` is 'claimed'|'cleared'
     claims      S.teams[club].claims = [{ id, n, drop, at }]  — the club's own
   The weekly order and the run history live in the `waivers` blob.

   Nothing here touches storage; processWaivers() takes the rosters and
   settings and returns the new rosters plus what happened. */

import { nameKey } from "./nba.mjs";

/* ---- seasons and contracts, the page's rules restated ---- */
const SK = /(\d{4})/;
export function seasonKey(v) {
  const m = String(v == null ? "" : v).match(SK);
  if (!m) return "";
  const a = +m[1];
  return a + "-" + String((a + 1) % 100).padStart(2, "0");
}
const seasonAt = (k, n) => { const m = String(k).match(SK); return m ? seasonKey(+m[1] + n) : ""; };
export function salIn(p, season) {
  if (!p || !p.y) return null;
  /* The legacy four-slot array is read the page's way: index 1 is the season
     the league is on, which is the only season this file asks about. */
  if (Array.isArray(p.y)) { const v = p.y[1]; return v == null ? null : v; }
  for (const k of Object.keys(p.y)) if (seasonKey(k) === season && p.y[k] != null) return p.y[k];
  return null;
}
const yrsLeft = (p, season) => {
  if (!p || !p.y) return 0;
  if (Array.isArray(p.y)) return p.y.slice(1).filter((v) => v != null).length;
  return Object.keys(p.y).filter((k) => seasonKey(k) >= season && p.y[k] != null).length;
};
export const contracted = (p, season) => salIn(p, season) != null;
const onIR = (p) => !!(p && p.ir);
const cutSeason = (c, season) => seasonKey(c && c.at) || seasonAt(season, -1);

export function dayPlus(day, n) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/* The Monday on or before a league date. */
export function mondayOf(day) {
  const back = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;
  return dayPlus(day, -back);
}

/* Every free agent is on waivers until opening night + 7 days. */
export function allOnWaivers(cfg, today) {
  const o = cfg && cfg.opener;
  if (!cfg || cfg.phase !== "season") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o || "")) return false;
  return today < dayPlus(o, 7);
}

/* ---- the club numbers the page uses ---- */
export function committed(team, season, live) {
  const sal = (team.r || []).reduce((s, p) => s + (salIn(p, season) || 0), 0);
  const dead = (team.cuts || []).reduce((s, c) =>
    s + (c && c.live && cutSeason(c, season) === season && live ? (c.s || 0) : 0), 0);
  return sal + dead;
}
export const headcount = (team, season) => (team.r || []).filter((p) => contracted(p, season) && !onIR(p)).length;

/* The release bar, as cutRestriction() on the page: a club that released a man
   above the minimum this cycle may not claim him back. A multi-year release
   only limits it to a one-year minimum, which a claim is anyway. */
export function barredFrom(team, name, season, minSal) {
  const k = nameKey(name);
  return (team.cuts || []).some((c) => c && nameKey(c.n) === k
    && cutSeason(c, season) === season && (c.s || 0) > minSal + 0.001);
}

/* ---- the order ---- */
/* standings: seasonStandings() rows ({club, pts, tot}) of THIS app's scoring,
   taken as of the Monday (see currentOrder), so only nights up to Sunday.
   Worst first; ties to fewer points. Once any night has been scored every club
   is ranked, one with no games included. Before that, the first order is the
   auction's nomination order, as saved (the first club on it claims first),
   then the rookie draft order, then alphabetical. */
export function weeklyOrder(clubs, standings, nomOrder, draftOrder) {
  const rows = (standings || []).filter((r) => r && r.tot && clubs.includes(r.club));
  let order;
  if (rows.some((r) => r.tot.GP > 0)) {
    order = rows.slice().sort((a, b) => (a.pts - b.pts) || ((a.tot.PTS || 0) - (b.tot.PTS || 0))
      || a.club.localeCompare(b.club)).map((r) => r.club);
  } else {
    order = (nomOrder || []).filter((c) => clubs.includes(c));
    for (const c of (draftOrder || [])) if (clubs.includes(c) && !order.includes(c)) order.push(c);
  }
  for (const c of clubs.slice().sort()) if (!order.includes(c)) order.push(c);
  return order;
}

/* Who is on waivers right now, and until when: in-season releases whose window
   has not been settled. A player re-signed since (on a roster, contracted) is
   no longer on waivers whatever the record says. */
export function onWaivers(teams, season) {
  const signed = new Set();
  for (const t of Object.values(teams || {})) for (const p of t.r || []) if (contracted(p, season)) signed.add(nameKey(p.n));
  const out = [];
  for (const [club, t] of Object.entries(teams || {})) {
    for (const c of t.cuts || []) {
      if (!c || !c.wv || c.wv.done || signed.has(nameKey(c.n))) continue;
      out.push({ n: c.n, p: c.p || "", from: club, till: c.wv.till, rec: c });
    }
  }
  return out.sort((a, b) => a.till.localeCompare(b.till) || a.n.localeCompare(b.n));
}

/* ---- the run ----
   teams     the rosters slice (copied, never mutated in place)
   cfg       settings
   order     this week's order (weeklyOrder, then any moves this week)
   today     the league date of the run
   Returns { teams, order, results, cleared, skipped, log } — log entries in
   the transaction log's own shape, newest last. */
export function processWaivers({ teams, cfg, order, today, now = new Date().toISOString(), by = "Waivers" }) {
  const T = JSON.parse(JSON.stringify(teams || {}));
  const season = seasonKey(cfg && cfg.season);
  const live = cfg && cfg.phase === "season";
  const minSal = parseFloat(cfg && cfg.minSal) > 0 ? Math.round(parseFloat(cfg.minSal) * 4) / 4 : 1;
  const tax = +((cfg && cfg.tax) || 200.5), limit = +((cfg && cfg.roster) || 15);
  const deadline = cfg && cfg.deadline;
  const ord = (order || []).slice();
  const results = [], cleared = [], skipped = [], log = [];
  if (!live || !season) return { teams: T, order: ord, results, cleared, skipped, log };

  const pending = onWaivers(T, season);
  const due = new Map();           // nameKey -> waiver record (or null for a plain free agent)
  for (const w of pending) if (w.till <= today) due.set(nameKey(w.n), w);
  const waiting = new Set(pending.filter((w) => w.till > today).map((w) => nameKey(w.n)));
  const signedNow = () => {
    const s = new Set();
    for (const t of Object.values(T)) for (const p of t.r || []) if (contracted(p, season)) s.add(nameKey(p.n));
    return s;
  };

  /* Every claim that can be decided today, grouped by player. A claim on a man
     still inside his window waits; a claim on a plain free agent (the first
     week) is decided now. */
  const byPlayer = new Map();
  for (const [club, t] of Object.entries(T)) {
    for (const cl of t.claims || []) {
      const k = nameKey(cl && cl.n);
      if (!k || waiting.has(k)) continue;
      if (!byPlayer.has(k)) byPlayer.set(k, { n: cl.n, claims: [] });
      byPlayer.get(k).claims.push({ club, ...cl });
    }
  }
  /* Players in the order their waivers started, then by the earliest claim. */
  const keys = [...byPlayer.keys()].sort((a, b) => {
    const wa = due.get(a), wb = due.get(b);
    const ta = wa ? wa.till : "9999", tb = wb ? wb.till : "9999";
    const ca = Math.min(...byPlayer.get(a).claims.map((c) => Date.parse(c.at) || 0));
    const cb = Math.min(...byPlayer.get(b).claims.map((c) => Date.parse(c.at) || 0));
    return ta.localeCompare(tb) || ca - cb;
  });

  const removeClaim = (club, id) => { T[club].claims = (T[club].claims || []).filter((c) => c.id !== id); };

  for (const k of keys) {
    const { n } = byPlayer.get(k);
    if (signedNow().has(k)) {                               // signed by some other route
      for (const c of byPlayer.get(k).claims) { removeClaim(c.club, c.id); skipped.push({ n, club: c.club, why: "already signed" }); }
      continue;
    }
    const claims = byPlayer.get(k).claims.slice().sort((a, b) => ord.indexOf(a.club) - ord.indexOf(b.club));
    let won = null;
    for (const c of claims) {
      const team = T[c.club];
      let why = null;
      if (barredFrom(team, n, season, minSal)) why = "released him above the minimum this season";
      /* The exact roster name first; the letters-only key only as a fallback. */
      let dropIdx = c.drop ? (team.r || []).findIndex((p) => p.n === c.drop && contracted(p, season)) : -1;
      if (c.drop && dropIdx < 0) dropIdx = (team.r || []).findIndex((p) => nameKey(p.n) === nameKey(c.drop) && contracted(p, season));
      if (!why && c.drop && dropIdx < 0) why = `${c.drop} is no longer on the roster to drop`;
      const roomAfter = headcount(team, season) - (dropIdx >= 0 && !onIR(team.r[dropIdx]) ? 1 : 0);
      if (!why && roomAfter >= limit) why = "roster full and no player to drop";
      /* A drop in season stays on the cap, so it frees no money. */
      if (!why && committed(team, season, live) + minSal > tax + 0.001) why = "would pass the hard cap";
      if (why) { skipped.push({ n, club: c.club, why }); continue; }
      won = { ...c, dropIdx };
      break;
    }
    for (const c of byPlayer.get(k).claims) removeClaim(c.club, c.id);
    const w = due.get(k);
    if (!won) continue;

    const team = T[won.club];
    let dropped = null;
    if (won.dropIdx >= 0) {
      const p = team.r.splice(won.dropIdx, 1)[0];
      dropped = p.n;
      const s = salIn(p, season);
      team.cuts = team.cuts || [];
      team.cuts.push({ n: p.n, p: p.p, s: s != null ? s : 0, blocked: yrsLeft(p, season) >= 2, live: true,
        at: season, cv: 2, wv: { from: today, till: dayPlus(today, 1) } });
      if (team.lu && team.lu.s) for (const id of Object.keys(team.lu.s)) if (nameKey(team.lu.s[id]) === nameKey(p.n)) team.lu.s[id] = "";
    }
    /* An expiring entry for him on any roster moves (as signPlayer() does). */
    let entry = null;
    for (const t of Object.values(T)) {
      const i = (t.r || []).findIndex((p) => nameKey(p.n) === k && !contracted(p, season));
      if (i >= 0) { entry = t.r.splice(i, 1)[0]; break; }
    }
    /* A released man claimed off waivers: the minimum, the rest of the season, no
       rights (the rule). A first-week free agent is an ordinary in-season
       signing: Early Bird before the deadline. */
    const fromWaivers = !!w;
    const bird = fromWaivers ? "" : (deadline && today > deadline ? "" : "Early");
    const p = entry || { n, p: (w && w.p) || "", cut: false };
    p.y = { [season]: minSal }; p.o = ""; delete p.on; delete p.auc; delete p.mle; delete p.blk; delete p.ir;
    p.b = bird; p.acq = +season.slice(0, 4); p.wv = season;
    team.r.push(p);
    if (w) { w.rec.wv.done = "claimed"; w.rec.wv.to = won.club; }
    /* Back of the line until Monday. */
    const at = ord.indexOf(won.club);
    if (at >= 0) { ord.splice(at, 1); ord.push(won.club); }
    results.push({ n, to: won.club, from: w ? w.from : null, drop: dropped });
    if (dropped) log.push({ ts: now, by, kind: "cut", team: won.club,
      detail: `${dropped} released to make room for a waiver claim` });
    log.push({ ts: now, by, kind: "sign", team: won.club,
      detail: `${n} — claimed off waivers${w ? ` from ${w.from}` : ""} — $${minSal.toFixed(2)} × 1 yr${bird ? " (Early Bird)" : ""}` });
  }

  /* Anyone whose window is over and nobody won: a free agent now. */
  for (const w of due.values()) {
    if (w.rec.wv.done) continue;
    w.rec.wv.done = "cleared";
    cleared.push({ n: w.n, from: w.from });
  }
  return { teams: T, order: ord, results, cleared, skipped, log };
}
