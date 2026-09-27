// Heuristic extraction over raw OCR text — GCash and bank apps each use
// their own screenshot layout, and layouts change over app versions, so
// this deliberately does NOT assume one exact template. It tries a list of
// common labels first (highest confidence), then falls back to "a long
// standalone digit run" (lower confidence, since it could be a phone
// number, date, or amount misread as a reference).
//
// This is heuristic, not authoritative — never assume it's correct. It is
// only ever a starting suggestion the customer reviews and can edit (see
// the CUSTOMER CONFIRMATION step in checkout) before anything is trusted.

const REFERENCE_LABEL_PATTERNS = [
  /reference\s*(?:no\.?|number)?\s*[:\-]?\s*([A-Za-z0-9]{6,20})/i,
  /ref\.?\s*no\.?\s*[:\-]?\s*([A-Za-z0-9]{6,20})/i,
  /transaction\s*(?:id|no\.?|number)?\s*[:\-]?\s*([A-Za-z0-9]{6,20})/i,
  /trace\s*number\s*[:\-]?\s*([A-Za-z0-9]{6,20})/i,
  /confirmation\s*number\s*[:\-]?\s*([A-Za-z0-9]{6,20})/i,
];

// Returns { reference: string|null, confidence: number } — confidence is a
// rough 0–1 scale (0.8 = matched a known label, 0.4 = fallback digit-run
// guess, 0 = nothing found), used only to decide whether to show a
// "low confidence" hint in the admin UI, never to auto-accept anything.
function extractPaymentReference(rawText) {
  if (!rawText) return { reference: null, confidence: 0 };

  for (const pattern of REFERENCE_LABEL_PATTERNS) {
    const match = rawText.match(pattern);
    if (match && match[1]) {
      return { reference: match[1].trim(), confidence: 0.8 };
    }
  }

  // Fallback: GCash/bank references are commonly 10–15 digits with no
  // separators. Low confidence because this could just as easily be a
  // phone number or account number printed elsewhere on the receipt.
  const digitMatch = rawText.match(/\b\d{10,15}\b/);
  if (digitMatch) {
    return { reference: digitMatch[0], confidence: 0.4 };
  }

  return { reference: null, confidence: 0 };
}

// Returns a number (pesos) or null. Looks for a currency-prefixed amount
// (₱, PHP, or a bare "P" immediately before digits) with two decimal places.
function extractAmount(rawText) {
  if (!rawText) return null;

  const match = rawText.match(/(?:₱|PHP|Php|P)\s*([\d,]+\.\d{2})/);
  if (!match) return null;

  const value = parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

module.exports = { extractPaymentReference, extractAmount };
