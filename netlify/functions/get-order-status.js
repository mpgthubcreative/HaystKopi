// POST /.netlify/functions/get-order-status
//
// Public, unauthenticated — this is the ONLY way a customer can see their
// own order without an account. orders/{orderId} stays fully denied to
// every client SDK read (see firestore.rules); this function is the
// entire lookup boundary.
//
// Both orderNumber AND phone must match (see lib/order-lookup.js) before
// ANYTHING is returned — order numbers are sequential/guessable
// (HK-YYYYMMDD-NNN), so phone is the actual secret here. A mismatch on
// either field produces the exact same generic response, at the same code
// path, so a caller can never learn which one was wrong or whether the
// order number alone was real.

const { db, initError } = require("./lib/firebase-admin");
const { lookupOrderByNumberAndPhone } = require("./lib/order-lookup");
const { respond } = require("./lib/http");

const MAX_BODY_BYTES = 500;
const NOT_FOUND_MESSAGE = "We couldn't find an order matching those details.";

function toIso(timestamp) {
  if (!timestamp) return null;
  return typeof timestamp.toDate === "function" ? timestamp.toDate().toISOString() : new Date(timestamp).toISOString();
}

function maskReference(reference) {
  if (!reference) return null;
  if (reference.length <= 4) return reference;
  return "•".repeat(reference.length - 4) + reference.slice(-4);
}

// Exactly the fields a customer needs to see and nothing operational —
// no adminNotes, no paymentUploadTokenHash, no inventory/audit internals,
// no Firebase doc ID, no OCR raw text/confidence, no duplicate/mismatch
// flags (those are for Owner/Admin only).
function buildCustomerSafeOrder(order) {
  return {
    orderNumber: order.orderNumber,
    createdAt: toIso(order.createdAt),
    customerName: order.customerName,
    items: order.items || [],
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    fulfillmentMethod: order.fulfillmentMethod,
    deliveryArea: order.deliveryArea,
    deliveryAddress: order.deliveryAddress,
    deliveryDistanceKm: order.deliveryDistanceKm,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    customerNotes: order.customerNotes || "",
    statusHistory: (order.statusHistory || []).map((entry) => ({
      status: entry.status,
      at: toIso(entry.at),
      note: entry.note || "",
    })),
    paymentProofExists: Boolean(order.paymentProofPath),
    paymentReference: maskReference(order.paymentReference),
    isTest: order.isTest === true,
  };
}

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, found: false, message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, found: false, message: "Method not allowed." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, found: false, message: "Please enter your order number and mobile number." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, found: false, message: "Please enter your order number and mobile number." });
  }

  const orderNumber = typeof payload.orderNumber === "string" ? payload.orderNumber.trim().slice(0, 40) : "";
  const phone = typeof payload.phone === "string" ? payload.phone.trim().slice(0, 20) : "";

  if (!orderNumber || !phone) {
    return respond(400, { success: false, found: false, message: "Please enter your order number and mobile number." });
  }

  try {
    const lookup = await lookupOrderByNumberAndPhone(db, orderNumber, phone);

    if (!lookup.found) {
      return respond(200, { success: true, found: false, message: NOT_FOUND_MESSAGE });
    }

    return respond(200, { success: true, found: true, order: buildCustomerSafeOrder(lookup.order) });
  } catch (err) {
    console.error("get-order-status failed:", err);
    return respond(500, { success: false, found: false, message: "We couldn't look up your order right now. Please try again." });
  }
};
