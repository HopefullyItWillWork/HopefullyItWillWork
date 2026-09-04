const {ctx}=require('./run.js');
setTimeout(()=>{
  const X=ctx.__X, T=X.TEAMS();
  let bad=[];
  /* Both phases: the season being live opens the lineup block, the injured
     reserve and the lock, none of which the offseason render ever touches. */
  ['offseason','season'].forEach(phase=>{
    X.S.cfg.phase=phase;
    [null,'__comm__',...T].forEach(who=>{
      X.me=who; ctx.__alerts.length=0;
      try{ ctx.render(); ctx.drawStrategy&&ctx.drawStrategy(true); }
      catch(e){ bad.push(phase+' / '+(who||'signed out')+': '+e.message); }
      if(ctx.__alerts.length) bad.push(phase+' / '+(who||'signed out')+' alerted: '+ctx.__alerts.join('|'));
    });
  });
  X.S.cfg.phase='offseason';
  console.log(bad.length? 'FAILURES:\n'+bad.join('\n')
    : 'render() + drawStrategy() clean in both phases for signed-out, commissioner and all '+T.length+' GMs');
},500);
