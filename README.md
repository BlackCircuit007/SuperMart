# LordTempsMart

LordTempsMart is a supermarket shopping, ordering, inventory, payment, and operations platform. Customers shop online, staff operate online orders or physical POS sales, and administrators manage workers, products, reports, and exports.

## Overview

The application is a Node.js and Express web app backed by CockroachDB/PostgreSQL. The browser never owns inventory or payment truth. The server validates orders and payments, while `server/inventory.js` remains the single source of truth for stock reservations, physical sales, stock movements, and cancellation restores.

## Architecture

```text
Customer or Worker Browser
        |
frontend/*.html + frontend/js/*.js
        |
Node.js / Express API (server/index.js)
        |
        +--> CockroachDB/PostgreSQL (server/db.js)
        +--> Inventory service (server/inventory.js)
        +--> Flutterwave server verification
        +--> SSE broadcaster (server/events.js)
        +--> Brevo email (server/email.js)
```

## Technology Stack

- Node.js and Express
- CockroachDB/PostgreSQL with `pg`
- JWT authentication and `bcryptjs` password hashing
- Server-Sent Events for live worker notifications
- Flutterwave hosted checkout and server-side verification
- Brevo HTTP API for email
- Plain HTML, CSS, and JavaScript frontend
- Electron desktop wrapper

## Project Structure

- `frontend/`: customer, checkout, dashboard, worker, admin, and PWA pages.
- `frontend/js/api.js`: authenticated API client, cart helpers, exports, and SSE client.
- `frontend/css/style.css`: shared responsive styles.
- `server/index.js`: authentication, orders, payments, workers, reports, and exports.
- `server/inventory.js`: atomic inventory and stock movement operations.
- `server/db.js`: additive schema setup and migrations.
- `server/events.js`: in-memory SSE event broadcaster.
- `server/email.js`: Brevo transactional email integration.
- `electron/`: packaged desktop application wrapper.

## Installation and Running

```powershell
npm install
npm start
```

Open `http://localhost:3000`.

Development mode and icon generation:

```powershell
npm run dev
npm run icons
```

Build the Electron directory package with `npm run dist:dir`.

## Environment Variables

Copy `.env.example` to `.env`. Never commit real secrets.

```text
PORT=3000
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=replace-with-a-long-random-secret
```

Email:

```text
BREVO_API_KEY=your-brevo-api-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=LordTempsMart
OWNER_EMAIL=owner@example.com
BASE_URL=https://your-public-domain.example
```

Real bank transfer details are optional, but all three are required to enable transfer checkout:

```text
BANK_NAME=
BANK_ACCOUNT_NAME=
BANK_ACCOUNT_NUMBER=
```

Flutterwave requires:

```text
FLW_PUBLIC_KEY=FLWPUBK_TEST-your-public-key
FLW_SECRET_KEY=FLWSECK_TEST-your-secret-key
FLW_WEBHOOK_SECRET_HASH=your-webhook-secret-hash
```

`FLW_SECRET_KEY` is server-only and must never be placed in frontend code.

## Database Setup

Starting the server runs `db.init()`, which creates missing tables and applies additive migrations. Existing products, nullable barcodes, orders, payments, workers, inventory, stock movements, and audit history are preserved.

The schema includes users, products, optional unique barcodes, orders, carts, worker codes, payment verifications, inventory, stock movements, physical sales, POS idempotency records, integration logs, assignments, and audit logs.

## Customer Workflow

Customers browse/search products, add items to the server-backed cart, enter delivery details, and choose Cash on Delivery, Bank Transfer, or Flutterwave. The server validates identity, prices, quantities, payment method, and available stock before creating an order.

Online orders reserve stock atomically through the existing inventory service. Opening checkout, submitting transfer proof, or initializing Flutterwave does not create an additional inventory deduction.

## Worker System

- `ONLINE`: customer orders, delivery information, COD collection, transfer verification, and online order status.
- `PHYSICAL`: barcode/name lookup, physical POS sales, and inventory operations required by POS.
- `UNIVERSAL`: both online and physical operations.

Worker capabilities are enforced on the server. Admins choose worker types and can activate/deactivate workers. Deactivation is soft, so historical IDs, names, assignments, actions, and reports remain available.

## POS and Barcode

POS supports product-name search and barcode scanning. USB/Bluetooth scanners can type into the barcode field and press Enter. Barcode lookup resolves to the internal product ID before the existing physical-sale inventory flow runs.

- `product.id` is the internal database identifier.
- `product.barcode` is an optional unique scanning identifier.
- Empty barcodes are allowed and duplicate barcodes are rejected.
- Unknown or out-of-stock barcodes are not added.
- Scanning does not deduct stock; Complete Sale does.

## Payments

- Cash on Delivery: order starts `pending`; an authenticated ONLINE or UNIVERSAL worker collects cash and changes payment to `verified`.
- Bank Transfer: order and verification remain `pending` until a worker verifies or rejects the submitted reference/details. Rejection changes payment to `failed` and restores reserved stock through the existing inventory service.
- Flutterwave: the server initializes the official hosted checkout and verifies transaction ID, reference, amount, currency, and status. Webhooks are signature-checked and idempotent.

The existing stored values are `pending`, `verified`, and `failed`; screens display pending, paid, and failed labels.

## Inventory and Notifications

`server/inventory.js` locks inventory rows in transactions, prevents negative stock, records movements, mirrors the legacy product stock field, and restores cancelled/failed reservations exactly once.

`server/events.js` broadcasts SSE events. Online events reach ONLINE and UNIVERSAL workers; physical events reach PHYSICAL and UNIVERSAL workers. The database remains the durable source of truth, so dashboards reload current state after reconnecting.

## Admin, Reporting, and Export

Admins manage products, barcodes, workers, worker types, activation state, orders, inventory, reports, and exports. Reports include product/order data, daily inventory reports, date-range summaries, payment/status breakdowns, online versus physical totals, averages, daily trends, and worker activity. CSV exports are available for orders, products, and the operations audit log.

## Security

JWT authentication, bcrypt password hashing, server-side worker capability checks, admin-only reporting/product routes, parameterized SQL, server-side payment verification, conditional payment transitions, transaction-locked inventory, and authenticated actor identity protect the main workflows. Flutterwave secrets are never returned to the browser.

## Testing

There is currently no automated test suite configured in `package.json`. Available checks are:

```powershell
node --check server/index.js
node --check server/db.js
node --check server/events.js

```

A release test should cover customer checkout, all payment methods, duplicate payment actions, worker permissions, barcode scanning, POS completion, cancellation restoration, SSE reconnects, reports, exports, and layouts at 320px, 390px, 768px, 1024px, 1280px, and 1440px or wider.

## Production Configuration

Use a reachable database host, a strong unique JWT secret, a public HTTPS `BASE_URL`, real bank details before enabling transfer, valid Flutterwave keys, and a public `/api/webhooks/flutterwave` URL. Confirm `/api/health` after deployment.

## Known Limitations

- SSE is in-memory and only reaches clients connected to the same server process; multi-instance deployments need a shared event broker.
- Flutterwave live testing requires provider credentials and a public webhook URL.
- Transfer proof stores a reference, notes, and optional proof URL; binary upload storage is not implemented.
- No automated test suite is currently included.
- Local database-backed tests require network/DNS access to the configured database host.
