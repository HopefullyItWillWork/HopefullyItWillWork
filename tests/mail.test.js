/* The mail functions' pure logic. lib/format.mjs imports nothing, so this runs
   with no Netlify runtime and no @netlify/blobs installed. The date bucketing is
   the part that actually matters: get the zone wrong and every evening move is
   filed under the following day and mailed late. */
import { dayIn, yesterdayIn, movesOn, movesBetween, esc, wrap, dailyBody, weeklyBody, headline, lastNightBlock, prettyDay, clubLine, ord, gapText, isMonday }
  from '../deploy/netlify/functions/lib/format.mjs';

let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

const ZONE = 'America/New_York';

console.log('\n== "yesterday" is the league\'s yesterday, not UTC\'s ==');
// 9pm Eastern on 2 Sep is 01:00 UTC on 3 Sep. It belongs to 2 Sep.
ok('a 9pm Eastern move is filed under that evening',
   dayIn(ZONE, new Date('2026-09-03T01:00:00Z'))==='2026-09-02',
   dayIn(ZONE, new Date('2026-09-03T01:00:00Z')));
ok('a 9am Eastern move is filed under that morning',
   dayIn(ZONE, new Date('2026-09-03T13:00:00Z'))==='2026-09-03');
// Winter: Eastern is UTC-5, so the boundary moves.
ok('the boundary follows daylight saving',
   dayIn(ZONE, new Date('2026-01-03T04:30:00Z'))==='2026-01-02',
   dayIn(ZONE, new Date('2026-01-03T04:30:00Z')));
ok('yesterdayIn is the day before, in zone',
   yesterdayIn(ZONE, new Date('2026-09-03T13:00:00Z'))==='2026-09-02');

console.log('\n== the digest picks up exactly one day ==');
const log = [
  {ts:'2026-09-03T01:00:00Z', kind:'sign',  detail:'evening of the 2nd', team:'Coulter'},
  {ts:'2026-09-02T16:00:00Z', kind:'trade', detail:'midday of the 2nd',  team:'Brice'},
  {ts:'2026-09-03T16:00:00Z', kind:'cut',   detail:'the 3rd',            team:'Osborn'},
  {ts:'2026-09-02T03:00:00Z', kind:'edit',  detail:'evening of the 1st', team:'Schwab'},
  {ts:null,                   kind:'sign',  detail:'no timestamp'},
  null,
];
const m = movesOn(log, ZONE, '2026-09-02');
ok('two moves on 2 Sep', m.length===2, JSON.stringify(m.map(x=>x.detail)));
ok('the 9pm one is included', m.some(x=>x.detail==='evening of the 2nd'));
ok('the next day is excluded', !m.some(x=>x.detail==='the 3rd'));
ok('the previous evening is excluded', !m.some(x=>x.detail==='evening of the 1st'));
ok('null entries and missing timestamps are skipped', m.every(x=>x&&x.ts));
ok('an empty log is not an error', movesOn(null, ZONE, '2026-09-02').length===0);

console.log('\n== club summary line ==');
const club = {r:[
  {n:'A', y:[1,5.25,null,null]}, {n:'B', y:[1,4.75,null,null]},
  {n:'C', y:[2,null,null,null]},
]};
const c = clubLine(club);
ok('payroll counts next season only', c.payroll===10, c.payroll);
ok('signed count', c.signed===2, c.signed);
ok('expiring count', c.expiring===1, c.expiring);
ok('an empty club does not throw', clubLine({}).payroll===0);

console.log('\n== league text never lands in the markup raw ==');
ok('escapes angle brackets', esc('<b>x</b>')==='&lt;b&gt;x&lt;/b&gt;');
ok('escapes quotes and ampersands', esc(`"a"&'b'`)==='&quot;a&quot;&amp;&#39;b&#39;');
ok('null becomes empty', esc(null)==='');
const evil = dailyBody({ club: 'Coulter', live: true, last: null },
  [{ts:'2026-09-02T16:00:00Z', kind:'trade', detail:'<img src=x onerror=alert(1)>', team:'Brice'}], ZONE);
ok('a hostile detail string is escaped in the digest',
   !evil.includes('<img src=x') && evil.includes('&lt;img src=x'));

console.log('\n== the daily ==');
ok('no scored night says so, and invents nothing', /No league games were scored/.test(evil));
ok('digest still lists league moves', /League moves/.test(evil));
const line = (pts) => ({ FG: 5, FGA: 10, FT: 2, FTA: 2, P3: 1, TRB: 5, AST: 3, STL: 1, BLK: 1, TOV: 2, PTS: pts });
const last = { counted: [{ slot: 'C', n: 'Nikola Jokic', s: line(31) }, { slot: 'G1', n: '<b>Evil</b>', s: line(9) }],
  over: [{ n: 'Late Guy' }], reused: [], totals: { FG: 10, FGA: 20, P3: 2, REB: 10, AST: 6, STL: 2, BLK: 2, TO: 4, PTS: 40, GP: 2 },
  gpAfter: 918, cap: 920, bench: [{ n: 'Josh Giddey', s: { PTS: 21 } }], benchPts: 21 };
const ln = lastNightBlock(last);
ok('counted starters and total', ln.includes('Nikola Jokic') && />31</.test(ln) && />40</.test(ln));
ok('games against the cap', /918 \/ 920 used/.test(ln));
ok('points left on the bench', /21 points left on your bench/.test(ln) && ln.includes('Josh Giddey 21'));
ok('player names are escaped', !ln.includes('<b>Evil</b>') && ln.includes('&lt;b&gt;Evil'));
ok('over the cap is named', /Over the game cap.*Late Guy/.test(ln));
const st = { rank: 3, of: 9, pts: 54.5, rankWas: 4, above: { club: 'Osborn', gap: 2.5 }, below: { club: 'Brice', gap: 1 } };
const hl = headline(st);
ok('headline: place, movement, points, the club ahead', /3rd of 9/.test(hl) && /up from 4th/.test(hl) && /54.5 roto points/.test(hl) && /2.5 behind Osborn for 2nd/.test(hl), hl);
ok('the leader is told his lead instead', /1 clear of Brice/.test(headline({ ...st, rank: 1, above: null })));
ok('down is down', /down from 1st/.test(headline({ ...st, rankWas: 1 })));
ok('ordinals', ord(1) === '1st' && ord(2) === '2nd' && ord(3) === '3rd' && ord(4) === '4th' && ord(11) === '11th' && ord(12) === '12th' && ord(21) === '21st');
const tn = dailyBody({ club: 'X', live: true, last, standing: st,
  tonight: { games: 7, playing: ['A'], idle: ['Idle Guy'], empty: 2, benchPlaying: ['Bench Guy'] } }, [], ZONE);
ok('tonight: starters with no game, empty slots, bench players who play', /Idle Guy/.test(tn) && /2 empty slots/.test(tn) && /Bench Guy/.test(tn));

console.log('\n== only roster moves are mail ==');
const L2 = [{ ts: '2026-09-02T16:00:00Z', kind: 'sign', detail: 'Kevin Love', team: 'Brice' },
  { ts: '2026-09-02T16:01:00Z', kind: 'edit', detail: 'Kevin Love started at C', team: 'Brice' },
  { ts: '2026-09-02T16:02:00Z', kind: 'sign', detail: 'Nominated Someone at $1.00', team: 'Brice' }];
ok('lineup edits and nominations are left out', movesOn(L2, ZONE, '2026-09-02').length === 1);
ok('a week of moves', movesBetween(L2, ZONE, '2026-08-31', '2026-09-06').length === 1);
ok('Monday is Monday', isMonday('2026-11-02') && !isMonday('2026-11-01'));

console.log('\n== the weekly ==');
const wk = weeklyBody({ club: 'A. Daman', nights: 4, standing: st, weekRank: 2, weekPts: 61,
  table: [{ club: 'Osborn', gm: 'Chris Osborn', rank: 2, pts: 57, move: 1, gp: 40 }, { club: 'A. Daman', gm: '', rank: 3, pts: 54.5, move: -1, gp: 38 }],
  gains: [{ k: 'REB', club: 'Brice', gap: 14 }], risks: [{ k: 'FG%', club: 'N. Fink', gap: 0.002 }], surplus: ['AST'],
  angles: [{ k: 'REB', clubs: [{ club: 'Brice', gm: 'Mark Brice' }] }],
  pace: { used: 300, cap: 920, projected: 948, expected: 290 }, pickups: { left: 3, spots: 3, money: 40 },
  best: [{ n: 'Nikola Jokic', club: 'A. Daman', g: 4, s: { PTS: 120, TRB: 50, AST: 40 } }], worst: [], leagueTop: [] }, [], ZONE);
ok('the race, with movement', /Chris Osborn/.test(wk) && /&uarr;1/.test(wk) && /&darr;1/.test(wk));
ok('a point within reach', /14 rebounds behind Brice</.test(wk));
ok('a point at risk, in percentage points', /0.2 pts of FG% ahead of N. Fink/.test(wk));
ok('surplus to trade', /Comfortably clear in assists/.test(wk));
ok('who has what you need: managers, not players', /Mark Brice \(Brice\) has more than they need/.test(wk));
ok('games pace, warned when games will be wasted', /roughly 28 games will go to waste/.test(wk));
ok('pickups left', /3 more minimum pickups/.test(wk));
ok('gap text', gapText('PTS', 12.4) === '12 points' && gapText('REB', 1) === '1 rebound' && gapText('FT%', 0.0123) === '1.2 pts of FT%');

console.log('\n== the wrapper ==');
const w = wrap('Title', '<p>body</p>', 'foot');
ok('carries the title', w.includes('Title'));
ok('carries the body', w.includes('<p>body</p>'));
ok('links back to the site', w.includes('hopefullyitwill.work'));
ok('pretty day reads as a date', prettyDay('2026-09-02')==='Wednesday, September 2',
   prettyDay('2026-09-02'));

console.log('\n'+(fails? fails+' of '+ran+' FAILED' : 'all '+ran+' passed'));
process.exit(fails?1:0);
