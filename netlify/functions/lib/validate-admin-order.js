// Server-side validation for create-admin-order — a staff-entered order
// (Facebook, Instagram, Messenger, Phone, Walk-in, Manual/Other) placed by
// an active OWNER/ADMIN for a sale that happened outside the website.
//
// Reuses the exact same mobile/email patterns and per-area delivery-address
// rules as validateOrderInput (lib/validate-order.js) — a manual order's
// delivery address must satisfy the same shape rules a website order's
// would, so there is exactly one definition of "what a rosewood/acacia/
// external address must contain," per the project's no-duplicate-business-
// logic rule.
//
// This function only validates SHAPE. It has no opinion on delivery fee,
// distance, inventory, or order numbering — those stay in lib/delivery.js's
// resolveDelivery() and lib/order-transaction.js's commitOrderInTransaction(),
// called by create-admin-order.js itself, identically to create-order.js.

const { PAYMENT_METHODS_BY_FULFILLMENT } = require("./config");
const { MOBILE_PATTERN, EMAIL_PATTERN, str, validateDeliveryAreaAndAddress } = require("./validate-order");
const { ORDER_SOURCE_VALUES } = require("./order-source");

// Deliberately narrower than order-status.js's PAYMENT_STATUS_VALUES — a
// manual order is never created as already REFUNDED; that status only ever
// makes sense after a real order has existed and been paid first.
const ADMIN_PAYMENT_STATUS_VALUES = ["UNPAID", "AWAITING_VERIFICATION", "PAID"];

function validateAdminOrderInput(payload) {
  const errors = {};
  const body = payload && typeof payload === "object" ? payload : {};
  const deliveryAddressRaw = body.deliveryAddress && typeof body.deliveryAddress === "object" ? body.deliveryAddress : {};

  const customerName = str(body.customerName);
  if (!customerName) errors.customerName = "Customer name is required.";

  const mobileCleaned = str(body.mobile).replace(/[\s-]/g, "");
  if (!MOBILE_PATTERN.test(mobileCleaned)) {
    errors.mobile = "Enter a valid mobile number (e.g. 09171234567).";
  }

  const emailRaw = str(body.email);
  if (emailRaw && !EMAIL_PATTERN.test(emailRaw)) {
    errors.email = "Enter a valid email address.";
  }

  const orderSource = ORDER_SOURCE_VALUES.includes(body.orderSource) ? body.orderSource : null;
  if (!orderSource) errors.orderSource = "Choose where this order came from.";
  if (orderSource === "website") {
    // "website" is reserved for real checkout submissions (see
    // lib/order-transaction.js) — a staff member recording an outside
    // sale can never claim it came through the website itself.
    errors.orderSource = "Choose a source other than Website for a manually entered order.";
  }

  const productId = str(body.productId);
  if (!productId) errors.productId = "Choose a product.";

  const quantity = Number(body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    errors.quantity = "Invalid quantity.";
  }

  const fulfillment = body.fulfillment === "pickup" || body.fulfillment === "delivery" ? body.fulfillment : null;
  if (!fulfillment) errors.fulfillment = "Choose Pickup or Delivery.";

  const addressResult = validateDeliveryAreaAndAddress(fulfillment, body.deliveryArea, deliveryAddressRaw);
  Object.assign(errors, addressResult.errors);
  const { deliveryArea, deliveryAddress } = addressResult;

  const allowedPayments = fulfillment ? PAYMENT_METHODS_BY_FULFILLMENT[fulfillment] : [];
  const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : null;
  if (!paymentMethod || !allowedPayments.includes(paymentMethod)) {
    errors.paymentMethod = "Choose a valid payment method for the selected fulfillment.";
  }

  const paymentStatus = ADMIN_PAYMENT_STATUS_VALUES.includes(body.paymentStatus) ? body.paymentStatus : null;
  if (!paymentStatus) errors.paymentStatus = "Choose a valid payment status.";

  const customerNotes = str(body.customerNotes).slice(0, 500);
  const adminNotes = str(body.adminNotes).slice(0, 500);

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data: {
      customerName,
      mobile: mobileCleaned,
      email: emailRaw || null,
      orderSource,
      productId,
      quantity,
      fulfillment,
      deliveryArea,
      deliveryAddress,
      paymentMethod,
      paymentStatus,
      customerNotes,
      adminNotes,
    },
  };
}

module.exports = { validateAdminOrderInput, ADMIN_PAYMENT_STATUS_VALUES };
