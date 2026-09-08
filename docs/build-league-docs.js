'use strict';
/* Builds the two short documents that go out with the guide:
     Before-the-Auction.docx      the three tools worth an hour before we bid
     Draft-announcement.docx      the email to send the league

   Same look as League-Ledger-GM-Guide.docx on purpose — they arrive in the same
   message and should read as a set. Needs `npm i docx`.

     node docs/build-league-docs.js
*/
const fs=require('fs'), path=require('path');
const D=require('docx');
const {Document,Packer,Paragraph,TextRun,HeadingLevel,Table,TableRow,TableCell,
       WidthType,BorderStyle,ShadingType,PageBreak,ExternalHyperlink}=D;

/* ---- the same helpers the guide uses ---- */
const H1=t=>new Paragraph({text:t,heading:HeadingLevel.HEADING_1,spacing:{before:360,after:140}});
const H2=t=>new Paragraph({text:t,heading:HeadingLevel.HEADING_2,spacing:{before:280,after:110}});
const H3=t=>new Paragraph({text:t,heading:HeadingLevel.HEADING_3,spacing:{before:220,after:90}});
function rich(parts,opt={}){
  const runs=(Array.isArray(parts)?parts:[parts]).map(x=>{
    if(typeof x==='string') return new TextRun({text:x,size:21});
    const [text,kind]=x;
    if(kind===1) return new TextRun({text,bold:true,size:21});
    if(kind===2) return new TextRun({text,font:'Consolas',size:19,color:'8A5A00'});
    if(kind===3) return new TextRun({text,italics:true,size:21});
    return new TextRun({text,size:21});
  });
  return new Paragraph({children:runs,spacing:{after:opt.after??140},...opt.p});
}
const P=(parts,opt)=>rich(parts,opt);
const BULLET=(parts)=>rich(parts,{after:60,p:{numbering:{reference:'bul',level:0}}});
const NUM=(parts)=>rich(parts,{after:60,p:{numbering:{reference:'num',level:0}}});
const SPACER=()=>new Paragraph({text:'',spacing:{after:120}});

function note(title,body,tone){
  const bg = tone==='warn' ? 'FDF3E3' : tone==='bad' ? 'FCEDEC' : 'EEF3FA';
  const bar= tone==='warn' ? 'B4791B' : tone==='bad' ? 'A33A31' : '3E5C86';
  return new Table({
    columnWidths:[10080],
    borders:{top:{style:BorderStyle.SINGLE,size:2,color:bg},bottom:{style:BorderStyle.SINGLE,size:2,color:bg},
      left:{style:BorderStyle.SINGLE,size:18,color:bar},right:{style:BorderStyle.SINGLE,size:2,color:bg},
      insideHorizontal:{style:BorderStyle.NONE},insideVertical:{style:BorderStyle.NONE}},
    rows:[new TableRow({children:[new TableCell({
      width:{size:10080,type:WidthType.DXA},
      shading:{type:ShadingType.CLEAR,fill:bg,color:'auto'},
      margins:{top:120,bottom:120,left:180,right:180},
      children:[
        new Paragraph({spacing:{after:60},children:[new TextRun({text:title,bold:true,size:21,color:bar})]}),
        new Paragraph({children:[new TextRun({text:body,size:21})]})
      ]})]})]});
}
function table(headers,rows,widths){
  const total=widths.reduce((a,b)=>a+b,0);
  const cell=(t,i,bold,fill)=>new TableCell({
    width:{size:widths[i],type:WidthType.DXA},
    shading:fill?{type:ShadingType.CLEAR,fill,color:'auto'}:undefined,
    margins:{top:90,bottom:90,left:130,right:130},
    children:[new Paragraph({children:[new TextRun({text:t,bold:!!bold,size:20})]})]});
  const mk=(cells,bold,fill)=>new TableRow({tableHeader:!!bold,children:cells.map((t,i)=>cell(t,i,bold,fill))});
  return new Table({
    columnWidths:widths, width:{size:total,type:WidthType.DXA},
    borders:{top:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},bottom:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},
      left:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},right:{style:BorderStyle.SINGLE,size:4,color:'C9D2DE'},
      insideHorizontal:{style:BorderStyle.SINGLE,size:2,color:'DCE3EC'},
      insideVertical:{style:BorderStyle.SINGLE,size:2,color:'DCE3EC'}},
    rows:[mk(headers,true,'EDF1F6'), ...rows.map(r=>mk(r,false))]});
}
const SITE='https://hopefullyitwill.work';
const link=()=>new Paragraph({spacing:{after:160},children:[
  new ExternalHyperlink({link:SITE,children:[
    new TextRun({text:SITE,size:24,bold:true,color:'1155CC',underline:{}})]})]});

const NUMBERING={config:[
  {reference:'bul',levels:[{level:0,format:'bullet',text:'•',alignment:'left',
    style:{paragraph:{indent:{left:420,hanging:220}}}}]},
  {reference:'num',levels:[{level:0,format:'decimal',text:'%1.',alignment:'left',
    style:{paragraph:{indent:{left:420,hanging:220}}}}]}]};
const STYLES={default:{
  document:{run:{font:'Calibri',size:21},paragraph:{spacing:{line:288}}},
  heading1:{run:{font:'Calibri',size:34,bold:true,color:'1A1A1A'}},
  heading2:{run:{font:'Calibri',size:26,bold:true,color:'2A2A2A'}},
  heading3:{run:{font:'Calibri',size:23,bold:true,color:'3A3A3A'}}}};
const SECTION=children=>({properties:{page:{margin:{top:900,bottom:900,left:1000,right:1000}}},children});

async function write(file,children){
  const doc=new Document({numbering:NUMBERING,styles:STYLES,sections:[SECTION(children)]});
  const buf=await Packer.toBuffer(doc);
  const out=path.join(__dirname,file);
  fs.writeFileSync(out,buf);
  console.log('wrote',out,(buf.length/1024).toFixed(0)+'KB');
}

/* ================================================================
   1. BEFORE THE AUCTION
   ================================================================ */
const A=[];
const a=(...xs)=>xs.forEach(x=>Array.isArray(x)?A.push(...x):A.push(x));

a(new Paragraph({spacing:{after:40},children:[new TextRun({
  text:'LEAGUE LEDGER · FOR GMs',size:18,bold:true,color:'A5670F',
  font:'Consolas'})]}));
a(new Paragraph({heading:HeadingLevel.TITLE,spacing:{after:120},
  children:[new TextRun({text:'Before the Auction',size:52,bold:true})]}));
a(P([['Three tools worth an hour of your time before we bid.',1],
  ' Work them in this order — what you think players will do, then what your club is missing, '
  +'then what you will actually pay. Each one feeds the next.']));
a(P('Everything here is yours alone. None of it places a bid, changes your roster, or shows up on '
  +'anybody else’s screen. You can do all of it right now — the auction itself stays '
  +'locked until the commissioner opens it, so there is nothing to break by poking around.'));
a(link());

a(H1('1. Write your own projections'));
a(P([['Where:',1],' the My projections tab (sign in first)']));
a(P('The site ships with two sets of numbers: what players actually did in 2025–26, and a '
  +'2026–27 aggregate the commissioner assembled. Neither is your opinion. This tab is where '
  +'you put yours in.'));
a(NUM(['Search any player and click him. You get last season’s line beside an empty column '
  +'for your figures.']));
a(NUM([['Type over only the categories you disagree with.',1],' Blank fields fall back to last '
  +'season — you never have to fill in a whole line to change one number.']));
a(NUM(['Flip the toggle at the top of the page to ',['My proj',1],'.']));
a(SPACER());
a(P('That toggle is the point. With it set to your projections, every stats screen on the site '
  +'recomputes on your numbers — ratings, the player rater, the impact card when someone is '
  +'on the block, and the what-if roster in step 2. The amber figures are the ones you changed.'));
a(table(['Toggle setting','What every screen then shows'],[
  ['2025–26 actuals','The record. What happened.'],
  ['2026–27 aggregate','The commissioner’s set — the same table for all nine of us.'],
  ['My proj','Your edits, over last season’s line wherever you left a field blank.']
],[2900,7180]));
a(SPACER());
a(note('Why it pays off',
  'A rating is a z-score against the whole field, so changing one player quietly moves everyone '
  +'else too. If you think a breakout is coming, projecting it does not just raise that player — '
  +'it lowers everyone he passes, and the auction values you read off the site shift with him.'));
a(H3('Do not try to do all 586'));
a(P('Use the Free agents filter and cover the auction class. Twenty players you have a real view '
  +'on beats a full table of guesses, because everyone you leave blank keeps last season’s '
  +'line, which is a perfectly good default.'));

a(new Paragraph({children:[new PageBreak()]}));
a(H1('2. Model your club with the what-if roster'));
a(P([['Where:',1],' My Team → scroll to “What-if roster”']));
a(P('A sandbox sitting on top of your club. Add and drop anybody in the pool and watch your nine '
  +'category totals move. Nothing you do here touches the league.'));
a(NUM(['Press ',['Load my team',1],' to start from your actual roster. Or pick another club in '
  +'Start from and see what a rival looks like.']));
a(NUM(['Add the free agents you are considering. Drop the players you would move.']));
a(NUM([['Read the category totals, not the names.',1],' You are looking for the two or three '
  +'categories where you are short.']));
a(SPACER());
a(note('The 920-game cap changes the answer',
  'We each get 920 player-games a season, so per-game rate matters far more than durability — '
  +'once you are at the cap, the extra games are simply thrown away. The what-if roster already '
  +'does this arithmetic: it hands your game slots to your highest-rate players first, then fills '
  +'whatever is left at replacement level so a half-built roster is still compared fairly against '
  +'a complete one. That is why a 78-game grinder and a 70-game star are worth much closer to the '
  +'same thing than the raw totals suggest.'));
a(H3('Two categories that read backwards'));
a(BULLET([['Turnovers.',1],' Shedding them is a gain. A negative number in that column is good news.']));
a(BULLET([['FG% and FT%.',1],' Both are weighted by attempts, so a percentage on its own is half '
  +'the fact. Every screen shows the makes and attempts underneath for exactly this reason — '
  +'.900 on two free throws a night and .900 on nine are not the same asset.']));

a(new Paragraph({children:[new PageBreak()]}));
a(H1('3. Write the board before you bid'));
a(P([['Where:',1],' the Auction tab → Auction strategy']));
a(P('Rank the players you want, flag how badly, and write down the most you would go. Then, when '
  +'one of them is on the block, that row follows you onto My Team so you are reading your own '
  +'plan while you decide.'));
a(NUM(['Add a player. Set Priority — High, Medium or Low.']));
a(NUM(['Put a number in Max bid. ',['This is a note to yourself',1],': it places no bid, sets no '
  +'automatic bid and binds nothing.']));
a(NUM(['Use Comment for the condition, not the conclusion — ',
  ['“would stretch to $12 if the guards go early”',3],' is the thing you will forget at 9pm.']));
a(NUM(['Reorder with the up and down arrows. It saves as you type.']));
a(SPACER());
a(P(['When a player from your board is nominated, My Team shows where you ranked him, your '
  +'priority, your max and your comment — and turns the line ',['red',1],' once the bidding '
  +'reaches or passes the figure you wrote down. That is the whole value of doing it in advance: '
  +'the number was set by you, calmly, days earlier.']));
a(note('The board includes players who look taken',
  'Roughly 45 men sitting on rosters today are in the last year of a deal, and nobody has '
  +'committed a dollar to them for next season — so they are in the auction class and they '
  +'are on your board. Victor Wembanyama is one of them. The board tags each of them with who '
  +'holds what: Bird rights, Early Bird, or a restricted tag meaning his old club gets to match '
  +'your winning bid. It also flags anyone a club has released and therefore cannot buy back — '
  +'still available to the rest of us, just not to them.'));

a(new Paragraph({children:[new PageBreak()]}));
a(H1('How private this actually is'));
a(P('Your projections and your strategy board follow you between devices — type them on your '
  +'phone, they are on your laptop. That works because they are stored with the league database, '
  +'encrypted with a key derived from your club PIN. A league-mate who goes looking gets '
  +'scrambled text.'));
a(note('Be realistic about the bar',
  'The PINs themselves live in the league data, and anyone who views the page source can read '
  +'them. Treat all of this as “nobody will stumble across it” — the same honour '
  +'system the whole site runs on — and not as a vault. If you would be genuinely damaged by '
  +'a rival reading your max bids, keep those in your head.','warn'));

a(H1('Before auction day'));
a(P('Ten minutes each, in this order.'));
a(BULLET([['Sign in and set your PIN.',1],' Whatever you type the first time becomes your club’s PIN.']));
a(BULLET([['Project the free agent class.',1],' My projections → filter to Free agents. '
  +'Leave blank anything you have no view on.']));
a(BULLET([['Load your team into the what-if roster.',1],' Find the two or three categories you are short in.']));
a(BULLET([['Fill the board, priority and max.',1],' Aim for more names than you can sign — '
  +'half of them will go to someone else.']));
a(BULLET([['Check what you can actually spend.',1],' The Auction tab shows your room, your '
  +'mid-level exception, and anyone you are barred from re-signing.']));

/* ================================================================
   2. THE ANNOUNCEMENT EMAIL
   ================================================================ */
const E=[];
const e=(...xs)=>xs.forEach(x=>Array.isArray(x)?E.push(...x):E.push(x));

e(new Paragraph({spacing:{after:40},children:[new TextRun({
  text:'DRAFT THIS INTO YOUR MAIL CLIENT · SUBJECT LINE BELOW',
  size:16,bold:true,color:'8A929D',font:'Consolas'})]}));
e(new Paragraph({spacing:{after:200},children:[new TextRun({
  text:'Subject:  We’re running the draft on our own site this year',
  size:24,bold:true})]}));
e(new Paragraph({spacing:{after:240},border:{bottom:{style:BorderStyle.SINGLE,size:6,color:'CCCCCC'}},children:[]}));

e(P('Gentlemen,'));
e(P('The spreadsheet has served us well. The spreadsheet is retired.'));
e(P([['We are running this year’s auction and rookie draft on our own website:',1]]));
e(link());
e(P('Go look at it right now. Every contract in the league is in there, it works out the cap and '
  +'the tax for you, it runs the auction live so we can all bid from wherever we are, and it does '
  +'the thing the spreadsheet never could — tell you what a player would actually do to your '
  +'nine categories before you spend the money on him.'));

e(H2('Two documents are attached'));
e(P([['The full guide',1],' covers every tab, what it does and how to use it, with screenshots. '
  +'Skim it once and you will know your way around.']));
e(P([['“Before the Auction”',1],' is shorter and honestly the one that will win you the '
  +'auction — the three tools worth an hour before we bid. Write your own projections, model '
  +'your roster in the what-if builder to find the categories you are short in, then build a '
  +'strategy board with your max on every man you want. Do that and you show up on draft night '
  +'with a plan instead of a vibe.']));

e(H2('First thing to do: claim your club'));
e(P([['Hit Sign in, pick your club from the list, and type a PIN.',1],' Whatever you type the '
  +'first time becomes your PIN — so it is first come, first served on your own team. Do it '
  +'before someone gets cute.']));
e(note('One honest warning about that PIN',
  'This is a website built for a nine-team fantasy league, not a bank. It keeps you from clicking '
  +'into someone else’s roster by accident and it gives us an audit trail of who did what. It '
  +'will not stop a determined league-mate who knows how to view source. So do not use a PIN you '
  +'use anywhere that matters — not your phone, not your bank card, not your garage door. '
  +'Pick four digits that mean nothing to you.','warn'));

e(H2('Now the part I need from you: pick a date'));
e(P('We have set aside three days for the draft:'));
e(BULLET([['Friday, October 9',1]]));
e(BULLET([['Saturday, October 10',1]]));
e(BULLET([['Sunday, October 11',1]]));
e(SPACER());
e(P([['Reply and tell me which of the three work for you',1],' — all of them, one of them, '
  +'whatever is true. I will take the day that works for the most people and send the time out '
  +'once we have landed on it.']));
e(P('The auction stays locked until I open it, so poke around all you like between now and then. '
  +'You cannot start it early by accident, no matter how hard you click.'));
e(P('Get in, claim your team, read the short doc, and start building your board.'));
e(P('See you on the 9th, 10th or 11th.'));
e(P('— Nathan'));

(async()=>{
  await write('Before-the-Auction.docx',A);
  await write('Draft-announcement.docx',E);
})();
