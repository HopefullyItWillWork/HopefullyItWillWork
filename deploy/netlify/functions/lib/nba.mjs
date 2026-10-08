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

export function rosterFrom(json, code) {
  const out = {};
  for (const a of (json && json.athletes) || []) {
    if (!a || !a.id) continue;
    out[String(a.id)] = { n: a.displayName || a.fullName || "", t: code,
      pos: (a.position && a.position.abbreviation) || "" };
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
  return { at: Date.now(), teams: teams.length, players };
}

/* Refresh `nbaplayers` if it is older than `maxAge`, else return what is stored. */
export async function freshPlayers(s, maxAge) {
  let have = null;
  try { const raw = await s.get("nbaplayers"); have = raw ? JSON.parse(raw) : null; } catch { have = null; }
  if (have && Date.now() - (have.at || 0) < maxAge) return { ...have, cached: true };
  try {
    const got = await fetchPlayers();
    await s.set("nbaplayers", JSON.stringify(got));
    return { ...got, cached: false };
  } catch (e) {
    if (have) return { ...have, cached: true, stale: true, error: String((e && e.message) || e) };
    throw e;
  }
}
