import express from 'express';
import { requireTeam } from '../auth.js';
import { activityGroups, runningNow, runsPanel, totalsPanel } from '../activity.js';

export const activityApi = express.Router();
activityApi.use(requireTeam);

activityApi.get('/', async (req, res) => {
  res.json({ groups: await activityGroups(req.team.id) });
});

/** The newest group, for the Activity page to follow while it is open. */
activityApi.get('/latest', async (req, res) => {
  res.json({ latest: (await activityGroups(req.team.id, 60)).at(-1) ?? null });
});

activityApi.get('/running', async (req, res) => {
  res.json({ running: await runningNow(req.team.id) });
});

activityApi.get('/totals', async (req, res) => {
  res.json({ html: await totalsPanel(req.team.id) });
});

activityApi.get('/runs', async (req, res) => {
  res.json({ html: await runsPanel(req.team.id) });
});
