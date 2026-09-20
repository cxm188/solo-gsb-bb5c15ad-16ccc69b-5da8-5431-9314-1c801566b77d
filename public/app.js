'use strict';

/* global SeamGeom */

const G = SeamGeom;

const state = {
  zones: [
    { start: 60, length: 120 },
    { start: 360, length: 90 }
  ],
  result: null,
  error: null,
  // 当前接缝中心位置（mm，[0,C)）
  seam: 0,
  // true 表示当前位置是吸附后的可行位置；false 表示落在禁用区（无解时自由位置）
  seamFeasible: true,
  dragging: false,
  dragTarget: null,
  initialized: false
};

const el = (id) => document.getElementById(id);
const canvas = el('view');
const ctx = canvas.getContext('2d');

/* ---------------- 输入区 ---------------- */

function renderZoneRows() {
  const box = el('zonesList');
  box.innerHTML = '';
  state.zones.forEach((z, i) => {
    const row = document.createElement('div');
    row.className = 'zone-row';
    row.innerHTML = `
      <input type="number" step="1" data-i="${i}" data-k="start" value="${z.start}" />
      <input type="number" step="1" min="0" data-i="${i}" data-k="length" value="${z.length}" />
      <button class="btn btn-del" data-del="${i}" type="button" title="删除">✕</button>`;
    box.appendChild(row);
  });
}

el('zonesList').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.i != null) {
    const i = Number(t.dataset.i);
    state.zones[i][t.dataset.k] = t.value === '' ? NaN : Number(t.value);
    scheduleRecompute();
  }
});
el('zonesList').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.del != null) {
    state.zones.splice(Number(t.dataset.del), 1);
    renderZoneRows();
    scheduleRecompute();
  }
});
el('addZone').addEventListener('click', () => {
  state.zones.push({ start: 0, length: 50 });
  renderZoneRows();
  scheduleRecompute();
});
el('circumference').addEventListener('input', scheduleRecompute);
el('seamWidth').addEventListener('input', scheduleRecompute);
el('useRecommended').addEventListener('click', () => {
  if (state.result && state.result.recommended) {
    jumpSeam(state.result.recommended.positionMm);
  }
});

let recomputeTimer = null;
function scheduleRecompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recompute, 120);
}

function readParams() {
  return {
    circumference: parseFloat(el('circumference').value),
    seamWidth: parseFloat(el('seamWidth').value),
    zones: state.zones
      .map((z) => ({ start: Number(z.start), length: Number(z.length) }))
      .filter((z) => Number.isFinite(z.start) && Number.isFinite(z.length))
  };
}

async function recompute() {
  const p = readParams();
  state.error = null;
  el('errorBox').hidden = true;

  // 本地先算（拖动吸附依赖本地几何库）
  let local = null;
  try {
    local = G.analyze(p.circumference, p.seamWidth, p.zones);
  } catch (err) {
    state.error = err.message;
    showError(err.message);
    state.result = null;
    renderSummary();
    renderTables();
    draw();
    return;
  }

  // 服务端为权威结果（同时验证 API 一致性）
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p)
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || '服务端计算失败');
    state.result = data.result;
  } catch (err) {
    // 离线/异常时退回本地结果
    state.result = local;
  }

  const C = state.result.C;

  if (state.result.covered) {
    // 无解：接缝保留当前自由位置，标记为不可行
    state.seam = G.mod(state.seam, C);
    state.seamFeasible = false;
  } else {
    // 首次计算默认采用推荐旋转量（最远、角度最小）；之后保留用户当前位置
    if (!state.initialized) {
      state.seam = G.mod(state.result.recommended.positionMm, C);
      state.initialized = true;
    }
    // 参数变化后：判断当前接缝是否仍在可行区；落入禁用区则标红等待用户拖动吸附
    const snap = G.nearestFeasible(state.seam, state.result.feasible, C);
    state.seam = G.mod(state.seam, C);
    state.seamFeasible = snap.distanceMm <= 1e-6;
  }

  renderSummary();
  renderTables();
  draw();
}

function showError(msg) {
  const b = el('errorBox');
  b.textContent = msg;
  b.hidden = false;
}

/* ---------------- 结果区 ---------------- */

function fmt(v, d = 2) {
  return Number(v).toFixed(d);
}

function arcText(a) {
  return `${fmt(a.startDeg)}° → ${fmt(a.endDeg)}°${a.wrap ? '（跨零）' : ''}`;
}

function renderSummary() {
  const box = el('summary');
  const btn = el('useRecommended');
  if (state.error || !state.result) {
    box.innerHTML = '';
    btn.hidden = true;
    return;
  }
  const r = state.result;
  if (r.covered) {
    btn.hidden = true;
    box.innerHTML = `
      <div class="card bad">
        <div class="big">无解</div>
        <div class="meta">禁用旋转区间首尾相接，已覆盖整圈 360°（共 ${r.forbidden.length} 段链接续）</div>
        <div class="stat-row"><span>保护区总长：<b>${r.zones.reduce((s, z) => s + z.lengthMm, 0).toFixed(1)} mm</b></span></div>
      </div>`;
    return;
  }
  const rec = r.recommended;
  const cur = (state.seam / r.C) * 360;
  const inside = G.nearestFeasible(state.seam, r.feasible, r.C).distanceMm <= 1e-6;
  const clearMm = G.clearanceAt(state.seam, r.forbidden, r.C);
  const clearDeg = clearMm == null ? null : (clearMm / r.C) * 360;
  box.innerHTML = `
    <div class="card">
      <div class="big">推荐旋转量：${fmt(rec.angleDeg)}°</div>
      <div class="meta">位置 ${fmt(rec.positionMm, 1)} / ${fmt(r.C, 1)} mm，
        距最近禁用边界 ${fmt(rec.clearanceMm, 1)} mm（${fmt(rec.clearanceDeg)}°）</div>
      <div class="stat-row">
        <span>可行段：<b>${r.feasible.length}</b></span>
        <span>禁用段：<b>${r.forbidden.length}</b></span>
      </div>
    </div>
    <div class="card ${inside ? '' : 'bad'}">
      <div class="big" style="font-size:16px">当前接缝：${fmt(cur)}° ${inside ? '✓ 可行' : '✕ 位于禁用区'}</div>
      <div class="meta">位置 ${fmt(state.seam, 1)} mm${clearMm == null ? '，整圈可行' : `，到禁用边界净距 ${fmt(clearMm, 1)} mm（${fmt(clearDeg)}°）`}</div>
    </div>`;

  const onRec = Math.abs(G.mod(state.seam - rec.positionMm, r.C)) < 1e-6;
  btn.hidden = false;
  btn.textContent = onRec ? '✓ 当前即推荐旋转量' : '采用推荐旋转量';
  btn.disabled = onRec;
}

function wrapTag(cond) {
  return cond
    ? '<span class="tag wrap">跨零</span>'
    : '<span class="tag no">—</span>';
}

function renderTables() {
  const fb = el('feasibleTable').querySelector('tbody');
  const xb = el('forbiddenTable').querySelector('tbody');
  fb.innerHTML = '';
  xb.innerHTML = '';
  if (!state.result || state.error) return;
  const r = state.result;
  const curDeg = (state.seam / r.C) * 360;

  r.feasible.forEach((a, i) => {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    if (Math.abs(a.midpointDeg - (r.recommended ? r.recommended.angleDeg : -1)) < 0.001) {
      tr.classList.add('picked');
    }
    tr.innerHTML = `
      <td class="center">${i + 1}</td>
      <td>${fmt(a.startDeg)}</td>
      <td>${fmt(a.endDeg)}</td>
      <td class="center">${wrapTag(a.wrap)}</td>
      <td>${fmt(a.lengthDeg)}</td>
      <td>${fmt(a.midpointDeg)}</td>`;
    tr.addEventListener('click', () => jumpSeam(a.midpointMm));
    fb.appendChild(tr);
  });

  if (r.covered) {
    const tr = document.createElement('tr');
    tr.className = 'chain-row';
    tr.innerHTML = `<td colspan="6" class="center">禁用区间链接续覆盖整圈（见下表，红色链接续标记处跨过 0° 闭合）</td>`;
    fb.appendChild(tr);
  }

  r.forbidden.forEach((a, i) => {
    const tr = document.createElement('tr');
    tr.className = a.joinsAcrossZero ? 'chain-row' : '';
    tr.innerHTML = `
      <td class="center">${i + 1}</td>
      <td>${fmt(a.startDeg)}</td>
      <td>${fmt(a.endDeg)}</td>
      <td class="center">${wrapTag(a.wrap)}</td>
      <td>${fmt(a.lengthDeg)}</td>
      <td class="center">${a.joinsAcrossZero ? '<span class="tag chain">⇄跨零闭合</span>' : ''}</td>`;
    xb.appendChild(tr);
  });
}

function jumpSeam(mm) {
  if (!state.result || state.result.covered) return;
  state.seam = G.mod(mm, state.result.C);
  state.seamFeasible = true;
  renderSummary();
  draw();
}

/* ---------------- Canvas ---------------- */

// CSS 设计坐标
const W = 600;
const H = 760;
const CX = W / 2;
const CY = 300;
const R_BASE = 120;     // 筒体底色外半径
const R_ZONE = 150;     // 保护区环
const R_FORB = 178;     // 禁用环
const R_FEAS = 206;     // 可行环
const R_HANDLE = 206;   // 接缝手柄所在半径
const STRIP = { x: 56, y: 644, w: W - 112, h: 56 };

function fitDpr() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.width * (H / W) * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0);
}
window.addEventListener('resize', () => { fitDpr(); draw(); });

/** mm -> 角度（顺时针，0 在正上方） */
function mmToDeg(mm, C) {
  return (mm / C) * 360;
}
function polar(r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function drawArcBand(rIn, rOut, startDeg, endDeg, wrap, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const drawOne = (a0, a1) => {
    // 完整 360° 用两段绘制，避免 arc 起终点重合不填充
    if (a1 - a0 >= 359.999) {
      wedge(rIn, rOut, a0, a0 + 180);
      wedge(rIn, rOut, a0 + 180, a1);
    } else {
      wedge(rIn, rOut, a0, a1);
    }
  };
  if (!wrap) {
    drawOne(startDeg, endDeg);
  } else if (startDeg <= 1e-6 && endDeg >= 360 - 1e-6) {
    drawOne(0, 360);
  } else {
    drawOne(startDeg, 360);
    drawOne(0, endDeg);
  }
  ctx.restore();
}

function wedge(rIn, rOut, a0, a1) {
  const p0 = polar(rOut, a0);
  const p1 = polar(rOut, a1);
  const q1 = polar(rIn, a1);
  const q0 = polar(rIn, a0);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.arc(CX, CY, rOut, (a0 - 90) * Math.PI / 180, (a1 - 90) * Math.PI / 180);
  ctx.lineTo(q1.x, q1.y);
  ctx.arc(CX, CY, rIn, (a1 - 90) * Math.PI / 180, (a0 - 90) * Math.PI / 180, true);
  ctx.closePath();
  ctx.fill();
}

function drawSpoke(r1, r2, deg, color, width = 2, dash = null) {
  const a = polar(r1, deg);
  const b = polar(r2, deg);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawRingLabels() {
  ctx.save();
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  const labels = [
    [R_BASE - 24, '筒体'],
    [(R_BASE + R_ZONE) / 2, '保护区'],
    [(R_ZONE + R_FORB) / 2, '禁用'],
    [(R_FORB + R_FEAS) / 2, '可行']
  ];
  // 在 270°（正下方）内侧标注环含义，避免与弧冲突
  labels.forEach(([r, t]) => {
    const p = polar(r, 270);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const w = ctx.measureText(t).width + 6;
    ctx.fillRect(p.x - w / 2, p.y - 8, w, 14);
    ctx.fillStyle = '#6b7280';
    ctx.fillText(t, p.x, p.y + 3);
  });
  ctx.restore();
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  const r = state.result;

  // 外圈环底色
  ctx.fillStyle = '#f3f4f6';
  ctx.beginPath();
  ctx.arc(CX, CY, R_FEAS + 8, 0, Math.PI * 2);
  ctx.fill();

  if (!r) {
    drawEmptyHint('请输入有效参数');
    return;
  }
  const C = r.C;

  // 筒体底盘
  ctx.fillStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.arc(CX, CY, R_BASE, 0, Math.PI * 2);
  ctx.fill();

  // 三层环（先铺底色，再画弧）
  ctx.fillStyle = '#eef2ff';
  ctx.beginPath(); ctx.arc(CX, CY, R_ZONE, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fef2f2';
  ctx.beginPath(); ctx.arc(CX, CY, R_FORB, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f0fdf4';
  ctx.beginPath(); ctx.arc(CX, CY, R_FEAS, 0, Math.PI * 2); ctx.fill();

  // 覆盖整圈的禁用链（无解）
  if (r.covered) {
    r.forbidden.forEach((a) => {
      drawArcBand(R_BASE + 2, R_FEAS, a.startDeg, a.endDeg, false, '#ef4444', 0.75);
      // 链接续缝：在分段边界画深红径向线
    });
    // 链接续边界
    r.forbidden.forEach((a, i) => {
      if (i > 0) drawSpoke(R_BASE, R_FEAS, a.startDeg, '#991b1b', 2, [4, 3]);
    });
    if (r.forbidden[r.forbidden.length - 1].joinsAcrossZero) {
      drawSpoke(R_BASE, R_FEAS, 0, '#991b1b', 3, [6, 3]);
    }
    // 保护区仍叠在最内环
    r.zones.forEach((z) => drawArcBand(R_BASE - 26, R_BASE - 4, z.startDeg, z.endDeg, z.wrap, '#3b82f6', 0.85));
  } else {
    // 正常：保护区蓝环 / 禁用红环 / 可行绿环
    r.zones.forEach((z) => drawArcBand(R_BASE + 2, R_ZONE, z.startDeg, z.endDeg, z.wrap, '#3b82f6', 0.8));
    r.forbidden.forEach((f) => drawArcBand(R_ZONE + 2, R_FORB, f.startDeg, f.endDeg, f.wrap, '#ef4444', 0.72));
    r.feasible.forEach((f) => drawArcBand(R_FORB + 2, R_FEAS, f.startDeg, f.endDeg, f.wrap, '#22c55e', 0.8));

    // 推荐位置：绿色虚线
    drawSpoke(R_BASE - 30, R_FEAS + 10, r.recommended.angleDeg, '#15803d', 2, [7, 5]);
  }

  // 环分隔圆
  ctx.save();
  ctx.strokeStyle = '#d1d5db';
  ctx.lineWidth = 1;
  [R_BASE, R_ZONE, R_FORB, R_FEAS, R_FEAS + 8].forEach((rr) => {
    ctx.beginPath(); ctx.arc(CX, CY, rr, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.restore();

  // 0° 标记
  drawSpoke(R_FEAS + 8, R_FEAS + 22, 0, '#111827', 2);
  ctx.save();
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  const z0 = polar(R_FEAS + 36, 0);
  ctx.fillText('0°', z0.x, z0.y + 4);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#6b7280';
  [90, 180, 270].forEach((d) => {
    const p = polar(R_FEAS + 18, d);
    ctx.fillText(d + '°', p.x, p.y + 4);
  });
  ctx.restore();

  drawRingLabels();

  // 当前接缝：中心位置径向粗线 + ±w/2 边界
  const seamDeg = mmToDeg(state.seam, C);
  const halfW = r.seamWidth || 0;
  const halfDeg = (halfW / 2 / C) * 360;
  const seamColor = r.covered || !state.seamFeasible ? '#7f1d1d' : '#111827';
  if (halfDeg > 0 && !r.covered) {
    drawArcBand(R_FORB + 4, R_FEAS - 2, G.mod(seamDeg - halfDeg, 360), G.mod(seamDeg + halfDeg, 360),
      seamDeg - halfDeg < 0 || seamDeg + halfDeg > 360, 'rgba(17,24,39,0.55)');
  }
  drawSpoke(R_BASE - 34, R_HANDLE + 2, seamDeg, seamColor, 3);
  drawSpoke(R_FORB, R_FEAS, G.mod(seamDeg - halfDeg, 360), seamColor, 1.5, [3, 3]);
  drawSpoke(R_FORB, R_FEAS, G.mod(seamDeg + halfDeg, 360), seamColor, 1.5, [3, 3]);

  // 拖动手柄
  const hp = polar(R_HANDLE, seamDeg);
  ctx.save();
  ctx.fillStyle = r.covered ? '#ef4444' : '#111827';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 中心文字
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = r.covered ? '#991b1b' : '#111827';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(r.covered ? '无解' : `${seamDeg.toFixed(1)}°`, CX, CY - (r.covered ? 4 : 10));
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.fillText(`接缝 ${state.seam.toFixed(1)} mm / ${C.toFixed(0)} mm`, CX, CY + 12);
  if (!r.covered) {
    ctx.fillText(`推荐 ${r.recommended.angleDeg.toFixed(1)}°`, CX, CY + 30);
  } else {
    ctx.fillStyle = '#991b1b';
    ctx.fillText('禁用链覆盖整圈', CX, CY + 16);
  }
  ctx.restore();

  drawStrip();
}

function drawEmptyHint(text) {
  ctx.save();
  ctx.fillStyle = '#6b7280';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, CX, CY);
  ctx.restore();
}

/** 下方展开条 [0,C]，便于直观查看跨零与拖动 */
function drawStrip() {
  const r = state.result;
  const { x, y, w, h } = STRIP;

  ctx.save();
  ctx.fillStyle = '#f0fdf4';
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);

  const px = (mm) => x + (G.mod(mm, r.C) / r.C) * w;
  const span = (a, color) => {
    if (!a.wrap) {
      const x0 = px(a.startMm), x1 = px(a.endMm);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y + 4, Math.max(1, x1 - x0), h - 8);
    } else {
      if (a.startMm <= 1e-6 && a.endMm >= r.C - 1e-6) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y + 4, w, h - 8);
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(px(a.startMm), y + 4, x + w - px(a.startMm), h - 8);
        ctx.fillRect(x, y + 4, px(a.endMm) - x, h - 8);
      }
    }
  };

  if (r.covered) {
    r.forbidden.forEach((f) => span(f, 'rgba(239,68,68,0.85)'));
  } else {
    r.feasible.forEach((f) => span(f, 'rgba(34,197,94,0.75)'));
    r.forbidden.forEach((f) => span(f, 'rgba(239,68,68,0.7)'));
    // 保护区细条（顶部 8px）
    r.zones.forEach((z) => {
      const draw = (mm0, mm1) => {
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(px(mm0), y + 1, Math.max(1, px(mm1) - px(mm0)), 6);
      };
      if (!z.wrap) draw(z.startMm, z.endMm);
      else { draw(z.startMm, r.C); draw(0, z.endMm); }
    });
  }

  // 0 / C 边界
  ctx.strokeStyle = '#111827';
  ctx.beginPath();
  ctx.moveTo(x, y - 3); ctx.lineTo(x, y + h + 3);
  ctx.moveTo(x + w, y - 3); ctx.lineTo(x + w, y + h + 3);
  ctx.stroke();

  // 刻度
  ctx.fillStyle = '#6b7280';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  for (let d = 0; d <= 360; d += 90) {
    const xx = x + (d / 360) * w;
    ctx.strokeStyle = '#9ca3af';
    ctx.beginPath(); ctx.moveTo(xx, y + h); ctx.lineTo(xx, y + h + 4); ctx.stroke();
    ctx.fillText(d + '°', xx, y + h + 16);
  }

  // 当前接缝竖线与手柄
  const sx = px(state.seam);
  ctx.strokeStyle = r.covered ? '#7f1d1d' : '#111827';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(sx, y - 2);
  ctx.lineTo(sx, y + h + 2);
  ctx.stroke();
  ctx.fillStyle = r.covered ? '#ef4444' : '#111827';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(sx, y - 6, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 推荐虚线
  if (!r.covered) {
    const rx = px(r.recommended.positionMm);
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(rx, y - 2);
    ctx.lineTo(rx, y + h + 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#374151';
  ctx.font = '12px sans-serif';
  ctx.fillText('展开图（0° 与 360° 为同一焊缝零点，保护区/禁用/可行同色）', x, y - 16);
  ctx.restore();
}

/* ---------------- 拖动与吸附 ---------------- */

function eventPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scale = W / rect.width;
  const t = e.touches ? e.touches[0] : e;
  return {
    x: (t.clientX - rect.left) * scale,
    y: (t.clientY - rect.top) * scale
  };
}

function hitDragTarget(pos) {
  const r = state.result;
  if (!r) return null;
  // 1) 圆盘手柄（沿最外环 ±14px 容差）
  const dx = pos.x - CX;
  const dy = pos.y - CY;
  const dist = Math.hypot(dx, dy);
  if (Math.abs(dist - R_HANDLE) <= 16 && dist > R_BASE - 20) {
    return 'dial';
  }
  // 2) 展开条
  const s = STRIP;
  if (pos.x >= s.x - 8 && pos.x <= s.x + s.w + 8 &&
      pos.y >= s.y - 14 && pos.y <= s.y + s.h + 14) {
    return 'strip';
  }
  return null;
}

function posToMm(pos, target) {
  const r = state.result;
  const C = r.C;
  if (target === 'strip') {
    const u = Math.max(0, Math.min(1, (pos.x - STRIP.x) / STRIP.w));
    return u * C;
  }
  // dial：指针方向角度
  let deg = (Math.atan2(pos.y - CY, pos.x - CX) * 180) / Math.PI + 90;
  deg = G.mod(deg, 360);
  return (deg / 360) * C;
}

function pointerDown(e) {
  if (!state.result) return;
  const pos = eventPos(e);
  const target = state.dragTarget || hitDragTarget(pos);
  if (!target) return;
  e.preventDefault();
  state.dragging = true;
  state.dragTarget = target;
  canvas.style.cursor = 'grabbing';
  moveTo(pos, target);
}

function pointerMove(e) {
  const pos = eventPos(e);
  if (!state.dragging) {
    canvas.style.cursor = hitDragTarget(pos) ? 'grab' : 'default';
    return;
  }
  e.preventDefault();
  moveTo(pos, state.dragTarget || 'dial');
}

function moveTo(pos, target) {
  const r = state.result;
  const raw = posToMm(pos, target);
  if (r.covered) {
    // 无解：自由跟随，红色提示
    state.seam = G.mod(raw, r.C);
    state.seamFeasible = false;
  } else {
    // 吸附到最近可行位置
    const snap = G.nearestFeasible(raw, r.feasible, r.C);
    state.seam = snap.positionMm;
    state.seamFeasible = true;
  }
  renderSummary();
  draw();
}

function pointerUp() {
  if (!state.dragging) return;
  state.dragging = false;
  state.dragTarget = null;
  canvas.style.cursor = 'default';
}

canvas.addEventListener('mousedown', (e) => {
  state.dragTarget = hitDragTarget(eventPos(e));
  pointerDown(e);
});
window.addEventListener('mousemove', pointerMove);
window.addEventListener('mouseup', pointerUp);
canvas.addEventListener('touchstart', (e) => {
  state.dragTarget = hitDragTarget(eventPos(e));
  pointerDown(e);
}, { passive: false });
window.addEventListener('touchmove', pointerMove, { passive: false });
window.addEventListener('touchend', pointerUp);

/* ---------------- 启动 ---------------- */

renderZoneRows();
fitDpr();
recompute();
