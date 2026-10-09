/* What the daily and weekly digests say, for one club. Reads what the morning's
   jobs wrote — scoring (score-<season>, score-YYYY-MM-DD), the night's box scores
   (daily-YYYY-MM-DD), ESPN's rosters (nbaplayers) and tonight's tip-offs — and
   returns plain data. lib/format.mjs turns it into mail.

   The digests are about how the season is going, not the cap: where a club
   stands and who it is chasing, what last night did and what it left on the
   bench, whether tonight's lineup is ready, which categories are a few
   rebounds from a point, which managers have the surplus it needs, whether it
   is on pace to waste games against the 920 cap, and how many minimum pickups it
   can still afford.

   Imports no Netlify package (its own read below), so tests can run it against
   an in-memory store. */

import { seasonOf } from "./scorerun.mjs";
import { seasonStandings, keysFor } from "./score.mjs";
import { SLOTS } from "./lineups.mjs";
import { nameKey } from "./nba.mjs";
import { SB, ymd, tipsFrom, daysBefore } from "./stats.mjs";

async function read(s, key) {
  const raw = await s.get(key);
  return raw ? JSON.parse(raw) : { rev: 0, data: null };
}

/* The nine scoring categories as standings name them, and how a club's value in
   each is read off seasonStandings()'s row. TO is the one where lower wins. */
export const SCAT = ["FG%", "FT%", "P3", "REB", "AST", "STL", "BLK", "TO", "PTS"];
const LABEL = { "FG%": "FG%", "FT%": "FT%", P3: "threes", REB: "rebounds", AST: "assists",
  STL: "steals", BLK: "blocks", TO: "turnovers", PTS: "points" };
export const catLabel = (k) => LABEL[k] || k;
const isPct = (k) => k === "FG%" || k === "FT%";
const valOf = (row, k) => k === "FG%" ? row.pct.FG : k === "FT%" ? row.pct.FT : row.tot[k];
/* How far apart two values are, on one scale for every category — so 14
   rebounds in 3,000 and 4 steals in 300 can be compared. Counts are the gap as a
   share of the bigger total. Percentages are scaled so 0.3 of a percentage point
   reads as close (0.03) and 0.8 as clear (0.08). */
const rel = (k, a, b) => isPct(k) ? Math.abs(a - b) / 0.1
  : Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));

/* Per category, for one club: the club just above it (a point to gain), just
   below it (a point at risk), and whether its lead over the club below is big
   enough to trade some away without losing anything — a surplus. Pure.
   `close` and `surplus` are thresholds on rel(): 3% apart is close, 8% clear is
   surplus. Ties count as neither above nor below. */
export function categoryPicture(standings, club, { close = 0.03, surplus = 0.08 } = {}) {
  const me = standings.find((r) => r.club === club);
  if (!me) return null;
  const out = [];
  for (const k of SCAT) {
    const v = valOf(me, k), lowWins = k === "TO";
    const better = (x) => lowWins ? x < v : x > v, worse = (x) => lowWins ? x > v : x < v;
    const others = standings.filter((r) => r.club !== club).map((r) => ({ club: r.club, v: valOf(r, k) }));
    const up = others.filter((o) => better(o.v)).sort((a, b) => lowWins ? b.v - a.v : a.v - b.v)[0] || null;
    const down = others.filter((o) => worse(o.v)).sort((a, b) => lowWins ? a.v - b.v : b.v - a.v)[0] || null;
    const gapUp = up ? Math.abs(up.v - v) : null, gapDown = down ? Math.abs(v - down.v) : null;
    out.push({ k, v, pts: me.cat[k],
      up: up && { club: up.club, gap: gapUp, close: rel(k, up.v, v) <= close },
      down: down && { club: down.club, gap: gapDown, close: rel(k, v, down.v) <= close },
      surplus: !down || rel(k, v, down.v) >= surplus });
  }
  return out;
}

/* The managers with surplus in each category this club is close to gaining a
   point in — the weekly's trade angle. Only names, never players. */
export function tradeAngles(standings, club, gmOf) {
  const mine = categoryPicture(standings, club) || [];
  const needs = mine.filter((c) => c.up && c.up.close).map((c) => c.k);
  return needs.map((k) => ({
    k,
    clubs: standings.filter((r) => r.club !== club)
      .filter((r) => (categoryPicture(standings, r.club) || []).find((c) => c.k === k && c.surplus))
      .map((r) => ({ club: r.club, gm: gmOf(r.club) })),
  })).filter((a) => a.clubs.length);
}

/* Shared reads, once per run however many clubs are mailed. */
async function base(s, cache) {
  if (cache.base) return cache.base;
  const cfg = (await read(s, "settings")).data || {};
  const season = seasonOf(cfg);
  const idx = season ? (await read(s, "score-" + season.key)).data : null;
  const teams = (await read(s, "rosters")).data || {};
  cache.base = { cfg, season, days: (idx && idx.days) || {}, teams, clubs: Object.keys(teams),
    cap: parseInt(cfg.gamecap, 10) || 920 };
  return cache.base;
}
const gmName = (teams, club) => {
  const g = teams[club] && teams[club].gm;
  return g && (g.first || g.last) ? [g.first, g.last].filter(Boolean).join(" ") : "";
};
const contracted = (p, season) => !!(p && p.y && p.y[season] != null);

/* Minimum pickups still affordable: room under the hard cap at the minimum
   salary, and open active roster spots — whichever runs out first. */
export function pickupsLeft(club, cfg, season) {
  const minSal = parseFloat(cfg.minSal) > 0 ? parseFloat(cfg.minSal) : 1;
  const r = (club && club.r) || [];
  const active = r.filter((p) => contracted(p, season) && !p.ir).length;
  const committed = r.reduce((a, p) => a + (contracted(p, season) ? p.y[season] : 0), 0);
  const spots = Math.max(0, (parseInt(cfg.roster, 10) || 15) - active);
  const money = Math.max(0, Math.floor(((cfg.tax || 0) - committed) / minSal + 1e-9));
  return { left: Math.min(spots, money), spots, money };
}

/* Where a club stands: rank, points, and the gap to the clubs either side. */
function standingOf(rows, club) {
  const i = rows.findIndex((r) => r.club === club);
  if (i < 0) return null;
  const me = rows[i], above = rows[i - 1] || null, below = rows[i + 1] || null;
  return { rank: me.rank, of: rows.length, pts: me.pts,
    above: above && { club: above.club, gap: above.pts - me.pts },
    below: below && { club: below.club, gap: me.pts - below.pts }, row: me };
}

/* Bench points: rostered players who played that night and were credited to
   nobody on this club. */
function benchFor(club, teamEntry, night, scored, cfg, season) {
  const credited = new Set([...(scored.counted || []), ...(scored.over || []), ...(scored.reused || [])]
    .map((x) => nameKey(x.n)));
  const played = {};
  for (const p of Object.values((night && night.players) || {})) played[nameKey(p.n)] = p;
  const out = [];
  for (const p of ((teamEntry && teamEntry.r) || []).filter((p) => contracted(p, season))) {
    for (const k of keysFor(p.n, cfg.alias, cfg.espn)) {
      if (played[k] && !credited.has(k)) { out.push(played[k]); credited.add(k); break; }
    }
  }
  return out.sort((a, b) => (b.s.PTS || 0) - (a.s.PTS || 0));
}

/* Tonight: which of the club's starters have a game, which do not, empty slots,
   and bench players with a game who are not starting. */
async function tonightFor(s, clubEntry, cfg, season, today, cache) {
  if (!cache.tonight) {
    let tips = null;
    try {
      const raw = await s.get("sched-" + today);
      tips = raw ? JSON.parse(raw).tips : null;
      if (!tips) {
        const r = await fetch(`${SB}?dates=${ymd(today)}`, { headers: { accept: "application/json" } });
        if (r.ok) tips = tipsFrom(await r.json(), process.env.LEAGUE_TZ || "America/New_York");
      }
    } catch { tips = null; }
    let byKey = {};
    try {
      const raw = await s.get("nbaplayers");
      const pl = raw ? JSON.parse(raw).players : {};
      for (const p of Object.values(pl || {})) byKey[nameKey(p.n)] = p.t;
    } catch { byKey = {}; }
    cache.tonight = { tips, byKey };
  }
  const { tips, byKey } = cache.tonight;
  /* Without tonight's schedule, or without ESPN's rosters to say whose game is
     whose, the section would call every starter idle. Leave it out instead. */
  if (!tips || !Object.keys(byKey).length) return null;
  const teamOf = (n) => { for (const k of keysFor(n, cfg.alias, cfg.espn)) if (byKey[k]) return byKey[k]; return null; };
  const plays = (n) => { const t = teamOf(n); return !!(t && tips[t]); };
  const s0 = (clubEntry && clubEntry.lu && clubEntry.lu.s) || {};
  const starters = SLOTS.map((id) => s0[id]).filter(Boolean);
  const startSet = new Set(starters.map(nameKey));
  const bench = ((clubEntry && clubEntry.r) || [])
    .filter((p) => contracted(p, season) && !p.ir && !startSet.has(nameKey(p.n)));
  return {
    games: Object.keys(tips).length / 2,
    playing: starters.filter(plays),
    idle: starters.filter((n) => !plays(n)),
    empty: SLOTS.filter((id) => !s0[id]).length,
    benchPlaying: bench.filter((p) => plays(p.n)).map((p) => p.n),
  };
}

/* ---------------- the daily ---------------- */
export async function digestDaily(s, club, day, cache = {}) {
  const b = await base(s, cache);
  const { cfg, days, teams, clubs, cap, season } = b;
  const seasonKey = season ? season.key : null;
  const now = seasonStandings(days, cfg.renames, clubs);
  const was = seasonStandings(Object.fromEntries(Object.entries(days).filter(([d]) => d < day)), cfg.renames, clubs);
  const st = standingOf(now, club), prev = standingOf(was, club);
  const anyBefore = Object.keys(days).some((d) => d < day);

  let last = null;
  if (days[day]) {
    if (!cache["n" + day]) cache["n" + day] = {
      scored: (await read(s, "score-" + day)).data, night: (await read(s, "daily-" + day)).data };
    const { scored, night } = cache["n" + day];
    const c = scored && scored.clubs && scored.clubs[club];
    if (c) {
      const bench = benchFor(club, teams[club], night, c, cfg, seasonKey);
      last = { counted: c.counted || [], over: c.over || [], reused: c.reused || [], totals: c.totals || {},
        gpAfter: (c.gpBefore || 0) + ((c.totals && c.totals.GP) || 0), cap,
        bench: bench.slice(0, 3), benchPts: bench.reduce((a, p) => a + (p.s.PTS || 0), 0) };
    }
  }
  const live = cfg.phase === "season";
  const today = daysBefore(day, -1);
  let tonight = null;
  if (live) { try { tonight = await tonightFor(s, teams[club], cfg, seasonKey, today, cache); } catch { tonight = null; } }
  return {
    day, club, live,
    standing: st && Object.keys(days).length ? { ...st, row: undefined,
      rankWas: anyBefore && prev ? prev.rank : null } : null,
    last, tonight,
  };
}

/* ---------------- the weekly ---------------- */
export async function digestWeekly(s, club, from, to, cache = {}) {
  const b = await base(s, cache);
  const { cfg, days, teams, clubs, cap, season } = b;
  const inWeek = Object.fromEntries(Object.entries(days).filter(([d]) => d >= from && d <= to));
  const before = Object.fromEntries(Object.entries(days).filter(([d]) => d < from));
  const now = seasonStandings(days, cfg.renames, clubs);
  const was = seasonStandings(before, cfg.renames, clubs);
  const week = seasonStandings(inWeek, cfg.renames, clubs);
  const gm = (c) => gmName(teams, c);

  const table = now.map((r) => {
    const p = was.find((x) => x.club === r.club);
    return { club: r.club, gm: gm(r.club), rank: r.rank, pts: r.pts,
      move: Object.keys(before).length && p ? p.rank - r.rank : 0, gp: r.tot.GP };
  });
  const st = standingOf(now, club);
  const wk = week.find((r) => r.club === club);
  const picture = categoryPicture(now, club) || [];

  /* Games pace against the cap. Nights still to play are estimated from how
     often the club has had games so far, out to the regular season's end. */
  const scored = Object.keys(days).sort();
  const used = st ? st.row.tot.GP : 0;
  let pace = null;
  if (scored.length >= 3 && season) {
    const end = cfg.seasonEnd || `${season.key.slice(0, 4) * 1 + 1}-04-12`;
    const spanDays = (d1, d2) => Math.max(0, Math.round((Date.parse(d2) - Date.parse(d1)) / 864e5));
    const elapsed = Math.max(1, spanDays(scored[0], scored[scored.length - 1]) + 1);
    const left = spanDays(scored[scored.length - 1], end);
    const perDay = used / elapsed;
    const projected = Math.round(used + perDay * left);
    pace = { used, cap, projected, expected: Math.round(cap * elapsed / Math.max(1, elapsed + left)) };
  }

  /* Best performers: a simple counting composite, so a guard and a centre can be
     compared on one line. Counted games only. */
  const score = (x) => (x.PTS || 0) + (x.TRB || 0) + (x.AST || 0) + (x.STL || 0) + (x.BLK || 0) + (x.P3 || 0) - (x.TOV || 0);
  const mine = {}, league = {};
  for (const d of Object.keys(inWeek)) {
    const det = (await read(s, "score-" + d)).data;
    for (const [c, x] of Object.entries((det && det.clubs) || {})) {
      for (const p of x.counted || []) {
        const add = (into) => {
          const a = into[p.n + "|" + c] || (into[p.n + "|" + c] = { n: p.n, club: c, g: 0, s: {} });
          a.g++; for (const [kk, v] of Object.entries(p.s || {})) a.s[kk] = (a.s[kk] || 0) + v;
        };
        add(league); if (c === club) add(mine);
      }
    }
  }
  const rank = (o) => Object.values(o).sort((a, b) => score(b.s) - score(a.s));
  const myList = rank(mine);

  return {
    from, to, club, nights: Object.keys(inWeek).length,
    table, standing: st && { ...st, row: undefined },
    weekTable: week.filter((r) => r.tot.GP > 0).map((r) => ({ club: r.club, gm: gm(r.club), rank: r.rank, pts: r.pts })),
    weekRank: wk ? wk.rank : null, weekPts: wk ? wk.pts : null,
    gains: picture.filter((c) => c.up && c.up.close).map((c) => ({ k: c.k, club: c.up.club, gap: c.up.gap })),
    risks: picture.filter((c) => c.down && c.down.close).map((c) => ({ k: c.k, club: c.down.club, gap: c.down.gap })),
    surplus: picture.filter((c) => c.surplus && c.down).map((c) => c.k),
    angles: tradeAngles(now, club, gm),
    pace, pickups: season ? pickupsLeft(teams[club], cfg, season.key) : null,
    best: myList.slice(0, 2), worst: myList.length > 3 ? myList.slice(-1) : [],
    leagueTop: rank(league).slice(0, 3),
  };
}
