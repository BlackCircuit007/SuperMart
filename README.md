# LordTempsMart

**LordTempsMart** is a full-featured supermarket e-commerce and operations platform for a skin-care & provisions store. Customers shop and pay online, staff run online orders and physical point-of-sale (POS) counter sales with a barcode scanner, workers upload products, and the administrator (the CEO) manages workers, products, inventory, payments, reports, exports, and a full audit trail.

The system is built so that **the browser never owns the truth**: all inventory and payment decisions are validated on the server and stored durably in CockroachDB/PostgreSQL. Live updates reach screens over Server-Sent Events (SSE), while the database stays the source of truth for every dashboard reload.

## Table of Contents

1. [Overview](#overview)
2. [Roles & Permissions](#roles--permissions)
3. [Feature Highlights](#feature-highlights)
4. [Technology Stack](#technology-stack)
5. [Architecture](#architecture)
6. [Project Structure](#project-structure)
7. [Pages (Frontend)](#pages-frontend)
8. [Getting Started](#getting-started)
9. [Environment Variables](#environment-variables)
10. [Database Schema](#database-schema)
11. [Authentication & Roles](#authentication--roles)
12. [Customer Workflow](#customer-workflow)
13. [Payments](#payments)
14. [Worker Portal](#worker-portal)
15. [Barcode Scanning](#barcode-scanning)
16. [Physical Sale & Receipt Printing](#physical-sale--receipt-printing)
17. [Admin Dashboard](#admin-dashboard)
18. [Reports & Exports](#reports--exports)
19. [Real-Time Event Stream (SSE)](#real-time-event-stream-sse)
20. [External POS Integration](#external-pos-integration)
21. [API Reference](#api-reference)
22. [Offline / Desktop (PWA + Electron)](#offline--desktop-pwa--electron)
23. [Security](#security)
24. [Testing](#testing)
25. [Production Configuration](#production-configuration)
26. [Known Limitations](#known-limitations)

## Overview

A **Node.js + Express** web app backed by **CockroachDB/PostgreSQL**. The frontend is plain **HTML/CSS/JavaScript** (no build step) served by Express, wrapped in a **PWA**, and packaged as an **Electron** desktop app for receipt printing at the counter.

The server owns all business rules:

- Products carry optional unique **SKU / barcode / QR identifiers**.
- Inventory rows are **transaction-locked** (`SELECT ... FOR UPDATE`) so two cashiers or two customers can never oversell the same unit.
- Online orders **reserve stock atomically**; cancellations and failed payments restore it exactly once.
- Payments (cash on delivery, manual bank transfer, Flutterwave) are validated server-side — the browser can never dictate an amount.
- Every counter sale is recorded in its own table **and** mirrored into the payment ledger with the collecting worker's name for accountability.

## Roles & Permissions

| Role | Can do | Cannot do |
|------|--------|-----------|
| **Buyer** | Browse, search, cart, place orders (cash / transfer / Flutterwave), submit transfer verification, view own orders. | Manage workers, edit/delete products, view all orders, admin reports, record POS sales, see other customers' data. |
| **Worker — PHYSICAL** | POS: search/scan products, build & complete counter sales, view inventory + stock movements, **upload new products**. | View/modify online orders, verify transfers, admin reports/workers/stats. Locked to their dashboard when logged in. |
| **Worker — ONLINE** | View orders, assign orders, update statuses, verify/reject transfer payments, collect COD, view pending transfer payments. | Complete POS sales, write inventory movements, admin reports, manage workers. Locked to their dashboard when logged in. |
| **Worker — UNIVERSAL** | Everything PHYSICAL **and** ONLINE workers can do (both order types + POS). | Admin-only actions. |
| **Admin (CEO)** | Everything: all dashboard tabs (Products, Reports, Workers, Orders, Inventory, Physical Sales), edit/delete products, manage workers, all reports, CSV exports, audit log. | *(nothing)* — highest privilege. |

### Integrity rules that protect the business

- **Workers can add products** (stocking the shelf) but **only the admin can edit or delete** them or change price/stock.
- A logged-in worker is **redirected to their own dashboard** and cannot open the storefront, admin, cart, checkout, or buyer-dashboard pages. They may still reach **login / register / verify**, so they can create a normal **buyer** account if they want to shop as a customer with a separate login.
- Every role limit is enforced **server-side** by middleware — forging the frontend cannot grant extra powers.

## Feature Highlights

- Full online storefront: search, category filter, quick-view modal, persistent cart.
- **Lazy/on-demand loading** — pages fetch only what they show; staff portals defer hidden tabs until opened.
- **Instant catalog rendering** from a `localStorage` cache, then a background refresh from CockroachDB so repeat visits feel instant while prices/stock stay authoritative.
- Checkout with **Cash on Delivery**, **Bank Transfer** (works like COD: order placed immediately, reference verified afterwards — never disabled), and **Flutterwave**.
- **Barcode / SKU / QR scanning**; an unknown barcode opens a **quick-add** panel to register it into the database on the spot.
- **Physical POS sales**: session cart, cash/card/transfer, change calculation, atomic all-or-nothing stock deduction.
- **Professional receipt printing**: preview shows a **MERCHANT/STORE copy** and a **CUSTOMER copy**; print or close without printing.
- **Dedicated admin "Physical Sales" tab** listing every counter sale by collecting worker — independent of stock movements.
- **Live stat cards** on worker and admin dashboards that refresh automatically.
- **Real-time SSE updates**: new orders, payment confirmations, transfer submissions, physical sales, stock changes.
- **Reports**: product sales, date-range summary with payment/status breakdowns, daily inventory report, worker activity, CSV exports (orders/products/audit).
- **Audit trail** for every high-risk action, including which worker collected each physical payment.
- **PWA** installable app shell plus an **Electron** desktop build.
- **External POS integration** behind an API key with database-level idempotency.

## Technology Stack

- **Node.js + Express** — HTTP/API server and static file host
- **CockroachDB / PostgreSQL** via the `pg` driver
- **JWT** (`jsonwebtoken`) sessions + **bcryptjs** password hashing
- **Server-Sent Events (SSE)** for near-real-time updates (`server/events.js`)
- **Flutterwave** hosted checkout, server-side verification, webhook
- **Brevo** HTTP API for transactional email
- Plain **HTML / CSS / JavaScript** frontend (no framework, no build step)
- **PWA** (`manifest.json` + `sw.js`) and **Electron** desktop packaging

## Architecture

```text
  Customer / Worker / Admin Browser   (frontend/*.html, frontend/js/*.js)
                 |
                 v
        Node.js / Express API        (server/index.js)
                 |
                 +---> CockroachDB / PostgreSQL      (server/db.js)
                 +---> Inventory service (atomic)    (server/inventory.js)
                 +---> Flutterwave  (card / online transfer)
                 +---> Brevo email                   (server/email.js)
                 +---> SSE broadcaster               (server/events.js)
                 +---> External POS integration      (/api/pos/sales)
```

**Design decisions**

- `server/inventory.js` is the **single source of truth** for stock; every change runs in a locked transaction.
- `products.stock` is only a mirror kept in sync — the `inventory` table is authoritative.
- Staff SSE streams are supermarket-scoped using the worker's JWT.
- SSE is a *notification channel only*; reloading any dashboard re-reads database state.

## Project Structure

```
COPY TO SELL/
├── server/
│   ├── index.js         Routes: auth, orders, payments, workers, reports, exports
│   ├── db.js            Pool, additive schema/migrations, data helpers
│   ├── inventory.js     Atomic stock service, movements, daily/end-of-day reports
│   ├── events.js        In-memory SSE broadcaster
│   └── email.js         Brevo transactional email helpers
├── frontend/
│   ├── index.html       Storefront (featured + all products)
│   ├── products.html    Full catalog
│   ├── cart.html        Cart
│   ├── checkout.html    Shipping + payment method selection
│   ├── finally.html     Order confirmation
│   ├── dashboard.html   Buyer dashboard (overview + my orders)
│   ├── login.html       Login (email/password or worker code)
│   ├── register.html    Buyer self-registration
│   ├── verify.html      Email verification code entry
│   ├── worker.html      Worker portal (Products / Orders / Inventory tabs)
│   ├── admin.html       Admin portal (all management + report tabs)
│   ├── manifest.json    PWA manifest
│   ├── sw.js            Service worker
│   ├── css/style.css    Shared responsive styles
│   └── js/              api.js (client+SSE), data.js (cache), main.js (shared UI/guards)
├── electron/            Desktop wrapper (main.js, preload.js)
├── generate-icons.js    PWA/app icon generator
├── .env.example         Environment template
└── package.json         Scripts + Electron build config
```

## Pages (Frontend)

| Page | Purpose |
|------|---------|
| `index.html` | Public storefront — featured + full catalog with search & category filter. |
| `products.html` | Full catalog browsing. |
| `cart.html` | Cart contents, quantity adjust/remove, totals. |
| `checkout.html` | Shipping details + payment method; Transfer opens a **Transaction Panel** modal. |
| `finally.html` | Order confirmation showing payment state by method. |
| `dashboard.html` | Buyer dashboard — stat cards, order history, live status. |
| `login.html` | Email/password login plus worker-code login. |
| `register.html` | Buyer registration with email verification (workers are admin-created). |
| `verify.html` | 6-digit verification code entry. |
| `worker.html` | Staff portal — Products (upload), Orders (ONLINE), Inventory/POS (PHYSICAL); live stat cards. |
| `admin.html` | Owner portal — Products, Reports, Workers, Orders, Inventory, **Physical Sales**; live stat cards. |

All pages share `js/main.js`, which also enforces the **worker role guard**.

## Getting Started

**Requirements:** Node.js 18+, a CockroachDB/PostgreSQL database, npm.

```powershell
npm install
npm start          # -> http://localhost:3000
```

Development with auto-reload:

```powershell
npm run dev
```

Regenerate PWA icons:

```powershell
npm run icons
```

Electron desktop:

```powershell
npm run desktop     # run unpackaged
npm run dist:dir    # unpackaged build
npm run dist        # Windows NSIS installer
```

## Environment Variables

Copy `.env.example` to `.env`. **Never commit real secrets.**

### Core

```text
PORT=3000
DATABASE_URL=postgresql://user:password@host:port/dbname?sslmode=verify-full
JWT_SECRET=replace-with-a-long-random-secret
NODE_ENV=development
BASE_URL=https://your-public-domain.example   # builds email links
```

> `BASE_URL` falls back to `RENDER_EXTERNAL_URL`, then `http://localhost:PORT`.

### Email (Brevo HTTP API — no SMTP)

```text
BREVO_API_KEY=your-brevo-api-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=LordTempsMart
OWNER_EMAIL=owner@example.com
```

Used for verification codes, order confirmations, COD notices, payment-verification emails, worker credentials, and status updates.

### Bank transfer details

```text
BANK_NAME=
BANK_ACCOUNT_NAME=
BANK_ACCOUNT_NUMBER=
```

These populate the checkout **Transaction Panel**. When unset, transfer still works — the panel simply tells the customer to contact the store for account details and submit a reference.

### Flutterwave

```text
FLW_PUBLIC_KEY=FLWPUBK_TEST-your-public-key
FLW_SECRET_KEY=FLWSECK_TEST-your-secret-key      # SERVER ONLY
FLW_WEBHOOK_SECRET_HASH=your-webhook-secret-hash
```

Webhook URL: `https://your-domain.com/api/webhooks/flutterwave`
Enable events: `charge.completed`, `charge.noconf`, `charge.failed`.

### External POS

```text
POS_API_KEYS=key1:default,key2:store-b
```

External systems send header `x-pos-api-key: <key>`; each key maps to exactly one supermarket.

## Database Schema

`db.init()` runs on every start: creates missing tables and applies **additive migrations only**, preserving existing data.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `users` | Buyers, workers, admin | `id, name, email, password(bcrypt), role(buyer/worker/admin), is_verified, worker_type(ONLINE/PHYSICAL/UNIVERSAL), is_active` |
| `pending_registrations` | Buyer held until verified | `name, email, password` |
| `verification_codes` | 6-digit register codes | `email, code, purpose, expires_at, used` |
| `worker_codes` | Permanent worker login codes | `worker_id, login_code, is_used` |
| `products` | Catalog | `name, category, price, rating, description, image, gallery, featured, stock(mirror), sku*, barcode*, qr_identifier*, active, created_by, carton_enabled, units_per_carton, carton_price` |
| `product_price_history` | Price-change audit | `product_id, previous_price, new_price, changed_by, changed_at` |
| `categories` | Categories | `name, slug, active` |
| `supermarkets` | Stores (`default` first) | `name, slug, is_active` |
| `inventory` | **Authoritative stock per store+product** | `supermarket_id, product_id, quantity, low_stock_threshold` (UNIQUE pair) |
| `stock_movements` | Why stock changed | `inventory_id, product_id, change_qty, qty_before/after, movement_type, reference_type/id, actor_user_id, note` |
| `orders` | Online orders | `order_ref(unique), user_id, customer_*, shipping_address, customer_notes, payment_method, payment_status(pending/verified/failed), total, items(JSON), status, delivered, payment_provider, payment_transaction_id, assigned_worker_*, completed_at` |
| `carts` | One saved cart per user | `user_id(unique), items(JSON)` |
| `payment_verifications` | Payment ledger (transfers + recorded physical payments) | `order_ref, payer_name/phone/email, amount, transaction_ref, status, source('online'/'physical'), payment_notes, proof_url, processed_by(_name/_at)` |
| `physical_sales` | POS counter-sale receipts | `sale_ref(unique), supermarket_id, actor_user_id, actor_name, actor_worker_type, payment_method, amount_paid, change_due, total, items(JSON)` |
| `pos_transactions` | Idempotency ledger for external POS | `external_sale_id, supermarket_id, items_summary` (UNIQUE pair) |
| `audit_logs` | High-risk action trail | `actor_user_id/name/type, action, target_type/id, previous/new_status, details(JSON)` |
| `integration_logs` | Integration/reconciliation events | `event_type, supermarket_id, reference, detail` |

Movement types in `stock_movements`: `received`, `physical_sale`, `online_sale`, `adjustment`, `damaged`, `returned`, `cancelled`, `correction`.

Indexes exist on `(supermarket_id, created_at)`, `(product_id)`, plus unique indexes on product identifiers and category names.

## Authentication & Roles

- **Buyers** self-register (`/api/register`), receive a 6-digit email code, verify (`/api/verify` or a one-click emailed link), then log in with email/password. Unverified buyers cannot log in.
- **Workers are created only by the admin** (`POST /api/admin/workers`) who chooses `worker_type` (ONLINE / PHYSICAL / UNIVERSAL); credentials are emailed to the worker.
- **Sessions** are JWTs signed with `JWT_SECRET`, valid **7 days**, carrying `id, email, name, role, worker_type`; stored in `localStorage` and sent as `Authorization: Bearer <token>`.
- **Worker login codes** (`WK…`) are permanent credentials — not consumed on use.
- Middleware:
  - `authRequired` — valid token required
  - `adminRequired` — role must be `admin`
  - `workerOrAdminRequired` — worker or admin
  - `workerCapability('ONLINE'|'PHYSICAL')` — restricts workers by type (UNIVERSAL passes both), admins always pass, inactive workers rejected.

## Customer Workflow

1. Browse the storefront — products render instantly from cache, then refresh from the DB.
2. Search or filter by category; open **Quick View** for details/gallery.
3. Add to cart (unit or carton pricing where enabled); cart persists per account.
4. Checkout: shipping details + payment method → place order.
5. The server re-prices the cart from the database, reserves stock atomically, returns a reference like `TM12345678`.
6. Confirmation page + confirmation email; buyer tracks status on their dashboard.

Order statuses: `pending → processing → shipped → delivered`, or `cancelled`.
Payment statuses: `pending → verified` or `failed`.

Cancelling an order or failing a payment restores reserved stock exactly once.

## Payments

### 1. Cash on Delivery
Order starts `payment_status = pending`; an ONLINE/UNIVERSAL worker collects cash at delivery and marks it `verified`.

### 2. Bank Transfer (behaves like COD)
- Selecting Transfer places the order immediately as `pending` — **never disabled**, even without configured bank details.
- The Transaction Panel shows account details when configured (otherwise directs the customer to contact the store) and collects phone, exact amount, transaction reference, notes/proof link.
- Submission creates a `payment_verifications` row (`pending`, `source='online'`).
- An ONLINE/UNIVERSAL worker verifies or rejects it; rejection flips the order to `failed` **and restores reserved stock**.

### 3. Flutterwave (card / transfer / USSD)
- The server initializes the official hosted checkout using the **stored** order amount.
- `/api/payments/flutterwave/verify` validates transaction id, reference, amount, currency, status server-side before marking paid.
- The signature-checked webhook is idempotent and can confirm even if the browser closes mid-payment.

### Physical counter payments
Written to `physical_sales` **and** mirrored into the ledger as `verified` rows with `source='physical'`, stamped with the collecting worker's name — physical money is auditable like every other payment.

Stored values remain `pending`, `verified`, `failed`; UIs show friendly labels.

## Worker Portal (`worker.html`)

Live stat cards (**Products / Orders / Revenue**) refresh every 15 s and immediately on SSE events — no manual refresh needed.

| Tab | Who sees it | What it does |
|-----|-------------|--------------|
| **Products** | All workers | **Upload new products** (name, category, price, description, up to 5 images, barcode, carton settings, stock, featured). Workers can add but not edit/delete — the Delete control only appears for an admin. |
| **Orders** | ONLINE & UNIVERSAL | All online orders with customer info, payment badge (CASH ON DELIVERY / BANK TRANSFER / FLUTTERWAVE), payment + order status; actions: assign to self, update status, collect COD. Below it, **Pending Transfer Payments** with Verify/Reject buttons. |
| **Inventory** | PHYSICAL & UNIVERSAL | The POS: product search, barcode scan field, sale session, payment panel (cash/card/bank transfer), Complete Sale, receipt printing, Current Stock table, Stock Movements table. |

Tab visibility is enforced in the UI *and* re-checked on the server.

## Barcode Scanning

Any USB/Bluetooth scanner works — it "types" the code and presses Enter; the scan field treats Enter as Add and keeps focus for rapid repeated scans.

- Lookup order: **internal id → SKU → barcode → QR**, always resolving to `product.id`. Name, price and stock always come from the database.
- Empty barcodes are allowed; duplicate identifiers are rejected server-side.
- Out-of-stock products are refused.
- Scanning does **not** deduct stock — completing the sale does.
- **Unknown barcode?** A **Quick-Add panel** opens pre-filled with the scanned code: enter name (+ price/stock/category) and the product is registered with that barcode and added straight into the sale, so future scans identify it automatically.

## Physical Sale & Receipt Printing

### Completing a sale
1. Scan/search products into the session (unit or carton lines with live availability).
2. Choose payment method — cash requires an amount covering the total and shows change.
3. **Complete Sale** runs one atomic transaction: all lines deduct or nothing does.

On success the sale is written to `physical_sales` (with worker name/type), a verified row is added to the payment ledger, a stock movement is recorded per line, an audit entry attributes the sale to that worker, and SSE notifies staff/admin.

### Receipt preview & printing
After completion a **Receipt Preview** pops up showing:

- **MERCHANT / STORE COPY**
- **CUSTOMER COPY**

Each copy shows store name, receipt number, date, cashier, itemised lines (item, qty, unit, amount), total, cash/change or paid-by method, and a thank-you footer.

Buttons: **🖨 Print** (browser print dialog; print CSS hides everything except the receipt) and **Close** (cancel without printing). A **🖨 Receipt** button beside *Complete Sale* re-opens the last receipt at any time.

Run the Electron desktop build to print to a physically attached receipt printer.

## Admin Dashboard (`admin.html`)

Live stat cards — **Products, Orders, Revenue, Customers, Workers, Pending Payments** — refreshed every 15 s and immediately on SSE sale/payment events.

| Tab | Contents |
|-----|----------|
| **📦 Products** | Add product (images, category + inline creation, price, barcode, carton settings, stock, rating, featured) and manage/delete products. |
| **📊 Reports** | Report Centre (date range → totals, payment-method breakdown, worker activity); Product Sales Report comparing online vs physical; CSV export buttons. |
| **👷 Workers** | Add workers (name, email, type), list, activate/deactivate, delete. |
| **📋 Orders** | All online orders with customer details, payment badge/status, order status, date. |
| **📦 Inventory** | Live stock per product with In/Low/Out badges plus Stock Movements explaining every change. |
| **🧾 Physical Sales** | Dedicated report of every counter sale: receipt ref, date, collecting worker (+type), payment method, item count, total — auditable independently of stock movements. |

Admin also receives SSE banners for completed physical sales and confirmed payments.

## Reports & Exports

- **Product sales report** — units and revenue per product across online orders *and* physical sales.
- **Date-range summary** — online orders, physical sales, online/physical revenue, paid total, pending/failed payments, completed/cancelled orders, average order value, breakdown by payment method, per-day trends, worker activity.
- **Daily inventory report** — units in/out by movement type, revenue, and an end-of-day stock snapshot derived from `stock_movements`.
- **CSV exports** — Orders, Products, Audit log.

## Real-Time Event Stream (SSE)

`GET /api/stream` — long-lived connection; staff pass their JWT as `?token=` for a supermarket-scoped staff stream.

| Event | Payload highlights | Audience |
|-------|--------------------|----------|
| `stock_changed` | productId, quantity, inStock | Public / PHYSICAL |
| `product_out_of_stock` | productId, quantity 0 | Public / PHYSICAL |
| `product_back_in_stock` | productId | Public / PHYSICAL |
| `online_order_created` | orderRef, customer, items, total | ONLINE / UNIVERSAL |
| `payment_verification_submitted` | orderRef, reference, notes | ONLINE / UNIVERSAL |
| `payment_confirmed` | orderRef, total, provider | ONLINE / UNIVERSAL |
| `payment_failed` | orderRef | ONLINE / UNIVERSAL |
| `cod_payment_collected` | orderRef | ONLINE / UNIVERSAL |
| `physical_sale_recorded` | total, itemCount | PHYSICAL / UNIVERSAL + admin |
| `order_cancelled` | orderRef | Staff |

Broadcaster rules:

- Type-scoped workers only receive their own events (ONLINE ↔ online, PHYSICAL ↔ physical); UNIVERSAL receives both.
- Events carrying a `supermarketId` never reach clients of a different store.
- Unscoped clients (the public site) receive everything public.

The frontend uses these to patch stock badges in place, show worker notification banners, refresh dashboards, and keep stat cards live. Because SSE is only a notification channel, reloading always re-reads authoritative database state.

## External POS Integration

Wire a real third-party POS till to the same stock pool:

```http
POST /api/pos/sales
x-pos-api-key: <key>
Content-Type: application/json

{
  "external_sale_id": "POS-2024-000123",
  "items": [ { "identifier": "5051397000015", "quantity": 2 },
             { "productId": 7, "quantity": 1 } ]
}
```

Guarantees:

- **Database-level idempotency** — the UNIQUE `(supermarket_id, external_sale_id)` constraint makes double-deduction impossible even under concurrent retries.
- Identifiers resolve server-side; the POS can never dictate prices.
- Insufficient stock returns HTTP 409 and rolls back the whole session.
- Every attempt is written to `integration_logs` for reconciliation.

## API Reference

### Auth & Account
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/register` | public | Buyer registration → pending registration + emailed code |
| POST | `/api/verify` | public | Verify code → creates verified user + JWT |
| POST | `/api/verify/resend` | public | Resend verification code |
| POST | `/api/auth/email-login` | public | One-click sign-in via emailed token |
| POST | `/api/login` | public | Email/password **or** worker-code login |
| GET | `/api/me` | auth | Current user profile |
| POST | `/api/test-email` | public | Email config smoke test |

### Products & Categories
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/products` | public | Catalog enriched with live inventory fields |
| GET | `/api/products/:id` | public | Single product |
| GET | `/api/categories` | public | Category list |
| GET | `/api/admin/products` | admin | Full list incl. creator details |
| POST | `/api/products` | **worker / admin** | Add product (+ initialises inventory row) |
| PUT | `/api/products/:id` | admin | Edit price/stock/name/identifiers (logs price history) |
| DELETE | `/api/products/:id` | admin | Delete product |
| POST | `/api/categories` | admin | Create category |
| GET | `/api/products/search?q=` | PHYSICAL / admin | Bounded staff search |
| GET | `/api/products/barcode/:barcode` | PHYSICAL / admin | Barcode lookup |
| GET | `/api/products/lookup?identifier=` | PHYSICAL / admin | Resolve id/SKU/barcode/QR |

### Cart & Orders
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET / POST | `/api/cart` | auth | Read / save the buyer's cart |
| POST | `/api/orders` | auth | Place order; `payment_method`: `cash` \| `transfer` \| `flutterwave` |
| GET | `/api/orders` | auth | Current buyer's orders |
| GET | `/api/admin/orders` | ONLINE / admin | All orders |
| POST | `/api/admin/orders/:id/assign` | ONLINE / admin | Assign order to self |
| PUT | `/api/admin/orders/:id` | ONLINE / admin | Update status/payment/delivered (cancel restores stock) |

### Payments
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/payments/transfer-config` | auth | Transfer configuration + account details |
| POST | `/api/payments/verify` | auth (buyer) | Submit transfer reference for an order |
| GET | `/api/payments/verify/:id` | link | Email-link approve transfer |
| GET | `/api/payments/reject/:id` | link | Email-link reject transfer |
| GET | `/api/admin/payments/pending` | ONLINE / admin | Pending verifications |
| POST | `/api/admin/payments/:id/verify` | ONLINE / admin | Approve → order paid |
| POST | `/api/admin/payments/:id/reject` | ONLINE / admin | Reject → failed + stock restored |
| POST | `/api/admin/orders/:id/collect-cash` | ONLINE / admin | Mark COD collected |
| POST | `/api/payments/flutterwave/initialize` | auth | Hosted-checkout params for an order ref |
| POST | `/api/payments/flutterwave/verify` | auth | Server-side transaction verification |
| POST | `/api/webhooks/flutterwave` | signature-checked | Idempotent webhook confirmation |

### Inventory & POS
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/admin/inventory` | PHYSICAL / admin | Stock snapshot + recent movements |
| POST | `/api/admin/inventory/physical-sale-session` | PHYSICAL / admin | Record whole counter sale atomically |
| POST | `/api/admin/inventory/physical-sales` | PHYSICAL / admin | Legacy single-product sale endpoint |
| POST | `/api/pos/sales` | external API key | Idempotent external POS sale |

### Workers
| Method | Endpoint | Access |
|--------|----------|--------|
| POST | `/api/admin/workers` | admin (emails credentials/code) |
| GET | `/api/admin/workers` | admin |
| PUT | `/api/admin/workers/:id` | admin (type / activation) |
| DELETE | `/api/admin/workers/:id` | admin |

### Stats, Reports & Exports
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/admin/stats` | admin | Totals, per-product sales (online+physical), recent orders |
| GET | `/api/worker/stats` | worker / admin | Worker dashboard totals |
| GET | `/api/admin/reports/daily?date=` | admin | Daily movement/revenue report + end-of-day stock |
| GET | `/api/admin/reports/summary?from=&to=` | admin | Range summary with breakdowns & worker activity |
| GET | `/api/admin/physical-sales` | admin | Physical Sales tab — counter sales by worker |
| GET | `/api/admin/integration-logs` | admin | Integration/reconciliation feed |
| GET | `/api/admin/export/orders` | admin | Orders CSV |
| GET | `/api/admin/export/products` | admin | Products CSV |
| GET | `/api/admin/export/movements` | admin | **Stock movements CSV** |
| GET | `/api/admin/export/audit` | admin | Audit log CSV |
| POST | `/api/admin/history/purge` | admin | Permanently delete `movements` or `orders` (+ their payment records) between two dates — audited |

### Misc
| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/stream` | public (`?token=` for staff) | SSE event stream |
| GET | `/api/health` | public | Uptime/DB health probe |

## Offline / Desktop (PWA + Electron)

- **PWA**: `frontend/manifest.json` + `sw.js` make the store installable with an offline app shell. Regenerate icons with `npm run icons`.
- **Electron** (`npm run desktop`, packaged via `npm run dist`): wraps the same frontend, exposes `window.LordTempsDesktop` (`isDesktop`, update notifications, external links), points the API base at the local origin, and is the recommended way to run the POS with a receipt printer attached.

## Security

- **JWT auth** (7-day expiry) + **bcryptjs** password hashing.
- **Role middleware on every route** — admin-only reports/exports/worker management; per-endpoint worker capability checks; inactive workers rejected.
- **Integrity separation** — workers add products but never edit/delete them; only admins change price/stock or remove records. Workers are locked to their dashboard in the UI, with the server as the real gate.
- **Parameterised SQL** throughout — no string-built queries.
- **Server-side payment verification** — amounts always come from stored orders; Flutterwave secrets never reach the browser; webhook signatures verified.
- **Conditional payment transitions** — payments only move `pending → verified/failed`; duplicates return 409.
- **Transaction-locked inventory** — row locks prevent oversell; cancellations/failures restore stock exactly once.
- **Attributed actor identity** — every high-risk action records who did it, including which worker collected a physical payment.
- **POS isolation** — each API key maps to exactly one supermarket; database-level idempotency prevents replay.

## Testing

No automated test suite yet. Available syntax checks:

```powershell
node --check server/index.js
node --check server/db.js
node --check server/events.js
node --check server/inventory.js
```

Inline page scripts can be parsed the same way (extract each `<script>` block and run it through `vm.Script`).

A release test pass should cover: checkout for all three payment methods, duplicate payment actions, transfer verify/reject with stock restore, worker permissions per type, barcode scanning incl. quick-add of unknown barcodes, POS completion + receipt printing, cancellation restores, SSE reconnects, report/export accuracy, live stat refresh, and responsive layouts from 320 px upward (tables scroll instead of squashing).

## Production Configuration

- Reachable database host and a **strong unique `JWT_SECRET`**.
- Public HTTPS `BASE_URL` so email links resolve.
- Real bank details before enabling transfer instructions.
- Live Flutterwave keys plus a public webhook URL.
- Confirm `GET /api/health` after deployment.
- Serve over HTTPS so PWA features work.

## Known Limitations

- **SSE is in-memory** — clients only receive events from the same process; horizontal scaling needs Redis Pub/Sub or similar.
- **Flutterwave live testing** requires provider credentials and a public webhook URL.
- Transfer proof stores reference/notes/optional URL; binary upload storage is not implemented.
- Receipt printing uses the browser print dialog — no direct ESC/POS driver integration.
- No automated test suite included.
- Database-backed tests require network access to the configured host.
- Product images upload as data URLs into the database rather than object storage.

---

*LordTempsMart v2.0.0 — MIT licensed.*