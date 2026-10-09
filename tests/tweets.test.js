/* The weekly's parody tweets. The model call itself is not tested here — it
   costs money and its words change — but everything around it is: which moves
   it is shown, and that only well-formed posts by a listed author, under the
   length limit, ever reach an email. Run with the SDK resolvable (node, after
   npm install in deploy/), or in a browser with an import map stub. */
import { biggestMoves, parseTweets, VOICES, weeklyTweets } from '../deploy/netlify/functions/lib/tweets.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

console.log('\n== the moves it is shown ==');
const log = [
  { kind: 'sign', team: 'Brice', detail: 'Kevin Love — $1.00 × 1 yr' },
  { kind: 'sign', team: 'Coulter', detail: 'Won James Harden at $15.25' },
  { kind: 'sign', team: 'Osborn', detail: 'Nominated Someone at $1.00' },
  { kind: 'trade', team: 'A. Daman / Christman', detail: 'TRADE EXECUTED — A. Daman sends Josh Giddey; Christman sends Tyrese Maxey' },
  { kind: 'trade', team: 'A. Daman / Christman', detail: 'Offer made — Giddey for Maxey' },
  { kind: 'sign', team: 'Coulter', detail: 'Victor Wembanyama to Osborn at $5.00 — Coulter may match' },
];
const m = biggestMoves(log);
ok('trades first', /^Trade/.test(m[0]) && /Maxey/.test(m[0]), m[0]);
ok('then signings, dearest first', /Harden/.test(m[1]) && /Kevin Love/.test(m[2]), JSON.stringify(m));
ok('nominations, offers and pending matches are not moves', m.length === 3 && !m.some((x) => /Nominated|Offer made|may match/.test(x)));

console.log('\n== only well-formed posts reach an email ==');
const good = parseTweets('Sure! [{"author":"Zach Lowe","text":"Coulter at $15.25 for Harden is a choice."},{"author":"Bill Simmons","text":"HARDEN RULE."}]');
ok('parses a JSON array out of surrounding text', good && good.length === 2 && good[0].handle === '@ZachLowe_Parody');
ok('an unknown author is dropped', parseTweets('[{"author":"Woj","text":"Breaking."}]') === null);
ok('an overlong post is dropped', parseTweets(`[{"author":"Nate Duncan","text":"${'x'.repeat(300)}"}]`) === null);
ok('garbage is null, not a crash', parseTweets('no json here') === null && parseTweets('[{bad') === null);
ok('at most two', parseTweets(JSON.stringify(VOICES.map((v) => ({ author: v.name, text: 'hi' })))).length === 2);
ok('every handle says parody', VOICES.every((v) => /Parody/.test(v.handle)));

console.log('\n== no key, no call, no tweets ==');
const mem = new Map(), store = { async get(k) { return mem.get(k) ?? null; }, async set(k, v) { mem.set(k, v); } };
const keep = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const t = await weeklyTweets(store, '2026-11-02', log, []);
ok('without ANTHROPIC_API_KEY the weekly simply has no tweets', t === null && !mem.has('tweets-2026-11-02'));
mem.set('tweets-2026-11-09', JSON.stringify({ tweets: good }));
ok('a cached week is reused, never re-written', (await weeklyTweets(store, '2026-11-09', log, [])) .length === 2);
if (keep) process.env.ANTHROPIC_API_KEY = keep;

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
