// POST /.netlify/functions/export-orders
// Requires an active OWNER or ADMIN (Authorization: Bearer <Firebase ID
// token>) — no public export endpoint exists. Generates an accounting/
// reconciliation export (.xlsx or .csv) of real Firestore order documents,
// queried directly (never scraped from whatever the browser happened to
// have paginated in) so old orders beyond the admin UI's "Load More" are
// always included.
//
// Every exported value comes straight off the stored order document —
// historical price/delivery-fee/payment-instruction snapshots are exported
// as-is, never recomputed from today's products/settings. See
// lib/export-format.js for the column-by-column mapping.

const ExcelJS = require("exceljs");
const { admin, db, initError } = require("./lib/firebase-admin");
const { getCallerProfile, isActiveAdminProfile } = require("./lib/authorize");
const { respond } = require("./lib/http");
const { EXPORT_COLUMNS } = require("./lib/export-format");
const { resolveDateRange, queryOrdersInRange, applyFilters } = require("./lib/export-orders-query");
const { formatManilaDateTime, toManilaSpreadsheetDate } = require("./lib/manila-date");

const MAX_BODY_BYTES = 2000;
const MAX_ROWS = 20000; // sanity ceiling — see Phase 10 summary, known limitations.

function buildFilename(orderType, fromStr, toStr, ext) {
  const prefix =
    orderType === "live" ? "hayst-kopi-live-orders" : orderType === "test" ? "hayst-kopi-test-orders" : "hayst-kopi-orders";
  return `${prefix}-${fromStr}-to-${toStr}.${ext}`;
}

function columnWidth(header) {
  return Math.max(12, Math.min(32, header.length + 4));
}

async function buildWorkbook(orders) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders");

  sheet.columns = EXPORT_COLUMNS.map((col) => ({ header: col.header, width: columnWidth(col.header) }));

  orders.forEach((order) => {
    const values = EXPORT_COLUMNS.map((col) => {
      const value = col.get(order);
      if (col.isDate) return value ? toManilaSpreadsheetDate(value) : null;
      return value;
    });

    const row = sheet.addRow(values);

    EXPORT_COLUMNS.forEach((col, index) => {
      const cell = row.getCell(index + 1);
      if (col.isDate) cell.numFmt = "yyyy-mm-dd hh:mm";
      else if (col.isMoney) cell.numFmt = "#,##0.00";
      else if (col.isNumber) cell.numFmt = "0.##";
    });
  });

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };

  return workbook;
}

function buildCsvRows(orders) {
  // Reuses the same workbook builder — ExcelJS's own CSV writer handles
  // RFC4180 escaping (commas/quotes/newlines in customer notes) rather than
  // hand-built string concatenation. Dates are rendered as the plain
  // "YYYY-MM-DD HH:mm" text format for CSV (no cell types in CSV anyway).
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Orders");
  sheet.addRow(EXPORT_COLUMNS.map((col) => col.header));

  orders.forEach((order) => {
    const values = EXPORT_COLUMNS.map((col) => {
      const value = col.get(order);
      if (col.isDate) return value ? formatManilaDateTime(value) : "";
      if (value === null || value === undefined) return "";
      return value;
    });
    sheet.addRow(values);
  });

  return workbook;
}

exports.handler = async (event) => {
  if (initError) {
    console.error("Firebase Admin not initialized:", initError);
    return respond(500, { success: false, error: "server-misconfigured", message: "This service is temporarily unavailable. Please try again later." });
  }

  if (event.httpMethod !== "POST") {
    return respond(405, { success: false, error: "method-not-allowed", message: "Method not allowed." });
  }

  const profile = await getCallerProfile(admin, db, event);
  if (!isActiveAdminProfile(profile)) {
    return respond(403, { success: false, error: "forbidden", message: "You don't have permission to export orders." });
  }

  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return respond(400, { success: false, error: "invalid-request", message: "Export could not be generated. Please try again." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return respond(400, { success: false, error: "invalid-json", message: "Export could not be generated. Please try again." });
  }

  const format = payload.format === "csv" ? "csv" : "xlsx";

  const range = resolveDateRange(payload);
  if (!range.ok) {
    return respond(400, { success: false, error: "invalid-date-range", message: range.error });
  }

  const orderType = ["all", "live", "test"].includes(payload.orderType) ? payload.orderType : "live";

  let orders;
  try {
    const inRange = await queryOrdersInRange(db, admin, range.startUtc, range.endUtc);
    orders = applyFilters(inRange, { ...payload, orderType });
  } catch (err) {
    // Never leak the raw Firestore error to the client — log it server-side
    // only, with no order data attached (see Phase 10 spec section 22).
    console.error("export-orders query failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Export could not be generated. Please try again." });
  }

  if (orders.length === 0) {
    return respond(200, { success: true, empty: true, message: "No orders matched the selected filters." });
  }

  if (orders.length > MAX_ROWS) {
    return respond(400, {
      success: false,
      error: "too-many-rows",
      message: `That selection has more than ${MAX_ROWS} orders. Please narrow the date range or filters.`,
    });
  }

  const filename = buildFilename(orderType, range.fromStr, range.toStr, format);

  try {
    if (format === "csv") {
      const workbook = buildCsvRows(orders);
      const csvBuffer = await workbook.csv.writeBuffer();
      // A leading UTF-8 BOM is what makes Excel (unlike most other CSV
      // readers) correctly detect UTF-8 instead of misreading accented
      // characters as the system ANSI codepage. Google Sheets/other tools
      // ignore it harmlessly.
      const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csvBuffer]);
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
        body: buffer.toString("base64"),
        isBase64Encoded: true,
      };
    }

    const workbook = await buildWorkbook(orders);
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("export-orders file generation failed:", err);
    return respond(500, { success: false, error: "server-error", message: "Export could not be generated. Please try again." });
  }
};
