'use strict';

/**
 * 圆筒包装接缝避让几何核心（纯函数，无依赖，Node 与浏览器共用）。
 *
 * 坐标约定：
 *   把筒体沿周长方向展开，位置 s ∈ [0, C)（单位 mm，0 与 C 为同一点 = 焊缝零点）。
 *   角度 = s / C * 360°，顺时针展开。
 *
 * 模型：
 *   筒体上固定着若干「印刷保护区」[start, start+length]（沿周长 mm，允许跨零点）。
 *   接缝连同其安全宽度 w 是筒体上的一段弧，令旋转量（接缝中心位置）为 x，
 *   则接缝安全段为 [x - w/2, x + w/2]（模 C）。要求该段不得与任何保护区相交。
 *
 *   对单个保护区 [a, b]，禁用的接缝中心位置为 [a - w/2, b + w/2]（模 C）。
 *   所有禁用区间在圆周上归一化并合并后，其补集即全部可行角度段。
 *   默认选择「距禁用边界最远」（可行段内最大内接球圆心 = 最长可行段中点）、
 *   若并列取角度最小者。
 */

const EPS = 1e-9;

/** 非负取模，结果落在 [0, m)；m 必须为正数 */
function mod(p, m) {
  const r = p % m;
  return r < 0 ? r + m : r;
}

function roundTo(v, digits) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * 把一个起点任意、长度任意的区间归一化到圆周 [0, C)：
 *   - 长度 >= C（容差内） => 整圈 [{ start:0, end:C, wrap:true }]
 *   - 普通区间（允许跨零点） => 一段 wrap，或最多两段不跨零的线性区间
 */
function normalizeArc(start, length, C) {
  const len = Math.max(0, Number(length));
  if (len >= C - EPS) {
    return [{ start: 0, end: C, wrap: true }];
  }
  const a = mod(Number(start) || 0, C);
  const b = a + len;
  if (b <= C + EPS) {
    return [{ start: a, end: Math.min(b, C), wrap: false }];
  }
  return [
    { start: a, end: C, wrap: true },
    { start: 0, end: b - C, wrap: true }
  ];
}

/** 合并 [0, C] 内的线性区间（允许重叠与端点相接），输入/输出均为 [start,end] */
function mergeLinear(parts, C) {
  const valid = parts
    .map((p) => [Math.max(0, p[0]), Math.min(C, p[1])])
    .filter((p) => p[1] - p[0] > EPS)
    .sort((a, b) => a[0] - b[0]);
  if (valid.length === 0) return [];
  const out = [valid[0].slice()];
  for (let i = 1; i < valid.length; i++) {
    const last = out[out.length - 1];
    if (valid[i][0] <= last[1] + EPS) {
      last[1] = Math.max(last[1], valid[i][1]);
    } else {
      out.push(valid[i].slice());
    }
  }
  return out;
}

/**
 * 线性区间合并后转回圆周表示：
 *   同时贴住 0 与 C 的各一段拼成一个跨零区间；其它段不跨零。
 */
function toCircular(merged, C) {
  if (merged.length === 0) return [];
  const first = merged[0];
  const last = merged[merged.length - 1];
  const wrapsZero =
    merged.length > 1 && first[0] <= EPS && last[1] >= C - EPS;

  const arcs = [];
  if (wrapsZero) {
    arcs.push({ start: last[0], end: first[1], wrap: true });
    for (let i = 1; i < merged.length - 1; i++) {
      arcs.push({ start: merged[i][0], end: merged[i][1], wrap: false });
    }
  } else {
    for (const m of merged) {
      // 单段覆盖整圈（0..C）标记为 wrap，表示它本身闭合
      arcs.push({
        start: m[0],
        end: m[1],
        wrap: m[0] <= EPS && m[1] >= C - EPS
      });
    }
  }
  arcs.sort((a, b) => a.start - b.start);
  return arcs;
}

/** 不跨零区间 [s,e] 的中点（mm） */
function midOf(s, e) {
  return (s + e) / 2;
}

/** 圆周区间中点（mm）：wrap 区间从中点沿正方向跨越 C/0 */
function arcMidpoint(arc, C) {
  if (!arc.wrap) return midOf(arc.start, arc.end);
  return mod(arc.start + (C - arc.start + arc.end) / 2, C);
}

/**
 * 主求解入口。
 *
 * @param {number} C      筒体周长 mm（>0）
 * @param {number} w      接缝安全宽度 mm（>=0）
 * @param {Array<{start:number,length:number}>} zones 印刷保护区（mm，起点任意）
 * @returns 结构化结果（长度一律 mm，另附角度，角度保留 2 位小数）
 */
function analyze(C, w, zones) {
  if (!Number.isFinite(C) || C <= 0) {
    throw new Error('筒体周长必须为正数');
  }
  if (!Number.isFinite(w) || w < 0) {
    throw new Error('接缝安全宽度必须为非负数');
  }
  const half = w / 2;

  // 1) 归一化并合并保护区本身（用于预览；先判整圈）
  const zoneParts = [];
  for (const z of zones || []) {
    const start = Number(z && z.start);
    const length = Number(z && z.length);
    if (!Number.isFinite(start) || !Number.isFinite(length) || length < 0) {
      throw new Error('保护区起点与长度必须为非负数字');
    }
    if (length >= C - EPS) {
      return fullCovered(C, w);
    }
    for (const seg of normalizeArc(start, length, C)) {
      zoneParts.push([seg.start, seg.end]);
    }
  }
  const zoneMerged = mergeLinear(zoneParts, C);
  const zoneArcs = toCircular(zoneMerged, C);

  if (zoneMerged.length === 0 || w <= EPS) {
    // 无保护区，或接缝无安全宽度：整圈皆可行，推荐角度最小 = 0
    return {
      C,
      seamWidth: roundTo(w, 3),
      zones: zoneArcs.map((a) => serialize(a, C)),
      forbidden: [],
      feasible: [{ start: 0, end: C, wrap: true, lengthMm: C, lengthDeg: 360 }],
      recommended: {
        positionMm: 0,
        angleDeg: 0,
        clearanceMm: null,
        clearanceDeg: null
      },
      covered: false
    };
  }

  // 2) 每个保护区沿两侧各扩 half，得到禁用中心区间
  const forbParts = [];
  for (const [zs, ze] of zoneMerged) {
    for (const seg of normalizeArc(zs - half, ze - zs + w, C)) {
      forbParts.push([seg.start, seg.end]);
    }
  }
  const forbMerged = mergeLinear(forbParts, C);
  const forbidden = toCircular(forbMerged, C);

  // 3) 整圈判定（跨零链闭合，或单段即整圈）
  const total = forbMerged.reduce((sum, p) => sum + (p[1] - p[0]), 0);
  const firstF = forbMerged[0];
  const lastF = forbMerged[forbMerged.length - 1];
  const chainCloses =
    firstF[0] <= EPS && lastF[1] >= C - EPS && total >= C - EPS;
  if (chainCloses) {
    return fullCovered(C, w, zoneArcs, forbMerged);
  }

  // 4) 禁用区间的补集 = 可行区间（线性裂隙），再按跨零缝合
  const feasible = complementGaps(forbMerged, C);

  // 5) 最长可行段中点；并列取角度最小
  let best = null;
  for (const f of feasible) {
    const m = arcMidpoint(f, C);
    const cand = { arc: f, mid: m, len: arcLength(f, C) };
    if (
      !best ||
      cand.len > best.len + EPS ||
      (Math.abs(cand.len - best.len) <= EPS && m < best.mid)
    ) {
      best = cand;
    }
  }

  return {
    C,
    seamWidth: roundTo(w, 3),
    zones: zoneArcs.map((a) => serialize(a, C)),
    forbidden: forbidden.map((a) => serialize(a, C)),
    feasible: feasible.map((f) => ({
      ...serialize(f, C),
      midpointMm: roundTo(arcMidpoint(f, C), 3),
      midpointDeg: roundTo((arcMidpoint(f, C) / C) * 360, 2)
    })),
    recommended: {
      positionMm: roundTo(best.mid, 3),
      angleDeg: roundTo((best.mid / C) * 360, 2),
      clearanceMm: roundTo(best.len / 2, 3),
      clearanceDeg: roundTo(((best.len / 2) / C) * 360, 2)
    },
    covered: false
  };
}

function arcLength(arc, C) {
  if (!arc.wrap) return arc.end - arc.start;
  // [0, C] 跨零表示整圈，长度为 C 而非 C-0+C
  if (arc.start <= EPS && arc.end >= C - EPS) return C;
  return C - arc.start + arc.end;
}

/** 线性禁用合并段 -> 补集裂隙，跨零的两段缝合成一个 wrap 可行段 */
function complementGaps(forbMerged, C) {
  const gaps = [];
  let cursor = 0;
  for (const [s, e] of forbMerged) {
    if (s > cursor + EPS) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < C - EPS) gaps.push([cursor, C]);

  const wrapsZero =
    gaps.length > 1 &&
    gaps[0][0] <= EPS &&
    gaps[gaps.length - 1][1] >= C - EPS;

  if (!wrapsZero) {
    return gaps.map(([s, e]) => ({ start: s, end: e, wrap: false }));
  }
  const out = [
    {
      start: gaps[gaps.length - 1][0],
      end: gaps[0][1],
      wrap: true
    }
  ];
  for (let i = 1; i < gaps.length - 1; i++) {
    out.push({ start: gaps[i][0], end: gaps[i][1], wrap: false });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

function serialize(arc, C) {
  return {
    startMm: roundTo(arc.start, 3),
    endMm: roundTo(arc.end === C ? C : arc.end, 3),
    wrap: !!arc.wrap,
    startDeg: roundTo((arc.start / C) * 360, 2),
    endDeg: roundTo((arc.end / C) * 360, 2),
    lengthMm: roundTo(arcLength(arc, C), 3),
    lengthDeg: roundTo((arcLength(arc, C) / C) * 360, 2)
  };
}

/**
 * 无解：禁用区间首尾相接覆盖整圈。
 * 按线性链顺序返回各禁用段（第一段贴 0、最后一段贴 C，二者在零点处相接），
 * 末段带 joinsAcrossZero 标记，供 UI 渲染「覆盖整圈的禁用区间链」。
 */
function fullCovered(C, w, zoneArcs = [], chainLinear = null) {
  let chain;
  if (chainLinear && chainLinear.length) {
    const n = chainLinear.length;
    chain = chainLinear.map((p, i) => ({
      ...serialize({ start: p[0], end: p[1], wrap: false }, C),
      chainOrder: i,
      // 单段 [0,C] 或末段贴 C（与贴 0 的首段在零点相接）都构成跨零闭合
      joinsAcrossZero:
        (n === 1 && p[0] <= EPS && p[1] >= C - EPS) ||
        (i === n - 1 && n > 1 && p[1] >= C - EPS)
    }));
  } else {
    chain = [
      {
        ...serialize({ start: 0, end: C, wrap: true }, C),
        chainOrder: 0,
        joinsAcrossZero: true
      }
    ];
  }
  return {
    C,
    seamWidth: roundTo(w, 3),
    zones: zoneArcs.map((a) => serialize(a, C)),
    forbidden: chain,
    feasible: [],
    recommended: null,
    covered: true
  };
}

/**
 * 浏览器拖动吸附：给定任意位置 p(mm)，求可行弧集合中圆周最近点。
 * arcs 使用 analyze 返回的 {startMm,endMm,wrap,lengthMm} 结构。
 * 返回 { positionMm, angleDeg, distanceMm }。
 */
function nearestFeasible(p, arcs, C) {
  if (!arcs || arcs.length === 0) return null;
  const x = mod(Number(p) || 0, C);

  // 先把可行弧统一展开为线性闭区间列表（wrap 段同时映射到 [-..] 与 [..C]）
  const ivals = [];
  for (const a of arcs) {
    const s = a.startMm != null ? a.startMm : a.start;
    const e = a.endMm != null ? a.endMm : a.end;
    const isWrap = a.wrap;
    if (!isWrap) {
      ivals.push([s, e]);
    } else {
      ivals.push([s, C]);
      ivals.push([0, e]);
    }
  }

  // 去重/合并相邻副本
  const merged = mergeLinear(
    ivals.map((i) => [Math.max(0, i[0]), Math.min(C, i[1])]),
    C
  );

  let bestD = Infinity;
  let bestX = x;
  const consider = (q, d) => {
    q = mod(q, C);
    if (d < bestD - EPS || (Math.abs(d - bestD) <= EPS && q < bestX)) {
      bestD = d;
      bestX = q;
    }
  };
  for (const [s, e] of merged) {
    if (x >= s - EPS && x <= e + EPS) {
      consider(x, 0);
      continue;
    }
    // x 在线性区间外：圆周上可从任一侧趋近端点 s / e
    for (const b of [s, e]) {
      const d = Math.min(mod(x - b, C), mod(b - x, C));
      consider(b, d);
    }
  }
  return {
    positionMm: roundTo(mod(bestX, C), 3),
    angleDeg: roundTo((mod(bestX, C) / C) * 360, 2),
    distanceMm: roundTo(bestD, 3)
  };
}

/** 当前接缝位置到最近禁用边界的净距（mm，<=0 表示落入禁用区）；整圈可行返回 null */
function clearanceAt(p, forbiddenArcs, C) {
  if (!forbiddenArcs || forbiddenArcs.length === 0) return null;
  const x = mod(Number(p) || 0, C);
  let nearest = Infinity;
  for (const a of forbiddenArcs) {
    const s = a.startMm != null ? a.startMm : a.start;
    const e = a.endMm != null ? a.endMm : a.end;
    const ends = a.wrap ? [s, e] : [s, e]; // 两条边界
    for (const b of ends) {
      const d = Math.min(mod(x - b, C), mod(b - x, C));
      nearest = Math.min(nearest, d);
    }
  }
  return nearest;
}

const api = {
  mod,
  normalizeArc,
  mergeLinear,
  toCircular,
  arcMidpoint,
  arcLength,
  analyze,
  nearestFeasible,
  clearanceAt
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.SeamGeom = api;
}
