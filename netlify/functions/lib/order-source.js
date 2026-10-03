// Shared order-source vocabulary — where a given order actually came from.
// Website checkout orders always get "website" automatically (see
// lib/order-transaction.js); every other value is only ever chosen by an
// Owner/Admin encoding an order received outside the website
// (create-admin-order.js). Centralized here so create-admin-order.js's
// validation and export-format.js's export column can't drift apart.

const ORDER_SOURCE_VALUES = ["website", "facebook", "instagram", "messenger", "phone", "walk-in", "manual"];

const ORDER_SOURCE_LABELS = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  messenger: "Messenger",
  phone: "Phone",
  "walk-in": "Walk-in",
  manual: "Manual / Other",
};

module.exports = { ORDER_SOURCE_VALUES, ORDER_SOURCE_LABELS };
