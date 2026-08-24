// server/inventory.js
// -----------------------------------------------------------------------------
// Atomic inventory + stock movement history. This single service is the source
// of truth for every stock quantity. Physical sales, online sales, refunds,
// corrections, receipts ALL go through here so nothing is ever double-sold and
// every change is recorded (requirement: "why did stock go from 20 to 14?").
//
// Key pattern used for oversell protection (requirement #6):
//   BEGIN;
//   SELECT ... FROM inventory WHERE id = $1 FOR UPDATE;   -- lock the row
//   -- verify quantity >= requested
//   UPDATE inventory SET quantity = quantity - requested;
//   COMMIT;  -- or ROLLBACK if it cannot be fulfilled
// -----------------------------------------------------------------------------

const { pool, withTransaction } = require('./db');

// Movement types — matches the requirement's stock history list.
const MOVEMENT_TYPES = {
    RECEIVED: 'received',
    PHYSICAL_SALE: 'physical_sale',
    ONLINE_SALE: 'online_sale',
    ADJUSTMENT: 'adjustment',
    DAMAGED: 'damaged',
    RETURNED: 'returned',
    CANCELLED: 'cancelled',
    CORRECTION: 'correction'
};

// Raised when a deduction would push a product below zero. Callers should roll
// back the enclosing transaction and surface this as a "not enough stock" error.
class InsufficientStockError extends Error {
    constructor(productId, productName, requested, available) {
        super(`Not enough stock for "${productName || ('product #' + productId)}". Requested ${requested}, only ${available} available.`);
        this.name = 'InsufficientStockError';
        this.code = 'INSUFFICIENT_STOCK';
        this.productId = productId;
        this.requested = requested;
        this.available = available;
    }
}

// The default supermarket the platform currently operates as its first store.
// Later this becomes a look-up parameter so each store manages its own inventory.
function getDefaultSupermarketSql() {
    return "SELECT id FROM supermarkets WHERE slug = 'default'";
}

// Locate the default supermarket id using an existing (transaction) client.
async function getDefaultSupermarket(client) {
    const res = await client.query(getDefaultSupermarketSql());
    if (res.rows.length === 0) throw new Error('Default supermarket not found. Run db.init() first.');
    return String(res.rows[0].id);
}

// Standalone lookup (opens a short-lived query).
async function getDefaultSupermarketId() {
    const res = await pool.query(getDefaultSupermarketSql());
    if (res.rows.length === 0) throw new Error('Default supermarket not found. Run db.init() first.');
    return String(res.rows[0].id);
}

// Ensure an inventory row exists for (supermarket, product) and lock it.
// MUST be called inside a transaction owning `client`.
async function lockOrCreateInventory(client, supermarketId, productId) {
    const lockSql =
        'SELECT * FROM inventory WHERE supermarket_id = $1 AND product_id = $2 FOR UPDATE';

    let res = await client.query(lockSql, [String(supermarketId), String(productId)]);
    if (res.rows.length === 0) {
        const now = new Date().toISOString();
        await client.query(
            `INSERT INTO inventory (supermarket_id, product_id, quantity, low_stock_threshold, created_at, updated_at)
             VALUES ($1, $2, 0, 5, $3, $3)`,
            [String(supermarketId), String(productId), now]
        );
        res = await client.query(lockSql, [String(supermarketId), String(productId)]);
    }
    return res.rows[0];
}

// Record a stock movement row.
async function insertMovement(client, m) {
    await client.query(
        `INSERT INTO stock_movements
            (inventory_id, product_id, supermarket_id, change_qty, qty_before, qty_after,
             movement_type, reference_type, reference_id, actor_user_id, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
            m.inventoryId,
            String(m.productId),
            String(m.supermarketId),
            m.changeQty,
            m.qtyBefore,
            m.qtyAfter,
            m.movementType,
            m.referenceType || null,
            m.referenceId != null ? String(m.referenceId) : null,
            m.actorUserId != null ? String(m.actorUserId) : null,
            m.note || null,
            new Date().toISOString()
        ]
    );
}

// Reflect the new quantity on the legacy products.stock mirror column so the
// existing frontend keeps working untouched.
async function syncProductStock(client, productId, qty) {
    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [qty, String(productId)]);
}
/**
 * Atomically REDUCE stock within the caller's transaction.
 * Throws InsufficientStockError if there is not enough — the caller must ROLLBACK.
 * Caller passes a `client` that already owns an open transaction (db.withTransaction).
 */
async function deductStock(client, {
    supermarketId, productId, productName, quantity,
    movementType, referenceType, referenceId, actorUserId, note
}) {
    const inv = await lockOrCreateInventory(client, supermarketId, productId); // row locked
    const qtyBefore = Number(inv.quantity);
    if (qtyBefore < quantity) {
        throw new InsufficientStockError(productId, productName, quantity, qtyBefore);
    }
    const qtyAfter = qtyBefore - quantity;

    await client.query('UPDATE inventory SET quantity = $1, updated_at = $2 WHERE id = $3',
        [qtyAfter, new Date().toISOString(), inv.id]);
    await syncProductStock(client, productId, qtyAfter);

    await insertMovement(client, {
        inventoryId: inv.id, productId, supermarketId,
        changeQty: -quantity, qtyBefore, qtyAfter,
        movementType: movementType || MOVEMENT_TYPES.ONLINE_SALE,
        referenceType, referenceId, actorUserId, note
    });

    return { productId: String(productId), quantity: qtyAfter };
}

/**
 * Atomically INCREASE stock (received / returned / cancelled-restore / correction).
 * Must be called inside an open transaction owning `client`.
 */
async function addStock(client, {
    supermarketId, productId, quantity, movementType,
    referenceType, referenceId, actorUserId, note
}) {
    const inv = await lockOrCreateInventory(client, supermarketId, productId);
    const qtyBefore = Number(inv.quantity);
    const qtyAfter = qtyBefore + quantity;

    await client.query('UPDATE inventory SET quantity = $1, updated_at = $2 WHERE id = $3',
        [qtyAfter, new Date().toISOString(), inv.id]);
    await syncProductStock(client, productId, qtyAfter);

    await insertMovement(client, {
        inventoryId: inv.id, productId, supermarketId,
        changeQty: quantity, qtyBefore, qtyAfter,
        movementType: movementType || MOVEMENT_TYPES.CORRECTION,
        referenceType, referenceId, actorUserId, note
    });

    return { productId: String(productId), quantity: qtyAfter };
}

/**
 * Absolute re-set of a product's stock, opening its own transaction.
 * Used by the admin dashboard (add/update stock) and at seed time.
 * Every call produces a stock_movements row (type defaults to 'adjustment').
 */
async function adjustStock({
    supermarketId, productId, newQuantity, movementType,
    referenceType, referenceId, actorUserId, note
}) {
    return withTransaction(async (client) => {
        const inv = await lockOrCreateInventory(client, supermarketId, productId);
        const qtyBefore = Number(inv.quantity);
        const qtyAfter = Math.max(0, Number(newQuantity) || 0);

        await client.query('UPDATE inventory SET quantity = $1, updated_at = $2 WHERE id = $3',
            [qtyAfter, new Date().toISOString(), inv.id]);
        await syncProductStock(client, productId, qtyAfter);

        await insertMovement(client, {
            inventoryId: inv.id, productId, supermarketId,
            changeQty: qtyAfter - qtyBefore, qtyBefore, qtyAfter,
            movementType: movementType || MOVEMENT_TYPES.ADJUSTMENT,
            referenceType, referenceId, actorUserId, note
        });

        return { productId: String(productId), quantity: qtyAfter };
    });
}
/* =====================================================================
 * PHASE 2 ADDITIONS
 * ===================================================================== */

/**
 * Record a physical supermarket sale. Opens its own transaction and reuses the
 * SAME atomic deductStock used by online orders — one source of truth. Rejects
 * (InsufficientStockError) if there is not enough stock. Records a
 * physical_sale movement + the product inventory row/legacy mirror update.
 */
async function recordPhysicalSale({
    supermarketId, productId, quantity, actorUserId, note
}) {
    if (!quantity || Number(quantity) <= 0) {
        const e = new Error('Quantity must be a positive number');
        e.status = 400;
        throw e;
    }
    return withTransaction(async (client) => {
        const sid = supermarketId || (await getDefaultSupermarket(client));
        // Fetch product name for the error message (and to confirm it exists).
        const prodRes = await client.query('SELECT id, name FROM products WHERE id = $1', [String(productId)]);
        if (prodRes.rows.length === 0) {
            const e = new Error('Product not found: ' + productId);
            e.status = 404;
            throw e;
        }
        const prod = prodRes.rows[0];

        return deductStock(client, {
            supermarketId: sid,
            productId: prod.id,
            productName: prod.name,
            quantity: Math.max(1, Math.floor(Number(quantity))),
            movementType: MOVEMENT_TYPES.PHYSICAL_SALE,
            referenceType: 'physical_sale',
            actorUserId,
            note: note || 'Physical sale recorded at the supermarket counter'
        });
    });
}

/**
 * Map of product_id -> { quantity, low_stock_threshold } for the given store.
 * Used to enrich catalog reads with the authoritative inventory quantity
 * (the old products.stock is only a backward-compatible mirror).
 */
async function getInventoryForProducts(supermarketId) {
    const sid = supermarketId || (await getDefaultSupermarketId());
    const res = await pool.query(
        'SELECT product_id, quantity, low_stock_threshold FROM inventory WHERE supermarket_id = $1',
        [String(sid)]
    );
    const map = {};
    res.rows.forEach(r => {
        map[String(r.product_id)] = {
            quantity: Number(r.quantity) || 0,
            low_stock_threshold: Number(r.low_stock_threshold) != null ? Number(r.low_stock_threshold) : 5
        };
    });
    return map;
}

/**
 * Inventory dashboard snapshot: every product joined with its current inventory
 * row (quantity + threshold) for the given supermarket, plus computed states.
 */
async function listInventory(supermarketId) {
    const sid = supermarketId || (await getDefaultSupermarketId());
    const invMap = await getInventoryForProducts(sid);
    const products = await pool.query('SELECT id, name, category, price, image FROM products ORDER BY id DESC');
    return products.rows.map(p => {
        const row = invMap[String(p.id)] || { quantity: 0, low_stock_threshold: 5 };
        const qty = row.quantity || 0;
        const threshold = row.low_stock_threshold;
        return {
            product_id: String(p.id),
            name: p.name,
            category: p.category,
            price: Number(p.price) || 0,
            quantity: qty,
            low_stock_threshold: threshold,
            in_stock: qty > 0,
            low_stock: qty > 0 && qty <= threshold,
            out_of_stock: qty <= 0
        };
    });
}
/**
 * Recent stock movements for a supermarket, newest first, joined with the
 * product name for human-friendly display.
 */
async function listRecentMovements(supermarketId, limit) {
    const sid = supermarketId || (await getDefaultSupermarketId());
    const lim = Math.min(100, Number(limit) || 50);
    const res = await pool.query(
        `SELECT sm.id, sm.product_id, sm.change_qty, sm.qty_before, sm.qty_after,
                sm.movement_type, sm.reference_type, sm.reference_id, sm.actor_user_id, sm.note, sm.created_at,
                p.name AS product_name
         FROM stock_movements sm
         LEFT JOIN products p ON p.id = sm.product_id
         WHERE sm.supermarket_id = $1
         ORDER BY sm.id DESC
         LIMIT $2`,
        [String(sid), lim]
    );
    return res.rows;
}

/**
 * TRUE if the given order already has a 'cancelled' stock-restore movement.
 * Used inside a transaction to make cancellation idempotent (a cancellation
 * endpoint called twice must not restore stock twice).
 */
async function hasCancelledRestore(client, orderRef) {
    const res = await client.query(
        `SELECT id FROM stock_movements
         WHERE movement_type = $1 AND reference_type = 'order' AND reference_id = $2
         LIMIT 1`,
        [MOVEMENT_TYPES.CANCELLED, String(orderRef)]
    );
    return res.rows.length > 0;
}

/**
 * Restore stock for a cancelled order. MUST be called inside the caller's
 * transaction. Skips items whose product no longer exists. Returns the list of
 * restored { productId, quantity } pairs.
 */
async function restoreCancelledOrder(client, { supermarketId, orderRef, items, actorUserId, note }) {
    const sid = supermarketId || (await getDefaultSupermarket(client));
    const restored = [];
    for (const item of items) {
        const productId = String(item.id);
        const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
        const exists = await client.query('SELECT id FROM products WHERE id = $1', [productId]);
        if (exists.rows.length === 0) continue; // product deleted/archived — nothing to restore
        const out = await addStock(client, {
            supermarketId: sid,
            productId,
            quantity: qty,
            movementType: MOVEMENT_TYPES.CANCELLED,
            referenceType: 'order',
            referenceId: orderRef,
            actorUserId,
            note: note || 'Stock restored after order ' + orderRef + ' was cancelled'
        });
        restored.push({ productId: String(productId), quantity: qty });
    }
    return restored;
}

/* =====================================================================
 * PHASE 4 ADDITIONS
 * ===================================================================== */

// Identifier types understood by the product-identification layer. QR codes and
// retail barcodes are NOT interchangeable — each maps to its own column, and
// every one of them resolves to the SAME product row.
const IDENTIFIER_TYPES = {
    INTERNAL_ID: 'internal_id',
    SKU: 'sku',
    BARCODE: 'barcode',
    QR: 'qr_identifier'
};

/**
 * Resolve an arbitrary scanned/typed identifier to the authoritative product
 * row. The identifier only IDENTIFIES the product — name, price, supermarket
 * and stock ALWAYS come from the database (requirement #9).
 * Lookup order: internal id -> sku -> barcode -> qr_identifier.
 */
async function resolveProductByIdentifier(rawIdentifier) {
    const value = String(rawIdentifier || '').trim();
    if (!value) return null;
    const client = await pool.connect();
    try {
        // Each probe is independent: if one fails (e.g. a numeric BARCODE that
        // overflows the internal-id column on some databases) we simply fall
        // through to the next identifier type.
        if (/^\d+$/.test(value)) {
            try {
                const byId = await client.query('SELECT * FROM products WHERE id = $1', [value]);
                if (byId.rows.length > 0) return { product: byId.rows[0], identifierType: IDENTIFIER_TYPES.INTERNAL_ID };
            } catch (ignore) { /* not a usable internal id (e.g. out of range) */ }
        }
        try {
            const bySku = await client.query('SELECT * FROM products WHERE sku = $1', [value]);
            if (bySku.rows.length > 0) return { product: bySku.rows[0], identifierType: IDENTIFIER_TYPES.SKU };
        } catch (ignore) {}
        try {
            const byBarcode = await client.query('SELECT * FROM products WHERE barcode = $1', [value]);
            if (byBarcode.rows.length > 0) return { product: byBarcode.rows[0], identifierType: IDENTIFIER_TYPES.BARCODE };
        } catch (ignore) {}
        try {
            const byQr = await client.query('SELECT * FROM products WHERE qr_identifier = $1', [value]);
            if (byQr.rows.length > 0) return { product: byQr.rows[0], identifierType: IDENTIFIER_TYPES.QR };
        } catch (ignore) {}
        return null;
    } finally {
        client.release();
    }
}

/**
 * True when ANY other product already uses this identifier on any identifier
 * column — stops the same physical product being registered twice just because
 * different identifier types were used (requirement #6).
 */
async function identifierInUse(rawIdentifier, excludeProductId) {
    const value = String(rawIdentifier || '').trim();
    if (!value) return null;
    const client = await pool.connect();
    try {
        const res = await client.query(
            `SELECT id, name FROM products
             WHERE sku = $1 OR barcode = $1 OR qr_identifier = $1 LIMIT 1`,
            [value]
        );
        if (res.rows.length === 0) return null;
        if (excludeProductId && String(res.rows[0].id) === String(excludeProductId)) return null;
        return res.rows[0];
    } finally {
        client.release();
    }
}

/**
 * Record a WHOLE physical sale session (multiple products) atomically
 * (requirement #8): all items are deducted inside ONE transaction. If any item
 * lacks stock, everything rolls back — no partial sales. Reuses deductStock()
 * for every line, so there is still exactly ONE deduction implementation.
 *
 * items: [{ productId, quantity }] — prices are NEVER taken from the caller;
 * the authoritative price comes from the database per line (requirement #9).
 */
async function recordPhysicalSaleSession({
    supermarketId, items, actorUserId, note, referenceType, referenceId
}) {
    if (!Array.isArray(items) || items.length === 0) {
        const e = new Error('A physical sale needs at least one item');
        e.status = 400;
        throw e;
    }

    return withTransaction(async (client) => {
        const sid = supermarketId || (await getDefaultSupermarket(client));
        const sold = [];

        for (const item of items) {
            const productId = String(item.productId);
            const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

            // Authoritative product + price from the database.
            const prodRes = await client.query(
                'SELECT id, name, price, active, carton_enabled, units_per_carton, carton_price FROM products WHERE id = $1',
                [productId]
            );
            if (prodRes.rows.length === 0) {
                const e = new Error('Product not found: ' + productId);
                e.status = 404;
                throw e;
            }
            const prod = prodRes.rows[0];
            if (prod.active === 0) {
                const e = new Error('Product is inactive: ' + prod.name);
                e.status = 409;
                throw e;
            }
            const purchaseType = item.purchaseType === 'carton' ? 'carton' : 'unit';
            if (purchaseType === 'carton' && (!prod.carton_enabled || !prod.units_per_carton || !prod.carton_price)) {
                const e = new Error('Carton purchase is not available for "' + prod.name + '"');
                e.status = 400;
                throw e;
            }
            const requestedQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
            const inventoryQuantity = purchaseType === 'carton'
                ? requestedQuantity * Number(prod.units_per_carton)
                : requestedQuantity;

            const beforeRes = await client.query(
                'SELECT quantity FROM inventory WHERE supermarket_id = $1 AND product_id = $2',
                [String(sid), productId]
            );
            const qtyBefore = beforeRes.rows.length > 0 ? Number(beforeRes.rows[0].quantity) : 0;

            const out = await deductStock(client, {
                supermarketId: sid,
                productId: prod.id,
                productName: prod.name,
                quantity: inventoryQuantity,
                movementType: MOVEMENT_TYPES.PHYSICAL_SALE,
                referenceType: referenceType || 'physical_sale',
                referenceId,
                actorUserId,
                note
            });

            sold.push({
                productId: String(prod.id),
                name: prod.name,
                unitPrice: Number(prod.price),
                quantity: requestedQuantity,
                purchaseType,
                unitsPerCarton: purchaseType === 'carton' ? Number(prod.units_per_carton) : null,
                unitPrice: purchaseType === 'carton' ? Number(prod.carton_price) : Number(prod.price),
                lineTotal: (purchaseType === 'carton' ? Number(prod.carton_price) : Number(prod.price)) * requestedQuantity,
                quantityBefore: qtyBefore,
                quantityAfter: out.quantity,
                becameOutOfStock: out.quantity <= 0 && qtyBefore > 0
            });
        }

        const total = sold.reduce((sum, l) => sum + l.lineTotal, 0);
        return { items: sold, total, supermarketId: String(sid) };
    });
}

/**
 * Daily report for one supermarket + date (requirement #11), computed from the
 * recorded transactions — never from manually entered daily totals.
 * date format: 'YYYY-MM-DD'.
 */
async function dailyReport(supermarketId, date) {
    const sid = String(supermarketId || (await getDefaultSupermarketId()));
    const dayStart = date + 'T00:00:00';
    const dayEnd = date + 'T23:59:59.999Z';

    const movements = await pool.query(
        `SELECT movement_type,
                SUM(CASE WHEN change_qty < 0 THEN -change_qty ELSE 0 END) AS units_out,
                SUM(CASE WHEN change_qty > 0 THEN change_qty ELSE 0 END) AS units_in,
                COUNT(*) AS entries
         FROM stock_movements
         WHERE supermarket_id = $1 AND created_at >= $2 AND created_at <= $3
         GROUP BY movement_type`,
        [sid, dayStart, dayEnd]
    );

    const byType = {};
    movements.rows.forEach(r => {
        byType[r.movement_type] = {
            unitsOut: Number(r.units_out) || 0,
            unitsIn: Number(r.units_in) || 0,
            entries: Number(r.entries) || 0
        };
    });

    const orders = await pool.query(
        `SELECT COUNT(*) AS total_orders, COALESCE(SUM(total), 0) AS revenue
         FROM orders
         WHERE created_at >= $1 AND created_at <= $2 AND status <> 'cancelled'`,
        [dayStart, dayEnd]
    );

    const lowAndOut = await listInventory(sid);
    const timeline = await pool.query(
        `SELECT sm.created_at, sm.product_id, p.name AS product_name, sm.change_qty,
                sm.qty_before, sm.qty_after, sm.movement_type, sm.reference_type, sm.reference_id
         FROM stock_movements sm
         LEFT JOIN products p ON p.id = sm.product_id
         WHERE sm.supermarket_id = $1 AND sm.created_at >= $2 AND sm.created_at <= $3
         ORDER BY sm.id ASC`,
        [sid, dayStart, dayEnd]
    );

    const physical = byType[MOVEMENT_TYPES.PHYSICAL_SALE] || { unitsOut: 0, entries: 0 };
    const online = byType[MOVEMENT_TYPES.ONLINE_SALE] || { unitsOut: 0, entries: 0 };

    return {
        date,
        supermarketId: sid,
        totals: {
            physicalUnitsSold: physical.unitsOut,
            onlineUnitsSold: online.unitsOut,
            stockReceived: (byType[MOVEMENT_TYPES.RECEIVED] || {}).unitsIn || 0,
            adjustments: (byType[MOVEMENT_TYPES.ADJUSTMENT] || {}).entries || 0,
            damaged: (byType[MOVEMENT_TYPES.DAMAGED] || {}).unitsOut || 0,
            returned: (byType[MOVEMENT_TYPES.RETURNED] || {}).unitsIn || 0,
            cancelledRestores: (byType[MOVEMENT_TYPES.CANCELLED] || {}).unitsIn || 0,
            totalOrders: Number(orders.rows[0].total_orders) || 0,
            onlineRevenue: Number(orders.rows[0].revenue) || 0
        },
        lowStockProducts: lowAndOut.filter(i => i.low_stock),
        outOfStockProducts: lowAndOut.filter(i => i.out_of_stock),
        timeline: timeline.rows
    };
}

/**
 * Stock of every product at the END of a given day (requirement #12). Derived
 * from stock_movements (qty_after of each product's last movement up to
 * midnight) — no separate snapshot table needed; this IS the snapshot.
 */
async function endOfDayStock(supermarketId, date) {
    const sid = String(supermarketId || (await getDefaultSupermarketId()));
    const cutoff = date + 'T23:59:59.999Z';
    const res = await pool.query(
        `SELECT DISTINCT ON (product_id) product_id, qty_after, created_at
         FROM stock_movements
         WHERE supermarket_id = $1 AND created_at <= $2
         ORDER BY product_id, created_at DESC, id DESC`,
        [sid, cutoff]
    );
    return res.rows.map(r => ({ productId: String(r.product_id), quantity: Number(r.qty_after), at: r.created_at }));
}

module.exports = {
    MOVEMENT_TYPES,
    InsufficientStockError,
    getDefaultSupermarket,
    getDefaultSupermarketId,
    deductStock,
    addStock,
    adjustStock,
    recordPhysicalSale,
    getInventoryForProducts,
    listInventory,
    listRecentMovements,
    hasCancelledRestore,
    restoreCancelledOrder,
    IDENTIFIER_TYPES,
    resolveProductByIdentifier,
    identifierInUse,
    recordPhysicalSaleSession,
    dailyReport,
    endOfDayStock
};