/* Live stats during games (2026-11-16): every five minutes while a night's games
   are on, read the box scores of the games under way and score the night
   provisionally, with the same rule the morning uses (lib/score.mjs).

   It writes ONE blob, `live`, and nothing else: not daily-YYYY-MM-DD, not the
   score index, not daily-index. The morning feed and scoring stay the official
   record, untouched, and re-read every box score anyway (ESPN corrects them for
   days). So a bad live run can only ever show a wrong provisional number for a
   few minutes; it cannot change a standing.

     live  { day, at, allFinal, games:{id:{home,away,tip,final,state,detail}},
             players:{espnId:{n,t,s}}, clubs:{clubId:{totals, counted:[{slot,n,t}], over:[n]}} }

   ESPN is asked as little as possible: nothing before the night's first tip or
   once every game is final (`gate`), one scoreboard per run, and a box score
   only for a game in progress or one that went final since the last run. A
   game already captured final is kept, not re-fetched. Any ESPN error leaves
   the last good copy in place. */

import { SB, SUMMARY, ymd, parseBox, seasonTypes, tipsFrom, oppsFrom } from "./stats.mjs";
import { scoreLive } from "./scorerun.mjs";

const HEAD = { "user-agent": "Mozilla/5.0 (compatible; LeagueLedger/1.0)", accept: "application/json" };
export const TZ = () => process.env.LEAGUE_TZ || "America/New_York";
/* The night rolls at 4 AM league time, like the page's luNight(): a game that
   runs past midnight Eastern still belongs to the night it tipped on. */
export const LUROLL = 240;

/* Pure: the league night and the minutes into its evening, at `now`. Past
   midnight the clock keeps counting (24:30 is 1470), so it compares with tips. */
export function nightAt(tz, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`, min = (+p.hour) * 60 + (+p.minute);
  if (min >= LUROLL) return { day, min };
  const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - 1);
  return { day: t.toISOString().slice(0, 10), min: min + 1440 };
}

/* Pure: should this run ask ESPN anything? `sched` is the cached schedule for the
   night ({tips:{CODE:"HH:MM"}}) or null when none is cached yet (then ask). */
export function gate({ prev, sched, night, min }) {
  if (prev && prev.day === night && prev.allFinal) return "every game is final";
  if (sched && sched.tips) {
    const tips = Object.values(sched.tips).map((v) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(v)); return m ? (+m[1]) * 60 + (+m[2]) : null;
    }).filter((v) => v != null);
    if (!tips.length) return "no games tonight";
    if (min < Math.min(...tips) - 5) return "before the first tip";
  }
  return "";
}

/* Pure: the night's games from a scoreboard, with where each one is. */
export function liveGames(scoreboard, types) {
  const out = {};
  for (const e of (scoreboard && scoreboard.events) || []) {
    const ty = e.season && e.season.type;
    if (types && !types.has(ty)) continue;
    const st = (e.status && e.status.type) || {};
    if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(String(st.name || ""))) continue;
    const comp = (e.competitions && e.competitions[0]) || {};
    const side = (h) => { const c = (comp.competitors || []).find((x) => x.homeAway === h);
      return (c && c.team && c.team.abbreviation) || ""; };
    const t = Date.parse(e.date || comp.date || "");
    out[String(e.id)] = { home: side("home"), away: side("away"), ty: ty || null,
      tip: Number.isFinite(t) ? new Date(t).toISOString() : null,
      final: !!st.completed, state: st.state || "", detail: st.shortDetail || st.detail || "" };
  }
  return out;
}

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: HEAD, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url.split("?")[0]}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
const readJSON = async (s, key) => { try { const raw = await s.get(key); return raw ? JSON.parse(raw) : null; } catch { return null; } };

/* Pure: how far the morning's official totals moved from the last live copy of
   the same night, per club and key — only what differs. Shown to the
   commissioner, so how much the live numbers drift is visible, not guessed. */
const DKEYS = ["PTS", "REB", "AST", "P3", "STL", "BLK", "TO", "FG", "FGA", "FT", "FTA", "GP"];
export function driftOf(liveClubs, official) {
  const out = {};
  for (const id of new Set([...Object.keys(liveClubs || {}), ...Object.keys(official || {})])) {
    const a = ((liveClubs || {})[id] || {}).totals || {}, b = (official || {})[id] || {};
    const d = {};
    for (const k of DKEYS) { const v = (b[k] || 0) - (a[k] || 0); if (v) d[k] = v; }
    if (Object.keys(d).length) out[id] = d;
  }
  return out;
}

/* After the morning's scoring: compare it with the live copy of that night. */
export async function recordDrift(s, seasonKey) {
  const live = await readJSON(s, "live");
  if (!live || !live.day || !seasonKey) return null;
  const idx = await readJSON(s, "score-" + seasonKey);
  const official = idx && idx.data && idx.data.days && idx.data.days[live.day];
  if (!official) return null;
  const out = { day: live.day, at: new Date().toISOString(), liveAt: live.at, clubs: driftOf(live.clubs, official) };
  await s.set("live-drift", JSON.stringify(out));
  return out;
}

/* The last run, for the commissioner's panel: every real run, every error, and
   a skip only when its reason changed (a quiet afternoon is one write, not 60). */
async function noteRun(s, run) {
  const prev = await readJSON(s, "live-run");
  if (run.skipped && prev && prev.skipped === run.skipped && prev.night === run.night) return;
  await s.set("live-run", JSON.stringify({ ...run, at: new Date().toISOString(),
    lastOk: run.ok && !run.skipped ? new Date().toISOString() : (prev && prev.lastOk) || null }));
}

export async function runLive(s, opts = {}) {
  const t0 = Date.now();
  let out;
  try { out = await runLiveOnce(s, opts); }
  catch (e) { out = { ok: false, night: nightAt(TZ(), opts.now || new Date()).day, error: String((e && e.message) || e) }; }
  out.ms = Date.now() - t0;
  try { await noteRun(s, out); } catch { /* the status is a nicety */ }
  return out;
}

async function runLiveOnce(s, { now = new Date(), force = false } = {}) {
  const { day: night, min } = nightAt(TZ(), now);
  const prev = await readJSON(s, "live");
  if (!force) {
    const why = gate({ prev, sched: await readJSON(s, "sched-" + night), night, min });
    if (why) return { ok: true, skipped: why, night };
  }
  const types = seasonTypes(process.env.STATS_TYPES);
  const sb = await getJSON(`${SB}?dates=${ymd(night)}`);
  /* No schedule cached for the night yet: keep this one in /api/schedule's own
     shape, so the next run's gate knows the tips (or that there are no games). */
  if (!(await s.get("sched-" + night)))
    try { await s.set("sched-" + night, JSON.stringify({ at: Date.now(), tips: tipsFrom(sb, TZ()), opp: oppsFrom(sb) })); } catch { /* the gate just asks again */ }
  const games = liveGames(sb, types);
  const old = prev && prev.day === night ? prev : null;
  const players = {}, fetched = [];
  const keepFrom = (g) => {   // a game captured final last time: keep its lines
    const codes = new Set([g.home, g.away]);
    for (const [id, p] of Object.entries(old.players || {})) if (codes.has(p.t)) players[id] = p;
  };
  await Promise.all(Object.entries(games).map(async ([id, g]) => {
    const was = old && old.games && old.games[id];
    if (was && was.final && g.final) { keepFrom(g); return; }
    if (g.state !== "in" && !g.final) return;              // not started
    Object.assign(players, parseBox(await getJSON(`${SUMMARY}?event=${id}`)));
    fetched.push(id);
  }));
  const ids = Object.keys(games);
  const night$ = { date: night, games: Object.fromEntries(ids.map((id) => [id,
    { final: games[id].final, home: games[id].home, away: games[id].away, tip: games[id].tip, ty: games[id].ty }])), players };
  const r = await scoreLive(s, night$);
  const clubs = {};
  for (const [cid, c] of Object.entries((r && r.clubs) || {})) {
    if (!c.counted.length && !c.over.length) continue;
    clubs[cid] = { totals: c.totals, counted: c.counted.map((x) => ({ slot: x.slot, n: x.n, t: x.t })),
      over: c.over.map((x) => x.n) };
  }
  const out = { day: night, at: new Date().toISOString(), allFinal: ids.length > 0 && ids.every((id) => games[id].final),
    games, players, clubs };
  await s.set("live", JSON.stringify(out));
  return { ok: true, night, games: ids.length, fetched: fetched.length, clubs: Object.keys(clubs).length, allFinal: out.allFinal };
}
