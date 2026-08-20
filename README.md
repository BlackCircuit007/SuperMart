# TriumphsMart — Skin Care & Provisions Store

A full-stack e-commerce store for skin care and provisions with a real backend database, email verification, admin panel with reports and CSV export, and worker management.

## Features

### Core Features
- **Responsive Design** — Fully responsive across all device sizes (mobile, tablet, desktop)
- **Skin Care + Provisions Only** — Shop is focused on premium skin care products and quality provisions
- **Real Database** — All data stored in a JSON file database (`data/triumphmart.json`) on the server
- **Admin Panel** — Login with `admin@triumphsmart.com` / `admin123`
  - Add products with **5 image upload slots**
  - Name, description, price, rating, category, stock, and featured flag
  - Remove any product with one click
  - **Reports tab** — See how many times each product was ordered
  - **CSV Export** — Export orders and product reports as CSV
  - **Worker Management** — Add workers who receive generated login codes via email
  - **Order Management** — View all customer orders
- **User Dashboard** — Registered users get a personal dashboard showing:
  - Their profile
  - Cart items and cart value
  - Order history with order references
- **User Authentication** — Register with email verification (code sent to email, NOT shown on screen)
- **Worker Authentication** — Workers log in with a generated login code sent to their email
- **Shopping Cart** — Add to cart, change quantities, remove items, server-side cart storage
- **Quick View Modal** — Preview product details without leaving the page
- **Search & Filters** — Real-time search with debounce, category/price/rating filters
- **Order Checkout** — Place orders with shipping info and payment method
- **Email Notifications** — 
  - Verification code sent to email on registration
  - Order confirmation sent to customer
  - Cash on Delivery notification sent to owner
  - Payment verification email with **Verify/Reject buttons** sent to owner
  - Worker credentials sent to worker's email
- **Toast Notifications** — Friendly feedback for all actions

## Pages

| Page | Description |
|---|---|
| `index.html` | Home page with hero, categories, and featured picks |
| `products.html` | Full catalog with search, category/price/rating filters |
| `cart.html` | Shopping cart with quantity controls |
| `checkout.html` | Shipping info, payment method, order summary |
| `finally.html` | Order confirmation with reference number |
| `login.html` | Login page (also the admin login entry) |
| `register.html` | Registration with email verification |
| `verify.html` | Email verification code entry |
| `dashboard.html` | User dashboard: profile, cart, orders |
| `admin.html` | Admin panel: products, reports, workers, orders |

## Admin Access

Email: `admin@triumphsmart.com`
Password: `admin123`

## Worker Access

Workers are added by the admin. Each worker receives:
- A **username** (generated from their name)
- A **login code** (e.g., `WK8F3K2A123`)

They log in via the worker login section on the login page.

## How to Run

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser at:
```
http://localhost:3000
```

## Email Configuration

The app uses Nodemailer with Gmail SMTP. Configure in `.env`:

```
EMAIL_ADDRESS=your-email@gmail.com
EMAIL_APP_PASSWORD=your-gmail-app-password
```

To get a Gmail App Password:
1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification
3. Go to App Passwords
4. Generate a new app password for "Mail"
5. Use that password in `.env`

## Database

All data is stored in `data/triumphmart.json`. This includes:
- Users (buyers, workers, admin)
- Products
- Orders
- Verification codes
- Worker login codes
- Payment verifications
- Carts

## Technologies

- **Backend**: Node.js, Express
- **Database**: JSON file database (no external DB needed)
- **Email**: Nodemailer (Gmail SMTP)
- **Auth**: JWT (JSON Web Tokens)
- **Frontend**: HTML5 / CSS3 / JavaScript (ES6)
- **Security**: bcrypt password hashing