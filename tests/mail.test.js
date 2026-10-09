/* The mail functions' pure logic. lib/format.mjs imports nothing, so this runs
   with no Netlify runtime and no @netlify/blobs installed. The date bucketing is
   the part that actually matters: get the zone wrong and every evening move is
   filed under the following day and mailed late. */
import { dayIn, yesterdayIn, movesOn, esc, wrap, digestBody, prettyDay, clubLine, statsBlock, ord }
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
const evil = digestBody('Coulter', club,
  [{ts:'2026-09-02T16:00:00Z', kind:'trade', detail:'<img src=x onerror=alert(1)>', team:'Brice'}], ZONE);
ok('a hostile detail string is escaped in the digest',
   !evil.includes('<img src=x') && evil.includes('&lt;img src=x'));

console.log('\n== last night\'s stats ==');
ok('no scored night says so, and invents nothing', /No league games were scored/.test(evil));
ok('digest still lists transactions', /Transactions/.test(evil));
const line = (pts) => ({ FG: 5, FGA: 10, FT: 2, FTA: 2, P3: 1, TRB: 5, AST: 3, STL: 1, BLK: 1, TOV: 2, PTS: pts });
const stats = { day: '2026-10-22', counted: [{ slot: 'C', n: 'Nikola Jokic', s: line(31) }, { slot: 'G1', n: '<b>Evil</b>', s: line(9) }],
  over: [{ n: 'Late Guy' }], reused: [], totals: { FG: 10, FGA: 20, P3: 2, REB: 10, AST: 6, STL: 2, BLK: 2, TO: 4, PTS: 40, GP: 2 },
  gpAfter: 918, cap: 920, rank: 2, of: 9, pts: 61.5, rankWas: 4 };
const sb = statsBlock(stats);
ok('standing and movement', /2nd of 9/.test(sb) && /up from 4th/.test(sb) && /61.5 roto points/.test(sb), sb.slice(0, 200));
ok('games against the cap', /918 \/ 920 games/.test(sb));
ok('each counted starter, and the counted total', sb.includes('Nikola Jokic') && />31</.test(sb) && />40</.test(sb));
ok('player names are escaped', !sb.includes('<b>Evil</b>') && sb.includes('&lt;b&gt;Evil'));
ok('over the cap is named', /1 over the game cap: Late Guy/.test(sb));
ok('down is down', /down from 1st/.test(statsBlock({ ...stats, rankWas: 1 })));
ok('ordinals', ord(1) === '1st' && ord(2) === '2nd' && ord(3) === '3rd' && ord(4) === '4th' && ord(11) === '11th' && ord(12) === '12th' && ord(21) === '21st');
ok('the digest carries the section', /Last night/.test(digestBody('Coulter', club, [], ZONE, stats)));

console.log('\n== the wrapper ==');
const w = wrap('Title', '<p>body</p>', 'foot');
ok('carries the title', w.includes('Title'));
ok('carries the body', w.includes('<p>body</p>'));
ok('links back to the site', w.includes('hopefullyitwill.work'));
ok('pretty day reads as a date', prettyDay('2026-09-02')==='Wednesday, September 2',
   prettyDay('2026-09-02'));

console.log('\n'+(fails? fails+' of '+ran+' FAILED' : 'all '+ran+' passed'));
process.exit(fails?1:0);
