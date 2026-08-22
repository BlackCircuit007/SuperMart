const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const emailService = require('./email');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'triumphmart_super_secret_key_2026';

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
    const baseUrl = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
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

        // Check if it's a worker login with code
        if (loginCode) {
        const workerCode = await db.findBy('worker_codes', wc => wc.login_code === loginCode && Number(wc.is_used) === 0);
            if (!workerCode) {
                return res.status(400).json({ error: 'Invalid login code' });
            }

            // Mark code as used
            await db.update('worker_codes', workerCode.id, { is_used: 1 });

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
        const products = await db.getAll('products');
        products.sort((a, b) => Number(b.id) - Number(a.id));
        res.json({ products });
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
    try {
        const product = await db.getById('products', req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.json({ product });
    } catch (err) {
        console.error('Get product error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Add product (admin & worker)
app.post('/api/products', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const { name, category, price, rating, description, image, gallery, featured, stock } = req.body;
        if (!name || !price || !category) {
            return res.status(400).json({ error: 'Name, category and price are required' });
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
            created_at: new Date().toISOString()
        });

        res.status(201).json({ message: 'Product added successfully', product });
    } catch (err) {
        console.error('Add product error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update product (admin & worker)
app.put('/api/products/:id', authRequired, workerOrAdminRequired, async (req, res) => {
    try {
        const { name, category, price, rating, description, image, gallery, featured, stock } = req.body;
        const existing = await db.getById('products', req.params.id);
        if (!existing) return res.status(404).json({ error: 'Product not found' });

        const product = await db.update('products', existing.id, {
            name: name || existing.name,
            category: category || existing.category,
            price: price || existing.price,
            rating: rating || existing.rating,
            description: description !== undefined ? description : existing.description,
            image: image || existing.image,
            gallery: gallery ? gallery : existing.gallery,
            featured: featured !== undefined ? (featured ? 1 : 0) : existing.featured,
            stock: stock !== undefined ? stock : existing.stock
        });

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

// ===== ORDER ROUTES =====

// Place order
app.post('/api/orders', authRequired, async (req, res) => {
    try {
        const { customer_name, customer_email, customer_phone, shipping_address, payment_method, items, total } = req.body;

        if (!customer_name || !customer_email || !customer_phone || !shipping_address || !payment_method || !items || items.length === 0 || !Number.isFinite(Number(total)) || Number(total) <= 0) {
            return res.status(400).json({ error: 'All order fields are required' });
        }
        if (payment_method !== 'cash' && payment_method !== 'transfer') {
            return res.status(400).json({ error: 'Invalid payment method' });
        }

        const orderRef = generateOrderRef();

        const order = await db.insert('orders', {
            order_ref: orderRef,
            user_id: req.user.id,
            customer_name,
            customer_email,
            customer_phone,
            shipping_address,
            payment_method,
            payment_status: 'pending',
            total: parseFloat(total),
            items: JSON.stringify(items),
            status: 'pending',
            delivered: 0,
            created_at: new Date().toISOString()
        });

        const orderData = {
            orderRef,
            customer_name,
            customer_email,
            customer_phone,
            shipping_address,
            payment_method,
            total,
            items
        };

        // Send emails in the background via Brevo HTTP API (no SMTP, no EmailJS)
        sendEmailInBackground(emailService.sendOrderConfirmationEmail(orderData));
        if (payment_method === 'cash') {
            sendEmailInBackground(emailService.sendCashOnDeliveryEmail(orderData));
        }

        res.status(201).json({
            message: 'Order placed successfully',
            orderRef,
            orderId: order.id
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

        const updatedOrder = await db.update('orders', existing.id, {
            status: status || existing.status,
            payment_status: payment_status || existing.payment_status,
            delivered: delivered !== undefined ? (delivered ? 1 : 0) : (status === 'delivered' ? 1 : existing.delivered)
        });

        sendEmailInBackground(emailService.sendOrderStatusEmail(updatedOrder));

        res.json({ message: 'Order updated' });
    } catch (err) {
        console.error('Update order error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== PAYMENT VERIFICATION ROUTES =====

// Submit payment verification
app.post('/api/payments/verify', authRequired, async (req, res) => {
    try {
        const { order_ref, payer_name, payer_phone, payer_email, amount, transaction_ref } = req.body;
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

        const payment = await db.insert('payment_verifications', {
            order_ref,
            payer_name,
            payer_phone,
            payer_email,
            amount: parseFloat(amount),
            transaction_ref,
            status: 'pending',
            created_at: new Date().toISOString()
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

// Verify payment (from email button)
app.get('/api/payments/verify/:id', async (req, res) => {
    try {
        const payment = await db.getById('payment_verifications', req.params.id);
        if (!payment) return res.status(404).send('Payment verification not found');
        if (payment.status !== 'pending') return res.status(409).send('Payment verification has already been processed');

        await db.update('payment_verifications', payment.id, { status: 'verified' });

        // Update order payment status
        const order = await db.findBy('orders', o => o.order_ref === payment.order_ref);
        if (order) {
            const updatedOrder = await db.update('orders', order.id, {
                payment_status: 'verified',
                status: order.status === 'pending' ? 'processing' : order.status
            });
            sendEmailInBackground(emailService.sendOrderStatusEmail(updatedOrder));
        }

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
        if (payment.status !== 'pending') return res.status(409).send('Payment verification has already been processed');

        await db.update('payment_verifications', payment.id, { status: 'rejected' });

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
        message: 'TriumphsMart API is running',
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
        console.log(`🚀 TriumphsMart server running on http://localhost:${PORT}`);
        console.log(`📊 API available at http://localhost:${PORT}/api`);
        console.log(`️ Frontend available at http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('❌ Failed to initialize database:', err.message);
    process.exit(1);
});
