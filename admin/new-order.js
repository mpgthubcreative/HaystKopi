// "+ New Order" modal on admin/orders.html — lets OWNER/ADMIN record a sale
// that came in outside the website (Facebook, Instagram, Messenger, phone,
// walk-in). Submits to the secure create-admin-order endpoint (see
// order-actions.js -> netlify/functions/create-admin-order.js), which does
// all the real validation/inventory/pricing work; this module only collects
// the form and shows the server's response. The delivery-fee preview below
// is DISPLAY ONLY, exactly like checkout.js's — the backend independently
// recomputes it before the order is actually created.

import { fetchAllProducts } from "../firebase/products-helpers.js";
import { createPlaceAutocomplete } from "../places-autocomplete.js";
import { GOOGLE_PLACES_BROWSER_KEY } from "../places-config.js";
import { createAdminOrder } from "./order-actions.js";

const PAYMENT_METHODS_BY_FULFILLMENT = {
  pickup: [
    { value: "gcash", label: "GCash" },
    { value: "bank-transfer", label: "Bank Transfer" },
    { value: "cash-on-pickup", label: "Cash on Pickup" },
  ],
  delivery: [
    { value: "gcash", label: "GCash" },
    { value: "bank-transfer", label: "Bank Transfer" },
    { value: "cash-on-delivery", label: "Cash on Delivery" },
  ],
};

export function initNewOrderModal({ onCreated }) {
  const newOrderBtn = document.getElementById("newOrderBtn");
  const modal = document.getElementById("newOrderModal");
  const form = document.getElementById("newOrderForm");
  const cancelBtn = document.getElementById("noCancelBtn");
  const submitBtn = document.getElementById("noSubmitBtn");
  const formMessage = document.getElementById("noFormMessage");

  const customerNameInput = document.getElementById("noCustomerName");
  const mobileInput = document.getElementById("noMobile");
  const emailInput = document.getElementById("noEmail");
  const orderSourceSelect = document.getElementById("noOrderSource");
  const productSelect = document.getElementById("noProduct");
  const quantityInput = document.getElementById("noQuantity");
  const fulfillmentSelect = document.getElementById("noFulfillment");
  const paymentMethodSelect = document.getElementById("noPaymentMethod");
  const paymentStatusSelect = document.getElementById("noPaymentStatus");
  const customerNotesInput = document.getElementById("noCustomerNotes");
  const adminNotesInput = document.getElementById("noAdminNotes");

  const deliveryPanel = document.getElementById("noDeliveryPanel");
  const deliveryAreaSelect = document.getElementById("noDeliveryArea");
  const rosewoodFields = document.getElementById("noRosewoodFields");
  const rosewoodBuildingInput = document.getElementById("noRosewoodBuilding");
  const rosewoodUnitInput = document.getElementById("noRosewoodUnit");
  const acaciaFields = document.getElementById("noAcaciaFields");
  const acaciaAddressInput = document.getElementById("noAcaciaAddress");
  const acaciaBarangayInput = document.getElementById("noAcaciaBarangay");
  const externalFields = document.getElementById("noExternalFields");
  const placeSearchInput = document.getElementById("noPlaceSearch");
  const placeSuggestions = document.getElementById("noPlaceSuggestions");
  const selectedPlaceBox = document.getElementById("noSelectedPlace");
  const selectedPlaceText = document.getElementById("noSelectedPlaceText");
  const externalUnitDetailsInput = document.getElementById("noExternalUnitDetails");
  const deliveryCalcState = document.getElementById("noDeliveryCalcState");

  let products = null; // keyed by id, loaded lazily on first open
  let selectedPlace = null; // { placeId, formattedAddress, lat, lng } — null until a real suggestion is chosen
  let deliveryCalculation = null; // { area, deliveryFee } — display only, see module header

  function setFieldError(name, message) {
    const node = document.querySelector(`[data-error-for="${name}"]`);
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
    const field = node.closest(".field");
    if (field) field.classList.toggle("has-error", Boolean(message));
  }

  function clearAllErrors() {
    document.querySelectorAll("#newOrderForm .field-error").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    document.querySelectorAll("#newOrderForm .field.has-error").forEach((field) => {
      field.classList.remove("has-error");
    });
  }

  function setFormMessage(message, isError) {
    formMessage.textContent = message || "";
    formMessage.hidden = !message;
    formMessage.classList.toggle("is-error", Boolean(isError));
    formMessage.classList.toggle("is-success", !isError && Boolean(message));
  }

  function formatPeso(amount) {
    return `₱${Number(amount || 0).toFixed(2)}`;
  }

  function populatePaymentMethods() {
    const fulfillment = fulfillmentSelect.value === "delivery" ? "delivery" : "pickup";
    const options = PAYMENT_METHODS_BY_FULFILLMENT[fulfillment];
    const previous = paymentMethodSelect.value;
    paymentMethodSelect.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
    if (options.some((o) => o.value === previous)) paymentMethodSelect.value = previous;
  }

  function clearDeliveryCalculation() {
    deliveryCalculation = null;
    deliveryCalcState.hidden = true;
    deliveryCalcState.textContent = "";
    deliveryCalcState.classList.remove("is-loading", "is-error");
  }

  async function calculateDelivery(area, deliveryAddress) {
    deliveryCalcState.hidden = false;
    deliveryCalcState.classList.remove("is-error");
    deliveryCalcState.classList.add("is-loading");
    deliveryCalcState.textContent = "Calculating delivery…";

    let result;
    try {
      const response = await fetch("/.netlify/functions/calculate-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryArea: area, deliveryAddress }),
      });
      result = await response.json();
    } catch (err) {
      deliveryCalcState.classList.remove("is-loading");
      deliveryCalcState.classList.add("is-error");
      deliveryCalcState.textContent = "We couldn't calculate delivery right now.";
      return;
    }

    deliveryCalcState.classList.remove("is-loading");

    if (!result || !result.available) {
      deliveryCalculation = null;
      deliveryCalcState.classList.add("is-error");
      deliveryCalcState.textContent = (result && result.message) || "We couldn't calculate delivery right now.";
      return;
    }

    deliveryCalculation = { area, deliveryFee: result.deliveryFee };
    deliveryCalcState.textContent = result.distanceKm != null
      ? `Distance: ${result.distanceKm} km — Delivery Fee: ${formatPeso(result.deliveryFee)}`
      : (result.deliveryFee === 0 ? "FREE DELIVERY" : `Delivery Fee: ${formatPeso(result.deliveryFee)}`);
  }

  function invalidateSelectedPlace(message) {
    selectedPlace = null;
    selectedPlaceBox.hidden = true;
    selectedPlaceText.textContent = "";
    clearDeliveryCalculation();
    if (message) setFieldError("noDeliveryAddress", message);
  }

  const placeAutocomplete = createPlaceAutocomplete({
    inputEl: placeSearchInput,
    suggestionsEl: placeSuggestions,
    apiKey: GOOGLE_PLACES_BROWSER_KEY,
    onSelect: (place) => {
      setFieldError("noDeliveryAddress", "");
      selectedPlace = place;
      selectedPlaceText.textContent = place.formattedAddress;
      selectedPlaceBox.hidden = false;
      clearDeliveryCalculation();
      calculateDelivery("external", {
        placeId: place.placeId,
        formattedAddress: place.formattedAddress,
        latitude: place.lat,
        longitude: place.lng,
      });
    },
    onInvalidate: invalidateSelectedPlace,
  });

  function updateDeliveryAreaFields() {
    const area = deliveryAreaSelect.value;
    rosewoodFields.hidden = area !== "rosewood";
    acaciaFields.hidden = area !== "acacia";
    externalFields.hidden = area !== "external";
    clearDeliveryCalculation();

    if (area === "rosewood" || area === "acacia") {
      calculateDelivery(area, {});
    }
  }

  function updateFulfillmentFields() {
    const isDelivery = fulfillmentSelect.value === "delivery";
    deliveryPanel.hidden = !isDelivery;
    populatePaymentMethods();
    if (!isDelivery) {
      deliveryAreaSelect.value = "";
      updateDeliveryAreaFields();
    }
  }

  async function ensureProductsLoaded() {
    if (products) return;
    productSelect.innerHTML = `<option value="">Loading products…</option>`;
    try {
      products = await fetchAllProducts();
    } catch (err) {
      products = {};
      productSelect.innerHTML = `<option value="">Could not load products</option>`;
      return;
    }
    const entries = Object.values(products).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    productSelect.innerHTML = [`<option value="">Choose…</option>`]
      .concat(entries.map((p) => {
        const stock = Number(p.inventory) || 0;
        return `<option value="${p.id}" ${stock <= 0 ? "disabled" : ""}>${escapeHtml(p.name || p.id)} — ${formatPeso(p.price)} (${stock} in stock)</option>`;
      }))
      .join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function resetForm() {
    form.reset();
    clearAllErrors();
    setFormMessage("", false);
    quantityInput.value = "1";
    placeAutocomplete.reset();
    invalidateSelectedPlace(null);
    deliveryPanel.hidden = true;
    rosewoodFields.hidden = true;
    acaciaFields.hidden = true;
    externalFields.hidden = true;
    populatePaymentMethods();
  }

  async function openModal() {
    resetForm();
    modal.hidden = false;
    await ensureProductsLoaded();
  }

  function closeModal() {
    modal.hidden = true;
  }

  function isValidPhMobile(value) {
    return /^(09\d{9}|\+639\d{9})$/.test(value.replace(/[\s-]/g, ""));
  }

  function buildDeliveryAddressPayload(area) {
    if (area === "rosewood") {
      return { building: rosewoodBuildingInput.value.trim(), unitNumber: rosewoodUnitInput.value.trim(), instructions: "" };
    }
    if (area === "acacia") {
      return { addressLine: acaciaAddressInput.value.trim(), barangay: acaciaBarangayInput.value.trim(), landmark: "", instructions: "" };
    }
    if (area === "external") {
      if (!selectedPlace) return null;
      return {
        formattedAddress: selectedPlace.formattedAddress,
        placeId: selectedPlace.placeId,
        latitude: selectedPlace.lat,
        longitude: selectedPlace.lng,
        unitDetails: externalUnitDetailsInput.value.trim(),
        instructions: "",
      };
    }
    return null;
  }

  // Server fieldErrors keys -> this form's own ids, mirroring checkout.js's
  // mapServerFieldToFormField. "addressLine" is only ever acacia's concept
  // here since external uses the single selected-place field instead.
  function mapServerFieldToFormField(serverField) {
    const map = {
      customerName: "noCustomerName",
      mobile: "noMobile",
      email: "noEmail",
      orderSource: "noOrderSource",
      productId: "noProduct",
      quantity: "noQuantity",
      fulfillment: "noFulfillment",
      deliveryArea: "noDeliveryArea",
      building: "noBuilding",
      unitNumber: "noUnitNumber",
      deliveryAddress: "noDeliveryAddress",
      paymentMethod: "noPaymentMethod",
      paymentStatus: "noPaymentStatus",
    };
    if (map[serverField]) return map[serverField];
    if (serverField === "addressLine") return "noAcaciaAddressLine";
    return null;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearAllErrors();
    setFormMessage("", false);

    let valid = true;

    if (!customerNameInput.value.trim()) {
      setFieldError("noCustomerName", "Customer name is required.");
      valid = false;
    }
    if (!isValidPhMobile(mobileInput.value.trim())) {
      setFieldError("noMobile", "Enter a valid mobile number (e.g. 09171234567).");
      valid = false;
    }
    if (!orderSourceSelect.value) {
      setFieldError("noOrderSource", "Choose where this order came from.");
      valid = false;
    }
    if (!productSelect.value) {
      setFieldError("noProduct", "Choose a product.");
      valid = false;
    }
    const quantity = parseInt(quantityInput.value, 10);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setFieldError("noQuantity", "Enter a valid quantity.");
      valid = false;
    }

    const fulfillment = fulfillmentSelect.value;
    const deliveryArea = fulfillment === "delivery" ? deliveryAreaSelect.value : null;

    if (fulfillment === "delivery") {
      if (!deliveryArea) {
        setFieldError("noDeliveryArea", "Choose a delivery area.");
        valid = false;
      } else if (deliveryArea === "rosewood") {
        if (!rosewoodBuildingInput.value.trim()) { setFieldError("noBuilding", "Building/Tower is required."); valid = false; }
        if (!rosewoodUnitInput.value.trim()) { setFieldError("noUnitNumber", "Unit number is required."); valid = false; }
      } else if (deliveryArea === "acacia") {
        if (!acaciaAddressInput.value.trim()) { setFieldError("noAcaciaAddressLine", "Address/Building/Cluster is required."); valid = false; }
      } else if (deliveryArea === "external") {
        if (!selectedPlace) { setFieldError("noDeliveryAddress", "Please select an address from the suggestions."); valid = false; }
      }
    }

    if (!paymentMethodSelect.value) {
      setFieldError("noPaymentMethod", "Choose a payment method.");
      valid = false;
    }
    if (!paymentStatusSelect.value) {
      setFieldError("noPaymentStatus", "Choose a payment status.");
      valid = false;
    }

    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating…";

    const { ok, result } = await createAdminOrder({
      customerName: customerNameInput.value.trim(),
      mobile: mobileInput.value.trim(),
      email: emailInput.value.trim() || null,
      orderSource: orderSourceSelect.value,
      productId: productSelect.value,
      quantity,
      fulfillment,
      deliveryArea,
      deliveryAddress: fulfillment === "delivery" ? buildDeliveryAddressPayload(deliveryArea) : null,
      paymentMethod: paymentMethodSelect.value,
      paymentStatus: paymentStatusSelect.value,
      customerNotes: customerNotesInput.value.trim(),
      adminNotes: adminNotesInput.value.trim(),
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Create Order";

    if (!ok) {
      if (result && result.fieldErrors) {
        Object.entries(result.fieldErrors).forEach(([serverField, message]) => {
          const formField = mapServerFieldToFormField(serverField);
          if (formField) setFieldError(formField, message);
        });
      }
      setFormMessage((result && result.message) || "This order could not be created.", true);
      return;
    }

    closeModal();
    if (typeof onCreated === "function") onCreated(result);
  }

  newOrderBtn.addEventListener("click", openModal);
  cancelBtn.addEventListener("click", closeModal);
  form.addEventListener("submit", handleSubmit);
  fulfillmentSelect.addEventListener("change", updateFulfillmentFields);
  deliveryAreaSelect.addEventListener("change", updateDeliveryAreaFields);

  populatePaymentMethods();
}
