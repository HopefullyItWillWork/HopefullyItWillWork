/* The stats feed's pure logic. lib/stats.mjs imports nothing, so this runs with
   no Netlify runtime and no network: the ESPN responses are built inline in the
   shape ESPN returns. The parts that matter are reading each column by its key
   rather than its position, and the re-fetch window landing on the right
   nights. */
import { windowDays, daysBefore, seasonTypes, gamesFrom, parseBox, diffDay, dayKey, ymd, tipsFrom }
  from '../deploy/netlify/functions/lib/stats.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

console.log('\n== the window is last night and the five before it ==');
const w = windowDays('2026-03-01');
ok('six nights', w.length === 6, w.length);
ok('newest first', w[0] === '2026-03-01' && w[5] === '2026-02-24', w.join(' '));
ok('crosses the November clock change cleanly',
   windowDays('2026-11-03').join() === '2026-11-03,2026-11-02,2026-11-01,2026-10-31,2026-10-30,2026-10-29');
ok('daysBefore crosses a year', daysBefore('2027-01-02', 3) === '2026-12-30');
ok('blob key has no slash (state.mjs strips it)', dayKey('2026-10-22') === 'daily-2026-10-22');
ok('ESPN date param', ymd('2026-10-22') === '20261022');

console.log('\n== only the regular season counts unless told otherwise ==');
ok('default is regular season only', [...seasonTypes()].join() === '2');
ok('"1,2" lets preseason in', [...seasonTypes('1,2')].join() === '1,2');
ok('garbage falls back to regular season', [...seasonTypes('x')].join() === '2');
const ev = (id, type, done) => ({ id, season:{ type }, status:{ type:{ completed: done } },
  competitions:[{ competitors:[
    { homeAway:'home', team:{ abbreviation:'OKC' } }, { homeAway:'away', team:{ abbreviation:'MIL' } }] }] });
const sb = { events: [ev(1, 1, true), ev(2, 2, true), ev(3, 2, false)] };
const g = gamesFrom(sb, seasonTypes('2'));
ok('preseason game dropped', g.length === 2 && !g.some(x => x.id === '1'));
ok('unfinished game kept but marked', g.find(x => x.id === '3').final === false);
ok('home and away read', g[0].home === 'OKC' && g[0].away === 'MIL');
ok('null types keeps everything', gamesFrom(sb, null).length === 3);

console.log('\n== a box score reads by column name ==');
const KEYS = ['minutes','points','fieldGoalsMade-fieldGoalsAttempted',
  'threePointFieldGoalsMade-threePointFieldGoalsAttempted','freeThrowsMade-freeThrowsAttempted',
  'rebounds','assists','turnovers','steals','blocks'];
const row = (id, name, v, dnp) => ({ athlete:{ id, displayName:name }, didNotPlay:!!dnp, stats:dnp?[]:v });
const box = { boxscore: { players: [{ team:{ abbreviation:'MIL' }, statistics:[{ keys: KEYS, athletes: [
  row('5105623', "Kel'el Ware", ['25','18','7-13','0-4','4-6','12','1','1','0','1']),
  row('9', 'Bench Guy', [], true),
] }] }] } };
const p = parseBox(box);
ok('did-not-play left out', !p['9'] && Object.keys(p).length === 1);
const s = p['5105623'].s;
ok('made/attempted split', s.FG === 7 && s.FGA === 13 && s.FT === 4 && s.FTA === 6, JSON.stringify(s));
ok('threes are makes only', s.P3 === 0);
ok('counting stats', s.PTS === 18 && s.TRB === 12 && s.AST === 1 && s.TOV === 1 && s.BLK === 1 && s.STL === 0);
ok('team carried', p['5105623'].t === 'MIL');
// The same game with ESPN's columns in a different order must read the same.
const shuffled = JSON.parse(JSON.stringify(box));
const st = shuffled.boxscore.players[0].statistics[0];
const order = [...KEYS.keys()].reverse();
st.keys = order.map(i => KEYS[i]);
st.athletes[0].stats = order.map(i => box.boxscore.players[0].statistics[0].athletes[0].stats[i]);
ok('column order does not matter', JSON.stringify(parseBox(shuffled)['5105623'].s) === JSON.stringify(s));

console.log('\n== corrections are reported, not swallowed ==');
const a = { players: { x:{ n:'A', s:{ TRB:4, AST:2 } }, y:{ n:'B', s:{ TRB:1, AST:0 } } } };
const b = { players: { x:{ n:'A', s:{ TRB:5, AST:2 } } } };
const d = diffDay(a, b);
ok('changed stat listed', d.some(c => c.id === 'x' && c.what === 'TRB 4→5'), JSON.stringify(d));
ok('vanished player listed', d.some(c => c.id === 'y' && c.what === 'removed'));
ok('identical nights: no corrections', diffDay(a, a).length === 0);


console.log('\n== tip-offs for the lineup lock, in league time ==');
const tipEv = (date, home, away, status='STATUS_SCHEDULED') => ({ date, status:{ type:{ name: status } },
  competitions:[{ competitors:[{ homeAway:'home', team:{ abbreviation: home } }, { homeAway:'away', team:{ abbreviation: away } }] }] });
const tips = tipsFrom({ events: [
  tipEv('2026-10-21T23:30Z', 'NY', 'BOS'),            // 7:30pm Eastern (EDT)
  tipEv('2026-10-22T02:00Z', 'POR', 'GS'),            // 10pm Eastern, still the 21st
  tipEv('2026-10-22T00:00Z', 'MIA', 'ORL', 'STATUS_POSTPONED'),
] }, 'America/New_York');
ok('Eastern time', tips.NY === '19:30' && tips.BOS === '19:30', JSON.stringify(tips));
ok('a late West Coast game stays on its night', tips.GS === '22:00');
ok('a postponed game locks nobody', !('MIA' in tips) && !('ORL' in tips));
ok('winter: the clock change is followed', tipsFrom({ events:[tipEv('2026-12-02T00:00Z','DEN','LAL')] },
   'America/New_York').DEN === '19:00');
ok('gamesFrom carries the tip time', gamesFrom({ events:[{ ...ev(9, 2, true), date:'2026-10-21T23:30Z' }] }, null)[0].tip === '2026-10-21T23:30Z');

console.log(`\n${ran - fails}/${ran} passed`);
process.exit(fails ? 1 : 0);
