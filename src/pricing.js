const TAX_RATE = 0.08;

/** Volume discount: 10% at 100 seats or more. */
export function discountRate(seats) {
  return seats > 100 ? 0.1 : 0;
}

export function priceInvoice({ seats, priceCents }) {
  const gross = seats * priceCents;
  const discount = Math.round(gross * discountRate(seats));
  const tax = Math.round((gross - discount) * TAX_RATE);
  return { unitCents: priceCents, discountCents: discount, taxCents: tax, totalCents: gross - discount + tax };
}
