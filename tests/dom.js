/* A DOM stub good enough to actually RUN deploy/index.html's script.
   Per CLAUDE.md: node --check proves nothing. This executes the module and
   lets a test call the real functions. innerHTML assignments are scanned for
   id= so ids created at render time resolve on the next getElementById, and
   querySelectorAll understands the attribute selectors the app uses. */
'use strict';
const ATTR = /\[([a-zA-Z-]+)\]/;

function parseTag(tag){
  const at = {};
  tag.replace(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g, (m,k,v)=>{ at[k]=v; return m; });
  return at;
}

class El {
  constructor(id, doc, tag){
    this.id = id || ''; this._doc = doc; this.tagName = (tag||'div').toUpperCase();
    this._html = ''; this.textContent = ''; this._value = ''; this.hidden = false;
    this.className = ''; this.title = ''; this.checked = false; this.disabled = false;
    this.style = new Proxy({}, {get:(t,k)=>t[k]||'', set:(t,k,v)=>{t[k]=v; return true;}});
    this.dataset = {}; this.attrs = {}; this.children = []; this.listeners = {};
    this.classList = {
      add:(...c)=>{ c.forEach(x=>{ if(!this.className.split(/\s+/).includes(x)) this.className=(this.className+' '+x).trim(); }); },
      remove:(...c)=>{ this.className = this.className.split(/\s+/).filter(x=>!c.includes(x)).join(' '); },
      toggle:(c,on)=>{ on ? this.classList.add(c) : this.classList.remove(c); },
      contains:c=>this.className.split(/\s+/).includes(c) };
  }
  /* A real input coerces whatever you assign to a string; a plain JS property
     does not, and code doing .value.trim() then blows up on a number. */
  get value(){ return this._value; }
  set value(v){ this._value = v==null ? '' : String(v); }
  get innerHTML(){ return this._html; }
  set innerHTML(v){ this._html = String(v); this._qs = new Map(); this._doc._scan(this._html); }
  get firstChild(){ return null; }
  /* <select>.options — the app gates work on whether it has been filled yet */
  get options(){
    const out=[]; const re=/<option([^>]*)>([^<]*)/g; let m;
    while((m=re.exec(this._html))){ const at=parseTag('<option'+m[1]+'>');
      out.push({value: 'value' in at ? at.value : m[2].trim(), text: m[2].trim(),
                selected: 'selected' in at}); }
    return out;
  }
  get selectedIndex(){ return this.options.findIndex(o=>o.value===this.value); }
  setAttribute(k,v){ this.attrs[k]=String(v); if(k==='hidden') this.hidden=true; }
  getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k){ delete this.attrs[k]; if(k==='hidden') this.hidden=false; }
  hasAttribute(k){ return k in this.attrs; }
  appendChild(c){ this.children.push(c); return c; }
  removeChild(c){ this.children = this.children.filter(x=>x!==c); return c; }
  remove(){}
  focus(){ this._doc.activeElement = this; }
  blur(){}
  select(){}
  scrollIntoView(){}
  getBoundingClientRect(){ return {top:0,left:0,right:0,bottom:0,width:0,height:0,x:0,y:0}; }
  closest(sel){ return null; }
  contains(){ return false; }
  addEventListener(t,f){ (this.listeners[t] = this.listeners[t]||[]).push(f); }
  removeEventListener(t,f){ this.listeners[t] = (this.listeners[t]||[]).filter(x=>x!==f); }
  dispatch(t,ev){ (this.listeners[t]||[]).forEach(f=>f.call(this, ev||{})); if(this['on'+t]) this['on'+t](ev||{}); }
  showModal(){ this.open = true; }
  close(){ this.open = false; }
  /* Selectors the app actually uses: '[data-x]', 'tag[data-x]', '#id tag', '.cls' */
  /* Memoised per selector until innerHTML changes. Returning fresh objects on
     every call would silently drop the handlers the app just bound to them and
     report working buttons as dead — exactly the harness false negative
     CLAUDE.md warns about. */
  querySelectorAll(sel){
    if(!this._qs) this._qs = new Map();
    if(this._qs.has(sel)) return this._qs.get(sel);
    const r = this._find(sel);
    this._qs.set(sel, r);
    return r;
  }
  _find(sel){
    const m = ATTR.exec(sel);
    if(!m) return [];
    const key = m[1];
    const out = [];
    const re = new RegExp('<(\\w+)([^>]*\\s' + key + '="[^"]*"[^>]*)>', 'g');
    let g;
    while((g = re.exec(this._html))){
      const at = parseTag('<'+g[1]+g[2]+'>');
      const e = new El(at.id||'', this._doc, g[1]);
      e.attrs = at; e.className = at.class||'';
      for(const k in at) if(k.startsWith('data-'))
        e.dataset[k.slice(5).replace(/-([a-z])/g,(x,c)=>c.toUpperCase())] = at[k];
      e.value = at.value||''; e.textContent = '';
      out.push(e);
    }
    return out;
  }
  querySelector(sel){ return this.querySelectorAll(sel)[0] || null; }
}

class Doc {
  constructor(html){
    this._els = new Map();
    this.documentElement = new El('', this, 'html');
    this.body = new El('', this, 'body');
    this.head = new El('', this, 'head');
    this.activeElement = null;
    this.listeners = {};
    this.hidden = false;
    this.visibilityState = 'visible';
    this._scan(html);
  }
  _scan(html){
    const re = /<(\w+)([^>]*\bid="([^"]+)"[^>]*)>/g;
    let m;
    while((m = re.exec(html))){
      const id = m[3];
      if(this._els.has(id)) continue;
      const at = parseTag('<'+m[1]+m[2]+'>');
      const e = new El(id, this, m[1]);
      e.attrs = at; e.className = at.class||''; e.hidden = 'hidden' in at;
      for(const k in at) if(k.startsWith('data-'))
        e.dataset[k.slice(5).replace(/-([a-z])/g,(x,c)=>c.toUpperCase())] = at[k];
      if(at.value) e.value = at.value;
      this._els.set(id, e);
    }
  }
  getElementById(id){
    if(!this._els.has(id)) return null;
    return this._els.get(id);
  }
  createElement(tag){ return new El('', this, tag); }
  querySelectorAll(sel){ return this.body.querySelectorAll(sel); }
  querySelector(sel){ return null; }
  addEventListener(t,f){ (this.listeners[t] = this.listeners[t]||[]).push(f); }
  removeEventListener(){}
  /* The app registers several document click listeners. A stub that keeps only
     the last one reports working features as broken — CLAUDE.md calls this out
     by name — so every listener is invoked. */
  dispatch(t,ev){ (this.listeners[t]||[]).forEach(f=>f.call(this, ev||{})); }
}

function makeStorage(){
  const m = new Map();
  return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)),
           removeItem:k=>m.delete(k), clear:()=>m.clear(), get length(){return m.size;},
           key:i=>[...m.keys()][i]??null };
}

module.exports = { El, Doc, makeStorage };
