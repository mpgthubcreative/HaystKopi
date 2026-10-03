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

async function sendEmail({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ORDER_NOTIFICATION_EMAIL;
  const from = process.env.ORDER_NOTIFICATION_FROM_EMAIL;

  if (!apiKey || !to || !from) {
    console.error(
      "order-notifications: RESEND_API_KEY/ORDER_NOTIFICATION_EMAIL/ORDER_NOTIFICATION_FROM_EMAIL not fully configured — skipping email:",
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
      body: JSON.stringify({ from, to: [to], subject, html }),
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

module.exports = { sendNewOrderEmail, sendPaymentProofSubmittedEmail, adminOrderLink, escapeHtml };
