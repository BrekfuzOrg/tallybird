import express from 'express';
import { one, q } from '../db.js';
import { requireTeam } from '../auth.js';
import { StatementsRefused, cancelStatements, startStatements } from '../statements.js';

export const statementsApi = express.Router();
statementsApi.use(requireTeam);

statementsApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

statementsApi.get('/', async (req, res) => {
  res.json({ runs: await q('SELECT id, period, state, total, done, started_at, finished_at FROM statement_runs WHERE team_id = $1 ORDER BY id DESC LIMIT 25', [req.team.id]) });
});

statementsApi.get('/:id', async (req, res) => {
  const run = await one('SELECT id, period, state, total, done, statements, started_at, finished_at FROM statement_runs WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!run) return res.status(404).json({ error: 'No such statements run' });
  res.json({ run });
});

statementsApi.post('/', async (req, res) => {
  const period = String(req.body?.period ?? new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'Period looks like 2026-11' });
  try {
    const run = await startStatements(req.team, req.user, period);
    res.status(202).json({ run });
  } catch (e) {
    if (e instanceof StatementsRefused) return res.status(409).json({ error: e.message });
    throw e;
  }
});

statementsApi.post('/:id/cancel', async (req, res) => {
  const run = await cancelStatements(req.team, req.params.id);
  if (!run) return res.status(409).json({ error: 'Those statements are not being prepared' });
  res.json({ ok: true, run: { id: run.id, state: run.state } });
});
