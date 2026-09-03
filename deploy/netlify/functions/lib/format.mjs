/* Pure formatting and date logic for the mail functions.

   Deliberately imports nothing. lib/league.mjs pulls in @netlify/blobs and the
   network, which makes it awkward to test; everything here can be imported
   straight into a test with no Netlify runtime at all — and the date bucketing
   below is the part most worth testing. */

export const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const siteUrl = () =>
  (process.env.SITE_URL || "https://hopefullyitwill.work").replace(/\/+$/, "");

/* The league is American, so "yesterday" means yesterday in the league's zone,
   not in UTC. A move made at 9pm Eastern carries a timestamp after midnight UTC
   and would otherwise be filed under the wrong day and mailed a digest late. */
export function dayIn(zone, date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function timeIn(zone, iso) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return ""; }
}

/* The calendar day before `now` in the league's zone. */
export function yesterdayIn(zone, now = new Date()) {
  return dayIn(zone, new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/* Entries the league recorded on one calendar day in the league's zone. */
export function movesOn(log, zone, day) {
  return (log || []).filter((e) => e && e.ts && dayIn(zone, new Date(e.ts)) === day);
}

export const KINDL = { sign: "Signing", cut: "Release", trade: "Trade", edit: "Edit", bid: "Auction" };

export function prettyDay(day) {
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric",
  });
}

/* A club's line at the top of its own digest. */
export function clubLine(club) {
  const roster = (club && club.r) || [];
  const signed = roster.filter((p) => p.y && p.y[1] != null);
  return {
    payroll: signed.reduce((a, p) => a + p.y[1], 0),
    signed: signed.length,
    expiring: roster.filter((p) => p.y && p.y[1] == null).length,
  };
}

export function movesTable(moves, zone) {
  if (!moves.length)
    return `<p style="margin:4px 0 0;color:#7d8590">Nothing was recorded.</p>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="border-collapse:collapse;margin:4px 0 0">${moves
    .slice()
    .reverse()
    .map(
      (e) => `<tr>
    <td style="padding:7px 0;border-bottom:1px solid #2b3038;font:11px/1.3 ui-monospace,monospace;
      color:#7d8590;white-space:nowrap;vertical-align:top;width:64px">${esc(timeIn(zone, e.ts))}</td>
    <td style="padding:7px 0 7px 10px;border-bottom:1px solid #2b3038;vertical-align:top">
      <span style="font:700 10px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;
        color:#c8922e">${esc(KINDL[e.kind] || e.kind || "Move")}</span>
      <div style="margin-top:3px;color:#e8e6e1">${esc(e.detail || "")}</div>
      <div style="margin-top:2px;font-size:12px;color:#7d8590">${esc(e.team || "")}${
        e.by ? ` &middot; ${esc(e.by)}` : ""}</div>
    </td></tr>`
    )
    .join("")}</table>`;
}

export function wrap(title, bodyHtml, footNote) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#14161a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#14161a">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="max-width:560px;background:#1b1e24;border:1px solid #2b3038;border-radius:3px">
<tr><td style="padding:22px 24px 6px">
  <div style="font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.18em;
    text-transform:uppercase;color:#c8922e">League Ledger</div>
  <h1 style="margin:10px 0 0;font:700 21px/1.25 Georgia,serif;color:#e8e6e1">${esc(title)}</h1>
</td></tr>
<tr><td style="padding:14px 24px 22px;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#c3c7cf">
${bodyHtml}
</td></tr>
<tr><td style="padding:0 24px 22px;border-top:1px solid #2b3038">
  <p style="margin:14px 0 0;font:12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#7d8590">
    <a href="${siteUrl()}" style="color:#c8922e">Open the ledger</a>${footNote ? " &middot; " + footNote : ""}
  </p>
</td></tr>
</table></td></tr></table></body></html>`;
}

/* The digest body for one club. Yesterday's per-game stats are not in here:
   the nightly stats feed CLAUDE.md lists under "Not yet built" does not exist,
   so there is no daily/<date> key to read. The slot is marked so the stats half
   drops in later without redesigning the email. */
export function digestBody(clubName, club, moves, zone) {
  const c = clubLine(club);
  const H = (t) => `<p style="margin:0 0 2px;font:700 11px/1 ui-monospace,monospace;letter-spacing:.14em;
    text-transform:uppercase;color:#7d8590">${esc(t)}</p>`;
  return `${H(clubName)}
    <p style="margin:0 0 18px;color:#e8e6e1">$${c.payroll.toFixed(2)} committed &middot;
      ${c.signed} under contract &middot; ${c.expiring} expiring</p>
    ${H("Transactions")}
    ${movesTable(moves, zone)}
    <p style="margin:22px 0 0"></p>
    ${H("Yesterday's stats")}
    <p style="margin:0;color:#7d8590">Not available yet &mdash; the nightly stats feed is not built.
      When it is, your club's numbers from the night before appear here.</p>`;
}
