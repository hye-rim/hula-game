'use strict';
// 훌라 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 카드는 0~51: 무늬 * 13 + (숫자 - 1). 숫자 1=A … 13=K, 점수는 숫자 그대로(A 1점 … K 13점)
const LOGIC_HULA = (() => {
  const HAND = 7, ROUNDS = 5, STOP_MAX = 15, STOP_PENALTY = 10, HULA_MULT = 2;
  const SUITS = '♠♥♦♣', RANK_NAMES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const NAMES = ['나', '민수', '지아', '도윤'];

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };
  const rankOf = (c) => (c % 13) + 1, suitOf = (c) => Math.floor(c / 13), pointsOf = (c) => rankOf(c);
  const makeCard = (rank, suit) => suit * 13 + rank - 1;
  const cardName = (c) => SUITS[suitOf(c)] + RANK_NAMES[rankOf(c)];
  const handPoints = (h) => h.reduce((s, c) => s + pointsOf(c), 0);

  // ---------- 족보(등록할 수 있는 묶음) ----------
  // 같은 숫자 3~4장(무늬가 모두 다름), 같은 무늬의 연속 숫자 3장 이상(A 는 맨 앞 A-2-3 또는 맨 뒤 Q-K-A), 7 한 장
  function makeMeld(cards) {
    const n = cards.length;
    if (n === 1) return rankOf(cards[0]) === 7 ? { type: 'set', rank: 7, cards: cards.slice() } : null;
    if (n < 3) return null;
    const ranks = cards.map(rankOf), suits = cards.map(suitOf);
    if (ranks.every((r) => r === ranks[0])) {
      if (n > 4 || new Set(suits).size !== n) return null;
      return { type: 'set', rank: ranks[0], cards: cards.slice().sort((a, b) => suitOf(a) - suitOf(b)) };
    }
    if (new Set(suits).size !== 1) return null;
    for (const high of [false, true]) {
      const rs = ranks.map((r) => (high && r === 1 ? 14 : r)).sort((a, b) => a - b);
      let ok = true;
      for (let i = 1; i < rs.length; i++) if (rs[i] !== rs[i - 1] + 1) ok = false;
      if (ok) {
        const order = cards.slice().sort((a, b) => (high && rankOf(a) === 1 ? 14 : rankOf(a)) - (high && rankOf(b) === 1 ? 14 : rankOf(b)));
        return { type: 'run', suit: suits[0], lo: rs[0], hi: rs[rs.length - 1], cards: order };
      }
    }
    return null;
  }
  function canAttach(meld, card) {
    const r = rankOf(card), s = suitOf(card);
    if (meld.type === 'set') return r === meld.rank && meld.cards.length < 4 && !meld.cards.some((c) => suitOf(c) === s);
    if (s !== meld.suit) return false;
    if (r === meld.hi + 1 && r <= 13) return true;
    if (r === meld.lo - 1 && r >= 1) return true;
    if (r === 1 && meld.hi === 13) return true;                // …Q-K-A
    return false;
  }
  function attachTo(meld, card) {
    const r = rankOf(card);
    if (meld.type === 'set') { meld.cards.push(card); meld.cards.sort((a, b) => suitOf(a) - suitOf(b)); return; }
    if (r === 1 && meld.hi === 13) { meld.cards.push(card); meld.hi = 14; return; }
    if (r === meld.hi + 1) { meld.cards.push(card); meld.hi = r; return; }
    meld.cards.unshift(card); meld.lo = r;
  }

  // 손에서 만들 수 있는 모든 묶음(3장 이상). 단독 7 은 따로 다룬다.
  function allMelds(hand) {
    const out = [];
    const n = hand.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      let cnt = 0; for (let b = mask; b; b &= b - 1) cnt++;
      if (cnt < 3 || cnt > 14) continue;
      const cs = []; for (let i = 0; i < n; i++) if (mask & (1 << i)) cs.push(hand[i]);
      if (makeMeld(cs)) out.push({ mask, cards: cs });
    }
    return out;
  }
  // 겹치지 않게 묶음을 골라 털어내는 점수를 가장 크게 (단독 7 은 가중치를 조금 낮춰 마지막에 고려)
  function bestPacking(hand) {
    const melds = allMelds(hand);
    let best = { value: 0, picks: [] };
    const rec = (idx, used, value, picks) => {
      if (value > best.value) best = { value, picks: picks.slice() };
      for (let i = idx; i < melds.length; i++) {
        if (melds[i].mask & used) continue;
        const v = melds[i].cards.reduce((s, c) => s + pointsOf(c), 0);
        picks.push(melds[i]); rec(i + 1, used | melds[i].mask, value + v, picks); picks.pop();
      }
    };
    rec(0, 0, 0, []);
    return best;
  }

  // ---------- 게임 만들기 ----------
  function newGame(rand = Math.random, opts = {}) {
    const names = opts.names || NAMES;
    const easy = opts.level === 'easy';
    const st = { rand, events: [], round: 0, rounds: opts.rounds || ROUNDS, dealer: -1, phase: 'idle', players: names.map((name, i) => ({ name, human: i === 0, hand: [], registered: false, score: 0, easy: easy && i > 0 })), difficulty: opts.level || 'normal', melds: [], stock: [], discard: [], turn: 0, mustUse: null, result: null, meldSeq: 0 };
    startRound(st);
    return st;
  }
  function shuffled(st) {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function startRound(st) {
    st.round++;
    st.dealer = (st.dealer + 1) % st.players.length;
    st.stock = shuffled(st); st.discard = []; st.melds = []; st.mustUse = null; st.result = null; st.stopper = null;
    for (const p of st.players) { p.hand = []; p.registered = false; p.turnStartRegistered = false; }
    for (let k = 0; k < HAND; k++) for (const p of st.players) p.hand.push(st.stock.pop());
    st.discard.push(st.stock.pop());
    st.turn = (st.dealer + 1) % st.players.length;
    st.phase = 'draw'; st.turnStartRegistered = false;
    st.players.forEach((p) => p.hand.sort((a, b) => a - b));
    emit(st, { t: 'round', round: st.round, dealer: st.dealer });
    beginTurn(st);
  }
  function beginTurn(st) { st.players[st.turn].turnStartRegistered = st.players[st.turn].registered; st.phase = 'draw'; st.mustUse = null; emit(st, { t: 'turn', who: st.turn }); }

  // ---------- 행동 ----------
  const me = (st) => st.players[st.turn];
  function canThankYou(st) {
    if (st.phase !== 'draw' || !st.discard.length) return null;
    const card = st.discard[st.discard.length - 1], p = me(st);
    const hand = [...p.hand, card];
    for (const m of allMelds(hand)) if (m.cards.includes(card)) return { how: 'register', cards: m.cards };
    if (rankOf(card) === 7) return { how: 'register', cards: [card] };
    if (p.registered) for (const m of st.melds) if (canAttach(m, card)) return { how: 'attach', meld: m.id };
    return null;
  }
  function draw(st, source) {
    if (st.phase !== 'draw') return false;
    const p = me(st);
    if (source === 'discard') {
      if (!canThankYou(st)) return false;
      const card = st.discard.pop(); p.hand.push(card); p.hand.sort((a, b) => a - b); st.mustUse = card;
      emit(st, { t: 'thankyou', who: st.turn, card });
      st.phase = 'play'; return true;
    }
    if (!st.stock.length) { endExhausted(st); return true; }
    const card = st.stock.pop(); p.hand.push(card); p.hand.sort((a, b) => a - b);
    emit(st, { t: 'draw', who: st.turn, card: p.human ? card : null });
    st.phase = 'play'; st.lastDrawn = card; return true;
  }
  function register(st, cards) {
    if (st.phase !== 'play') return false;
    const p = me(st);
    if (!cards.length || !cards.every((c) => p.hand.includes(c)) || new Set(cards).size !== cards.length) return false;
    const m = makeMeld(cards);
    if (!m) return false;
    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    m.id = ++st.meldSeq; m.owner = st.turn; st.melds.push(m); p.registered = true;
    if (st.mustUse !== null && cards.includes(st.mustUse)) st.mustUse = null;
    emit(st, { t: 'register', who: st.turn, meld: m.id, cards: m.cards.slice() });
    return checkOut(st);
  }
  function attach(st, card, meldId) {
    if (st.phase !== 'play') return false;
    const p = me(st);
    if (!p.registered || !p.hand.includes(card)) return false;
    const m = st.melds.find((x) => x.id === meldId);
    if (!m || !canAttach(m, card)) return false;
    p.hand.splice(p.hand.indexOf(card), 1); attachTo(m, card);
    if (st.mustUse === card) st.mustUse = null;
    emit(st, { t: 'attach', who: st.turn, meld: m.id, card });
    return checkOut(st);
  }
  function checkOut(st) {
    const p = me(st);
    if (p.hand.length === 0) { finishOut(st); }
    return true;
  }
  function discard(st, card) {
    if (st.phase !== 'play') return false;
    const p = me(st);
    if (!p.hand.includes(card)) return false;
    if (st.mustUse !== null) return false;                     // 땡큐로 가져온 카드는 먼저 써야 한다
    p.hand.splice(p.hand.indexOf(card), 1); st.discard.push(card);
    emit(st, { t: 'discard', who: st.turn, card });
    if (p.hand.length === 0) { finishOut(st); return true; }
    st.turn = (st.turn + 1) % st.players.length;
    beginTurn(st);
    return true;
  }
  function stopTotals(st) { return st.players.map((p) => handPoints(p.hand)); }
  function canStop(st) { return st.phase === 'draw' && handPoints(me(st).hand) <= STOP_MAX; }
  function stop(st) {
    if (!canStop(st)) return false;
    const mine = handPoints(me(st).hand), totals = stopTotals(st);
    const others = totals.filter((t, i) => i !== st.turn);
    const success = others.every((t) => t > mine);
    const deltas = st.players.map(() => 0);
    if (success) { for (let i = 0; i < st.players.length; i++) if (i !== st.turn) { deltas[i] -= totals[i] - mine; deltas[st.turn] += totals[i] - mine; } }
    else { for (let i = 0; i < st.players.length; i++) if (i !== st.turn) { deltas[i] += mine + STOP_PENALTY; deltas[st.turn] -= mine + STOP_PENALTY; } }
    emit(st, { t: 'stop', who: st.turn, total: mine, success });
    endRound(st, { kind: 'stop', winner: success ? st.turn : -1, stopper: st.turn, success, totals, deltas });
    return true;
  }
  function finishOut(st) {
    const hula = !me(st).turnStartRegistered;                  // 이번 턴 전까지 한 번도 등록하지 않았는데 한 턴에 모두 털어냄
    const totals = stopTotals(st), deltas = st.players.map(() => 0);
    for (let i = 0; i < st.players.length; i++) if (i !== st.turn) { const pay = totals[i] * (hula ? HULA_MULT : 1); deltas[i] -= pay; deltas[st.turn] += pay; }
    emit(st, { t: 'out', who: st.turn, hula });
    endRound(st, { kind: hula ? 'hula' : 'out', winner: st.turn, hula, totals, deltas });
  }
  function endExhausted(st) {
    const totals = stopTotals(st), min = Math.min(...totals);
    const winners = totals.map((t, i) => i).filter((i) => totals[i] === min);
    const deltas = st.players.map(() => 0);
    if (winners.length === 1) for (let i = 0; i < st.players.length; i++) if (i !== winners[0]) { deltas[i] -= totals[i] - min; deltas[winners[0]] += totals[i] - min; }
    emit(st, { t: 'exhausted' });
    endRound(st, { kind: 'exhausted', winner: winners.length === 1 ? winners[0] : -1, totals, deltas });
  }
  function endRound(st, result) {
    st.players.forEach((p, i) => { p.score += result.deltas[i]; });
    st.result = result; st.phase = st.round >= st.rounds ? 'matchover' : 'roundover'; st.mustUse = null;
    emit(st, { t: 'roundend', result });
    if (st.phase === 'matchover') emit(st, { t: 'matchover', ranking: ranking(st) });
  }
  function ranking(st) { return st.players.map((p, i) => i).sort((a, b) => st.players[b].score - st.players[a].score); }
  function nextRound(st) { if (st.phase !== 'roundover') return false; startRound(st); return true; }

  // ---------- 컴퓨터 ----------
  const handValue = (hand) => handPoints(hand) - bestPacking(hand).value;      // 털어내지 못하는 점수(작을수록 좋음)
  function discardScore(st, p, card) {
    // 버릴수록 이득인 정도: 점수가 크고, 묶음이 될 가망이 없는 카드
    const r = rankOf(card), s = suitOf(card);
    let keep = 0;
    for (const c of p.hand) {
      if (c === card) continue;
      if (rankOf(c) === r) keep += 3.2;                                      // 같은 숫자 (짝)
      if (suitOf(c) === s) { const d = Math.abs(rankOf(c) - r); if (d === 1) keep += 3.4; else if (d === 2) keep += 1.6; }
    }
    if (p.registered) for (const m of st.melds) if (canAttach(m, card)) keep += 4;
    if (r === 7) keep += 1.5;
    return r - keep;
  }
  function cpuStep(st) {
    if (st.players[st.turn].human || (st.phase !== 'draw' && st.phase !== 'play')) return false;
    const p = me(st);
    if (st.phase === 'draw') {
      const total = handPoints(p.hand);
      const stopOk = p.easy ? (st.turnCount >= 8 && total <= 7) : (total <= 7 || (total <= 12 && st.rand() < 0.5));        // 쉬움: 서두르지 않고, 확실할 때만 스톱
      if (canStop(st) && stopOk) {
        // 상대 손패 수가 많으면(많이 못 털었으면) 성공 확률이 높다
        const minOthers = Math.min(...st.players.filter((q, i) => i !== st.turn).map((q) => q.hand.length));
        if (total <= 8 || minOthers >= p.hand.length) return stop(st);
      }
      const ty = canThankYou(st);
      if (ty && !(p.easy && st.rand() < 0.4) && draw(st, 'discard')) return true;       // 쉬움: 가끔 땡큐를 놓침
      return draw(st, 'stock');
    }
    // 등록
    if (st.mustUse !== null) {
      const card = st.mustUse;
      const ty = [...p.hand];
      const reg = allMelds(ty).filter((m) => m.cards.includes(card)).sort((a, b) => b.cards.reduce((s, c) => s + pointsOf(c), 0) - a.cards.reduce((s, c) => s + pointsOf(c), 0))[0];
      if (reg && register(st, reg.cards)) return true;
      if (rankOf(card) === 7 && register(st, [card])) return true;
      for (const m of st.melds) if (p.registered && canAttach(m, card)) return attach(st, card, m.id);
    }
    const pack = bestPacking(p.hand);
    if (pack.picks.length && !(p.easy && st.rand() < 0.2)) {                             // 쉬움: 가끔 등록을 미룸
      // 가장 점수가 큰 묶음부터 등록
      const pick = pack.picks.slice().sort((a, b) => b.cards.reduce((s, c) => s + pointsOf(c), 0) - a.cards.reduce((s, c) => s + pointsOf(c), 0))[0];
      return register(st, pick.cards);
    }
    // 붙이기
    if (p.registered) for (const c of p.hand) for (const m of st.melds) if (canAttach(m, c)) return attach(st, c, m.id);
    // 손에 7 이 있고 아직 등록한 적이 없으면 7 한 장을 등록해 붙이기를 열 수 있다
    const sevens = p.hand.filter((c) => rankOf(c) === 7);
    if (sevens.length && !p.registered && p.hand.length > 3 && st.rand() < 0.5) return register(st, [sevens[0]]);
    // 버리기
    const ranked = p.hand.map((c) => ({ c, v: discardScore(st, p, c) })).sort((a, b) => b.v - a.v);
    const pickIdx = p.easy && st.rand() < 0.3 ? Math.min(ranked.length - 1, 1 + Math.floor(st.rand() * 2)) : 0;     // 쉬움: 가끔 두세 번째로 나쁜 카드를 버림
    return discard(st, ranked[pickIdx].c);
  }

  return {
    HAND, ROUNDS, STOP_MAX, STOP_PENALTY, HULA_MULT, SUITS, RANK_NAMES, NAMES,
    rng, rankOf, suitOf, pointsOf, makeCard, cardName, handPoints, makeMeld, canAttach, allMelds, bestPacking,
    newGame, startRound, nextRound, canThankYou, draw, register, attach, discard, canStop, stop, cpuStep, ranking, stopTotals,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_HULA;
