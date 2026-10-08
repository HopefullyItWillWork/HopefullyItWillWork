/* Scoring: a night's box scores, credited to the clubs that started each man.

   Pure — imports only other pure libs, touches no storage — so the whole rule
   can be tested with inline data (tests/score.test.js). lib/scorerun.mjs does
   the reading and writing.

   For each player in a night's box scores (lib/stats.mjs):
     1. His game's tip-off is found from the night's games, by his NBA club.
     2. Each club's lineup AT THAT TIP-OFF is the last lineup-history entry at or
        before it (lib/lineups.mjs). A change after his game started cannot
        reach that game.
     3. If his name is in one of that lineup's slots, the club started him.
   Then, per club, the night's starters are taken TOP-DOWN in slot order —
   C, G1–G4, F1–F4, U1–U6 — and each one is a game. Once the club reaches the
   game cap (920) the rest are discarded, recorded under `over` so a GM can see
   exactly who did not count. League rule, 2026-10-08: GMs manage their own
   games; at 919 with ten starters playing, only the centre counts.

   A slot counts at most one game a night — the first man to tip in it — so a
   swap made after tip-off, which the page's lock forbids but the server cannot
   see, gains nothing.

   Club names are mapped through the rename journal, so a lineup saved under a
   club's old name still scores for it. */

import { SLOTS, lineupAt } from "./lineups.mjs";
import { nameKey, ESPNNAME } from "./nba.mjs";

/* The page's NAMEFIX: roster spellings from the league sheet that box scores
   spell differently. Keep in step with index.html. */
export const NAMEFIX = {
  "Nikola Jokić": "Nikola Jokic", "Alperen Şengün": "Alperen Sengun",
  "Nikola Vučević": "Nikola Vucevic", "Jakob Poetl": "Jakob Poeltl",
  "Wendell Carter": "Wendell Carter Jr.", "IR-Kevin Porter Jr": "Kevin Porter Jr",
  "Egor Dëmin": "Egor Demin", "V. J. Edgecombe": "VJ Edgecombe",
};

/* Category keys as the page's chart and standings read them. */
export const CATS = ["FG", "FGA", "FT", "FTA", "P3", "REB", "AST", "STL", "BLK", "TO", "PTS", "GP"];
const zero = () => Object.fromEntries(CATS.map((k) => [k, 0]));

/* Every key a roster name could be known by in a box score: itself, the
   built-in fixes, ESPN's spelling, and the commissioner's own alias map
   (settings.alias, the same map canon() reads first). */
export function keysFor(name, alias) {
  const out = new Set();
  const add = (n) => { if (n) out.add(nameKey(n)); };
  for (const n of [name, alias && alias[name], NAMEFIX[name]]) {
    add(n); add(ESPNNAME[n]);
  }
  out.delete("");
  return out;
}

/* Old club name → the name it goes by now, following the journal in order.
   A club removed from the league (to: null) maps to null. */
export function currentName(name, renames) {
  let cur = name;
  for (const r of renames || []) if (r && r.from === cur) cur = r.to;
  return cur;
}

/* Tip-off per NBA club for the night, from the stored games. */
function tipsByClub(games) {
  const out = {};
  for (const g of Object.values(games || {})) {
    if (!g || !g.tip) continue;
    for (const c of [g.home, g.away]) if (c && (!out[c] || g.tip < out[c])) out[c] = g.tip;
  }
  return out;
}

/* One night.
     night    the stored daily-YYYY-MM-DD record
     lineups  { club: [entries…] } from lineupsOn(), club names as saved
     gpBefore { club: games already counted this season before this night }
     cap      the game cap (settings.gamecap, normally 920)
     alias, renames from settings
   Returns { clubs: { club: { gpBefore, counted:[…], over:[…], reused:[…], totals } },
             unmatched: [players nobody started], noTip: [players with no game] } */
export function scoreNight({ night, lineups, gpBefore, cap = 920, alias, renames }) {
  /* Lineup history grouped under each club's CURRENT name, merged in time
     order — a rename mid-day leaves entries under both names. */
  const byClub = {};
  for (const [club, list] of Object.entries(lineups || {})) {
    const now = currentName(club, renames);
    if (!now) continue;
    (byClub[now] = byClub[now] || []).push(...list);
  }
  for (const c of Object.keys(byClub)) byClub[c].sort((a, b) => a.at.localeCompare(b.at));

  /* For each club and each distinct tip-off, the slot each name key sits in. */
  const slotCache = {};
  const slotsAt = (club, tip) => {
    const k = club + "|" + tip;
    if (slotCache[k]) return slotCache[k];
    const e = lineupAt(byClub[club], tip), map = {};
    if (e) for (const id of SLOTS) {
      const n = e.s && e.s[id];
      if (n) for (const key of keysFor(n, alias)) map[key] = id;
    }
    return (slotCache[k] = map);
  };

  const tips = tipsByClub(night && night.games);
  const starts = {};                     // club -> [{slot, id, n, t, tip, s}]
  const noTip = [], unmatched = [];
  for (const [id, p] of Object.entries((night && night.players) || {})) {
    const tip = tips[p.t];
    if (!tip) { noTip.push(p.n); continue; }
    const key = nameKey(p.n);
    let hit = false;
    for (const club of Object.keys(byClub)) {
      const slot = slotsAt(club, tip)[key];
      if (!slot) continue;
      (starts[club] = starts[club] || []).push({ slot, id, n: p.n, t: p.t, tip, s: p.s });
      hit = true;
    }
    if (!hit) unmatched.push(p.n);
  }

  const clubs = {};
  for (const club of new Set([...Object.keys(byClub), ...Object.keys(gpBefore || {})])) {
    const before = (gpBefore && gpBefore[club]) || 0;
    /* One game per slot per night. A player is locked into his slot once his
       game tips, so a slot holding two men who both played means the lock was
       got around — swapped after tip-off. The first man to tip keeps it; the
       other goes under `reused` and does not count. */
    const bySlot = {}, reused = [];
    for (const x of (starts[club] || []).sort((a, b) => a.tip.localeCompare(b.tip))) {
      if (bySlot[x.slot]) reused.push(x); else bySlot[x.slot] = x;
    }
    const list = Object.values(bySlot).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    const room = Math.max(0, cap - before);
    const counted = list.slice(0, room), over = list.slice(room);
    const totals = zero();
    for (const x of counted) {
      const s = x.s || {};
      totals.FG += s.FG || 0; totals.FGA += s.FGA || 0; totals.FT += s.FT || 0; totals.FTA += s.FTA || 0;
      totals.P3 += s.P3 || 0; totals.REB += s.TRB || 0; totals.AST += s.AST || 0; totals.STL += s.STL || 0;
      totals.BLK += s.BLK || 0; totals.TO += s.TOV || 0; totals.PTS += s.PTS || 0; totals.GP += 1;
    }
    clubs[club] = { gpBefore: before, counted, over, reused, totals };
  }
  return { clubs, unmatched, noTip };
}

/* Season totals and roto points from the per-night club totals.
     days { date: { club: totals } }  (the `score-<season>` index)
   Club names are mapped through renames so a club's whole season sums under
   its current name. Points: best in a category gets as many points as there
   are clubs, down to 1; fewest turnovers is best; ties split. */
export function seasonStandings(days, renames, clubs) {
  const tot = {};
  for (const c of clubs || []) tot[c] = zero();
  for (const night of Object.values(days || {})) {
    for (const [club, t] of Object.entries(night || {})) {
      const now = currentName(club, renames);
      if (!now) continue;
      const into = (tot[now] = tot[now] || zero());
      for (const k of CATS) into[k] += t[k] || 0;
    }
  }
  const names = Object.keys(tot);
  const val = (c, k) => k === "FG%" ? (tot[c].FGA ? tot[c].FG / tot[c].FGA : 0)
    : k === "FT%" ? (tot[c].FTA ? tot[c].FT / tot[c].FTA : 0) : tot[c][k];
  const SC = ["FG%", "FT%", "P3", "REB", "AST", "STL", "BLK", "TO", "PTS"];
  const pts = {}, cat = {};
  for (const c of names) { pts[c] = 0; cat[c] = {}; }
  for (const k of SC) {
    for (const c of names) {
      const v = val(c, k);
      const better = names.filter((o) => k === "TO" ? val(o, k) < v : val(o, k) > v).length;
      const ties = names.filter((o) => val(o, k) === v).length;
      const p = names.length - better - (ties - 1) / 2;
      cat[c][k] = p; pts[c] += p;
    }
  }
  const order = names.slice().sort((a, b) => pts[b] - pts[a] || a.localeCompare(b));
  return order.map((c, i) => ({ club: c, rank: i + 1, pts: pts[c], cat: cat[c], tot: tot[c],
    pct: { FG: val(c, "FG%"), FT: val(c, "FT%") } }));
}
