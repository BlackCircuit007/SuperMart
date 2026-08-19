/**
 * FreshMart - Node.js / Express Backend
 *
 * Serves the frontend static files and provides:
 *   GET  /config       - EmailJS configuration from .env
 *   POST /send-code    - Fallback verification code generation
 *   POST /verify-code  - Fallback code verification
 *
 * Primary email delivery is handled client-side via EmailJS SDK.
 * This backend exists as a config provider and optional fallback.
 *
 * Deploy on Render.com:
 *   - Build command:  npm install
 *   - Start command:  node server.js
 *   - Set PORT env var (Render assigns this automatically)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || process.env.FLASK_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory store for verification codes (fallback when EmailJS is unavailable)
const verificationStore = {};

/**
 * GET /config
 * Returns EmailJS configuration from environment variables.
 * The frontend uses this to initialize the EmailJS SDK.
 */
app.get('/config', (req, res) => {
    res.json({
        emailjs_service_id: process.env.EMAILJS_SERVICE_ID || '',
        emailjs_template_id: process.env.EMAILJS_TEMPLATE_ID || '',
        emailjs_login_template_id: process.env.EMAILJS_LOGIN_TEMPLATE_ID || '',
        emailjs_public_key: process.env.EMAILJS_PUBLIC_KEY || '',
        port: parseInt(process.env.PORT || process.env.FLASK_PORT || 3000, 10)
    });
});

/**
 * POST /send-code
 * Fallback: generates a verification code and stores it server-side.
 */
app.post('/send-code', (req, res) => {
    var email = req.body.email;

    if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }

    var code = crypto.randomInt(100000, 999999).toString();
    verificationStore[email] = code;

    console.log('Verification code for ' + email + ': ' + code);

    res.json({
        success: true,
        code: code,
        message: 'Code generated'
    });
});

/**
 * POST /verify-code
 * Fallback: verifies a code against the server-side store.
 */
app.post('/verify-code', (req, res) => {
    var email = req.body.email;
    var code = req.body.code;

    if (!email || !code) {
        return res.status(400).json({ success: false, error: 'Email and code are required' });
    }

    if (verificationStore[email] === code) {
        delete verificationStore[email];
        return res.json({ success: true });
    }

    res.status(400).json({ success: false });
});

/**
 * Health check endpoint for Render.com
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'FreshMart Backend' });
});

// Serve static frontend files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'frontend')));

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log('FreshMart backend running on port ' + PORT);
    console.log('  GET  /config      - EmailJS configuration');
    console.log('  POST /send-code   - Verification code (fallback)');
    console.log('  POST /verify-code - Code verification (fallback)');
    console.log('  GET  /health      - Health check');
});
