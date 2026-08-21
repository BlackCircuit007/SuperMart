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
// Prevents "failed to fetch" when Gmail SMTP is slow or unreachable.
function sendEmailInBackground(emailPromise) {
    Promise.race([
        emailPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Email send timed out')), 10000))
    ]).catch(err => console.error('Background email error:', err.message));
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

        // Check if user exists
        const existing = await db.findBy('users', u => u.email === email.toLowerCase());
        if (existing) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user (unverified)
        const user = await db.insert('users', {
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'buyer',
            is_verified: 0,
            profile_pic: null,
            created_at: new Date().toISOString()
        });

        // Generate verification code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await db.insert('verification_codes', {
            email: email.toLowerCase(),
            code,
            purpose: 'register',
            expires_at: expiresAt,
            used: 0,
            created_at: new Date().toISOString()
        });

        // Send verification email in the background (don't block the response)
        sendEmailInBackground(emailService.sendVerificationEmail(email, name, code));

        res.status(201).json({
            message: 'Registration successful. Check your email (and Spam/Junk folder) for the verification code.',
            userId: user.id,
            emailSent: true
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

        // Mark code as used
        await db.update('verification_codes', record.id, { used: 1 });

        // Mark user as verified
        const user = await db.findBy('users', u => u.email === email.toLowerCase());
        if (user) {
            await db.update('users', user.id, { is_verified: 1 });
        }

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

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

        const user = await db.findBy('users', u => u.email === email.toLowerCase());
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (Number(user.is_verified) === 1) {
            return res.status(400).json({ error: 'Account is already verified' });
        }

        // Generate new verification code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await db.insert('verification_codes', {
            email: email.toLowerCase(),
            code,
            purpose: 'register',
            expires_at: expiresAt,
            used: 0,
            created_at: new Date().toISOString()
        });

        // Send verification email in the background (don't block the response)
        sendEmailInBackground(emailService.sendVerificationEmail(email, user.name, code));

        res.json({
            message: 'Verification code resent. Check your email (and Spam/Junk folder).',
            emailSent: true
        });
    } catch (err) {
        console.error('Resend verification error:', err);
        res.status(500).json({ error: 'Server error during resend' });
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
            const token = jwt.sign(
                { id: user.id, email: user.email, name: user.name, role: user.role },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

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

        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

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

        if (!customer_name || !customer_email || !customer_phone || !shipping_address || !payment_method || !items || items.length === 0) {
            return res.status(400).json({ error: 'All order fields are required' });
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

        // Send emails in the background (don't block the response)
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
        const { status, payment_status } = req.body;
        const existing = await db.getById('orders', req.params.id);
        if (!existing) return res.status(404).json({ error: 'Order not found' });

        await db.update('orders', existing.id, {
            status: status || existing.status,
            payment_status: payment_status || existing.payment_status
        });

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
        if (!order_ref || !payer_phone || !amount || !transaction_ref) {
            return res.status(400).json({ error: 'All payment details are required' });
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

        // Send verification email to owner in the background (don't block the response)
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

        await db.update('payment_verifications', payment.id, { status: 'verified' });

        // Update order payment status
        const order = await db.findBy('orders', o => o.order_ref === payment.order_ref);
        if (order) {
            await db.update('orders', order.id, { payment_status: 'verified' });
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

        // Send credentials email in the background (don't block the response)
        sendEmailInBackground(emailService.sendWorkerCredentialsEmail(email, name, username, loginCode));

        res.status(201).json({
            message: 'Worker added successfully. Login credentials sent to their email.',
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

// ===== Health check =====
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'TriumphsMart API is running' });
});

// Start server
db.init().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 TriumphsMart server running on http://localhost:${PORT}`);
        console.log(`📊 API available at http://localhost:${PORT}/api`);
        console.log(`️ Frontend available at http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('❌ Failed to initialize database:', err.message);
    process.exit(1);
});