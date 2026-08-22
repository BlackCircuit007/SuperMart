// Brevo HTTP API email delivery (no SMTP, no EmailJS).
// Works from Render because it uses outbound HTTPS (port 443).
require('dotenv').config();

const STORE_NAME = 'LordTempsMart';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || process.env.OWNER_EMAIL || 'goodluckiyke2010@gmail.com';
const SENDER_NAME = process.env.BREVO_SENDER_NAME || STORE_NAME;
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'goodluckiyke2010@gmail.com';
const PORT = process.env.PORT || 3000;
// Fallback chain: explicit BASE_URL → Render auto-detected URL → localhost dev
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

function isEmailConfigured() {
    return Boolean(BREVO_API_KEY);
}

// Expose config for the test endpoint and health check
function getEmailConfig() {
    return {
        configured: Boolean(BREVO_API_KEY),
        senderEmail: SENDER_EMAIL,
        senderName: SENDER_NAME,
        ownerEmail: OWNER_EMAIL,
        baseUrl: BASE_URL
    };
}

/* ===== Core API call ===== */
async function sendEmailViaBrevo(toEmail, toName, subject, htmlContent) {
    if (!isEmailConfigured()) throw new Error('Brevo API key is not configured');
    // Guard against invalid recipients (e.g. the seeded admin account uses the
    // username "admin" as its email). Brevo rejects these with a 400 and the
    // background logger spams errors — fail fast with a clear message instead.
    if (!toEmail || String(toEmail).indexOf('@') === -1) {
        throw new Error('Skipping email — invalid recipient address: ' + toEmail);
    }
    const response = await fetch(BREVO_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': BREVO_API_KEY
        },
        body: JSON.stringify({
            sender: { email: SENDER_EMAIL, name: SENDER_NAME },
            to: [{ email: toEmail, name: toName || '' }],
            subject: subject,
            htmlContent: htmlContent
        })
    });
    if (!response.ok) {
        const details = await response.text();
        throw new Error(`Brevo API request failed (${response.status}): ${details.slice(0, 180)}`);
    }
    return true;
}

async function verifyEmailConnection() {
    if (!isEmailConfigured()) throw new Error('Brevo API key is not configured');
    return true;
}

/* ===== HTML template wrapper ===== */
function wrapEmail(title, innerHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:20px;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
<div style="text-align:center;margin-bottom:24px;">
<span style="font-size:48px;">🛍️</span>
<h1 style="color:#ff3b20;margin:10px 0 0;font-size:28px;">${STORE_NAME}</h1>
</div>
${innerHtml}
<hr style="border:none;border-top:1px solid #eee;margin:30px 0;">
<p style="color:#999;font-size:12px;text-align:center;">
© 2026 ${STORE_NAME}. All rights reserved.
</p>
</div>
</body>
</html>`;
}

/* ===== Code badge ===== */
function codeBadge(code) {
    return `<div style="text-align:center;margin:24px 0;">
<span style="display:inline-block;background:#ff3b20;color:#fff;font-size:28px;font-weight:800;padding:12px 32px;border-radius:8px;letter-spacing:6px;">${code}</span>
</div>`;
}

/* ===== Email functions ===== */

async function sendVerificationEmail(toEmail, toName, code, emailLoginUrl) {
    const html = wrapEmail('Verify your ' + STORE_NAME + ' account', `
<p style="color:#333;font-size:16px;">Hello ${toName || 'there'}! 👋</p>
<p>Thank you for registering with ${STORE_NAME}. Please use the verification code below to complete your registration:</p>
${codeBadge(code)}
<p style="color:#666;font-size:14px;">This code will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
${emailLoginUrl ? `<p style="text-align:center;margin-top:20px;"><a href="${emailLoginUrl}" style="display:inline-block;background:#ff3b20;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Skip code — sign in via email link</a></p>` : ''}
`);
    return sendEmailViaBrevo(toEmail, toName, 'Verify your ' + STORE_NAME + ' account', html);
}

async function sendWorkerCredentialsEmail(workerEmail, workerName, username, loginCode, emailLoginUrl) {
    const html = wrapEmail(STORE_NAME + ' Worker Account', `
<p style="color:#333;font-size:16px;">Hello ${workerName || 'there'}! 👋</p>
<p>Your ${STORE_NAME} worker account has been created. Here are your login credentials:</p>
<div style="background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
<p style="margin:0 0 8px;font-size:13px;color:#999;">Login Code</p>
<span style="display:inline-block;background:#2563eb;color:#fff;font-size:24px;font-weight:800;padding:10px 28px;border-radius:8px;letter-spacing:4px;">${loginCode}</span>
</div>
<p style="color:#666;font-size:14px;">Username: <strong>${username}</strong></p>
${emailLoginUrl ? `<p style="text-align:center;margin-top:20px;"><a href="${emailLoginUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Open Worker Dashboard</a></p>` : ''}
<p style="color:#666;font-size:14px;">You can also log in from the worker login page using this code.</p>
`);
    return sendEmailViaBrevo(workerEmail, workerName, 'Your ' + STORE_NAME + ' Worker Account', html);
}

async function sendCashOnDeliveryEmail(order) {
    const html = wrapEmail(STORE_NAME + ' — Cash on Delivery Notice', `
<p style="color:#333;font-size:16px;">Hello!</p>
<p>A new cash-on-delivery order has been placed on ${STORE_NAME}:</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Order Ref</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>${order.orderRef}</strong></td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Customer</td><td style="padding:8px;border-bottom:1px solid #eee;">${order.customer_name}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;">${order.customer_email}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">${order.customer_phone}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Total</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>₦${Number(order.total).toLocaleString()}</strong></td></tr>
<tr><td style="padding:8px;">Payment</td><td style="padding:8px;">Cash on delivery — buyer will pay on delivery</td></tr>
</table>
<p style="color:#666;font-size:14px;">The buyer will pay <strong>₦${Number(order.total).toLocaleString()}</strong> upon delivery.</p>
`);
    return sendEmailViaBrevo(OWNER_EMAIL, STORE_NAME + ' Owner', STORE_NAME + ' — New Cash on Delivery Order', html);
}

async function sendPaymentVerificationEmail(details) {
    const html = wrapEmail(STORE_NAME + ' Payment Verification', `
<p style="color:#333;font-size:16px;">Hello!</p>
<p>A customer has submitted a payment verification for your review:</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Order Ref</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>${details.orderRef}</strong></td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Payer</td><td style="padding:8px;border-bottom:1px solid #eee;">${details.payer_name}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;">${details.payer_email}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">${details.payer_phone}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Amount</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>₦${Number(details.amount).toLocaleString()}</strong></td></tr>
<tr><td style="padding:8px;">Transaction Ref</td><td style="padding:8px;">${details.transaction_ref}</td></tr>
</table>
${details.paymentId ? `<p style="text-align:center;margin-top:20px;"><a href="${BASE_URL}/api/payments/verify/${details.paymentId}" style="display:inline-block;background:#4caf50;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">✅ Verify Payment</a>&nbsp;&nbsp;<a href="${BASE_URL}/api/payments/reject/${details.paymentId}" style="display:inline-block;background:#f44336;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">❌ Reject Payment</a></p>` : ''}
`);
    return sendEmailViaBrevo(OWNER_EMAIL, STORE_NAME + ' Owner', STORE_NAME + ' — Payment Verification Required', html);
}

async function sendOrderConfirmationEmail(order) {
    const html = wrapEmail(STORE_NAME + ' Order Confirmation', `
<p style="color:#333;font-size:16px;">Hello ${order.customer_name || 'there'}! 👋</p>
<p>Thank you for your order on ${STORE_NAME}. Here are the details:</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Order Ref</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>${order.orderRef}</strong></td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Payment Method</td><td style="padding:8px;border-bottom:1px solid #eee;">${order.payment_method === 'cash' ? 'Cash on delivery' : 'Bank transfer'}</td></tr>
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Total</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>₦${Number(order.total).toLocaleString()}</strong></td></tr>
</table>
<p style="color:#666;font-size:14px;">${order.payment_method === 'cash' ? 'You will pay on delivery. We will notify you when your order ships.' : 'Your payment is being verified. We will notify you once it is confirmed.'}</p>
`);
    return sendEmailViaBrevo(order.customer_email, order.customer_name, STORE_NAME + ' — Order Confirmation', html);
}

async function sendOrderStatusEmail(order) {
    const html = wrapEmail(STORE_NAME + ' Order Update', `
<p style="color:#333;font-size:16px;">Hello!</p>
<p>Your order <strong>${order.order_ref || order.orderRef}</strong> has been updated:</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px;border-bottom:1px solid #eee;">Status</td><td style="padding:8px;border-bottom:1px solid #eee;">${order.status || order.payment_status}</td></tr>
<tr><td style="padding:8px;">Payment</td><td style="padding:8px;">${order.payment_status || order.status}</td></tr>
</table>
<p style="color:#666;font-size:14px;">Thank you for shopping with ${STORE_NAME}!</p>
`);
    return sendEmailViaBrevo(order.customer_email, order.customer_name, STORE_NAME + ' — Order Status Update', html);
}

module.exports = { isEmailConfigured, verifyEmailConnection, getEmailConfig, sendVerificationEmail, sendCashOnDeliveryEmail, sendPaymentVerificationEmail, sendOrderConfirmationEmail, sendOrderStatusEmail, sendWorkerCredentialsEmail };
