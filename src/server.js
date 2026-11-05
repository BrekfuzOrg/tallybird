import express from 'express';
import cookieParser from 'cookie-parser';
import { pool, q } from './db.js';
import { loadUser } from './auth.js';
import { startHousekeeping } from './jobs.js';
import { startReportQueue } from './reports.js';
import { startStatementQueue } from './statements.js';
import { authApi } from './routes/auth.js';
import { teamApi } from './routes/team.js';
import { customersApi } from './routes/customers.js';
import { invoicesApi } from './routes/invoices.js';
import { billingApi } from './routes/billing.js';
import { documentsApi } from './routes/documents.js';
import { adminApi } from './routes/admin.js';
import { reportsApi } from './routes/reports.js';
import { statementsApi } from './routes/statements.js';
import { activityApi } from './routes/activity.js';
import { pages } from './pages.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(new URL('../public', import.meta.url).pathname));

// Express 4 does not catch rejected async handlers on its own.
const wrap = (router) => {
  for (const layer of router.stack ?? []) {
    for (const step of layer.route?.stack ?? []) {
      const fn = step.handle;
      step.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    }
  }
  return router;
};

app.get('/healthz', async (_req, res) => {
  try { await q('SELECT 1'); res.json({ status: 'ok' }); } catch { res.status(503).json({ status: 'down' }); }
});
app.use(loadUser);
app.use('/api', wrap(authApi));
app.use('/api/team', wrap(teamApi));
app.use('/api/customers', wrap(customersApi));
app.use('/api/invoices', wrap(invoicesApi));
app.use('/api/billing-runs', wrap(billingApi));
app.use('/api/documents', wrap(documentsApi));
app.use('/api/admin', wrap(adminApi));
app.use('/api/reports', wrap(reportsApi));
app.use('/api/statements', wrap(statementsApi));
app.use('/api/activity', wrap(activityApi));
app.use('/', wrap(pages));

app.use((err, _req, res, _next) => {
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'That request could not be read' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  console.log(`tallybird listening on ${port}`);
  startHousekeeping();
  startReportQueue();
  startStatementQueue();
});
process.on('SIGTERM', () => server.close(() => pool.end().then(() => process.exit(0))));
