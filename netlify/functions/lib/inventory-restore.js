// Shared restoration logic for cancel-order and delete-order.
// Both need the exact same guarded behavior: restore stock for an order's
// items ONLY if it was actually deducted and hasn't been restored yet, and
// never twice. Must be called from inside an active transaction, after all
// of that transaction's reads and before any of its writes to these refs.

// Reads every item's current product doc (all reads, safe to call before
// other writes in the same transaction).
async function readOrderItemProducts(tx, db, order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const productSnaps = await Promise.all(
    items.map((item) => tx.get(db.collection("products").doc(item.productId)))
  );
  return items.map((item, i) => ({ item, snap: productSnaps[i] }));
}

// Applies the restoration writes (product inventory + one inventoryLogs
// entry per item). Call only when order.inventoryDeducted is true and
// order.inventoryRestored is false — the caller decides that; this function
// just performs the writes.
function applyInventoryRestoration({ tx, db, admin, itemProductPairs, orderId, orderNumber, logType, actorUid, actorName }) {
  itemProductPairs.forEach(({ item, snap }) => {
    if (!snap.exists) return; // product was deleted separately — nothing to restore onto
    const productRef = db.collection("products").doc(item.productId);
    const previousInventory = Math.max(0, Math.floor(Number(snap.data().inventory) || 0));
    const newInventory = previousInventory + item.quantity;

    tx.update(productRef, {
      inventory: newInventory,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const logRef = db.collection("inventoryLogs").doc();
    tx.set(logRef, {
      productId: item.productId,
      productName: item.name || item.productId,
      previousInventory,
      newInventory,
      changeAmount: item.quantity,
      reason: `Order ${orderNumber}`,
      type: logType,
      orderId,
      orderNumber,
      updatedBy: actorUid,
      updatedByName: actorName || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

module.exports = { readOrderItemProducts, applyInventoryRestoration };
