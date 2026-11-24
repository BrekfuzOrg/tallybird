import crypto from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Charge a card on file. With STRIPE_SECRET_KEY set this is Stripe; without it, the built-in test gateway. */
export async function charge({ amountCents, description, idempotencyKey, currency = 'usd' }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) {
    const res = await fetch('https://api.stripe.com/v1/charges', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: new URLSearchParams({ amount: String(amountCents), currency, source: 'tok_visa', description }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? `gateway answered ${res.status}`);
    return { ref: body.id };
  }
  await sleep(250);
  return { ref: `test_${crypto.randomBytes(8).toString('hex')}` };
}

/** Give a charge back to the card it came from, in full. Stripe with STRIPE_SECRET_KEY; else the test gateway. */
export async function refund({ chargeRef, amountCents }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) {
    const res = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `refund-${chargeRef}` },
      body: new URLSearchParams({ charge: chargeRef, amount: String(amountCents) }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? `gateway answered ${res.status}`);
    return { ref: body.id };
  }
  await sleep(250);
  return { ref: `re_test_${crypto.randomBytes(8).toString('hex')}` };
}

/**
 * Refunds of payments that have already settled to the bank go back with the next payout, in one batch,
 * instead of one gateway call each.
 */
const settledRefunds = [];
export const payoutBatch = {
  add(item) { settledRefunds.push({ ...item, queuedAt: new Date() }); },
  get size() { return settledRefunds.length; },
};
