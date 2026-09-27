// Client-side payment-screenshot compression, used by order-confirmation.js.
//
// Target: ~300–800KB, longest edge ~1600–2000px, without compressing so
// hard the receipt text becomes unreadable (stops at MIN_QUALITY rather
// than continuing to shrink quality indefinitely). This is a courtesy for
// upload speed and Netlify Function body-size headroom — the backend
// (upload-payment-proof.js) independently validates real file type via
// magic bytes and enforces its own size ceiling regardless of what this
// function produced, so it is never trusted as the actual security check.
//
// If compression fails for any reason (unsupported format, decode error),
// this throws rather than falling back to uploading the raw original —
// callers must treat a thrown error as "ask the customer to try a
// different screenshot," never as permission to silently ship a huge file.

const MAX_DIMENSION = 1800;
const TARGET_MAX_BYTES = 800 * 1024;
const MIN_QUALITY = 0.5;
const QUALITY_STEP = 0.1;
const INITIAL_QUALITY = 0.85;

export async function compressImage(file) {
  const bitmap = await createImageBitmap(file);

  let { width, height } = bitmap;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);

  let quality = INITIAL_QUALITY;
  let blob = await canvasToBlob(canvas, "image/webp", quality);

  while (blob.size > TARGET_MAX_BYTES && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - QUALITY_STEP);
    blob = await canvasToBlob(canvas, "image/webp", quality);
  }

  if (!blob || blob.size === 0) {
    throw new Error("compression-failed");
  }

  return blob;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas-tobolb-failed"));
    }, type, quality);
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result is "data:image/webp;base64,AAAA..." — strip the prefix.
      const commaIndex = reader.result.indexOf(",");
      resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
    };
    reader.onerror = () => reject(reader.error || new Error("file-read-failed"));
    reader.readAsDataURL(blob);
  });
}
