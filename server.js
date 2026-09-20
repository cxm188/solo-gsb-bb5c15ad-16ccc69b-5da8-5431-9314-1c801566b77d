'use strict';

const path = require('path');
const express = require('express');
const geom = require('./lib/geometry');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/lib', express.static(path.join(__dirname, 'lib')));

/**
 * POST /api/analyze
 * body: { circumference, seamWidth, zones: [{ start, length }, ...] }
 * 长度单位均为 mm；返回可行/禁用角度段与推荐旋转量。
 */
app.post('/api/analyze', (req, res) => {
  try {
    const body = req.body || {};
    const C = Number(body.circumference);
    const w = Number(body.seamWidth);
    const zones = Array.isArray(body.zones) ? body.zones : [];
    const result = geom.analyze(C, w, zones);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/snap  拖动吸附：给定指针位置，吸附到最近可行位置
 * body: { circumference, positionMm, feasible: [..analyze.result.feasible] }
 */
app.post('/api/snap', (req, res) => {
  try {
    const body = req.body || {};
    const C = Number(body.circumference);
    if (!(C > 0)) throw new Error('筒体周长必须为正数');
    const snap = geom.nearestFeasible(
      Number(body.positionMm),
      body.feasible || [],
      C
    );
    res.json({ ok: true, snap });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`圆筒接缝避让服务已启动: http://${HOST}:${PORT}`);
});
