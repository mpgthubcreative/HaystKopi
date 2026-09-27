// Server-side image validation — the actual enforcement point. checkout.js
// compresses to webp and declares a MIME type client-side, but a client is
// never trusted just because it labeled a request "image/jpeg"; this
// sniffs the real file signature (magic bytes) instead of trusting any
// declared contentType string.

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Detects jpeg/png/webp from the actual bytes. Returns the real MIME type
// or null if it's not one of the three accepted formats.
function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

module.exports = { detectImageType };
