// Hayst Kopi — Checkout (Phase 5).
//
// TRUST BOUNDARY: everything computed on this page — quantity, unit price,
// subtotal, delivery fee, total — is client-side state for DISPLAY only.
// The actual order is created by POSTing to /.netlify/functions/create-order,
// which re-fetches the product fresh from Firestore and recomputes price,
// subtotal, delivery fee, and total itself inside a transaction. This page
// never sends price/subtotal/total to that endpoint, and the endpoint
// ignores those fields even if a tampered client sent them anyway.

import { fetchProductBySlug, isInStock } from "./firebase/products-helpers.js";
import { createPlaceAutocomplete } from "./places-autocomplete.js";
import { GOOGLE_PLACES_BROWSER_KEY } from "./places-config.js";

document.addEventListener("DOMContentLoaded", async () => {

  const loadingEl = document.getElementById("checkoutLoading");
  const errorEl = document.getElementById("checkoutError");
  const errorMessageEl = document.getElementById("checkoutErrorMessage");
  const contentEl = document.getElementById("checkoutContent");

  const form = document.getElementById("checkoutForm");
  const fullNameInput = document.getElementById("fullName");
  const mobileNumberInput = document.getElementById("mobileNumber");
  const emailInput = document.getElementById("email");
  const orderNotesInput = document.getElementById("orderNotes");

  const pickupPanel = document.getElementById("pickupPanel");
  const deliveryPanel = document.getElementById("deliveryPanel");

  const deliveryAreaRosewoodPanel = document.getElementById("deliveryAreaRosewood");
  const deliveryAreaAcaciaPanel = document.getElementById("deliveryAreaAcacia");
  const deliveryAreaExternalPanel = document.getElementById("deliveryAreaExternal");

  const rosewoodBuildingInput = document.getElementById("rosewoodBuilding");
  const rosewoodUnitInput = document.getElementById("rosewoodUnit");
  const rosewoodInstructionsInput = document.getElementById("rosewoodInstructions");

  const acaciaAddressInput = document.getElementById("acaciaAddress");
  const acaciaBarangayInput = document.getElementById("acaciaBarangay");
  const acaciaLandmarkInput = document.getElementById("acaciaLandmark");
  const acaciaInstructionsInput = document.getElementById("acaciaInstructions");

  const externalPlaceSearchInput = document.getElementById("externalPlaceSearch");
  const externalPlaceSuggestions = document.getElementById("externalPlaceSuggestions");
  const externalSelectedPlaceBox = document.getElementById("externalSelectedPlace");
  const externalSelectedPlaceText = document.getElementById("externalSelectedPlaceText");
  const externalUnitDetailsInput = document.getElementById("externalUnitDetails");
  const externalInstructionsInput = document.getElementById("externalInstructions");

  // Set only once the customer selects a real Google Places suggestion —
  // never from typed text alone. Any edit to the search field after a
  // selection clears this back to null (see the autocomplete's
  // onInvalidate below), which is also what blocks "Calculate Delivery"
  // and final submit until a fresh selection is made.
  let selectedExternalPlace = null;

  const calculateDeliveryBtn = document.getElementById("calculateDeliveryBtn");
  const deliveryCalcState = document.getElementById("deliveryCalcState");

  const gcashPanel = document.getElementById("gcashPanel");
  const bankPanel = document.getElementById("bankPanel");

  const placeOrderBtn = document.getElementById("placeOrderBtn");
  const placeOrderMessage = document.getElementById("placeOrderMessage");

  const summaryImage = document.getElementById("summaryImage");
  const summaryName = document.getElementById("summaryName");
  const summaryBottle = document.getElementById("summaryBottle");
  const summaryQtyValue = document.getElementById("summaryQtyValue");
  const summaryQtyDec = document.getElementById("summaryQtyDec");
  const summaryQtyInc = document.getElementById("summaryQtyInc");
  const summaryQtyLimitMessage = document.getElementById("summaryQtyLimitMessage");
  const summaryUnitPrice = document.getElementById("summaryUnitPrice");
  const summarySubtotal = document.getElementById("summarySubtotal");
  const summaryDeliveryFee = document.getElementById("summaryDeliveryFee");
  const summaryTotal = document.getElementById("summaryTotal");

  let product = null;
  let quantity = 1;

  // Live from /.netlify/functions/get-storefront-settings — never the old
  // static checkout-config.js placeholders (removed in Phase 9). Display
  // gating only: create-order.js independently re-checks every one of
  // these against current Firestore settings before creating an order, so
  // a customer with a stale page open can never bypass a setting the Owner
  // changed after this fetch.
  let storefrontSettings = null;

  // The last live result from /.netlify/functions/calculate-delivery for
  // the CURRENTLY selected area/address — null whenever it needs
  // (re)calculating. { area, available, deliveryFee, distanceKm, label } or
  // null. create-order.js recomputes this independently regardless; this is
  // purely what the summary displays and what gates the Place Order button.
  let deliveryCalculation = null;

  // Stable for the whole page load — reused across retry attempts of the
  // SAME logical submission so the backend can recognize a resubmission
  // (double-click, network retry) instead of creating a second order.
  const clientRequestId = generateRequestId();

  /* ---------- Helpers ---------- */

  function formatPeso(amount) {
    return `₱${Number(amount).toFixed(2)}`;
  }

  function generateRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    // Fallback UUID v4 for older browsers without crypto.randomUUID.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = window.crypto.getRandomValues(new Uint8Array(1))[0] % 16;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function showError(message) {
    loadingEl.hidden = true;
    contentEl.hidden = true;
    errorMessageEl.textContent = message;
    errorEl.hidden = false;
  }

  function getSelectedValue(groupName) {
    const checked = document.querySelector(`input[name="${groupName}"]:checked`);
    return checked ? checked.value : null;
  }

  function wireOptionGroup(groupName, onChange) {
    const inputs = document.querySelectorAll(`input[name="${groupName}"]`);
    inputs.forEach((input) => {
      input.addEventListener("change", () => {
        inputs.forEach((i) => i.closest(".option-card").classList.toggle("is-selected", i.checked));
        onChange();
      });
    });
  }

  /* ---------- Fulfillment / payment panel toggling ---------- */

  // A payment method must match the selected fulfillment (Cash on Pickup
  // only for Pickup, Cash on Delivery only for Delivery) AND be currently
  // enabled in settings/payments. Fails OPEN (allowed) if settings haven't
  // loaded yet — display-only; create-order.js is the real gate regardless.
  function isPaymentOptionAllowed(value, fulfillment) {
    const payment = storefrontSettings && storefrontSettings.payment;
    if (!payment) return true;

    if (value === "gcash") return Boolean(payment.gcash && payment.gcash.enabled);
    if (value === "bank-transfer") return Boolean(payment.bankTransfer && payment.bankTransfer.enabled);
    if (value === "cash-on-pickup") return fulfillment === "pickup" && Boolean(payment.cashOnPickup && payment.cashOnPickup.enabled);
    if (value === "cash-on-delivery") return fulfillment === "delivery" && Boolean(payment.cashOnDelivery && payment.cashOnDelivery.enabled);
    return false;
  }

  function updatePaymentAvailability(fulfillment) {
    ["gcash", "bank-transfer", "cash-on-pickup", "cash-on-delivery"].forEach((value) => {
      const card = document.querySelector(`[data-payment-option="${value}"]`);
      if (!card) return;

      const allowed = isPaymentOptionAllowed(value, fulfillment);
      card.hidden = !allowed;

      const input = card.querySelector("input");
      if (!allowed && input.checked) {
        input.checked = false;
        card.classList.remove("is-selected");
      }
    });

    updatePaymentPanels();
  }

  function updatePaymentPanels() {
    const value = getSelectedValue("paymentMethod");
    gcashPanel.hidden = value !== "gcash";
    bankPanel.hidden = value !== "bank-transfer";
  }

  function clearDeliveryCalculation() {
    deliveryCalculation = null;
    deliveryCalcState.hidden = true;
    deliveryCalcState.textContent = "";
    deliveryCalcState.classList.remove("is-loading", "is-error");
    setFieldError("deliveryCalculation", "");
  }

  // Called once after storefront settings load — hides fulfillment/
  // delivery-area option cards the Owner has disabled, and re-selects a
  // sensible default if the current selection just got hidden. This runs
  // ONCE (not on every change), unlike updatePaymentAvailability which
  // re-evaluates on every fulfillment change.
  function applyStorefrontSettingsToUI() {
    if (!storefrontSettings) return;

    const pickupInput = document.querySelector('input[name="fulfillment"][value="pickup"]');
    const deliveryInput = document.querySelector('input[name="fulfillment"][value="delivery"]');
    const pickupCard = pickupInput.closest(".option-card");
    const deliveryCard = deliveryInput.closest(".option-card");

    pickupCard.hidden = !storefrontSettings.pickup.enabled;
    deliveryCard.hidden = !storefrontSettings.delivery.enabled;

    if (!storefrontSettings.pickup.enabled && storefrontSettings.delivery.enabled) {
      deliveryInput.checked = true;
    } else if (storefrontSettings.pickup.enabled && !storefrontSettings.delivery.enabled) {
      pickupInput.checked = true;
    }
    document.querySelectorAll('input[name="fulfillment"]').forEach((input) => {
      input.closest(".option-card").classList.toggle("is-selected", input.checked);
    });

    const rosewoodCard = document.querySelector('[data-delivery-area-option="rosewood"]');
    const acaciaCard = document.querySelector('[data-delivery-area-option="acacia"]');
    const externalCard = document.querySelector('[data-delivery-area-option="external"]');
    rosewoodCard.hidden = !storefrontSettings.delivery.rosewood.enabled;
    acaciaCard.hidden = !storefrontSettings.delivery.acacia.enabled;
    externalCard.hidden = !storefrontSettings.delivery.external.enabled;
  }

  function updateDeliveryAreaPanels() {
    const area = getSelectedValue("deliveryArea");
    deliveryAreaRosewoodPanel.hidden = area !== "rosewood";
    deliveryAreaAcaciaPanel.hidden = area !== "acacia";
    deliveryAreaExternalPanel.hidden = area !== "external";

    clearDeliveryCalculation();

    // Rosewood/Acacia are cheap (no maps call — just a Firestore settings
    // read), so calculate immediately rather than waiting on a button.
    // External is the one that costs a real Distance Matrix API call, so it
    // only calculates on an explicit click — see the "Calculate Delivery"
    // button handler below.
    if (area === "rosewood" || area === "acacia") {
      calculateDelivery(area, {});
    }

    renderSummary();
  }

  function updateFulfillmentPanels() {
    const value = getSelectedValue("fulfillment");
    pickupPanel.hidden = value !== "pickup";
    deliveryPanel.hidden = value !== "delivery";
    updatePaymentAvailability(value);
    if (value !== "delivery") clearDeliveryCalculation();
    renderSummary();
  }

  /* ---------- Delivery calculation (live, server-authoritative estimate) ---------- */

  // Calls the SAME resolveDelivery() logic create-order.js will call again
  // at final submit — this is a live estimate for display, not a value the
  // backend will ever trust just because this endpoint returned it.
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
      deliveryCalculation = null;
      deliveryCalcState.classList.remove("is-loading");
      deliveryCalcState.classList.add("is-error");
      deliveryCalcState.textContent = "We couldn't calculate delivery right now. Please try again.";
      renderSummary();
      return;
    }

    deliveryCalcState.classList.remove("is-loading");

    if (!result || !result.available) {
      deliveryCalculation = null;
      deliveryCalcState.classList.add("is-error");
      deliveryCalcState.textContent = (result && result.message) || "We couldn't calculate delivery right now. Please try again.";
      renderSummary();
      return;
    }

    deliveryCalculation = {
      area,
      deliveryFee: result.deliveryFee,
      distanceKm: result.distanceKm,
    };

    deliveryCalcState.textContent = result.distanceKm != null
      ? `Distance: ${result.distanceKm} km — Delivery Fee: ${formatPeso(result.deliveryFee)}`
      : (result.deliveryFee === 0 ? "FREE DELIVERY" : `Delivery Fee: ${formatPeso(result.deliveryFee)}`);

    renderSummary();
  }

  calculateDeliveryBtn.addEventListener("click", () => {
    setFieldError("deliveryAddress", "");

    if (!selectedExternalPlace) {
      setFieldError("deliveryAddress", "Please select an address from the suggestions.");
      return;
    }

    calculateDelivery("external", {
      placeId: selectedExternalPlace.placeId,
      formattedAddress: selectedExternalPlace.formattedAddress,
      latitude: selectedExternalPlace.lat,
      longitude: selectedExternalPlace.lng,
    });
  });

  function invalidateExternalPlace(message) {
    selectedExternalPlace = null;
    externalSelectedPlaceBox.hidden = true;
    externalSelectedPlaceText.textContent = "";
    // Unconditional — a FAILED calculation already leaves deliveryCalculation
    // null while deliveryCalcState is still visibly showing the old error
    // banner (see calculateDelivery()'s !result.available branch). Gating
    // this on `deliveryCalculation` truthiness left that stale banner on
    // screen after editing/reselecting the address, misleadingly implying
    // a brand-new address was also out of range before it had ever been
    // calculated. Found via live production testing (2026-10-03).
    clearDeliveryCalculation();
    if (message) setFieldError("deliveryAddress", message);
  }

  createPlaceAutocomplete({
    inputEl: externalPlaceSearchInput,
    suggestionsEl: externalPlaceSuggestions,
    apiKey: GOOGLE_PLACES_BROWSER_KEY,
    onSelect: (place) => {
      setFieldError("deliveryAddress", "");
      selectedExternalPlace = place;
      externalSelectedPlaceText.textContent = place.formattedAddress;
      externalSelectedPlaceBox.hidden = false;
      if (deliveryCalculation) clearDeliveryCalculation();
    },
    onInvalidate: invalidateExternalPlace,
  });

  /* ---------- Summary rendering ---------- */

  function renderSummary() {
    if (!product) return;

    const unitPrice = Number(product.price) || 0;
    const subtotal = unitPrice * quantity;
    const fulfillment = getSelectedValue("fulfillment");

    let fee = 0;
    let label = formatPeso(0);
    if (fulfillment === "delivery") {
      if (deliveryCalculation) {
        fee = deliveryCalculation.deliveryFee;
        label = fee === 0 ? "FREE DELIVERY" : formatPeso(fee);
      } else {
        label = "Calculate delivery to see fee";
      }
    }

    const total = subtotal + fee;

    summaryUnitPrice.textContent = formatPeso(unitPrice);
    summarySubtotal.textContent = formatPeso(subtotal);
    summaryDeliveryFee.textContent = label;
    summaryTotal.textContent = formatPeso(total);
    summaryQtyValue.textContent = String(quantity);

    const max = product.inventory || 0;
    summaryQtyDec.disabled = quantity <= 1;
    summaryQtyInc.disabled = quantity >= max;
  }

  function showQtyLimitMessage(max) {
    summaryQtyLimitMessage.textContent = `Only ${max} bottle${max === 1 ? "" : "s"} available.`;
    summaryQtyLimitMessage.hidden = false;
  }

  function hideQtyLimitMessage() {
    summaryQtyLimitMessage.hidden = true;
    summaryQtyLimitMessage.textContent = "";
  }

  /* ---------- Validation ---------- */

  function setFieldError(name, message) {
    const errorNode = document.querySelector(`[data-error-for="${name}"]`);
    if (!errorNode) return;
    errorNode.textContent = message || "";
    errorNode.hidden = !message;
    const field = errorNode.closest(".field");
    if (field) field.classList.toggle("has-error", Boolean(message));
  }

  function clearAllErrors() {
    document.querySelectorAll(".field-error").forEach((node) => {
      node.hidden = true;
      node.textContent = "";
    });
    document.querySelectorAll(".field.has-error").forEach((field) => {
      field.classList.remove("has-error");
    });
  }

  function isValidPhMobile(value) {
    const cleaned = value.replace(/[\s-]/g, "");
    return /^(09\d{9}|\+639\d{9})$/.test(cleaned);
  }

  /* ---------- Wiring ---------- */

  summaryQtyDec.addEventListener("click", () => {
    if (quantity <= 1) return;
    quantity -= 1;
    hideQtyLimitMessage();
    renderSummary();
  });

  summaryQtyInc.addEventListener("click", () => {
    const max = product.inventory || 0;
    if (quantity >= max) {
      showQtyLimitMessage(max);
      return;
    }
    quantity += 1;
    hideQtyLimitMessage();
    renderSummary();
  });

  wireOptionGroup("fulfillment", updateFulfillmentPanels);
  wireOptionGroup("paymentMethod", updatePaymentPanels);
  wireOptionGroup("deliveryArea", updateDeliveryAreaPanels);

  function setPlaceOrderMessage(message, isError) {
    placeOrderMessage.textContent = message;
    placeOrderMessage.classList.toggle("is-error", Boolean(isError));
    placeOrderMessage.hidden = !message;
  }

  function resetPlaceOrderButton() {
    placeOrderBtn.disabled = false;
    placeOrderBtn.textContent = "Place Order";
  }

  // Maps backend fieldErrors keys to this form's actual input names.
  // "addressLine" is ambiguous server-side (acacia is the only area left
  // using that concept now that external uses a single selected-place
  // field instead) — resolved using whichever delivery area is currently
  // selected, since only one area's fields are ever visible at submit time.
  function mapServerFieldToFormField(serverField) {
    const staticMap = {
      fullName: "fullName",
      mobile: "mobileNumber",
      email: "email",
      fulfillment: "fulfillment",
      deliveryArea: "deliveryArea",
      paymentMethod: "paymentMethod",
      building: "building",
      unitNumber: "unitNumber",
      deliveryAddress: "deliveryAddress",
    };
    if (staticMap[serverField]) return staticMap[serverField];

    if (serverField === "addressLine") {
      return "acaciaAddressLine";
    }

    return null;
  }

  // Builds the deliveryAddress payload shape for whichever area is selected
  // — the backend validates/expects a different field set per area (see
  // netlify/functions/lib/validate-order.js).
  function buildDeliveryAddressPayload(deliveryArea) {
    if (deliveryArea === "rosewood") {
      return {
        building: rosewoodBuildingInput.value.trim(),
        unitNumber: rosewoodUnitInput.value.trim(),
        instructions: rosewoodInstructionsInput.value.trim(),
      };
    }
    if (deliveryArea === "acacia") {
      return {
        addressLine: acaciaAddressInput.value.trim(),
        barangay: acaciaBarangayInput.value.trim(),
        landmark: acaciaLandmarkInput.value.trim(),
        instructions: acaciaInstructionsInput.value.trim(),
      };
    }
    if (deliveryArea === "external") {
      if (!selectedExternalPlace) return null;
      return {
        formattedAddress: selectedExternalPlace.formattedAddress,
        placeId: selectedExternalPlace.placeId,
        latitude: selectedExternalPlace.lat,
        longitude: selectedExternalPlace.lng,
        unitDetails: externalUnitDetailsInput.value.trim(),
        instructions: externalInstructionsInput.value.trim(),
      };
    }
    return null;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAllErrors();
    setPlaceOrderMessage("", false);

    let valid = true;

    if (!fullNameInput.value.trim()) {
      setFieldError("fullName", "Please enter your full name.");
      valid = false;
    }

    if (!isValidPhMobile(mobileNumberInput.value.trim())) {
      setFieldError("mobileNumber", "Enter a valid mobile number (e.g. 09171234567).");
      valid = false;
    }

    const fulfillment = getSelectedValue("fulfillment");
    if (!fulfillment) {
      setFieldError("fulfillment", "Please choose Pickup or Delivery.");
      valid = false;
    }

    const deliveryArea = getSelectedValue("deliveryArea");

    if (fulfillment === "delivery") {
      if (!deliveryArea) {
        setFieldError("deliveryArea", "Please choose a delivery area.");
        valid = false;
      } else if (deliveryArea === "rosewood") {
        if (!rosewoodBuildingInput.value.trim()) {
          setFieldError("building", "Building/Tower is required.");
          valid = false;
        }
        if (!rosewoodUnitInput.value.trim()) {
          setFieldError("unitNumber", "Unit number is required.");
          valid = false;
        }
      } else if (deliveryArea === "acacia") {
        if (!acaciaAddressInput.value.trim()) {
          setFieldError("acaciaAddressLine", "Address/Building/Cluster is required.");
          valid = false;
        }
      } else if (deliveryArea === "external") {
        if (!selectedExternalPlace) {
          setFieldError("deliveryAddress", "Please select an address from the suggestions.");
          valid = false;
        }
      }

      // The displayed fee must come from a live calculation for THIS area —
      // never let the customer submit with no fee calculated, or with a
      // stale one left over from a different area/address.
      if (!deliveryCalculation || deliveryCalculation.area !== deliveryArea) {
        setFieldError("deliveryCalculation", "Please calculate delivery before placing your order.");
        valid = false;
      }
    }

    const paymentMethod = getSelectedValue("paymentMethod");
    if (!paymentMethod) {
      setFieldError("paymentMethod", "Please choose a payment method.");
      valid = false;
    }

    // Defensive re-check — the stepper UI already prevents this, but the
    // real gate is server-side regardless of what this line does.
    if (!product || quantity < 1 || quantity > (product.inventory || 0)) {
      valid = false;
    }

    if (!valid) return;

    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = "Placing order…";

    const requestBody = {
      productId: product.id,
      quantity,
      customer: {
        fullName: fullNameInput.value.trim(),
        mobile: mobileNumberInput.value.trim(),
        email: emailInput.value.trim() || null,
      },
      fulfillment,
      deliveryArea: fulfillment === "delivery" ? deliveryArea : null,
      deliveryAddress: fulfillment === "delivery" ? buildDeliveryAddressPayload(deliveryArea) : null,
      paymentMethod,
      customerNotes: orderNotesInput.value.trim(),
      clientRequestId,
    };

    let response;
    let result;
    try {
      response = await fetch("/.netlify/functions/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      result = await response.json();
    } catch (err) {
      resetPlaceOrderButton();
      setPlaceOrderMessage("We couldn't place your order. Please check your connection and try again.", true);
      return;
    }

    if (!response.ok || !result || !result.success) {
      resetPlaceOrderButton();

      if (result && result.fieldErrors) {
        Object.entries(result.fieldErrors).forEach(([serverField, message]) => {
          const formField = mapServerFieldToFormField(serverField);
          if (formField) setFieldError(formField, message);
        });
      }

      const message = (result && result.message) || "We couldn't place your order. Please try again.";
      setPlaceOrderMessage(message, true);
      return;
    }

    // Hand safe, minimal confirmation data to the next page via
    // sessionStorage — not localStorage, and never the raw form fields.
    // paymentUploadToken is the ONE-TIME plaintext order-upload
    // authorization (see netlify/functions/lib/payment-upload-token.js) —
    // present only for gcash/bank-transfer orders, null for cash methods.
    sessionStorage.setItem("lastOrderConfirmation", JSON.stringify({
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      customerName: result.customerName,
      productName: result.productName,
      quantity: result.quantity,
      total: result.total,
      fulfillmentMethod: result.fulfillmentMethod,
      paymentMethod: result.paymentMethod,
      orderStatus: result.orderStatus,
      paymentUploadToken: result.paymentUploadToken || null,
      paymentInstructions: result.paymentInstructions || null,
    }));

    window.location.href = "order-confirmation.html";
  });

  /* ---------- Load storefront settings + product, fresh, before anything renders ---------- */

  try {
    const settingsResponse = await fetch("/.netlify/functions/get-storefront-settings", { method: "POST" });
    const settingsResult = await settingsResponse.json();
    storefrontSettings = settingsResult && settingsResult.success ? settingsResult : null;
  } catch (err) {
    storefrontSettings = null;
  }

  // Fail-closed, same as the backend: if settings couldn't be loaded, or
  // the Owner has ordering switched off, checkout must not proceed —
  // create-order.js would reject it anyway, so don't let a customer fill
  // out the whole form first only to be rejected at the end.
  if (!storefrontSettings || !storefrontSettings.acceptingOrders) {
    showError("We're currently not accepting orders. Please check back soon.");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const slug = params.get("product");

  if (!slug) {
    showError("We couldn't find that product.");
    return;
  }

  let fetched;
  try {
    fetched = await fetchProductBySlug(slug);
  } catch (err) {
    showError("We couldn't load your order right now. Please try again.");
    return;
  }

  if (!fetched) {
    showError("We couldn't find that product.");
    return;
  }

  if (!isInStock(fetched)) {
    showError("This product is currently unavailable.");
    return;
  }

  product = fetched;

  const rawQty = parseInt(params.get("qty"), 10);
  let initialQty = Number.isFinite(rawQty) && rawQty >= 1 ? rawQty : 1;
  let wasClamped = false;
  if (initialQty > product.inventory) {
    initialQty = product.inventory;
    wasClamped = true;
  }
  quantity = initialQty;

  summaryImage.src = product.image || (product.galleryImages || [])[0] || "";
  summaryImage.alt = product.name || "";
  summaryName.textContent = product.name || "";
  summaryBottle.textContent = product.bottleSize || "";

  document.getElementById("pickupAddress").textContent = storefrontSettings.pickup.address || "[Pickup address not yet configured]";
  document.getElementById("pickupHours").textContent = storefrontSettings.pickup.hours || "[Pickup hours not yet configured]";
  document.getElementById("pickupInstructions").textContent = storefrontSettings.pickup.instructions || "";

  document.getElementById("gcashAccountName").textContent = storefrontSettings.payment.gcash.accountName || "—";
  document.getElementById("gcashNumber").textContent = storefrontSettings.payment.gcash.number || "—";
  document.getElementById("bankName").textContent = storefrontSettings.payment.bankTransfer.bankName || "—";
  document.getElementById("bankAccountName").textContent = storefrontSettings.payment.bankTransfer.accountName || "—";
  document.getElementById("bankAccountNumber").textContent = storefrontSettings.payment.bankTransfer.accountNumber || "—";

  applyStorefrontSettingsToUI();
  updateFulfillmentPanels(); // also renders the summary once

  if (wasClamped) showQtyLimitMessage(product.inventory);

  loadingEl.hidden = true;
  contentEl.hidden = false;

});
