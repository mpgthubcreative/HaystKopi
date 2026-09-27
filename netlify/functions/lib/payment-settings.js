// Reads settings/payments (owner-editable later; see firestore.rules —
// same generic settings/{settingId} rule from Phase 1 already covers this:
// admin-read, owner-write, no public access, zero rule change needed).
//
// Nothing secret lives here — a GCash number and bank account number are
// customer-facing payment instructions by nature (a customer must see them
// to pay), not credentials. This never returns anything else from the
// settings document.

async function getPaymentSettings(db) {
  const snap = await db.collection("settings").doc("payments").get();
  return snap.exists ? snap.data() : null;
}

// Builds the exact safe subset to hand to a customer for a given payment
// method — used both in create-order.js's response and as the snapshot
// frozen onto the order itself (so a later settings change never rewrites
// what an existing order already told the customer to pay to).
function buildPaymentInstructions(settings, paymentMethod) {
  if (!settings) return null;

  if (paymentMethod === "gcash" && settings.gcash && settings.gcash.enabled) {
    return {
      method: "gcash",
      accountName: settings.gcash.accountName || "",
      number: settings.gcash.number || "",
      qrImagePath: settings.gcash.qrImagePath || "",
    };
  }

  if (paymentMethod === "bank-transfer" && settings.bankTransfer && settings.bankTransfer.enabled) {
    return {
      method: "bank-transfer",
      bankName: settings.bankTransfer.bankName || "",
      accountName: settings.bankTransfer.accountName || "",
      accountNumber: settings.bankTransfer.accountNumber || "",
    };
  }

  return null;
}

// The actual enforcement point for "if Owner disables a payment method,
// create-order must reject the stale option" — checked against CURRENT
// settings at order-creation time, never anything the client asserts.
function isPaymentMethodEnabled(settings, paymentMethod) {
  if (!settings) return false;
  switch (paymentMethod) {
    case "gcash": return Boolean(settings.gcash && settings.gcash.enabled);
    case "bank-transfer": return Boolean(settings.bankTransfer && settings.bankTransfer.enabled);
    case "cash-on-pickup": return Boolean(settings.cashOnPickup && settings.cashOnPickup.enabled);
    case "cash-on-delivery": return Boolean(settings.cashOnDelivery && settings.cashOnDelivery.enabled);
    default: return false;
  }
}

module.exports = { getPaymentSettings, buildPaymentInstructions, isPaymentMethodEnabled };
