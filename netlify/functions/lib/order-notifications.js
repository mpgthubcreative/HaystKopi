// Centralized Owner-facing transactional email for the order lifecycle —
// "New Website Order" and "Payment Proof Submitted". Sent via Resend's
// plain REST API (fetch, not the `resend` npm SDK) — consistent with this
// project's established style of talking to external providers (Google
// Places, Distance Matrix) via plain fetch rather than adding a client
// library.
//
// TRUST BOUNDARY: every function here is deliberately BEST-EFFORT and
// NEVER THROWS. A Resend outage, a missing env var, or a malformed
// response must never fail the order-creation or payment-proof-submission
// request that triggered it — see each caller's own try/catch, which is
// redundant with the catching done here on purpose (defense in depth, the
// same pattern used throughout this codebase for anything that must not
// take down a request it's merely side-effecting off of).
//
// WHY AWAITED, NOT FIRE-AND-FORGET: a serverless function's execution
// environment can be frozen/torn down immediately after it returns a
// response, so un-awaited "background" work after `return` is not
// reliably completed. Awaiting costs the caller a few hundred ms of
// response latency but is the only way to actually guarantee the email
// request leaves the function before it exits.

const { PAYMENT_METHOD_LABELS, FULFILLMENT_LABELS, formatDeliveryAddressForExport } = require("./export-format");
const { ORDER_SOURCE_LABELS } = require("./order-source");

const RESEND_URL = "https://api.resend.com/emails";

// Customer-facing wording only — deliberately different from the internal
// PAYMENT_STATUS_LABELS used in exports/admin (those say "Awaiting
// Verification", which reads like jargon to a customer). Never implies a
// payment is verified/confirmed unless paymentStatus is actually PAID —
// AWAITING_VERIFICATION is explicit that verification is still pending.
const CUSTOMER_PAYMENT_STATUS_LABELS = {
  UNPAID: "Payment pending",
  AWAITING_VERIFICATION: "Payment proof submitted — we're verifying your payment.",
  PAID: "Payment confirmed",
  REFUNDED: "Refunded",
};

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPeso(amount) {
  return `₱${Number(amount || 0).toFixed(2)}`;
}

// SITE_URL is a plain, explicit env var (see .env.example) rather than an
// inferred Netlify build variable — those (URL/DEPLOY_PRIME_URL) are
// documented for build-time/CI use, not guaranteed stable for a Function's
// runtime invocation, so this stays simple and explicit. Falls back to the
// known production domain so a missing env var never produces a broken,
// empty-host link in an email that's already been sent.
function siteUrl() {
  return (process.env.SITE_URL || "https://hayst-kopi.netlify.app").replace(/\/+$/, "");
}

function adminOrderLink(orderId) {
  return `${siteUrl()}/admin/order.html?id=${encodeURIComponent(orderId)}`;
}

// Public, customer-facing tracking page — NEVER the admin order page. The
// existing lookup (get-order-status.js / lib/order-lookup.js) requires
// BOTH order number AND mobile number before returning anything, because
// order numbers are sequential/guessable and phone is the actual secret;
// there is no token-based one-click link in this architecture, and this
// deliberately does not invent one. order-status.js already supports an
// `?order=` query param that only PREFILLS that field (confirmed in
// order-status.js) — phone must still be typed in, so this link cannot
// bypass the real lookup check. Order numbers are not secret (they're
// shown in plain text elsewhere in this same email), so including one in
// a URL is safe.
function trackingLink(orderNumber) {
  return `${siteUrl()}/order-status.html?order=${encodeURIComponent(orderNumber)}`;
}

// Escapes `value` by default — safe-by-default for every call site. The
// one case that needs to combine two already-escaped pieces (the Product
// line's "name × qty") builds that string itself and passes it via
// `rowRaw` instead, so there is exactly one place in this file where an
// un-escaped-at-this-call-site value is allowed, and it's named to make
// that obvious.
function row(label, value) {
  return rowRaw(label, escapeHtml(value));
}

function rowRaw(label, safeHtmlValue) {
  return `<tr><td style="padding:4px 12px 4px 0;color:#6B5647;font-size:13px;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:4px 0;color:#3B2416;font-size:14px;">${safeHtmlValue}</td></tr>`;
}

// Owner-only wrapper — its CTA always links to the Admin Order Details
// page. Never reused for the customer-facing email below, which has its
// own separate wrapper (wrapCustomerEmail) with its own CTA, so there is
// no shared code path that could ever leak an admin link into a customer
// inbox.
function wrapEmail(heading, bodyRowsHtml, linkUrl) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#F8F2EC;">
  <h1 style="font-size:18px;color:#3B2416;margin:0 0 16px;">${escapeHtml(heading)}</h1>
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#FFFCF9;border-radius:12px;padding:16px;">
    ${bodyRowsHtml}
  </table>
  <p style="margin:20px 0 0;">
    <a href="${escapeHtml(linkUrl)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#3B2416;color:#F8F2EC;text-decoration:none;font-size:13px;font-weight:600;">View Order in Admin</a>
  </p>
</div>`.trim();
}

// Customer-facing wrapper — simple, branded, mobile-friendly. `introText`
// is already-escaped-safe HTML (built by the caller via escapeHtml), and
// its CTA always points at the public tracking page via `ctaUrl` — this
// function has no parameter that could ever carry an admin link.
function wrapCustomerEmail(heading, introHtml, bodyRowsHtml, ctaUrl, ctaLabel) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#F8F2EC;">
  <h1 style="font-size:20px;color:#3B2416;margin:0 0 4px;">Hayst Kopi</h1>
  <h2 style="font-size:16px;color:#6B5647;margin:0 0 16px;font-weight:600;">${escapeHtml(heading)}</h2>
  <p style="font-size:14px;color:#3B2416;line-height:20px;margin:0 0 16px;">${introHtml}</p>
  <table role="presentation" style="width:100%;border-collapse:collapse;background:#FFFCF9;border-radius:12px;padding:16px;">
    ${bodyRowsHtml}
  </table>
  <p style="margin:20px 0 0;">
    <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#3B2416;color:#F8F2EC;text-decoration:none;font-size:13px;font-weight:600;">${escapeHtml(ctaLabel)}</a>
  </p>
</div>`.trim();
}

// `to` defaults to the Owner notification address (ORDER_NOTIFICATION_EMAIL)
// so every existing owner-email call site is unaffected by this signature
// gaining an optional override — sendCustomerOrderConfirmationEmail is the
// only caller that ever passes a different `to`. `text` is an optional
// plain-text alternative part; Resend sends a proper multipart email when
// both `html` and `text` are present, and just HTML when `text` is omitted
// (the owner emails' existing behavior, unchanged).
async function sendEmail({ subject, html, text, to: toOverride }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = toOverride || process.env.ORDER_NOTIFICATION_EMAIL;
  const from = process.env.ORDER_NOTIFICATION_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.error(
      "order-notifications: RESEND_API_KEY/ORDER_NOTIFICATION_FROM_EMAIL/recipient not fully configured — skipping email:",
      subject
    );
    return { ok: false, reason: "not-configured" };
  }

  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html, ...(text ? { text } : {}) }),
    });

    if (!response.ok) {
      let text = "";
      try {
        text = await response.text();
      } catch (err) {
        // ignore — we already have the status code to log
      }
      console.error(`order-notifications: Resend returned ${response.status} for "${subject}": ${text.slice(0, 500)}`);
      return { ok: false, reason: "resend-error", status: response.status };
    }

    return { ok: true };
  } catch (err) {
    console.error(`order-notifications: Resend request failed for "${subject}":`, err && err.message ? err.message : err);
    return { ok: false, reason: "network-error" };
  }
}

// Called only for a FRESHLY created order (never a replayed/idempotent
// retry — see create-order.js, which only calls this from the branch
// where commitOrderInTransaction actually ran, not from either of its two
// "order already exists" replay paths). The orderSource/isTest guard below
// is a second, independent layer of protection in case this is ever called
// from somewhere else in the future.
async function sendNewOrderEmail({
  orderId,
  orderNumber,
  customerName,
  phone,
  productName,
  quantity,
  fulfillmentMethod,
  deliveryArea,
  deliveryAddress,
  paymentMethod,
  paymentStatus,
  total,
  orderSource,
  isTest,
}) {
  if (orderSource !== "website" || isTest) {
    return { ok: false, reason: "not-applicable" };
  }

  const rows = [
    row("Order Number", orderNumber),
    row("Customer Name", customerName),
    row("Mobile Number", phone),
    rowRaw("Product", `${escapeHtml(productName)} &times; ${Number(quantity) || 0}`),
    row("Fulfillment", FULFILLMENT_LABELS[fulfillmentMethod] || fulfillmentMethod || ""),
  ];

  if (fulfillmentMethod === "delivery") {
    rows.push(row("Delivery Address", formatDeliveryAddressForExport(deliveryArea, deliveryAddress)));
  }

  rows.push(
    row("Payment Method", PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod || ""),
    row("Payment Status", paymentStatus),
    row("Order Total", formatPeso(total)),
    row("Order Source", ORDER_SOURCE_LABELS[orderSource] || orderSource || "")
  );

  const html = wrapEmail("NEW HAYST KOPI ORDER", rows.join(""), adminOrderLink(orderId));

  return sendEmail({ subject: `New Order ${orderNumber} — Hayst Kopi`, html });
}

// Called only when confirm-payment-reference.js actually transitions
// paymentStatus to AWAITING_VERIFICATION for the first time since the
// customer's current proof image (see that file's own duplicate-send
// guard — paymentProofNotifiedAt — for the mechanics).
async function sendPaymentProofSubmittedEmail({ orderId, orderNumber, customerName, paymentMethod, paymentReference, total }) {
  const rows = [
    row("Order Number", orderNumber),
    row("Customer Name", customerName),
    row("Payment Method", PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod || ""),
    row("Reference Number", paymentReference),
    row("Order Total", formatPeso(total)),
  ];

  const html = wrapEmail("PAYMENT PROOF SUBMITTED", rows.join(""), adminOrderLink(orderId));

  return sendEmail({ subject: `Payment Proof Submitted — ${orderNumber}`, html });
}

// Called only for a FRESHLY created website order with a valid customer
// email on file — see create-order.js, which gates this call on the exact
// same `isNewOrder` branch as sendNewOrderEmail (the owner email), so a
// retried/idempotent clientRequestId can never trigger a second customer
// email either. The orderSource/isTest guard and the email-presence check
// below are a second, independent layer of protection, matching
// sendNewOrderEmail's pattern.
//
// PRIVACY: this function's parameter list is deliberately narrow — it has
// no way to reference adminNotes, OCR fields, the payment-proof storage
// path, duplicate/mismatch flags, or an admin link, because it is never
// passed those values in the first place (see the call site in
// create-order.js). wrapCustomerEmail (not wrapEmail) builds the HTML, and
// that function has no admin-link parameter either — there is no code
// path by which this email could ever contain one.
async function sendCustomerOrderConfirmationEmail({
  customerEmail,
  orderNumber,
  customerName,
  productName,
  quantity,
  fulfillmentMethod,
  deliveryArea,
  deliveryAddress,
  paymentMethod,
  paymentStatus,
  total,
  orderSource,
  isTest,
}) {
  if (orderSource !== "website" || isTest) {
    return { ok: false, reason: "not-applicable" };
  }
  if (!customerEmail) {
    return { ok: false, reason: "no-email" };
  }

  const greetingName = customerName ? customerName.trim() : "";
  const introHtml = `Hi${greetingName ? ` ${escapeHtml(greetingName)}` : ""}, thanks for your order! Here's a quick summary:`;

  const rows = [
    row("Order Number", orderNumber),
    rowRaw("Product", `${escapeHtml(productName)} &times; ${Number(quantity) || 0}`),
    row("Fulfillment", FULFILLMENT_LABELS[fulfillmentMethod] || fulfillmentMethod || ""),
  ];

  if (fulfillmentMethod === "delivery") {
    rows.push(row("Delivery Address", formatDeliveryAddressForExport(deliveryArea, deliveryAddress)));
  }

  rows.push(
    row("Payment Method", PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod || ""),
    row("Payment Status", CUSTOMER_PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus || ""),
    row("Order Total", formatPeso(total))
  );

  const trackUrl = trackingLink(orderNumber);
  const html = wrapCustomerEmail("Order Confirmed", introHtml, rows.join(""), trackUrl, "TRACK YOUR ORDER");

  const text = [
    `Hi${greetingName ? ` ${greetingName}` : ""}, thanks for your order!`,
    "",
    `Order Number: ${orderNumber}`,
    `Product: ${productName} x ${Number(quantity) || 0}`,
    `Fulfillment: ${FULFILLMENT_LABELS[fulfillmentMethod] || fulfillmentMethod || ""}`,
    ...(fulfillmentMethod === "delivery" ? [`Delivery Address: ${formatDeliveryAddressForExport(deliveryArea, deliveryAddress)}`] : []),
    `Payment Method: ${PAYMENT_METHOD_LABELS[paymentMethod] || paymentMethod || ""}`,
    `Payment Status: ${CUSTOMER_PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus || ""}`,
    `Order Total: ${formatPeso(total)}`,
    "",
    `Track your order: ${trackUrl}`,
    "(You'll need the order number above and the mobile number you used at checkout.)",
  ].join("\n");

  return sendEmail({ subject: `Hayst Kopi Order Confirmed — ${orderNumber}`, html, text, to: customerEmail });
}

module.exports = {
  sendNewOrderEmail,
  sendPaymentProofSubmittedEmail,
  sendCustomerOrderConfirmationEmail,
  adminOrderLink,
  trackingLink,
  escapeHtml,
};
