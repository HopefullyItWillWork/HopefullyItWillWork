/* Who plays for which NBA club, today, from ESPN's team rosters.

   The page used to get that from NBATM, a table transcribed last season. It
   goes stale with every trade and signing, and it has never heard of a rookie,
   so a player who moved clubs locked at his OLD club's tip-off and a rookie
   never locked at all. This replaces it as the first source; NBATM stays as the
   fallback for anyone ESPN does not list (a two-way player between call-ups,
   say).

     teams   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams
     roster  https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/<id>/roster

   31 small requests. Stored under `nbaplayers`:
     { at, teams: 30, players: { <espnId>: { n, t, pos } } }
   `t` is ESPN's code (GS, NY, SA, UTAH, WSH, NO) — the same codes the tip-off
   feed uses, so a player's club and tonight's schedule always agree. */

export const TEAMS = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams";

/* A name reduced to letters only, accents and suffixes gone: "V. J. Edgecombe"
   and "VJ Edgecombe", "Nikola Jokić" and "Nikola Jokic", "Wendell Carter Jr."
   and "Wendell Carter" all meet. The page has the same function; keep them
   identical. Spelling differences beyond that ("Poetl") are canon()'s job. */
export function nameKey(n) {
  return String(n || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+(jr|sr|ii|iii|iv)$/, "").replace(/\s+/g, "");
}

/* Our spelling → ESPN's, for the names nameKey() cannot fold together because
   they are different words, not different punctuation. Found by checking every
   rated player against ESPN's rosters (2026-10-08). The page carries the same
   table (ESPNNAME); keep them identical. */
export const ESPNNAME = {
  "Ron Holland": "Ronald Holland II",
  "Mouhamadou Gueye": "Mouhamed Gueye",
};

export function teamsFrom(json) {
  const list = (((json || {}).sports || [])[0] || {}).leagues || [];
  return ((list[0] || {}).teams || []).map((x) => x.team).filter(Boolean)
    .map((t) => ({ id: String(t.id), code: t.abbreviation }));
}

/* A player's current injury from ESPN's roster entry, or null when he is
   healthy. ESPN carries `injuries` on each athlete: the newest first, with a
   status ("Out", "Day-To-Day", …) and, usually, details (type, location,
   expected return). Kept small — it rides every page load in `nbaplayers`. */
export function injuryFrom(a) {
  const i = (a && Array.isArray(a.injuries) && a.injuries[0]) || null;
  if (!i) return null;
  const s = String(i.status || (i.type && (i.type.description || i.type.name)) || "").trim();
  if (!s || /^active$/i.test(s)) return null;
  const d = i.details || {};
  const what = [d.type, d.location && d.location !== d.type ? d.location : "", d.detail]
    .filter(Boolean).join(" ").trim() || String(i.shortComment || "").trim();
  const out = { s: s.slice(0, 30) };
  if (what) out.d = what.slice(0, 80);
  if (d.returnDate) out.r = String(d.returnDate).slice(0, 10);
  if (i.date) out.at = String(i.date).slice(0, 10);
  return out;
}

export function rosterFrom(json, code) {
  const out = {};
  for (const a of (json && json.athletes) || []) {
    if (!a || !a.id) continue;
    out[String(a.id)] = { n: a.displayName || a.fullName || "", t: code,
      pos: (a.position && a.position.abbreviation) || "" };
    const inj = injuryFrom(a);
    if (inj) out[String(a.id)].inj = inj;
  }
  return out;
}

/* Fantasy position eligibility: ESPN's own fantasy game's player list, public and
   keyless. `eligibleSlots` are ESPN's lineup-slot ids; only the single-position
   ones are read (0 PG, 1 SG, 2 SF, 3 PF, 4 C, 5 G, 6 F) — the combo slots
   (7 SG/SF, 8 G/F, 9 PF/C, 10 F/C) would make a pure centre forward-eligible
   through "F/C". The season is the year it ENDS: 2026-27 is 2027. */
export const FANTASY = (yr) =>
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${yr}/players?view=players_wl`;
export const fantasyYear = (d = new Date()) => d.getUTCFullYear() + (d.getUTCMonth() >= 7 ? 1 : 0);
export function familyOf(slots) {
  const s = new Set(slots || []), out = [];
  if ([0, 1, 5].some((x) => s.has(x))) out.push("G");
  if ([2, 3, 6].some((x) => s.has(x))) out.push("F");
  if (s.has(4)) out.push("C");
  return out.join(", ");
}
/* Fantasy player list -> { <espnId>: "G, F" }. The ids are ESPN's athlete ids,
   the same ones the team rosters carry. */
export function eligFrom(list) {
  const out = {};
  for (const p of Array.isArray(list) ? list : []) {
    const f = p && familyOf(p.eligibleSlots);
    if (f && p.id != null) out[String(p.id)] = f;
  }
  return out;
}

const HEAD = { "user-agent": "Mozilla/5.0 (compatible; LeagueLedger/1.0)", accept: "application/json" };
async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: HEAD, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${url.split("?")[0]}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

/* Every club's roster, fetched together. All 30 or nothing: a refresh that lost
   a club would quietly drop its players back to the stale table. */
export async function fetchPlayers() {
  const teams = teamsFrom(await getJSON(TEAMS));
  if (teams.length < 30) throw new Error(`ESPN listed ${teams.length} clubs, expected 30`);
  const rosters = await Promise.all(teams.map(async (t) =>
    rosterFrom(await getJSON(`${TEAMS}/${t.id}/roster`), t.code)));
  const players = Object.assign({}, ...rosters);
  /* Positions are a bonus: a fantasy API failure keeps the clubs and leaves
     `el` off, and freshPlayers() keeps the last good positions. */
  let elig = null;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(FANTASY(fantasyYear()), { signal: ctl.signal,
        headers: { ...HEAD, "x-fantasy-filter": JSON.stringify({ players: { limit: 5000 } }) } });
      if (r.ok) elig = eligFrom(await r.json());
    } finally { clearTimeout(timer); }
  } catch { elig = null; }
  if (elig && Object.keys(elig).length > 200) {
    for (const [id, p] of Object.entries(players)) { if (elig[id]) p.el = elig[id]; }
  } else {
    elig = null;
  }
  return { at: Date.now(), teams: teams.length, players, positions: !!elig };
}

/* Refresh `nbaplayers` if it is older than `maxAge`, else return what is stored. */
export async function freshPlayers(s, maxAge) {
  let have = null;
  try { const raw = await s.get("nbaplayers"); have = raw ? JSON.parse(raw) : null; } catch { have = null; }
  if (have && Date.now() - (have.at || 0) < maxAge) return { ...have, cached: true };
  try {
    const got = await fetchPlayers();
    /* ESPN's fantasy list failed this time: carry the last positions over. */
    if (!got.positions && have && have.players) {
      for (const [id, p] of Object.entries(got.players)) {
        const old = have.players[id];
        if (old && old.el) p.el = old.el;
      }
    }
    await s.set("nbaplayers", JSON.stringify(got));
    return { ...got, cached: false };
  } catch (e) {
    if (have) return { ...have, cached: true, stale: true, error: String((e && e.message) || e) };
    throw e;
  }
}
