'use strict';
// 临时验证脚本：node test-geom.js
const G = require('./lib/geometry');
let pass = 0, fail = 0;
function eq(name, got, want, tol = 1e-6) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got=${got} want=${want}`);
  ok ? pass++ : fail++;
}
function truthy(name, v) {
  console.log(`${v ? 'PASS' : 'FAIL'} ${name}`);
  v ? pass++ : fail++;
}

// 1) 基础：C=100, w=10, 单保护区 [40,60] -> 禁用 [35,65]，可行两段 [65,100]+[0,35]（跨零）
let r = G.analyze(100, 10, [{ start: 40, length: 20 }]);
truthy('1 not covered', !r.covered);
eq('1 forbidden len', r.forbidden[0].lengthMm, 30);
truthy('1 forbidden wraps', r.forbidden[0].wrap === false);
eq('1 feasible count', r.feasible.length, 1);
truthy('1 feasible wraps zero', r.feasible[0].wrap === true);
eq('1 feasible length', r.feasible[0].lengthMm, 70);
// 跨零段 [65..35] 中点 = 65 + 70/2 = 100 ≡ 0（跨零正中，即零点）
eq('1 recommended pos', r.recommended.positionMm, 0);
eq('1 recommended clearance', r.recommended.clearanceMm, 35);

// 2) 跨零点保护区归一化：zone start=90 length=20, w=0 -> zone arcs wrap
r = G.analyze(100, 0, [{ start: 90, length: 20 }]);
truthy('2 zone wraps', r.zones.some((z) => z.wrap && z.startMm === 90 && z.endMm === 10));
eq('2 full feasible', r.feasible[0].lengthMm, 100);
eq('2 recommended 0', r.recommended.angleDeg, 0);

// 3) 两保护区，中间两段可行，取最长段中点；并列取角度小
r = G.analyze(100, 0, [
  { start: 10, length: 10 }, // [10,20]
  { start: 70, length: 10 }  // [70,80]
]);
// w=0 特殊分支整圈可行 —— 改用小宽度
r = G.analyze(100, 2, [
  { start: 10, length: 10 }, // forb [9,21]
  { start: 70, length: 10 }  // forb [69,81]
]);
eq('3 forbidden count', r.forbidden.length, 2);
// feasible: [21,69] len48 mid45 ; [81,100]+[0,9] wrap len28 mid90
eq('3 feasible count', r.feasible.length, 2);
eq('3 recommended pos', r.recommended.positionMm, 45);
eq('3 clearance', r.recommended.clearanceMm, 24);

// 4) 等长两可行段 -> 角度最小中点
r = G.analyze(100, 0.000001, [
  { start: 0, length: 50 } // forb ~[0,50], feasible [50,100] 单段
]);
eq('4 single feasible', r.feasible.length, 1);

// 5) 无解：两禁用扩张后刚好闭合（zone [10,60] w=20 -> forb [0,70]；zone [80,90] w=20 -> [70,100]）
r = G.analyze(100, 20, [
  { start: 10, length: 50 },
  { start: 80, length: 10 }
]);
truthy('5 covered', r.covered);
eq('5 feasible empty', r.feasible.length, 0);
truthy('5 no recommendation', r.recommended === null);
eq('5 chain total', r.forbidden.reduce((s, a) => s + a.lengthMm, 0), 100);
truthy('5 last joins zero', r.forbidden[r.forbidden.length - 1].joinsAcrossZero);

// 6) 单保护区覆盖整圈
r = G.analyze(100, 10, [{ start: 0, length: 100 }]);
truthy('6 covered', r.covered);
eq('6 chain length', r.forbidden[0].lengthMm, 100);

// 7) nearestFeasible：可行 wrap 段 [65..35]（即 [65,100]∪[0,35]）
r = G.analyze(100, 10, [{ start: 40, length: 20 }]);
let n = G.nearestFeasible(0, r.feasible, 100);
eq('7 inside zero', n.distanceMm, 0);
eq('7 inside zero pos', n.positionMm, 0);
n = G.nearestFeasible(80, r.feasible, 100); // 在 [65,100] 可行段内
eq('7 inside', n.distanceMm, 0);
eq('7 inside pos', n.positionMm, 80);
n = G.nearestFeasible(50, r.feasible, 100); // 禁区正中央，距 35/65 均为 15
eq('7 snap dist', n.distanceMm, 15);
truthy('7 snap endpoint', n.positionMm === 35 || n.positionMm === 65);
eq('7 tie smaller angle', n.positionMm, 35);
n = G.nearestFeasible(99, r.feasible, 100); // 在 wrap 可行段内
eq('7 wrap inside', n.distanceMm, 0);

// 8) 负起点归一化
r = G.analyze(100, 10, [{ start: -5, length: 10 }]); // 等价 [95,5] wrap zone，forb [90,10] wrap
truthy('8 forbidden wraps', r.forbidden[0].wrap === true);
truthy('8 forbidden start', r.forbidden[0].startMm === 90);
eq('8 forbidden end', r.forbidden[0].endMm, 10);

// 9) 角度换算
r = G.analyze(360, 36, [{ start: 90, length: 90 }]); // zone 90°..180°, forb 72°..198°
eq('9 forbidden deg', r.forbidden[0].lengthDeg, 126);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
