const {ctx}=require('./run.js');
setTimeout(()=>{
  const X=ctx.__X, T=X.TEAMS();
  let bad=[];
  [null,'__comm__',...T].forEach(who=>{
    X.me=who; ctx.__alerts.length=0;
    try{ ctx.render(); ctx.drawStrategy&&ctx.drawStrategy(true); }
    catch(e){ bad.push((who||'signed out')+': '+e.message); }
    if(ctx.__alerts.length) bad.push((who||'signed out')+' alerted: '+ctx.__alerts.join('|'));
  });
  console.log(bad.length? 'FAILURES:\n'+bad.join('\n') : 'render() + drawStrategy() clean for signed-out, commissioner and all '+T.length+' GMs');
},500);
