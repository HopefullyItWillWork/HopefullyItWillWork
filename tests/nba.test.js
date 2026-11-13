/* Who plays for which NBA club. lib/nba.mjs's parsing and name folding, with
   ESPN's responses built inline. nameKey() is the part that matters: it is how
   a roster name finds its ESPN player, and the page carries a copy of it. */
import { nameKey, teamsFrom, rosterFrom, injuryFrom, ESPNNAME } from '../deploy/netlify/functions/lib/nba.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

console.log('\n== names fold together ==');
ok('initials with and without dots', nameKey('V. J. Edgecombe') === nameKey('VJ Edgecombe'));
ok('accents', nameKey('Nikola Jokić') === nameKey('Nikola Jokic') && nameKey('Alperen Şengün') === nameKey('Alperen Sengun'));
ok('suffixes', nameKey('Wendell Carter Jr.') === nameKey('Wendell Carter') && nameKey('Robert Williams III') === nameKey('Robert Williams'));
ok('apostrophes', nameKey("Kel'el Ware") === nameKey('Kelel Ware'));
ok('different people stay different', nameKey('Jalen Williams') !== nameKey('Jaylin Williams'));
ok('a suffix only at the end', nameKey('Jr Smith') !== nameKey('Smith'));
ok('nicknames are the alias table\'s job', ESPNNAME['Ron Holland'] === 'Ronald Holland II');

console.log('\n== ESPN responses ==');
const teams = teamsFrom({ sports:[{ leagues:[{ teams:[{ team:{ id:'13', abbreviation:'LAL' } }, { team:{ id:'9', abbreviation:'GS' } }] }] }] });
ok('teams read', teams.length === 2 && teams[0].id === '13' && teams[1].code === 'GS');
ok('bad teams payload is empty, not a crash', teamsFrom(null).length === 0 && teamsFrom({}).length === 0);
const r = rosterFrom({ athletes:[{ id:5113969, displayName:'Cameron Carr', position:{ abbreviation:'G' } }, { displayName:'No Id' }] }, 'LAL');
ok('roster keyed by ESPN id', r['5113969'].n === 'Cameron Carr' && r['5113969'].t === 'LAL' && r['5113969'].pos === 'G');
ok('an athlete with no id is skipped', Object.keys(r).length === 1);
const hurt = rosterFrom({ athletes:[{ id:1, displayName:'Hurt Guy', injuries:[{ status:'Out', date:'2026-10-12T00:00Z',
  details:{ type:'Knee', location:'Leg', detail:'Sprain', returnDate:'2026-11-01' } }] },
  { id:2, displayName:'Fine Guy', injuries:[] }, { id:3, displayName:'Active Guy', injuries:[{ status:'Active' }] }] }, 'BOS');
ok('an injured player carries his status, detail and return', hurt['1'].inj.s === 'Out' && /Knee/.test(hurt['1'].inj.d) && hurt['1'].inj.r === '2026-11-01');
ok('a healthy player carries nothing', !hurt['2'].inj && !hurt['3'].inj);
ok('day-to-day from the type when status is missing', injuryFrom({ injuries:[{ type:{ description:'Day-To-Day' } }] }).s === 'Day-To-Day');
ok('garbage is null, not a crash', injuryFrom(null) === null && injuryFrom({ injuries:'x' }) === null);

import { injuriesFrom, athleteIdOf } from '../deploy/netlify/functions/lib/nba.mjs';
{
  /* ESPN's league-wide report (2026-11-13): what, return date and the news line,
     by the id in the athlete's links. */
  const rep = injuriesFrom({ injuries: [{ injuries: [
    { status:'Out', date:'2026-11-12T23:10Z', shortComment:'Haliburton (hamstring) will miss at least 10 more days.',
      details:{ type:'Hamstring', detail:'Strain', side:'Left', returnDate:'2026-11-22' },
      athlete:{ displayName:'Tyrese Haliburton', links:[{ href:'https://www.espn.com/nba/player/_/id/4396993/tyrese-haliburton' }] } },
    { status:'Out', athlete:{ headshot:{ href:'https://a.espncdn.com/i/headshots/nba/players/full/3975.png' } } },
    { status:'Active', athlete:{ links:[{ href:'/id/9/x' }] } },
    { status:'Out', athlete:{ displayName:'No Id' } } ] }] });
  const h = rep['4396993'];
  ok('the report carries what, return and the news line',
     h && h.s === 'Out' && h.d === 'Left Hamstring Strain' && h.r === '2026-11-22' && h.at === '2026-11-12' && /10 more days/.test(h.note));
  ok('an id is read from the headshot when there is no link', !!rep['3975'] && athleteIdOf({ links:[] }) === null);
  ok('active and id-less entries are skipped', !rep['9'] && Object.keys(rep).length === 2);
  ok('garbage is empty, not a crash', Object.keys(injuriesFrom(null)).length === 0 && Object.keys(injuriesFrom({ injuries:'x' })).length === 0);
}

import { freshPlayers } from '../deploy/netlify/functions/lib/nba.mjs';
{
  /* A copy cached before injuries were read is refreshed at once; with the fetch
     failing here it falls back to the stored copy, marked stale — proving the
     cache was not simply returned. */
  const mem = { v: JSON.stringify({ at: Date.now(), players: { 1: { n: 'X', t: 'BOS' } } }),
    get: async () => mem.v, set: async (k, v) => { mem.v = v; } };
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('offline'); };
  const got = await freshPlayers(mem, 6 * 3600e3);
  globalThis.fetch = realFetch;
  ok('a pre-injury cached copy is not served as fresh', got.stale === true);
}
console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
