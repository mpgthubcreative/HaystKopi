// Shared order-status / payment-status constants and the fulfillment
// compatibility rule — the actual enforcement point for "no OUT_FOR_DELIVERY
// on pickup orders / no READY_FOR_PICKUP on delivery orders". The admin UI
// mirrors this list for its dropdown, but this is what's actually checked.

const ORDER_STATUS_VALUES = [
  "PENDING",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "OUT_FOR_DELIVERY",
  "COMPLETED",
  "CANCELLED",
];

const PAYMENT_STATUS_VALUES = ["UNPAID", "AWAITING_VERIFICATION", "PAID", "REFUNDED"];

function isStatusValidForFulfillment(status, fulfillmentMethod) {
  if (!ORDER_STATUS_VALUES.includes(status)) return false;
  if (fulfillmentMethod === "pickup" && status === "OUT_FOR_DELIVERY") return false;
  if (fulfillmentMethod === "delivery" && status === "READY_FOR_PICKUP") return false;
  return true;
}

module.exports = { ORDER_STATUS_VALUES, PAYMENT_STATUS_VALUES, isStatusValidForFulfillment };
