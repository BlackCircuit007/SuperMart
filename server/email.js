const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter using Gmail SMTP
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: process.env.EMAIL_ADDRESS && process.env.EMAIL_APP_PASSWORD
        ? { user: process.env.EMAIL_ADDRESS, pass: process.env.EMAIL_APP_PASSWORD }
        : undefined
});

const OWNER_EMAIL = process.env.EMAIL_ADDRESS;
const STORE_NAME = 'TriumphsMart';

function getEmailConfigurationError() {
    if (!process.env.EMAIL_ADDRESS || !process.env.EMAIL_APP_PASSWORD) {
        return new Error('Email is not configured. Set EMAIL_ADDRESS and EMAIL_APP_PASSWORD in .env.');
    }
    return null;
}

/**
 * Send verification code email
 */
async function sendVerificationEmail(toEmail, toName, code, emailLoginUrl) {
    const configurationError = getEmailConfigurationError();
    if (configurationError) throw configurationError;
    const mailOptions = {
        from: `"${STORE_NAME}" <${OWNER_EMAIL}>`,
        to: toEmail,
        subject: `Verify your ${STORE_NAME} account`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 10px;">
                <div style="text-align: center; padding: 20px 0;">
                    <h1 style="color: #ff3b20; margin: 0;">🛍️ ${STORE_NAME}</h1>
                </div>
                <div style="background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <h2 style="color: #333; margin-top: 0;">Hello ${toName || 'there'}! 👋</h2>
                    <p style="color: #666; font-size: 15px; line-height: 1.6;">Thank you for registering with ${STORE_NAME}. Please use the verification code below to complete your registration:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <div style="display: inline-block; background: #fff5f0; border: 2px solid #ff3b20; border-radius: 10px; padding: 15px 30px; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #ff3b20; font-family: monospace;">
                            ${code}
                        </div>
                    </div>
                    ${emailLoginUrl ? `
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${emailLoginUrl}" style="display: inline-block; background: #ff3b20; color: #fff; padding: 14px 26px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">Verify & Sign In</a>
                    </div>
                    <p style="color: #666; font-size: 13px; text-align: center;">Use this secure button to verify your email and sign in automatically. It expires in 24 hours.</p>` : ''}
                    <p style="color: #999; font-size: 13px;">This code will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
                    <p style="color: #999; font-size: 13px; text-align: center; margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;"><strong>📥 Can't find this email?</strong><br>Please check your Spam / Junk / Promotions folder — verification emails sometimes end up there.</p>
                </div>
                <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
                    <p>© ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.</p>
                </div>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
}

/**
 * Send the buyer a clear cash-on-delivery confirmation.
 */
async function sendCashOnDeliveryEmail(order) {
    const configurationError = getEmailConfigurationError();
    if (configurationError) throw configurationError;
    const itemsHtml = order.items.map(item => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">₦${Number(item.price * item.quantity).toLocaleString()}</td>
        </tr>
    `).join('');

    const mailOptions = {
        from: `"${STORE_NAME}" <${OWNER_EMAIL}>`,
        to: OWNER_EMAIL,
        subject: `Cash on Delivery Notice - ${order.orderRef}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 10px;">
                <div style="text-align: center; padding: 20px 0;">
                    <h1 style="color: #ff3b20; margin: 0;">🛍️ ${STORE_NAME}</h1>
                    <h2 style="color: #333; margin: 10px 0 0;">💵 Cash on Delivery Order</h2>
                </div>
                <div style="background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <div style="background: #fff8e6; border: 1px solid #ffd93d; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                        <strong style="color: #8a6d00;">Order Reference:</strong> <span style="font-size: 18px; font-weight: 800; color: #ff3b20;">${order.orderRef}</span>
                    </div>
                    
                    <h3 style="color: #333; margin-bottom: 10px;">👤 Customer Details</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr><td style="padding: 6px; color: #666; width: 120px;">Name:</td><td style="padding: 6px; font-weight: 600; color: #333;">${order.customer_name}</td></tr>
                        <tr><td style="padding: 6px; color: #666;">Email:</td><td style="padding: 6px; font-weight: 600; color: #333;">${order.customer_email}</td></tr>
                        <tr><td style="padding: 6px; color: #666;">Phone:</td><td style="padding: 6px; font-weight: 600; color: #333;">${order.customer_phone}</td></tr>
                        <tr><td style="padding: 6px; color: #666;">Address:</td><td style="padding: 6px; font-weight: 600; color: #333;">${order.shipping_address}</td></tr>
                    </table>

                    <h3 style="color: #333; margin-bottom: 10px;">📦 Order Items</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 8px; text-align: left; color: #666;">Item</th>
                                <th style="padding: 8px; text-align: center; color: #666;">Qty</th>
                                <th style="padding: 8px; text-align: right; color: #666;">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>

                    <div style="background: #fff5f0; border-radius: 8px; padding: 15px; text-align: right;">
                        <strong style="color: #666;">Total Amount:</strong>
                        <span style="font-size: 24px; font-weight: 800; color: #ff3b20; margin-left: 10px;">₦${Number(order.total).toLocaleString()}</span>
                    </div>

                    <div style="margin-top: 20px; padding: 15px; background: #f0f8ff; border-radius: 8px; text-align: center;">
                        <p style="color: #333; margin: 0 0 10px;"><strong>Payment Method:</strong> 💵 Cash on Delivery</p>
                        <p style="color: #666; margin: 0; font-size: 14px;"><strong>The buyer has selected Cash on Delivery and will pay when the order is delivered.</strong> Please verify and collect the cash at delivery.</p>
                    </div>
                </div>
                <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
                    <p>© ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.</p>
                </div>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
}

/**
 * Send payment verification email to owner with verify button
 */
async function sendPaymentVerificationEmail(details) {
    const configurationError = getEmailConfigurationError();
    if (configurationError) throw configurationError;
    const verifyUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/payments/verify/${details.paymentId}`;
    const rejectUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/payments/reject/${details.paymentId}`;

    const mailOptions = {
        from: `"${STORE_NAME}" <${OWNER_EMAIL}>`,
        to: OWNER_EMAIL,
        subject: `🔔 Payment Verification Request - ${details.orderRef}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 10px;">
                <div style="text-align: center; padding: 20px 0;">
                    <h1 style="color: #ff3b20; margin: 0;">🛍️ ${STORE_NAME}</h1>
                    <h2 style="color: #333; margin: 10px 0 0;">🔔 Payment Verification Needed</h2>
                </div>
                <div style="background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <div style="background: #e8f5e9; border: 1px solid #4caf50; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                        <strong style="color: #2e7d32;">Order Reference:</strong> <span style="font-size: 18px; font-weight: 800; color: #ff3b20;">${details.orderRef}</span>
                    </div>
                    
                    <h3 style="color: #333; margin-bottom: 10px;">👤 Payer Details</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr><td style="padding: 6px; color: #666; width: 120px;">Name:</td><td style="padding: 6px; font-weight: 600; color: #333;">${details.payer_name}</td></tr>
                        <tr><td style="padding: 6px; color: #666;">Email:</td><td style="padding: 6px; font-weight: 600; color: #333;">${details.payer_email}</td></tr>
                        <tr><td style="padding: 6px; color: #666;">Phone:</td><td style="padding: 6px; font-weight: 600; color: #333;">${details.payer_phone}</td></tr>
                        <tr><td style="padding: 6px; color: #666;">Amount:</td><td style="padding: 6px; font-weight: 800; color: #ff3b20; font-size: 18px;">₦${Number(details.amount).toLocaleString()}</td></tr>
                        <tr><td style="padding: 6px; color: #666;">Transaction Ref:</td><td style="padding: 6px; font-weight: 600; color: #333; font-family: monospace;">${details.transaction_ref}</td></tr>
                    </table>

                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${verifyUrl}" style="display: inline-block; background: #4caf50; color: #fff; padding: 14px 30px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px;">✅ Verify Payment</a>
                        <a href="${rejectUrl}" style="display: inline-block; background: #f44336; color: #fff; padding: 14px 30px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px; margin: 0 10px;">❌ Reject</a>
                    </div>
                    <p style="color: #999; font-size: 13px; text-align: center;">Click "Verify Payment" to confirm this payment, or "Reject" if the payment is not valid.</p>
                </div>
                <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
                    <p>© ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.</p>
                </div>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
}

/**
 * Send order confirmation to customer
 */
async function sendOrderConfirmationEmail(order) {
    const configurationError = getEmailConfigurationError();
    if (configurationError) throw configurationError;
    const itemsHtml = order.items.map(item => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">₦${Number(item.price * item.quantity).toLocaleString()}</td>
        </tr>
    `).join('');

    const mailOptions = {
        from: `"${STORE_NAME}" <${OWNER_EMAIL}>`,
        to: order.customer_email,
        subject: `Order Confirmed - ${order.orderRef}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 10px;">
                <div style="text-align: center; padding: 20px 0;">
                    <h1 style="color: #ff3b20; margin: 0;">🛍️ ${STORE_NAME}</h1>
                    <h2 style="color: #333; margin: 10px 0 0;">✅ Order Confirmed!</h2>
                </div>
                <div style="background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <p style="color: #666; font-size: 15px;">Hello <strong>${order.customer_name}</strong>,</p>
                    <p style="color: #666; font-size: 15px;">Thank you for your order! Your order has been received and is being processed.</p>
                    
                    <div style="background: #fff8e6; border: 1px solid #ffd93d; border-radius: 8px; padding: 15px; margin: 20px 0; text-align: center;">
                        <strong style="color: #8a6d00;">Order Reference:</strong>
                        <span style="font-size: 20px; font-weight: 800; color: #ff3b20; display: block; margin-top: 5px;">${order.orderRef}</span>
                    </div>

                    <h3 style="color: #333; margin-bottom: 10px;">📦 Your Items</h3>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background: #f5f5f5;">
                                <th style="padding: 8px; text-align: left; color: #666;">Item</th>
                                <th style="padding: 8px; text-align: center; color: #666;">Qty</th>
                                <th style="padding: 8px; text-align: right; color: #666;">Total</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>

                    <div style="background: #fff5f0; border-radius: 8px; padding: 15px; text-align: right;">
                        <strong style="color: #666;">Total:</strong>
                        <span style="font-size: 24px; font-weight: 800; color: #ff3b20; margin-left: 10px;">₦${Number(order.total).toLocaleString()}</span>
                    </div>

                    <div style="margin-top: 20px; padding: 15px; background: #f0f8ff; border-radius: 8px;">
                        <p style="color: #333; margin: 0 0 5px;"><strong>Payment Method:</strong> ${order.payment_method === 'cash' ? '💵 Cash on Delivery' : '🏦 Bank Transfer'}</p>
                        <p style="color: #666; margin: 0; font-size: 14px;">${order.payment_method === 'cash' ? 'You will pay when your order is delivered. The delivery agent will verify the cash payment.' : 'Please complete your payment to process your order.'}</p>
                    </div>
                </div>
                <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
                    <p>© ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.</p>
                </div>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
}

/**
 * Send worker login credentials email
 */
async function sendWorkerCredentialsEmail(workerEmail, workerName, username, loginCode, emailLoginUrl) {
    const configurationError = getEmailConfigurationError();
    if (configurationError) throw configurationError;
    const mailOptions = {
        from: `"${STORE_NAME}" <${OWNER_EMAIL}>`,
        to: workerEmail,
        subject: `Your ${STORE_NAME} Worker Account`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 10px;">
                <div style="text-align: center; padding: 20px 0;">
                    <h1 style="color: #ff3b20; margin: 0;">🛍️ ${STORE_NAME}</h1>
                    <h2 style="color: #333; margin: 10px 0 0;">👷 Worker Account Created</h2>
                </div>
                <div style="background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <p style="color: #666; font-size: 15px;">Hello <strong>${workerName}</strong>,</p>
                    <p style="color: #666; font-size: 15px;">An admin has created a worker account for you at ${STORE_NAME}. Here are your login credentials:</p>
                    
                    <div style="background: #f5f5f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
                        <p style="margin: 0 0 10px; color: #666;"><strong>Username:</strong></p>
                        <div style="background: #fff; border: 2px solid #ff3b20; border-radius: 8px; padding: 10px 15px; font-size: 18px; font-weight: 700; color: #ff3b20; font-family: monospace; margin-bottom: 15px;">${username}</div>
                        <p style="margin: 0 0 10px; color: #666;"><strong>Login Code:</strong></p>
                        <div style="background: #fff; border: 2px solid #ff3b20; border-radius: 8px; padding: 10px 15px; font-size: 18px; font-weight: 700; color: #ff3b20; font-family: monospace;">${loginCode}</div>
                    </div>

                    ${emailLoginUrl ? `
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${emailLoginUrl}" style="display: inline-block; background: #ff3b20; color: #fff; padding: 14px 26px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">Sign In to Worker Portal</a>
                    </div>
                    <p style="color: #666; font-size: 13px; text-align: center;">This secure sign-in button expires in 7 days.</p>` : ''}

                    <p style="color: #666; font-size: 14px;">Please keep these credentials safe. You can log in at the worker portal using your username and login code.</p>
                    <p style="color: #999; font-size: 13px;">If you didn't expect this email, please contact the store admin immediately.</p>
                </div>
                <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
                    <p>© ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.</p>
                </div>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
}

async function sendOrderStatusEmail(order) {
    const configurationError = getEmailConfigurationError();
    if (configurationError) throw configurationError;
    const status = String(order.status || 'pending').replace(/_/g, ' ');
    const payment = String(order.payment_status || 'pending').replace(/_/g, ' ');
    return transporter.sendMail({
        from: `"${STORE_NAME}" <${OWNER_EMAIL}>`,
        to: order.customer_email,
        subject: `Order Update - ${order.order_ref}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;background:#f9f9f9;"><div style="background:#fff;padding:28px;border-radius:10px;"><h2 style="color:#ff3b20;margin-top:0;">Your order has been updated</h2><p>Hello <strong>${order.customer_name}</strong>,</p><p>Order <strong>${order.order_ref}</strong> is now <strong>${status}</strong>.</p><p>Payment status: <strong>${payment}</strong>.</p><p style="color:#666;font-size:14px;">You can see the latest status in My Orders on your TriumphsMart dashboard.</p></div></div>`
    });
}

module.exports = {
    sendVerificationEmail,
    sendCashOnDeliveryEmail,
    sendPaymentVerificationEmail,
    sendOrderConfirmationEmail,
    sendOrderStatusEmail,
    sendWorkerCredentialsEmail
};
