/* =============================================
   LINA E LISSA STORE – Catálogo
   Configurações da loja: js/config.js

   Colunas da planilha (linha 1, nesta ou em outra ordem):
   codigo | descricao | valor | tamanhos | cores | disponivel | categoria |
   estoque | detalhes | foto1..fotoN | video1..videoN
   ============================================= */

const CFG = Object.assign({
  nome: 'Lina e Lissa Store', sheetId: '', sheetName: 'Página1',
  whatsapp: '', instagram: '', moeda: 'R$', estoqueBaixo: 3
}, window.STORE_CONFIG || {});

const WHATSAPP  = String(CFG.whatsapp).replace(/\D/g, '');
const SHEET_OK  = !!CFG.sheetId && !/COLE_AQUI/i.test(CFG.sheetId);
const CSV_URL   = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(CFG.sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(CFG.sheetName)}`;
const PH        = 'images/placeholder.svg';
const CART_KEY  = 'lelStoreCart_v1';

// ─── UTILIDADES ────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const STROKE_ICONS = ['cart', 'share', 'link'];
const ico = (name, size = 18) =>
  `<svg class="ico${STROKE_ICONS.includes(name) ? ' ico-stroke' : ''}" width="${size}" height="${size}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const unidades = n => `${n} unidade${n === 1 ? '' : 's'}`;

// Mapa de nomes de cor → fundo CSS (sem acento, minúsculo). Amplie conforme precisar.
const RAINBOW = 'conic-gradient(#ff8fbf,#ffd23f,#8ee3c8,#8ec5ff,#c9a0f5,#ff8fbf)';
const COLOR_MAP = {
  'preto':'#1f1f1f', 'branco':'#f7f7f7', 'off white':'#f0ece4', 'cinza':'#9e9e9e', 'prata':'#c8ccd0', 'dourado':'#d4af37',
  'bege':'#d9c2a3', 'marrom':'#7b4f2e', 'vinho':'#6b1a2e', 'bordo':'#6b1a2e', 'caramelo':'#c68642',
  'rosa':'#ff8fbf', 'rosa claro':'#ffc2dc', 'pink':'#ff4fa0', 'vermelho':'#d83a3a',
  'laranja':'#ff9a3c', 'amarelo':'#ffd23f',
  'verde':'#4fb477', 'verde claro':'#a8e6c1', 'turquesa':'#2ec4c4',
  'azul':'#4a8fe0', 'azul claro':'#9fd0ff', 'azul marinho':'#1f3b73',
  'roxo':'#7b4fa6', 'lilas':'#c9a0f5', 'lilas claro':'#e3d0fb',
  'transparente':'#eaf6ff',
  'colorido':RAINBOW, 'multicolor':RAINBOW, 'arco iris':RAINBOW,
  'degrade':'linear-gradient(135deg,#9fd0ff,#ffd23f)',
};
const COLOR_KEYS = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length);

function corHex(nome) {
  const k = norm(nome).replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
  if (COLOR_MAP[k]) return COLOR_MAP[k];
  const part = COLOR_KEYS.find(key => k.includes(key));   // ex.: "Verde degradê" → verde
  return part ? COLOR_MAP[part] : '#d9d2e9';
}

// ─── ESTADO ────────────────────────────────────
let allProducts    = [];
let activeFilter   = 'Todos';
let searchTerm     = '';
let activeColor    = '';
let cart           = [];
let currentProduct = null;
let selectedSize   = null;
let selectedColor  = null;
let carouselIdx    = 0;
let carouselMedia  = [];
let lastFocus      = null;

// ─── INIT ──────────────────────────────────────
function init() {
  setupFooter();
  setupModal();
  setupCart();
  setupSearch();
  setupGrid();
  loadProducts();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

// ─── CARREGAR PLANILHA ─────────────────────────
function notice(icon, title, text, extra = '') {
  return `<div class="empty-state"><span>${icon}</span><strong>${esc(title)}</strong><p>${esc(text)}</p>${extra}</div>`;
}

async function loadProducts() {
  const grid = $('catalogGrid');
  const demo = new URLSearchParams(location.search).has('demo');

  if (demo) {
    allProducts = getDemoProducts();
  } else if (!SHEET_OK) {
    grid.innerHTML = notice('🛠️', 'Catálogo em configuração',
      'Falta informar o ID da planilha em js/config.js. Para ver uma prévia com produtos de exemplo, acrescente ?demo=1 ao endereço.');
    return;
  } else {
    try {
      grid.innerHTML = '<div class="loading">Carregando produtos...</div>';
      const r = await fetch(CSV_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (/^\s*</.test(text)) throw new Error('A planilha não está pública (retornou uma página de login).');
      allProducts = parseCSV(text);
    } catch (err) {
      console.error('Falha ao carregar a planilha:', err);
      grid.innerHTML = notice('😕', 'Não conseguimos carregar o catálogo agora',
        'Verifique sua conexão e tente novamente.',
        '<button class="btn-retry" id="btnRetry" type="button">Tentar novamente</button>');
      $('btnRetry').addEventListener('click', loadProducts);
      return;
    }
    if (!allProducts.length) {
      grid.innerHTML = notice('🧸', 'Ainda não há produtos por aqui', 'Volte em breve, estamos preparando novidades!');
      return;
    }
  }

  rehydrateCart();
  buildFilters();
  buildColorFilter();
  renderGrid();
  renderCart();
  openFromUrl();
}

// ─── PARSE CSV ─────────────────────────────────
// Lê CSV respeitando aspas e quebras de linha dentro das células.
function parseCSVRows(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function colIdx(header, aliases) {
  for (const a of aliases) { const i = header.indexOf(a); if (i >= 0) return i; }
  return -1;
}

function splitAttr(str) {
  if (!str) return [];
  return str.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

function parseCSV(text) {
  const rows = parseCSVRows(text);
  if (!rows.length) return [];
  const header = rows[0].map(norm);   // sem acento e minúsculo: "Descrição" → "descricao"

  const idx = {
    codigo:     colIdx(header, ['codigo', 'cod', 'sku']),
    descricao:  colIdx(header, ['descricao', 'nome', 'produto', 'description', 'name']),
    valor:      colIdx(header, ['valor', 'preco', 'price', 'value']),
    tamanhos:   colIdx(header, ['tamanhos', 'tamanho', 'sizes', 'size']),
    cores:      colIdx(header, ['cores', 'cor', 'colors', 'color']),
    disponivel: colIdx(header, ['disponivel', 'ativo', 'active', 'status']),
    categoria:  colIdx(header, ['categoria', 'category', 'cat']),
    estoque:    colIdx(header, ['estoque', 'qtd', 'quantidade', 'stock']),
    detalhes:   colIdx(header, ['detalhes', 'detalhe', 'observacao', 'observacoes', 'details']),
  };
  const colsStarting = (...prefixes) =>
    header.map((h, i) => prefixes.some(p => h.startsWith(p)) ? i : -1).filter(i => i >= 0);
  const fotoIdxs  = colsStarting('foto', 'photo');
  const videoIdxs = colsStarting('video');

  return rows.slice(1).map(c => {
    const get = i => (i >= 0 ? (c[i] ?? '') : '').trim();
    if (!get(idx.descricao) && !get(idx.codigo)) return null;

    const estRaw = get(idx.estoque);
    const estoque = /^\d+([.,]\d+)?$/.test(estRaw) ? Math.floor(parseFloat(estRaw.replace(',', '.'))) : null;
    const flagOff = ['nao', 'no', 'n', 'false', '0', 'esgotado', 'inativo'].includes(norm(get(idx.disponivel) || 'sim'));
    const disponivel = !flagOff && (estoque === null || estoque > 0);

    const fotos  = fotoIdxs.map(i => mediaFromUrl(get(i), 'image')).filter(Boolean);
    const videos = videoIdxs.map(i => mediaFromUrl(get(i), 'video')).filter(Boolean);
    const precoNum = parsePreco(get(idx.valor));

    return {
      codigo:    get(idx.codigo),
      nome:      get(idx.descricao) || get(idx.codigo),
      precoNum,
      preco:     precoNum ? fmt(precoNum) : '',
      tamanhos:  splitAttr(get(idx.tamanhos)),
      cores:     splitAttr(get(idx.cores)),
      disponivel,
      estoque,
      categoria: get(idx.categoria) || 'Outros',
      detalhes:  get(idx.detalhes),
      fotos, videos,
      media:     [...fotos, ...videos],
    };
  }).filter(Boolean);
}

// ─── PREÇOS ────────────────────────────────────
// Aceita "19,90", "R$ 19,90", "1.299,90", "19.9"; vazio ou inválido = 0 (sem preço)
function parsePreco(s) {
  if (s == null) return 0;
  s = String(s).replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : 0;
}
function fmt(n) { return n.toFixed(2).replace('.', ','); }
const money = n => `${CFG.moeda} ${fmt(n)}`;

// ─── GOOGLE DRIVE ──────────────────────────────
function driveId(url) {
  const m = url.match(/\/d\/([\w-]{10,})/) || url.match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}
const driveThumb = (id, w) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`;

function mediaFromUrl(raw, type) {
  raw = (raw || '').trim();
  if (!raw || raw === '.' || raw === '-') return null;
  const id = driveId(raw);
  if (id) {
    return type === 'video'
      ? { type, id, src: `https://drive.google.com/file/d/${id}/preview`, open: `https://drive.google.com/file/d/${id}/view` }
      : { type, id, src: driveThumb(id, 800) };
  }
  if (!/^https?:\/\//i.test(raw)) return null;
  return type === 'video'
    ? { type, src: raw, open: raw, direct: /\.(mp4|webm|ogg)(\?|$)/i.test(raw) }
    : { type, src: raw };
}

function thumbOf(p, w = 500) {
  const f = p.fotos[0];
  return f ? (f.id ? driveThumb(f.id, w) : f.src) : PH;
}

// ─── FILTROS CATEGORIA ─────────────────────────
function buildFilters() {
  const bar = $('filterBar');
  const cats = ['Todos', ...new Set(allProducts.map(p => p.categoria).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR')))];
  if (!cats.includes(activeFilter)) activeFilter = 'Todos';
  bar.innerHTML = cats.map(c =>
    `<button class="filter-btn${c === activeFilter ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}

// ─── FILTRO COR ────────────────────────────────
function buildColorFilter() {
  const sel = $('colorFilter');
  const seen = new Map();
  allProducts.flatMap(p => p.cores).forEach(c => { if (!seen.has(norm(c))) seen.set(norm(c), c); });
  const cores = [...seen.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  sel.innerHTML = '<option value="">🎨 Todas as cores</option>' +
    cores.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (activeColor && !seen.has(norm(activeColor))) activeColor = '';
  sel.value = activeColor;
}

// ─── BUSCA ─────────────────────────────────────
function setupSearch() {
  $('searchInput').addEventListener('input', e => { searchTerm = norm(e.target.value); renderGrid(); });
  $('colorFilter').addEventListener('change', e => { activeColor = e.target.value; renderGrid(); });
  $('filterBar').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    $('filterBar').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.cat;
    renderGrid();
  });
}

// ─── RENDER GRID ───────────────────────────────
function renderGrid() {
  const grid = $('catalogGrid');
  const filtered = allProducts.filter(p => {
    const catOk   = activeFilter === 'Todos' || p.categoria === activeFilter;
    const haystack = norm([p.nome, p.categoria, p.codigo, p.cores.join(' ')].join(' '));
    const termOk  = !searchTerm || haystack.includes(searchTerm);
    const colorOk = !activeColor || p.cores.some(c => norm(c) === norm(activeColor));
    return catOk && termOk && colorOk;
  });
  // disponíveis primeiro; esgotados vão para o fim (mantém a ordem da planilha dentro de cada grupo)
  filtered.sort((a, b) => Number(b.disponivel) - Number(a.disponivel));

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><span>🔍</span>Nenhum produto encontrado.</div>';
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const idx = allProducts.indexOf(p);
    const priceHTML = p.precoNum
      ? `<p class="card-price">${esc(money(p.precoNum))}</p>`
      : `<p class="card-price sem-preco">Consulte o preço</p>`;
    const mediaTxt = [p.videos.length ? '▶ vídeo' : '', p.fotos.length > 1 ? `${p.fotos.length} fotos` : ''].filter(Boolean).join(' · ');
    const mediaBadge = mediaTxt ? `<span class="card-foto-count">${mediaTxt}</span>` : '';
    const esgBadge = !p.disponivel ? `<span class="card-esgotado-badge">Esgotado</span>` : '';
    const quickAdd = p.disponivel ? `<button class="card-quick-add" type="button" data-idx="${idx}">+ Carrinho</button>` : '';
    const chips = p.cores.slice(0, 5).map(c =>
      `<span class="color-chip" style="background:${corHex(c)}" title="${esc(c)}"></span>`).join('');

    return `
      <article class="product-card${!p.disponivel ? ' esgotado' : ''}" data-idx="${idx}" tabindex="0">
        <div class="card-img-wrap">
          <img src="${esc(thumbOf(p))}" alt="${esc(p.nome)}" loading="lazy"/>
          ${esgBadge}${mediaBadge}${quickAdd}
          <button class="card-share" type="button" data-idx="${idx}" aria-label="Compartilhar ${esc(p.nome)}">${ico('share', 16)}</button>
        </div>
        <div class="card-body">
          <span class="card-category">${esc(p.categoria)}</span>
          <h3 class="card-name">${esc(p.nome)}</h3>
          ${chips ? `<div class="card-colors">${chips}</div>` : ''}
          ${priceHTML}
        </div>
      </article>`;
  }).join('');
}

// Eventos do grid (delegação: funcionam mesmo após filtrar/buscar)
function setupGrid() {
  const grid = $('catalogGrid');
  grid.addEventListener('click', e => {
    const share = e.target.closest('.card-share');
    if (share) { e.stopPropagation(); shareProduct(allProducts[+share.dataset.idx]); return; }
    const quick = e.target.closest('.card-quick-add');
    if (quick) {
      e.stopPropagation();
      const p = allProducts[+quick.dataset.idx];
      if (p.tamanhos.length > 1 || p.cores.length > 1) { openModal(p); return; }
      if (addToCart(p, p.tamanhos[0] || null, p.cores[0] || null)) {
        showToast(`"${p.nome.length > 28 ? p.nome.slice(0, 28) + '…' : p.nome}" adicionado 🛍️`);
      }
      return;
    }
    const card = e.target.closest('.product-card');
    if (card) openModal(allProducts[+card.dataset.idx]);
  });
  grid.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('product-card')) {
      e.preventDefault();
      openModal(allProducts[+e.target.dataset.idx]);
    }
  });
  // foto que não carrega (ex.: arquivo do Drive não está público) → imagem padrão
  grid.addEventListener('error', imgFallback, true);
  $('carouselTrack').addEventListener('error', imgFallback, true);
  $('cartItems').addEventListener('error', imgFallback, true);
}
function imgFallback(e) {
  const t = e.target;
  if (t.tagName === 'IMG' && !t.dataset.fb) { t.dataset.fb = '1'; t.src = PH; }
}

// ─── LINKS DE WHATSAPP E COMPARTILHAMENTO ──────
const waLink = (text, number = WHATSAPP) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
const productId = p => p.codigo || p.nome;

function baseUrl() { return location.href.split(/[?#]/)[0]; }
function productUrl(p) { return `${baseUrl()}?p=${encodeURIComponent(productId(p))}`; }

function singleItemMessage(p) {
  const attrs = [selectedSize && `Tamanho: ${selectedSize}`, selectedColor && `Cor: ${selectedColor}`].filter(Boolean).join(' | ');
  return `Olá! Vi no catálogo e tenho interesse:\n*${p.nome}*${attrs ? `\n${attrs}` : ''}${p.precoNum ? `\nValor: ${money(p.precoNum)}` : ''}\n\nPoderia me dar mais informações?`;
}
function notifyMessage(p) { return `Olá! Quero ser avisada quando voltar: *${p.nome}*`; }
function shareMessage(p) {
  return `✨ Olha que fofo! ✨\n*${p.nome}*${p.precoNum ? ` – ${money(p.precoNum)}` : ''}\n${productUrl(p)}`;
}

function shareProduct(p) {
  if (!p) return;
  window.open(`https://wa.me/?text=${encodeURIComponent(shareMessage(p))}`, '_blank', 'noopener');
}

async function copyProductLink(p) {
  const url = productUrl(p);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* sem suporte */ }
    ta.remove();
  }
  showToast('Link copiado 🔗');
}

// Link direto para um produto: …/?p=CODIGO
function openFromUrl() {
  const code = new URLSearchParams(location.search).get('p');
  if (!code) return;
  const p = allProducts.find(x => norm(productId(x)) === norm(code));
  if (p) openModal(p); else showToast('Produto não encontrado');
}
function setUrlProduct(code) {
  try {
    const q = new URLSearchParams(location.search);
    if (code) q.set('p', code); else q.delete('p');
    const s = q.toString();
    history.replaceState(null, '', baseUrl() + (s ? `?${s}` : ''));
  } catch { /* alguns navegadores bloqueiam em arquivos locais */ }
}

// ─── MODAL ─────────────────────────────────────
function setupModal() {
  $('modalClose').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeCart(); }
    if ($('modalOverlay').classList.contains('open')) {
      if (e.key === 'ArrowLeft')  goCarousel(-1);
      if (e.key === 'ArrowRight') goCarousel(1);
    }
  });
  $('carouselPrev').addEventListener('click', () => goCarousel(-1));
  $('carouselNext').addEventListener('click', () => goCarousel(1));
  $('carouselDots').addEventListener('click', e => {
    const d = e.target.closest('.carousel-dot');
    if (d) { stopVideos(); carouselIdx = +d.dataset.i; updateCarousel(); }
  });
  $('carouselTrack').addEventListener('click', e => {
    const poster = e.target.closest('.video-poster');
    if (poster) playVideo(+poster.dataset.i);
  });
  // deslizar com o dedo
  let x0 = null, y0 = null;
  const track = $('carouselTrack');
  track.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  track.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = y0 = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) goCarousel(dx < 0 ? 1 : -1);
  }, { passive: true });

  $('btnShare').addEventListener('click', () => shareProduct(currentProduct));
  $('btnCopy').addEventListener('click', () => currentProduct && copyProductLink(currentProduct));
}

function updateSingleLink() {
  if (currentProduct) $('modalWhatsapp').href = waLink(singleItemMessage(currentProduct));
}

function openModal(product) {
  if (!product) return;
  currentProduct = product;
  selectedSize   = product.tamanhos.length === 1 ? product.tamanhos[0] : null;   // só uma opção: já vem escolhida
  selectedColor  = product.cores.length === 1 ? product.cores[0] : null;
  carouselIdx    = 0;
  lastFocus      = document.activeElement;

  $('modalCategory').textContent = product.categoria;
  $('modalName').textContent     = product.nome;
  $('modalPrice').textContent    = product.precoNum ? money(product.precoNum) : 'Consulte o preço';
  $('modalDesc').textContent     = product.detalhes || '';
  $('modalDesc').style.display   = product.detalhes ? '' : 'none';

  // Esgotado / estoque baixo
  const low = $('modalLow');
  const baixo = product.disponivel && product.estoque !== null && product.estoque <= CFG.estoqueBaixo;
  low.textContent = baixo ? (product.estoque === 1 ? 'Última unidade!' : `Restam ${product.estoque} unidades`) : '';
  low.style.display = baixo ? 'inline' : 'none';
  $('modalEsgotado').style.display     = product.disponivel ? 'none' : 'inline';
  $('modalActions').style.display      = product.disponivel ? 'flex' : 'none';
  $('modalEsgotadoInfo').style.display = product.disponivel ? 'none' : 'flex';
  $('modalNotify').href = waLink(notifyMessage(product));

  // Carrossel (fotos + vídeos)
  carouselMedia = product.media.length ? product.media : [{ type: 'image', src: PH }];
  buildCarousel();

  // Cores
  const colorOpts = $('colorOptions');
  if (product.cores.length) {
    colorOpts.innerHTML = product.cores.map(c => `
      <button type="button" class="color-btn${c === selectedColor ? ' selected' : ''}" data-color="${esc(c)}"
              style="background:${corHex(c)}" title="${esc(c)}" aria-label="Cor ${esc(c)}">
        <span class="color-name-tip">${esc(c)}</span>
      </button>`).join('');
    colorOpts.querySelectorAll('.color-btn').forEach(b => b.addEventListener('click', () => {
      colorOpts.querySelectorAll('.color-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      selectedColor = b.dataset.color;
      $('colorChosen').textContent = selectedColor;
      updateSingleLink();
    }));
    $('colorChosen').textContent = selectedColor || '';
    $('colorRow').style.display = 'flex';
  } else {
    $('colorRow').style.display = 'none';
  }

  // Tamanhos
  const sizeOpts = $('sizeOptions');
  if (product.tamanhos.length) {
    sizeOpts.innerHTML = product.tamanhos.map(t =>
      `<button type="button" class="attr-btn${t === selectedSize ? ' selected' : ''}" data-size="${esc(t)}">${esc(t)}</button>`).join('');
    sizeOpts.querySelectorAll('.attr-btn').forEach(b => b.addEventListener('click', () => {
      sizeOpts.querySelectorAll('.attr-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      selectedSize = b.dataset.size;
      updateSingleLink();
    }));
    $('sizeRow').style.display = 'flex';
  } else {
    $('sizeRow').style.display = 'none';
  }

  // Botão adicionar
  const btnAdd = $('btnAddCart');
  btnAdd.innerHTML = `${ico('cart')} Adicionar ao carrinho`;
  btnAdd.classList.remove('added');
  btnAdd.onclick = () => {
    if (product.tamanhos.length && !selectedSize)  { showToast('Selecione um tamanho 👆'); return; }
    if (product.cores.length    && !selectedColor) { showToast('Selecione uma cor 👆');    return; }
    if (!addToCart(product, selectedSize, selectedColor)) return;
    btnAdd.innerHTML = '✓ Adicionado!';
    btnAdd.classList.add('added');
    setTimeout(closeModal, 700);
  };

  updateSingleLink();
  setUrlProduct(productId(product));
  $('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('modalClose').focus();
}

function closeModal() {
  const ov = $('modalOverlay');
  if (!ov.classList.contains('open')) return;
  stopVideos();
  ov.classList.remove('open');
  document.body.style.overflow = '';
  setUrlProduct(null);
  currentProduct = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

// ─── CARROSSEL ─────────────────────────────────
function slideHtml(m, i) {
  if (m.type === 'video') {
    const poster = currentProduct && currentProduct.fotos[0] ? thumbOf(currentProduct, 800) : null;
    return `<div class="slide slide-video" data-i="${i}">
      <button type="button" class="video-poster" data-i="${i}" aria-label="Reproduzir vídeo">
        ${poster ? `<img src="${esc(poster)}" alt="" loading="lazy"/>` : ''}
        <span class="play-btn">${ico('play', 34)}</span><span class="video-tag">Vídeo</span>
      </button></div>`;
  }
  return `<div class="slide"><img src="${esc(m.src)}" alt="Foto do produto" loading="lazy"/></div>`;
}

function buildCarousel() {
  $('carouselTrack').innerHTML = carouselMedia.map(slideHtml).join('');
  $('carouselDots').innerHTML = carouselMedia.map((_, i) =>
    `<span class="carousel-dot${i === 0 ? ' active' : ''}" data-i="${i}"></span>`).join('');
  const many = carouselMedia.length > 1;
  $('carouselPrev').classList.toggle('hidden', !many);
  $('carouselNext').classList.toggle('hidden', !many);
  $('carouselDots').style.display = many ? 'flex' : 'none';
  updateCarousel();
}

function goCarousel(dir) {
  if (carouselMedia.length < 2) return;
  stopVideos();
  carouselIdx = (carouselIdx + dir + carouselMedia.length) % carouselMedia.length;
  updateCarousel();
}

function updateCarousel() {
  $('carouselTrack').style.transform = `translateX(-${carouselIdx * 100}%)`;
  document.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === carouselIdx));
}

// O vídeo só é carregado quando a pessoa toca no play (economiza internet e evita travar)
function playVideo(i) {
  const m = carouselMedia[i], slide = document.querySelector(`.slide-video[data-i="${i}"]`);
  if (!m || !slide) return;
  slide.classList.add('playing');
  slide.innerHTML = m.direct
    ? `<video src="${esc(m.src)}" controls autoplay playsinline></video>`
    : `<iframe src="${esc(m.src)}" allow="autoplay; fullscreen" allowfullscreen title="Vídeo do produto"></iframe>
       <a class="video-open" href="${esc(m.open)}" target="_blank" rel="noopener">Abrir vídeo em outra aba</a>`;
}
function stopVideos() {
  document.querySelectorAll('.slide-video.playing').forEach(s => {
    s.outerHTML = slideHtml(carouselMedia[+s.dataset.i], +s.dataset.i);
  });
}

// ─── CARRINHO ──────────────────────────────────
function setupCart() {
  $('cartFab').addEventListener('click', openCart);
  $('cartClose').addEventListener('click', closeCart);
  $('cartOverlay').addEventListener('click', e => { if (e.target === $('cartOverlay')) closeCart(); });
  $('btnSendOrder').addEventListener('click', sendOrder);
  $('btnClearCart').addEventListener('click', () => {
    if (confirm('Limpar todos os itens?')) { cart = []; saveCart(); renderCart(); }
  });
  $('cartItems').addEventListener('click', e => {
    const q = e.target.closest('.qty-btn'), r = e.target.closest('.btn-remove-item');
    if (q) {
      const i = +q.dataset.i, item = cart[i];
      if (!item) return;
      if (q.dataset.a === 'inc') { if (!stockOk(item.product)) return; item.qtd++; }
      else { item.qtd--; if (item.qtd <= 0) cart.splice(i, 1); }
    } else if (r) cart.splice(+r.dataset.i, 1);
    else return;
    saveCart(); renderCart();
  });
}

const itemKey = (p, size, color) => [productId(p), size || '', color || ''].join('|');
const qtyInCart = p => cart.filter(i => i.product === p).reduce((s, i) => s + i.qtd, 0);

// Não deixa colocar no carrinho mais unidades do que o estoque
function stockOk(p) {
  if (p.estoque !== null && qtyInCart(p) + 1 > p.estoque) {
    showToast(`Só temos ${unidades(p.estoque)} em estoque`);
    return false;
  }
  return true;
}

function addToCart(product, size, color) {
  if (!product.disponivel) { showToast('Produto esgotado'); return false; }
  if (!stockOk(product)) return false;
  const key = itemKey(product, size, color);
  const ex = cart.find(i => i.key === key);
  if (ex) ex.qtd++; else cart.push({ key, product, size, color, qtd: 1 });
  saveCart(); renderCart(); bumpBadge();
  return true;
}

// Guarda o carrinho no aparelho para não perder se a página recarregar
function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(
      cart.map(i => ({ id: productId(i.product), size: i.size, color: i.color, qtd: i.qtd }))));
  } catch { /* armazenamento indisponível: segue sem salvar */ }
}

function rehydrateCart() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { saved = []; }
  cart = []; let dropped = 0;
  (Array.isArray(saved) ? saved : []).forEach(s => {
    const p = allProducts.find(x => productId(x) === s.id);
    const okSize  = !s.size  || (p && p.tamanhos.includes(s.size));
    const okColor = !s.color || (p && p.cores.includes(s.color));
    if (!p || !p.disponivel || !okSize || !okColor) { dropped++; return; }
    const room = p.estoque === null ? Infinity : p.estoque - qtyInCart(p);
    const qtd = Math.min(Math.max(1, parseInt(s.qtd, 10) || 1), room);
    if (qtd < 1) { dropped++; return; }
    const key = itemKey(p, s.size, s.color);
    const ex = cart.find(i => i.key === key);
    if (ex) ex.qtd += qtd; else cart.push({ key, product: p, size: s.size || null, color: s.color || null, qtd });
  });
  if (dropped) setTimeout(() => showToast('Alguns itens do carrinho não estão mais disponíveis'), 600);
  saveCart();
}

function cartTotals() {
  let total = 0, semPreco = false;
  cart.forEach(i => { if (i.product.precoNum) total += i.product.precoNum * i.qtd; else semPreco = true; });
  return { total, semPreco };
}

function renderCart() {
  const itemsEl = $('cartItems'), emptyEl = $('cartEmpty'), footerEl = $('cartFooter');
  $('cartBadge').textContent = cart.reduce((s, i) => s + i.qtd, 0);

  if (!cart.length) {
    itemsEl.innerHTML = '';
    emptyEl.style.display = 'flex';
    footerEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  footerEl.style.display = 'flex';

  itemsEl.innerHTML = cart.map((item, i) => {
    const p = item.product;
    const sub = p.precoNum ? money(p.precoNum * item.qtd) : 'A consultar';
    const unit = p.precoNum && item.qtd > 1 ? `<span class="cart-item-attrs">${item.qtd} × ${esc(money(p.precoNum))}</span>` : '';
    const attrs = [item.size && `Tam: ${item.size}`, item.color && `Cor: ${item.color}`].filter(Boolean).join(' · ');
    return `
      <div class="cart-item" data-i="${i}">
        <img class="cart-item-img" src="${esc(thumbOf(p, 200))}" alt="${esc(p.nome)}"/>
        <div class="cart-item-info">
          <span class="cart-item-name">${esc(p.nome)}</span>
          ${attrs ? `<span class="cart-item-attrs">${esc(attrs)}</span>` : ''}
          ${unit}
          <span class="cart-item-price">${esc(sub)}</span>
        </div>
        <div class="cart-item-controls">
          <div class="qty-row">
            <button class="qty-btn" type="button" data-a="dec" data-i="${i}" aria-label="Diminuir">−</button>
            <span class="qty-num">${item.qtd}</span>
            <button class="qty-btn" type="button" data-a="inc" data-i="${i}" aria-label="Aumentar">+</button>
          </div>
          <button class="btn-remove-item" type="button" data-i="${i}">remover</button>
        </div>
      </div>`;
  }).join('');

  const { total, semPreco } = cartTotals();
  $('cartTotal').textContent = total ? money(total) : '—';
  $('cartObs').style.display = semPreco ? 'block' : 'none';
}

function bumpBadge() {
  const b = $('cartBadge');
  b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  setTimeout(() => b.classList.remove('bump'), 300);
}

function openCart()  { renderCart(); $('cartOverlay').classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeCart() {
  if (!$('cartOverlay').classList.contains('open')) return;
  $('cartOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function buildOrderMessage() {
  let msg = `🌈 *Olá, ${CFG.nome}!*\nGostaria de fazer um pedido:\n\n`;
  cart.forEach((item, i) => {
    const p = item.product;
    msg += `*${i + 1}. ${p.nome}*\n`;
    if (p.codigo)    msg += `   Cód.: ${p.codigo}\n`;
    if (item.color)  msg += `   Cor: ${item.color}\n`;
    if (item.size)   msg += `   Tamanho: ${item.size}\n`;
    msg += p.precoNum
      ? `   Qtd: ${item.qtd} × ${money(p.precoNum)} = ${money(p.precoNum * item.qtd)}\n\n`
      : `   Qtd: ${item.qtd} | valor a consultar\n\n`;
  });
  const { total, semPreco } = cartTotals();
  if (total) msg += `*Total estimado: ${money(total)}*${semPreco ? ' (+ itens a consultar)' : ''}\n\n`;
  msg += `Aguardo confirmação de disponibilidade e pagamento. Obrigada! 😊`;
  return msg;
}

function sendOrder() {
  if (!cart.length) return;
  window.open(waLink(buildOrderMessage()), '_blank', 'noopener');
}

// ─── RODAPÉ ────────────────────────────────────
function setupFooter() {
  $('footerWhats').href = waLink('Olá! Vim pelo catálogo da ' + CFG.nome + '.');
  $('footerCopy').textContent = `© ${new Date().getFullYear()} ${CFG.nome}`;
  const handle = String(CFG.instagram || '').replace(/^@/, '').trim();
  if (handle) {
    $('footerInstagram').href = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    $('footerInstagramText').textContent = `@${handle}`;
    $('footerInstagram').style.display = 'inline-flex';
  }
}

// ─── TOAST ─────────────────────────────────────
let toastTimer;
function showToast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ─── DEMO (use ?demo=1 no endereço para ver a prévia) ──
function getDemoProducts() {
  const mk = (codigo, nome, preco, cores, categoria, extra = {}) => {
    const precoNum = parsePreco(preco);
    return Object.assign({
      codigo, nome, precoNum, preco: precoNum ? fmt(precoNum) : '', tamanhos: [], cores, disponivel: true, estoque: null,
      categoria, detalhes: '', fotos: [], videos: [], media: []
    }, extra);
  };
  return [
    mk('CHV-001', 'Chaveiro Leopardo Adorable', '14,90', ['Bege'], 'Chaveiros', { detalhes: 'Chaveiro de silicone com alça e argola dourada.', estoque: 8 }),
    mk('CHV-005', 'Chaveiro Girafa Adorable',   '14,90', ['Laranja'], 'Chaveiros', { estoque: 2 }),
    mk('CHV-007', 'Chaveiro Zebra Adorable',    '14,90', ['Preto', 'Branco'], 'Chaveiros'),
    mk('SQU-001', 'Squish Pãozinho Rosa',       '12,00', ['Rosa'], 'Squishies'),
    mk('SQU-003', 'Squish Pãozinho Arco-íris',  '15,00', ['Colorido'], 'Squishies', { disponivel: false, estoque: 0 }),
    mk('SQU-005', 'Squish Glitter Lilás',       '',      ['Lilás'], 'Squishies'),
    mk('PUL-001', 'Pulseira de Miçangas Flor',  '9,90',  ['Rosa', 'Azul claro', 'Verde'], 'Pulseiras', { tamanhos: ['P', 'M'] }),
    mk('COL-001', 'Colar de Miçangas Arco-íris','19,90', ['Colorido'], 'Colares'),
  ];
}
