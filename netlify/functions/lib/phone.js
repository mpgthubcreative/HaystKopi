// One shared phone-normalization rule, used by create-order.js (to store
// phoneNormalized on new orders), get-order-status.js, and
// resume-payment.js (both to verify a lookup). Without this single source
// of truth, two endpoints could disagree on whether "09171234567" and
// "+639171234567" are the same number — exactly the kind of mismatch that
// would let a real customer get locked out of tracking their own order.
//
// Normal form: "639171234567" (63 + 10 digits, no plus sign, no leading 0).

function normalizePhone(phone) {
  if (typeof phone !== "string") return null;
  const cleaned = phone.replace(/[\s-]/g, "");

  if (/^09\d{9}$/.test(cleaned)) return `63${cleaned.slice(1)}`;
  if (/^\+639\d{9}$/.test(cleaned)) return cleaned.slice(1);
  if (/^639\d{9}$/.test(cleaned)) return cleaned;

  return null;
}

module.exports = { normalizePhone };
