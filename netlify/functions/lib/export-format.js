// Column definitions + label maps for the Owner/Admin order export
// (export-orders.js). Values come only from stored order-document fields —
// never re-derived from current product/settings state — so historical
// snapshots (unit price, delivery fee, payment instructions at the time of
// the order) are preserved exactly as the customer experienced them.
//
// These label maps mirror firebase/orders-helpers.js (the admin UI's own
// copy) — duplicated here because this file runs server-side/CommonJS and
// that one is an ES module for the browser. Keep both in sync if the order
// status/payment status vocab ever changes.

const ORDER_STATUS_LABELS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  READY_FOR_PICKUP: "Ready for Pickup",
  OUT_FOR_DELIVERY: "Out for Delivery",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const PAYMENT_STATUS_LABELS = {
  UNPAID: "Unpaid",
  AWAITING_VERIFICATION: "Awaiting Verification",
  PAID: "Paid",
  REFUNDED: "Refunded",
};

const DELIVERY_AREA_LABELS = {
  rosewood: "Rosewood",
  acacia: "Acacia Estates",
  external: "Outside Acacia Estates",
};

const PAYMENT_METHOD_LABELS = {
  gcash: "GCash",
  "bank-transfer": "Bank Transfer",
  "cash-on-pickup": "Cash on Pickup",
  "cash-on-delivery": "Cash on Delivery",
};

const FULFILLMENT_LABELS = {
  pickup: "Pickup",
  delivery: "Delivery",
};

const { ORDER_SOURCE_LABELS } = require("./order-source");

function firstItem(order) {
  return (order.items && order.items[0]) || {};
}

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolLabel(value) {
  return value ? "YES" : "NO";
}

function tsToDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

// "Do not invent missing bank data" — only ever surfaces what the order
// itself recorded (paymentInstructionsSnapshot, frozen at order time), never
// today's settings/payments document.
function providerLabel(order) {
  switch (order.paymentMethod) {
    case "gcash":
      return "GCash";
    case "bank-transfer": {
      const snapshot = order.paymentInstructionsSnapshot;
      return (snapshot && snapshot.bankName) || "";
    }
    case "cash-on-pickup":
      return "Cash on Pickup";
    case "cash-on-delivery":
      return "Cash on Delivery";
    default:
      return "";
  }
}

// Phase 13: mirrors admin/order.js's and order-status.js's own
// formatDeliveryAddress() (duplicated here for the same reason as the
// label maps above — this file is server-side CommonJS, those are ES
// modules). external orders placed since the Google Places upgrade store
// a single selected formattedAddress; older orders still have the legacy
// free-text fields — shown exactly as originally stored either way, never
// recalculated.
function formatDeliveryAddressForExport(area, address) {
  if (!address) return "";
  if (area === "rosewood") {
    return [address.building, address.unitNumber ? `Unit ${address.unitNumber}` : ""].filter(Boolean).join(", ");
  }
  if (area === "acacia") {
    return [address.addressLine, address.barangay].filter(Boolean).join(", ");
  }
  if (address.formattedAddress) return address.formattedAddress;
  return [address.addressLine, address.barangay, address.city].filter(Boolean).join(", ");
}

// Each column's `get` returns the RAW value for both export formats:
// string | number | boolean-as-YES/NO-string | Date | null. Both the xlsx
// and csv writers (export-orders.js) branch on typeof/instanceof to render
// it appropriately for that format — this is the single source of truth for
// "what goes in column N", so the two file formats can never drift.
const EXPORT_COLUMNS = [
  { header: "Order Number", get: (o) => o.orderNumber || o.id },
  { header: "Order Date", get: (o) => tsToDate(o.createdAt), isDate: true },
  { header: "Customer Name", get: (o) => o.customerName || "" },
  { header: "Mobile Number", get: (o) => o.phone || "" },
  { header: "Email", get: (o) => o.email || "" },
  { header: "Product", get: (o) => firstItem(o).name || "" },
  { header: "Bottle Size", get: (o) => firstItem(o).bottleSize || "" },
  { header: "Quantity", get: (o) => numOrNull(firstItem(o).quantity), isNumber: true },
  { header: "Unit Price (PHP)", get: (o) => numOrNull(firstItem(o).price), isNumber: true, isMoney: true },
  { header: "Subtotal (PHP)", get: (o) => numOrNull(o.subtotal), isNumber: true, isMoney: true },
  { header: "Delivery Fee (PHP)", get: (o) => numOrNull(o.deliveryFee), isNumber: true, isMoney: true },
  { header: "Total (PHP)", get: (o) => numOrNull(o.total), isNumber: true, isMoney: true },
  { header: "Fulfillment", get: (o) => FULFILLMENT_LABELS[o.fulfillmentMethod] || o.fulfillmentMethod || "" },
  {
    header: "Delivery Area",
    get: (o) => (o.fulfillmentMethod === "delivery" ? DELIVERY_AREA_LABELS[o.deliveryArea] || o.deliveryArea || "" : ""),
  },
  {
    header: "Delivery Address",
    get: (o) => (o.fulfillmentMethod === "delivery" ? formatDeliveryAddressForExport(o.deliveryArea, o.deliveryAddress) : ""),
  },
  // Only populated for "external" orders using the Places-based address
  // shape — Rosewood/Acacia's own unit/building info is already folded
  // into the Delivery Address column above.
  { header: "Unit / Building Details", get: (o) => (o.deliveryArea === "external" ? (o.deliveryAddress || {}).unitDetails || "" : "") },
  { header: "Delivery Latitude", get: (o) => (o.deliveryArea === "external" ? numOrNull((o.deliveryAddress || {}).latitude) : null), isNumber: true },
  { header: "Delivery Longitude", get: (o) => (o.deliveryArea === "external" ? numOrNull((o.deliveryAddress || {}).longitude) : null), isNumber: true },
  // Blank for pickup and the fixed zones (Rosewood/Acacia) — only "external"
  // delivery orders ever have a real recorded distance. See Phase 10 spec
  // section 13.
  { header: "Delivery Distance (KM)", get: (o) => numOrNull(o.deliveryDistanceKm), isNumber: true },
  { header: "Payment Method", get: (o) => PAYMENT_METHOD_LABELS[o.paymentMethod] || o.paymentMethod || "" },
  { header: "Bank / Provider", get: (o) => providerLabel(o) },
  // The CONFIRMED reference is the authoritative one — never the raw OCR
  // guess, even when the customer corrected it. See Phase 10 spec section 8.
  { header: "Payment Reference", get: (o) => o.paymentReference || "" },
  { header: "Payment Reference Source", get: (o) => o.paymentReferenceSource || "" },
  { header: "OCR Detected Reference", get: (o) => o.paymentReferenceDetected || "" },
  { header: "OCR Detected Amount (PHP)", get: (o) => numOrNull(o.ocrDetectedAmount), isNumber: true, isMoney: true },
  { header: "Payment Status", get: (o) => PAYMENT_STATUS_LABELS[o.paymentStatus] || o.paymentStatus || "" },
  { header: "Payment Proof Exists", get: (o) => boolLabel(Boolean(o.paymentProofPath)) },
  { header: "Duplicate Reference", get: (o) => boolLabel(Boolean(o.duplicatePaymentReference)) },
  { header: "Amount Mismatch", get: (o) => boolLabel(Boolean(o.paymentAmountMismatch)) },
  { header: "Order Status", get: (o) => ORDER_STATUS_LABELS[o.orderStatus] || o.orderStatus || "" },
  // Orders created before this field existed have no orderSource stored at
  // all — they were all placed through the website, so that's the correct
  // label to backfill on display, not an empty cell.
  { header: "Order Source", get: (o) => ORDER_SOURCE_LABELS[o.orderSource || "website"] || o.orderSource || "" },
  { header: "Order Type", get: (o) => (o.isTest ? "TEST" : "LIVE") },
  { header: "Customer Notes", get: (o) => o.customerNotes || "" },
  { header: "Admin Notes", get: (o) => o.adminNotes || "" },
];

module.exports = {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_AREA_LABELS,
  PAYMENT_METHOD_LABELS,
  FULFILLMENT_LABELS,
  EXPORT_COLUMNS,
  tsToDate,
};
