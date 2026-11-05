import express from 'express';
import { one, q } from '../db.js';
import { requireTeam } from '../auth.js';
import { PREVIEW_LINES, ReportRefused, reportsLeft, startReport, stopReport } from '../reports.js';

export const reportsApi = express.Router();
reportsApi.use(requireTeam);

reportsApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

reportsApi.get('/', async (req, res) => {
  const reports = await q('SELECT id, period, scope, skip, state, total, done, started_at, finished_at FROM reports WHERE team_id = $1 ORDER BY id DESC LIMIT 25', [req.team.id]);
  res.json({ reports, ...(await reportsLeft(req.team.id)) });
});

reportsApi.get('/:id', async (req, res) => {
  const report = await one('SELECT id, period, scope, state, total, done, lines, started_at, finished_at FROM reports WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!report) return res.status(404).json({ error: 'No such report' });
  res.json({ report });
});

reportsApi.post('/', async (req, res) => {
  const period = String(req.body?.period ?? new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'Period looks like 2026-11' });
  try {
    const report = await startReport(req.team, req.user, period, req.body?.scope === 'rest' ? 'rest' : 'all', PREVIEW_LINES);
    res.status(202).json({ report });
  } catch (e) {
    if (e instanceof ReportRefused) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

reportsApi.post('/:id/stop', async (req, res) => {
  const report = await stopReport(req.team, req.params.id);
  if (!report) return res.status(409).json({ error: 'That report is not running' });
  res.json({ ok: true, report: { id: report.id, state: report.state } });
});
