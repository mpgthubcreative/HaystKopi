// POST /.netlify/functions/delete-order
//
// FOUNDATION for Phase 6 — no button calls this yet. Permanently deletes an
// order document. OWNER-only: an ADMIN's ID token is authenticated the same
// way, but isOwnerProfile() rejects anything but role === "owner", so an
// admin calling this endpoint directly (bypassing any future UI restriction)
// is still denied here — the backend is the actual enforcement point, not
// the UI that will be built in Phase 6.
//
// Restores inventory first (same guarded, once-only logic as cancel-order)
// if it hadn't already been restored, then deletes the order document.
// inventoryLogs entries are never deleted — they're the audit trail.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
const { readOrderItemProducts, applyInventoryRestoration } = require("./lib/inventory-restore");
const { respond, RequestError } = require("./lib/http");

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, error: "server-misconfigured", message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, error: "method-not-allowed", message: "Method not allowed." });
  }

  const profile = await getCallerProfile(admin, db, event);
  if (!isOwnerProfile(profile)) {
    return respond(403, { success: false, error: "forbidden", message: "You are not authorized to do this." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "Invalid request." });
  }

  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  if (!orderId) {
    return respond(400, { success: false, error: "invalid-request", message: "Missing order ID." });
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await tx.get(orderRef);

      if (!orderSnap.exists) {
        throw new RequestError("order-not-found", "That order doesn't exist.", 404);
      }

      const order = orderSnap.data();
      const itemProductPairs = await readOrderItemProducts(tx, db, order);

      const shouldRestore = order.inventoryDeducted === true && order.inventoryRestored !== true;

      if (shouldRestore) {
        applyInventoryRestoration({
          tx,
          db,
          admin,
          itemProductPairs,
          orderId,
          orderNumber: order.orderNumber,
          logType: "order_delete_restore",
          actorUid: profile.uid,
          actorName: profile.name || profile.email || "",
        });
      }

      tx.delete(orderRef);

      return { orderId, deleted: true, restored: shouldRestore };
    });

    return respond(200, { success: true, ...result });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("delete-order failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Couldn't delete that order. Please try again." });
  }
};
