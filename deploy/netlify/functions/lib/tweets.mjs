/* The weekly digest's "around the league" tweets: one or two short, playful
   posts in the voice of NBA writers, reacting to the week's biggest moves in
   this league. Fiction for a private nine-person league; the league asked for
   them unlabelled (2026-10-09), so the email shows only the writer's name. Written by Claude once a week, inside the Monday
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
voice of a well-known NBA writer, reacting to a move made by a club in THIS fantasy league that week.

Rules:
- Every post is playful and about the fantasy move only: the club, the manager,
  the player and the price. Do not invent real-world NBA news, injuries, quotes or events.
- Be funny, specific and a little provocative about the move: an overpay, a steal, a bold trade. Nothing
  mean-spirited about anyone personally.
- At most 260 characters per post. No hashtags. At most one emoji per post.
- Write one or two posts, each by a different author from the list given.
- Reply with ONLY a JSON array, no other text: [{"author": "<name from the list>", "text": "<post>"}]`;

export async function weeklyTweets(s, from, moves, standings) {
  const key = "tweets-" + from;
  try {
    const raw = await s.get(key);
    if (raw) return JSON.parse(raw).tweets || null;
  } catch { /* fall through and try to write them */ }
  const lines = biggestMoves(moves);
  if (!lines.length || !process.env.ANTHROPIC_API_KEY) return null;

  const table = (standings || []).slice(0, 9).map((r) => `${r.rank}. ${r.club}${r.gm ? ` (${r.gm})` : ""}, ${r.pts} roto points`).join("\n");
  const prompt = `Authors you may use:\n${VOICES.map((v) => `- ${v.name}: ${v.style}`).join("\n")}\n\n`
    + `This week's biggest moves in the league:\n${lines.join("\n")}\n\n`
    + (table ? `Current standings:\n${table}\n\n` : "")
    + `Write one or two posts reacting to the biggest of these moves.`;

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
