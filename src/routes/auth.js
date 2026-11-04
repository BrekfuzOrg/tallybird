import express from 'express';
import { one, q, now } from '../db.js';
import { checkPassword, hashPassword, requireUser, startSession } from '../auth.js';

export const authApi = express.Router();

authApi.post('/signup', async (req, res) => {
  const { email, name, password, team, invite } = Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const taken = await one('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase()]);
  if (taken) return res.status(409).json({ error: 'That email already has an account' });
  let pending = null;
  if (invite) {
    pending = await one('SELECT * FROM invites WHERE token = $1 AND accepted_at IS NULL', [invite]);
    if (!pending || pending.email !== String(email).toLowerCase()) return res.status(400).json({ error: 'That invite is no longer valid for this email' });
  }
  const user = await one(
    'INSERT INTO users (email, name, password_hash, created_at) VALUES ($1,$2,$3,$4) RETURNING id, email, name',
    [String(email).toLowerCase(), name, await hashPassword(password), now()],
  );
  if (pending) {
    await q(`INSERT INTO memberships (user_id, team_id, role) VALUES ($1,$2,'member')`, [user.id, pending.team_id]);
    await q('UPDATE invites SET accepted_at = $2 WHERE token = $1', [pending.token, now()]);
  } else {
    const created = await one('INSERT INTO teams (name, created_at) VALUES ($1,$2) RETURNING id', [team || `${name}'s team`, now()]);
    await q(`INSERT INTO memberships (user_id, team_id, role) VALUES ($1,$2,'owner')`, [user.id, created.id]);
  }
  await startSession(res, user.id);
  res.status(201).json({ user });
});

authApi.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await one('SELECT * FROM users WHERE email = $1', [String(email ?? '').toLowerCase()]);
  if (!user || !(await checkPassword(String(password ?? ''), user.password_hash))) return res.status(401).json({ error: 'Wrong email or password' });
  await startSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

authApi.post('/logout', requireUser, async (req, res) => {
  await q('DELETE FROM sessions WHERE token = $1', [req.cookies.session]);
  res.clearCookie('session');
  res.json({ ok: true });
});

authApi.get('/me', requireUser, (req, res) => {
  const { id, email, name, is_admin: isAdmin } = req.user;
  res.json({ user: { id, email, name, isAdmin }, team: req.team ? { id: req.team.id, name: req.team.name, role: req.team.role } : null });
});
