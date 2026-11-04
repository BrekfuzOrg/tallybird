import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, q, now } from './db.js';

export const hashPassword = (password) => bcrypt.hash(password, 8);
export const checkPassword = (password, hash) => bcrypt.compare(password, hash);

export async function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await q('INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)', [token, userId, now()]);
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', path: '/' });
}

/** Sets req.user and req.team (the user's team and role) for everything behind it. */
export async function loadUser(req, _res, next) {
  try {
    const token = req.cookies?.session;
    if (token) {
      req.user = await one('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]);
      if (req.user) {
        req.team = await one(
          'SELECT t.*, m.role FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 ORDER BY t.id LIMIT 1',
          [req.user.id],
        );
      }
    }
    next();
  } catch (e) { next(e); }
}

const wantsPage = (req) => !req.path.startsWith('/api') && !req.originalUrl.startsWith('/api');

export function requireUser(req, res, next) {
  if (req.user) return next();
  if (wantsPage(req)) return res.redirect('/login');
  return res.status(401).json({ error: 'Sign in first' });
}
export function requireTeam(req, res, next) {
  if (!req.user) return requireUser(req, res, next);
  if (req.team?.suspended) return wantsPage(req) ? res.status(403).send('This team is suspended. Contact support.') : res.status(403).json({ error: 'This team is suspended' });
  if (req.team) return next();
  return wantsPage(req) ? res.redirect('/admin') : res.status(403).json({ error: 'You are not on a team' });
}
export function requireOwner(req, res, next) {
  if (req.team?.role === 'owner') return next();
  return res.status(403).json({ error: 'Only the team owner can do this' });
}
export function requireAdmin(req, res, next) {
  if (req.user?.is_admin) return next();
  return res.status(403).json({ error: 'Admins only' });
}
