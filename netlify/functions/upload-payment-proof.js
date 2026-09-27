// POST /.netlify/functions/upload-payment-proof
//
// No Firebase Auth token here — the customer never logs in. Authorization
// is the order-specific uploadToken instead (see lib/payment-upload-token.js).
// orderId alone is NEVER sufficient — anyone who saw/guessed an order
// number must not be able to overwrite someone else's proof.
//
// Storage path is fixed per order (paymentProofs/{orderId}/proof, no
// extension — contentType is set as object metadata instead), so a repeat
// upload simply overwrites the previous file: "one active proof per order"
// falls out of this for free, no separate delete/cleanup step needed.
//
// A brand-new upload always resets any previously confirmed reference —
// the old confirmation was about a DIFFERENT image and must not silently
// carry over to a replacement screenshot.

const { admin, db, bucket, initError } = require("./lib/firebase-admin");
const { isUploadTokenValid } = require("./lib/payment-upload-token");
const { detectImageType } = require("./lib/image-validate");
const { runOcr } = require("./lib/ocr");
const { extractPaymentReference, extractAmount } = require("./lib/ocr-extract");
const { respond, RequestError } = require("./lib/http");

// Base64 JSON body cap — generous headroom over the ~800KB compression
// target (base64 inflates size ~33%) plus a safety margin for images that
// didn't compress as well as hoped.
const MAX_BODY_BYTES = 4_500_000;
// Hard ceiling on the DECODED image itself — if client-side compression
// genuinely failed to get under this, something is wrong; never silently
// accept a huge file rather than enforce the compression target.
const MAX_IMAGE_BYTES = 2_000_000;
const OCR_TEXT_STORAGE_LIMIT = 500;

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

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, error: "invalid-request", message: "That image is too large. Please try a smaller screenshot." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "We couldn't process that upload. Please try again." });
  }

  const orderId = typeof payload.orderId === "string" ? payload.orderId.trim() : "";
  const uploadToken = typeof payload.uploadToken === "string" ? payload.uploadToken : "";
  const imageBase64 = typeof payload.imageBase64 === "string" ? payload.imageBase64 : "";

  if (!orderId || !uploadToken || !imageBase64) {
    return respond(400, { success: false, error: "invalid-request", message: "We couldn't process that upload. Please try again." });
  }

  let imageBuffer;
  try {
    imageBuffer = Buffer.from(imageBase64, "base64");
  } catch (err) {
    return respond(400, { success: false, error: "invalid-image", message: "We couldn't process that image. Please try a different screenshot." });
  }

  if (imageBuffer.length === 0 || imageBuffer.length > MAX_IMAGE_BYTES) {
    return respond(400, { success: false, error: "invalid-image", message: "That image is too large. Please try a smaller screenshot." });
  }

  const detectedType = detectImageType(imageBuffer);
  if (!detectedType) {
    return respond(400, { success: false, error: "unsupported-file-type", message: "Please upload a JPEG, PNG, or WEBP image." });
  }

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      throw new RequestError("order-not-found", "That order doesn't exist.", 404);
    }

    const order = orderSnap.data();

    if (order.paymentMethod !== "gcash" && order.paymentMethod !== "bank-transfer") {
      throw new RequestError("proof-not-applicable", "This order doesn't require a payment screenshot.", 400);
    }

    if (!isUploadTokenValid({ admin, providedToken: uploadToken, storedHash: order.paymentUploadTokenHash, expiresAt: order.paymentUploadTokenExpiresAt })) {
      throw new RequestError("invalid-upload-token", "This upload link is no longer valid. Please contact us.", 403);
    }

    if (order.paymentStatus === "PAID") {
      throw new RequestError("already-paid", "This order's payment has already been verified and can no longer be changed here.", 409);
    }

    if (order.orderStatus === "CANCELLED") {
      throw new RequestError("order-cancelled", "This order has been cancelled.", 409);
    }

    const storagePath = `paymentProofs/${orderId}/proof`;
    const file = bucket.file(storagePath);
    await file.save(imageBuffer, { contentType: detectedType, resumable: false });

    const ocrResult = await runOcr(imageBuffer);
    const { reference: paymentReferenceDetected, confidence: paymentReferenceConfidence } = ocrResult.ok
      ? extractPaymentReference(ocrResult.rawText)
      : { reference: null, confidence: 0 };
    const ocrDetectedAmount = ocrResult.ok ? extractAmount(ocrResult.rawText) : null;
    const paymentAmountMismatch = ocrDetectedAmount != null && Math.abs(ocrDetectedAmount - Number(order.total || 0)) > 0.01;

    await orderRef.update({
      paymentProofPath: storagePath,
      paymentProofUploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentReferenceDetected,
      paymentReferenceConfidence,
      ocrDetectedAmount,
      paymentAmountMismatch,
      ocrRawText: ocrResult.ok ? ocrResult.rawText.slice(0, OCR_TEXT_STORAGE_LIMIT) : "",
      // A new image invalidates any previous confirmation — it was about a
      // different screenshot.
      paymentReference: null,
      paymentReferenceConfirmed: false,
      paymentReferenceSource: null,
      duplicatePaymentReference: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return respond(200, {
      success: true,
      paymentReferenceDetected,
      paymentReferenceConfidence,
      ocrDetectedAmount,
      paymentAmountMismatch,
      orderTotal: order.total,
    });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("upload-payment-proof failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't upload your payment proof. Please try again." });
  }
};
