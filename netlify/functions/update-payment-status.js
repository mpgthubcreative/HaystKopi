// POST /.netlify/functions/update-payment-status
// Requires an active OWNER or ADMIN. Payment status is intentionally
// independent of order status — this never touches orderStatus or
// statusHistory, and update-order-status.js never touches paymentStatus.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isActiveAdminProfile } = require("./lib/authorize");
const { PAYMENT_STATUS_VALUES } = require("./lib/order-status");
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
  const paymentStatus = typeof payload.paymentStatus === "string" ? payload.paymentStatus : "";

  if (!orderId) {
    return respond(400, { success: false, error: "invalid-request", message: "Missing order ID." });
  }

  if (!PAYMENT_STATUS_VALUES.includes(paymentStatus)) {
    return respond(400, { success: false, error: "invalid-payment-status", message: "That isn't a valid payment status." });
  }

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      throw new RequestError("order-not-found", "That order doesn't exist.", 404);
    }

    await orderRef.update({
      paymentStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return respond(200, { success: true, orderId, paymentStatus });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("update-payment-status failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Order could not be updated." });
  }
};
