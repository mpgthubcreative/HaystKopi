// Shared payment-proof upload/OCR/confirm UI — the exact same flow used
// right after checkout (order-confirmation.js) and when resuming payment
// later (order-status.js). Both pages carry the identical HTML block
// (#paymentSection and its children) so this one module can wire either
// one up without duplicating the upload/OCR/confirm logic twice.
//
// TRUST BOUNDARY: paymentReferenceDetected/paymentAmountMismatch/etc. all
// come FROM the backend response — this module never invents or locally
// computes any of them. The only thing the customer submits is their
// confirmed final reference string.

import { compressImage, blobToBase64 } from "./image-compress.js";

export function formatPeso(amount) {
  return `₱${Number(amount || 0).toFixed(2)}`;
}

export function formatPaymentMethod(value) {
  switch (value) {
    case "gcash": return "GCash";
    case "bank-transfer": return "Bank Transfer";
    case "cash-on-pickup": return "Cash on Pickup";
    case "cash-on-delivery": return "Cash on Delivery";
    default: return value || "";
  }
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_ORIGINAL_BYTES = 3 * 1024 * 1024;

// onConfirmed(result) fires after a successful confirm-payment-reference
// call — each page decides what to update in its own UI (order status
// text, etc.) rather than this shared module assuming a specific page shape.
export function initPaymentProofUI({ orderId, uploadToken, total, paymentMethod, paymentInstructions, onConfirmed }) {
  const section = document.getElementById("paymentSection");
  section.hidden = false;

  document.getElementById("payAmountDue").textContent = formatPeso(total);
  document.getElementById("payMethodLabel").textContent = formatPaymentMethod(paymentMethod);

  document.getElementById("payGcashDetails").hidden = true;
  document.getElementById("payBankDetails").hidden = true;
  document.getElementById("payGcashQr").hidden = true;

  if (paymentInstructions && paymentInstructions.method === "gcash") {
    document.getElementById("payGcashDetails").hidden = false;
    document.getElementById("payGcashAccountName").textContent = paymentInstructions.accountName || "—";
    document.getElementById("payGcashNumber").textContent = paymentInstructions.number || "—";
    if (paymentInstructions.qrImagePath) {
      const qr = document.getElementById("payGcashQr");
      qr.src = paymentInstructions.qrImagePath;
      qr.hidden = false;
    }
  } else if (paymentInstructions && paymentInstructions.method === "bank-transfer") {
    document.getElementById("payBankDetails").hidden = false;
    document.getElementById("payBankName").textContent = paymentInstructions.bankName || "—";
    document.getElementById("payBankAccountName").textContent = paymentInstructions.accountName || "—";
    document.getElementById("payBankAccountNumber").textContent = paymentInstructions.accountNumber || "—";
    if (paymentInstructions.qrImagePath) {
      const qr = document.getElementById("payBankQr");
      qr.src = paymentInstructions.qrImagePath;
      qr.hidden = false;
    }
  }

  const uploadStep = document.getElementById("payUploadStep");
  const referenceStep = document.getElementById("payReferenceStep");
  const doneStep = document.getElementById("payDoneStep");

  const fileInput = document.getElementById("payProofFile");
  const uploadBtn = document.getElementById("payUploadBtn");
  const uploadStateEl = document.getElementById("payUploadState");

  const referenceInput = document.getElementById("payReferenceInput");
  const confirmBtn = document.getElementById("payConfirmBtn");
  const confirmStateEl = document.getElementById("payConfirmState");
  const replaceBtn = document.getElementById("payReplaceBtn");
  const replaceAgainBtn = document.getElementById("payReplaceAgainBtn");

  function showStep(step) {
    uploadStep.hidden = step !== "upload";
    referenceStep.hidden = step !== "reference";
    doneStep.hidden = step !== "done";
  }

  function setState(el, message, variant) {
    el.textContent = message;
    el.hidden = !message;
    el.classList.remove("is-loading", "is-error");
    if (variant) el.classList.add(variant);
  }

  // Fresh listeners every call — initPaymentProofUI can be invoked more
  // than once per page load (e.g. order-status.js calling it only after a
  // successful resume-payment response), so stale handlers from a previous
  // call must not double-fire. Cloning the buttons is the simplest way to
  // drop any previously attached listeners.
  const freshUploadBtn = uploadBtn.cloneNode(true);
  uploadBtn.replaceWith(freshUploadBtn);
  const freshConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.replaceWith(freshConfirmBtn);
  const freshReplaceBtn = replaceBtn.cloneNode(true);
  replaceBtn.replaceWith(freshReplaceBtn);
  const freshReplaceAgainBtn = replaceAgainBtn.cloneNode(true);
  replaceAgainBtn.replaceWith(freshReplaceAgainBtn);

  freshUploadBtn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) {
      setState(uploadStateEl, "Please choose a screenshot first.", "is-error");
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setState(uploadStateEl, "Please upload a JPEG, PNG, or WEBP image.", "is-error");
      return;
    }
    if (file.size > MAX_ORIGINAL_BYTES) {
      setState(uploadStateEl, "That image is too large (max 3MB). Please try a smaller screenshot.", "is-error");
      return;
    }

    freshUploadBtn.disabled = true;
    setState(uploadStateEl, "Uploading payment proof…", "is-loading");

    let compressedBlob;
    try {
      compressedBlob = await compressImage(file);
    } catch (err) {
      freshUploadBtn.disabled = false;
      setState(uploadStateEl, "We couldn't process that image. Please try a different screenshot.", "is-error");
      return;
    }

    let imageBase64;
    try {
      imageBase64 = await blobToBase64(compressedBlob);
    } catch (err) {
      freshUploadBtn.disabled = false;
      setState(uploadStateEl, "We couldn't process that image. Please try a different screenshot.", "is-error");
      return;
    }

    let response;
    let result;
    try {
      response = await fetch("/.netlify/functions/upload-payment-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, uploadToken, imageBase64, mimeType: "image/webp" }),
      });
      result = await response.json();
    } catch (err) {
      freshUploadBtn.disabled = false;
      setState(uploadStateEl, "We couldn't upload your payment proof. Please check your connection and try again.", "is-error");
      return;
    }

    freshUploadBtn.disabled = false;

    if (!response.ok || !result || !result.success) {
      setState(uploadStateEl, (result && result.message) || "We couldn't upload your payment proof. Please try again.", "is-error");
      return;
    }

    setState(uploadStateEl, "", null);

    // OCR is best-effort — an empty/low-confidence result still lets the
    // customer complete the flow manually; it never blocks here.
    referenceInput.value = result.paymentReferenceDetected || "";
    if (!result.paymentReferenceDetected) {
      setState(confirmStateEl, "We couldn't automatically read the reference number. Please enter it below.", null);
    } else {
      setState(confirmStateEl, "", null);
    }

    showStep("reference");
  });

  freshConfirmBtn.addEventListener("click", async () => {
    const paymentReference = referenceInput.value.trim();
    if (!paymentReference) {
      setState(confirmStateEl, "Please enter your reference number.", "is-error");
      return;
    }

    freshConfirmBtn.disabled = true;
    setState(confirmStateEl, "Submitting…", "is-loading");

    let response;
    let result;
    try {
      response = await fetch("/.netlify/functions/confirm-payment-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, uploadToken, paymentReference }),
      });
      result = await response.json();
    } catch (err) {
      freshConfirmBtn.disabled = false;
      setState(confirmStateEl, "We couldn't confirm your payment details. Please check your connection and try again.", "is-error");
      return;
    }

    freshConfirmBtn.disabled = false;

    if (!response.ok || !result || !result.success) {
      setState(confirmStateEl, (result && result.message) || "We couldn't confirm your payment details. Please try again.", "is-error");
      return;
    }

    showStep("done");
    if (typeof onConfirmed === "function") onConfirmed(result);
  });

  freshReplaceBtn.addEventListener("click", () => {
    fileInput.value = "";
    setState(confirmStateEl, "", null);
    showStep("upload");
  });

  freshReplaceAgainBtn.addEventListener("click", () => {
    fileInput.value = "";
    referenceInput.value = "";
    setState(uploadStateEl, "", null);
    setState(confirmStateEl, "", null);
    showStep("upload");
  });

  showStep("upload");
}
