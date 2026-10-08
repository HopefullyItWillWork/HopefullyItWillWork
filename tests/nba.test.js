/* Who plays for which NBA club. lib/nba.mjs's parsing and name folding, with
   ESPN's responses built inline. nameKey() is the part that matters: it is how
   a roster name finds its ESPN player, and the page carries a copy of it. */
import { nameKey, teamsFrom, rosterFrom, ESPNNAME } from '../deploy/netlify/functions/lib/nba.mjs';

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

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
