// POST /.netlify/functions/update-order-status
// Requires an active OWNER or ADMIN (Authorization: Bearer <Firebase ID token>).
//
// Cancellation is deliberately NOT handled here — CANCELLED has special
// inventory-restoration logic that only cancel-order.js implements. This
// endpoint rejects any attempt to set status to CANCELLED and tells the
// caller to use that endpoint instead, so there is exactly one place that
// ever restores inventory for a cancellation.
//
// An order already in a terminal CANCELLED state is not allowed to move to
// any other status through this endpoint — that would leave inventory
// restored while the order looks active again.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isActiveAdminProfile } = require("./lib/authorize");
const { ORDER_STATUS_VALUES, isStatusValidForFulfillment } = require("./lib/order-status");
const { respond, RequestError } = require("./lib/http");

const MAX_BODY_BYTES = 2000;

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
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to update this order." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, error: "invalid-request", message: "Order could not be updated." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "Order could not be updated." });
  }

  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const status = typeof payload.status === "string" ? payload.status : "";

  if (!orderId) {
    return respond(400, { success: false, error: "invalid-request", message: "Missing order ID." });
  }

  if (!ORDER_STATUS_VALUES.includes(status)) {
    return respond(400, { success: false, error: "invalid-status", message: "That isn't a valid order status." });
  }

  if (status === "CANCELLED") {
    return respond(400, { success: false, error: "use-cancel-endpoint", message: "Use the Cancel Order action instead." });
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

      if (!isStatusValidForFulfillment(status, order.fulfillmentMethod)) {
        throw new RequestError(
          "status-not-allowed",
          order.fulfillmentMethod === "pickup"
            ? "Out for Delivery isn't valid for a pickup order."
            : "Ready for Pickup isn't valid for a delivery order.",
          400
        );
      }

      tx.update(orderRef, {
        orderStatus: status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status,
          at: admin.firestore.Timestamp.now(),
          updatedBy: profile.uid,
          updatedByName: profile.name || profile.email || "",
          note: `Status changed to ${status}`,
        }),
      });

      return { orderId, orderStatus: status };
    });

    return respond(200, { success: true, ...result });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("update-order-status failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Order could not be updated." });
  }
};
