// Orders admin page — accessible to OWNER and ADMIN.
// Reads orders directly via the client SDK (Firestore rules already
// restrict this to admin/owner); every WRITE happens through
// order-actions.js -> the secure Netlify Functions instead.
//
// Search/filtering is client-side over whatever pages have been loaded so
// far (50 at a time via "Load More") — fine at this business's order volume.
// If that stops being true, fetchOrdersPage() in
// firebase/orders-helpers.js is the function to change to server-side
// where() queries (composite indexes would then be needed).

import {
  fetchOrdersPage,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  DELIVERY_AREA_LABELS,
  PAYMENT_METHOD_LABELS,
} from "../firebase/orders-helpers.js";
import { requestOrdersExport, downloadBlob } from "./export-actions.js";

const stateEl = document.getElementById("ordersState");
const listEl = document.getElementById("ordersList");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const searchInput = document.getElementById("orderSearchInput");
const sortSelect = document.getElementById("sortSelect");
const statusFilter = document.getElementById("statusFilter");
const fulfillmentFilter = document.getElementById("fulfillmentFilter");
const paymentFilter = document.getElementById("paymentFilter");
const testFilter = document.getElementById("testFilter");
const deliveryAreaFilter = document.getElementById("deliveryAreaFilter");

const exportBtn = document.getElementById("exportBtn");
const exportModal = document.getElementById("exportModal");
const exportCancelBtn = document.getElementById("exportCancelBtn");
const exportDatePreset = document.getElementById("exportDatePreset");
const exportCustomDates = document.getElementById("exportCustomDates");
const exportDateFrom = document.getElementById("exportDateFrom");
const exportDateTo = document.getElementById("exportDateTo");
const exportOrderType = document.getElementById("exportOrderType");
const exportOrderStatus = document.getElementById("exportOrderStatus");
const exportPaymentStatus = document.getElementById("exportPaymentStatus");
const exportFulfillment = document.getElementById("exportFulfillment");
const exportPaymentMethod = document.getElementById("exportPaymentMethod");
const exportDeliveryArea = document.getElementById("exportDeliveryArea");
const exportStatus = document.getElementById("exportStatus");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");
const downloadExcelBtn = document.getElementById("downloadExcelBtn");

let loadedOrders = [];
let cursor = null;
let hasMore = false;
let sortDirection = "desc";
let isLoading = false;

document.addEventListener("admin:ready", async () => {
  await loadPage(true);
});

async function loadPage(reset) {
  if (isLoading) return;
  isLoading = true;

  if (reset) {
    loadedOrders = [];
    cursor = null;
    listEl.innerHTML = "";
    stateEl.textContent = "Loading orders…";
    stateEl.hidden = false;
    stateEl.classList.remove("is-error");
  } else {
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "Loading…";
  }

  try {
    const page = await fetchOrdersPage({ sortDirection, cursor });
    loadedOrders = loadedOrders.concat(page.orders);
    cursor = page.cursor;
    hasMore = page.hasMore;
  } catch (err) {
    stateEl.textContent = "We couldn't load orders right now. Please refresh the page.";
    stateEl.classList.add("is-error");
    isLoading = false;
    return;
  }

  loadMoreBtn.disabled = false;
  loadMoreBtn.textContent = "Load More";
  isLoading = false;
  render();
}

function getFilteredOrders() {
  const searchTerm = searchInput.value.trim().toLowerCase();

  return loadedOrders.filter((order) => {
    if (statusFilter.value !== "all" && order.orderStatus !== statusFilter.value) return false;
    if (fulfillmentFilter.value !== "all" && order.fulfillmentMethod !== fulfillmentFilter.value) return false;
    if (paymentFilter.value !== "all" && order.paymentStatus !== paymentFilter.value) return false;
    if (testFilter.value === "live" && order.isTest) return false;
    if (testFilter.value === "test" && !order.isTest) return false;
    if (deliveryAreaFilter.value !== "all" && order.deliveryArea !== deliveryAreaFilter.value) return false;

    if (searchTerm) {
      const haystack = [order.orderNumber, order.customerName, order.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    return true;
  });
}

function render() {
  listEl.innerHTML = "";

  if (loadedOrders.length === 0) {
    stateEl.textContent = "No orders yet.";
    stateEl.hidden = false;
    stateEl.classList.remove("is-error");
    loadMoreBtn.hidden = true;
    return;
  }

  const filtered = getFilteredOrders();

  if (filtered.length === 0) {
    stateEl.textContent = "No orders match your search or filters.";
    stateEl.hidden = false;
    stateEl.classList.remove("is-error");
  } else {
    stateEl.hidden = true;
  }

  filtered.forEach((order) => listEl.appendChild(buildOrderCard(order)));
  loadMoreBtn.hidden = !hasMore;
}

function buildOrderCard(order) {
  const card = document.createElement("div");
  card.className = "order-card";

  const firstItem = (order.items || [])[0] || {};
  const fulfillmentLabel = order.fulfillmentMethod === "delivery"
    ? `Delivery — ${DELIVERY_AREA_LABELS[order.deliveryArea] || order.deliveryArea || ""}`
    : "Pickup";

  card.innerHTML = `
    <div class="order-card-top">
      <span class="order-number">${escapeHtml(order.orderNumber || order.id)}</span>
      <span class="order-date">${escapeHtml(formatDate(order.createdAt))}</span>
      <span class="badge ${order.isTest ? "badge-test" : "badge-live"}">${order.isTest ? "TEST" : "LIVE"}</span>
      <span class="status-pill status-${escapeAttr(order.orderStatus)}">${escapeHtml(ORDER_STATUS_LABELS[order.orderStatus] || order.orderStatus)}</span>
    </div>
    <div class="order-card-meta">
      <span>${escapeHtml(order.customerName || "")}</span>
      <span>${escapeHtml(order.phone || "")}</span>
      <span>${escapeHtml(firstItem.name || "")} × ${Number(firstItem.quantity) || 0}</span>
      <span>${escapeHtml(fulfillmentLabel)}</span>
      <span>${escapeHtml(PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "")}</span>
      <span class="payment-pill payment-${escapeAttr(order.paymentStatus)}">${escapeHtml(PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus)}</span>
      <span class="order-total">₱${Number(order.total || 0).toFixed(2)}</span>
    </div>
    <div class="order-card-actions">
      <a href="order.html?id=${encodeURIComponent(order.id)}" class="btn-quiet">View Details</a>
    </div>
  `;

  return card;
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = typeof timestamp.toDate === "function" ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

[searchInput].forEach((el) => el.addEventListener("input", render));
[statusFilter, fulfillmentFilter, paymentFilter, testFilter, deliveryAreaFilter].forEach((el) => el.addEventListener("change", render));

sortSelect.addEventListener("change", () => {
  sortDirection = sortSelect.value;
  loadPage(true);
});

loadMoreBtn.addEventListener("click", () => loadPage(false));

/* ---------- Export ---------- */
// Deliberately queries the backend/Firestore directly (see export-actions.js
// -> export-orders.js) rather than exporting `loadedOrders` — the admin may
// only have paginated in the most recent 50, but export must cover the
// full requested date range regardless of what's currently on screen.

function resetExportStatus() {
  exportStatus.hidden = true;
  exportStatus.textContent = "";
  exportStatus.classList.remove("is-error", "is-success");
}

function openExportModal() {
  resetExportStatus();
  exportModal.hidden = false;
}

function closeExportModal() {
  exportModal.hidden = true;
}

function collectExportFilters() {
  const filters = {
    datePreset: exportDatePreset.value,
    orderType: exportOrderType.value,
  };

  if (exportDatePreset.value === "custom") {
    filters.dateFrom = exportDateFrom.value;
    filters.dateTo = exportDateTo.value;
  }

  if (exportOrderStatus.value !== "all") filters.orderStatus = exportOrderStatus.value;
  if (exportPaymentStatus.value !== "all") filters.paymentStatus = exportPaymentStatus.value;
  if (exportFulfillment.value !== "all") filters.fulfillment = exportFulfillment.value;
  if (exportPaymentMethod.value !== "all") filters.paymentMethod = exportPaymentMethod.value;
  if (exportDeliveryArea.value !== "all") filters.deliveryArea = exportDeliveryArea.value;

  return filters;
}

async function runExport(format) {
  downloadCsvBtn.disabled = true;
  downloadExcelBtn.disabled = true;
  exportStatus.hidden = false;
  exportStatus.textContent = "Preparing export…";
  exportStatus.classList.remove("is-error", "is-success");

  const result = await requestOrdersExport(collectExportFilters(), format);

  downloadCsvBtn.disabled = false;
  downloadExcelBtn.disabled = false;

  if (!result.ok) {
    exportStatus.textContent = result.message || "Export could not be generated. Please try again.";
    exportStatus.classList.add("is-error");
    return;
  }

  if (result.empty) {
    exportStatus.textContent = result.message || "No orders matched the selected filters.";
    return;
  }

  downloadBlob(result.blob, result.filename);
  exportStatus.textContent = "Export downloaded.";
  exportStatus.classList.add("is-success");
}

exportBtn.addEventListener("click", openExportModal);
exportCancelBtn.addEventListener("click", closeExportModal);

exportDatePreset.addEventListener("change", () => {
  exportCustomDates.hidden = exportDatePreset.value !== "custom";
});

downloadCsvBtn.addEventListener("click", () => runExport("csv"));
downloadExcelBtn.addEventListener("click", () => runExport("xlsx"));
