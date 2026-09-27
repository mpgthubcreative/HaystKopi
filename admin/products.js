// Products admin page — accessible to OWNER and ADMIN.
// Lets both roles edit ordinary catalog fields. Inventory is shown
// read-only here — actual stock changes happen on the dedicated Inventory
// page, and the inventory write-protection is enforced by Firestore rules
// regardless of what this page shows.

import { fetchAllProducts, isInStock, updateProductDetails } from "../firebase/products-helpers.js";
import { uploadProductImage } from "../firebase/storage-helpers.js";

const stateEl = document.getElementById("productsState");
const listEl = document.getElementById("productList");

document.addEventListener("admin:ready", async () => {
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
  items.forEach((product) => listEl.appendChild(buildProductCard(product)));
}

function buildProductCard(product) {
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
        <span>₱${Number(product.price || 0).toFixed(2)}</span>
        <span>${escapeHtml(product.bottleSize || "")}</span>
        <span class="readonly-value">${product.inventory || 0} bottle${product.inventory === 1 ? "" : "s"}</span>
        <span class="stock-pill ${inStock ? "" : "out-of-stock"}">${inStock ? "IN STOCK" : "OUT OF STOCK"}</span>
      </div>
    </div>
    <div class="product-card-actions">
      <button type="button" class="btn-quiet" data-action="toggle-edit">Edit Details</button>
    </div>
  `;

  const editPanel = buildEditPanel(product);
  editPanel.hidden = true;
  card.appendChild(editPanel);

  card.querySelector('[data-action="toggle-edit"]').addEventListener("click", () => {
    editPanel.hidden = !editPanel.hidden;
  });

  return card;
}

function buildEditPanel(product) {
  const panel = document.createElement("form");
  panel.className = "edit-panel";

  panel.innerHTML = `
    <div class="field-row">
      <div class="field">
        <label>Name</label>
        <input type="text" name="name" value="${escapeAttr(product.name || "")}" required>
      </div>
      <div class="field">
        <label>Price (₱)</label>
        <input type="number" name="price" min="0" step="0.01" value="${Number(product.price || 0)}" required>
      </div>
      <div class="field">
        <label>Bottle Size</label>
        <input type="text" name="bottleSize" value="${escapeAttr(product.bottleSize || "")}" required>
      </div>
    </div>

    <div class="field">
      <label>Description (one line per paragraph)</label>
      <textarea name="description">${escapeHtml(product.description || "")}</textarea>
    </div>

    <div class="field">
      <label>Image path (cover photo)</label>
      <input type="text" name="image" value="${escapeAttr(product.image || "")}">
      <div class="upload-row">
        <input type="file" accept="image/*" data-role="cover-file">
        <span class="save-status" data-role="cover-upload-status"></span>
      </div>
    </div>

    <div class="field">
      <label>Gallery images (comma-separated paths)</label>
      <textarea name="galleryImages">${escapeHtml((product.galleryImages || []).join(", "))}</textarea>
      <div class="upload-row">
        <input type="file" accept="image/*" data-role="gallery-file">
        <span class="save-status" data-role="gallery-upload-status"></span>
      </div>
    </div>

    <div class="field-row" style="align-items:center;">
      <button type="submit" class="btn-primary-sm">Save changes</button>
      <button type="button" class="btn-quiet" data-action="cancel-edit">Cancel</button>
      <span class="save-status" data-role="status"></span>
    </div>
  `;

  const statusEl = panel.querySelector('[data-role="status"]');

  panel.querySelector('[data-action="cancel-edit"]').addEventListener("click", () => {
    panel.hidden = true;
  });

  wireImageUpload({
    panel,
    productId: product.id,
    fileInputSelector: '[data-role="cover-file"]',
    statusSelector: '[data-role="cover-upload-status"]',
    onUploaded: (url) => {
      panel.querySelector('input[name="image"]').value = url;
    },
  });

  wireImageUpload({
    panel,
    productId: product.id,
    fileInputSelector: '[data-role="gallery-file"]',
    statusSelector: '[data-role="gallery-upload-status"]',
    onUploaded: (url) => {
      const textarea = panel.querySelector('textarea[name="galleryImages"]');
      const existing = textarea.value.split(",").map((s) => s.trim()).filter(Boolean);
      existing.push(url);
      textarea.value = existing.join(", ");
    },
  });

  panel.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(panel);
    const submitBtn = panel.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    statusEl.textContent = "Saving…";
    statusEl.classList.remove("is-error", "is-success");

    const galleryImages = String(formData.get("galleryImages") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await updateProductDetails(product.id, {
        name: String(formData.get("name") || "").trim(),
        price: Number(formData.get("price")),
        bottleSize: String(formData.get("bottleSize") || "").trim(),
        description: String(formData.get("description") || ""),
        image: String(formData.get("image") || "").trim(),
        galleryImages,
      });
      statusEl.textContent = "Saved.";
      statusEl.classList.add("is-success");
      await loadProducts();
    } catch (err) {
      statusEl.textContent = "Couldn't save changes. Please try again.";
      statusEl.classList.add("is-error");
      submitBtn.disabled = false;
    }
  });

  return panel;
}

// Wires a single file input to upload straight to Firebase Storage and hand
// the resulting URL to onUploaded — the URL still only lands in the actual
// product doc when the form's own "Save changes" is submitted.
function wireImageUpload({ panel, productId, fileInputSelector, statusSelector, onUploaded }) {
  const fileInput = panel.querySelector(fileInputSelector);
  const statusEl = panel.querySelector(statusSelector);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    fileInput.disabled = true;
    statusEl.textContent = "Uploading…";
    statusEl.classList.remove("is-error", "is-success");

    try {
      const url = await uploadProductImage(productId, file);
      onUploaded(url);
      statusEl.textContent = "Uploaded — click Save changes to apply.";
      statusEl.classList.add("is-success");
    } catch (err) {
      statusEl.textContent = "Couldn't upload that image. Please try again.";
      statusEl.classList.add("is-error");
    } finally {
      fileInput.disabled = false;
      fileInput.value = "";
    }
  });
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
