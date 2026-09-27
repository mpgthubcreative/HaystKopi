// Inventory admin page — OWNER-only (route already gated in Phase 2 via
// data-required-role="owner"). Every change here writes both the product's
// inventory count and an inventoryLogs entry, atomically, via a Firestore
// transaction (see firebase/products-helpers.js). Firestore rules reject
// this same write path for anyone who isn't OWNER, so this page isn't the
// only thing enforcing that — it just gives the owner a UI for it.

import { auth } from "../firebase/firebase-init.js";
import { fetchAllProducts, isInStock, applyInventoryChange } from "../firebase/products-helpers.js";

const stateEl = document.getElementById("inventoryState");
const listEl = document.getElementById("inventoryList");

let actorName = "";

document.addEventListener("admin:ready", async (event) => {
  actorName = event.detail.profile.name || event.detail.profile.email || "";
  await loadProducts();
});

async function loadProducts() {
  stateEl.textContent = "Loading products…";
  stateEl.hidden = false;
  stateEl.classList.remove("is-error");
  listEl.innerHTML = "";

  let products;
  try {
    products = await fetchAllProducts();
  } catch (err) {
    stateEl.textContent = "We couldn't load products right now. Please refresh the page.";
    stateEl.classList.add("is-error");
    return;
  }

  const items = Object.values(products).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  if (items.length === 0) {
    stateEl.textContent = "No products yet.";
    return;
  }

  stateEl.hidden = true;
  items.forEach((product) => listEl.appendChild(buildInventoryCard(product)));
}

function buildInventoryCard(product) {
  const card = document.createElement("div");
  card.className = "product-card";

  const inStock = isInStock(product);

  card.innerHTML = `
    <div class="product-card-thumb">
      <img src="${escapeAttr(product.image || "")}" alt="">
    </div>
    <div class="product-card-info">
      <div class="product-card-name">${escapeHtml(product.name || product.id)}</div>
      <div class="product-card-meta">
        <span>${product.inventory || 0} bottle${product.inventory === 1 ? "" : "s"}</span>
        <span class="stock-pill ${inStock ? "" : "out-of-stock"}">${inStock ? "IN STOCK" : "OUT OF STOCK"}</span>
      </div>
    </div>
    <div class="product-card-actions">
      <button type="button" class="btn-quiet" data-action="toggle-edit">Edit</button>
    </div>
  `;

  const panel = buildEditPanel(product);
  panel.hidden = true;
  card.appendChild(panel);

  card.querySelector('[data-action="toggle-edit"]').addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  return card;
}

function buildEditPanel(product) {
  const panel = document.createElement("div");
  panel.className = "edit-panel";

  panel.innerHTML = `
    <div class="field">
      <label>Reason (optional)</label>
      <input type="text" data-role="reason" placeholder="e.g. Fresh batch, Damaged bottle, Stock count correction">
    </div>

    <div class="inventory-controls">
      <button type="button" class="chip-btn" data-delta="10">+10</button>
      <button type="button" class="chip-btn" data-delta="5">+5</button>
      <button type="button" class="chip-btn" data-delta="1">+1</button>
      <button type="button" class="chip-btn decrement" data-delta="-1">-1</button>
      <button type="button" class="chip-btn decrement" data-delta="-5">-5</button>
    </div>

    <div class="inventory-controls">
      <label for="" style="font-size:13px;color:var(--text-muted);">Set exact quantity</label>
      <input type="number" min="0" step="1" data-role="exact-input" value="${product.inventory || 0}">
      <button type="button" class="btn-primary-sm" data-action="set-exact">Save</button>
    </div>

    <span class="save-status" data-role="status"></span>
  `;

  const statusEl = panel.querySelector('[data-role="status"]');
  const reasonInput = panel.querySelector('[data-role="reason"]');
  const exactInput = panel.querySelector('[data-role="exact-input"]');
  const allButtons = panel.querySelectorAll("button");

  function setBusy(busy) {
    allButtons.forEach((btn) => { btn.disabled = busy; });
  }

  async function runChange(mode, value) {
    setBusy(true);
    statusEl.textContent = "Saving…";
    statusEl.classList.remove("is-error", "is-success");

    try {
      await applyInventoryChange(product.id, {
        mode,
        value,
        reason: reasonInput.value.trim(),
        actorUid: auth.currentUser.uid,
        actorName,
      });
      statusEl.textContent = "Saved.";
      statusEl.classList.add("is-success");
      reasonInput.value = "";
      await loadProducts();
    } catch (err) {
      statusEl.textContent = "Couldn't save that change. Please try again.";
      statusEl.classList.add("is-error");
      setBusy(false);
    }
  }

  panel.querySelectorAll("[data-delta]").forEach((btn) => {
    btn.addEventListener("click", () => runChange("delta", Number(btn.dataset.delta)));
  });

  panel.querySelector('[data-action="set-exact"]').addEventListener("click", () => {
    const value = Number(exactInput.value);
    if (!Number.isFinite(value) || value < 0) {
      statusEl.textContent = "Enter a quantity of 0 or more.";
      statusEl.classList.add("is-error");
      return;
    }
    runChange("set", value);
  });

  return panel;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
