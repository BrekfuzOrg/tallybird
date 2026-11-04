import crypto from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Charge a card on file. With STRIPE_SECRET_KEY set this is Stripe; without it, the built-in test gateway. */
export async function charge({ amountCents, description, idempotencyKey }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) {
    const res = await fetch('https://api.stripe.com/v1/charges', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: new URLSearchParams({ amount: String(amountCents), currency: 'usd', source: 'tok_visa', description }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? `gateway answered ${res.status}`);
    return { ref: body.id };
  }
  await sleep(250);
  return { ref: `test_${crypto.randomBytes(8).toString('hex')}` };
}
