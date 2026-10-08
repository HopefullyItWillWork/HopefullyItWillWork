/* Lineup history: who was in which slot, and since when, stamped by the
   server's clock.

   The page keeps only a club's CURRENT lineup (`S.teams[t].lu`, in rosters), and
   it carries forward until the GM changes it. Scoring cannot use that: by the
   morning the job runs, a GM may already have reset his lineup for tonight. So
   every save is also recorded here, and scoring asks "what was this club's
   lineup at the moment this player's game tipped off?" — the last entry
   before the tip.

   Append-only by construction: every save is its own blob,

     luh/<league date>/<club>/<server ISO time>-<random>

   so two saves can never overwrite each other and nothing is ever edited.
   The time in the key and in the body is the SERVER's, never the browser's — a
   GM's clock cannot make a late change look early.

   A lineup nobody touches still has to count, so the nightly job writes a
   `carry` entry each morning for every club that has a lineup: a copy of the
   current one, before any game that day. Scoring therefore never has to walk
   back through earlier days. */

export const SLOTS = ["C", "G1", "G2", "G3", "G4", "F1", "F2", "F3", "F4",
  "U1", "U2", "U3", "U4", "U5", "U6"];

export const dayIn = (tz, at = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const clubSeg = (club) => encodeURIComponent(club);

/* Only known slots, only strings, nothing absurd. Anything else is dropped, so
   a malformed save records an empty slot rather than junk. */
export function cleanSlots(s) {
  const out = {};
  for (const id of SLOTS) {
    const v = s && s[id];
    out[id] = typeof v === "string" ? v.slice(0, 80) : "";
  }
  return out;
}

export async function recordLineup(store, tz, { club, s, by, src }) {
  const at = new Date();
  const day = dayIn(tz, at);
  const iso = at.toISOString();
  const key = `luh/${day}/${clubSeg(club)}/${iso}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = { at: iso, day, club, by: by || "", src: src || "save", s: cleanSlots(s) };
  await store.set(key, JSON.stringify(entry));
  return entry;
}

/* Every entry for one league date, grouped by club, oldest first. */
export async function lineupsOn(store, day) {
  const { blobs } = await store.list({ prefix: `luh/${day}/` });
  const entries = await Promise.all(blobs.map(async (b) => {
    try { return JSON.parse(await store.get(b.key)); } catch { return null; }
  }));
  const out = {};
  for (const e of entries.filter(Boolean)) (out[e.club] = out[e.club] || []).push(e);
  for (const c of Object.keys(out)) out[c].sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/* The lineup in force at `when` (ISO): the last entry at or before it. */
export function lineupAt(entries, when) {
  let hit = null;
  for (const e of entries || []) if (e.at <= when) hit = e;
  return hit;
}

/* The morning carry-forward: one entry per club that has a lineup and has
   nothing recorded yet today. Run before any game, so it is always the
   baseline a night's scoring starts from. */
export async function carryLineups(store, tz, teams) {
  const day = dayIn(tz);
  const have = await lineupsOn(store, day);
  const done = [];
  for (const club of Object.keys(teams || {})) {
    const lu = teams[club] && teams[club].lu;
    if (!lu || !lu.s || have[club]) continue;
    await recordLineup(store, tz, { club, s: lu.s, by: "nightly", src: "carry" });
    done.push(club);
  }
  return done;
}
