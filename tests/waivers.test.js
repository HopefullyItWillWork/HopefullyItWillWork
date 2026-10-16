/* The waiver wire's rule (deploy/netlify/functions/lib/waivers.mjs).
   node tests/waivers.test.js */
import { processWaivers, weeklyOrder, onWaivers, allOnWaivers, mondayOf, barredFrom } from '../deploy/netlify/functions/lib/waivers.mjs';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra || ''); } };

const S = '2026-27';
const cfg = { season: '2026-27', phase: 'season', minSal: 1, tax: 200.5, roster: 3, opener: '2026-10-20', deadline: '2027-02-05' };
const pl = (n, sal, extra) => ({ n, p: 'G', y: { [S]: sal }, b: '', acq: 2026, ...(extra || {}) });
const teams = () => ({
  Alpha: { r: [pl('Abe One', 10), pl('Abe Two', 5)], cuts: [], claims: [] },
  Beta:  { r: [pl('Ben One', 10), pl('Ben Two', 5), pl('Ben Three', 2)], cuts: [
    { n: 'Waived Guy', p: 'F', s: 3, live: true, at: S, cv: 2, wv: { from: '2026-11-01', till: '2026-11-02' } }], claims: [] },
  Gamma: { r: [pl('Gus One', 195), pl('Gus Two', 9)], cuts: [], claims: [] },
});

console.log('== order ==');
ok('Monday of a Wednesday', mondayOf('2026-11-04') === '2026-11-02');
const stand = [{ club: 'Alpha', pts: 20, tot: { GP: 5, PTS: 100 } }, { club: 'Beta', pts: 10, tot: { GP: 5, PTS: 90 } },
  { club: 'Gamma', pts: 10, tot: { GP: 5, PTS: 80 } }];
ok('worst first, ties to fewer points', weeklyOrder(['Alpha', 'Beta', 'Gamma'], stand, []).join() === 'Gamma,Beta,Alpha');
ok('nothing scored: the draft order', weeklyOrder(['Alpha', 'Beta', 'Gamma'], [], ['Beta', 'Alpha', 'Gamma']).join() === 'Beta,Alpha,Gamma');
ok('first week: all on waivers', allOnWaivers(cfg, '2026-10-25') && !allOnWaivers(cfg, '2026-10-27'));

console.log('== a claim ==');
{
  const T = teams();
  T.Alpha.claims = [{ id: 'a', n: 'Waived Guy', drop: '', at: '2026-11-01T20:00:00Z' }];
  T.Gamma.claims = [{ id: 'g', n: 'Waived Guy', drop: '', at: '2026-11-01T19:00:00Z' }];
  const before = processWaivers({ teams: T, cfg, order: ['Gamma', 'Alpha', 'Beta'], today: '2026-11-01' });
  ok('inside the window nothing happens', !before.results.length && before.teams.Alpha.claims.length === 1);
  const r = processWaivers({ teams: T, cfg, order: ['Gamma', 'Alpha', 'Beta'], today: '2026-11-02' });
  ok('Gamma is first but past the hard cap, so Alpha wins', r.results[0] && r.results[0].to === 'Alpha', JSON.stringify(r.results));
  ok('Gamma skipped for the hard cap', r.skipped.some((x) => x.club === 'Gamma' && /hard cap/.test(x.why)));
  const p = r.teams.Alpha.r.find((x) => x.n === 'Waived Guy');
  ok('signed at the minimum, this season only, no rights', p && p.y[S] === 1 && Object.keys(p.y).length === 1 && p.b === '');
  ok('the record is settled', r.teams.Beta.cuts[0].wv.done === 'claimed' && r.teams.Beta.cuts[0].wv.to === 'Alpha');
  ok('winner to the back', r.order.join() === 'Gamma,Beta,Alpha');
  ok('claims cleared', !r.teams.Alpha.claims.length && !r.teams.Gamma.claims.length);
  ok('logged as a signing', r.log.some((e) => e.kind === 'sign' && /claimed off waivers from Beta/.test(e.detail)));
  ok('input not mutated', T.Beta.cuts[0].wv.done === undefined);
}

console.log('== a full roster must drop ==');
{
  const T = teams();
  T.Beta.claims = [{ id: 'b', n: 'Free Man', drop: '', at: '2026-10-25T10:00:00Z' }];
  let r = processWaivers({ teams: T, cfg, order: ['Beta'], today: '2026-10-26' });
  ok('no drop: skipped', !r.results.length && r.skipped.some((x) => /roster full/.test(x.why)));
  T.Beta.claims = [{ id: 'b', n: 'Free Man', drop: 'Ben Three', at: '2026-10-25T10:00:00Z' }];
  T.Beta.lu = { s: { G1: 'Ben Three' } };
  r = processWaivers({ teams: T, cfg, order: ['Beta'], today: '2026-10-26' });
  ok('with a drop: claimed', r.results[0] && r.results[0].drop === 'Ben Three');
  const cut = r.teams.Beta.cuts.find((c) => c.n === 'Ben Three');
  ok('the drop is a release and goes on waivers itself', cut && cut.live && cut.wv && cut.wv.till === '2026-10-27');
  ok('and leaves the lineup', r.teams.Beta.lu.s.G1 === '');
  const fm = r.teams.Beta.r.find((x) => x.n === 'Free Man');
  ok('a first-week free agent earns Early Bird', fm && fm.b === 'Early');
}

console.log('== the release bar ==');
{
  const T = teams();
  T.Alpha.cuts = [{ n: 'Waived Guy', s: 6, live: true, at: S }];
  ok('released above the minimum: barred', barredFrom(T.Alpha, 'Waived Guy', S, 1));
  T.Alpha.claims = [{ id: 'a', n: 'Waived Guy', drop: '', at: '2026-11-01T20:00:00Z' }];
  const r = processWaivers({ teams: T, cfg, order: ['Alpha', 'Beta', 'Gamma'], today: '2026-11-02' });
  ok('barred club skipped', !r.results.length && r.skipped.some((x) => x.club === 'Alpha'));
  ok('nobody won: he clears', r.cleared.some((x) => x.n === 'Waived Guy') && r.teams.Beta.cuts[0].wv.done === 'cleared');
  ok('and is no longer on the wire', !onWaivers(r.teams, S).length);
}

console.log('== offseason ==');
ok('nothing runs in the offseason', !processWaivers({ teams: teams(), cfg: { ...cfg, phase: 'offseason' }, order: [], today: '2026-11-02' }).cleared.length);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
