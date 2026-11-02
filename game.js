'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 훌라: 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_HULA). 여기서는 st.events 를 보고 소리·표시를 만든다.
const L = LOGIC_HULA;
const W = 240, H = 300;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const ctrlH = $('controls').offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / H);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * H / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('hulaMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function noise(dur, vol = 0.08, lowpass = 3000) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(audio.destination); s.start();
  } catch (_) {}
}
const melody = (notes, step, type = 'sine', vol = 0.06) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  card: () => noise(0.05, 0.06, 4000),
  select: () => tone(700, 0.03, 'triangle', 0.03),
  register: () => melody([523, 659, 784], 60, 'triangle', 0.05),
  attach: () => tone(900, 0.07, 'triangle', 0.05),
  thank: () => melody([784, 988, 1175], 70, 'square', 0.04),
  stop: () => melody([440, 330], 120, 'sawtooth', 0.05),
  win: () => melody([523, 659, 784, 1047], 90),
  lose: () => melody([330, 262, 196], 160, 'sawtooth', 0.04),
  bad: () => tone(160, 0.12, 'square', 0.04),
  start: () => melody([392, 494, 587], 90),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused
let labels = ['', '', '', ''];
let selected = new Set();
let attachMode = null;                         // 붙일 수 있는 묶음 id 목록 (고르는 중)
let banner = { text: '', sub: '', t: 0 };
let cpuT = 0, sortBy = 'suit', hint = '', pausedFrom = null, bestScore = Number(store.get('hulaBest')) || 0, fxs = [];
const hits = { hand: [], melds: [], stock: null, discard: null };

/* @test-hooks:start */
window.__hl = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt) };
/* @test-hooks:end */

// ---------- 흐름 ----------
function bindOverlay() { document.querySelectorAll('#overlay button').forEach((b) => { b.onclick = () => onOverlayButton(b.dataset.level); }); }
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); bindOverlay(); }
const LEVEL_BUTTONS = '<div class="lv"><button id="startBtn" data-level="easy">쉬움<small>컴퓨터가 가끔 실수해요</small></button><button id="startBtn2" data-level="normal">보통<small>컴퓨터가 실수하지 않아요</small></button></div><p class="note">쉬움에서는 최고 기록이 저장되지 않아요</p>';
function hideOverlay() { $('overlay').classList.add('hidden'); }
function setBanner(text, sub = '', t = 2) { banner = { text, sub, t }; }
let overlayMode = 'start';
function onOverlayButton(level) {
  if (state === 'paused') { resume(); return; }
  if (overlayMode === 'next') { hideOverlay(); L.nextRound(G); selected.clear(); labels = ['', '', '', '']; handleEvents(); refresh(); return; }
  startGame(level);
}
function startGame(level) {
  if (/[?&]tutorial=1/.test(location.search)) level = 'easy';
  level = level || store.get('hulaLevel');
  level = level === 'normal' ? 'normal' : 'easy';
  G = L.newGame(Math.random, { level });
  store.set('hulaLevel', level);
  if (/[?&]tutorial=1/.test(location.search)) rigTutorial();
  selected.clear(); labels = ['', '', '', '']; attachMode = null; fxs = []; cpuT = 0;
  state = 'play'; overlayMode = 'start';
  hideOverlay(); sfx.start(); handleEvents(); refresh();
  setBanner('ROUND 1', `${G.rounds}판 승부 · ${G.difficulty === 'easy' ? '쉬움' : '보통'}`, 1.6);
}
// 튜토리얼: 처음부터 내 차례에 등록할 수 있는 카드(5 세 장)를 쥐여 준다
function rigTutorial() {
  const want = [[5, 0], [5, 1], [5, 2], [9, 3], [11, 1], [2, 0], [3, 2]].map(([r, s]) => L.makeCard(r, s));
  const me = G.players[0];
  for (const w of want) {
    if (me.hand.includes(w)) continue;
    const spare = me.hand.find((c) => !want.includes(c));
    const holder = G.players.find((p, i) => i > 0 && p.hand.includes(w));
    if (holder) { holder.hand[holder.hand.indexOf(w)] = spare; me.hand[me.hand.indexOf(spare)] = w; }
    else if (G.stock.includes(w)) { G.stock[G.stock.indexOf(w)] = spare; me.hand[me.hand.indexOf(spare)] = w; }
    else if (G.discard.includes(w)) { G.discard[G.discard.indexOf(w)] = spare; me.hand[me.hand.indexOf(spare)] = w; }
  }
  me.hand.sort((a, b) => a - b);
  G.turn = 0; G.phase = 'draw'; G.mustUse = null;
}
function pause() {
  if (state !== 'play') return;
  pausedFrom = state; state = 'paused';
  showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }

const nm = (i) => G.players[i].name;
const cardsText = (cs) => cs.map(L.cardName).join('');
function handleEvents() {
  const evs = G.events; G.events = [];
  for (const e of evs) {
    if (e.t === 'turn') { selected.clear(); attachMode = null; labels[e.who] = labels[e.who] && G.phase !== 'draw' ? labels[e.who] : ''; hint = ''; }
    else if (e.t === 'draw') { labels[e.who] = '더미에서 뽑음'; sfx.card(); if (e.who === 0) tutorialSignal('draw'); }
    else if (e.t === 'thankyou') { labels[e.who] = `땡큐! ${L.cardName(e.card)}`; sfx.thank(); if (e.who === 0) tutorialSignal('thankyou'); else setBanner('땡큐!', `${nm(e.who)}: ${L.cardName(e.card)}`, 1.2); }
    else if (e.t === 'register') { labels[e.who] = `등록 ${cardsText(e.cards)}`; sfx.register(); if (e.who === 0) tutorialSignal('register'); }
    else if (e.t === 'attach') { labels[e.who] = `붙이기 ${L.cardName(e.card)}`; sfx.attach(); if (e.who === 0) tutorialSignal('attach'); }
    else if (e.t === 'discard') { labels[e.who] = `버림 ${L.cardName(e.card)}`; sfx.card(); if (e.who === 0) tutorialSignal('discard'); }
    else if (e.t === 'stop') { sfx.stop(); setBanner(e.success ? '스톱 성공!' : '스톱 실패…', `${nm(e.who)}: ${e.total}점`, 1.8); }
    else if (e.t === 'out') { setBanner(e.hula ? '훌라!!' : `${nm(e.who)} 나감`, e.hula ? `${nm(e.who)}: 한 번에 모두 털었어요 (점수 ×2)` : '', 1.8); }
    else if (e.t === 'roundend') showRoundEnd(e.result);
  }
}
const KIND = { out: '나감', hula: '훌라 (×2)', stop: '스톱', exhausted: '더미 소진' };
function showRoundEnd(r) {
  const me = r.deltas[0];
  (me > 0 ? sfx.win : me < 0 ? sfx.lose : sfx.card)();
  if (r.winner === 0) tutorialSignal('roundwin');
  const rows = G.players.map((p, i) => `<tr><td>${p.name}</td><td>${r.totals[i]}점</td><td style="color:${r.deltas[i] >= 0 ? '#9ae8a8' : '#ff9a9a'}">${r.deltas[i] >= 0 ? '+' : ''}${r.deltas[i]}</td><td>${p.score}</td></tr>`).join('');
  const title = r.kind === 'stop' ? (r.success ? `${nm(r.stopper)} 스톱 성공!` : `${nm(r.stopper)} 스톱 실패!`) : r.kind === 'exhausted' ? (r.winner >= 0 ? `더미 소진 · ${nm(r.winner)} 승` : '더미 소진 · 무승부') : `${nm(r.winner)} ${KIND[r.kind]}!`;
  const final = G.phase === 'matchover';
  let extra = '';
  if (final) {
    const rank = L.ranking(G); const first = rank[0];
    extra = `<p class="big">${first === 0 ? '🏆 우승!' : `우승: ${nm(first)}`}</p>`;
    if (G.difficulty === 'normal' && G.players[0].score > bestScore) { bestScore = G.players[0].score; store.set('hulaBest', String(bestScore)); extra += '<p>🏆 내 최고 점수!</p>'; }
  }
  overlayMode = final ? 'start' : 'next';
  setTimeout(() => {
    if (state !== 'play' && state !== 'paused') return;
    showOverlay(`<h2>${final ? '게임 끝' : `${G.round}/${G.rounds}판 끝`}</h2><p class="big">${title}</p><table style="font-size:12px;border-spacing:8px 2px"><tr style="opacity:.6"><td></td><td>손패</td><td>이번</td><td>합계</td></tr>${rows}</table>${extra}${final ? LEVEL_BUTTONS : '<button id="startBtn">다음 판</button>'}`);
  }, 1100);
}

function update(dt) {
  if (state !== 'play') return;
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  banner.t = Math.max(0, banner.t - dt);
  if ((G.phase === 'draw' || G.phase === 'play') && !G.players[G.turn].human) {
    cpuT += dt;
    if (cpuT >= 0.85) { cpuT = 0; L.cpuStep(G); handleEvents(); refresh(); }
  } else cpuT = 0;
}

// ---------- 버튼 ----------
const myTurn = () => state === 'play' && (G.phase === 'draw' || G.phase === 'play') && G.players[G.turn].human;
const selCards = () => [...selected].filter((c) => G.players[0].hand.includes(c));
function attachTargets(card) { return G.players[0].registered ? G.melds.filter((m) => L.canAttach(m, card)).map((m) => m.id) : []; }
function refresh() {
  const mine = myTurn(), draw = mine && G.phase === 'draw', play = mine && G.phase === 'play';
  const sel = selCards();
  $('btnDraw').disabled = !draw;
  $('btnThank').disabled = !(draw && L.canThankYou(G));
  $('btnStop').disabled = !(draw && L.canStop(G));
  $('btnReg').disabled = !(play && sel.length > 0 && L.makeMeld(sel));
  $('btnAttach').disabled = !(play && sel.length === 1 && attachTargets(sel[0]).length > 0);
  $('btnDiscard').disabled = !(play && sel.length === 1 && G.mustUse === null);
  $('btnThank').innerHTML = G.discard.length ? `땡큐<small>${L.cardName(G.discard[G.discard.length - 1])}</small>` : '땡큐';
  $('btnStop').innerHTML = draw && L.canStop(G) ? `스톱<small>${L.handPoints(G.players[0].hand)}점</small>` : '스톱';
  if (!mine) hint = state === 'play' && G.phase !== 'roundover' && G.phase !== 'matchover' ? `${G.players[G.turn].name} 차례…` : '';
  else if (draw) hint = `내 차례: 더미를 뽑거나, 버린 카드가 쓸모있으면 땡큐${L.canStop(G) ? ' (스톱도 가능)' : ''}`;
  else if (G.mustUse !== null) hint = `땡큐로 가져온 ${L.cardName(G.mustUse)} 를 먼저 등록하세요`;
  else if (attachMode) hint = '붙일 묶음을 눌러요';
  else hint = '카드를 골라 등록 · 붙이기 · 버리기';
}
function doDraw() { if (!(myTurn() && G.phase === 'draw')) return; if (L.draw(G, 'stock')) { handleEvents(); refresh(); } }
function doThank() { if (!(myTurn() && G.phase === 'draw')) return; if (L.draw(G, 'discard')) { handleEvents(); refresh(); } else sfx.bad(); }
function doStop() { if (!(myTurn() && G.phase === 'draw')) return; if (L.stop(G)) { handleEvents(); refresh(); } }
function doReg() { if (!(myTurn() && G.phase === 'play')) return; const sel = selCards(); if (L.register(G, sel)) { selected.clear(); handleEvents(); refresh(); } else sfx.bad(); }
function doDiscard() { if (!(myTurn() && G.phase === 'play')) return; const sel = selCards(); if (sel.length === 1 && L.discard(G, sel[0])) { selected.clear(); handleEvents(); refresh(); } else sfx.bad(); }
function doAttach() {
  if (!(myTurn() && G.phase === 'play')) return;
  const sel = selCards(); if (sel.length !== 1) return;
  const targets = attachTargets(sel[0]);
  if (!targets.length) { sfx.bad(); return; }
  if (targets.length === 1) { if (L.attach(G, sel[0], targets[0])) { selected.clear(); handleEvents(); refresh(); } return; }
  attachMode = targets; refresh();
}
function sortHand() { sortBy = sortBy === 'suit' ? 'rank' : 'suit'; }
$('btnDraw').onclick = doDraw; $('btnThank').onclick = doThank; $('btnStop').onclick = doStop;
$('btnReg').onclick = doReg; $('btnAttach').onclick = doAttach; $('btnDiscard').onclick = doDiscard;
$('btnSort').onclick = () => { sortHand(); };

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * H / r.height;
  const inside = (b) => b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  if (attachMode) {
    const m = hits.melds.find((b) => inside(b) && attachMode.includes(b.id));
    const sel = selCards();
    if (m && sel.length === 1 && L.attach(G, sel[0], m.id)) { selected.clear(); attachMode = null; handleEvents(); refresh(); return; }
    attachMode = null; refresh(); return;
  }
  for (let i = hits.hand.length - 1; i >= 0; i--) { const b = hits.hand[i]; if (inside(b)) { if (selected.has(b.card)) selected.delete(b.card); else selected.add(b.card); sfx.select(); refresh(); return; } }
  if (inside(hits.stock)) doDraw(); else if (inside(hits.discard)) doThank();
});
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (state === 'title') { if (k === 'enter' || k === ' ') { e.preventDefault(); onOverlayButton(); } return; }
  if (state === 'paused') { if (k === 'p' || k === 'enter') resume(); return; }
  if (!$('overlay').classList.contains('hidden')) { if (k === 'enter' || k === ' ') { e.preventDefault(); onOverlayButton(); } return; }
  if (k === 'p') pause(); else if (k === 'm') toggleMute();
  else if (k === 'd') doDraw(); else if (k === 't') doThank(); else if (k === 's') doStop();
  else if (k === 'r') doReg(); else if (k === 'a') doAttach(); else if (k === 'x') doDiscard();
});

// ---------- 그리기 ----------
function roundRect(x, y, w, h, r, fill, stroke) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }
function drawCard(card, x, y, w, h, opt = {}) {
  if (card === null) { roundRect(x, y, w, h, 2, '#2a4ab8', '#fff'); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4); return; }
  roundRect(x, y, w, h, 2.5, opt.dim ? '#c8c8c8' : '#fff', opt.sel ? '#ffd23a' : '#222');
  const s = L.suitOf(card), red = s === 1 || s === 2;
  ctx.fillStyle = red ? '#d82a2a' : '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(h * 0.34)}px sans-serif`; ctx.fillText(L.RANK_NAMES[L.rankOf(card)], x + w / 2, y + h * 0.28);
  ctx.font = `${Math.round(h * 0.4)}px sans-serif`; ctx.fillText(L.SUITS[s], x + w / 2, y + h * 0.68);
}
function text(t, x, y, color = '#fff', size = 8, align = 'center', bold = true) { ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(t, x, y); }
function plate(i, cx, cy) {
  const p = G.players[i], active = (G.phase === 'draw' || G.phase === 'play') && G.turn === i;
  roundRect(cx - 28, cy - 8, 56, 19, 5, active ? 'rgba(255,225,74,.95)' : 'rgba(0,0,0,.55)', active ? '#fff' : null);
  text(`${p.name}${G.dealer === i ? ' ⓓ' : ''}`, cx, cy - 1, active ? '#000' : '#fff', 8);
  text(`${p.score >= 0 ? '+' : ''}${p.score}점 · ${p.hand.length}장`, cx, cy + 7.5, active ? '#3a2a00' : '#ffe14a', 7);
}
function fan(n, cx, y, w, h, step) { const total = (n - 1) * step + w; for (let k = 0; k < n; k++) drawCard(null, cx - total / 2 + k * step, y, w, h); }
function drawMelds() {
  hits.melds = [];
  let x = 8, y = 106; const mh = 16, mw = 11, step = 8;
  for (const m of G.melds) {
    const w = (m.cards.length - 1) * step + mw + 6;
    if (x + w > W - 6) { x = 8; y += mh + 6; }
    const targetable = attachMode && attachMode.includes(m.id);
    roundRect(x - 2, y - 2, w, mh + 4, 3, targetable ? 'rgba(255,225,74,.45)' : 'rgba(255,255,255,.08)', targetable ? '#ffe14a' : 'rgba(255,255,255,.2)');
    m.cards.forEach((c, k) => drawCard(c, x + k * step, y, mw, mh));
    ctx.fillStyle = ['#fff', '#7fd0ff', '#ff9ac8', '#ffe14a'][m.owner]; ctx.fillRect(x - 2, y + mh + 2, 2.5, 1.5);
    hits.melds.push({ id: m.id, x: x - 2, y: y - 2, w, h: mh + 4 });
    x += w + 3;
  }
  if (!G.melds.length) text('등록한 묶음이 여기에 놓여요', 120, 130, 'rgba(255,255,255,.35)', 8);
}
function draw() {
  ctx.fillStyle = '#0b3a22'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0d4a2c'; roundRect(4, 4, W - 8, 210, 12, '#0d4a2c');
  if (state === 'title') return;
  // 상대 손패
  plate(2, 120, 12); fan(G.players[2].hand.length, 120, 24, 11, 16, 6);
  plate(1, 36, 56); fan(G.players[1].hand.length, 36, 68, 11, 16, 5.5);
  plate(3, 204, 56); fan(G.players[3].hand.length, 204, 68, 11, 16, 5.5);
  // 더미와 버린 카드
  hits.stock = { x: 92, y: 52, w: 24, h: 34 }; hits.discard = { x: 124, y: 52, w: 24, h: 34 };
  if (G.stock.length) drawCard(null, 92, 52, 24, 34); else roundRect(92, 52, 24, 34, 3, null, 'rgba(255,255,255,.3)');
  text(`${G.stock.length}`, 104, 94, '#bfe', 7); text('더미', 104, 44, '#9ecfb0', 7);
  if (G.discard.length) drawCard(G.discard[G.discard.length - 1], 124, 52, 24, 34, { sel: false });
  text('버린 카드', 136, 44, '#9ecfb0', 7);
  drawMelds();
  // 마지막 행동 표시
  for (const [i, x, y] of [[2, 42, 22], [1, 36, 92], [3, 204, 92]]) if (labels[i]) { ctx.save(); ctx.beginPath(); text(labels[i].length > 12 ? labels[i].slice(0, 12) : labels[i], x, y, '#bfe8ff', 7); ctx.restore(); }
  // 안내
  text(hint, 120, 206, myTurn() ? '#ffe14a' : '#cfe', 8);
  // 내 손패
  const me = G.players[0], hand = me.hand.slice();
  if (sortBy === 'rank') hand.sort((a, b) => L.rankOf(a) - L.rankOf(b) || L.suitOf(a) - L.suitOf(b)); else hand.sort((a, b) => a - b);
  const n = hand.length, cw = 25, ch = 36, step = n > 1 ? Math.min(27, (W - 12 - cw) / (n - 1)) : 0, x0 = (W - ((n - 1) * step + cw)) / 2;
  hits.hand = [];
  const hlTY = G.mustUse;
  hand.forEach((c, k) => {
    const sel = selected.has(c), x = x0 + k * step, y = sel ? 222 : 232;
    drawCard(c, x, y, cw, ch, { sel });
    if (c === hlTY) { ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1, y - 1, cw + 2, ch + 2); }
    hits.hand.push({ card: c, x, y: 222, w: k === n - 1 ? cw : step, h: ch + 10 });
  });
  text(`나  ${me.score >= 0 ? '+' : ''}${me.score}점 · 손패 ${L.handPoints(me.hand)}점${me.registered ? ' · 등록함' : ''}`, 120, 285, '#ffe14a', 8);
  if (G.phase === 'draw' && G.turn === 0) text('◀ 더미 / 버린 카드를 눌러도 돼요', 120, 294, 'rgba(255,255,255,.4)', 6.5);
  if (banner.t > 0) { roundRect(50, 150, 140, 36, 6, 'rgba(0,0,0,.8)'); text(banner.text, 120, 162, '#ffe14a', 13); if (banner.sub) text(banner.sub, 120, 177, '#fff', 8, 'center', false); }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.1, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
function toggleMute() { muted = !muted; store.set('hulaMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
bindOverlay();
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

refresh();
fit();
requestAnimationFrame(frame);
