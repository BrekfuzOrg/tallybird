import express from 'express';
import { q } from '../db.js';
import { requireAdmin } from '../auth.js';

export const adminApi = express.Router();

adminApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

adminApi.get('/teams', requireAdmin, async (_req, res) => {
  res.json({ teams: await q(`SELECT t.id, t.name, t.suspended, count(m.user_id)::int AS members FROM teams t LEFT JOIN memberships m ON m.team_id = t.id GROUP BY t.id ORDER BY t.id`) });
});

adminApi.post('/teams/:id/suspend', requireAdmin, async (req, res) => {
  await q('UPDATE teams SET suspended = true WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

adminApi.get('/users/export', async (_req, res) => {
  res.json({ users: await q(`SELECT u.id, u.email, u.name, u.is_admin, t.name AS team, m.role FROM users u LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN teams t ON t.id = m.team_id ORDER BY u.id`) });
});
