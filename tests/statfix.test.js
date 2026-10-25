'use strict';
const assert = require('assert');
(async () => {
  const { applyFixes, cleanFix } = await import('../deploy/netlify/functions/lib/statfix.mjs');
  const night = { players: { 1: { n: 'Nikola Jokić', t: 'DEN', s: { PTS: 20, AST: 9 } } } };
  const a = applyFixes(night, [{ n: 'Nikola Jokic', s: { PTS: 30 } }]);
  assert.strictEqual(a.players[1].s.PTS, 30); assert.strictEqual(a.players[1].s.AST, 9);
  assert.strictEqual(night.players[1].s.PTS, 20, 'the stored night is not mutated');
  assert.strictEqual(Object.keys(applyFixes(night, [{ n: 'Nikola Jokic', del: true }]).players).length, 0);
  const add = applyFixes(night, [{ n: 'New Guy', t: 'LAL', s: { PTS: 5 } }, { n: 'No Club', s: { PTS: 5 } }]);
  assert.ok(add.players['fix-newguy'] && !add.players['fix-noclub'], 'adding a line needs a club');
  assert.ok(cleanFix({ n: 'A', s: { PTS: 'x' } }).error);
  assert.ok(cleanFix({ n: 'A', s: {} }).error);
  assert.deepStrictEqual(cleanFix({ n: 'A', t: 'den', s: { PTS: '12' } }).fix, { n: 'A', t: 'DEN', s: { PTS: 12 } });
  console.log('statfix: ok');
})().catch(e => { console.error(e); process.exit(1); });
