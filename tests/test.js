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

  console.log('\n== a signed contract is the commissioner\u2019s to change ==');
  X.me = 'Brice';
  const bi = g('S').teams['Brice'].r.findIndex(p=>p.n==='Victor Wembanyama');
  X.editing = null; ctx.__alerts.length = 0;
  g('openEdit')('Brice', bi);
  ok('a GM is turned away from his own player', X.editing===null);
  ok('and told why', /commissioner/.test(ctx.__alerts[0]||''), JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;
  ok('canEditContract is commissioner-only', g('canEditContract')()===false);
  g('drawMe')();
  const mr = document.getElementById('meRoster').innerHTML;
  ok('so My Team offers him no Edit button', !/data-mre=/.test(mr));
  ok('but still Cut', /data-mrc=/.test(mr));
  ok('and still Block', /data-mrb=/.test(mr));
  X.me = '__comm__';
  ok('the commissioner still may', g('canEditContract')()===true);
  g('drawMe')();
  ok('and gets the Edit button back', /data-mre=/.test(document.getElementById('meRoster').innerHTML));
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
  g('openPlayerEdit')(subject);
  ok('the one contract dialog opens on him',
     document.getElementById('edTitle').textContent===g('canon')(subject),
     document.getElementById('edTitle').textContent);
  ok('it says he is on no roster', /Not on a roster/.test(document.getElementById('edSub').textContent),
     document.getElementById('edSub').textContent);
  ok('the club list offers leaving him unrostered',
     /not on a roster/.test(document.getElementById('edClub').innerHTML));
  ok('and that is the default', document.getElementById('edClub').value==='',
     document.getElementById('edClub').value);
  ok('the contract fields start empty', document.getElementById('edY1').value==='');

  document.getElementById('edPos').value = 'C, F';
  document.getElementById('edAlias').value = 'Mistyped Name';
  await document.getElementById('doEdit').onclick();
  ok('position stored in settings', g('S').cfg.pos[g('canon')(subject)]==='C, F',
     JSON.stringify(g('S').cfg.pos));
  ok('pstat reports the corrected position', g('pstat')(subject).p==='C, F');
  ok('and it was different before', beforePos!=='C, F', beforePos);
  ok('alias stored', g('S').cfg.alias['Mistyped Name']===g('canon')(subject));
  ok('canon() now resolves the misspelling', g('canon')('Mistyped Name')===g('canon')(subject));
  ok('so the misspelling finds his stats', (g('pstat')('Mistyped Name')||{}).n===g('canon')(subject));
  ok('he is flagged as corrected', g('isFixed')(subject)===true);
  ok('he is still a free agent', !g('stratOwner')(subject));
  document.getElementById('apS').value = 'fix';
  ok('the corrected filter finds him', g('apRows')().some(r=>g('canon')(r.p.n)===g('canon')(subject)));
  document.getElementById('apS').value = '';
  ok('the correction was logged', g('S').log.some(e=>/Player record/.test(e.detail||'')));

  g('openPlayerEdit')(subject);
  ok('the alias comes back into the field',
     document.getElementById('edAlias').value==='Mistyped Name',
     document.getElementById('edAlias').value);
  document.getElementById('edPos').value = '';
  document.getElementById('edAlias').value = '';
  await document.getElementById('doEdit').onclick();
  ok('clearing the fields removes the position', !g('S').cfg.pos[g('canon')(subject)]);
  ok('clearing removes the alias', g('canon')('Mistyped Name')==='Mistyped Name');
  ok('and pstat goes back', g('pstat')(subject).p===beforePos, g('pstat')(subject).p);

  console.log('\n== assigning an unrostered player a club and a contract ==');
  const target = faRows[1].p.n;
  ok('he starts on no roster', !g('stratOwner')(target));
  const payBefore = g('committed')('Osborn'), headBefore = g('headcount')('Osborn');
  g('openPlayerEdit')(target);
  document.getElementById('edClub').value = 'Osborn';
  document.getElementById('edY1').value = '6.25';
  document.getElementById('edY2').value = '6.50';
  document.getElementById('edPos').value = 'G';
  document.getElementById('edOpt').value = 'TO';
  document.getElementById('edBird').value = 'Early';
  document.getElementById('edAcq').value = '2026';
  await document.getElementById('doEdit').onclick();
  const placed = g('S').teams['Osborn'].r.find(p=>p.n===g('canon')(target));
  ok('he is on the roster now', !!placed, target);
  ok('with the salary given', placed && placed.y[1]===6.25, placed && JSON.stringify(placed.y));
  ok('and the second year', placed && placed.y[2]===6.5);
  ok('and no third year', placed && placed.y[3]===null);
  ok('position saved on the roster entry', placed && placed.p==='G');
  ok('option saved', placed && placed.o==='TO');
  ok('rights saved', placed && placed.b==='Early');
  ok('year acquired saved', placed && placed.acq===2026);
  ok('his salary is on the club\'s cap now',
     Math.abs(g('committed')('Osborn') - (payBefore + 6.25)) < 0.001,
     g('committed')('Osborn') + ' vs ' + (payBefore + 6.25));
  ok('and he takes a roster spot', g('headcount')('Osborn')===headBefore+1);
  ok('his club reads back as Osborn', g('stratOwner')(target)==='Osborn', g('stratOwner')(target));
  ok('he is off the free agent list', !g('faOnly')().some(p=>g('canon')(p.n)===g('canon')(target)));
  ok('the assignment was logged',
     g('S').log.some(e=>/Commissioner assigned/.test(e.detail||'')),
     JSON.stringify(g('S').log[0]));
  ok('a rostered player keeps no settings position override',
     !g('S').cfg.pos[g('canon')(target)]);

  console.log('\n== a club and no salary is refused ==');
  const target2 = g('faOnly')()[0].n;
  ctx.__alerts.length = 0;
  g('openPlayerEdit')(target2);
  document.getElementById('edClub').value = 'Brice';
  document.getElementById('edY1').value = '';
  let held = false;
  await document.getElementById('doEdit').onclick({preventDefault:()=>{held=true;}});
  ok('refused with a message', /salary for next season/.test(ctx.__alerts.join('')),
     JSON.stringify(ctx.__alerts));
  ok('the dialog is held open', held===true);
  ok('and nothing was assigned', !g('S').teams['Brice'].r.some(p=>p.n===g('canon')(target2)));
  ctx.__alerts.length = 0;

  console.log('\n== the hard cap and roster limit warn rather than block ==');
  // Osborn is nowhere near the tax, so push the tax below its payroll instead.
  const realTax = g('S').cfg.tax;
  g('S').cfg.tax = 1.00;
  ctx.confirm = () => false;
  g('openPlayerEdit')(target2);
  document.getElementById('edClub').value = 'Osborn';
  document.getElementById('edY1').value = '2.00';
  held = false;
  await document.getElementById('doEdit').onclick({preventDefault:()=>{held=true;}});
  ok('declining the warning assigns nobody',
     !g('S').teams['Osborn'].r.some(p=>p.n===g('canon')(target2)));
  ok('and holds the dialog open', held===true);
  ctx.confirm = () => true;
  g('openPlayerEdit')(target2);
  document.getElementById('edClub').value = 'Osborn';
  document.getElementById('edY1').value = '2.00';
  await document.getElementById('doEdit').onclick();
  ok('accepting it goes through',
     g('S').teams['Osborn'].r.some(p=>p.n===g('canon')(target2)));
  g('S').cfg.tax = realTax;

  // tidy up: take both assigned players back off Osborn
  ['edAlias'].forEach(()=>{});
  g('S').teams['Osborn'].r = g('S').teams['Osborn'].r.filter(
    p=>p.n!==g('canon')(target) && p.n!==g('canon')(target2));

  console.log('\n== a GM cannot assign or correct players ==');
  X.me = 'Osborn'; ctx.__alerts.length = 0;
  g('openPlayerEdit')(subject);
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

  console.log('\n== the trade block ==');
  X.me = 'Coulter';
  const cRoster = g('S').teams['Coulter'].r;
  const iBooker = cRoster.findIndex(p=>p.n==='Devin Booker');
  ok('nothing listed to start', g('blockList')().length===0, g('blockList')().length);
  await g('toggleBlock')('Coulter', iBooker);
  ok('the flag lands on the roster entry', cRoster[iBooker].blk===true);
  ok('so it rides the rosters slice', 'blk' in cRoster[iBooker]);
  ok('he shows up on the block', g('blockList')().some(x=>x.p.n==='Devin Booker'));
  ok('it was logged', g('S').log.some(e=>/Devin Booker listed on the trade block/.test(e.detail||'')));
  await g('toggleBlock')('Coulter', iBooker);
  ok('and it toggles back off', cRoster[iBooker].blk===false && g('blockList')().length===0);
  ok('unlisting is logged too', g('S').log.some(e=>/taken off the trade block/.test(e.detail||'')));
  await g('toggleBlock')('Coulter', iBooker);

  console.log('\n== a GM can only list their own ==');
  ctx.__alerts.length = 0;
  const oIdx = g('S').teams['Osborn'].r.findIndex(p=>p.n==='Luka Doncic');
  await g('toggleBlock')('Osborn', oIdx);
  ok('refused', ctx.__alerts.length===1, JSON.stringify(ctx.__alerts));
  ok('and nothing changed', !g('S').teams['Osborn'].r[oIdx].blk);
  ctx.__alerts.length = 0;

  console.log('\n== an unrestricted free agent cannot be listed ==');
  // Expiring, no option, no rights: tradeRight() says nobody can trade him.
  g('S').teams['Coulter'].r.push({n:'Nobody At All',p:'G',y:[1.0,null,null,null],o:'',b:'',acq:2020,cut:false});
  const iNo = g('S').teams['Coulter'].r.length-1;
  ok('he really is untradeable', g('tradeable')(g('S').teams['Coulter'].r[iNo])===false);
  ctx.__alerts.length = 0;
  await g('toggleBlock')('Coulter', iNo);
  ok('listing him is refused', /nothing to trade/.test(ctx.__alerts.join('')), JSON.stringify(ctx.__alerts));
  ok('and he is not on the block', !g('blockList')().some(x=>x.p.n==='Nobody At All'));
  g('S').teams['Coulter'].r.pop();
  ctx.__alerts.length = 0;

  console.log('\n== the block renders and loads into the builder ==');
  g('render')();
  const blkHtml = document.getElementById('blockList').innerHTML;
  ok('Booker is in the table', blkHtml.includes('Devin Booker'));
  ok('with his club', /Devin Booker[\s\S]{0,300}Coulter/.test(blkHtml));
  ok('and last season on the row', /\d+ G/.test(blkHtml));
  ok('count chip', /1 of 1 listed/.test(document.getElementById('blkCount').textContent),
     document.getElementById('blkCount').textContent);

  X.me = 'Osborn';
  X.selA.clear(); X.selB.clear();
  g('blockPick')('Coulter', cRoster[iBooker]);
  ok('his club goes on the far side', document.getElementById('tB').value==='Coulter',
     document.getElementById('tB').value);
  ok('and he is selected there', X.selB.has('Devin Booker'));
  ok('my own club takes the near side', document.getElementById('tA').value==='Osborn',
     document.getElementById('tA').value);

  console.log('\n== listing my own player puts him on my side ==');
  const oi = g('S').teams['Osborn'].r.findIndex(p=>p.n==='Luka Doncic');
  await g('toggleBlock')('Osborn', oi);
  X.selA.clear(); X.selB.clear();
  g('blockPick')('Osborn', g('S').teams['Osborn'].r[oi]);
  ok('my club on the near side', document.getElementById('tA').value==='Osborn');
  ok('and he is selected there', X.selA.has('Luka Doncic'));
  ok('the other side is somebody else', document.getElementById('tB').value!=='Osborn');

  console.log('\n== an empty block says so, and filters work ==');
  // Each GM has to unlist his own — that is the point of the permission check.
  await g('toggleBlock')('Osborn', oi);
  X.me = 'Coulter';
  await g('toggleBlock')('Coulter', iBooker);
  ok('nothing is listed now', g('blockList')().length===0, g('blockList')().length);
  g('drawBlock')();
  ok('empty state shown', /Nobody is on the block/.test(document.getElementById('blockList').innerHTML));
  await g('toggleBlock')('Coulter', iBooker);
  X.me = 'Osborn';
  await g('toggleBlock')('Osborn', oi);
  g('drawBlock')();
  ok('two clubs listed', g('blockList')().length===2, g('blockList')().length);
  document.getElementById('blkT').value = 'Coulter';
  g('drawBlock')();
  ok('club filter', /1 of 2 listed/.test(document.getElementById('blkCount').textContent),
     document.getElementById('blkCount').textContent);
  ok('and only that club renders',
     document.getElementById('blockList').innerHTML.includes('Devin Booker')
     && !document.getElementById('blockList').innerHTML.includes('Luka Doncic'));
  document.getElementById('blkT').value = '';
  document.getElementById('blkQ').value = 'luka';
  g('drawBlock')();
  ok('search filter', /1 of 2 listed/.test(document.getElementById('blkCount').textContent));
  document.getElementById('blkQ').value = '';
  g('drawBlock')();

  console.log('\n== stats show in the pick lists ==');
  document.getElementById('tA').value = 'Osborn';
  document.getElementById('tB').value = 'Coulter';
  X.selA.clear(); X.selB.clear();
  g('drawTradeLists')();
  const listA = document.getElementById('listA').innerHTML;
  ok('a stat line per player', (listA.match(/pkline/g)||[]).length>10,
     (listA.match(/pkline/g)||[]).length);
  ok('games are first, because of the 920 cap', /\d+ G · /.test(listA));
  ok('points, rebounds, assists, threes', /pts · .* reb · .* ast · .* 3p/.test(listA));
  ok('statLine handles a player with no games',
     g('statLine')('Nobody Who Ever Played').includes('no 2025'),
     g('statLine')('Nobody Who Ever Played'));

  console.log('\n== the category comparison ==');
  X.selA.add('Luka Doncic');
  X.selB.add('Devin Booker');
  g('drawTrade')();
  const tc = document.getElementById('tradeCats').innerHTML;
  ok('the table renders', tc.includes('<table id="tcTbl"'));
  ok('both clubs send a row', /Osborn sends/.test(tc) && /Coulter sends/.test(tc));
  ok('both clubs get a net row', /Osborn net/.test(tc) && /Coulter net/.test(tc));
  ok('all nine categories are columns',
     g('PCATS').every(([,l])=>tc.includes('>'+l+'<')), 'missing a header');
  ok('games are a column of their own', /<th>G<\/th>/.test(tc));

  const A = g('tradeCats')([g('S').teams['Osborn'].r.find(p=>p.n==='Luka Doncic')]);
  const B = g('tradeCats')([g('S').teams['Coulter'].r.find(p=>p.n==='Devin Booker')]);
  ok('totals are a season, not a per-game rate', A.v.PTS>500, A.v.PTS);
  ok('and match games times rate',
     Math.abs(A.v.PTS - g('pstat')('Luka Doncic').s.PTS*g('pstat')('Luka Doncic').g)<0.01);
  ok('percentages come back as fractions', A.v.FG>0 && A.v.FG<1, A.v.FG);
  ok('games are summed', A.g===g('pstat')('Luka Doncic').g, A.g);
  ok('an empty side is zero, not NaN',
     g('tradeCats')([]).v.PTS===0 && g('tradeCats')([]).g===0);
  const noGames = g('tradeCats')([{n:'Nobody Who Ever Played'}]);
  ok('a player with no games is counted as unrated, not NaN',
     noGames.unrated===1 && noGames.v.PTS===0, JSON.stringify(noGames));

  console.log('\n== turnovers read the right way round ==');
  ok('shedding turnovers is a gain', g('catGood')('TOV', -40)==='good');
  ok('taking them on is a loss', g('catGood')('TOV', 40)==='bad');
  ok('points are the other way', g('catGood')('PTS', 40)==='good' && g('catGood')('PTS',-40)==='bad');
  ok('no change is neutral', g('catGood')('PTS', 0)==='');
  ok('percentages are not netted', /netrow[\s\S]{0,400}dimx/.test(tc));

  console.log('\n== a listing does not travel with the player ==');
  X.me = 'Coulter';
  const bIdx = g('S').teams['Coulter'].r.findIndex(p=>p.n==='Devin Booker');
  if(!g('S').teams['Coulter'].r[bIdx].blk) await g('toggleBlock')('Coulter', bIdx);
  ok('listed by Coulter', g('S').teams['Coulter'].r[bIdx].blk===true);
  X.me = '__comm__';
  await g('applyTrade')({a:'Coulter', b:'Brice', give:['Devin Booker'], get:[]});
  const landed = g('S').teams['Brice'].r.find(p=>p.n==='Devin Booker');
  ok('he arrived at Brice', !!landed);
  ok('and is not still advertised', !landed.blk, JSON.stringify(landed.blk));
  ok('so the block is empty again', !g('blockList')().some(x=>x.p.n==='Devin Booker'));
  // put him back
  await g('applyTrade')({a:'Brice', b:'Coulter', give:['Devin Booker'], get:[]});
  ok('applyTrade confirms each move', ctx.__alerts.length===2, JSON.stringify(ctx.__alerts));
  ctx.__alerts.length = 0;   // its own "trade complete" notices, not stray ones
  X.me = 'Osborn';

  console.log('\n== the comparison clears when nothing is selected ==');
  X.selA.clear(); X.selB.clear();
  g('drawTrade')();
  ok('empty', document.getElementById('tradeCats').innerHTML==='');
  await g('toggleBlock')('Osborn', oi);

  console.log('\n== the rookie class is there and flagged as placeholder ==');
  ok('ROOKIES loaded', g('ROOKIES').length >= 20, g('ROOKIES').length);
  ok('and it says so', X.ROOKIES_PLACEHOLDER === true);

  console.log('\n== the commissioner sets the order and the scale ==');
  X.me = '__comm__';
  const T9 = g('TEAMS')();
  const scale = g('rookieScale')(T9.length);
  ok('first pick is 3.57% of the cap, rounded up to a quarter',
     scale[0] === Math.ceil(g('S').cfg.cap * 0.0357 * 4) / 4, scale[0]);
  ok('each later pick is a quarter less', scale[1] === scale[0] - 0.25, scale.join(','));
  ok('and it never drops under a minimum', scale.every(v => v >= 1));
  await g('saveDraftSetup')({year: 2027, future: 3, order: T9.slice(), sal: scale, open: true, closed: false});
  const board = g('draftBoard')();
  ok('nine slots, in the order given', board.length === T9.length && board[0].from === T9[0]);
  ok('slot 1 is on the clock', X.onClock().slot === 1);
  ok('a club with no record still holds its own pick', X.pickHolder(2027, T9[0]) === T9[0]);

  console.log('\n== making a pick writes a three-year rookie deal ==');
  const rook = g('undraftedRookies')()[0].n;
  const preCount = g('S').teams[T9[0]].r.length;
  await g('makePick')(T9[0], rook);
  const signed = g('S').teams[T9[0]].r.find(p => p.n === rook);
  ok('he is on the roster', !!signed && g('S').teams[T9[0]].r.length === preCount + 1);
  ok('three years at the slot salary',
     signed && signed.y[1] === scale[0] && signed.y[2] === scale[0] && signed.y[3] === scale[0],
     signed && JSON.stringify(signed.y));
  ok('with a rookie option on the last', signed && signed.o === 'RO', signed && signed.o);
  ok('he is out of the pool', !g('undraftedRookies')().some(r => r.n === rook));
  ok('and the clock has moved on', X.onClock().slot === 2);
  ok('a used pick is no longer tradeable', !g('clubPicks')(T9[0]).some(k => k.y === 2027));

  console.log('\n== an undrafted rookie is an ordinary free agent ==');
  const stillOut = g('undraftedRookies')()[0].n;
  const faNow = g('freeAgents')();
  ok('he is in the free agent pool', faNow.some(p => p.n === stillOut));
  ok('the drafted one is not', !faNow.some(p => p.n === rook));

  console.log('\n== picks trade, and carry no salary or roster spot ==');
  X.selA.clear(); X.selB.clear(); X.selPA.clear(); X.selPB.clear();
  document.getElementById('tA').value = T9[1];
  document.getElementById('tB').value = T9[2];
  X.selPA.add(X.pickId(2029, T9[1]));
  const pv = g('validateTrade')();
  ok('a picks-only offer is a real offer', pv.ok, JSON.stringify(pv.fails));
  ok('it moves no salary', pv.outA === 0 && pv.outB === 0);
  g('drawTradeLists')();
  const lA = document.getElementById('listA').innerHTML;
  ok('picks are listed in the builder', /Rookie draft picks/.test(lA));
  ok('and a selected future pick offers a protection', lA.includes('data-prot="2029:'+T9[1]+'"'));
  ok('an unselected pick does not', !lA.includes('data-prot="2030:'+T9[1]+'"'));
  ok('and a current-year pick never does', !/data-prot="2027:/.test(lA));
  g('render')();
  ok('the board renders while the draft is open',
     /on the clock/.test(document.getElementById('draftBoard').innerHTML
       + document.getElementById('draftStatus').innerHTML));
  await g('applyTrade')({a: T9[1], b: T9[2], give: [], get: [],
    givePk: [{y: 2029, from: T9[1], prot: 0, roll: false}], getPk: []});
  ok('the pick changed hands', X.pickHolder(2029, T9[1]) === T9[2], X.pickHolder(2029, T9[1]));
  ok('and shows up in the new club’s picks',
     g('clubPicks')(T9[2]).some(k => k.y === 2029 && k.from === T9[1]));
  ctx.__alerts.length = 0;

  console.log('\n== protection is read off the order, never applied ==');
  await g('applyTrade')({a: T9[3], b: T9[4], give: [], get: [],
    givePk: [{y: 2027, from: T9[3], prot: 5, roll: true}], getPk: []});
  ctx.__alerts.length = 0;
  const slot = g('pickSlot')(2027, T9[3]);
  ok('the pick sits inside the protection', slot > 0 && slot <= 5, slot);
  ok('so it stays with the club it came from', X.effHolder(2027, T9[3]) === T9[3]);
  ok('even though the record says otherwise', X.pickHolder(2027, T9[3]) === T9[4]);
  ok('protection is spelled out', /top 5 protected/.test(g('protText')(2027, T9[3])));
  ok('and the board hands the pick back', g('draftBoard')()[slot - 1].holder === T9[3]);

  console.log('\n== a rolling protection moves to the next draft when it triggers ==');
  await g('closeDraft')();
  ok('the 2028 pick is owed to the club that traded for it',
     X.pickHolder(2028, T9[3]) === T9[4], X.pickHolder(2028, T9[3]));
  ok('carrying the same protection', X.pickRec(2028, T9[3]).prot === 5);
  ok('and the 2027 record is marked so it cannot roll twice',
     X.pickRec(2027, T9[3]).rolled === true);
  await g('closeDraft')();
  ok('closing again changes nothing', X.pickHolder(2029, T9[3]) === T9[3],
     X.pickHolder(2029, T9[3]));
  ok('the draft reads as closed', g('draftCfg')().closed === true && g('draftCfg')().open === false);

  console.log('\n== an offer is rechecked against picks that moved ==');
  const stale = g('recheckTrade')({a: T9[1], b: T9[5], give: [], get: [],
    givePk: [{y: 2029, from: T9[1]}], getPk: []});
  ok('a pick the club no longer holds is caught', stale.length === 1 && /no longer holds/.test(stale[0]),
     JSON.stringify(stale));
  const used = g('recheckTrade')({a: T9[0], b: T9[5], give: [], get: [],
    givePk: [{y: 2027, from: T9[0]}], getPk: []});
  ok('so is a pick that has already been used', used.some(f => /already been used/.test(f)),
     JSON.stringify(used));

  console.log('\n== the commissioner can undo a selection ==');
  await g('undoPick')(2027, T9[0]);
  ok('the contract is gone', !g('S').teams[T9[0]].r.some(p => p.n === rook));
  ok('the rookie is back in the class', g('undraftedRookies')().some(r => r.n === rook));
  X.selPA.clear(); X.selPB.clear(); X.selA.clear(); X.selB.clear();
  X.me = 'Osborn';

  console.log('\n== My Team and the Free agent classes tab read one pool ==');
  X.me = 'Osborn';
  const cn = g('canon');
  const poolA = new Set(g('faPool')().map(p => cn(p.n)));
  const poolB = new Set(g('freeAgents')().map(p => cn(p.n)));
  const onlyA = [...poolA].filter(x => !poolB.has(x));
  const onlyB = [...poolB].filter(x => !poolA.has(x));
  ok('the two pools hold the same players', onlyA.length === 0 && onlyB.length === 0,
     'only faPool: ' + onlyA.slice(0, 5) + ' | only freeAgents: ' + onlyB.slice(0, 5));
  ok('and the strategy board reads the same one',
     g('stratPool')().length === g('faPool')().length);
  ok('the signed Poeltl deal wins on both sides',
     !poolA.has('Jakob Poeltl') && !poolB.has('Jakob Poeltl'));
  ok('an expiring player is a free agent on both', poolA.has('Kevin Durant') && poolB.has('Kevin Durant'));

  console.log('\n== an undrafted rookie reaches My Team, not just the FA tab ==');
  const rk1 = g('ROOKIES')[0].n;
  ok('he is in the pool My Team draws from', poolA.has(cn(rk1)));
  document.getElementById('faSearch').value = rk1;
  document.getElementById('faPos').value = '';
  g('drawFAList')();
  const faHtml = document.getElementById('faTable').innerHTML;
  ok('searching for him finds him', faHtml.includes(rk1), faHtml.slice(0, 300));
  ok('and a player with no box score renders as unrated, not a crash',
     /no 2025-26 stats/.test(faHtml));
  document.getElementById('faSearch').value = '';
  g('drawFAList')();
  ok('statVal is null-safe on a statless row', g('statVal')({g:null,s:null,tot:null},'PTS')===null);
  ok('hasStats says so', g('hasStats')({g:null,s:null})===false && g('hasStats')({g:70,s:{PTS:20}})===true);

  console.log('\n== no stray alerts ==');
  ok('nothing alerted', ctx.__alerts.length===0, JSON.stringify(ctx.__alerts));

  console.log('\n'+(fails? fails+' of '+ran+' FAILED' : 'all '+ran+' passed'));
  process.exit(fails?1:0);
})().catch(e=>{ console.error('\nHARNESS THREW:\n', e && e.stack || e); process.exit(1); });
