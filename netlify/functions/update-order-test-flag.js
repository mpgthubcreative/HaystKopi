// POST /.netlify/functions/update-order-test-flag
// OWNER-only. An ADMIN's valid ID token is authenticated the same way but
// rejected by isOwnerProfile() — this is the actual enforcement point, the
// same pattern as delete-order.js. The admin UI hides this control for
// ADMIN, but that's UX only; a modified client still can't reach it.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isOwnerProfile } = require("./lib/authorize");
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
  if (!isOwnerProfile(profile)) {
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to do this." });
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
  const isTest = payload.isTest;

  if (!orderId) {
    return respond(400, { success: false, error: "invalid-request", message: "Missing order ID." });
  }

  if (typeof isTest !== "boolean") {
    return respond(400, { success: false, error: "invalid-request", message: "Order could not be updated." });
  }

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      throw new RequestError("order-not-found", "That order doesn't exist.", 404);
    }

    await orderRef.update({
      isTest,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return respond(200, { success: true, orderId, isTest });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("update-order-test-flag failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Order could not be updated." });
  }
};
