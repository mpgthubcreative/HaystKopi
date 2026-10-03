// POST /.netlify/functions/create-admin-order
// Requires an active OWNER or ADMIN (Authorization: Bearer <Firebase ID
// token>) — never callable by the public. For orders received OUTSIDE the
// website (Facebook, Instagram, Messenger, Phone, Walk-in, Manual/Other)
// that staff still need recorded in the one master orders ledger.
//
// Deliberately NOT idempotent the way create-order.js is: there is no
// client-generated clientRequestId for a staff member typing in a sale, and
// no risk of a browser retry double-submitting the same network request the
// way a flaky checkout submission could. Each submission is a new order.
//
// Reuses the exact same trusted building blocks create-order.js uses —
// resolveDelivery() for delivery fee/distance and
// commitOrderInTransaction() for product lookup/inventory deduction/order-
// numbering/document shape — so a manual order is indistinguishable in
// structure from a website order except for its orderSource and (optional)
// staff-chosen initial paymentStatus. All of it still lands in the same
// orders/{orderId} collection; there is no separate manualOrders store.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isActiveAdminProfile } = require("./lib/authorize");
const { validateAdminOrderInput } = require("./lib/validate-admin-order");
const { resolveDelivery } = require("./lib/delivery");
const { respond, RequestError } = require("./lib/http");
const { commitOrderInTransaction } = require("./lib/order-transaction");
const { normalizePhone } = require("./lib/phone");

const MAX_BODY_BYTES = 20000;

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
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to create orders." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, error: "invalid-request", message: "We couldn't save that order. Please check the details and try again." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "We couldn't save that order. Please check the details and try again." });
  }

  const { ok, errors, data } = validateAdminOrderInput(payload);
  if (!ok) {
    return respond(400, {
      success: false,
      error: "validation-error",
      message: "Please check the order details.",
      fieldErrors: errors,
    });
  }

  // ---- Delivery fee/distance resolution happens BEFORE the transaction,
  // identically to create-order.js — the same trusted settings/driving-
  // distance lookup, independent of anything the staff form sent. A manual
  // order never gets a cheaper/free delivery just because a human typed it
  // in instead of a customer checking out. ----
  let delivery = { deliveryFee: 0, distanceKm: null, pricingType: null, pricingSnapshot: null, zone: null };

  if (data.fulfillment === "delivery") {
    let resolved;
    try {
      resolved = await resolveDelivery({
        db,
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
        deliveryArea: data.deliveryArea,
        deliveryAddress: data.deliveryAddress,
      });
    } catch (err) {
      console.error("create-admin-order resolveDelivery threw unexpectedly:", err);
      return respond(503, { success: false, error: "delivery-unavailable", message: "We couldn't calculate delivery right now. Please try again." });
    }

    if (!resolved.body.available) {
      return respond(resolved.httpStatus, {
        success: false,
        error: resolved.body.error || resolved.body.reason || "delivery-unavailable",
        message: resolved.body.message || "We couldn't calculate delivery right now. Please try again.",
      });
    }

    delivery = {
      deliveryFee: resolved.body.deliveryFee,
      distanceKm: resolved.body.distanceKm,
      pricingType: resolved.body.pricingType,
      pricingSnapshot: resolved.body.pricingSnapshot,
      zone: resolved.body.zone,
    };
  }

  try {
    const orderRef = db.collection("orders").doc();

    const result = await db.runTransaction(async (tx) => {
      return commitOrderInTransaction({
        tx,
        db,
        admin,
        orderRef,
        productId: data.productId,
        quantity: data.quantity,
        fulfillmentMethod: data.fulfillment,
        deliveryArea: data.fulfillment === "delivery" ? data.deliveryArea : null,
        deliveryAddress: data.fulfillment === "delivery" ? data.deliveryAddress : null,
        delivery,
        paymentMethod: data.paymentMethod,
        paymentStatus: data.paymentStatus,
        customerName: data.customerName,
        phone: data.mobile,
        phoneNormalized: normalizePhone(data.mobile),
        email: data.email,
        customerNotes: data.customerNotes,
        adminNotes: data.adminNotes,
        orderSource: data.orderSource,
        createdByUid: profile.uid,
        createdByName: profile.name || profile.email || "",
        initialStatusNote: `Order recorded by staff (${data.orderSource})`,
      });
    });

    return respond(200, { success: true, ...result });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("create-admin-order failed:", err);
    return respond(500, {
      success: false,
      error: "server-error",
      message: "We couldn't save that order. Please try again.",
    });
  }
};
