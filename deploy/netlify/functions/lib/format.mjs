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

/* Roster moves the league recorded on one calendar day in the league's zone —
   signings, releases and trades, the same rule as the Transactions page. Edits
   are left out: in season every lineup change is an edit, and a digest listing
   "Giddey started at G" forty times a day is not a digest. */
const ROSTERMOVE = new Set(["sign", "cut", "trade"]);
/* A nomination is logged as kind "sign" but signs nobody. */
const isMove = (e) => e && e.ts && ROSTERMOVE.has(e.kind) && !/^Nominated /.test(e.detail || "");
export function movesOn(log, zone, day) {
  return (log || []).filter((e) => isMove(e) && dayIn(zone, new Date(e.ts)) === day);
}
/* The same over a run of days, from and to inclusive. */
export function movesBetween(log, zone, from, to) {
  return (log || []).filter((e) => { if (!isMove(e)) return false;
    const d = dayIn(zone, new Date(e.ts)); return d >= from && d <= to; });
}
/* Is the league date a Monday? Noon UTC, so no zone or clock change moves it. */
export const isMonday = (day) => new Date(day + "T12:00:00Z").getUTCDay() === 1;
export const dayPlus = (day, n) => { const t = new Date(day + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

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

/* ---------------- the digests ----------------
   Both are about how the season is going, not the cap. lib/digest.mjs gathers
   the data; these only lay it out, so they are pure and testable. */
export const ord = (n) => { const v = n % 100;
  return n + ((v >= 11 && v <= 13) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"); };
const CAT = { "FG%": "FG%", "FT%": "FT%", P3: "threes", REB: "rebounds", AST: "assists",
  STL: "steals", BLK: "blocks", TO: "turnovers", PTS: "points" };
const ONE = { P3: "three", REB: "rebound", AST: "assist", STL: "steal", BLK: "block", TO: "turnover", PTS: "point" };
const num = (v) => (Math.round(v * 10) / 10).toString();
/* A gap in its own units: percentage points for a rate, a count otherwise. */
export const gapText = (k, g) => (k === "FG%" || k === "FT%")
  ? `${(g * 100).toFixed(1)} pts of ${k}` : `${Math.round(g)} ${Math.round(g) === 1 ? ONE[k] || k : CAT[k] || k}`;
const H = (t) => `<p style="margin:22px 0 4px;font:700 11px/1 ui-monospace,monospace;letter-spacing:.14em;
  text-transform:uppercase;color:#7d8590">${esc(t)}</p>`;
const P = (t, c) => `<p style="margin:0 0 6px;color:${c || "#c3c7cf"}">${t}</p>`;
const td = (v, l) => `<td style="padding:4px 6px;text-align:${l ? "left" : "right"};border-bottom:1px solid #2b3038;
  font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c3c7cf">${v}</td>`;
const th = (v, l) => `<th style="padding:4px 6px;text-align:${l ? "left" : "right"};font:700 10px/1 ui-monospace,monospace;
  letter-spacing:.08em;color:#7d8590;border-bottom:1px solid #2b3038">${v}</th>`;
const table = (head, rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="border-collapse:collapse"><tr>${head}</tr>${rows}</table>`;

/* "3rd of 9 (up from 4th) · 54.5 roto points · 2.5 behind Osborn". */
export function headline(st) {
  if (!st) return "";
  const move = st.rankWas && st.rankWas !== st.rank
    ? (st.rankWas > st.rank ? ` (up from ${ord(st.rankWas)})` : ` (down from ${ord(st.rankWas)})`) : "";
  const chase = st.above ? ` &middot; ${num(st.above.gap)} behind ${esc(st.above.club)} for ${ord(st.rank - 1)}`
    : st.below ? ` &middot; ${num(st.below.gap)} clear of ${esc(st.below.club)}` : "";
  return `<b style="color:#e8e6e1">${ord(st.rank)} of ${st.of}</b>${move} &middot; ${num(st.pts)} roto points${chase}`;
}

const lineRow = (x) => { const s = x.s || {};
  return `<tr>${td(esc(x.n), 1)}${td(s.PTS || 0)}${td(s.TRB || 0)}${td(s.AST || 0)}${td(s.P3 || 0)}${td(s.STL || 0)}${td(s.BLK || 0)}${td(s.TOV || 0)}${td(`${s.FG || 0}-${s.FGA || 0}`)}</tr>`; };
const lineHead = th("PLAYER", 1) + th("PTS") + th("REB") + th("AST") + th("3P") + th("STL") + th("BLK") + th("TO") + th("FG");

export function lastNightBlock(last) {
  if (!last) return P("No league games were scored for yesterday.", "#7d8590");
  const t = last.totals || {};
  const out = [];
  out.push(P(`${t.GP || 0} game${t.GP === 1 ? "" : "s"} counted &middot; ${last.gpAfter} / ${last.cap} used`));
  out.push(last.counted.length ? table(lineHead, last.counted.map(lineRow).join("")
    + `<tr>${td("<b>Counted</b>", 1)}${td(t.PTS || 0)}${td(t.REB || 0)}${td(t.AST || 0)}${td(t.P3 || 0)}${td(t.STL || 0)}${td(t.BLK || 0)}${td(t.TO || 0)}${td(`${t.FG || 0}-${t.FGA || 0}`)}</tr>`)
    : P("Nobody in your lineup played.", "#7d8590"));
  if (last.benchPts) out.push(P(`<b>${last.benchPts} points left on your bench</b>: `
    + last.bench.map((p) => `${esc(p.n)} ${p.s.PTS || 0}`).join(", "), "#c8922e"));
  if (last.over && last.over.length) out.push(P(`Over the game cap, so not counted: ${last.over.map((x) => esc(x.n)).join(", ")}`, "#d9614a"));
  if (last.reused && last.reused.length) out.push(P(`In a slot already used that night: ${last.reused.map((x) => esc(x.n)).join(", ")}`, "#d9614a"));
  return out.join("");
}

export function tonightBlock(t) {
  if (!t) return "";
  if (!t.games) return P("No NBA games tonight.", "#7d8590");
  const out = [P(`${t.playing.length} of your starters play tonight.`)];
  if (t.idle.length) out.push(P(`<b>Starting with no game tonight:</b> ${t.idle.map(esc).join(", ")}`, "#c8922e"));
  if (t.empty) out.push(P(`<b>${t.empty} empty slot${t.empty === 1 ? "" : "s"}</b> in your lineup.`, "#c8922e"));
  if (t.benchPlaying.length && (t.idle.length || t.empty))
    out.push(P(`On your bench with a game: ${t.benchPlaying.map(esc).join(", ")}`));
  return out.join("");
}

/* The daily: a thirty-second read. Where you stand, what last night did, what
   tonight needs, and the league's moves. */
export function dailyBody(d, moves, zone) {
  return `${P(esc(d.club), "#7d8590")}
    ${d.standing ? `<p style="margin:0 0 4px;font-size:15px">${headline(d.standing)}</p>` : ""}
    ${d.live || d.last ? H("Last night") + lastNightBlock(d.last) : ""}
    ${d.tonight ? H("Tonight") + tonightBlock(d.tonight) : ""}
    ${H("League moves")}
    ${movesTable(moves, zone)}`;
}

/* The weekly: the race, where the points are close, who has what you need,
   whether you are on pace against the cap, and how many pickups you can still
   afford. Built to start conversations, not to tell anyone what to trade. */
export function weeklyBody(w, moves, zone) {
  const out = [P(esc(w.club), "#7d8590")];
  if (w.tweets && w.tweets.length) out.push(tweetsBlock(w.tweets));
  if (w.standing) out.push(`<p style="margin:0 0 4px;font-size:15px">${headline(w.standing)}</p>`);
  if (w.weekRank) out.push(P(`This week alone: ${ord(w.weekRank)} of ${w.table.length}, ${num(w.weekPts)} roto points over ${w.nights} night${w.nights === 1 ? "" : "s"}.`));

  out.push(H("The race"));
  out.push(table(th("#", 1) + th("CLUB", 1) + th("ROTO") + th("WEEK") + th("GAMES"),
    w.table.map((r) => `<tr>${td(r.rank, 1)}${td(esc(r.club) + (r.gm ? ` <span style="color:#7d8590">${esc(r.gm)}</span>` : ""), 1)}${td(num(r.pts))}${td(r.move > 0 ? `<span style="color:#55a67a">&uarr;${r.move}</span>` : r.move < 0 ? `<span style="color:#d9614a">&darr;${-r.move}</span>` : "&ndash;")}${td(r.gp)}</tr>`).join("")));

  if (w.gains.length || w.risks.length) {
    out.push(H("Where the points are close"));
    w.gains.forEach((g) => out.push(P(`<span style="color:#55a67a">+1 within reach:</span> ${gapText(g.k, g.gap)} behind ${esc(g.club)}`)));
    w.risks.forEach((g) => out.push(P(`<span style="color:#d9614a">&minus;1 at risk:</span> only ${gapText(g.k, g.gap)} ahead of ${esc(g.club)}`)));
  }
  if (w.surplus.length) out.push(P(`Comfortably clear in ${w.surplus.map((k) => CAT[k] || k).join(", ")}: you could trade some of that away without losing a point.`, "#7d8590"));

  if (w.angles.length) {
    out.push(H("Who has what you need"));
    w.angles.forEach((a) => out.push(P(`<b>${esc(CAT[a.k] || a.k)}:</b> ${a.clubs.map((c) => esc(c.gm ? `${c.gm} (${c.club})` : c.club)).join(", ")} ha${a.clubs.length === 1 ? "s" : "ve"} more than they need.`)));
  }

  if (w.pace || w.pickups) {
    out.push(H("Games and pickups"));
    if (w.pace) {
      const over = w.pace.projected - w.pace.cap;
      out.push(P(`${w.pace.used} of ${w.pace.cap} games used; about ${w.pace.expected} would be on schedule. `
        + (over > 0 ? `<b style="color:#d9614a">On pace for about ${w.pace.projected}: roughly ${over} games will go to waste.</b> Start fewer low-value players.`
          : over < -10 ? `<b style="color:#c8922e">On pace for about ${w.pace.projected}: roughly ${-over} games unused.</b> Fill your slots.`
          : `On pace for about ${w.pace.projected}.`)));
    }
    if (w.pickups) out.push(P(`You can afford <b>${w.pickups.left} more minimum pickup${w.pickups.left === 1 ? "" : "s"}</b> this season `
      + `(${w.pickups.spots} roster spot${w.pickups.spots === 1 ? "" : "s"} open, room under the hard cap for ${w.pickups.money}).`));
  }

  const perf = (x) => { const s = x.s || {};
    return `${esc(x.n)}${x.club && x.club !== w.club ? ` <span style="color:#7d8590">(${esc(x.club)})</span>` : ""}: `
      + `${s.PTS || 0} pts, ${s.TRB || 0} reb, ${s.AST || 0} ast in ${x.g} game${x.g === 1 ? "" : "s"}`; };
  if (w.best.length || w.leagueTop.length) {
    out.push(H("Performers"));
    w.best.forEach((x) => out.push(P(`<span style="color:#55a67a">Yours:</span> ${perf(x)}`)));
    w.worst.forEach((x) => out.push(P(`<span style="color:#7d8590">Quietest:</span> ${perf(x)}`)));
    w.leagueTop.forEach((x) => out.push(P(`<span style="color:#c8922e">League:</span> ${perf(x)}`)));
  }
  out.push(H("The week's moves"));
  out.push(movesTable(moves, zone));
  return out.join("");
}

/* The parody tweets, as cards. "(parody)" is in the handle and the header,
   so a forwarded email cannot be mistaken for the real thing. */
export function tweetsBlock(tweets) {
  return `<p style="margin:0 0 6px;font:700 11px/1 ui-monospace,monospace;letter-spacing:.14em;
    text-transform:uppercase;color:#7d8590">Around the league &middot; parody accounts</p>`
    + tweets.map((t) => `<div style="border:1px solid #2b3038;border-radius:8px;padding:10px 12px;margin:0 0 8px">
      <div style="font:600 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e8e6e1">${esc(t.author)}
        <span style="font-weight:400;color:#7d8590">${esc(t.handle)} &middot; parody</span></div>
      <div style="margin-top:4px;color:#e8e6e1">${esc(t.text)}</div></div>`).join("")
    + `<div style="height:8px"></div>`;
}

/* Kept so older callers and tests keep working: the daily with only last night. */
export function statsBlock(stats) { return lastNightBlock(stats); }
