// POST /.netlify/functions/cancel-order
//
// Requires an active OWNER or ADMIN caller (Authorization: Bearer <ID token>).
// Restores inventory exactly once, guarded by inventoryDeducted/inventoryRestored.
//
// Terminal-state safety (enforced here, not just in the admin UI):
//   - Already CANCELLED  -> rejected, not silently re-accepted.
//   - COMPLETED           -> rejected outright; completed orders can't be
//     cancelled through this phase's tooling at all.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isActiveAdminProfile } = require("./lib/authorize");
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
  if (!isActiveAdminProfile(profile)) {
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

      if (order.orderStatus === "CANCELLED") {
        throw new RequestError("order-cancelled", "This order has already been cancelled.", 409);
      }
      if (order.orderStatus === "COMPLETED") {
        throw new RequestError("order-completed", "Completed orders cannot be cancelled.", 409);
      }

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
          logType: "order_cancel_restore",
          actorUid: profile.uid,
          actorName: profile.name || profile.email || "",
        });
      }

      tx.update(orderRef, {
        orderStatus: "CANCELLED",
        inventoryRestored: shouldRestore ? true : order.inventoryRestored === true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status: "CANCELLED",
          at: admin.firestore.Timestamp.now(),
          updatedBy: profile.uid,
          updatedByName: profile.name || profile.email || "",
          note: `Cancelled by ${profile.role}`,
        }),
      });

      return { orderId, orderStatus: "CANCELLED", restored: shouldRestore };
    });

    return respond(200, { success: true, ...result });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("cancel-order failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Couldn't cancel that order. Please try again." });
  }
};
