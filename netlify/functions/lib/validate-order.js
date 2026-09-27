// Server-side validation for create-order — the actual enforcement point.
// checkout.js validates the same rules client-side for UX, but that is
// never trusted on its own; a request that skips the browser entirely must
// be rejected the same way a tampered one would be.
//
// This function only validates SHAPE (required fields per delivery area).
// It deliberately has no opinion on delivery fee, distance, or service-area
// limits — that's resolveDelivery()'s job (lib/delivery.js), called
// separately by create-order.js against trusted Firestore settings and a
// real driving-distance lookup, independent of anything the client sends.

const { PAYMENT_METHODS_BY_FULFILLMENT } = require("./config");

const MOBILE_PATTERN = /^(09\d{9}|\+639\d{9})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DELIVERY_AREAS = ["rosewood", "acacia", "external"];

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Returns { ok, errors, data }. `data` only ever contains fields this
// function itself derived/sanitized — it deliberately has no path for a
// client-sent price/subtotal/total to flow through.
function validateOrderInput(payload) {
  const errors = {};
  const body = payload && typeof payload === "object" ? payload : {};
  const customer = body.customer && typeof body.customer === "object" ? body.customer : {};
  const deliveryAddressRaw = body.deliveryAddress && typeof body.deliveryAddress === "object" ? body.deliveryAddress : {};

  const fullName = str(customer.fullName);
  if (!fullName) errors.fullName = "Full name is required.";

  const mobileCleaned = str(customer.mobile).replace(/[\s-]/g, "");
  if (!MOBILE_PATTERN.test(mobileCleaned)) {
    errors.mobile = "Enter a valid mobile number (e.g. 09171234567).";
  }

  const emailRaw = str(customer.email);
  if (emailRaw && !EMAIL_PATTERN.test(emailRaw)) {
    errors.email = "Enter a valid email address.";
  }

  const fulfillment = body.fulfillment === "pickup" || body.fulfillment === "delivery" ? body.fulfillment : null;
  if (!fulfillment) errors.fulfillment = "Choose Pickup or Delivery.";

  let deliveryArea = null;
  let deliveryAddress = null;

  if (fulfillment === "delivery") {
    deliveryArea = DELIVERY_AREAS.includes(body.deliveryArea) ? body.deliveryArea : null;
    if (!deliveryArea) errors.deliveryArea = "Choose a delivery area.";

    if (deliveryArea === "rosewood") {
      const building = str(deliveryAddressRaw.building);
      const unitNumber = str(deliveryAddressRaw.unitNumber);
      if (!building) errors.building = "Building/Tower is required.";
      if (!unitNumber) errors.unitNumber = "Unit number is required.";
      deliveryAddress = {
        building,
        unitNumber,
        instructions: str(deliveryAddressRaw.instructions),
      };
    } else if (deliveryArea === "acacia") {
      const addressLine = str(deliveryAddressRaw.addressLine);
      if (!addressLine) errors.addressLine = "Address/Building/Cluster is required.";
      deliveryAddress = {
        addressLine,
        barangay: str(deliveryAddressRaw.barangay),
        landmark: str(deliveryAddressRaw.landmark),
        instructions: str(deliveryAddressRaw.instructions),
      };
    } else if (deliveryArea === "external") {
      const addressLine = str(deliveryAddressRaw.addressLine);
      const barangay = str(deliveryAddressRaw.barangay);
      const city = str(deliveryAddressRaw.city);
      if (!addressLine) errors.addressLine = "Address is required.";
      if (!barangay) errors.barangay = "Barangay is required.";
      if (!city) errors.city = "City/Municipality is required.";
      deliveryAddress = {
        addressLine,
        barangay,
        city,
        landmark: str(deliveryAddressRaw.landmark),
        instructions: str(deliveryAddressRaw.instructions),
      };
    }
    // deliveryArea === null (invalid/missing) falls through with no address
    // validation — the deliveryArea error above is enough to reject the
    // request; we don't also need to guess at address shape.
  }

  const allowedPayments = fulfillment ? PAYMENT_METHODS_BY_FULFILLMENT[fulfillment] : [];
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : null;
  if (!paymentMethod || !allowedPayments.includes(paymentMethod)) {
    errors.paymentMethod = "Choose a valid payment method for your selected fulfillment.";
  }

  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    errors.quantity = "Invalid quantity.";
  }

  const productId = str(body.productId);
  if (!productId) errors.productId = "Missing product.";

  const clientRequestId = str(body.clientRequestId);
  if (!UUID_PATTERN.test(clientRequestId)) {
    errors.clientRequestId = "Invalid request.";
  }

  const customerNotes = str(body.customerNotes).slice(0, 500);

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: {
      fullName,
      mobile: mobileCleaned,
      email: emailRaw || null,
      fulfillment,
      deliveryArea,
      deliveryAddress,
      paymentMethod,
      quantity,
      productId,
      clientRequestId,
      customerNotes,
    },
  };
}

module.exports = { validateOrderInput };
