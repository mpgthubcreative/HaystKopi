// The single place that actually builds and commits an order document
// inside an open Firestore transaction — product lookup, inventory
// check/deduct, Asia/Manila business-date order-number generation, and the
// matching inventoryLogs entry. Both create-order.js (website checkout)
// and create-admin-order.js (staff-entered orders) call this from within
// their OWN db.runTransaction(...) callback, so each can layer its own
// pre-transaction concerns (e.g. create-order.js's idempotent-replay
// check against a client-supplied clientRequestId) around the exact same
// core logic, rather than duplicating it.
//
// The caller is responsible for:
//   - opening the transaction (`tx`) and choosing `orderRef`
//   - resolving delivery fee/distance BEFORE the transaction (external API
//     calls must never sit inside a transaction's retry loop)
//   - any idempotency/replay handling specific to its own trust model
//   - gating on store-wide settings (accepting orders / pickup enabled /
//     payment method enabled) BEFORE calling this — those are storefront
//     concerns, not something every caller necessarily wants (an admin
//     logging a Facebook sale that happened while the site was marked
//     "closed" should still be able to record it)
//
// Throws RequestError on business-rule failures (product missing,
// insufficient stock) — the caller's own try/catch maps that to a response.

const { RequestError } = require("./http");
const { formatManilaBusinessDate } = require("./manila-date");

async function commitOrderInTransaction({
  tx,
  db,
  admin,
  orderRef,
  productId,
  quantity,
  fulfillmentMethod,
  deliveryArea,
  deliveryAddress,
  delivery, // { deliveryFee, distanceKm, pricingType, pricingSnapshot }
  paymentMethod,
  paymentStatus,
  customerName,
  phone,
  phoneNormalized,
  email,
  customerNotes,
  adminNotes,
  orderSource,
  isTest,
  paymentInstructionsSnapshot,
  paymentUploadTokenHash,
  paymentUploadTokenExpiresAt,
  createdByUid,
  createdByName,
  initialStatusNote,
}) {
  const productRef = db.collection("products").doc(productId);
  const productSnap = await tx.get(productRef);

  if (!productSnap.exists) {
    throw new RequestError("product-not-found", "We couldn't find that product.", 404);
  }

  const product = productSnap.data();
  const currentInventory = Number(product.inventory);

  if (!Number.isInteger(currentInventory) || currentInventory <= 0) {
    throw new RequestError("out-of-stock", "This product is currently unavailable.", 409);
  }

  if (currentInventory < quantity) {
    throw new RequestError(
      "insufficient-stock",
      `Only ${currentInventory} bottle${currentInventory === 1 ? "" : "s"} still available.`,
      409
    );
  }

  // Business date is Asia/Manila (fixed UTC+8), never the runtime's own
  // timezone — see lib/manila-date.js for why this is safe/deterministic.
  const businessDate = formatManilaBusinessDate(new Date());
  const counterRef = db.collection("counters").doc(`orders-${businessDate}`);
  const counterSnap = await tx.get(counterRef);
  const nextSeq = (counterSnap.exists ? Number(counterSnap.data().count) || 0 : 0) + 1;
  const orderNumber = `HK-${businessDate}-${String(nextSeq).padStart(3, "0")}`;

  // ---- Everything money-related below is server-derived. Neither caller
  // ever reads a client-supplied price/subtotal/total/deliveryFee — delivery
  // was resolved independently before the transaction via the same trusted
  // settings/delivery config both create-order.js and create-admin-order.js
  // use (lib/delivery.js's resolveDelivery()). ----
  const unitPrice = Number(product.price) || 0;
  const subtotal = unitPrice * quantity;
  const deliveryFee = delivery.deliveryFee;
  const total = subtotal + deliveryFee;
  const newInventory = currentInventory - quantity;

  tx.update(productRef, {
    inventory: newInventory,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  tx.set(counterRef, { count: nextSeq }, { merge: true });

  const nowTimestamp = admin.firestore.Timestamp.now();

  tx.set(orderRef, {
    orderNumber,
    customerName,
    phone,
    phoneNormalized,
    email,
    fulfillmentMethod,
    deliveryArea: fulfillmentMethod === "delivery" ? deliveryArea : null,
    deliveryAddress: fulfillmentMethod === "delivery" ? deliveryAddress : null,
    // Trusted result from resolveDelivery() — a real driving distance for
    // "external" orders, or null for pickup/special zones.
    deliveryDistanceKm: delivery.distanceKm,
    deliveryPricingType: delivery.pricingType, // "special-zone" | "distance" | null
    // Snapshot of whichever rule produced deliveryFee, frozen at order
    // time — if the Owner edits settings/delivery tomorrow, this order
    // keeps showing the rule that actually applied when it was placed.
    deliveryPricingSnapshot: delivery.pricingSnapshot,
    paymentMethod,
    paymentStatus,
    // Frozen at order time — if the Owner edits settings/payments tomorrow
    // (new GCash number, etc.), this order keeps showing the instructions
    // that applied when it was placed.
    paymentInstructionsSnapshot: paymentInstructionsSnapshot || null,
    paymentUploadTokenHash: paymentUploadTokenHash || null,
    paymentUploadTokenExpiresAt: paymentUploadTokenExpiresAt || null,
    paymentProofUploadedAt: null,
    paymentReferenceDetected: null,
    paymentReferenceConfidence: null,
    paymentReferenceConfirmed: false,
    paymentReferenceSource: null,
    ocrRawText: null,
    ocrDetectedAmount: null,
    paymentAmountMismatch: false,
    duplicatePaymentReference: false,
    orderStatus: "PENDING",
    items: [
      {
        productId,
        name: product.name || productId,
        price: unitPrice,
        bottleSize: product.bottleSize || "",
        quantity,
        image: product.image || "",
      },
    ],
    subtotal,
    deliveryFee,
    total,
    customerNotes: customerNotes || "",
    adminNotes: adminNotes || "",
    orderSource,
    createdByUid: createdByUid || null,
    createdByName: createdByName || null,
    inventoryDeducted: true,
    inventoryRestored: false,
    isTest: Boolean(isTest),
    paymentProofPath: null,
    paymentReference: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    statusHistory: [{ status: "PENDING", at: nowTimestamp, note: initialStatusNote || "Order created" }],
  });

  const logRef = db.collection("inventoryLogs").doc();
  tx.set(logRef, {
    productId,
    productName: product.name || productId,
    previousInventory: currentInventory,
    newInventory,
    changeAmount: -quantity,
    reason: `Order ${orderNumber}`,
    type: "order_created",
    orderId: orderRef.id,
    orderNumber,
    updatedBy: createdByUid || "system",
    updatedByName: createdByName || "system",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    orderId: orderRef.id,
    orderNumber,
    customerName,
    productName: product.name || productId,
    quantity,
    total,
    fulfillmentMethod,
    paymentMethod,
    paymentStatus,
    orderStatus: "PENDING",
    orderSource,
  };
}

module.exports = { commitOrderInTransaction };
