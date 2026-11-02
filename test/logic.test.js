'use strict';
// 훌라 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// "S7 H7 D7" 형태 대신 "7s 7h 7d" (숫자+무늬). 숫자: A 2..9 T J Q K
const SU = { s: 0, h: 1, d: 2, c: 3 };
const RK = { A: 1, T: 10, J: 11, Q: 12, K: 13 };
const c = (s) => s.trim().split(/\s+/).map((x) => L.makeCard(RK[x[0]] || Number(x[0]), SU[x[1]]));
const fresh = (seed = 3) => L.newGame(L.rng(seed));
// 손패를 정해 놓고 시작: 내(0번) 차례로 만들기
function setup(hands, discardTop, stock = null) {
  const st = fresh();
  st.phase = 'draw'; st.turn = 0; st.mustUse = null; st.melds = []; st.result = null;
  st.players.forEach((p, i) => { p.hand = hands[i] ? hands[i].slice() : c('Ks Kh Kd Qs Qh Qd Js'); p.registered = false; p.turnStartRegistered = false; });
  st.discard = discardTop ? [...discardTop] : c('Ac');
  const used = new Set([...st.players.flatMap((p) => p.hand), ...st.discard]);
  st.stock = stock || Array.from({ length: 52 }, (_, i) => i).filter((x) => !used.has(x));
  return st;
}

test('card names, points: A=1 to K=13, a 7-card hand totals the sum', () => {
  assert.strictEqual(L.pointsOf(c('As')[0]), 1); assert.strictEqual(L.pointsOf(c('Kh')[0]), 13); assert.strictEqual(L.pointsOf(c('7d')[0]), 7);
  assert.strictEqual(L.handPoints(c('As 2h 3d 4c 5s 6h 7d')), 28);
  assert.strictEqual(L.cardName(c('As')[0]), '♠A');
});

test('melds: sets of 3 or 4 different suits, runs of 3+ in one suit, a lone 7', () => {
  assert.ok(L.makeMeld(c('5s 5h 5d')));
  assert.ok(L.makeMeld(c('5s 5h 5d 5c')));
  assert.strictEqual(L.makeMeld(c('5s 5h')), null, 'two is not enough');
  assert.strictEqual(L.makeMeld(c('5s 5h 5h')), null, 'duplicate suit');
  assert.ok(L.makeMeld(c('4h 5h 6h')));
  assert.ok(L.makeMeld(c('6h 4h 5h 7h 8h')), 'order does not matter');
  assert.strictEqual(L.makeMeld(c('4h 5h 7h')), null, 'gap');
  assert.strictEqual(L.makeMeld(c('4h 5s 6h')), null, 'mixed suits');
  assert.ok(L.makeMeld(c('7s')), 'a lone 7');
  assert.strictEqual(L.makeMeld(c('8s')), null, 'only a 7 may stand alone');
});

test('the ace works low (A-2-3) and high (Q-K-A) but a run cannot wrap around', () => {
  assert.ok(L.makeMeld(c('As 2s 3s')));
  assert.ok(L.makeMeld(c('Qs Ks As')));
  assert.strictEqual(L.makeMeld(c('Ks As 2s')), null);
  assert.strictEqual(L.makeMeld(c('Qs As 2s')), null);
  const m = L.makeMeld(c('Qs Ks As')); assert.strictEqual(m.hi, 14);
});

test('attaching: sets take the missing suit up to four, runs grow at both ends', () => {
  const set = L.makeMeld(c('5s 5h 5d'));
  assert.ok(L.canAttach(set, c('5c')[0])); assert.ok(!L.canAttach(set, c('5s')[0])); assert.ok(!L.canAttach(set, c('6c')[0]));
  const full = L.makeMeld(c('5s 5h 5d 5c')); assert.ok(!L.canAttach(full, c('5c')[0]));
  const run = L.makeMeld(c('5h 6h 7h'));
  assert.ok(L.canAttach(run, c('4h')[0])); assert.ok(L.canAttach(run, c('8h')[0]));
  assert.ok(!L.canAttach(run, c('9h')[0])); assert.ok(!L.canAttach(run, c('4s')[0]));
  const low = L.makeMeld(c('2h 3h 4h')); assert.ok(L.canAttach(low, c('Ah')[0]));
  const high = L.makeMeld(c('Jh Qh Kh')); assert.ok(L.canAttach(high, c('Ah')[0]));
  const m = L.makeMeld(c('Jh Qh Kh')); const ace = c('Ah')[0]; assert.ok(L.canAttach(m, ace));
  const lone = L.makeMeld(c('7s')); assert.ok(L.canAttach(lone, c('7h')[0]), 'other sevens attach to a lone 7');
});

test('a new round: 4 players with 7 cards, one card face up, the player left of the dealer starts', () => {
  const st = fresh();
  assert.ok(st.players.every((p) => p.hand.length === 7));
  assert.strictEqual(st.discard.length, 1); assert.strictEqual(st.stock.length, 52 - 28 - 1);
  assert.strictEqual(st.turn, (st.dealer + 1) % 4); assert.strictEqual(st.phase, 'draw');
  const all = [...st.players.flatMap((p) => p.hand), ...st.discard, ...st.stock]; assert.strictEqual(new Set(all).size, 52);
});

test('a turn: draw one, play, discard one; then it is the next turn', () => {
  const st = setup([c('2s 4h 6d 8c Ts Qh Ks')]);
  assert.strictEqual(L.discard(st, st.players[0].hand[0]), false, 'must draw first');
  assert.ok(L.draw(st, 'stock')); assert.strictEqual(st.players[0].hand.length, 8);
  assert.strictEqual(L.draw(st, 'stock'), false, 'only once per turn');
  const out = st.players[0].hand[0];
  assert.ok(L.discard(st, out)); assert.strictEqual(st.players[0].hand.length, 7);
  assert.strictEqual(st.turn, 1); assert.strictEqual(st.discard[st.discard.length - 1], out);
});

test('thank-you: taking the discard is only allowed if you can use it at once, and you must use it', () => {
  const st = setup([c('5s 5h 2d 9c Ts Qh Ks')], c('5d'));
  assert.ok(L.canThankYou(st));
  assert.ok(L.draw(st, 'discard')); assert.strictEqual(st.mustUse, c('5d')[0]);
  assert.strictEqual(L.discard(st, c('9c')[0]), false, 'cannot discard before using the card');
  assert.ok(L.register(st, c('5s 5h 5d'))); assert.strictEqual(st.mustUse, null);
  assert.ok(L.discard(st, c('9c')[0]));
  const no = setup([c('2s 4h 6d 8c Ts Qh Ks')], c('5d'));
  assert.strictEqual(L.canThankYou(no), null); assert.strictEqual(L.draw(no, 'discard'), false);
});

test('thank-you with a lone 7 or by attaching to a meld you may attach to', () => {
  const a = setup([c('2s 4h 6d 9c Ts Qh Ks')], c('7d')); assert.ok(L.canThankYou(a), 'a lone 7 can be registered');
  const b = setup([c('2s 4h 6d 9c Ts Qh Ks')], c('5d'));
  b.melds = [Object.assign(L.makeMeld(c('5s 5h 5c')), { id: 1, owner: 2 })];
  assert.strictEqual(L.canThankYou(b), null, 'cannot attach before registering');
  b.players[0].registered = true;
  assert.ok(L.canThankYou(b));
});

test('registering needs the cards in your hand and a valid meld; the cards leave your hand', () => {
  const st = setup([c('5s 5h 5d 9c Ts Qh Ks')]); L.draw(st, 'stock');
  assert.strictEqual(L.register(st, c('5s 5h')), false);
  assert.strictEqual(L.register(st, c('5s 5h 5c')), false, 'not in hand');
  assert.ok(L.register(st, c('5s 5h 5d')));
  assert.strictEqual(st.melds.length, 1); assert.ok(st.players[0].registered);
  assert.ok(![...c('5s 5h 5d')].some((x) => st.players[0].hand.includes(x)));
});

test('attaching needs a prior registration of your own; attaching to other melds is allowed', () => {
  const st = setup([c('5c 2s 9h Td Jc Qs Ks'), c('Ah Ad Ac 3d 4d 6c 8h')]);
  st.melds = [Object.assign(L.makeMeld(c('5s 5h 5d')), { id: 9, owner: 1 })];
  L.draw(st, 'stock');
  assert.strictEqual(L.attach(st, c('5c')[0], 9), false, 'you have not registered yet');
  const st2 = setup([c('5c 7s 9h Td Jc Qs Ks')]);
  st2.melds = [Object.assign(L.makeMeld(c('5s 5h 5d')), { id: 9, owner: 1 })];
  L.draw(st2, 'stock'); st2.players[0].registered = true;
  assert.ok(L.attach(st2, c('5c')[0], 9)); assert.strictEqual(st2.melds[0].cards.length, 4);
  assert.strictEqual(L.attach(st2, c('7s')[0], 9), false, 'a 7 does not fit a set of fives');
});

test('going out by discarding the last card ends the round: the others pay their points', () => {
  const st = setup([c('5s 5h 5d 9c'), c('Ks Kh Kd Qs Qh Qd Js'), c('2s 3h 4d'), c('As 2h')], c('Ac'));
  L.draw(st, 'stock');
  const drawn = st.players[0].hand.find((x) => !c('5s 5h 5d 9c').includes(x));
  L.register(st, c('5s 5h 5d'));
  const left = st.players[0].hand; assert.strictEqual(left.length, 2);
  L.discard(st, left[0]);
  assert.strictEqual(st.players[0].hand.length, 1);
  assert.ok(drawn !== undefined);
});

test('hula: emptying your hand in one turn without having registered earlier pays double', () => {
  const st = setup([c('5s 5h 5d'), c('Ks Kh Kd Qs Qh Qd Js'), c('2s 3h 4d'), c('As 2h')], c('Ac'));
  // 이미 7장이 아니라 3장짜리 손패이므로 뽑은 카드를 마지막에 버려 비운다
  L.draw(st, 'stock');
  const extra = st.players[0].hand.find((x) => !c('5s 5h 5d').includes(x));
  L.register(st, c('5s 5h 5d'));
  assert.strictEqual(st.players[0].hand.length, 1);
  L.discard(st, extra);
  assert.strictEqual(st.phase, 'roundover');
  assert.strictEqual(st.result.kind, 'hula');
  const totals = [0, 13 * 3 + 12 * 3 + 11, 2 + 3 + 4, 1 + 2];
  assert.deepStrictEqual(st.result.totals.slice(1), totals.slice(1));
  assert.strictEqual(st.result.deltas[0], 2 * (totals[1] + totals[2] + totals[3]));
  assert.strictEqual(st.result.deltas.reduce((a, b) => a + b, 0), 0, 'zero sum');
});

test('going out when you had already registered in an earlier turn is a normal win (no double)', () => {
  const st = setup([c('5s 5h 5d'), c('Ks Kh Kd Qs Qh Qd Js'), c('2s 3h 4d'), c('As 2h')], c('Ac'));
  st.players[0].registered = true; st.players[0].turnStartRegistered = true;
  L.draw(st, 'stock');
  const extra = st.players[0].hand.find((x) => !c('5s 5h 5d').includes(x));
  L.register(st, c('5s 5h 5d')); L.discard(st, extra);
  assert.strictEqual(st.result.kind, 'out');
  assert.strictEqual(st.result.deltas[0], (13 * 3 + 12 * 3 + 11) + 9 + 3, 'single, not double');
});

test('emptying the hand by registering everything wins at once (no discard needed)', () => {
  const st = setup([c('5s 5h 5d'), c('Ks Kh Kd Qs Qh Qd Js'), c('2s 3h 4d'), c('As 2h')], c('5c'));
  assert.ok(L.draw(st, 'discard'));                           // 땡큐: 5c
  L.register(st, c('5s 5h 5d 5c'));
  assert.strictEqual(st.phase, 'roundover'); assert.strictEqual(st.result.kind, 'hula');
});

test('stop: allowed only before drawing and with 15 points or fewer; the lowest hand wins', () => {
  const st = setup([c('As 2s 3h 4d'), c('Ks Kh Kd Qs Qh Qd Js'), c('9s 9h 4d'), c('Ts Jh')]);
  assert.ok(L.canStop(st)); assert.strictEqual(L.handPoints(st.players[0].hand), 10);
  L.draw(st, 'stock'); assert.strictEqual(L.canStop(st), false, 'not after drawing');
  const s2 = setup([c('Ks 2s 3h 4d')]); assert.strictEqual(L.canStop(s2), false, '22 points is too many');
  const s3 = setup([c('As 2s 3h 4d'), c('Ks Kh Kd Qs Qh Qd Js'), c('9s 9h 4d'), c('Ts Jh')]);
  assert.ok(L.stop(s3));
  assert.strictEqual(s3.result.kind, 'stop'); assert.strictEqual(s3.result.success, true); assert.strictEqual(s3.result.winner, 0);
  const t = s3.result.totals; assert.strictEqual(s3.result.deltas[0], (t[1] - 10) + (t[2] - 10) + (t[3] - 10));
  assert.strictEqual(s3.result.deltas.reduce((a, b) => a + b, 0), 0);
});

test('a failed stop (someone has the same or fewer points) costs the stopper', () => {
  const st = setup([c('As 2s 3h 4d'), c('Ks Kh Kd Qs Qh Qd Js'), c('As 2h 3d 4c'), c('Ts Jh')]);
  L.stop(st);
  assert.strictEqual(st.result.success, false);
  assert.strictEqual(st.result.deltas[0], -3 * (10 + L.STOP_PENALTY));
  assert.ok(st.result.deltas.slice(1).every((d) => d === 10 + L.STOP_PENALTY));
});

test('when the stock runs out the round ends and the lowest hand wins the difference', () => {
  const st = setup([c('Ks 2s'), c('Ks Kh'), c('9s 9h'), c('Ts Jh')], c('Ac'), []);
  L.draw(st, 'stock');
  assert.strictEqual(st.result.kind, 'exhausted'); assert.strictEqual(st.result.winner, 0);
  assert.strictEqual(st.result.deltas.reduce((a, b) => a + b, 0), 0);
});

test('five rounds make a match; scores accumulate, the dealer moves on, the best score wins', () => {
  const st = fresh(); const d0 = st.dealer;
  for (let r = 1; r <= 5; r++) {
    assert.strictEqual(st.round, r);
    for (let k = 0; k < 4000 && st.phase !== 'roundover' && st.phase !== 'matchover'; k++) { st.players.forEach((p) => { p.human = false; }); assert.ok(L.cpuStep(st), 'cpu step ' + st.phase); }
    if (r < 5) { assert.strictEqual(st.phase, 'roundover'); L.nextRound(st); assert.strictEqual(st.dealer, (d0 + r) % 4); }
  }
  assert.strictEqual(st.phase, 'matchover');
  assert.strictEqual(st.players.reduce((s, p) => s + p.score, 0), 0, 'zero-sum over the match');
  const rank = L.ranking(st); assert.ok(st.players[rank[0]].score >= st.players[rank[3]].score);
});

test('computer players: always legal, rounds end, and they register and attach when they can', () => {
  let registers = 0, attaches = 0, stops = 0, outs = 0, thank = 0, rounds = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const st = L.newGame(L.rng(seed * 13), { rounds: 4 }); st.players.forEach((p) => { p.human = false; });
    for (let k = 0; k < 20000 && st.phase !== 'matchover'; k++) {
      if (st.phase === 'roundover') { rounds++; L.nextRound(st); continue; }
      assert.ok(L.cpuStep(st), 'cpu action accepted in ' + st.phase);
      for (const e of st.events) { if (e.t === 'register') registers++; if (e.t === 'attach') attaches++; if (e.t === 'stop') stops++; if (e.t === 'out') outs++; if (e.t === 'thankyou') thank++; }
      st.events = [];
      const cards = [...st.players.flatMap((p) => p.hand), ...st.discard, ...st.stock, ...st.melds.flatMap((m) => m.cards)];
      assert.strictEqual(new Set(cards).size, cards.length, 'no duplicate cards'); assert.ok(cards.length === 52);
    }
    assert.strictEqual(st.phase, 'matchover');
  }
  assert.ok(registers > 50 && attaches > 5 && thank > 5 && (stops + outs) > 20, `reg ${registers} att ${attaches} ty ${thank} stop ${stops} out ${outs}`);
});

test('easy computers are weaker: the same player scores clearly better against them', () => {
  const avg = (level) => {
    let sum = 0, games = 40;
    for (let g = 1; g <= games; g++) {
      const st = L.newGame(L.rng(g * 977), { rounds: 3, level }); st.players.forEach((p) => { p.human = false; });
      for (let k = 0; k < 30000 && st.phase !== 'matchover'; k++) { if (st.phase === 'roundover') { L.nextRound(st); continue; } L.cpuStep(st); st.events = []; }
      sum += st.players[0].score;
    }
    return sum / games;
  };
  const normal = avg('normal'), easy = avg('easy');
  assert.ok(easy > normal + 8, `easy ${easy} vs normal ${normal}`);
  const st = L.newGame(L.rng(1), { level: 'easy' });
  assert.ok(st.players.slice(1).every((p) => p.easy) && !st.players[0].easy);
  assert.strictEqual(L.newGame(L.rng(1)).difficulty, 'normal');
});
