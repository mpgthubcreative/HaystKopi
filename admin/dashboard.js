// Dashboard analytics page — accessible to OWNER and ADMIN. All numbers
// come from get-dashboard-analytics.js (real Firestore order data,
// aggregated server-side) — this file only renders whatever it returns and
// owns zero metric-definition logic itself, per Phase 11 spec section 29
// ("centralize metric definitions" — that's lib/analytics-rules.js /
// lib/dashboard-aggregate.js on the backend, not here).

import { fetchDashboardAnalytics } from "./dashboard-actions.js";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_AREA_LABELS,
  PAYMENT_METHOD_LABELS,
} from "../firebase/orders-helpers.js";

const stateEl = document.getElementById("analyticsState");
const contentEl = document.getElementById("dashboardContent");

const datePreset = document.getElementById("analyticsDatePreset");
const customDates = document.getElementById("analyticsCustomDates");
const dateFrom = document.getElementById("analyticsDateFrom");
const dateTo = document.getElementById("analyticsDateTo");
const includeTestToggle = document.getElementById("includeTestToggle");

const todayPaidSales = document.getElementById("todayPaidSales");
const todayOrders = document.getElementById("todayOrders");
const todayBottlesSold = document.getElementById("todayBottlesSold");
const todayCancelled = document.getElementById("todayCancelled");

const periodGrossOrderValue = document.getElementById("periodGrossOrderValue");
const periodPaidRevenue = document.getElementById("periodPaidRevenue");
const periodCompletedRevenue = document.getElementById("periodCompletedRevenue");
const periodAOV = document.getElementById("periodAOV");
const periodDeliveryFees = document.getElementById("periodDeliveryFees");
const periodRefundedAmount = document.getElementById("periodRefundedAmount");
const periodRefundedOrders = document.getElementById("periodRefundedOrders");
const periodPendingOrders = document.getElementById("periodPendingOrders");
const periodAwaitingVerification = document.getElementById("periodAwaitingVerification");
const periodCancelledOrders = document.getElementById("periodCancelledOrders");

const chartCanvas = document.getElementById("salesChart");
const chartEmptyState = document.getElementById("chartEmptyState");

const bestSellersList = document.getElementById("bestSellersList");
const paymentMethodBreakdownEl = document.getElementById("paymentMethodBreakdown");
const paymentStatusBreakdownEl = document.getElementById("paymentStatusBreakdown");
const fulfillmentBreakdownEl = document.getElementById("fulfillmentBreakdown");
const deliveryAreaBreakdownEl = document.getElementById("deliveryAreaBreakdown");
const deliveryDistanceAvgEl = document.getElementById("deliveryDistanceAvg");
const deliveryDistanceLongestEl = document.getElementById("deliveryDistanceLongest");
const alertsListEl = document.getElementById("alertsList");
const recentOrdersListEl = document.getElementById("recentOrdersList");

const FULFILLMENT_LABELS = { pickup: "Pickup", delivery: "Delivery" };

let salesChart = null;
let isLoading = false;

document.addEventListener("admin:ready", () => {
  loadAnalytics();
});

function formatPeso(amount) {
  const n = Number(amount) || 0;
  return `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Recent-order timestamps must read as Asia/Manila regardless of the
// admin's own browser timezone — see Phase 11 spec section 27.
function formatManilaTime(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });
}

function collectFilters() {
  const filters = { datePreset: datePreset.value, includeTest: includeTestToggle.checked };
  if (datePreset.value === "custom") {
    filters.dateFrom = dateFrom.value;
    filters.dateTo = dateTo.value;
  }
  return filters;
}

async function loadAnalytics() {
  if (isLoading) return;
  isLoading = true;

  stateEl.hidden = false;
  stateEl.textContent = "Loading analytics…";
  stateEl.classList.remove("is-error");
  contentEl.hidden = true;

  const result = await fetchDashboardAnalytics(collectFilters());
  isLoading = false;

  if (!result.ok) {
    stateEl.textContent = result.message;
    stateEl.classList.add("is-error");
    return;
  }

  stateEl.hidden = true;
  contentEl.hidden = false;
  render(result.data);
}

function render(data) {
  renderToday(data.today);
  renderPeriod(data.period);
  renderChart(data.chart);
  renderBestSellers(data.bestSellers);
  renderPaymentMethodBreakdown(data.paymentMethodBreakdown);
  renderPaymentStatusBreakdown(data.paymentStatusBreakdown);
  renderFulfillmentBreakdown(data.fulfillmentBreakdown);
  renderDeliveryAreaBreakdown(data.deliveryAreaBreakdown, data.period);
  renderAlerts(data.period, data.outOfStock);
  renderRecentOrders(data.recentOrders);
}

function renderToday(today) {
  todayPaidSales.textContent = formatPeso(today.paidSales);
  todayOrders.textContent = String(today.orders);
  todayBottlesSold.textContent = String(today.bottlesSold);
  todayCancelled.textContent = String(today.cancelledToday);
}

function renderPeriod(period) {
  periodGrossOrderValue.textContent = formatPeso(period.grossOrderValue);
  periodPaidRevenue.textContent = formatPeso(period.paidRevenue);
  periodCompletedRevenue.textContent = formatPeso(period.completedRevenue);
  periodAOV.textContent = formatPeso(period.averageOrderValue);
  periodDeliveryFees.textContent = formatPeso(period.deliveryFeesCollected);
  periodRefundedAmount.textContent = formatPeso(period.refundedAmount);
  periodRefundedOrders.textContent = `${period.refundedOrders} order${period.refundedOrders === 1 ? "" : "s"}`;
  periodPendingOrders.textContent = String(period.pendingOrders);
  periodAwaitingVerification.textContent = String(period.awaitingVerification);
  periodCancelledOrders.textContent = String(period.cancelledOrders);
}

function renderChart(chart) {
  const hasData = chart.paidRevenue.some((v) => v > 0) || chart.orders.some((v) => v > 0);
  chartEmptyState.hidden = hasData;
  chartCanvas.hidden = !hasData;

  if (!hasData) {
    if (salesChart) {
      salesChart.destroy();
      salesChart = null;
    }
    return;
  }

  // Labels are already Manila business-date strings ("YYYY-MM-DD") computed
  // server-side — parsed/formatted here as plain UTC calendar dates so the
  // viewer's own browser timezone can never shift the displayed day.
  const labels = chart.labels.map((iso) => {
    const date = new Date(`${iso}T00:00:00Z`);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  });

  if (salesChart) {
    salesChart.data.labels = labels;
    salesChart.data.datasets[0].data = chart.paidRevenue;
    salesChart.data.datasets[1].data = chart.orders;
    salesChart.update();
    return;
  }

  salesChart = new Chart(chartCanvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Paid Revenue (₱)",
          data: chart.paidRevenue,
          backgroundColor: "rgba(139, 94, 60, 0.6)",
          borderRadius: 4,
          yAxisID: "y",
        },
        {
          label: "Orders",
          data: chart.orders,
          type: "line",
          borderColor: "#3B2416",
          backgroundColor: "#3B2416",
          tension: 0.3,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { beginAtZero: true, position: "left", title: { display: true, text: "Paid Revenue (₱)" } },
        y1: {
          beginAtZero: true,
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Orders" },
          ticks: { precision: 0 },
        },
      },
    },
  });
}

function renderBestSellers(bestSellers) {
  bestSellersList.innerHTML = "";

  if (!bestSellers.length) {
    bestSellersList.innerHTML = '<li class="empty-note">No sales in this period yet.</li>';
    return;
  }

  bestSellers.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(item.name)}</span><span>${item.quantity} bottle${item.quantity === 1 ? "" : "s"}</span>`;
    bestSellersList.appendChild(li);
  });
}

function renderPaymentMethodBreakdown(breakdown) {
  paymentMethodBreakdownEl.innerHTML = "";
  Object.entries(breakdown).forEach(([method, stats]) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <span class="breakdown-row-label">${escapeHtml(PAYMENT_METHOD_LABELS[method] || method)}</span>
      <span class="breakdown-row-meta">${stats.orders} order${stats.orders === 1 ? "" : "s"} · ${formatPeso(stats.paidAmount)}</span>
    `;
    paymentMethodBreakdownEl.appendChild(row);
  });
}

function renderPaymentStatusBreakdown(breakdown) {
  paymentStatusBreakdownEl.innerHTML = "";
  Object.entries(breakdown).forEach(([status, count]) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <span class="breakdown-row-label">${escapeHtml(PAYMENT_STATUS_LABELS[status] || status)}</span>
      <span class="breakdown-row-meta">${count}</span>
    `;
    paymentStatusBreakdownEl.appendChild(row);
  });
}

function renderFulfillmentBreakdown(breakdown) {
  fulfillmentBreakdownEl.innerHTML = "";
  Object.entries(breakdown).forEach(([key, stats]) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <span class="breakdown-row-label">${escapeHtml(FULFILLMENT_LABELS[key] || key)}</span>
      <span class="breakdown-row-meta">${stats.orders} order${stats.orders === 1 ? "" : "s"} · ${formatPeso(stats.paidAmount)}</span>
    `;
    fulfillmentBreakdownEl.appendChild(row);
  });
}

function renderDeliveryAreaBreakdown(breakdown, period) {
  deliveryAreaBreakdownEl.innerHTML = "";
  Object.entries(breakdown).forEach(([area, stats]) => {
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <span class="breakdown-row-label">${escapeHtml(DELIVERY_AREA_LABELS[area] || area)}</span>
      <span class="breakdown-row-meta">${stats.orders} order${stats.orders === 1 ? "" : "s"} · ${formatPeso(stats.feesCollected)}</span>
    `;
    deliveryAreaBreakdownEl.appendChild(row);
  });

  deliveryDistanceAvgEl.textContent = period.averageDeliveryDistanceKm != null ? `${period.averageDeliveryDistanceKm.toFixed(1)} km` : "—";
  deliveryDistanceLongestEl.textContent = period.longestDeliveryDistanceKm != null ? `${period.longestDeliveryDistanceKm.toFixed(1)} km` : "—";
}

function renderAlerts(period, outOfStock) {
  alertsListEl.innerHTML = "";

  const pendingLink = document.createElement("a");
  pendingLink.href = "orders.html";
  pendingLink.className = "alert-item";
  pendingLink.innerHTML = `<span>Pending Orders</span><span class="alert-item-count">${period.pendingOrders}</span>`;
  alertsListEl.appendChild(pendingLink);

  const awaitingLink = document.createElement("a");
  awaitingLink.href = "orders.html";
  awaitingLink.className = "alert-item";
  awaitingLink.innerHTML = `<span>Awaiting Payment Verification</span><span class="alert-item-count">${period.awaitingVerification}</span>`;
  alertsListEl.appendChild(awaitingLink);

  if (!outOfStock.length) {
    const ok = document.createElement("p");
    ok.className = "empty-note";
    ok.textContent = "No products out of stock.";
    alertsListEl.appendChild(ok);
    return;
  }

  // Always links to Inventory — an ADMIN who clicks through is redirected
  // by the page's own owner-only route guard (admin-auth.js), so this
  // never actually grants an admin inventory-edit access; see Phase 11
  // spec section 21.
  outOfStock.forEach((product) => {
    const link = document.createElement("a");
    link.href = "inventory.html";
    link.className = "alert-item alert-warning";
    link.innerHTML = `<span>${escapeHtml(product.name)}</span><span class="alert-item-count">OUT OF STOCK</span>`;
    alertsListEl.appendChild(link);
  });
}

function renderRecentOrders(orders) {
  recentOrdersListEl.innerHTML = "";

  if (!orders.length) {
    recentOrdersListEl.innerHTML = '<p class="empty-note">No orders yet.</p>';
    return;
  }

  orders.forEach((order) => {
    const card = document.createElement("div");
    card.className = "order-card";
    card.innerHTML = `
      <div class="order-card-top">
        <span class="order-number">${escapeHtml(order.orderNumber)}</span>
        <span class="order-date">${escapeHtml(formatManilaTime(order.createdAt))}</span>
        <span class="badge ${order.isTest ? "badge-test" : "badge-live"}">${order.isTest ? "TEST" : "LIVE"}</span>
        <span class="status-pill status-${escapeAttr(order.orderStatus)}">${escapeHtml(ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus)}</span>
      </div>
      <div class="order-card-meta">
        <span>${escapeHtml(order.customerName || "")}</span>
        <span class="payment-pill payment-${escapeAttr(order.paymentStatus)}">${escapeHtml(PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus)}</span>
        <span class="order-total">${formatPeso(order.total)}</span>
      </div>
      <div class="order-card-actions">
        <a href="order.html?id=${encodeURIComponent(order.id)}" class="btn-quiet">View Details</a>
      </div>
    `;
    recentOrdersListEl.appendChild(card);
  });
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

datePreset.addEventListener("change", () => {
  customDates.hidden = datePreset.value !== "custom";
  if (datePreset.value !== "custom") loadAnalytics();
});

dateFrom.addEventListener("change", () => {
  if (datePreset.value === "custom") loadAnalytics();
});

dateTo.addEventListener("change", () => {
  if (datePreset.value === "custom") loadAnalytics();
});

includeTestToggle.addEventListener("change", loadAnalytics);
