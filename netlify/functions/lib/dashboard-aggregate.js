// Server-memory aggregation over an already date-bounded order array — see
// get-dashboard-analytics.js for the Firestore query that produces that
// array. Every function here is a pure reducer; the classification rules
// they lean on live in lib/analytics-rules.js so there's exactly one
// definition of "paid sale"/"cancelled"/etc. across the whole dashboard.

const { tsToDate } = require("./export-format");
const { formatManilaDateString } = require("./manila-date");
const {
  isLiveOrder,
  isCancelled,
  isRefunded,
  isRevenueEligible,
  isPaidSale,
  isCompletedSale,
  isBottleSaleEligible,
  isDeliveryFeeCollected,
} = require("./analytics-rules");

const PAYMENT_METHODS = ["gcash", "bank-transfer", "cash-on-pickup", "cash-on-delivery"];
const PAYMENT_STATUSES = ["UNPAID", "AWAITING_VERIFICATION", "PAID", "REFUNDED"];
const DELIVERY_AREAS = ["rosewood", "acacia", "external"];

function filterLiveOrders(orders, includeTest) {
  return orders.filter((order) => isLiveOrder(order, includeTest));
}

function sumQuantity(order) {
  return (order.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

// The always-visible "Today" snapshot cards — see Phase 11 spec section 7.
// "Orders" here is every live order created today regardless of status
// (a true volume count); Cancelled Today is the subset that got cancelled.
function computeTodaySummary(orders) {
  let paidSales = 0;
  let bottlesSold = 0;
  let cancelledToday = 0;

  orders.forEach((order) => {
    const total = Number(order.total) || 0;
    if (isPaidSale(order)) {
      paidSales += total;
      bottlesSold += sumQuantity(order);
    }
    if (isCancelled(order)) cancelledToday += 1;
  });

  return { paidSales, orders: orders.length, bottlesSold, cancelledToday };
}

// The selected-date-range summary block. Pending Orders / Awaiting
// Verification are deliberately scoped to this SAME range (not all-time) —
// see Phase 11 summary "known limitations" for why: an unbounded
// all-history query would violate spec section 23/24's bounded-query rule.
// Widen the date filter to see further back.
function computePeriodSummary(orders) {
  let grossOrderValue = 0;
  let paidRevenue = 0;
  let completedRevenue = 0;
  let orderCount = 0;
  let cancelledOrders = 0;
  let refundedOrders = 0;
  let refundedAmount = 0;
  let pendingOrders = 0;
  let awaitingVerification = 0;
  let bottlesSold = 0;
  let paidOrderCount = 0;
  let deliveryFeesCollected = 0;
  const externalDistancesKm = [];

  orders.forEach((order) => {
    const total = Number(order.total) || 0;
    const cancelled = isCancelled(order);

    if (cancelled) cancelledOrders += 1;

    if (isRevenueEligible(order)) {
      grossOrderValue += total;
      orderCount += 1;
    }

    if (isPaidSale(order)) {
      paidRevenue += total;
      paidOrderCount += 1;
      bottlesSold += sumQuantity(order);
    }

    if (isDeliveryFeeCollected(order)) {
      deliveryFeesCollected += Number(order.deliveryFee) || 0;
    }

    if (isCompletedSale(order)) {
      completedRevenue += total;
    }

    if (isRefunded(order)) {
      refundedOrders += 1;
      refundedAmount += total;
    }

    if (order.orderStatus === "PENDING") pendingOrders += 1;
    if (order.paymentStatus === "AWAITING_VERIFICATION") awaitingVerification += 1;

    // Distance insight is a logistics metric, not a revenue one — it isn't
    // gated on payment status, only "did this actually go out" (not
    // cancelled) and "do we have a real recorded distance" (external
    // deliveries only; Rosewood/Acacia are flat-fee zones with no distance
    // at all — see Phase 10 spec section 13).
    if (
      !cancelled &&
      order.fulfillmentMethod === "delivery" &&
      order.deliveryArea === "external" &&
      order.deliveryDistanceKm !== null &&
      order.deliveryDistanceKm !== undefined
    ) {
      const km = Number(order.deliveryDistanceKm);
      if (Number.isFinite(km)) externalDistancesKm.push(km);
    }
  });

  // AOV formula (spec section 17): Paid Revenue / Number of Paid
  // Non-Cancelled Orders. Division-by-zero guarded to 0.
  const averageOrderValue = paidOrderCount > 0 ? paidRevenue / paidOrderCount : 0;

  const averageDeliveryDistanceKm = externalDistancesKm.length
    ? externalDistancesKm.reduce((a, b) => a + b, 0) / externalDistancesKm.length
    : null;
  const longestDeliveryDistanceKm = externalDistancesKm.length ? Math.max(...externalDistancesKm) : null;

  return {
    grossOrderValue,
    paidRevenue,
    completedRevenue,
    orderCount,
    cancelledOrders,
    refundedOrders,
    refundedAmount,
    pendingOrders,
    awaitingVerification,
    bottlesSold,
    averageOrderValue,
    deliveryFeesCollected,
    averageDeliveryDistanceKm,
    longestDeliveryDistanceKm,
  };
}

// Ranked by quantity (not order count) — spec section 10/29.
function computeBestSellers(orders, limit = 10) {
  const totals = new Map();

  orders.forEach((order) => {
    if (!isBottleSaleEligible(order)) return;
    (order.items || []).forEach((item) => {
      const key = item.productId || item.name || "unknown";
      const existing = totals.get(key) || { productId: key, name: item.name || key, quantity: 0 };
      existing.quantity += Number(item.quantity) || 0;
      totals.set(key, existing);
    });
  });

  return Array.from(totals.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit);
}

// "Number of orders" = attempted/live orders for that method (non-cancelled
// — the Gross-eligible bar), so an admin can see volume by method even
// before payment settles. "Amount" is PAID-only, per spec section 11 ("do
// not treat UNPAID GCash as realized revenue").
function computePaymentMethodBreakdown(orders) {
  const result = {};
  PAYMENT_METHODS.forEach((method) => {
    result[method] = { orders: 0, paidAmount: 0 };
  });

  orders.forEach((order) => {
    const bucket = result[order.paymentMethod];
    if (!bucket) return; // unrecognized/legacy value — skip rather than guess
    if (isRevenueEligible(order)) bucket.orders += 1;
    if (isPaidSale(order)) bucket.paidAmount += Number(order.total) || 0;
  });

  return result;
}

// Purely operational counts (spec section 12) — every live order counts
// here regardless of cancellation, since this describes "what state is
// this order's payment in", not recognized revenue.
function computePaymentStatusBreakdown(orders) {
  const result = {};
  PAYMENT_STATUSES.forEach((status) => {
    result[status] = 0;
  });

  orders.forEach((order) => {
    if (result[order.paymentStatus] !== undefined) result[order.paymentStatus] += 1;
  });

  return result;
}

function computeFulfillmentBreakdown(orders) {
  const result = { pickup: { orders: 0, paidAmount: 0 }, delivery: { orders: 0, paidAmount: 0 } };

  orders.forEach((order) => {
    const bucket = result[order.fulfillmentMethod];
    if (!bucket) return;
    if (isRevenueEligible(order)) bucket.orders += 1;
    if (isPaidSale(order)) bucket.paidAmount += Number(order.total) || 0;
  });

  return result;
}

// Delivery Fees Collected here uses the stored historical deliveryFee —
// never recalculated (spec section 14).
function computeDeliveryAreaBreakdown(orders) {
  const result = {};
  DELIVERY_AREAS.forEach((area) => {
    result[area] = { orders: 0, feesCollected: 0 };
  });

  orders.forEach((order) => {
    if (order.fulfillmentMethod !== "delivery") return;
    const bucket = result[order.deliveryArea];
    if (!bucket) return;
    if (isRevenueEligible(order)) bucket.orders += 1;
    if (isDeliveryFeeCollected(order)) bucket.feesCollected += Number(order.deliveryFee) || 0;
  });

  return result;
}

function nextManilaDateString(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  // Pure calendar-day arithmetic — Date.UTC here is just a convenient leap
  // year/month-length-aware calculator, not a timezone conversion (compare
  // to manila-date.js's UTC-offset shifting, which IS a real conversion).
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

// One data point per calendar day in [fromStr, toStr] — including days with
// zero orders, so the chart never has gaps. Bounded by the same max-range
// check resolveDateRange() already applied before this is ever called.
function computeDailyChart(orders, fromStr, toStr) {
  const buckets = new Map();
  const labels = [];
  let cursor = fromStr;

  while (true) {
    labels.push(cursor);
    buckets.set(cursor, { paidRevenue: 0, orders: 0 });
    if (cursor === toStr) break;
    cursor = nextManilaDateString(cursor);
  }

  orders.forEach((order) => {
    const date = tsToDate(order.createdAt);
    if (!date) return;
    const key = formatManilaDateString(date);
    const bucket = buckets.get(key);
    if (!bucket) return; // defensive only — the query range already bounds this
    if (isRevenueEligible(order)) bucket.orders += 1;
    if (isPaidSale(order)) bucket.paidRevenue += Number(order.total) || 0;
  });

  return {
    labels,
    paidRevenue: labels.map((label) => buckets.get(label).paidRevenue),
    orders: labels.map((label) => buckets.get(label).orders),
  };
}

module.exports = {
  filterLiveOrders,
  computeTodaySummary,
  computePeriodSummary,
  computeBestSellers,
  computePaymentMethodBreakdown,
  computePaymentStatusBreakdown,
  computeFulfillmentBreakdown,
  computeDeliveryAreaBreakdown,
  computeDailyChart,
};
