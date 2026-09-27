// Google Cloud Vision OCR — reuses the SAME service account as
// firebase-admin.js (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY), no
// separate API key. Requires the Cloud Vision API to be enabled once on
// the same GCP project (Console > APIs & Services > Library).
//
// Why Vision over a lighter-weight OCR library: this needs to run reliably
// server-side against real-world phone-screenshot photos of receipts —
// varying lighting, screen glare, compression artifacts. A managed,
// production-grade OCR service handles that far better than a
// client-side/pure-JS OCR library would, and we're already fully inside
// the Google Cloud ecosystem via Firebase, so there's no new vendor
// relationship to stand up — just one more API enabled on the same project.
//
// OCR is explicitly best-effort throughout this codebase: a Vision failure
// (provider outage, malformed image, no text found) must never fail the
// payment-proof upload itself — see upload-payment-proof.js, which treats
// runOcr()'s ok:false the same as "no text found" and still saves the
// proof image, falling back to manual reference entry.

let visionClient = null;

function getVisionClient() {
  if (visionClient) return visionClient;

  const { ImageAnnotatorClient } = require("@google-cloud/vision");
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  visionClient = new ImageAnnotatorClient({
    projectId: process.env.FIREBASE_PROJECT_ID,
    credentials: {
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      private_key: privateKey,
    },
  });

  return visionClient;
}

// Returns { ok: true, rawText } or { ok: false, rawText: "" } — never throws.
async function runOcr(imageBuffer) {
  try {
    const client = getVisionClient();
    const [result] = await client.textDetection({ image: { content: imageBuffer } });
    const rawText = (result.fullTextAnnotation && result.fullTextAnnotation.text) || "";
    return { ok: true, rawText };
  } catch (err) {
    console.error("Vision OCR failed:", err);
    return { ok: false, rawText: "" };
  }
}

module.exports = { runOcr };
