// Date-range resolution + Firestore querying + in-memory filtering for the
// order export endpoint (export-orders.js). Split out so the handler itself
// stays focused on auth/response-shape.

const { ORDER_STATUS_VALUES, PAYMENT_STATUS_VALUES } = require("./order-status");
const {
  formatManilaDateString,
  manilaDateStringToUtcStart,
  manilaDateStringToUtcEnd,
  computeManilaPresetRange,
} = require("./manila-date");

const DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const DEFAULT_PRESET = "this-month";

const FULFILLMENT_VALUES = ["pickup", "delivery"];
const DELIVERY_AREA_VALUES = ["rosewood", "acacia", "external"];
const PAYMENT_METHOD_VALUES = ["gcash", "bank-transfer", "cash-on-pickup", "cash-on-delivery"];
const ORDER_TYPE_VALUES = ["all", "live", "test"];

// Returns { ok, errors, fromStr, toStr, startUtc, endUtc }. `errors` is a
// single user-facing message — there's only ever one thing wrong with a
// date range at a time, unlike the field-by-field validators elsewhere.
function resolveDateRange(filters) {
  const preset = typeof filters.datePreset === "string" ? filters.datePreset : DEFAULT_PRESET;

  let fromStr;
  let toStr;

  if (preset === "custom") {
    fromStr = typeof filters.dateFrom === "string" ? filters.dateFrom.trim() : "";
    toStr = typeof filters.dateTo === "string" ? filters.dateTo.trim() : "";

    if (!DATE_STRING_PATTERN.test(fromStr) || !DATE_STRING_PATTERN.test(toStr)) {
      return { ok: false, error: "Please choose a valid date range." };
    }
  } else {
    const presetRange = computeManilaPresetRange(preset) || computeManilaPresetRange(DEFAULT_PRESET);
    fromStr = presetRange.from;
    toStr = presetRange.to;
  }

  if (fromStr > toStr) {
    return { ok: false, error: "The start date must be before the end date." };
  }

  const startUtc = manilaDateStringToUtcStart(fromStr);
  const endUtc = manilaDateStringToUtcEnd(toStr);

  // endUtc already sits at 23:59:59.999 of its day (1ms before the next
  // midnight), so the raw span already equals the inclusive day count minus
  // 1ms — rounding (not "+1") gives the correct calendar-day count.
  const rangeDays = Math.round((endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000));
  if (rangeDays > MAX_RANGE_DAYS) {
    return { ok: false, error: `The selected range is too large. Please choose ${MAX_RANGE_DAYS} days or fewer.` };
  }

  // A future-dated custom range isn't an error (harmless — it'll just come
  // back empty), but clamp "to" so we never query further than "now".
  const todayStr = formatManilaDateString(new Date());
  const clampedToUtc = toStr > todayStr ? new Date() : endUtc;

  return { ok: true, fromStr, toStr, startUtc, endUtc: clampedToUtc };
}

// Single range field (createdAt) + orderBy the same field — Firestore
// auto-indexes this, no composite index needed. See Phase 10 summary,
// section 13, for why every OTHER filter is applied in memory instead.
async function queryOrdersInRange(db, admin, startUtc, endUtc) {
  const snap = await db
    .collection("orders")
    .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(startUtc))
    .where("createdAt", "<=", admin.firestore.Timestamp.fromDate(endUtc))
    .orderBy("createdAt", "asc")
    .get();

  const orders = [];
  snap.forEach((docSnap) => orders.push({ id: docSnap.id, ...docSnap.data() }));
  return orders;
}

// Every filter beyond the date range is applied here, in memory, over
// whatever the date-range query already narrowed things down to — see the
// scaling note in the handler/summary.
function applyFilters(orders, filters) {
  const orderStatus = ORDER_STATUS_VALUES.includes(filters.orderStatus) ? filters.orderStatus : null;
  const paymentStatus = PAYMENT_STATUS_VALUES.includes(filters.paymentStatus) ? filters.paymentStatus : null;
  const fulfillment = FULFILLMENT_VALUES.includes(filters.fulfillment) ? filters.fulfillment : null;
  const deliveryArea = DELIVERY_AREA_VALUES.includes(filters.deliveryArea) ? filters.deliveryArea : null;
  const paymentMethod = PAYMENT_METHOD_VALUES.includes(filters.paymentMethod) ? filters.paymentMethod : null;
  // Fail-safe default: accounting exports must never silently include TEST
  // orders unless explicitly asked for. See Phase 10 spec section 10.
  const orderType = ORDER_TYPE_VALUES.includes(filters.orderType) ? filters.orderType : "live";

  return orders.filter((order) => {
    if (orderStatus && order.orderStatus !== orderStatus) return false;
    if (paymentStatus && order.paymentStatus !== paymentStatus) return false;
    if (fulfillment && order.fulfillmentMethod !== fulfillment) return false;
    if (deliveryArea && order.deliveryArea !== deliveryArea) return false;
    if (paymentMethod && order.paymentMethod !== paymentMethod) return false;
    if (orderType === "live" && order.isTest) return false;
    if (orderType === "test" && !order.isTest) return false;
    return true;
  });
}

module.exports = { resolveDateRange, queryOrdersInRange, applyFilters, ORDER_TYPE_VALUES };
