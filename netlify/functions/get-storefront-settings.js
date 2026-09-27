// POST /.netlify/functions/get-storefront-settings
// Public, unauthenticated — this is how the customer-facing site (product
// page + checkout) learns whether the store is open, which fulfillment
// options exist, and which payment methods are enabled, without ever
// reading settings/* directly (those stay admin-read/owner-write only —
// see firestore.rules). Returns ONLY what a customer needs to render the
// storefront correctly: no updatedBy, no origin coordinates, no distance
// brackets (external's actual fee only ever comes from
// calculate-delivery.js, which reads the full trusted document itself).
//
// Fail-closed on any read error: if settings can't be loaded, the
// storefront looks closed/unavailable rather than silently permissive.

const { db, initError } = require("./lib/firebase-admin");
const { getOrdersSettings, isAcceptingOrders, isPickupEnabled } = require("./lib/orders-settings");
const { getDeliverySettings } = require("./lib/delivery");
const { getPaymentSettings } = require("./lib/payment-settings");
const { respond } = require("./lib/http");

const CLOSED_RESPONSE = {
  success: true,
  acceptingOrders: false,
  pickup: { enabled: false, address: "", hours: "", instructions: "" },
  delivery: { enabled: false, rosewood: { enabled: false, fee: 0 }, acacia: { enabled: false, fee: 0 }, external: { enabled: false } },
  payment: {
    gcash: { enabled: false },
    bankTransfer: { enabled: false },
    cashOnPickup: { enabled: false },
    cashOnDelivery: { enabled: false },
  },
};

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(200, CLOSED_RESPONSE);
  }

  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return respond(405, { success: false, message: "Method not allowed." });
  }

  try {
    const ordersSettings = await getOrdersSettings(db);
    const acceptingOrders = isAcceptingOrders(ordersSettings);
    const pickup = ordersSettings && ordersSettings.pickup ? ordersSettings.pickup : {};

    let deliverySettings = null;
    try {
      const deliveryResult = await getDeliverySettings(db);
      if (deliveryResult.ok) deliverySettings = deliveryResult.settings;
    } catch (err) {
      console.error("get-storefront-settings: delivery read failed:", err);
    }

    let paymentSettings = null;
    try {
      paymentSettings = await getPaymentSettings(db);
    } catch (err) {
      console.error("get-storefront-settings: payments read failed:", err);
    }

    return respond(200, {
      success: true,
      acceptingOrders,
      pickup: {
        enabled: isPickupEnabled(ordersSettings),
        address: pickup.address || "",
        hours: pickup.hours || "",
        instructions: pickup.instructions || "",
      },
      delivery: {
        enabled: Boolean(deliverySettings && deliverySettings.enabled),
        rosewood: {
          enabled: Boolean(deliverySettings && deliverySettings.specialZones && deliverySettings.specialZones.rosewood && deliverySettings.specialZones.rosewood.enabled),
          fee: (deliverySettings && deliverySettings.specialZones && deliverySettings.specialZones.rosewood && deliverySettings.specialZones.rosewood.fee) || 0,
        },
        acacia: {
          enabled: Boolean(deliverySettings && deliverySettings.specialZones && deliverySettings.specialZones.acacia && deliverySettings.specialZones.acacia.enabled),
          fee: (deliverySettings && deliverySettings.specialZones && deliverySettings.specialZones.acacia && deliverySettings.specialZones.acacia.fee) || 0,
        },
        external: {
          enabled: Boolean(deliverySettings && deliverySettings.distancePricing && deliverySettings.distancePricing.enabled),
        },
      },
      payment: {
        gcash: {
          enabled: Boolean(paymentSettings && paymentSettings.gcash && paymentSettings.gcash.enabled),
          accountName: (paymentSettings && paymentSettings.gcash && paymentSettings.gcash.accountName) || "",
          number: (paymentSettings && paymentSettings.gcash && paymentSettings.gcash.number) || "",
          qrImagePath: (paymentSettings && paymentSettings.gcash && paymentSettings.gcash.qrImagePath) || "",
        },
        bankTransfer: {
          enabled: Boolean(paymentSettings && paymentSettings.bankTransfer && paymentSettings.bankTransfer.enabled),
          bankName: (paymentSettings && paymentSettings.bankTransfer && paymentSettings.bankTransfer.bankName) || "",
          accountName: (paymentSettings && paymentSettings.bankTransfer && paymentSettings.bankTransfer.accountName) || "",
          accountNumber: (paymentSettings && paymentSettings.bankTransfer && paymentSettings.bankTransfer.accountNumber) || "",
        },
        cashOnPickup: { enabled: Boolean(paymentSettings && paymentSettings.cashOnPickup && paymentSettings.cashOnPickup.enabled) },
        cashOnDelivery: { enabled: Boolean(paymentSettings && paymentSettings.cashOnDelivery && paymentSettings.cashOnDelivery.enabled) },
      },
    });
  } catch (err) {
    console.error("get-storefront-settings failed:", err);
    return respond(200, CLOSED_RESPONSE);
  }
};
