/* The weekly digest's "around the league" tweets: one or two short, playful
   posts in the voice of NBA writers about the week in this league — the
   biggest trade or signing if there was one, and otherwise (or as well) the
   race: who leads, who climbed or slid, who had the best week, whose players
   went off. A week with no transactions still has a story. Fiction for a private nine-person league; the league asked for
   them unlabelled (2026-10-09), so the email shows only the writer's name.
   Ten voices (VOICES); each week the model picks one or two that suit the story. Written by Claude once a week, inside the Monday
   digest run — nobody has to remember anything.

   Everything here is optional and fails soft. No ANTHROPIC_API_KEY, an API
   error, a refusal, or output that does not parse, and the weekly simply goes
   out without tweets. The result is cached under `tweets-<monday>` so the nine
   weekly emails share one request and a re-run never pays twice.

   The prompt keeps them to this league's own signings and trades — never
   real-world NBA news, never anyone's personal life. */

import Anthropic from "@anthropic-ai/sdk";

/* Who may "post". The style notes keep the voices distinct; nothing here claims
   to be a real quote. */
export const VOICES = [
  { name: "Zach Lowe", style: "measured, detail-obsessed, loves a weird contract nuance, ends with a wry aside" },
  { name: "Bill Simmons", style: "hot takes, pop-culture comparisons, all-caps excitement, invents a 'rule' named after himself" },
  { name: "Nate Duncan", style: "cap-sheet nerd, talks in percentages and contract math, dry" },
  { name: "John Hollinger", style: "analytical, cites a made-up efficiency metric, gently skeptical" },
  { name: "Kevin O'Connor", style: "upside-obsessed, talks about a player's tools and 'my guy', ranks things in tiers" },
  { name: "Brian Windhorst", style: "connects dots nobody asked him to, 'something is going on here', hints at what is coming next" },
  { name: "Shams Charania", style: "breaking-news format starting 'Sources:', terse, gives the exact terms of this league's move" },
  { name: "Kevin Pelton", style: "careful projections, a made-up win-shares-style number, measured conclusions" },
  { name: "Tim Legler", style: "former player, straight-shooting, loves shooters and fit, tells it like it is" },
  { name: "Ethan Sherwood Strauss", style: "contrarian, sees the bigger story behind the move, wry and a little philosophical" },
];

/* The week's biggest moves, as plain lines for the prompt: every trade, then
   the dearest signings. A nomination is logged as a signing but signs nobody. */
export function biggestMoves(moves, n = 4) {
  const money = (d) => { const m = /\$(\d+(?:\.\d+)?)/.exec(d || ""); return m ? parseFloat(m[1]) : 0; };
  const real = (moves || []).filter((e) => e && !/^Nominated /.test(e.detail || "") && !/may match$/.test(e.detail || ""));
  const trades = real.filter((e) => e.kind === "trade" && /EXECUTED/.test(e.detail || ""));
  const signs = real.filter((e) => e.kind === "sign").sort((a, b) => money(b.detail) - money(a.detail));
  return [...trades, ...signs].slice(0, n).map((e) => `${e.kind === "trade" ? "Trade" : "Signing"} (${e.team || ""}): ${e.detail}`);
}

/* Pull the JSON array out of the reply and keep only well-formed posts. */
export function parseTweets(text) {
  const s = String(text || ""), a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return null;
  let arr;
  try { arr = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const out = arr.map((t) => {
    const v = VOICES.find((x) => t && x.name === t.author);
    const body = t && typeof t.text === "string" ? t.text.trim() : "";
    return v && body && body.length <= 280 ? { author: v.name, text: body } : null;
  }).filter(Boolean);
  return out.length ? out.slice(0, 2) : null;
}

const SYSTEM = `You write short, playful tweets for a private fantasy basketball league's weekly newsletter.
The league is a nine-team NBA dynasty league with salary caps, an auction and trades. Each post is in the
voice of a well-known NBA writer, reacting to what happened in THIS fantasy league that week: a move, the
standings race, a club's great or terrible week, or a player who carried someone.

Rules:
- Every post is playful and about this fantasy league only: its clubs, managers, players, prices and
  standings. Do not invent real-world NBA news, injuries, quotes or events.
- Be funny, specific and a little provocative about the move: an overpay, a steal, a bold trade. Nothing
  mean-spirited about anyone personally.
- At most 260 characters per post. No hashtags. At most one emoji per post.
- Write one or two posts, each by a different author from the list given.
- Reply with ONLY a JSON array, no other text: [{"author": "<name from the list>", "text": "<post>"}]`;

/* What the week gave the writers to work with, as prompt text. `ctx` is the
   weekly digest's own data: the season table with movement, the week's own
   table, and the league's top performers. Pure, so it can be tested. Returns ""
   when there is nothing at all — no moves and no scored games. */
export function weekStory(moves, ctx) {
  const c = Array.isArray(ctx) ? { table: ctx } : (ctx || {});
  const who = (r) => `${r.club}${r.gm ? ` (${r.gm})` : ""}`;
  const parts = [];
  const lines = biggestMoves(moves);
  if (lines.length) parts.push(`This week's biggest moves:\n${lines.join("\n")}`);
  const table = (c.table || []).filter((r) => r.gp > 0 || r.pts > 0);
  if (table.length) parts.push(`Season standings (roto points; change in place this week):\n` + table.map((r) =>
    `${r.rank}. ${who(r)}, ${r.pts} pts${r.move > 0 ? `, up ${r.move}` : r.move < 0 ? `, down ${-r.move}` : ""}`).join("\n"));
  const week = c.weekTable || [];
  if (week.length) parts.push(`Best weeks (this week's games only): ` + week.slice(0, 3).map((r) => `${who(r)} ${r.pts}`).join("; ")
    + `. Worst: ${who(week[week.length - 1])} ${week[week.length - 1].pts}.`);
  const top = c.leagueTop || [];
  if (top.length) parts.push(`Standout player weeks: ` + top.map((x) =>
    `${x.n} for ${x.club}: ${x.s.PTS || 0} pts, ${x.s.TRB || 0} reb, ${x.s.AST || 0} ast in ${x.g} games`).join("; "));
  return parts.join("\n\n");
}

export async function weeklyTweets(s, from, moves, ctx) {
  const key = "tweets-" + from;
  try {
    const raw = await s.get(key);
    if (raw) return JSON.parse(raw).tweets || null;
  } catch { /* fall through and try to write them */ }
  const story = weekStory(moves, ctx);
  if (!story || !process.env.ANTHROPIC_API_KEY) return null;

  const prompt = `Authors you may use:\n${VOICES.map((v) => `- ${v.name}: ${v.style}`).join("\n")}\n\n`
    + `${story}\n\n`
    + `Write one or two posts about the most interesting thing here: a big trade or signing if there was `
    + `one, otherwise the race — the leader, a big climb or slide, the best or worst week, a player who went off.`;

  let tweets = null;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason !== "refusal") {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      tweets = parseTweets(text);
    }
  } catch (error) {
    /* Soft by design: an API problem costs the tweets, never the weekly. */
    if (error instanceof Anthropic.APIError) console.error(`tweets: API error ${error.status}: ${error.message}`);
    else console.error("tweets:", error && error.message);
    tweets = null;
  }
  /* Cache even an empty result for the week, so a failing key is not retried
     nine times in one run — but only when there were moves to write about. */
  try { await s.set(key, JSON.stringify({ at: new Date().toISOString(), tweets })); } catch { /* ignore */ }
  return tweets;
}
