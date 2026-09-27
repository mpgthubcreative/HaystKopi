// Single source of truth for "does this order count toward metric X" —
// every dashboard aggregation (get-dashboard-analytics.js /
// lib/dashboard-aggregate.js) calls through these instead of re-deriving
// its own slightly-different filter, per Phase 11 spec section 29.
//
// Revenue vocabulary (Phase 11 spec section 4):
//   GROSS ORDER VALUE  — total for any non-cancelled order, regardless of
//                         payment status (isRevenueEligible).
//   PAID REVENUE       — total where paymentStatus == PAID and the order
//                         isn't cancelled (isPaidSale). REFUNDED orders are
//                         automatically excluded here too, since PAID and
//                         REFUNDED are mutually exclusive paymentStatus
//                         values — no extra check needed.
//   COMPLETED REVENUE  — total where paymentStatus == PAID AND
//                         orderStatus == COMPLETED (isCompletedSale).
// Bottles Sold and Best Sellers intentionally share ONE definition
// (isBottleSaleEligible === isPaidSale) rather than two similar-but-not-
// identical rules — see spec section 18/29.

function isLiveOrder(order, includeTest) {
  return Boolean(includeTest) || order.isTest !== true;
}

function isCancelled(order) {
  return order.orderStatus === "CANCELLED";
}

function isRefunded(order) {
  return order.paymentStatus === "REFUNDED";
}

function isRevenueEligible(order) {
  return !isCancelled(order);
}

function isPaidSale(order) {
  return order.paymentStatus === "PAID" && !isCancelled(order);
}

function isCompletedSale(order) {
  return order.paymentStatus === "PAID" && order.orderStatus === "COMPLETED";
}

// Bottles Sold / Best Sellers eligibility — deliberately identical to
// isPaidSale (see module comment above).
function isBottleSaleEligible(order) {
  return isPaidSale(order);
}

// Delivery Fees Collected — same "actually paid, not cancelled" bar as
// product revenue (spec section 16).
function isDeliveryFeeCollected(order) {
  return isPaidSale(order);
}

module.exports = {
  isLiveOrder,
  isCancelled,
  isRefunded,
  isRevenueEligible,
  isPaidSale,
  isCompletedSale,
  isBottleSaleEligible,
  isDeliveryFeeCollected,
};
