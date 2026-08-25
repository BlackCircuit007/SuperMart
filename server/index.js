const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { pool } = db;
const inventory = require('./inventory');
const emailService = require('./email');
const events = require('./events');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'LordTempmart_super_secret_key_2026';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ===== Auth Middleware =====
function authRequired(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function adminRequired(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

function workerOrAdminRequired(req, res, next) {
    if (!req.user || (req.user.role !== 'worker' && req.user.role !== 'admin')) {
        return res.status(403).json({ error: 'Worker or Admin access required' });
    }
    next();
}

// ===== Helper functions =====
// Send email in the background without blocking the response.
// Prevents request failures when the email provider is slow or unreachable.
function sendEmailInBackground(emailPromise) {
    Promise.race([
        emailPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Email send timed out')), 10000))
    ]).catch(err => console.error('Background email error:', err.message));
}

async function sendEmailWithTimeout(emailPromise) {
    return Promise.race([
        emailPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Email send timed out')), 10000))
    ]);
}

function generateOrderRef() {
    return 'TM' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100);
}

function generateLoginCode() {
    return 'WK' + Math.random().toString(36).slice(2, 8).toUpperCase() + Math.floor(100 + Math.random() * 900);
}

function generateUsername(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    return base + Math.floor(100 + Math.random() * 900);
}

function createSessionToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function createEmailLoginToken(user, expiresIn) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role, purpose: 'email_login' },
        JWT_SECRET,
        { expiresIn: expiresIn || '24h' }
    );
}

// One-click sign-in link for a pending (pre-verification) buyer registration.
// Clicking it from the verification email materializes the pending registration
// into a verified user and logs the buyer straight into the dashboard.
function createVerifyLinkToken(registration) {
    return jwt.sign(
        { id: registration.id, email: registration.email, name: registration.name, purpose: 'verify_link' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function publicUrl(pathname) {
    // Fallback chain: explicit BASE_URL -> Render auto-detected URL -> localhost dev
    const baseUrl = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    return baseUrl + pathname;
}

async function createVerificationCode(user) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.insert('verification_codes', {
        email: user.email,
        code,
        purpose: 'register',
        expires_at: expiresAt,
        used: 0,
        created_at: new Date().toISOString()
    });

    return code;
}

// Small helper to create an HTTP error carrying a status code.
function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// Enrich a product (or array of products) with the authoritative inventory
// fields. Reads the inventory table (source of truth); products.stock remains
// only a backward-compatible mirror. Populates:
//   stock_quantity, in_stock, low_stock, availability
async function enrichProductsWithInventory(products) {
    const list = Array.isArray(products) ? products : [products];
    if (list.length === 0) return;

    let invMap = null;
    try {
        const supermarketId = await inventory.getDefaultSupermarketId();
        invMap = await inventory.getInventoryForProducts(supermarketId);
    } catch (err) {
        console.log('Inventory enrichment unavailable:', err ? err.message : err);
        invMap = null;
    }

    list.forEach((p) => {
        // Fallback to the legacy mirror only if inventory could not be read.
        const fallbackQty = Number(p.stock) || 0;
        const row = invMap ? (invMap[String(p.id)] || null) : null;
        const qty = row ? row.quantity : fallbackQty;
        const threshold = row ? row.low_stock_threshold : 5;
        p.stock = qty; // keep the mirror name current for older views
        p.stock_available = qty;
        p.in_stock = qty > 0;
        p.low_stock = qty > 0 && qty <= threshold;
        p.availability = qty > 0 ? (qty <= threshold ? 'LOW_STOCK' : 'IN_STOCK') : 'OUT_OF_STOCK';
    });
}

// ===== AUTH ROUTES =====

// Register (buyer only - workers are added by admin)
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const normalizedEmail = email.toLowerCase();
        // A real account can only exist after verification. The legacy branch
        // below lets older unverified accounts recover without creating a
        // second user row.
        const existing = await db.findBy('users', u => u.email === normalizedEmail);
        if (existing) {
            if (Number(existing.is_verified) === 0 && existing.role === 'buyer') {
                const code = await createVerificationCode(existing);
                const existingLoginUrl = publicUrl(`/verify.html?token=${encodeURIComponent(createEmailLoginToken(existing, '7d'))}`);
                sendEmailInBackground(emailService.sendVerificationEmail(existing.email, existing.name, code, existingLoginUrl));
                return res.status(200).json({
                    message: 'This account is awaiting verification. A fresh verification code has been sent to your email.',
                    userId: existing.id,
                    verificationCode: code
                });
            }
            return res.status(400).json({ error: 'Email already registered. Please log in instead.' });
        }

        const pending = await db.findBy('pending_registrations', p => p.email === normalizedEmail);
        const hashedPassword = await bcrypt.hash(password, 10);

        const registration = pending
            ? await db.update('pending_registrations', pending.id, { name, password: hashedPassword, created_at: new Date().toISOString() })
            : await db.insert('pending_registrations', { name, email: normalizedEmail, password: hashedPassword, created_at: new Date().toISOString() });
        const code = await createVerificationCode(registration);

        // A real user row is NOT created yet — only a pending registration.
        // The verification email is sent via Brevo HTTP API (no SMTP, no EmailJS).
        // The user row is created in /api/verify after the code is confirmed.
        const dashboardUrl = publicUrl(`/verify.html?token=${encodeURIComponent(createVerifyLinkToken(registration))}`);
        sendEmailInBackground(emailService.sendVerificationEmail(registration.email, registration.name, code, dashboardUrl));

        res.status(201).json({
            message: 'Verification code created. A verification email has been sent to your inbox.',
            verificationCode: code
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Verify email code
app.post('/api/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const records = await db.findAll('verification_codes', vc =>
            vc.email === email.toLowerCase() && vc.code === code && vc.purpose === 'register' && Number(vc.used) === 0
        );
        const record = records[records.length - 1];

        if (!record) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        // Check expiry
        if (new Date(record.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Verification code has expired' });
        }

        const normalizedEmail = email.toLowerCase();
        const pending = await db.findBy('pending_registrations', p => p.email === normalizedEmail);
        let user = await db.findBy('users', u => u.email === normalizedEmail);
        if (pending) {
            user = await db.insert('users', {
                name: pending.name,
                email: pending.email,
                password: pending.password,
                role: 'buyer',
                is_verified: 1,
                profile_pic: null,
                created_at: new Date().toISOString()
            });
            await db.remove('pending_registrations', pending.id);
        } else if (user) {
            // Legacy unverified records from before this change can still be verified.
            user = await db.update('users', user.id, { is_verified: 1 });
        } else {
            return res.status(400).json({ error: 'No pending registration was found. Please register again.' });
        }

        await db.update('verification_codes', record.id, { used: 1 });

        // Generate token
        const token = createSessionToken(user);

        res.json({
            message: 'Account verified successfully!',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Verify error:', err);
        res.status(500).json({ error: 'Server error during verification' });
    }
});

// Resend verification code
app.post('/api/verify/resend', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const normalizedEmail = email.toLowerCase();
        const user = await db.findBy('users', u => u.email === normalizedEmail);
        const pending = await db.findBy('pending_registrations', p => p.email === normalizedEmail);
        if (!user && !pending) {
            return res.status(404).json({ error: 'No pending registration found. Please register again.' });
        }

        if (user && Number(user.is_verified) === 1) {
            return res.status(400).json({ error: 'Account is already verified' });
        }

        const recipient = pending || user;
        const code = await createVerificationCode(recipient);

        // Magic link that verifies the account and opens the dashboard (no SMTP, no EmailJS)
        const dashboardUrl = pending
            ? publicUrl(`/verify.html?token=${encodeURIComponent(createVerifyLinkToken(pending))}`)
            : publicUrl(`/verify.html?token=${encodeURIComponent(createEmailLoginToken(user, '7d'))}`);
        sendEmailInBackground(emailService.sendVerificationEmail(recipient.email, recipient.name, code, dashboardUrl));

        res.json({
            message: 'A fresh verification code has been sent to your email.',
            verificationCode: code
        });
    } catch (err) {
        console.error('Resend verification error:', err);
        res.status(500).json({ error: 'Server error during resend' });
    }
});

// Exchange a short-lived link from an account email for a normal browser
// session. For buyers, opening this link also completes email verification.
app.post('/api/auth/email-login', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Sign-in link is required' });

        const payload = jwt.verify(token, JWT_SECRET);
        const isVerifyLink = payload.purpose === 'verify_link';
        if ((!isVerifyLink && payload.purpose !== 'email_login') || !payload.id || !payload.email) {
            return res.status(400).json({ error: 'Invalid sign-in link' });
        }

        let user;
        if (isVerifyLink) {
            // Magic link from the verification email. The buyer only has a
            // pending registration, so materialize it into a verified user and
            // log them in straight to the dashboard.
            const pending = await db.getById('pending_registrations', payload.id);
            if (!pending || pending.email !== payload.email) {
                return res.status(400).json({ error: 'This sign-in link is no longer valid' });
            }
            const existing = await db.findBy('users', u => u.email === pending.email);
            if (existing) {
                return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
            }
            user = await db.insert('users', {
                name: pending.name,
                email: pending.email,
                password: pending.password,
                role: 'buyer',
                is_verified: 1,
                profile_pic: null,
                created_at: new Date().toISOString()
            });
            await db.remove('pending_registrations', pending.id);
        } else {
            user = await db.getById('users', payload.id);
            if (!user || user.email !== payload.email || user.role !== payload.role) {
                return res.status(400).json({ error: 'This sign-in link is no longer valid' });
            }
            // Legacy: an unverified buyer clicking an email-login link is verified on sign-in.
            if (user.role === 'buyer' && Number(user.is_verified) === 0) {
                await db.update('users', user.id, { is_verified: 1 });
            }
        }

        res.json({
            message: isVerifyLink ? 'Account verified and signed in!' : 'Signed in successfully',
            token: createSessionToken(user),
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(400).json({ error: 'This sign-in link has expired. Please request a new one.' });
        }
        console.error('Email login error:', err);
        res.status(400).json({ error: 'Invalid sign-in link' });
    }
});

// Login (buyers, workers, admin)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, loginCode } = req.body;

        // Check if it's a worker login with code.
        // Codes are PERMANENT credentials — they are NOT consumed on login.
        // (The old one-time-use design locked workers out forever after their
        // first sign-in, forcing repeated row deletions and re-adds.)
        if (loginCode) {
            const normalizedCode = String(loginCode).trim().toUpperCase();
            const workerCode = await db.findBy('worker_codes', wc =>
                String(wc.login_code).trim().toUpperCase() === normalizedCode);
            if (!workerCode) {
                return res.status(400).json({ error: 'Invalid login code' });
            }

            const user = await db.getById('users', workerCode.worker_id);
            if (!user || user.role !== 'worker') {
                return res.status(400).json({ error: 'Invalid login code' });
            }
            const token = createSessionToken(user);

            return res.json({
                message: 'Welcome back!',
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            });
        }

        if (!email) {
            return res.status(400).json({ error: 'Email/Username is required' });
        }

        // Regular login with password
        const user = await db.findBy('users', u => u.email === email.toLowerCase());
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password || '', user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        if (Number(user.is_verified) === 0 && user.role === 'buyer') {
            return res.status(403).json({ error: 'Please verify your email first' });
        }

        const token = createSessionToken(user);

        res.json({
            message: 'Login successful!',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Get current user
app.get('/api/me', authRequired, async (req, res) => {
    try {
        const user = await db.getById('users', req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, is_verified: user.is_verified, profile_pic: user.profile_pic, created_at: user.created_at } });
    } catch (err) {
        console.error('Get me error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== PRODUCT ROUTES =====

// Get all products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE active = 1 ORDER BY id DESC');
        const products = result.rows;
        products.sort((a, b) => Number(b.id) - Number(a.id));
        await enrichProductsWithInventory(products);
        res.json({ products });
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Creator details are restricted to administrators; the public catalog does
// not expose staff identities.
app.get('/api/admin/products', authRequired, adminRequired, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, u.name AS created_by_name, u.email AS created_by_username
             FROM products p LEFT JOIN users u ON u.id = p.created_by
             ORDER BY p.id DESC`
        );
        await enrichProductsWithInventory(result.rows);
        res.json({ products: result.rows });
    } catch (err) {
        console.error('Get admin products error:', err);
        res.status(500).json({ error: 'Server error loading admin products' });
    }
});

// Staff search stays database-backed and returns a bounded result set.
app.get('/api/products/search', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const query = String(req.query.q || '').trim();
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
        if (!query) return res.json({ products: [] });
        const result = await pool.query(
            `SELECT * FROM products WHERE active = 1
             AND (name ILIKE $1 OR COALESCE(barcode, '') ILIKE $1)
             ORDER BY CASE WHEN barcode = $2 THEN 0 ELSE 1 END, name LIMIT $3`,
            ['%' + query + '%', query, limit]
        );
        await enrichProductsWithInventory(result.rows);
        res.json({ products: result.rows });
    } catch (err) {
        console.error('Product search error:', err);
        res.status(500).json({ error: 'Server error searching products' });
    }
});

app.get('/api/categories', async (req, res) => {
    try { res.json({ categories: await db.findAll('categories', c => c.active !== 0) }); }
    catch (err) { res.status(500).json({ error: 'Server error loading categories' }); }
});

app.post('/api/categories', authRequired, adminRequired, async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Category name is required' });
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const duplicate = await pool.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [name]);
        if (duplicate.rows.length) return res.status(409).json({ error: 'Category already exists' });
        const category = await db.insert('categories', { name, slug, active: 1, created_at: new Date().toISOString() });
        res.status(201).json({ category });
    } catch (err) { res.status(500).json({ error: 'Server error creating category' }); }
});

// Product identification lookup by internal id / SKU / barcode / QR identifier.
// NOTE: registered BEFORE '/api/products/:id' so 'lookup' is not eaten as an id.
app.get('/api/products/lookup', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const identifier = req.query.identifier;
        if (!identifier) return res.status(400).json({ error: 'identifier query parameter is required' });

        const found = await inventory.resolveProductByIdentifier(identifier);
        if (!found) {
            await logIntegration('invalid_identifier', null, String(identifier).slice(0, 64), 'No product matched');
            return res.status(404).json({ error: 'No product matches this identifier' });
        }

        await enrichProductsWithInventory(found.product);
        await logIntegration('product_lookup', null, String(found.product.id), 'matched via ' + found.identifierType);
        res.json({
            product: found.product,
            identifierType: found.identifierType,
            quantityAvailable: found.product.stock_available || 0,
            inStock: !!found.product.in_stock
        });
    } catch (err) {
        console.error('Product lookup error:', err);
        res.status(500).json({ error: 'Server error during lookup' });
    }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
    try {
        let product = await db.getById('products', req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        await enrichProductsWithInventory(product);
        res.json({ product });
    } catch (err) {
        console.error('Get product error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add product (admin & worker)
app.post('/api/products', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const { name, category, price, rating, description, image, gallery, featured, stock,
            sku, barcode, qr_identifier, active, carton_enabled, units_per_carton, carton_price } = req.body;
        if (!name || !price || !category) {
            return res.status(400).json({ error: 'Name, category and price are required' });
        }
        if (!Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'Price must be greater than zero' });
        if (carton_enabled && (!Number.isInteger(Number(units_per_carton)) || Number(units_per_carton) < 2 || !Number.isFinite(Number(carton_price)) || Number(carton_price) <= 0)) {
            return res.status(400).json({ error: 'Carton products need valid carton settings' });
        }

        // Duplicate-identifier guard (#6): the same physical product must not be
        // registered twice just because a different identifier type was scanned.
        for (const [label, value] of [['SKU', sku], ['Barcode', barcode], ['QR identifier', qr_identifier]]) {
            if (!value) continue;
            const inUse = await inventory.identifierInUse(value);
            if (inUse) {
                return res.status(409).json({
                    error: label + ' "' + value + '" is already used by product "' + inUse.name + '"'
                });
            }
        }

        const product = await db.insert('products', {
            name,
            category,
            price: parseFloat(price),
            rating: rating || 4.5,
            description: description || '',
            image: image || '🛍️',
            gallery: gallery || null,
            featured: featured ? 1 : 0,
            stock: stock || 0,
            sku: sku || null,
            barcode: barcode || null,
            qr_identifier: qr_identifier || null,
            created_by: req.user.id,
            active: active === undefined ? 1 : (active ? 1 : 0),
            carton_enabled: carton_enabled ? 1 : 0,
            units_per_carton: carton_enabled ? Number(units_per_carton) : null,
            carton_price: carton_enabled ? Number(carton_price) : null,
            created_at: new Date().toISOString()
        });

        // Create the inventory row (default supermarket) so the new product is
        // orderable immediately. Inventory is the single source of truth;
        // products.stock remains just a mirror kept in sync by the service.
        try {
            const supermarketId = await inventory.getDefaultSupermarketId();
            await inventory.adjustStock({
                supermarketId,
                productId: product.id,
                newQuantity: Number(stock) || 0,
                movementType: inventory.MOVEMENT_TYPES.RECEIVED,
                actorUserId: req.user.id,
                note: 'Initial stock set on product creation'
            });
        } catch (invErr) {
            console.error('Inventory initialisation error:', invErr.message);
        }

        res.status(201).json({ message: 'Product added successfully', product });
    } catch (err) {
        console.error('Add product error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update product (admin & worker)
app.put('/api/products/:id', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const { name, category, price, rating, description, image, gallery, featured, stock,
            sku, barcode, qr_identifier, active, carton_enabled, units_per_carton, carton_price } = req.body;
        const existing = await db.getById('products', req.params.id);
        if (!existing) return res.status(404).json({ error: 'Product not found' });

        // Stock changes are routed through the inventory service so they are recorded
        // as stock movements and kept atomic within a transaction. products.stock
        // is only a mirror of the inventory quantity.
        const newStock = stock !== undefined ? (Number(stock) || 0) : existing.stock;
        const nextPrice = price !== undefined ? Number(price) : Number(existing.price);
        if (!Number.isFinite(nextPrice) || nextPrice <= 0) return res.status(400).json({ error: 'Price must be greater than zero' });
        for (const [label, value] of [['SKU', sku], ['Barcode', barcode], ['QR identifier', qr_identifier]]) {
            if (value !== undefined && value) {
                const inUse = await inventory.identifierInUse(value, existing.id);
                if (inUse) return res.status(409).json({ error: label + ' is already used by another product' });
            }
        }
        if (carton_enabled && (!Number.isInteger(Number(units_per_carton)) || Number(units_per_carton) < 2 || !Number.isFinite(Number(carton_price)) || Number(carton_price) <= 0)) {
            return res.status(400).json({ error: 'Carton products need valid carton settings' });
        }

        const product = await db.update('products', existing.id, {
            name: name || existing.name,
            category: category || existing.category,
            price: nextPrice,
            rating: rating || existing.rating,
            description: description !== undefined ? description : existing.description,
            image: image || existing.image,
            gallery: gallery ? gallery : existing.gallery,
            featured: featured !== undefined ? (featured ? 1 : 0) : existing.featured,
            stock: newStock,
            sku: sku !== undefined ? (sku || null) : existing.sku,
            barcode: barcode !== undefined ? (barcode || null) : existing.barcode,
            qr_identifier: qr_identifier !== undefined ? (qr_identifier || null) : existing.qr_identifier,
            active: active !== undefined ? (active ? 1 : 0) : existing.active,
            carton_enabled: carton_enabled !== undefined ? (carton_enabled ? 1 : 0) : existing.carton_enabled,
            units_per_carton: carton_enabled ? Number(units_per_carton) : (carton_enabled === false ? null : existing.units_per_carton),
            carton_price: carton_enabled ? Number(carton_price) : (carton_enabled === false ? null : existing.carton_price)
        });

        if (Number(existing.price) !== nextPrice) await db.insert('product_price_history', {
            product_id: existing.id, previous_price: existing.price, new_price: nextPrice,
            changed_by: req.user.id, changed_at: new Date().toISOString()
        });

        if (stock !== undefined) {
            const supermarketId = await inventory.getDefaultSupermarketId();
            await inventory.adjustStock({
                supermarketId,
                productId: existing.id,
                newQuantity: newStock,
                movementType: inventory.MOVEMENT_TYPES.ADJUSTMENT,
                actorUserId: req.user.id,
                note: 'Admin updated stock'
            });
        }

        res.json({ message: 'Product updated', product });
    } catch (err) {
        console.error('Update product error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete product (admin & worker)
app.delete('/api/products/:id', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const result = await db.remove('products', req.params.id);
        if (!result) return res.status(404).json({ error: 'Product not found' });
        res.json({ message: 'Product deleted successfully' });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== INVENTORY & PHYSICAL-SALE ROUTES =====
// These are the clean internal interface that a future external POS/inventory
// integration (or the supermarket's own dashboard) can call. They reuse the same
// atomic inventory service as online orders — one source of truth.

// Log an integration event (requirement #21). NEVER logs secrets/API keys.
async function logIntegration(eventType, supermarketId, reference, detail) {
    try {
        await db.insert('integration_logs', {
            event_type: eventType,
            supermarket_id: supermarketId != null ? String(supermarketId) : null,
            reference: reference || null,
            detail: detail || null,
            created_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('integration log failed:', err.message);
    }
}

// Realtime event stream (Server-Sent Events). Long-lived GET.
// Staff pass their JWT as ?token=... so their stream is SCOPED to their
// supermarket — a worker for store A never receives store B events (#4/#16).
app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write('retry: 3000\n\n');

    const client = { res, alive: true, supermarketId: null };

    const token = req.query.token;
    if (token) {
        try {
            const decoded = jwt.verify(String(token), JWT_SECRET);
            if (decoded && (decoded.role === 'worker' || decoded.role === 'admin')) {
                client.staff = true;
                client.userId = decoded.id;
            }
        } catch (ignore) { /* invalid token -> public customer stream */ }
    }

    events.subscribeClient(client);
    res.on('close', () => { client.alive = false; events.unsubscribeClient(client); });
});

// Inventory dashboard snapshot for the staff dashboard: current stock + states
// for every product, plus recent stock movements.

// Record a WHOLE physical sale session (multiple products, all-or-nothing).
// Body: { items: [{ productId | product_id | identifier, quantity }], note?, external_sale_id? }
app.post('/api/admin/inventory/physical-sale-session', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const { items, note, external_sale_id, payment_method, amount_paid } = req.body;
        const paymentMethod = ['cash', 'card', 'bank_transfer'].includes(payment_method) ? payment_method : 'cash';

        // Idempotency for scanned sessions too (requirement #14): if this exact
        // external id was already processed, do NOT deduct stock again.
        const supermarketId = await inventory.getDefaultSupermarketId();
        if (external_sale_id) {
            const dup = await pool.query(
                'SELECT id FROM pos_transactions WHERE supermarket_id = $1 AND external_sale_id = $2',
                [String(supermarketId), String(external_sale_id)]
            );
            if (dup.rows.length > 0) {
                await logIntegration('duplicate_sale', supermarketId, external_sale_id, 'worker session replay ignored');
                return res.status(200).json({ message: 'This sale was already processed', duplicate: true, external_sale_id });
            }
        }

        // Resolve any identifier-based line to its authoritative product FIRST so
        // the caller never dictates identity or price (requirement #9).
        const resolvedItems = [];
        for (const item of (items || [])) {
            let productId = item.productId || item.product_id;
            if (!productId && item.identifier) {
                const found = await inventory.resolveProductByIdentifier(item.identifier);
                if (!found) {
                    await logIntegration('invalid_identifier', supermarketId,
                        String(item.identifier).slice(0, 64), 'physical-sale session');
                    return res.status(404).json({ error: 'Unknown product identifier: ' + item.identifier });
                }
                productId = found.product.id;
            }
            resolvedItems.push({ productId, quantity: item.quantity, purchaseType: item.purchaseType || item.purchase_type });
        }

        const result = await inventory.recordPhysicalSaleSession({
            supermarketId,
            items: resolvedItems,
            actorUserId: req.user.id,
            note,
            referenceType: external_sale_id ? 'pos_sale' : 'physical_sale',
            referenceId: external_sale_id || null,
            validatePayment: total => {
                if (paymentMethod === 'cash' && (!Number.isFinite(Number(amount_paid)) || Number(amount_paid) < total)) {
                    throw httpError(400, 'Cash received must cover the sale total');
                }
            }
        });

        const amountPaid = Number(amount_paid);
        const paid = paymentMethod === 'cash' ? amountPaid : result.total;
        const saleRef = external_sale_id || generateOrderRef();
        await db.insert('physical_sales', {
            sale_ref: saleRef,
            supermarket_id: String(supermarketId),
            actor_user_id: req.user.id,
            payment_method: paymentMethod,
            amount_paid: paid,
            change_due: Math.max(0, paid - result.total),
            total: result.total,
            items: JSON.stringify(result.items),
            created_at: new Date().toISOString()
        });

        if (external_sale_id) {
            await db.insert('pos_transactions', {
                external_sale_id: String(external_sale_id),
                supermarket_id: String(supermarketId),
                items_summary: JSON.stringify(result.items.map(i => ({ productId: i.productId, quantity: i.quantity }))),
                processed_at: new Date().toISOString()
            });
        }

        // Real-time events AFTER the transaction committed (requirement #19).
        result.items.forEach(line => {
            events.publish(events.EVENT_TYPES.STOCK_CHANGED, {
                productId: line.productId, quantity: line.quantityAfter,
                inStock: line.quantityAfter > 0, supermarketId: result.supermarketId
            });
            if (line.becameOutOfStock) {
                events.publish(events.EVENT_TYPES.PRODUCT_OUT_OF_STOCK, {
                    productId: line.productId, quantity: 0, supermarketId: result.supermarketId
                });
            }
        });
        events.publish(events.EVENT_TYPES.PHYSICAL_SALE_RECORDED, {
            total: result.total, itemCount: result.items.length, supermarketId: result.supermarketId
        });

        res.status(201).json({ message: 'Physical sale recorded', sale_ref: saleRef,
            payment_method: paymentMethod, amount_paid: paid,
            change_due: Math.max(0, paid - result.total), result });
    } catch (err) {
        if (err && err.name === 'InsufficientStockError') {
            return res.status(409).json({ error: err.message });
        }
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        console.error('Physical sale session error:', err);
        res.status(500).json({ error: 'Server error recording sale' });
    }
});

// Inventory dashboard snapshot for the staff dashboard: current stock + states
// for every product, plus recent stock movements.
app.get('/api/admin/inventory', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const inventoryList = await inventory.listInventory();
        const movements = await inventory.listRecentMovements(null, Number(req.query.limit) || 50);
        const lowStock = inventoryList.filter(i => i.low_stock);
        const outOfStock = inventoryList.filter(i => i.out_of_stock);
        res.json({ inventory: inventoryList, movements, lowStock, outOfStock });
    } catch (err) {
        console.error('Get inventory error:', err);
        res.status(500).json({ error: 'Server error loading inventory' });
    }
});

// Record a physical supermarket sale (worker/manager at the counter).
// Body: { product_id, quantity, note? }
app.post('/api/admin/inventory/physical-sales', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const { product_id, quantity, note } = req.body;
        const result = await inventory.recordPhysicalSale({
            productId: product_id,
            quantity,
            actorUserId: req.user.id,
            note
        });
        events.publish(events.EVENT_TYPES.PHYSICAL_SALE_RECORDED, { productId: result.productId, quantity: result.quantity });
        res.status(201).json({ message: 'Physical sale recorded', result });
    } catch (err) {
        if (err && err.name === 'InsufficientStockError') {
            return res.status(409).json({ error: err.message });
        }
        if (err && err.status) return res.status(err.status).json({ error: err.message });
        console.error('Physical sale error:', err);
        res.status(500).json({ error: 'Server error recording sale' });
    }
});

// Daily report (requirement #11) — computed from recorded transactions.
// GET /api/admin/reports/daily?date=YYYY-MM-DD
app.get('/api/admin/reports/daily', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const date = (req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
        }
        const report = await inventory.dailyReport(null, date);
        const snapshot = await inventory.endOfDayStock(null, date);
        res.json({ report, endOfDayStock: snapshot });
    } catch (err) {
        console.error('Daily report error:', err);
        res.status(500).json({ error: 'Server error building report' });
    }
});

// Integration log feed for admins (reconciliation debugging, requirement #20).
// Discrepancies with an external POS are investigated from this history —
// synchronization with external systems is never assumed to be guaranteed.
app.get('/api/admin/integration-logs', authRequired, adminRequired, async (req, res) => {
    try {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        const rows = await pool.query(
            'SELECT * FROM integration_logs ORDER BY id DESC LIMIT $1', [limit]);
        res.json({ logs: rows.rows });
    } catch (err) {
        console.error('integration logs error:', err);
        res.status(500).json({ error: 'Server error loading integration logs' });
    }
});

// ===== POS INTEGRATION API (external systems) ================================
// Contract for a REAL supermarket POS once we know which system that
// supermarket uses and what integration mechanism it provides. This is NOT a
// claim of universal POS compatibility (requirement #26).
//
// Auth (#15):  header  x-pos-api-key: <key>
// Keys come from env so no secret is hard-coded or exposed to the frontend:
//   POS_API_KEYS="keyA:default,keyB:store-b"
// Each key maps to EXACTLY ONE supermarket (#16 isolation).
function resolvePosKey(apiKey) {
    const raw = process.env.POS_API_KEYS || '';
    const entries = raw.split(',').map(s => s.trim()).filter(Boolean);
    for (const entry of entries) {
        const idx = entry.lastIndexOf(':');
        if (idx <= 0) continue;
        const key = entry.slice(0, idx).trim();
        const slug = entry.slice(idx + 1).trim();
        if (key && apiKey && key === apiKey) return { key, slug };
    }
    return null;
}

app.post('/api/pos/sales', async (req, res) => {
    try {
        const mapping = resolvePosKey(req.get('x-pos-api-key'));
        if (!mapping) {
            await logIntegration('auth_failure', null, null, 'POS request rejected (bad/missing API key)');
            return res.status(401).json({ error: 'Invalid POS credentials' });
        }

        const superRes = await db.findBy('supermarkets', s => s.slug === mapping.slug);
        if (!superRes) {
            await logIntegration('invalid_supermarket', null, mapping.slug, 'POS key mapped to unknown store');
            return res.status(400).json({ error: 'POS key maps to an unknown supermarket' });
        }
        const supermarketId = String(superRes.id);

        const { external_sale_id, items } = req.body;
        if (!external_sale_id) return res.status(400).json({ error: 'external_sale_id is required (idempotency)' });
        if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array is required' });

        // Idempotency at the DATABASE level (#14): the UNIQUE index on
        // (supermarket_id, external_sale_id) makes double-processing impossible,
        // even when two retries arrive concurrently.
        try {
            await db.insert('pos_transactions', {
                external_sale_id: String(external_sale_id),
                supermarket_id: supermarketId,
                items_summary: JSON.stringify(items.slice(0, 50)),
                processed_at: new Date().toISOString()
            });
        } catch (dupErr) {
            await logIntegration('duplicate_sale', supermarketId, external_sale_id, 'POS retry ignored');
            return res.status(200).json({ message: 'Transaction already processed', duplicate: true, external_sale_id });
        }

        // Resolve identifiers to products — the POS cannot dictate prices (#9).
        const resolvedItems = [];
        for (const item of items) {
            let productId = item.productId || item.product_id;
            if (!productId && item.identifier) {
                const found = await inventory.resolveProductByIdentifier(item.identifier);
                if (!found) {
                    await logIntegration('invalid_identifier', supermarketId,
                        String(item.identifier).slice(0, 64), 'pos sale ' + external_sale_id);
                    return res.status(404).json({ error: 'Unknown product identifier: ' + item.identifier });
                }
                productId = found.product.id;
            }
            if (!productId) return res.status(400).json({ error: 'Each item needs productId or identifier' });
            resolvedItems.push({ productId, quantity: item.quantity, purchaseType: item.purchaseType || item.purchase_type });
        }

        let result;
        try {
            result = await inventory.recordPhysicalSaleSession({
                supermarketId,
                items: resolvedItems,
                actorUserId: null,
                note: 'POS sale ' + external_sale_id + ' (' + mapping.slug + ')',
                referenceType: 'pos_sale',
                referenceId: String(external_sale_id)
            });
        } catch (saleErr) {
            // Remove the ledger row so a corrected retry can succeed later.
            await db.removeWhere('pos_transactions',
                t => String(t.supermarket_id) === supermarketId && String(t.external_sale_id) === String(external_sale_id));
            if (saleErr && saleErr.name === 'InsufficientStockError') {
                await logIntegration('insufficient_stock', supermarketId, external_sale_id, saleErr.message);
                return res.status(409).json({ error: saleErr.message });
            }
            throw saleErr;
        }

        result.items.forEach(line => {
            events.publish(events.EVENT_TYPES.STOCK_CHANGED, {
                productId: line.productId, quantity: line.quantityAfter,
                inStock: line.quantityAfter > 0, supermarketId
            });
            if (line.becameOutOfStock) {
                events.publish(events.EVENT_TYPES.PRODUCT_OUT_OF_STOCK, {
                    productId: line.productId, quantity: 0, supermarketId
                });
            }
        });
        events.publish(events.EVENT_TYPES.PHYSICAL_SALE_RECORDED, {
            total: result.total, itemCount: result.items.length, source: 'pos', supermarketId
        });

        await logIntegration('pos_sale_processed', supermarketId, external_sale_id,
            'items=' + result.items.length + ' total=' + result.total);

        res.status(201).json({
            message: 'POS sale processed',
            external_sale_id,
            total: result.total,
            items: result.items.map(i => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice }))
        });
    } catch (err) {
        console.error('POS sale error:', err);
        res.status(500).json({ error: 'Server error processing POS sale' });
    }
});

// ===== ORDER ROUTES =====

// Place order
app.post('/api/orders', authRequired, async (req, res) => {
    try {
        const { customer_name, customer_email, customer_phone, shipping_address, customer_notes, payment_method, items, total } = req.body;

        if (!customer_name || !customer_email || !customer_phone || !shipping_address || !payment_method || !items || items.length === 0 || !Number.isFinite(Number(total)) || Number(total) <= 0) {
            return res.status(400).json({ error: 'All order fields are required' });
        }
        if (!['cash', 'transfer', 'flutterwave'].includes(payment_method)) {
            return res.status(400).json({ error: 'Invalid payment method' });
        }

        const orderRef = generateOrderRef();

        // Place the order inside ONE database transaction so it is all-or-nothing:
        //   1) lock each inventory row (FOR UPDATE),
        //   2) verify enough stock and atomically reduce it (online_sale movement),
        //   3) recompute the total from the database (never trust the client),
        //   4) insert the order.
        // If ANY item lacks enough stock, the whole transaction rolls back and no
        // reservation/order is created — this prevents overselling the same unit.
        let createdOrder = null;
        try {
            createdOrder = await db.withTransaction(async (client) => {
                const supermarketId = await inventory.getDefaultSupermarket(client);
                let serverTotal = 0;
                const validatedItems = [];

                for (const item of items) {
                    const productId = String(item.id);
                    const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

                    const prodRes = await client.query(
                        'SELECT id, name, price, active, carton_enabled, units_per_carton, carton_price FROM products WHERE id = $1',
                        [productId]
                    );
                    if (prodRes.rows.length === 0) throw httpError(400, 'Product not found: ' + productId);
                    const prod = prodRes.rows[0];
                    if (prod.active === 0) throw httpError(409, 'Product is inactive: ' + prod.name);
                    const purchaseType = item.purchase_type === 'carton' ? 'carton' : 'unit';
                    if (purchaseType === 'carton' && (!prod.carton_enabled || !prod.units_per_carton || !prod.carton_price)) {
                        throw httpError(400, 'Carton purchase is not available for "' + prod.name + '"');
                    }
                    const selectedQuantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
                    const inventoryQuantity = purchaseType === 'carton'
                        ? selectedQuantity * Number(prod.units_per_carton)
                        : selectedQuantity;

                    // Atomic, row-locked stock deduction. Throws if insufficient.
                    await inventory.deductStock(client, {
                        supermarketId,
                        productId: prod.id,
                        productName: prod.name,
                        quantity: inventoryQuantity,
                        movementType: inventory.MOVEMENT_TYPES.ONLINE_SALE,
                        referenceType: 'order',
                        referenceId: orderRef,
                        actorUserId: req.user.id,
                        note: 'Stock reserved for online order ' + orderRef
                    });

                    const unitPrice = Number(prod.price);
                    const selectedPrice = purchaseType === 'carton' ? Number(prod.carton_price) : unitPrice;
                    validatedItems.push({
                        id: String(prod.id), name: prod.name, quantity: selectedQuantity,
                        purchase_type: purchaseType, price: selectedPrice,
                        units_per_carton: purchaseType === 'carton' ? Number(prod.units_per_carton) : null,
                        line_total: selectedPrice * selectedQuantity
                    });
                    serverTotal += selectedPrice * selectedQuantity;
                }

                const orderRow = await client.query(
                    `INSERT INTO orders (order_ref, user_id, customer_name, customer_email, customer_phone,
                        shipping_address, customer_notes, payment_method, payment_status, total, items, status, delivered, created_at, payment_provider)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
                    [
                        orderRef, String(req.user.id), customer_name, customer_email, customer_phone,
                        shipping_address, customer_notes || null, payment_method, 'pending', serverTotal.toFixed(2),
                        JSON.stringify(validatedItems), 'pending', 0, new Date().toISOString(),
                        payment_method === 'flutterwave' ? 'flutterwave' : null
                    ]
                );
                return orderRow.rows[0];
            });
        } catch (txErr) {
            // Map our known business errors to useful HTTP responses.
            if (txErr && txErr.code === 'INSUFFICIENT_STOCK') {
                return res.status(409).json({ error: txErr.message });
            }
            if (txErr && txErr.status) {
                return res.status(txErr.status).json({ error: txErr.message });
            }
            throw txErr;
        }

        const orderData = {
            orderRef,
            customer_name,
            customer_email,
            customer_phone,
            shipping_address,
            customer_notes: createdOrder.customer_notes || null,
            payment_method,
            total: createdOrder.total,
            items: JSON.parse(createdOrder.items)
        };

        // Send emails in the background via Brevo HTTP API (no SMTP, no EmailJS)
        sendEmailInBackground(emailService.sendOrderConfirmationEmail(orderData));
        if (payment_method === 'cash') {
            sendEmailInBackground(emailService.sendCashOnDeliveryEmail(orderData));
        }

        // Live worker notification + realtime stock sync (requirements #3/#4/#17/#19).
        // Emitted only AFTER the database transaction committed successfully.
        const notifiedItems = JSON.parse(createdOrder.items);
        const supermarketIdStr = await inventory.getDefaultSupermarketId();
        events.publish(events.EVENT_TYPES.ONLINE_ORDER_CREATED, {
            orderRef,
            status: 'pending',
            orderStatus: 'NEW',
            customerName: createdOrder.customer_name,
            customerPhone: createdOrder.customer_phone,
            customerEmail: createdOrder.customer_email,
            shippingAddress: createdOrder.shipping_address,
            customerNotes: createdOrder.customer_notes || '',
            orderTime: createdOrder.created_at,
            paymentMethod: createdOrder.payment_method,
            paymentStatus: createdOrder.payment_status,
            total: Number(createdOrder.total),
            itemCount: notifiedItems.length,
            items: notifiedItems.map(i => ({ name: i.name, quantity: i.quantity })),
            supermarketId: supermarketIdStr
        });
        notifiedItems.forEach(i => {
            events.publish(events.EVENT_TYPES.STOCK_CHANGED, {
                productId: String(i.id), supermarketId: supermarketIdStr
            });
        });

        res.status(201).json({
            message: 'Order placed successfully',
            orderRef,
            orderId: createdOrder.id
        });
    } catch (err) {
        console.error('Place order error:', err);
        res.status(500).json({ error: 'Server error placing order' });
    }
});

// Get user's orders
app.get('/api/orders', authRequired, async (req, res) => {
    try {
        const orders = await db.findAll('orders', o => String(o.user_id) === String(req.user.id));
        orders.sort((a, b) => Number(b.id) - Number(a.id));
        res.json({ orders });
    } catch (err) {
        console.error('Get orders error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all orders (admin/worker)
app.get('/api/admin/orders', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const orders = await db.getAll('orders');
        orders.sort((a, b) => Number(b.id) - Number(a.id));
        res.json({ orders });
    } catch (err) {
        console.error('Get all orders error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update order status (admin/worker)
app.put('/api/admin/orders/:id', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const { status, payment_status, delivered } = req.body;
        const existing = await db.getById('orders', req.params.id);
        if (!existing) return res.status(404).json({ error: 'Order not found' });

        const newStatus = (status || existing.status).toLowerCase();
        const oldStatus = (existing.status || '').toLowerCase();
        const isCancelling = newStatus === 'cancelled';
        const wasCancelled = oldStatus === 'cancelled';

        // Cancellation restores reserved stock. This is done atomically inside a
        // transaction with the status change, and is idempotent:
        //  - stock is only restored on a genuine transition INTO cancelled (not a
        //    repeated cancelled->cancelled call), AND
        //  - we guard against any existing 'cancelled' movement for the order.
        // This is safe even if the endpoint is submitted twice.
        let restoredItems = [];
        try {
            if (isCancelling && !wasCancelled) {
                const handle = await db.withTransaction(async (client) => {
                    const alreadyRestored = await inventory.hasCancelledRestore(client, existing.order_ref);
                    if (alreadyRestored) {
                        // A restore movement already exists — do not restore again.
                        restoredItems = [];
                        return { restoredItems: [], alreadyRestored: true };
                    }
                    let items = [];
                    try { items = JSON.parse(existing.items || '[]'); } catch (e) { items = []; }
                    const restored = await inventory.restoreCancelledOrder(client, {
                        orderRef: existing.order_ref,
                        items,
                        actorUserId: req.user.id,
                        note: 'Stock restored because order ' + existing.order_ref + ' was cancelled'
                    });
                    return { restoredItems: restored, alreadyRestored: false };
                });
                restoredItems = handle.restoredItems;
                if (restoredItems.length > 0) {
                    const sid = await inventory.getDefaultSupermarketId();
                    events.publish(events.EVENT_TYPES.ORDER_CANCELLED, { orderRef: existing.order_ref, supermarketId: sid });
                    // Restored lines may bring a product back above zero (#17).
                    for (const line of restoredItems) {
                        const invMap = await inventory.getInventoryForProducts(sid);
                        const qty = invMap[line.productId] ? invMap[line.productId].quantity : 0;
                        events.publish(events.EVENT_TYPES.STOCK_CHANGED, {
                            productId: line.productId, quantity: qty, inStock: qty > 0, supermarketId: sid
                        });
                        if (qty > 0) {
                            events.publish(events.EVENT_TYPES.PRODUCT_BACK_IN_STOCK, {
                                productId: line.productId, quantity: qty, supermarketId: sid
                            });
                        }
                    }
                }
            }
        } catch (restoreErr) {
            console.error('Stock restore on cancel failed:', restoreErr.message);
            return res.status(500).json({ error: 'Order status could not be changed (stock restore failed). Please retry.' });
        }

        const updatedOrder = await db.update('orders', existing.id, {
            status: newStatus,
            payment_status: payment_status || existing.payment_status,
            delivered: delivered !== undefined ? (delivered ? 1 : 0) : (status === 'delivered' ? 1 : existing.delivered)
        });

        const affected = restoredItems.length;
        sendEmailInBackground(emailService.sendOrderStatusEmail(updatedOrder));

        res.json({
            message: 'Order updated',
            status: newStatus,
            stock_restored: affected,
            restored_items: restoredItems
        });
    } catch (err) {
        console.error('Update order error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== PAYMENT VERIFICATION ROUTES =====

// Submit payment verification
app.post('/api/payments/verify', authRequired, async (req, res) => {
    try {
        const { order_ref, payer_name, payer_phone, payer_email, amount, transaction_ref, payment_notes, proof_url } = req.body;
        if (!order_ref || !payer_phone || !amount || !transaction_ref || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
            return res.status(400).json({ error: 'All payment details are required' });
        }

        const order = await db.findBy('orders', o => o.order_ref === order_ref && String(o.user_id) === String(req.user.id));
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.payment_method !== 'transfer') {
            return res.status(400).json({ error: 'This order does not require transfer verification' });
        }
        if (order.payment_status !== 'pending') {
            return res.status(409).json({ error: 'This order payment has already been processed' });
        }
        if (Math.abs(Number(order.total) - Number(amount)) > 0.01) {
            return res.status(400).json({ error: 'Payment amount does not match the order total' });
        }

        const existingPending = await db.findBy('payment_verifications', p =>
            p.order_ref === order_ref && p.status === 'pending');
        if (existingPending) {
            return res.status(409).json({ error: 'A payment verification is already pending for this order', paymentId: existingPending.id });
        }

        const payment = await db.insert('payment_verifications', {
            order_ref,
            payer_name,
            payer_phone,
            payer_email,
            amount: parseFloat(amount),
            transaction_ref,
            status: 'pending',
            payment_notes: payment_notes || null,
            proof_url: proof_url || null,
            created_at: new Date().toISOString()
        });

        const supermarketId = await inventory.getDefaultSupermarketId();
        events.publish(events.EVENT_TYPES.PAYMENT_VERIFICATION_SUBMITTED, {
            orderRef: order.order_ref,
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            customerEmail: order.customer_email,
            shippingAddress: order.shipping_address,
            total: Number(order.total),
            transactionRef: payment.transaction_ref,
            paymentNotes: payment.payment_notes || '',
            proofUrl: payment.proof_url || '',
            submittedAt: payment.created_at,
            paymentMethod: 'transfer',
            paymentStatus: 'pending',
            supermarketId
        });

        // Send verification email to owner via Brevo HTTP API (no SMTP, no EmailJS)
        sendEmailInBackground(emailService.sendPaymentVerificationEmail({
            paymentId: payment.id,
            orderRef: order_ref,
            payer_name,
            payer_phone,
            payer_email,
            amount,
            transaction_ref
        }));

        res.status(201).json({
            message: 'Payment verification submitted. The owner will verify your payment.',
            paymentId: payment.id
        });
    } catch (err) {
        console.error('Payment verify error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/payments/transfer-config', authRequired, async (req, res) => {
    const bankName = process.env.BANK_NAME || '';
    const accountName = process.env.BANK_ACCOUNT_NAME || '';
    const accountNumber = process.env.BANK_ACCOUNT_NUMBER || '';
    res.json({
        configured: Boolean(bankName && accountName && accountNumber),
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber
    });
});

async function resolveManualPayment(paymentId, outcome, actorUserId) {
    const nextPaymentRecordStatus = outcome === 'paid' ? 'verified' : 'rejected';
    const claimedPayment = await pool.query(
        `UPDATE payment_verifications SET status = $2
         WHERE id = $1 AND status = 'pending' RETURNING *`,
        [String(paymentId), nextPaymentRecordStatus]
    );
    if (claimedPayment.rows.length === 0) {
        const current = await db.getById('payment_verifications', paymentId);
        return { duplicate: true, payment: current };
    }

    const payment = claimedPayment.rows[0];
    const nextOrderStatus = outcome === 'paid' ? 'verified' : 'failed';
    const orderResult = await pool.query(
        `UPDATE orders SET payment_status = $2,
             status = CASE WHEN $2 = 'verified' AND status = 'pending' THEN 'processing'
                           WHEN $2 = 'failed' THEN 'failed' ELSE status END
         WHERE order_ref = $1 AND payment_status = 'pending' RETURNING *`,
        [payment.order_ref, nextOrderStatus]
    );
    const order = orderResult.rows[0] || await db.findBy('orders', o => o.order_ref === payment.order_ref);
    if (!order) throw new Error('Order not found for payment verification');

    const supermarketId = await inventory.getDefaultSupermarketId();
    const payload = {
        orderRef: order.order_ref,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        customerEmail: order.customer_email,
        total: Number(order.total),
        transactionRef: payment.transaction_ref,
        paymentNotes: payment.payment_notes || '',
        proofUrl: payment.proof_url || '',
        processedAt: new Date().toISOString(),
        provider: 'transfer',
        supermarketId
    };
    if (outcome === 'paid') {
        events.publish(events.EVENT_TYPES.PAYMENT_CONFIRMED, payload);
    } else {
        events.publish(events.EVENT_TYPES.PAYMENT_FAILED, payload);
        await restoreStockForFailedPayment(order);
    }
    await logIntegration('transfer_payment_' + outcome, supermarketId, order.order_ref,
        'payment verification ' + payment.id + ' by user ' + (actorUserId || 'system'));
    return { duplicate: false, payment, order };
}

app.post('/api/admin/payments/:id/verify', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const result = await resolveManualPayment(req.params.id, 'paid', req.user.id);
        res.json({ message: result.duplicate ? 'Payment was already processed' : 'Payment verified', duplicate: result.duplicate, payment_status: 'verified', order_ref: result.payment && result.payment.order_ref });
    } catch (err) {
        console.error('Worker payment verification error:', err);
        res.status(500).json({ error: 'Could not verify payment' });
    }
});

app.post('/api/admin/payments/:id/reject', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const result = await resolveManualPayment(req.params.id, 'failed', req.user.id);
        res.json({ message: result.duplicate ? 'Payment was already processed' : 'Payment rejected', duplicate: result.duplicate, payment_status: 'failed', order_ref: result.payment && result.payment.order_ref });
    } catch (err) {
        console.error('Worker payment rejection error:', err);
        res.status(500).json({ error: 'Could not reject payment' });
    }
});

app.post('/api/admin/orders/:id/collect-cash', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const claimed = await pool.query(
            `UPDATE orders SET payment_status = 'verified',
                 status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END
             WHERE id = $1 AND payment_method = 'cash' AND payment_status = 'pending' RETURNING *`,
            [String(req.params.id)]
        );
        if (claimed.rows.length === 0) {
            const current = await db.getById('orders', req.params.id);
            if (!current) return res.status(404).json({ error: 'Order not found' });
            return res.json({ message: 'Cash payment was already processed', duplicate: true, payment_status: current.payment_status });
        }
        const order = claimed.rows[0];
        const supermarketId = await inventory.getDefaultSupermarketId();
        events.publish(events.EVENT_TYPES.COD_PAYMENT_COLLECTED, {
            orderRef: order.order_ref,
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            customerEmail: order.customer_email,
            total: Number(order.total),
            provider: 'cash',
            paymentStatus: 'verified',
            collectedAt: new Date().toISOString(),
            supermarketId
        });
        events.publish(events.EVENT_TYPES.PAYMENT_CONFIRMED, {
            orderRef: order.order_ref,
            customerName: order.customer_name,
            customerPhone: order.customer_phone,
            customerEmail: order.customer_email,
            total: Number(order.total),
            provider: 'cash',
            paymentStatus: 'verified',
            supermarketId
        });
        res.json({ message: 'Cash payment collected', payment_status: 'verified' });
    } catch (err) {
        console.error('COD collection error:', err);
        res.status(500).json({ error: 'Could not collect cash payment' });
    }
});

app.get('/api/admin/payments/pending', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const payments = await db.findAll('payment_verifications', p => p.status === 'pending');
        const orders = await db.getAll('orders');
        const orderMap = {};
        orders.forEach(order => { orderMap[order.order_ref] = order; });
        res.json({ payments: payments.map(payment => ({
            ...payment,
            order: orderMap[payment.order_ref] || null
        })) });
    } catch (err) {
        console.error('Pending payments error:', err);
        res.status(500).json({ error: 'Could not load pending payments' });
    }
});

// Verify payment (from email button)
app.get('/api/payments/verify/:id', async (req, res) => {
    try {
        const payment = await db.getById('payment_verifications', req.params.id);
        if (!payment) return res.status(404).send('Payment verification not found');
        const result = await resolveManualPayment(payment.id, 'paid', 'email');
        if (result.duplicate) return res.status(409).send('Payment verification has already been processed');
        sendEmailInBackground(emailService.sendOrderStatusEmail(result.order));

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Payment Verified</title></head>
            <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f5f5f5; margin: 0;">
                <div style="background: #fff; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
                    <h1 style="color: #4caf50; margin: 0 0 10px;">Payment Verified!</h1>
                    <p style="color: #666;">Order ${payment.order_ref} has been marked as paid.</p>
                    <a href="/admin.html" style="display: inline-block; margin-top: 20px; background: #ff3b20; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Go to Admin Panel</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Verify payment error:', err);
        res.status(500).send('Server error');
    }
});

// Reject payment (from email button)
app.get('/api/payments/reject/:id', async (req, res) => {
    try {
        const payment = await db.getById('payment_verifications', req.params.id);
        if (!payment) return res.status(404).send('Payment verification not found');
        const result = await resolveManualPayment(payment.id, 'failed', 'email');
        if (result.duplicate) return res.status(409).send('Payment verification has already been processed');
        sendEmailInBackground(emailService.sendOrderStatusEmail(result.order));

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Payment Rejected</title></head>
            <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f5f5f5; margin: 0;">
                <div style="background: #fff; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <div style="font-size: 64px; margin-bottom: 20px;">❌</div>
                    <h1 style="color: #f44336; margin: 0 0 10px;">Payment Rejected</h1>
                    <p style="color: #666;">Order ${payment.order_ref} payment has been rejected.</p>
                    <a href="/admin.html" style="display: inline-block; margin-top: 20px; background: #ff3b20; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none;">Go to Admin Panel</a>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error('Reject payment error:', err);
        res.status(500).send('Server error');
    }
});

// ===== FLUTTERWAVE PAYMENT (online card / transfer) ==========================
// Adds online payments alongside the EXISTING cash + manual-transfer flows.
// Rules enforced here:
//   • Amount/currency ALWAYS come from the stored order, never the frontend.
//   • "PAID" = the app's existing payment_status 'verified', set ONLY after a
//     server-side verification call against Flutterwave's API.
//   • Idempotent: transitions use an atomic conditional UPDATE, so webhook +
//     callback + retries can all fire without double side-effects.
//   • FAILED restores reserved stock exactly once (same hasCancelledRestore
//     ledger guard used for order cancellations).
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || '';
const FLW_PUBLIC_KEY = process.env.FLW_PUBLIC_KEY || '';
const FLW_WEBHOOK_SECRET_HASH = process.env.FLW_WEBHOOK_SECRET_HASH || '';
const FLW_API_BASE = 'https://api.flutterwave.com/v3';
const FLW_CURRENCY = 'NGN';

async function flwVerifyTransaction(transactionId) {
    const res = await fetch(`${FLW_API_BASE}/transactions/${encodeURIComponent(transactionId)}/verify`, {
        headers: { 'Authorization': `Bearer ${FLW_SECRET_KEY}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || data.status !== 'success' || !data.data) {
        throw new Error((data && data.message) || `Flutterwave verify failed (HTTP ${res.status})`);
    }
    return data.data;
}

/**
 * Atomically apply a verified outcome to an order. The conditional UPDATE is
 * the idempotency guard: whichever caller (webhook, callback, retry) flips the
 * row first wins; everyone else sees changed=false and does nothing.
 */
async function applyPaymentOutcome(orderId, outcome, txId) {
    if (outcome === 'verified') {
        const claimed = await pool.query(
            `UPDATE orders
             SET payment_status = 'verified',
                 status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END,
                 payment_provider = 'flutterwave',
                 payment_transaction_id = $2
             WHERE id = $1 AND payment_status <> 'verified'
             RETURNING *`,
            [String(orderId), txId != null ? String(txId) : null]
        );
        return { changed: claimed.rowCount > 0, order: claimed.rows[0] || null };
    }
    if (outcome === 'failed') {
        const claimed = await pool.query(
            `UPDATE orders
             SET payment_status = 'failed',
                 status = 'failed',
                 payment_provider = 'flutterwave',
                 payment_transaction_id = $2
             WHERE id = $1 AND payment_status NOT IN ('verified','failed')
             RETURNING *`,
            [String(orderId), txId != null ? String(txId) : null]
        );
        return { changed: claimed.rowCount > 0, order: claimed.rows[0] || null };
    }
    return { changed: false, order: null };
}

/** Side-effects AFTER a successful claim — emitted once per order. */
async function emitPaymentConfirmed(order) {
    const sid = await inventory.getDefaultSupermarketId();
    events.publish(events.EVENT_TYPES.PAYMENT_CONFIRMED, {
        orderRef: order.order_ref,
        customerName: order.customer_name,
        total: Number(order.total),
        provider: 'flutterwave',
        transactionId: order.payment_transaction_id,
        supermarketId: sid
    });
    await logIntegration('payment_confirmed', sid, order.order_ref,
        'flutterwave tx ' + (order.payment_transaction_id || 'n/a'));
}

/** Restore reserved stock when a payment definitively failed (once only). */
async function restoreStockForFailedPayment(order) {
    try {
        let items = [];
        try { items = JSON.parse(order.items || '[]'); } catch (e) { items = []; }
        const restored = await db.withTransaction(async client => {
            const alreadyRestored = await inventory.hasCancelledRestore(client, order.order_ref);
            if (alreadyRestored) return [];
            const sid = await inventory.getDefaultSupermarket(client);
            return inventory.restoreCancelledOrder(client, {
                supermarketId: sid,
                orderRef: order.order_ref,
                items,
                actorUserId: null,
                note: 'Stock restored after failed Flutterwave payment for ' + order.order_ref
            });
        });
        await logIntegration('payment_failed_stock_restored', null, order.order_ref,
            'lines=' + restored.length);
    } catch (err) {
        console.error('restoreStockForFailedPayment error:', err.message);
    }
}

// Initialize a Flutterwave checkout from an existing order. The amount is read
// from the stored order — the browser never dictates it.
app.post('/api/payments/flutterwave/initialize', authRequired, async (req, res) => {
    try {
        const { order_ref } = req.body;
        if (!order_ref) return res.status(400).json({ error: 'order_ref is required' });
        if (!FLW_PUBLIC_KEY || !FLW_SECRET_KEY) {
            return res.status(503).json({ error: 'Flutterwave is not configured on this server' });
        }

        const order = await db.findBy('orders',
            o => o.order_ref === order_ref && String(o.user_id) === String(req.user.id));
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.payment_method !== 'flutterwave') {
            return res.status(400).json({ error: 'This order was not placed with Flutterwave' });
        }
        if (order.payment_status === 'verified') {
            return res.status(409).json({ error: 'This order is already paid' });
        }

        // tx_ref IS the application order reference — every Flutterwave event
        // traces straight back to this order.
        res.json({
            public_key: FLW_PUBLIC_KEY,
            tx_ref: order.order_ref,
            amount: Number(order.total),
            currency: FLW_CURRENCY,
            customer: {
                email: order.customer_email,
                name: order.customer_name,
                phone: order.customer_phone
            }
        });
    } catch (err) {
        console.error('FLW initialize error:', err);
        res.status(500).json({ error: 'Server error initializing payment' });
    }
});

// Server-side verification. Called by the callback page AND reused by the
// webhook flow. Never trusts the redirect result on its own.
app.post('/api/payments/flutterwave/verify', authRequired, async (req, res) => {
    try {
        const { transaction_id, order_ref } = req.body;
        if (!transaction_id) return res.status(400).json({ error: 'transaction_id is required' });
        if (!FLW_SECRET_KEY) return res.status(503).json({ error: 'Flutterwave is not configured' });

        const tx = await flwVerifyTransaction(transaction_id);

        const order = await db.findBy('orders', o =>
            o.order_ref === (order_ref || tx.tx_ref) && String(o.user_id) === String(req.user.id));
        if (!order) return res.status(404).json({ error: 'Order not found for this transaction' });

        // Security-relevant checks against the ORDER, not the browser.
        const refOk = String(tx.tx_ref) === String(order.order_ref);
        const currencyOk = String(tx.currency).toUpperCase() === FLW_CURRENCY;
        if (!refOk || !currencyOk) {
            await logIntegration('payment_mismatch', null, order.order_ref,
                `tx_ref/currency mismatch (ref=${refOk}, cur=${currencyOk})`);
            return res.status(400).json({ error: 'Transaction does not match this order' });
        }

        if (tx.status === 'successful') {
            const amountOk = Math.abs(Number(tx.amount) - Number(order.total)) < 0.01;
            if (!amountOk) {
                await logIntegration('payment_mismatch', null, order.order_ref,
                    `amount mismatch: expected ${order.total} got ${tx.amount}`);
                return res.status(400).json({ error: 'Paid amount does not match the order total' });
            }
            const { changed, order: updated } = await applyPaymentOutcome(order.id, 'verified', tx.id);
            if (!changed) {
                return res.json({ payment_status: order.payment_status, duplicate: true, orderRef: order.order_ref });
            }
            await emitPaymentConfirmed(updated);
            return res.json({ payment_status: 'verified', orderRef: updated.order_ref });
        }

        if (['failed', 'cancelled'].includes(tx.status)) {
            const { changed, order: updated } = await applyPaymentOutcome(order.id, 'failed', tx.id);
            if (changed) await restoreStockForFailedPayment(updated);
            return res.json({ payment_status: 'failed', orderRef: order.order_ref });
        }

        // Anything else stays pending — the webhook may still resolve it later.
        return res.json({ payment_status: 'pending', orderRef: order.order_ref });
    } catch (err) {
        console.error('FLW verify error:', err.message);
        res.status(502).json({ error: 'Could not verify this payment right now. It will be confirmed via webhook.' });
    }
});

// Flutterwave webhook — reliable confirmation independent of the browser.
// Authenticated with the verif-hash header, then STILL re-verified server-side.
app.post('/api/webhooks/flutterwave', async (req, res) => {
    try {
        if (!FLW_WEBHOOK_SECRET_HASH || req.get('verif-hash') !== FLW_WEBHOOK_SECRET_HASH) {
            await logIntegration('auth_failure', null, 'flw-webhook', 'bad or missing verif-hash');
            return res.status(401).json({ error: 'Invalid webhook signature' });
        }
        const data = req.body && req.body.data;
        if (!data || !data.tx_ref) return res.status(200).json({ message: 'ignored' });

        const order = await db.findBy('orders', o => o.order_ref === String(data.tx_ref));
        if (!order) return res.status(200).json({ message: 'unknown reference ignored' });

        // Cheap duplicate short-circuit; the atomic claim remains the guarantee.
        if (data.status === 'successful' && order.payment_status === 'verified') {
            return res.status(200).json({ message: 'already processed' });
        }
        if (data.status !== 'successful' && !['failed', 'cancelled'].includes(data.status)) {
            return res.status(200).json({ message: 'pending state ignored' });
        }

        // Never trust the payload amount alone — re-verify with the API.
        let verified = false;
        if (data.status === 'successful' && FLW_SECRET_KEY && data.id) {
            try {
                const tx = await flwVerifyTransaction(data.id);
                verified = tx.status === 'successful'
                    && String(tx.tx_ref) === String(order.order_ref)
                    && String(tx.currency).toUpperCase() === FLW_CURRENCY
                    && Math.abs(Number(tx.amount) - Number(order.total)) < 0.01;
            } catch (e) {
                console.error('webhook re-verify failed:', e.message);
                verified = false;
            }
        }

        if (verified) {
            const { changed, order: updated } = await applyPaymentOutcome(order.id, 'verified', data.id);
            if (changed) await emitPaymentConfirmed(updated);
            return res.status(200).json({ message: changed ? 'payment confirmed' : 'already processed' });
        }

        if (['failed', 'cancelled'].includes(data.status)) {
            const { changed, order: updated } = await applyPaymentOutcome(order.id, 'failed', data.id);
            if (changed) await restoreStockForFailedPayment(updated);
        }
        return res.status(200).json({ message: 'processed' });
    } catch (err) {
        console.error('FLW webhook error:', err);
        // 200 so Flutterwave doesn't hammer retries on transient issues; the
        // callback/manual verification can still resolve the payment.
        res.status(200).json({ message: 'handled with errors' });
    }
});

// ===== WORKER MANAGEMENT ROUTES (Admin only) =====

// Add worker
app.post('/api/admin/workers', authRequired, adminRequired, async (req, res) => {
    try {
        const { name, email } = req.body;
        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email are required' });
        }

        // Check if user exists
        const existing = await db.findBy('users', u => u.email === email.toLowerCase());
        if (existing) {
            return res.status(400).json({ error: 'A user with this email already exists' });
        }

        // Generate credentials
        const username = generateUsername(name);
        const loginCode = generateLoginCode();
        const tempPassword = 'worker_' + Math.random().toString(36).slice(2, 10);

        // Create worker user
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        const worker = await db.insert('users', {
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'worker',
            is_verified: 1,
            profile_pic: null,
            created_at: new Date().toISOString()
        });

        // Store login code
        await db.insert('worker_codes', {
            worker_id: worker.id,
            login_code: loginCode,
            is_used: 0,
            created_at: new Date().toISOString()
        });

        // Send worker credentials email via Brevo HTTP API (no SMTP, no EmailJS)
        const emailLoginUrl = publicUrl(`/worker.html?token=${encodeURIComponent(createEmailLoginToken(worker, '7d'))}`);

        let emailWarning = null;
        try {
            await sendEmailWithTimeout(emailService.sendWorkerCredentialsEmail(email, name, username, loginCode, emailLoginUrl));
        } catch (emailError) {
            console.error('Worker credentials email error:', emailError.message);
            emailWarning = 'Worker created, but the credentials email could not be sent: ' + emailError.message;
        }

        res.status(201).json({
            message: emailWarning || 'Worker added successfully. Login credentials sent to their email.',
            emailWarning,
            worker: {
                id: worker.id,
                name,
                email: email.toLowerCase(),
                username,
                loginCode
            }
        });
    } catch (err) {
        console.error('Add worker error:', err);
        res.status(500).json({ error: 'Server error adding worker' });
    }
});

// Get all workers
app.get('/api/admin/workers', authRequired, adminRequired, async (req, res) => {
    try {
        const workers = await db.findAll('users', u => u.role === 'worker');
        workers.sort((a, b) => Number(b.id) - Number(a.id));
        res.json({ workers: workers.map(w => ({ id: w.id, name: w.name, email: w.email, role: w.role, is_verified: w.is_verified, created_at: w.created_at })) });
    } catch (err) {
        console.error('Get workers error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete worker
app.delete('/api/admin/workers/:id', authRequired, adminRequired, async (req, res) => {
    try {
        const worker = await db.getById('users', req.params.id);
        if (!worker || worker.role !== 'worker') return res.status(404).json({ error: 'Worker not found' });

        await db.remove('users', worker.id);
        await db.removeWhere('worker_codes', wc => String(wc.worker_id) === String(worker.id));
        res.json({ message: 'Worker removed successfully' });
    } catch (err) {
        console.error('Delete worker error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ADMIN REPORTS ROUTES =====

// Get admin dashboard stats
app.get('/api/admin/stats', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const products = await db.getAll('products');
        const orders = await db.getAll('orders');
        const users = await db.getAll('users');
        const payments = await db.getAll('payment_verifications');

        const totalProducts = products.length;
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        const totalUsers = users.filter(u => u.role === 'buyer').length;
        const totalWorkers = users.filter(u => u.role === 'worker').length;
        const pendingPayments = payments.filter(p => p.status === 'pending').length;

        // Product order counts
        const productOrders = products.map(p => {
            let totalOrdered = 0;
            let totalRevenueForProduct = 0;
            orders.forEach(o => {
                try {
                    const items = JSON.parse(o.items || '[]');
                    items.forEach(item => {
                        if (String(item.id) === String(p.id)) {
                            totalOrdered += item.quantity || 0;
                            totalRevenueForProduct += (item.price || 0) * (item.quantity || 0);
                        }
                    });
                } catch (e) {}
            });
            return {
                id: p.id,
                name: p.name,
                category: p.category,
                price: p.price,
                total_ordered: totalOrdered,
                total_revenue: totalRevenueForProduct
            };
        }).sort((a, b) => b.total_ordered - a.total_ordered);

        // Recent orders
        const recentOrders = orders.sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 10);

        res.json({
            stats: {
                totalProducts,
                totalOrders,
                totalRevenue,
                totalUsers,
                totalWorkers,
                pendingPayments
            },
            productOrders,
            recentOrders
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Export orders as CSV
app.get('/api/admin/export/orders', authRequired, adminRequired, async (req, res) => {
    try {
        const orders = await db.getAll('orders');
        orders.sort((a, b) => Number(b.id) - Number(a.id));

        const csvRows = [
            ['Order Ref', 'Customer Name', 'Email', 'Phone', 'Address', 'Payment Method', 'Payment Status', 'Order Status', 'Total', 'Date', 'Items']
        ];

        orders.forEach(order => {
            const items = JSON.parse(order.items || '[]');
            const itemsSummary = items.map(i => `${i.name} x${i.quantity}`).join('; ');
            csvRows.push([
                order.order_ref,
                order.customer_name,
                order.customer_email,
                order.customer_phone,
                order.shipping_address,
                order.payment_method,
                order.payment_status,
                order.status,
                order.total,
                order.created_at,
                itemsSummary
            ]);
        });

        const csv = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=orders.csv');
        res.send(csv);
    } catch (err) {
        console.error('Export orders error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Export product report as CSV
app.get('/api/admin/export/products', authRequired, adminRequired, async (req, res) => {
    try {
        const products = await db.getAll('products');
        const orders = await db.getAll('orders');

        const csvRows = [
            ['Product ID', 'Name', 'Category', 'Price', 'Stock', 'Featured', 'Total Ordered']
        ];

        products.forEach(p => {
            let totalOrdered = 0;
            orders.forEach(o => {
                try {
                    const items = JSON.parse(o.items || '[]');
                    items.forEach(item => {
                        if (String(item.id) === String(p.id)) {
                            totalOrdered += item.quantity || 0;
                        }
                    });
                } catch (e) {}
            });
            csvRows.push([
                p.id,
                p.name,
                p.category,
                p.price,
                p.stock,
                p.featured ? 'Yes' : 'No',
                totalOrdered
            ]);
        });

        const csv = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=product-report.csv');
        res.send(csv);
    } catch (err) {
        console.error('Export products error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== CART ROUTES =====

// Save cart (server-side)
app.post('/api/cart', authRequired, async (req, res) => {
    try {
        const { items } = req.body;
        const existing = await db.findBy('carts', c => String(c.user_id) === String(req.user.id));
        if (existing) {
            await db.update('carts', existing.id, { items: JSON.stringify(items || []), updated_at: new Date().toISOString() });
        } else {
            await db.insert('carts', {
                user_id: req.user.id,
                items: JSON.stringify(items || []),
                updated_at: new Date().toISOString()
            });
        }
        res.json({ message: 'Cart saved' });
    } catch (err) {
        console.error('Save cart error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get cart
app.get('/api/cart', authRequired, async (req, res) => {
    try {
        const cart = await db.findBy('carts', c => String(c.user_id) === String(req.user.id));
        res.json({ items: cart ? JSON.parse(cart.items) : [] });
    } catch (err) {
        console.error('Get cart error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== Test email endpoint (debugging) =====
app.post('/api/test-email', async (req, res) => {
    try {
        const { email, name } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        if (!emailService.isEmailConfigured()) {
            return res.status(500).json({
                error: 'Brevo API key is not configured',
                config: emailService.getEmailConfig()
            });
        }

        const code = String(Math.floor(100000 + Math.random() * 900000));
        await sendEmailWithTimeout(emailService.sendVerificationEmail(email, name || 'there', code));

        res.json({
            message: 'Test email sent successfully',
            to: email,
            verificationCode: code,
            config: emailService.getEmailConfig()
        });
    } catch (err) {
        console.error('Test email error:', err);
        res.status(500).json({
            error: 'Test email failed',
            details: err.message,
            config: emailService.getEmailConfig()
        });
    }
});

// ===== Health check =====
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'LordTempsMart API is running',
        emailConfigured: emailService.isEmailConfigured(),
        emailConfig: emailService.getEmailConfig()
    });
});

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Start server
db.init().then(() => {
    // Deployment logs will show an actionable mail configuration error without
    // exposing the email address, app password, or any other secret.
    emailService.verifyEmailConnection()
        .then(() => console.log('Email service connection verified'))
        .catch(err => console.error('Email service is unavailable:', err.message));
    app.listen(PORT, () => {
        console.log(`🚀 LordTempsMart server running on http://localhost:${PORT}`);
        console.log(`📊 API available at http://localhost:${PORT}/api`);
        console.log(`️ Frontend available at http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('❌ Failed to initialize database:', err.message);
    process.exit(1);
});
