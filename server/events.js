// server/events.js
// -----------------------------------------------------------------------------
// Minimal in-memory Server-Sent Events (SSE) broadcaster for near-real-time
// inventory updates. This is the lift for Phase 2 requirement #7: it centralises
// the events that will eventually need live broadcasting so the app is ready
// for Socket.IO / WebSockets / SSE without adding a heavy dependency today.
//
// Events emitted (each carries an `event` type + JSON payload):
//   stock_changed             { productId, quantity, in_stock }
//   product_out_of_stock      { productId, quantity }
//   product_back_in_stock     { productId, quantity }
//   online_order_created      { orderRef, status }
//   physical_sale_recorded    { productId, quantity }
//   order_cancelled           { orderRef }
//
// This is in-memory only: clients connected to THIS server process receive
// events. For multiple servers / true horizontal scale you would move the bus
// to Redis Pub/Sub. It does NOT persist events (the database remains the source
// of truth; SSE is only a live notification channel).
// -----------------------------------------------------------------------------

const clients = new Set();

const EVENT_TYPES = {
    STOCK_CHANGED: 'stock_changed',
    PRODUCT_OUT_OF_STOCK: 'product_out_of_stock',
    PRODUCT_BACK_IN_STOCK: 'product_back_in_stock',
    ONLINE_ORDER_CREATED: 'online_order_created',
    PHYSICAL_SALE_RECORDED: 'physical_sale_recorded',
    ORDER_CANCELLED: 'order_cancelled',
    PAYMENT_CONFIRMED: 'payment_confirmed'
};

/**
 * Registered SSE clients receive the `event:` stream. Add a low-level client
 * object ({ res, alive:true }) directly; the owner is responsible for marking
 * it dead and removing it on disconnect.
 */
function subscribeClient(client) {
    clients.add(client);
    return client;
}

function unsubscribeClient(client) {
    client.alive = false;
    clients.delete(client);
}

/**
 * Convenience wrappers for an Express SSE route. `subscribe(res)` sets the SSE
 * headers on `res`, registers a client, and returns a cleanup function to call
 * (or set on `res.on('close')`) when the connection closes.
 */
function subscribe(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write('retry: 3000\n\n');

    const client = { res, alive: true };
    subscribeClient(client);

    return () => {
        if (client.alive) unsubscribeClient(client);
    };
}

/**
 * Broadcast an event to all connected SSE clients. Never throws — a failing
 * client is removed so one bad connection cannot break the bus.
 *
 * Supermarket isolation (Phase 4 requirement #4/#16): when payload carries a
 * `supermarketId`, clients scoped to a DIFFERENT supermarket do not receive it.
 * Unscoped clients (the customer website) still receive everything.
 */
function publish(event, payload) {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    const scopeId = (!payload || typeof payload !== 'object') ? null : String(payload.supermarketId || '');
    for (const client of Array.from(clients)) {
        if (!client.alive) continue;
        // Staff streams are scoped: worker of store A never sees store B events.
        if (scopeId && client.supermarketId && String(client.supermarketId) !== scopeId) continue;
        try {
            client.res.write(`event: ${event}\ndata: ${data}\n\n`);
        } catch (err) {
            client.alive = false;
            clients.delete(client);
        }
    }
}

module.exports = { EVENT_TYPES, subscribe, subscribeClient, unsubscribeClient, publish };