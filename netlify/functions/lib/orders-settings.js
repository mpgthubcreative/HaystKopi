// Reads settings/orders — acceptingOrders (store-wide ordering toggle) and
// pickup (enabled/address/hours/instructions). Same generic
// settings/{settingId} Firestore rule already covers this (admin-read,
// owner-write, no public access) — zero rule change needed.

async function getOrdersSettings(db) {
  const snap = await db.collection("settings").doc("orders").get();
  return snap.exists ? snap.data() : null;
}

// The actual enforcement point for "store closed" / "pickup disabled" —
// defaults are deliberately FAIL-CLOSED: a missing settings/orders document
// means accepting orders is NOT assumed true and pickup is NOT assumed
// enabled. An Owner who hasn't configured this yet gets a clear "not
// accepting orders" state rather than an silently-open storefront.
function isAcceptingOrders(settings) {
  return Boolean(settings && settings.acceptingOrders === true);
}

function isPickupEnabled(settings) {
  return Boolean(settings && settings.pickup && settings.pickup.enabled === true);
}

module.exports = { getOrdersSettings, isAcceptingOrders, isPickupEnabled };
