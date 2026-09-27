// POST /.netlify/functions/get-dashboard-analytics
// Requires an active OWNER or ADMIN (Authorization: Bearer <Firebase ID
// token>) — no public analytics endpoint exists.
//
// Queries orders ONLY within the requested (bounded, max-1-year) Manila
// date range, plus a small independent "today" range and a capped
// most-recent-orders query — never the entire order history — then
// aggregates in server memory. See lib/dashboard-aggregate.js for the
// reducers and lib/analytics-rules.js for what counts as "paid"/
// "cancelled"/etc. Scaling note: at higher order volumes this in-memory
// aggregation (rather than precomputed rollup documents) is the first
// thing that would need to change — see the Phase 11 summary.

const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isActiveAdminProfile } = require("./lib/authorize");
const { respond } = require("./lib/http");
const { resolveDateRange, queryOrdersInRange } = require("./lib/export-orders-query");
const { formatManilaDateString, manilaDateStringToUtcStart, manilaDateStringToUtcEnd } = require("./lib/manila-date");
const {
  filterLiveOrders,
  computeTodaySummary,
  computePeriodSummary,
  computeBestSellers,
  computePaymentMethodBreakdown,
  computePaymentStatusBreakdown,
  computeFulfillmentBreakdown,
  computeDeliveryAreaBreakdown,
  computeDailyChart,
} = require("./lib/dashboard-aggregate");

const MAX_BODY_BYTES = 500;
const RECENT_ORDERS_LIMIT = 10;
// Fetches a small margin beyond the display limit so filtering out TEST
// orders (when not included) still usually leaves a full page of 10.
const RECENT_ORDERS_FETCH_LIMIT = 20;

async function fetchRecentOrders(includeTest) {
  const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(RECENT_ORDERS_FETCH_LIMIT).get();
  const orders = [];
  snap.forEach((docSnap) => orders.push({ id: docSnap.id, ...docSnap.data() }));

  return filterLiveOrders(orders, includeTest)
    .slice(0, RECENT_ORDERS_LIMIT)
    .map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber || order.id,
      customerName: order.customerName || "",
      total: Number(order.total) || 0,
      paymentStatus: order.paymentStatus,
      orderStatus: order.orderStatus,
      fulfillmentMethod: order.fulfillmentMethod,
      isTest: Boolean(order.isTest),
      createdAt: order.createdAt && typeof order.createdAt.toDate === "function" ? order.createdAt.toDate().toISOString() : null,
    }));
}

// Small, fixed-size collection (the product catalog) — a plain equality
// query, not a full scan of orders.
async function fetchOutOfStockProducts() {
  const snap = await db.collection("products").where("inventory", "==", 0).get();
  const products = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    products.push({ id: docSnap.id, name: data.name || docSnap.id });
  });
  return products;
}

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
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to view analytics." });
  }

  let payload = {};
  if (event.body) {
    if (Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
      return respond(400, { success: false, error: "invalid-request", message: "Analytics could not be loaded. Please try again." });
    }
    try {
      payload = JSON.parse(event.body);
    } catch (err) {
      return respond(400, { success: false, error: "invalid-json", message: "Analytics could not be loaded. Please try again." });
    }
  }

  const includeTest = payload.includeTest === true;

  const range = resolveDateRange(payload);
  if (!range.ok) {
    return respond(400, { success: false, error: "invalid-date-range", message: range.error });
  }

  const todayStr = formatManilaDateString(new Date());
  const rangeIsToday = range.fromStr === todayStr && range.toStr === todayStr;

  let periodOrders;
  let todayOrders;
  try {
    periodOrders = await queryOrdersInRange(db, admin, range.startUtc, range.endUtc);
    if (rangeIsToday) {
      todayOrders = periodOrders;
    } else {
      const todayStartUtc = manilaDateStringToUtcStart(todayStr);
      const todayEndUtc = manilaDateStringToUtcEnd(todayStr);
      todayOrders = await queryOrdersInRange(db, admin, todayStartUtc, todayEndUtc);
    }
  } catch (err) {
    console.error("get-dashboard-analytics order query failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't load analytics right now. Please try again." });
  }

  const livePeriodOrders = filterLiveOrders(periodOrders, includeTest);
  const liveTodayOrders = filterLiveOrders(todayOrders, includeTest);

  let recentOrders;
  let outOfStock;
  try {
    [recentOrders, outOfStock] = await Promise.all([fetchRecentOrders(includeTest), fetchOutOfStockProducts()]);
  } catch (err) {
    console.error("get-dashboard-analytics recent-orders/out-of-stock query failed:", err);
    return respond(500, { success: false, error: "server-error", message: "We couldn't load analytics right now. Please try again." });
  }

  return respond(200, {
    success: true,
    range: { from: range.fromStr, to: range.toStr },
    includeTest,
    today: computeTodaySummary(liveTodayOrders),
    period: computePeriodSummary(livePeriodOrders),
    bestSellers: computeBestSellers(livePeriodOrders),
    paymentMethodBreakdown: computePaymentMethodBreakdown(livePeriodOrders),
    paymentStatusBreakdown: computePaymentStatusBreakdown(livePeriodOrders),
    fulfillmentBreakdown: computeFulfillmentBreakdown(livePeriodOrders),
    deliveryAreaBreakdown: computeDeliveryAreaBreakdown(livePeriodOrders),
    chart: computeDailyChart(livePeriodOrders, range.fromStr, range.toStr),
    recentOrders,
    outOfStock,
  });
};
