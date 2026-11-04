import crypto from 'node:crypto';
import express from 'express';
import { one, q, now } from '../db.js';
import { requireOwner, requireTeam } from '../auth.js';

export const teamApi = express.Router();
teamApi.use(requireTeam);

teamApi.get('/', async (req, res) => {
  const members = await q(
    'SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.team_id = $1 ORDER BY u.id',
    [req.team.id],
  );
  res.json({ team: { id: req.team.id, name: req.team.name, description: req.team.description, role: req.team.role }, members });
});

teamApi.patch('/', requireOwner, async (req, res) => {
  const name = req.body?.name ?? req.team.name;
  const description = req.body?.description ?? req.team.description;
  try {
    await q('UPDATE teams SET name = $2, description = $3 WHERE id = $1', [req.team.id, name, description]);
  } catch (e) {
    console.warn('team settings', e.message);
  }
  res.json({ ok: true, team: { id: req.team.id, name, description } });
});

teamApi.get('/invites', requireOwner, async (req, res) => {
  res.json({ invites: await q('SELECT token, email, accepted_at, created_at FROM invites WHERE team_id = $1 ORDER BY created_at DESC', [req.team.id]) });
});

teamApi.post('/invites', requireOwner, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const token = crypto.randomBytes(16).toString('hex');
  await q('INSERT INTO invites (token, team_id, email, created_at) VALUES ($1,$2,$3,$4)', [token, req.team.id, email, now()]);
  res.status(201).json({ invite: { token, email, link: `/signup?invite=${token}` } });
});
