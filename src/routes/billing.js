import express from 'express';
import { one, q } from '../db.js';
import { requireOwner, requireTeam } from '../auth.js';
import { RunInProgress, startBillingRun } from '../jobs.js';

export const billingApi = express.Router();
billingApi.use(requireTeam, requireOwner);

billingApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

billingApi.get('/', async (req, res) => {
  res.json({ runs: await q('SELECT * FROM billing_runs WHERE team_id = $1 ORDER BY id DESC LIMIT 25', [req.team.id]) });
});

billingApi.get('/:id', async (req, res) => {
  const run = await one('SELECT * FROM billing_runs WHERE id = $1 AND team_id = $2', [req.params.id, req.team.id]);
  if (!run) return res.status(404).json({ error: 'No such run' });
  res.json({ run });
});

billingApi.post('/', async (req, res) => {
  const period = String(req.body?.period ?? new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'Period looks like 2026-11' });
  try {
    const run = await startBillingRun(req.team, req.user, period);
    res.status(202).json({ run });
  } catch (e) {
    if (e instanceof RunInProgress) return res.status(409).json({ error: e.message });
    throw e;
  }
});
