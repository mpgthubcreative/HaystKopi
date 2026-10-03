// POST /.netlify/functions/create-order
//
// The only trusted entry point for real order creation. The browser may
// send productId/quantity/customer/fulfillment/deliveryArea/address/
// paymentMethod/notes — it must NOT be trusted for price, subtotal,
// delivery fee, distance, or total, and this handler never reads those
// fields from the request even if present. Delivery fee/distance are
// independently recomputed via resolveDelivery() (lib/delivery.js) — the
// exact same function calculate-delivery.js used for the checkout page's
// live estimate, called again here so a tampered/stale client-side result
// is never trusted for the real order.
//
// Idempotency: the order document ID IS the client's clientRequestId. If a
// request repeats (retry after timeout, double submit), this returns the
// existing order rather than creating a second one or deducting inventory
// twice — see both the fast pre-check and the transaction body below.

const { admin, db, initError } = require("./lib/firebase-admin");
const { validateOrderInput } = require("./lib/validate-order");
const { resolveDelivery } = require("./lib/delivery");
const { respond, RequestError } = require("./lib/http");
const { commitOrderInTransaction } = require("./lib/order-transaction");
const { sendNewOrderEmail, sendCustomerOrderConfirmationEmail } = require("./lib/order-notifications");
const { generateUploadToken, hashUploadToken, tokenExpiryTimestamp, CHECKOUT_TOKEN_TTL_MS } = require("./lib/payment-upload-token");
const { normalizePhone } = require("./lib/phone");
const { getPaymentSettings, buildPaymentInstructions, isPaymentMethodEnabled } = require("./lib/payment-settings");
const { getOrdersSettings, isAcceptingOrders, isPickupEnabled } = require("./lib/orders-settings");

const PROOF_REQUIRED_METHODS = ["gcash", "bank-transfer"];

const MAX_BODY_BYTES = 20000;

function safeReplayResult(orderRef, existing) {
  const firstItem = (existing.items || [])[0] || {};
  return {
    orderId: orderRef.id,
    orderNumber: existing.orderNumber,
    customerName: existing.customerName,
    productName: firstItem.name,
    quantity: firstItem.quantity,
    total: existing.total,
    fulfillmentMethod: existing.fulfillmentMethod,
    paymentMethod: existing.paymentMethod,
    orderStatus: existing.orderStatus,
  };
}

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, error: "server-misconfigured", message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, error: "method-not-allowed", message: "Method not allowed." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, {
      success: false,
      error: "invalid-request",
      message: "We couldn't process your order. Please check your details and try again.",
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, {
      success: false,
      error: "invalid-json",
      message: "We couldn't process your order. Please check your details and try again.",
    });
  }

  const { ok, errors, data } = validateOrderInput(payload);
  if (!ok) {
    return respond(400, {
      success: false,
      error: "validation-error",
      message: "Please check your order details.",
      fieldErrors: errors,
    });
  }

  const orderRef = db.collection("orders").doc(data.clientRequestId);

  // Fast pre-check, outside any transaction: if this exact submission
  // already produced an order, return it immediately without calling the
  // (costly, external) delivery/maps resolution again. This is an
  // optimization only — the transaction below still re-checks
  // authoritatively in case of a genuine race with another in-flight
  // request for the same clientRequestId.
  //
  // Wrapped in its own try/catch: a Firestore-level failure here (bad
  // credentials, network issue) must return a clean response, not crash the
  // function unhandled — this exact gap was caught during testing.
  try {
    const preCheckSnap = await orderRef.get();
    if (preCheckSnap.exists) {
      return respond(200, { success: true, ...safeReplayResult(orderRef, preCheckSnap.data()) });
    }
  } catch (err) {
    console.error("create-order pre-check failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't place your order. Please try again." });
  }

  // ---- Store-wide/fulfillment/payment settings gates, all against CURRENT
  // Firestore settings — never anything the client asserted or cached from
  // when it loaded the page. A customer who had checkout open before the
  // Owner flipped a toggle gets rejected here, not silently allowed
  // through. Checked before the (costlier) delivery resolution below. ----
  let ordersSettings;
  let paymentSettings;
  try {
    ordersSettings = await getOrdersSettings(db);
    paymentSettings = await getPaymentSettings(db);
  } catch (err) {
    console.error("create-order settings read failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't place your order. Please try again." });
  }

  if (!isAcceptingOrders(ordersSettings)) {
    return respond(503, { success: false, error: "not-accepting-orders", message: "We're currently not accepting orders. Please check back soon." });
  }

  if (data.fulfillment === "pickup" && !isPickupEnabled(ordersSettings)) {
    return respond(400, { success: false, error: "pickup-disabled", message: "Pickup is currently unavailable." });
  }

  if (!isPaymentMethodEnabled(paymentSettings, data.paymentMethod)) {
    return respond(400, { success: false, error: "payment-method-disabled", message: "That payment method is currently unavailable. Please choose another." });
  }

  // ---- Delivery fee/distance resolution happens BEFORE the transaction.
  // It may involve a slow external API call (Google Distance Matrix), which
  // must never sit inside a Firestore transaction's retry loop. The result
  // is captured once here and reused as-is even if the transaction below
  // retries for an unrelated reason (e.g. inventory contention). ----
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
      console.error("resolveDelivery threw unexpectedly:", err);
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

  // ---- Payment-proof upload authorization + customer-facing instructions,
  // only for methods that actually need a screenshot. Reuses the
  // paymentSettings already fetched above for the enabled-check — no
  // second read. ----
  let paymentUploadToken = null;
  let paymentUploadTokenHash = null;
  let paymentUploadTokenExpiresAt = null;
  let paymentInstructions = null;

  if (PROOF_REQUIRED_METHODS.includes(data.paymentMethod)) {
    paymentUploadToken = generateUploadToken();
    paymentUploadTokenHash = hashUploadToken(paymentUploadToken);
    paymentUploadTokenExpiresAt = tokenExpiryTimestamp(admin, CHECKOUT_TOKEN_TTL_MS);
    paymentInstructions = buildPaymentInstructions(paymentSettings, data.paymentMethod);
  }

  try {
    const result = await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);

      // Idempotent replay (race with another in-flight identical request).
      if (orderSnap.exists) {
        return { ...safeReplayResult(orderRef, orderSnap.data()), isNewOrder: false };
      }

      const committed = await commitOrderInTransaction({
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
        paymentStatus: "UNPAID",
        customerName: data.fullName,
        phone: data.mobile,
        // Consistent normal form (639171234567) so order tracking and
        // resume-payment can match "09..." and "+639..." reliably — see
        // lib/phone.js. Older pre-Phase-8 orders won't have this field;
        // lib/order-lookup.js falls back to normalizing `phone` for those.
        phoneNormalized: normalizePhone(data.mobile),
        email: data.email,
        customerNotes: data.customerNotes,
        orderSource: "website",
        paymentInstructionsSnapshot: paymentInstructions,
        paymentUploadTokenHash,
        paymentUploadTokenExpiresAt,
        initialStatusNote: "Order created",
      });

      return {
        ...committed,
        // Plaintext token, returned exactly once — only the hash is ever
        // persisted (see lib/payment-upload-token.js). A client that loses
        // this response (network drop) and retries with the same
        // clientRequestId hits the idempotent-replay path instead, which
        // has no way to return the same plaintext token again — a known,
        // narrow limitation, documented in the phase summary.
        paymentUploadToken,
        paymentInstructions,
        isNewOrder: true,
      };
    });

    // isNewOrder is only ever true on the branch that actually ran
    // commitOrderInTransaction — both replay paths (the fast pre-check
    // above and the in-transaction race check) short-circuit before
    // reaching here, so a retried/duplicate clientRequestId can never
    // trigger a second email. See lib/order-notifications.js's header for
    // why this is awaited rather than fire-and-forget, and why a failure
    // here is swallowed rather than failing the order.
    const { isNewOrder, ...publicResult } = result;

    if (isNewOrder) {
      // Shared fields for both the Owner and customer emails — deliberately
      // built once rather than duplicated, but note the two calls below
      // still pass distinct field sets: sendNewOrderEmail never receives
      // data.email (the Owner email has no use for it and shouldn't carry
      // it — see lib/order-notifications.js), and only
      // sendCustomerOrderConfirmationEmail receives customerEmail/the
      // recipient address itself.
      const notificationFields = {
        orderNumber: result.orderNumber,
        customerName: data.fullName,
        productName: result.productName,
        quantity: result.quantity,
        fulfillmentMethod: data.fulfillment,
        deliveryArea: data.fulfillment === "delivery" ? data.deliveryArea : null,
        deliveryAddress: data.fulfillment === "delivery" ? data.deliveryAddress : null,
        paymentMethod: data.paymentMethod,
        paymentStatus: "UNPAID",
        total: result.total,
        orderSource: "website",
        isTest: false,
      };

      // Each send is independently caught so a failure in one (Owner or
      // customer) never blocks the other, and neither ever fails order
      // creation itself — see lib/order-notifications.js's header.
      try {
        await sendNewOrderEmail({ ...notificationFields, orderId: result.orderId, phone: data.mobile });
      } catch (err) {
        console.error("create-order: new-order notification threw unexpectedly (order was still created):", err);
      }

      if (data.email) {
        try {
          await sendCustomerOrderConfirmationEmail({ ...notificationFields, customerEmail: data.email });
        } catch (err) {
          console.error("create-order: customer confirmation notification threw unexpectedly (order was still created):", err);
        }
      }
    }

    return respond(200, { success: true, ...publicResult });
  } catch (err) {
    if (err instanceof RequestError) {
      return respond(err.statusCode, { success: false, error: err.code, message: err.message });
    }
    console.error("create-order failed:", err);
    return respond(500, {
      success: false,
      error: "server-error",
      message: "We couldn't place your order. Please try again.",
    });
  }
};
