// Shared secure lookup for customer order tracking — used by both
// get-order-status.js and resume-payment.js so the two endpoints can never
// disagree on what counts as a match. Both orderNumber AND phone must
// match; the caller never learns which one was wrong (see the endpoints'
// generic "we couldn't find an order matching those details" response).
//
// Orders are keyed by clientRequestId (a UUID), not orderNumber, so this is
// a query (single equality filter — auto-indexed, no composite index
// needed) rather than a direct doc().get().

const { normalizePhone } = require("./phone");

async function lookupOrderByNumberAndPhone(db, orderNumber, phone) {
  const normalizedInput = normalizePhone(phone);
  if (!orderNumber || !normalizedInput) {
    return { found: false };
  }

  const snap = await db.collection("orders").where("orderNumber", "==", orderNumber).limit(1).get();
  if (snap.empty) {
    return { found: false };
  }

  const docSnap = snap.docs[0];
  const order = docSnap.data();

  // Older orders (pre-Phase-8) never had phoneNormalized written — fall
  // back to normalizing the raw phone field so they remain trackable.
  const orderPhoneNormalized = order.phoneNormalized || normalizePhone(order.phone);

  if (!orderPhoneNormalized || orderPhoneNormalized !== normalizedInput) {
    return { found: false };
  }

  return { found: true, orderId: docSnap.id, order };
}

module.exports = { lookupOrderByNumberAndPhone };
