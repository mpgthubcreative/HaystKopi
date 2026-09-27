// POST /.netlify/functions/confirm-payment-reference
//
// Same order-specific uploadToken authorization as upload-payment-proof.js
// (no Firebase Auth — the customer never logs in).
//
// This is the ONLY place paymentReference/paymentReferenceConfirmed/
// paymentReferenceSource/paymentStatus get set for a digital-payment order.
// The customer may submit only their final confirmed reference string —
// everything else (source classification, duplicate check, the
// AWAITING_VERIFICATION transition) is computed here, server-side.

const { admin, db, initError } = require("./lib/firebase-admin");
const { isUploadTokenValid } = require("./lib/payment-upload-token");
const { respond, RequestError } = require("./lib/http");

const MAX_BODY_BYTES = 2000;
const MAX_REFERENCE_LENGTH = 50;

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, error: "server-misconfigured", message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, error: "method-not-allowed", message: "Method not allowed." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, error: "invalid-request", message: "We couldn't confirm your payment details. Please try again." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "We couldn't confirm your payment details. Please try again." });
  }

  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const uploadToken = typeof payload.uploadToken === "string" ? payload.uploadToken : "";
  const paymentReference = typeof payload.paymentReference === "string" ? payload.paymentReference.trim().slice(0, MAX_REFERENCE_LENGTH) : "";

  if (!orderId || !uploadToken || !paymentReference) {
    return respond(400, { success: false, error: "invalid-request", message: "Please enter your reference number." });
  }

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      throw new RequestError("order-not-found", "That order doesn't exist.", 404);
    }

    const order = orderSnap.data();

    if (!isUploadTokenValid({ admin, providedToken: uploadToken, storedHash: order.paymentUploadTokenHash, expiresAt: order.paymentUploadTokenExpiresAt })) {
      throw new RequestError("invalid-upload-token", "This upload link is no longer valid. Please contact us.", 403);
    }

    if (order.paymentStatus === "PAID") {
      throw new RequestError("already-paid", "This order's payment has already been verified and can no longer be changed here.", 409);
    }

    if (order.orderStatus === "CANCELLED") {
      throw new RequestError("order-cancelled", "This order has been cancelled.", 409);
    }

    if (!order.paymentProofPath) {
      throw new RequestError("no-proof-uploaded", "Please upload your payment screenshot first.", 400);
    }

    const detected = order.paymentReferenceDetected;
    let source;
    if (!detected) {
      source = "manual";
    } else if (detected === paymentReference) {
      source = "ocr";
    } else {
      source = "ocr-edited";
    }

    // Duplicate check: a single equality filter (auto-indexed by Firestore,
    // no composite index needed) — isTest and self-exclusion are filtered
    // in memory afterward. Reference values are specific enough that this
    // realistically returns 0–1 matches even without narrowing server-side.
    const duplicateSnap = await db.collection("orders").where("paymentReference", "==", paymentReference).get();
    const duplicatePaymentReference = duplicateSnap.docs.some(
      (docSnap) => docSnap.id !== orderId && docSnap.data().isTest !== true
    );

    await orderRef.update({
      paymentReference,
      paymentReferenceConfirmed: true,
      paymentReferenceSource: source,
      duplicatePaymentReference,
      paymentStatus: "AWAITING_VERIFICATION",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return respond(200, {
      success: true,
      paymentReference,
      paymentReferenceSource: source,
      duplicatePaymentReference,
      paymentStatus: "AWAITING_VERIFICATION",
    });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("confirm-payment-reference failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't confirm your payment details. Please try again." });
  }
};
