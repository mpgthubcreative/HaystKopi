// POST /.netlify/functions/get-payment-proof
// Requires an active OWNER or ADMIN. Storage's paymentProofs/** is fully
// closed to every client (see storage.rules) — this is the only way to
// view a proof image, and only ever generates a SHORT-LIVED (15 minute)
// signed URL rather than a permanently-open public link, so a leaked/
// bookmarked URL doesn't stay valid indefinitely.

const { admin, db, bucket, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isActiveAdminProfile } = require("./lib/authorize");
const { respond, RequestError } = require("./lib/http");

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, error: "server-misconfigured", message: "This service is temporarily unavailable. Please try again later." });
  }

  if (!bucket) {
    console.error("Storage bucket not configured.");
    return respond(500, { success: false, error: "server-misconfigured", message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, error: "method-not-allowed", message: "Method not allowed." });
  }

  const profile = await getCallerProfile(admin, db, event);
  if (!isActiveAdminProfile(profile)) {
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to view this." });
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
    const orderSnap = await db.collection("orders").doc(orderId).get();

    if (!orderSnap.exists) {
      throw new RequestError("order-not-found", "That order doesn't exist.", 404);
    }

    const order = orderSnap.data();
    if (!order.paymentProofPath) {
      throw new RequestError("no-proof", "This order has no payment proof uploaded.", 404);
    }

    const [url] = await bucket.file(order.paymentProofPath).getSignedUrl({
      action: "read",
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });

    return respond(200, { success: true, url, expiresInMinutes: SIGNED_URL_TTL_MS / 60000 });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("get-payment-proof failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't load the payment proof. Please try again." });
  }
};
