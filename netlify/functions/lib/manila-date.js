// Deterministic "Philippine business date" — used for order numbers
// (HK-YYYYMMDD-NNN) and the matching daily counter document.
//
// Asia/Manila is a FIXED UTC+8 offset with no daylight saving time, so this
// can be computed deterministically from any Date's absolute epoch value —
// it does NOT depend on Netlify's runtime timezone (which may be UTC or
// anything else) because we never call the runtime-timezone-dependent
// getFullYear()/getMonth()/getDate(); we shift the epoch by the fixed
// offset ourselves and then read only the UTC getters, which always
// reflect that shifted instant regardless of the host's local timezone.
//
// Example: an order placed at Oct 1, 2026, 12:15 AM Philippine time is
// Sep 30, 2026, 4:15 PM UTC. Shifting by +8h gives Oct 1, 2026, 12:15 AM
// UTC, whose UTC date fields correctly read "2026-10-01".

const MANILA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function formatManilaBusinessDate(date) {
  const shifted = new Date(date.getTime() + MANILA_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

// Same shift as formatManilaBusinessDate, but "YYYY-MM-DD" — the shape used
// throughout export filters/presets/filenames.
function formatManilaDateString(date) {
  const shifted = new Date(date.getTime() + MANILA_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// "YYYY-MM-DD HH:mm" in Asia/Manila — the spreadsheet-friendly text format
// requested for export display (used for CSV cells and as a fallback).
function formatManilaDateTime(date) {
  const shifted = new Date(date.getTime() + MANILA_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// A JS Date whose UTC fields equal the Manila wall-clock time. XLSX/Excel
// stores no timezone at all — a viewer opening the file just reads the
// serial's calendar fields back out via UTC getters, so writing THIS shifted
// instant (rather than the true UTC instant) is what makes an Excel date
// cell display "2026-09-27 21:15" instead of silently re-localizing to
// whatever timezone the viewer's machine happens to be in.
function toManilaSpreadsheetDate(date) {
  return new Date(date.getTime() + MANILA_UTC_OFFSET_MS);
}

// Inverse of formatManilaDateString: "YYYY-MM-DD" (a Philippine business
// date) -> the UTC instant of that date's Manila midnight.
function manilaDateStringToUtcStart(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - MANILA_UTC_OFFSET_MS);
}

// "YYYY-MM-DD" -> the UTC instant of that date's Manila 23:59:59.999.
function manilaDateStringToUtcEnd(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - MANILA_UTC_OFFSET_MS);
}

// Resolves a named preset into a { from, to } pair of "YYYY-MM-DD" Manila
// business dates, anchored to the current instant. Returns null for
// "custom" (the caller is expected to supply from/to itself in that case).
function computeManilaPresetRange(preset, now = new Date()) {
  const todayStr = formatManilaDateString(now);

  if (preset === "today") {
    return { from: todayStr, to: todayStr };
  }

  if (preset === "last7") {
    const from = formatManilaDateString(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    return { from, to: todayStr };
  }

  if (preset === "last30") {
    const from = formatManilaDateString(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    return { from, to: todayStr };
  }

  if (preset === "this-month") {
    const [year, month] = todayStr.split("-");
    return { from: `${year}-${month}-01`, to: todayStr };
  }

  return null;
}

module.exports = {
  MANILA_UTC_OFFSET_MS,
  formatManilaBusinessDate,
  formatManilaDateString,
  formatManilaDateTime,
  toManilaSpreadsheetDate,
  manilaDateStringToUtcStart,
  manilaDateStringToUtcEnd,
  computeManilaPresetRange,
};
