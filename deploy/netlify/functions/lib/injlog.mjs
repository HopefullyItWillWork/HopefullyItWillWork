/* The injury log (2026-11-18): who ESPN listed as injured, night by night.

   ESPN's report only ever says what is true today, so a game a man missed last
   week could not say why. From the day this shipped, every refresh of
   `nbaplayers` (lib/nba.mjs freshPlayers(): every morning at 15:00 UTC and on
   demand, at most every six hours) folds the report into one blob:

     injlog  { days: { "2026-11-18": { <nameKey>: { s:"Out", t:"LAL" } } } }

   filed under the league night (it rolls at 4 AM league time, like the page's
   luNight() and lib/live.mjs nightAt()). Refreshes during one night MERGE: a man
   listed at any refresh that night stays listed for it, and a later refresh
   updates his status. So a missed game reads as "listed on the injury report
   that day" when he was on it at any point that day. Nights older than
   KEEPDAYS are dropped. Pure and import-free (lib/nba.mjs imports it, so it
   takes nameKey as an argument rather than importing it back). */

export const KEEPDAYS = 400;
const LUROLL = 240;

/* The league night at `now`: the date in `tz`, before 4 AM counting as the day before. */
export function injNight(tz, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  if ((+p.hour) * 60 + (+p.minute) >= LUROLL) return day;
  const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/* Fold one `nbaplayers` copy ({players:{id:{n,t,inj}}}) into the log for `night`. */
export function noteInjuries(log, players, night, nameKey) {
  const out = { days: { ...((log && log.days) || {}) } };
  const day = { ...(out.days[night] || {}) };
  for (const p of Object.values(players || {})) {
    if (!p || !p.n || !p.inj || !p.inj.s) continue;
    day[nameKey(p.n)] = { s: String(p.inj.s).slice(0, 20), t: p.t || "" };
  }
  out.days[night] = day;
  const t = new Date(night + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - KEEPDAYS);
  const cut = t.toISOString().slice(0, 10);
  for (const d of Object.keys(out.days)) if (d < cut) delete out.days[d];
  return out;
}
