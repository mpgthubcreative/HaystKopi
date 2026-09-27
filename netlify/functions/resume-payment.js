// POST /.netlify/functions/resume-payment
//
// Issues a FRESH payment-upload token for a customer resuming a GCash/Bank
// Transfer payment after closing their original tab (Phase 7's token only
// ever existed in that tab's sessionStorage). Same order+phone lookup
// boundary as get-order-status.js — see lib/order-lookup.js — plus extra
// state checks specific to actually being allowed to pay right now.
//
// Writing the new token hash OVERWRITES the old one on the order doc, so
// the previous token (whatever it was, expired or not, lost tab or not)
// stops working the instant this succeeds — never two valid tokens for the
// same order at once.
//
// Deliberately uses CURRENT settings/payments, not the order's frozen
// paymentInstructionsSnapshot — if the Owner changed the GCash number since
// the order was placed, someone paying right now needs the number that's
// actually correct today, not what was true when they checked out.

const { admin, db, initError } = require("./lib/firebase-admin");
const { lookupOrderByNumberAndPhone } = require("./lib/order-lookup");
const { generateUploadToken, hashUploadToken, tokenExpiryTimestamp, RESUME_TOKEN_TTL_MS } = require("./lib/payment-upload-token");
const { getPaymentSettings, buildPaymentInstructions } = require("./lib/payment-settings");
const { respond } = require("./lib/http");

const MAX_BODY_BYTES = 500;
const NOT_FOUND_MESSAGE = "We couldn't find an order matching those details.";
const PROOF_REQUIRED_METHODS = ["gcash", "bank-transfer"];

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, message: "Method not allowed." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, message: "Please enter your order number and mobile number." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, message: "Please enter your order number and mobile number." });
  }

  const orderNumber = typeof payload.orderNumber === "string" ? payload.orderNumber.trim().slice(0, 40) : "";
  const phone = typeof payload.phone === "string" ? payload.phone.trim().slice(0, 20) : "";

  if (!orderNumber || !phone) {
    return respond(400, { success: false, message: "Please enter your order number and mobile number." });
  }

  try {
    const lookup = await lookupOrderByNumberAndPhone(db, orderNumber, phone);

    if (!lookup.found) {
      return respond(200, { success: false, message: NOT_FOUND_MESSAGE });
    }

    const { orderId, order } = lookup;

    if (!PROOF_REQUIRED_METHODS.includes(order.paymentMethod)) {
      return respond(400, { success: false, message: "This order doesn't require a payment upload." });
    }

    if (order.orderStatus === "CANCELLED") {
      return respond(409, { success: false, message: "This order has been cancelled." });
    }

    if (order.paymentStatus === "PAID") {
      return respond(409, { success: false, message: "This order's payment has already been verified." });
    }

    const newToken = generateUploadToken();
    const newTokenHash = hashUploadToken(newToken);
    const newExpiresAt = tokenExpiryTimestamp(admin, RESUME_TOKEN_TTL_MS);

    await db.collection("orders").doc(orderId).update({
      paymentUploadTokenHash: newTokenHash,
      paymentUploadTokenExpiresAt: newExpiresAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let paymentInstructions = null;
    try {
      const paymentSettings = await getPaymentSettings(db);
      paymentInstructions = buildPaymentInstructions(paymentSettings, order.paymentMethod);
    } catch (err) {
      console.error("Failed to load payment settings during resume:", err);
    }

    return respond(200, {
      success: true,
      orderId,
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      amountDue: order.total,
      paymentUploadToken: newToken,
      paymentInstructions,
      expiresInMinutes: RESUME_TOKEN_TTL_MS / 60000,
    });
  } catch (err) {
    console.error("resume-payment failed:", err);
    return respond(500, { success: false, message: "We couldn't set up your payment right now. Please try again." });
  }
};
