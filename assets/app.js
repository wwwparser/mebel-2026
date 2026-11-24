
const state = {items:[], facts:[], filtered:[], shown:0, batch:48,
  loaded:0, total:0, chunks:[], pending:0,
  f:{q:'',cats:new Set(),factory:'',country:'',min:'',max:'',hasPhoto:false,hasPrice:false},
  sort:'relevance'};

const $ = (s,el=document)=>el.querySelector(s);
const $$ = (s,el=document)=>[...el.querySelectorAll(s)];
const money = n => n==null ? '' : new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n);
const CUR = {RUB:'₽',RUR:'₽',CNY:'¥',USD:'$',EUR:'€',TRY:'₺',BYN:'Br',KZT:'₸',UZS:'soʻm',INR:'₹'};
const cur = c => CUR[(c||'RUB').toUpperCase()] || c || '₽';
const esc = s => (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function boot(){
  const [meta, facts] = await Promise.all([
    fetch('data/meta.json').then(r=>r.json()),
    fetch('data/factories.json').then(r=>r.json())
  ]);
  state.facts = facts;
  state.total = meta.total || 0;
  state.chunks = meta.chunks || [];
  const p = new URLSearchParams(location.search);
  state.f.q = p.get('q')||'';
  if(p.get('cat')) state.f.cats.add(p.get('cat'));
  state.f.factory = p.get('factory')||'';
  state.f.country = p.get('country')||'';
  state.deepItem = p.get('item')||'';
  if($('#q')) $('#q').value = state.f.q;
  bindOnce();
  await loadChunk(0);
  // Остальные порции — фоном, по нескольку сразу: последовательная загрузка
  // 35 порций занимала минуту, и поиск до её конца искал только по части каталога.
  (async () => {
    let next = 1;
    const total = state.chunks.length;
    const worker = async () => {
      while(next < total){
        const i = next++; await loadChunk(i, true);
        state.done = (state.done || 0) + 1;
        // пока идёт догрузка, результаты поиска пересчитываем на каждой порции,
        // а список рубрик — пореже (он тяжёлый)
        if(state.done % 8 === 0){ buildFilters(); apply(); }
        else if(state.f.q || state.f.cats.size){ apply(); }
      }
    };
    const pool = [];
    for(let w=0; w<Math.min(6, Math.max(1,total-1)); w++) pool.push(worker());
    await Promise.all(pool);
    state.pending = 0; buildFilters(); apply();
  })();
}

async function loadChunk(i, quiet){
  const c = state.chunks[i];
  if(!c) return;
  try{
    const part = await fetch('data/'+c.file).then(r=>r.json());
    state.items = state.items.concat(part);
    state.loaded += part.length;
  }catch(e){ console.warn('порция не загрузилась', c.file, e); }
  if(!quiet){ buildFilters(); apply(); }
  if(state.deepItem && !state.opened && state.items.some(x=>x.i===state.deepItem)){
    state.opened = true; openProduct(state.deepItem);
  }
}

function bindOnce(){
  const bind = (id, key) => { const el=$(id); if(el) el.addEventListener('input',()=>{state.f[key]=el.value; apply();}); };
  bind('#f-q','q'); bind('#f-min','min'); bind('#f-max','max');
  $('#f-factory')?.addEventListener('change',e=>{state.f.factory=e.target.value; apply();});
  $('#f-country')?.addEventListener('change',e=>{state.f.country=e.target.value; apply();});
  $('#f-photo')?.addEventListener('change',e=>{state.f.hasPhoto=e.target.checked; apply();});
  $('#f-price')?.addEventListener('change',e=>{state.f.hasPrice=e.target.checked; apply();});
  $('#sort')?.addEventListener('change',e=>{state.sort=e.target.value; apply();});
  $('#reset')?.addEventListener('click',()=>{
    state.f={q:'',cats:new Set(),factory:'',country:'',min:'',max:'',hasPhoto:false,hasPrice:false};
    state.sort='relevance';
    $$('#f-cats input').forEach(i=>i.checked=false);
    ['#f-factory','#f-country'].forEach(s=>{const e=$(s); if(e) e.value='';});
    ['#f-q','#f-min','#f-max'].forEach(s=>{const e=$(s); if(e) e.value='';});
    ['#f-photo','#f-price'].forEach(s=>{const e=$(s); if(e) e.checked=false;});
    if($('#sort')) $('#sort').value='relevance';
    apply();
  });
  $('#more')?.addEventListener('click',()=>{ state.shown += state.batch; render(); });
  $('#ftoggle')?.addEventListener('click',()=>{ $('#filters')?.classList.add('open'); document.body.style.overflow='hidden'; });
  $('#fclose')?.addEventListener('click',()=>{ $('#filters')?.classList.remove('open'); document.body.style.overflow=''; });
}

function buildFilters(){
  const cats = {}; const countries = {};
  for(const it of state.items){
    cats[it.kt] = (cats[it.kt]||0)+1;
    if(it.co) countries[it.co] = (countries[it.co]||0)+1;
  }
  const catBox = $('#f-cats');
  if(catBox){
    catBox.innerHTML = Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
      <label><input type="checkbox" value="${esc(k)}" ${state.f.cats.has(k)?'checked':''}>
      <span>${esc(k)}</span><span class="cnt">${v}</span></label>`).join('');
    $$('input',catBox).forEach(el=>el.addEventListener('change',()=>{
      const v = el.value;
      el.checked ? state.f.cats.add(v) : state.f.cats.delete(v);
      apply();
    }));
  }
  const fb = $('#f-factory');
  if(fb && !fb.options.length){
    fb.innerHTML = '<option value="">Все фабрики</option>' + state.facts
      .filter(f=>f.count>0).sort((a,b)=>b.count-a.count)
      .map(f=>`<option value="${esc(f.slug)}" ${state.f.factory===f.slug?'selected':''}>${esc(f.factory)} (${f.count})</option>`).join('');
  }
  const cb = $('#f-country');
  if(cb){
    cb.innerHTML = '<option value="">Все страны</option>' + Object.entries(countries)
      .sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<option value="${esc(k)}" ${state.f.country===k?'selected':''}>${esc(k)} (${v})</option>`).join('');
  }
}

// Поиск по словам с грубым русским стеммингом: иначе «кровать» не находит
// «кровати», а «детская» — «детские». Стемминг считается один раз на товар.
const RU_END = /(иями|ями|ами|ыми|ими|ов|ев|ей|ах|ях|ам|ям|ой|ый|ий|ая|ое|ые|ие|ия|ья|ье|ь|а|я|ы|и|о|е|у|ю)$/;
function stem(w){ return w.length > 4 ? w.replace(RU_END, '') : w; }
function hayOf(it){
  if(it._s === undefined){
    it._s = (it.t+' '+it.f+' '+it.kt+' '+(it.d||'')).toLowerCase()
      .split(/[^a-zа-яё0-9]+/).filter(Boolean).map(stem).join(' ');
  }
  return it._s;
}

function matches(it){
  const f = state.f;
  if(f.cats.size && !f.cats.has(it.kt)) return false;
  if(f.factory && it.fs!==f.factory) return false;
  if(f.country && it.co!==f.country) return false;
  if(f.hasPhoto && !it.im) return false;
  if(f.hasPrice && !it.p) return false;
  if(f.min!=='' && (it.p==null || it.p < +f.min)) return false;
  if(f.max!=='' && (it.p==null || it.p > +f.max)) return false;
  if(f.q){
    const words = f.q.toLowerCase().split(/\s+/).filter(Boolean).map(stem);
    const hay = hayOf(it);
    if(!words.every(w=>hay.includes(w))) return false;
  }
  return true;
}

function apply(){
  state.filtered = state.items.filter(matches);
  const s = state.sort;
  if(s==='price-asc') state.filtered.sort((a,b)=>(a.p??1e12)-(b.p??1e12));
  else if(s==='price-desc') state.filtered.sort((a,b)=>(b.p??-1)-(a.p??-1));
  else if(s==='name') state.filtered.sort((a,b)=>a.t.localeCompare(b.t,'ru'));
  state.shown = state.batch;
  render();
}

function px(u,w){
  // Фото лежат на сайтах фабрик: часть хостов не отдаёт картинки «чужим»
  // или отдаёт по 3 МБ. Гоняем через кэширующий прокси, который ещё и
  // ужимает до нужного размера; при сбое onerror вернёт прямой адрес.
  return u ? `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=${w}&output=webp&q=80` : '';
}
function card(it){
  const img = it.im
    ? `<img loading="lazy" src="${esc(px(it.im,420))}" data-src="${esc(it.im)}" alt="${esc(it.t)}"
        onerror="if(this.dataset.src&&this.src!==this.dataset.src){this.src=this.dataset.src}else{this.parentNode.innerHTML='<div class=noimg>нет фото</div>'}">`
    : '<div class="noimg">нет фото</div>';
  const price = it.p ? `<div class="price">${money(it.p)} <small>${esc(cur(it.c))}</small></div>`
                     : `<div class="price" style="color:#8b7f70;font-size:13px;font-weight:500">цена по запросу</div>`;
  return `<article class="card" data-id="${esc(it.i)}">
    <div class="ph">${img}</div>
    <div class="body">
      <span class="cat-tag">${esc(it.kt)}</span>
      <div class="name">${esc(it.t)}</div>
      ${price}
      <div class="factory">${esc(it.f)}</div>
    </div></article>`;
}

function render(){
  const grid = $('#grid'); if(!grid) return;
  const part = state.filtered.slice(0,state.shown);
  grid.innerHTML = part.map(card).join('') || '<div class="empty" style="grid-column:1/-1">Ничего не найдено. Попробуйте снять фильтры.</div>';
  $$('.card',grid).forEach(el=>el.addEventListener('click',()=>openProduct(el.dataset.id)));
  $('#count').textContent = state.filtered.length + ' ' +
    (state.loaded < state.total ? `из ${state.total} · загружено ${state.loaded}` : 'товаров');
  $('#more').style.display = state.filtered.length > state.shown ? 'inline-flex' : 'none';
}

function openProduct(id){
  const it = state.items.find(x=>x.i===id); if(!it) return;
  const ims = (it.ims&&it.ims.length?it.ims:[it.im]).filter(Boolean);
  const attrs = Object.entries(it.at||{});
  $('#dlg').innerHTML = `
    <div class="head"><b>${esc(it.kt)} · ${esc(it.f)}</b><button class="btn" onclick="closeModal()">Закрыть</button></div>
    <div class="body">
      <div class="gallery">
        <div class="main">${ims[0]?`<img src="${esc(px(ims[0],1000))}" data-src="${esc(ims[0])}" onerror="this.onerror=null;this.src=this.dataset.src" alt="">`:'<div class="noimg" style="height:100%;display:flex;align-items:center;justify-content:center;color:#b9ac9b">нет фото</div>'}</div>
        <div class="thumbs">${ims.slice(1).map(u=>`<img src="${esc(px(u,200))}" data-full="${esc(px(u,1000))}" data-src="${esc(u)}" onerror="this.onerror=null;this.src=this.dataset.src" onclick="this.closest('.gallery').querySelector('.main img').src=this.dataset.full">`).join('')}</div>
      </div>
      <div class="info">
        <h2>${esc(it.t)}</h2>
        <div class="fact">${esc(it.f)}${it.co?' · '+esc(it.co):''}${it.s?' · арт. '+esc(it.s):''}</div>
        <div class="price">${it.p?money(it.p)+' <small>'+esc(cur(it.c))+'</small>':'<span style="font-size:15px;color:#8b7f70;font-weight:500">цена по запросу</span>'}</div>
        ${it.d?`<div class="desc">${esc(it.d)}</div>`:''}
        ${attrs.length?`<table class="attrs">${attrs.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`:''}
        <div class="actions">
          ${it.u?`<a class="btn primary" href="${esc(it.u)}" target="_blank" rel="noopener">Открыть на сайте фабрики</a>`:''}
          ${it.fs?`<a class="btn" href="factories.html?f=${encodeURIComponent(it.fs)}">Все товары фабрики</a>`:''}
        </div>
      </div>
    </div>`;
  $('#modal').classList.add('open'); document.body.style.overflow='hidden';
  history.replaceState(null,'','?item='+encodeURIComponent(id));
}
function closeModal(){
  $('#modal').classList.remove('open'); document.body.style.overflow='';
  history.replaceState(null,'',location.pathname+location.search.replace(/[?&]item=[^&]*/,''));
}
window.closeModal = closeModal;
document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal();});
document.addEventListener('DOMContentLoaded',()=>{ if($('#grid')) boot(); });
