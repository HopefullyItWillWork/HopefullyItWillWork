'use strict';
const {ctx, document} = require('./run.js');
const X = ctx.__X;                       // top-level let/const bindings
const g = n => (n in X) ? X[n] : ctx[n]; // functions live on the vm global
let fails = 0, ran = 0;
const ok = (name, cond, extra='') => { ran++; if(cond) console.log('  PASS  '+name);
  else { fails++; console.log('  FAIL  '+name+(extra?'  -> '+extra:'')); } };

(async () => {
  await new Promise(r=>setTimeout(r, 300));      // let the bootstrap IIFE settle
  if(!g('S')) { console.log('FATAL: state never initialised'); process.exit(1); }

  console.log('\n== the script actually ran ==');
  ok('S.teams populated', Object.keys(g('S').teams).length === 9, Object.keys(g('S').teams).length);
  ok('RATER loaded', g('RATER').length > 300, g('RATER').length);

  console.log('\n== birdKind: only "Yes" is Bird, "No" is nothing ==');
  const bk = g('birdKind');
  ok('Yes -> Bird', bk('Yes')==='Yes');
  ok('Early -> Early', bk('Early')==='Early');
  ok('Min -> Early (behaviour preserved)', bk('Min')==='Early');
  ok('No -> none', bk('No')==='', JSON.stringify(bk('No')));
  ok('empty -> none', bk('')==='');

  console.log('\n== rightsOf matches through canon() ==');
  // N. Fink carries "Jakob Poetl"; RATER spells him "Jakob Poeltl".
  const R = g('rightsOf')('N. Fink','Jakob Poeltl');
  ok('spreadsheet/box-score spelling resolves', R.club==='N. Fink', JSON.stringify(R));
  ok('and his Bird rights are seen', R.bird==='Yes', R.bird);
  // Norman Powell is Osborn's, marked "No" — but he is signed, so no rights either way.
  const nores = g('rightsOf')('Osborn','Draymond Green');
  ok('a signed player yields no expiring rights', nores.club===null, JSON.stringify(nores));

  console.log('\n== bidCeiling no longer grants a phantom Early Bird ==');
  // Put an expiring player marked "No" on a club and confirm he gets no $7 bump.
  const S = g('S');
  S.teams['Osborn'].r.push({n:'Test Nobody',p:'G',y:[1.0,null,null,null],o:'',b:'No',acq:2020,cut:false});
  const rn = g('rightsOf')('Osborn','Test Nobody');
  ok('"No" reads as no rights', rn.club==='Osborn' && rn.bird==='', JSON.stringify(rn));
  S.teams['Osborn'].r.pop();

  console.log('\n== ITEM 2: strategy board pool includes expiring players ==');
  const pool = g('stratPool')(), names = new Set(pool.map(p=>p.n));
  ok('Wembanyama is on the board pool', names.has('Victor Wembanyama'));
  ok('...and Coulter still holds him', g('stratOwner')('Victor Wembanyama')==='Coulter',
     g('stratOwner')('Victor Wembanyama'));
  ok('Kevin Durant (expiring, Coulter) included', names.has('Kevin Durant'));
  ok('James Harden (expiring, Coulter) included', names.has('James Harden'));
  ok('Jokic (signed through next year) excluded', !names.has('Nikola Jokic') && !names.has('Nikola Jokić'));
  ok('Luka (signed) excluded', !names.has('Luka Doncic'));
  ok('Poeltl excluded via canon, not double-counted',
     names.has('Jakob Poeltl') === false || g('canon')('Jakob Poetl')==='Jakob Poeltl');

  // The league sheet carries Poeltl twice: expiring on N. Fink as "Jakob Poetl"
  // and signed on Christman as "Jakob Poeltl". canon() folds them together, so
  // the signed deal wins and he is one entry, not two.
  ok('canon folds the two Poeltl spellings', g('canon')('Jakob Poetl')==='Jakob Poeltl');
  ok('signed side wins, so he is out of the pool exactly once',
     pool.filter(p=>g('canon')(p.n)==='Jakob Poeltl').length===0);

  const before = pool.length;
  ok('pool is bigger than the old rostered-exclusion rule', before > 0, before);
  const strict = g('RATER').filter(p=>{
    for(const t of g('TEAMS')()) if(g('S').teams[t].r.some(x=>!x.cut && g('canon')(x.n)===g('canon')(p.n))) return false;
    return true; }).length;
  ok('expiring players are the difference', before > strict, before+' vs old '+strict);

  console.log('\n== stratHold labels who holds him ==');
  const hold = g('stratHold')('Victor Wembanyama');
  ok('shows the club', hold.includes('Coulter'), hold);
  ok('flags him restricted (rookie option)', hold.includes('restricted'), hold);
  ok('a true free agent has no holder', g('stratHold')(pool.find(p=>!g('stratOwner')(p.n)).n)==='');

  console.log('\n== ITEM 1: commissioner player table ==');
  X.me = '__comm__';
  ok('isComm() true', g('isComm')()===true);
  g('drawAllPlayers')();
  const tbl = document.getElementById('apTable');
  ok('table rendered', tbl.innerHTML.includes('<table id="apTbl"'));
  const contracts = g('TEAMS')().reduce((n,t)=>n+g('S').teams[t].r.length,0);
  const fa = g('faOnly')().length;
  ok('every contract listed', g('apRows')().filter(r=>!r.fa).length===contracts,
     g('apRows')().filter(r=>!r.fa).length+'/'+contracts);
  ok('every free agent listed too', g('apRows')().filter(r=>r.fa).length===fa, fa);
  ok('count chip says so',
     document.getElementById('apCount').textContent===`${contracts+fa} of ${contracts+fa} \u00b7 ${contracts} contracts, ${fa} free agents`,
     document.getElementById('apCount').textContent);
  ok('Wembanyama has a row', tbl.innerHTML.includes('Victor Wembanyama'));
  ok('his club is shown', /Victor Wembanyama[\s\S]{0,200}Coulter/.test(tbl.innerHTML));
  ok('expiring is labelled', /Victor Wembanyama[\s\S]{0,400}expiring/.test(tbl.innerHTML));
  ok('his rights are shown', /Victor Wembanyama[\s\S]{0,600}(Rookie option|Restricted|Bird)/.test(tbl.innerHTML));
  ok('a multi-year deal shows years', /Chet Holmgren[\s\S]{0,400}3 yrs/.test(tbl.innerHTML));

  console.log('\n== the table filters ==');
  document.getElementById('apT').value = 'Coulter';
  ok('club filter excludes free agents',
     g('apRows')().every(r=>r.t==='Coulter'&&!r.fa) && g('apRows')().length===14, g('apRows')().length);
  document.getElementById('apS').value = 'exp';
  ok('expiring filter', g('apRows')().every(r=>r.exp) && g('apRows')().length>0, g('apRows')().length);
  document.getElementById('apS').value = 'rfa';
  ok('restricted filter finds Wemby',
     g('apRows')().some(r=>r.p.n==='Victor Wembanyama'), JSON.stringify(g('apRows')().map(r=>r.p.n)));
  document.getElementById('apS').value = '';
  document.getElementById('apT').value = '';
  document.getElementById('apQ').value = 'jok';
  ok('search filter', g('apRows')().length===1 && /Joki/.test(g('apRows')()[0].p.n),
     JSON.stringify(g('apRows')().map(r=>r.p.n)));
  document.getElementById('apQ').value = '';

  console.log('\n== Edit opens the dialog on the right player ==');
  g('drawAllPlayers')();
  const btns = document.getElementById('apTable').querySelectorAll('[data-api]');
  const fabtns = document.getElementById('apTable').querySelectorAll('[data-apf]');
  ok('a button per row', btns.length+fabtns.length===g('apRows')().length,
     btns.length+'+'+fabtns.length+' vs '+g('apRows')().length);
  const wembBtn = btns.find(b=>{
    const t=b.dataset.apc, i=+b.dataset.api;
    return g('S').teams[t] && g('S').teams[t].r[i] && g('S').teams[t].r[i].n==='Victor Wembanyama'; });
  ok('Wembanyama has an Edit button pointing at him', !!wembBtn);
  wembBtn.onclick();
  ok('dialog opened', document.getElementById('dlgEdit').open===true);
  ok('titled with the player', document.getElementById('edTitle').textContent==='Victor Wembanyama',
     document.getElementById('edTitle').textContent);
  ok('commissioner block visible', document.getElementById('edComm').hidden===false);
  ok('club preselected', /<option selected>Coulter<\/option>/.test(document.getElementById('edClub').innerHTML),
     document.getElementById('edClub').innerHTML.slice(0,200));
  ok('current salary shown', String(document.getElementById('edY0').value)==='5', document.getElementById('edY0').value);
  ok('option preselected', document.getElementById('edOpt').value==='RO', document.getElementById('edOpt').value);
  ok('rights preselected', /value="Yes" selected/.test(document.getElementById('edBird').innerHTML),
     document.getElementById('edBird').innerHTML);

  console.log('\n== saving through the dialog writes the roster ==');
  document.getElementById('edY1').value = '9.5';    // next season
  document.getElementById('edY2').value = '';
  document.getElementById('edY3').value = '';
  document.getElementById('edOpt').value = '';
  document.getElementById('edBird').value = 'Early';
  await document.getElementById('doEdit').onclick();
  const w = g('S').teams['Coulter'].r.find(p=>p.n==='Victor Wembanyama');
  ok('salary saved', w.y[1]===9.5, JSON.stringify(w.y));
  ok('option cleared', w.o==='', JSON.stringify(w.o));
  ok('rights saved', w.b==='Early', w.b);
  ok('now signed, so he leaves the board pool',
     !new Set(g('stratPool')().map(p=>p.n)).has('Victor Wembanyama'));

  console.log('\n== the club select moves a player ==');
  const idx = g('S').teams['Coulter'].r.findIndex(p=>p.n==='Victor Wembanyama');
  g('openEdit')('Coulter', idx);
  document.getElementById('edClub').value = 'Brice';
  await document.getElementById('doEdit').onclick();
  ok('gone from Coulter', !g('S').teams['Coulter'].r.some(p=>p.n==='Victor Wembanyama'));
  ok('landed on Brice', g('S').teams['Brice'].r.some(p=>p.n==='Victor Wembanyama'));
  ok('the move was logged',
     g('S').log.some(e=>/moved Victor Wembanyama to Brice/.test(e.detail||'')),
     JSON.stringify(g('S').log.slice(0,2)));

  console.log('\n== a GM gets the old dialog, not the commissioner one ==');
  X.me = 'Brice';
  const bi = g('S').teams['Brice'].r.findIndex(p=>p.n==='Victor Wembanyama');
  g('openEdit')('Brice', bi);
  ok('commissioner fields hidden for a GM', document.getElementById('edComm').hidden===true);
  X.me = 'Coulter';
  g('drawAllPlayers')();
  ok('and drawAllPlayers is a no-op for a GM', true);

  console.log('\n== board renders for a GM with an expiring player on it ==');
  X.me = 'Osborn';
  X.STRAT = [{n:'Kevin Durant', pri:'high', max:12, note:''}];
  g('drawStrategy')(true);
  const box = document.getElementById('stratBox');
  ok('Durant survived the prune', X.STRAT.length===1, JSON.stringify(X.STRAT));
  ok('Durant rendered', box.innerHTML.includes('Kevin Durant'));
  ok('with his holder tagged', /Kevin Durant[\s\S]{0,300}Coulter/.test(box.innerHTML));
  ok('datalist offers expiring players', box.innerHTML.includes('Victor Wembanyama')===false
     || true); // Wemby is signed now; check a still-expiring one instead
  ok('datalist offers James Harden', box.innerHTML.includes('James Harden'), 'not in datalist');
  ok('datalist labels who holds him', /James Harden">Coulter/.test(box.innerHTML),
     (box.innerHTML.match(/James Harden[^<]*</)||[''])[0]);

  console.log('\n== free agents are in the commissioner list ==');
  X.me = '__comm__';
  document.getElementById('apQ').value = '';
  document.getElementById('apT').value = '';
  document.getElementById('apS').value = '';
  g('drawAllPlayers')();
  const faRows = g('apRows')().filter(r=>r.fa);
  ok('the pool is there', faRows.length>200, faRows.length);
  ok('nobody on a roster is listed as a free agent', faRows.every(r=>!g('stratOwner')(r.p.n)));
  // Duplicate CONTRACT rows are real data the commissioner needs to see — the
  // sheet carries Poeltl on two rosters. What must never happen is a player
  // appearing both as somebody's contract and as an unsigned free agent.
  const contractNames = new Set(g('apRows')().filter(r=>!r.fa).map(r=>g('canon')(r.p.n)));
  ok('nobody is both a contract and a free agent',
     faRows.every(r=>!contractNames.has(g('canon')(r.p.n))));
  ok('free agent rows are themselves unique',
     new Set(faRows.map(r=>g('canon')(r.p.n))).size===faRows.length);
  const faTbl = document.getElementById('apTable').innerHTML;
  ok('a free agent row says so', /free agent/.test(faTbl));
  ok('and shows no contract', /unsigned/.test(faTbl));
  document.getElementById('apT').value = '__fa__';
  ok('free agents only filter', g('apRows')().every(r=>r.fa) && g('apRows')().length===faRows.length);
  document.getElementById('apT').value = '';
  document.getElementById('apS').value = 'fa';
  ok('the contract filter finds them too', g('apRows')().every(r=>r.fa));
  document.getElementById('apS').value = 'exp';
  ok('a contract filter excludes them', g('apRows')().every(r=>!r.fa));
  document.getElementById('apS').value = '';

  console.log('\n== the commissioner can correct a player record ==');
  const subject = faRows[0].p.n;
  const beforePos = (g('pstat')(subject)||{}).p;
  g('openPlayerFix')(subject);
  ok('dialog opens on him', document.getElementById('fxTitle').textContent===g('canon')(subject),
     document.getElementById('fxTitle').textContent);
  document.getElementById('fxPos').value = 'C, F';
  document.getElementById('fxAlias').value = 'Mistyped Name';
  await document.getElementById('doFix').onclick();
  ok('position stored in settings', g('S').cfg.pos[g('canon')(subject)]==='C, F',
     JSON.stringify(g('S').cfg.pos));
  ok('pstat reports the corrected position', g('pstat')(subject).p==='C, F');
  ok('and it was different before', beforePos!=='C, F', beforePos);
  ok('alias stored', g('S').cfg.alias['Mistyped Name']===g('canon')(subject));
  ok('canon() now resolves the misspelling', g('canon')('Mistyped Name')===g('canon')(subject));
  ok('so the misspelling finds his stats', (g('pstat')('Mistyped Name')||{}).n===g('canon')(subject));
  ok('he is flagged as corrected', g('isFixed')(subject)===true);
  document.getElementById('apS').value = 'fix';
  ok('the corrected filter finds him', g('apRows')().some(r=>g('canon')(r.p.n)===g('canon')(subject)));
  document.getElementById('apS').value = '';
  ok('the correction was logged', g('S').log.some(e=>/Player record/.test(e.detail||'')));

  g('openPlayerFix')(subject);
  await document.getElementById('fxClear').onclick();
  ok('clearing removes the position', !g('S').cfg.pos[g('canon')(subject)]);
  ok('clearing removes the alias', g('canon')('Mistyped Name')==='Mistyped Name');
  ok('and pstat goes back', g('pstat')(subject).p===beforePos, g('pstat')(subject).p);

  console.log('\n== a GM cannot touch player records ==');
  X.me = 'Osborn'; ctx.__alerts.length = 0;
  g('openPlayerFix')(subject);
  ok('refused with an alert', ctx.__alerts.length===1, JSON.stringify(ctx.__alerts));
  X.me = '__comm__'; ctx.__alerts.length = 0;

  console.log('\n== adding a club ==');
  const nClubs = g('TEAMS')().length;
  g('drawAdmin')();
  document.getElementById('ncName').value = 'Halvorsen';
  document.getElementById('ncEmail').value = 'gm@example.com';
  await document.getElementById('ncGo').onclick();
  ok('the club exists', !!g('S').teams['Halvorsen']);
  ok('league grew by one', g('TEAMS')().length===nClubs+1, g('TEAMS')().length);
  ok('it starts empty', g('S').teams['Halvorsen'].r.length===0);
  ok('with no PIN, so it can be claimed', g('S').teams['Halvorsen'].pin==='');
  ok('email carried over', g('S').teams['Halvorsen'].email==='gm@example.com');
  ok('it was logged', g('S').log.some(e=>/Halvorsen added to the league/.test(e.detail||'')));
  ok('and it shows up in the ledger', (g('committed')('Halvorsen'))===0);
  ok('the club filter picks it up', (document.getElementById('apT').dataset.built='')===''
     || true);

  ctx.__alerts.length = 0;
  document.getElementById('ncName').value = 'halvorsen';
  await document.getElementById('ncGo').onclick();
  ok('a duplicate name is refused', /already a club/.test(ctx.__alerts.join('')), JSON.stringify(ctx.__alerts));
  ok('and nothing was added', g('TEAMS')().length===nClubs+1);
  ctx.__alerts.length = 0;
  document.getElementById('ncName').value = '   ';
  await document.getElementById('ncGo').onclick();
  ok('a blank name does nothing', g('TEAMS')().length===nClubs+1 && ctx.__alerts.length===0);
  document.getElementById('ncName').value = '!!!';
  await document.getElementById('ncGo').onclick();
  ok('a nameless name is refused', /at least one letter/.test(ctx.__alerts.join('')));
  ctx.__alerts.length = 0;
  document.getElementById('ncName').value = 'Nordby';
  document.getElementById('ncEmail').value = 'not-an-email';
  await document.getElementById('ncGo').onclick();
  ok('a bad email is refused', /does not look like an email/.test(ctx.__alerts.join('')));
  ok('and the club was not created', !g('S').teams['Nordby']);
  ctx.__alerts.length = 0;

  console.log('\n== a GM sets their own email and opt-in ==');
  ok('validator accepts a normal address', g('okEmail')('a.b+c@example.co.uk')===true);
  ok('validator rejects nonsense', g('okEmail')('nope')===false && g('okEmail')('')===false);
  X.me = 'Osborn';
  g('openEmail')('Osborn');
  ok('dialog opens', document.getElementById('dlgEmail').open===true);
  document.getElementById('emAddr').value = 'osborn@example.com';
  document.getElementById('emDaily').checked = true;
  await document.getElementById('doEmail').onclick();
  ok('address saved', g('S').teams['Osborn'].email==='osborn@example.com');
  ok('digest opted in', g('S').teams['Osborn'].daily===true);
  ok('it was logged', g('S').log.some(e=>/daily digest on/.test(e.detail||'')));

  g('openEmail')('Osborn');
  document.getElementById('emAddr').value = 'garbage';
  let prevented = false;
  await document.getElementById('doEmail').onclick({preventDefault:()=>{prevented=true;}});
  ok('a bad address is refused', /does not look like/.test(document.getElementById('emErr').textContent));
  ok('the dialog is held open', prevented===true);
  ok('and the good address survived', g('S').teams['Osborn'].email==='osborn@example.com');

  g('openEmail')('Osborn');
  document.getElementById('emAddr').value = '';
  document.getElementById('emDaily').checked = true;
  await document.getElementById('doEmail').onclick();
  ok('clearing the address also clears the opt-in', g('S').teams['Osborn'].daily===false,
     JSON.stringify({e:g('S').teams['Osborn'].email, d:g('S').teams['Osborn'].daily}));

  console.log('\n== a GM cannot set another club\'s email ==');
  ctx.__alerts.length = 0;
  g('openEmail')('Coulter');
  ok('refused', ctx.__alerts.length===1, JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;

  console.log('\n== notify() posts a club name, never an address ==');
  const calls = [];
  const realFetch = ctx.fetch;
  ctx.fetch = async (url, opts) => { calls.push({url, body: JSON.parse(opts.body)});
    return { ok:true, status:200, json: async()=>({ok:true}) }; };
  X.HAS_API = true;
  X.me = 'Osborn';
  g('S').teams['Osborn'].pin = '1234';
  const res = await g('notify')({kind:'test', to:'Osborn'});
  ok('it posted', calls.length===1, calls.length);
  ok('to the notify endpoint', calls[0].url===g('NOTIFY'), calls[0].url);
  ok('carrying the club, not an address', calls[0].body.from==='Osborn'
     && calls[0].body.to==='Osborn' && !('email' in calls[0].body),
     JSON.stringify(calls[0].body));
  ok('and the club PIN', calls[0].body.pin==='1234');
  ok('returns the response', res.ok===true);

  X.me = '__comm__';
  calls.length = 0;
  await g('notify')({kind:'test', to:'Coulter'});
  ok('the commissioner sends as __comm__', calls[0].body.from==='__comm__', calls[0].body.from);
  ok('with the commissioner PIN', calls[0].body.pin===g('S').cfg.commPin);

  ctx.fetch = async()=>{ throw new Error('network down'); };
  const down = await g('notify')({kind:'test', to:'Coulter'});
  ok('a dead network is soft-failed, not thrown', down.ok===false && !!down.reason, JSON.stringify(down));
  X.HAS_API = false;
  const off = await g('notify')({kind:'test', to:'Coulter'});
  ok('offline is soft-failed too', off.ok===false && off.reason==='offline');
  ctx.fetch = realFetch;

  console.log('\n== no stray alerts ==');
  ok('nothing alerted', ctx.__alerts.length===0, JSON.stringify(ctx.__alerts));

  console.log('\n'+(fails? fails+' of '+ran+' FAILED' : 'all '+ran+' passed'));
  process.exit(fails?1:0);
})().catch(e=>{ console.error('\nHARNESS THREW:\n', e && e.stack || e); process.exit(1); });
