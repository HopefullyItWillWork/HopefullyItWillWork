/* The league assistant's pure half — provider configuration, the system prompt
   and the request/response shaping.

   It imports NOTHING, exactly like lib/format.mjs and for the same reason: all
   of this is testable under plain node with no Netlify runtime and no
   @netlify/blobs installed. The blob-backed spend ceiling lives in the endpoint
   beside it, because that is the only part that needs a store.

   Every provider worth using speaks the OpenAI /chat/completions shape — Groq,
   Google's OpenAI-compatible endpoint, OpenRouter, DeepSeek, Anthropic's compat
   layer — so the base URL, the model and the key are configuration rather than
   code. Changing provider is three environment variables in Netlify and a
   redeploy; nothing in this file or the app has to be edited.

     AI_API_KEY    required. Nothing is sent without it.
     AI_BASE_URL   optional, defaults to Groq's free tier.
     AI_MODEL      optional, defaults to a model on that tier — see AIDEF below
                   on why that default has a shelf life.
     AI_DAILY_CAP  optional. See the note on AIDEF.cap below — the default is
                   sized to the free tier's TOKEN ceiling, not picked for
                   comfort, and it has to move when the model does.
     AI_MAX_TOKENS optional, defaults to 700 — long enough for a real answer,
                   short enough that a runaway costs a paragraph and not a book.

   With no key configured every call returns {ok:false, reason:"not configured"}
   and the caller carries on, which is the same deliberate default the mail
   functions take: a fresh deploy answers nobody until someone sets the key. */

/* A DEFAULT MODEL NAME GOES STALE, and this one already did once: the first
   version of this file defaulted to llama-3.3-70b-versatile, which Groq
   decommissioned for free-tier accounts on 2026-08-16. The endpoint answers a
   retired name with a 404, which is why askAI() says so in as many words rather
   than passing the bare status on — "model 404" sent the first person who hit
   it to go and read this file.

   So the name below is a default, not a fact about the world. When it stops
   working, check the provider's deprecation page, set AI_MODEL to whatever it
   names as the migration, and move this line to match. Nothing else changes.

   The cap is arithmetic, and it moves with TWO things rather than one: the
   model's token budget and the size of aiContext(). A question costs the static
   prompt (~890 tokens) plus the context (~2,825 on this league, once every
   club's roster and the impact blocks are in it) plus the answer (up to 700):
   about 5,200 on a first question, nearer 6,000 once a few turns of history
   ride along. This model's free tier allows 200,000 tokens a DAY, which is a
   little over thirty of those — and that token ceiling binds long before the
   requests-a-day limit does, so counting requests only ever approximates the
   thing that actually runs out.

   30 therefore keeps this ceiling biting before the provider's, which is the
   whole point of having one: a runaway fails here as a soft {ok:false} the app
   already handles, rather than as a rejection from the model. Recompute it when
   the model's allowance changes OR when aiContext() grows — it has trebled
   once already, and every block added to it moves this number down. */
export const AIDEF = {
  base: "https://api.groq.com/openai/v1",
  model: "openai/gpt-oss-120b",
  cap: 30,
  maxTokens: 700,
};

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const aiConfigured = () => !!process.env.AI_API_KEY;
export const aiBase = () => String(process.env.AI_BASE_URL || AIDEF.base).replace(/\/+$/, "");
export const aiModel = () => String(process.env.AI_MODEL || AIDEF.model);
export const aiCap = () => num(process.env.AI_DAILY_CAP, AIDEF.cap);
export const aiMaxTokens = () => num(process.env.AI_MAX_TOKENS, AIDEF.maxTokens);
export const askUrl = () => aiBase() + "/chat/completions";

/* What the endpoint will accept. The context is built by the app, not here —
   see aiContext() in index.html — because every cap rule in this league is
   already implemented there and a second implementation on the server would be
   a second set of answers to keep in step. These are the ceilings that stop a
   caller turning one request into a large bill. */
export const CTXMAX = 24000;   // characters of league context
export const ASKMAX = 2000;    // characters in any one message
export const TURNS = 8;        // how much of the conversation goes back

/* The league's identity and the rules that are easy to get wrong. Level one of
   the customisation: everything here is true of this league whatever today's
   rosters look like, so it is static text. What changes daily arrives as the
   context block instead. */
export const SYSTEM = `You are the assistant for a nine-team NBA fantasy dynasty league, built into its
contract and cap ledger. You answer a general manager's questions about his own club, the
league's rules, and what a move would cost him.

How this league works. Read these carefully — several are unusual and getting one wrong
gives a GM advice that will be refused by the ledger when he tries to act on it.

- The salary cap is SOFT. A club may exceed it only through Bird rights, Early Bird rights,
  the mid-level exception, or minimum contracts.
- The luxury tax figure is a HARD cap. Nothing beats it — not Bird rights, not the
  exception, not anything. If a move would cross it, the answer is no.
- Bird rights are EARNED, not written down: three completed seasons with one club. They let
  the club exceed the soft cap to re-sign its own player, and they travel with him in a
  trade. Any other change of club starts the clock again.
- Early Bird is a mid-season signing made before the trade deadline who finished the year on
  the roster. It is worth a fixed amount over the cap and has nothing to do with three years.
- RIGHTS APPLY AT THE AUCTION, and this is the single thing most easily got backwards. A
  club's own expiring player goes into the auction like anybody else, and the club holding
  Bird rights on him may bid all the way to the hard cap for him — the soft cap does not
  bind a club re-signing its own. Early Bird works the same way for a smaller amount. So a
  club with little cap room can still outbid the room for a man it already holds. The right
  is specific to that player and does nothing on any other lot. When the context gives a
  club's own free agents and a ceiling for each, those ceilings are the app's and are already
  correct — quote them, and never tell a GM that rights do not apply to bidding.
- The mid-level exception is a LANE, not a top-up. A club signs a player out of its cap room
  OR out of the exception, never out of both added together: a club twenty dollars under the
  cap cannot pay twenty-five and a half by adding the exception to its room. The exception
  caps that one contract, may be spent above the salary cap, is a pot that splits across as
  many players as it covers, and a signing made on it runs two seasons.
- A contract is money owed against a NAMED season. A season with nothing owed is simply
  absent, so a player owed nothing next season is a free agent this offseason even though he
  is sitting on a roster today. Treat him as available.
- The league caps each club at 920 total player-games a season. This matters more than it
  looks: past the cap the marginal games are discarded, so a player's per-game rate is worth
  far more than his availability.
- A club that releases a player above the minimum cannot sign him back for the rest of that
  season and the following offseason. No other club is restricted — a released player is
  freely available to the other eight.
- In the offseason a club adds players by winning them at auction or drafting them, not by
  signing free agents directly. In season a GM signs from the free agent list, one year at
  the minimum, with Early Bird rights before the deadline and no rights after it.
- Salary matching on trades is a switch the commissioner sets and is off by default. With it
  off a trade needs only the hard cap and the roster limit.
- The roster limit counts ACTIVE players. The injured reserve is separate, and there is no
  injured reserve in the offseason.

How to answer.

- The LEAGUE CONTEXT block below is the live ledger, generated from the league database this
  minute. Prefer it over anything you think you remember. If it does not contain what the
  question needs, say so plainly rather than guessing a number.
- Never invent a salary, a contract year, a cap figure or a rating. A wrong number here gets
  acted on.
- Money is written like $5.25. Bids move in quarters.
- Be brief and concrete. A GM asking what he can afford wants the figure and the one sentence
  saying which wall it is, not an essay.
- You are advisory. You cannot make a bid, a trade, a signing or any other change — the GM
  does that in the app. Say so if you are asked to act.
- The commissioner is the referee for anything ambiguous, and the rulebook beats you.`;

/* The conversation that goes back to the provider: the most recent turns, each
   clamped, roles narrowed to the two the app ever sends. Pure. */
export function clampTurns(list, turns = TURNS, max = ASKMAX) {
  const arr = Array.isArray(list) ? list : [];
  return arr
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content).trim().slice(0, max),
    }))
    .slice(-Math.max(1, turns));
}

/* The request body. The league context rides as its own system message rather
   than being glued onto SYSTEM, so a provider that caches the static prompt can
   still do so while the volatile half changes every question. Pure. */
export function chatBody({ context, messages, model, maxTokens } = {}) {
  const ctx = String(context || "").slice(0, CTXMAX).trim();
  return {
    model: model || aiModel(),
    max_tokens: maxTokens || aiMaxTokens(),
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      ...(ctx ? [{ role: "system", content: "LEAGUE CONTEXT — the live ledger:\n\n" + ctx }] : []),
      ...clampTurns(messages),
    ],
  };
}

/* Providers agree on the shape and disagree at the edges — a reasoning model
   returns its answer beside a `reasoning` field, and an empty choices array is
   what a content filter looks like. Pure. */
export function replyOf(j) {
  const c = j && Array.isArray(j.choices) ? j.choices[0] : null;
  const m = c && c.message;
  const text = m && typeof m.content === "string" ? m.content.trim() : "";
  if (text) return { ok: true, reply: text, finish: (c && c.finish_reason) || "" };
  if (c && c.finish_reason === "length") return { ok: false, reason: "the answer was cut off — ask something narrower" };
  return { ok: false, reason: "the model returned nothing" };
}

/* The one call out. Every failure comes back soft, exactly as sendMail() does:
   the app shows the reason and carries on, and no path assumes this works. */
export async function askAI({ context, messages }) {
  if (!aiConfigured()) return { ok: false, reason: "not configured" };
  try {
    const r = await fetch(askUrl(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.AI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(chatBody({ context, messages })),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      if (r.status === 429) return { ok: false, reason: "the model is rate limited — try again in a minute", detail };
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "the model rejected the key", detail };
      /* A 404 from a /chat/completions endpoint is almost never a missing URL —
         it is the model name, and on a provider that retires models it is the
         failure this app is most likely to meet twice. Saying which name was
         asked for is the difference between a one-variable fix and an
         afternoon: the reason names it, so the screen does too. */
      if (r.status === 404) return { ok: false, detail,
        reason: `no model called "${aiModel()}" — it may have been retired. Set AI_MODEL to one the provider still serves.` };
      return { ok: false, reason: `model ${r.status}`, detail };
    }
    const out = replyOf(await r.json());
    return out.ok ? { ...out, model: aiModel() } : out;
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}
