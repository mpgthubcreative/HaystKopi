// Server-side checkout config that ISN'T delivery pricing — delivery fees
// now live entirely in Firestore settings/delivery (see lib/delivery.js),
// owner-editable, never hardcoded here.

// The only server-authoritative mapping of which payment methods are valid
// for which fulfillment method. checkout.js's own option-hiding is UX only —
// this is what's actually enforced.
const PAYMENT_METHODS_BY_FULFILLMENT = {
  pickup: ["gcash", "bank-transfer", "cash-on-pickup"],
  delivery: ["gcash", "bank-transfer", "cash-on-delivery"],
};

module.exports = { PAYMENT_METHODS_BY_FULFILLMENT };
