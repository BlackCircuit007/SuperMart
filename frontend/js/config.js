/* ============================================================
 *  TRIUMPHSMART — EmailJS Configuration
 *  Fully frontend-only. No backend required.
 *  Configure your EmailJS credentials below or via
 *  localStorage (set in the browser console).
 *
 *  Setup:
 *  1. Go to https://dashboard.emailjs.com/ and create an account
 *  2. Add an Email Service (e.g. Gmail)
 *  3. Create templates for verification & login
 *  4. Set the values below (or use localStorage keys)
 * ============================================================ */

/* ---- EmailJS credentials ----
 * Set these to your actual EmailJS values, OR set them in
 * your browser console with:
 *   localStorage.setItem("tm_emailjs_service_id", "your_service_id");
 *   localStorage.setItem("tm_emailjs_template_id", "your_template_id");
 *   localStorage.setItem("tm_emailjs_public_key", "your_public_key");
 */
var EMAILJS_SERVICE_ID = localStorage.getItem("tm_emailjs_service_id") || "default_service";
var EMAILJS_TEMPLATE_ID = localStorage.getItem("tm_emailjs_template_id") || "template_triumphsmart_verify";
var EMAILJS_LOGIN_TEMPLATE_ID = localStorage.getItem("tm_emailjs_login_template_id") || "template_triumphsmart_login";
var EMAILJS_PUBLIC_KEY = localStorage.getItem("tm_emailjs_public_key") || "";

var EMAILJS_STATE = {
    serviceId: "service_t3trcne",
    templateId: "template_ddax5bh",
    loginTemplateId: "template_ddax5bh",
    publicKey: "1JESagoXdGOO8s-EK",
    initialized: false
};

/* ---- Owner email (where payment-verification alerts are sent) ---- */
/* Set this to your own email address. Falls back to localStorage override. */
var OWNER_EMAIL = localStorage.getItem("tm_owner_email") || "goodluckiyke2010@gmail.com";
var OWNER_NAME = "TriumphsMart Owner";

/* ---- Check if EmailJS is properly configured ---- */
/* All three credentials must be present and non-placeholder. */
function isEmailJSConfigured() {
    var hasKey = !!EMAILJS_STATE.publicKey && EMAILJS_STATE.publicKey.length > 10;
    var hasService = !!EMAILJS_STATE.serviceId && EMAILJS_STATE.serviceId.indexOf("default_service") === -1;
    var hasTemplate = !!EMAILJS_STATE.templateId && EMAILJS_STATE.templateId.length > 5;
    return !!(hasKey && hasService && hasTemplate);
}

/* ---- Initialize EmailJS SDK ---- */
function initEmailJS() {
    if (typeof emailjs === "undefined") {
        console.warn("EmailJS SDK not loaded. Add: <script src='https://cdn.emailjs.com/sdk/latest/email.min.js'></script>");
        return false;
    }
    try {
        emailjs.init(EMAILJS_STATE.publicKey);
        EMAILJS_STATE.initialized = true;
        console.log("EmailJS initialized successfully");
        return true;
    } catch (err) {
        console.error("EmailJS init failed:", err);
        return false;
    }
}

/* ---- Generate 6-digit verification code ---- */
function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/* ---- Store verification code (10 min expiry) ---- */
function storeVerificationCode(email, code) {
    localStorage.setItem("verification_code_" + email, JSON.stringify({
        code: code,
        timestamp: Date.now()
    }));
}

/* ---- Retrieve verification code ---- */
function getStoredVerificationCode(email) {
    var stored = localStorage.getItem("verification_code_" + email);
    if (!stored) return null;
    var data = JSON.parse(stored);
    // 10-minute expiry
    if (Date.now() - data.timestamp > 10 * 60 * 1000) {
        localStorage.removeItem("verification_code_" + email);
        return null;
    }
    return data.code;
}

/* ---- Send verification email via EmailJS ---- */
async function sendVerificationEmail(email, code, userName) {
    if (!isEmailJSConfigured()) {
        // EmailJS not configured — store code, show it clearly on verify page
        console.log("=== DEV MODE: Verification code for " + email + " is: " + code + " ===");
        localStorage.setItem("dev_verification_code", code);
        localStorage.setItem("dev_verification_email", email);
        showToast("Code saved — check the verification page", "success");
        return true;
    }
    if (!EMAILJS_STATE.initialized) {
        initEmailJS();
    }
    try {
        var result = await emailjs.send(
            EMAILJS_STATE.serviceId,
            EMAILJS_STATE.templateId,
            {
                to_email: email,
                to_name: userName || "there",
                verification_code: code,
                app_name: "TriumphsMart"
            }
        );
        console.log("EmailJS verification email sent:", result.status);
        return true;
    } catch (err) {
        console.error("EmailJS send failed:", err);
        // Fallback: store code so user can see it on verify page
        localStorage.setItem("dev_verification_code", code);
        localStorage.setItem("dev_verification_email", email);
        showToast("Email failed — code shown on verify page", "success");
        return true;
    }
}

/* ---- Send login notification via EmailJS ---- */
async function sendLoginNotification(email, userName) {
    if (!EMAILJS_STATE.initialized) {
        initEmailJS();
    }
    if (!EMAILJS_STATE.initialized) {
        console.log("Dev mode: login notification skipped for " + email);
        return false;
    }
    try {
        var result = await emailjs.send(
            EMAILJS_STATE.serviceId,
            EMAILJS_STATE.loginTemplateId || EMAILJS_STATE.templateId,
            {
                to_email: email,
                to_name: userName || "there",
                login_time: new Date().toLocaleString(),
                app_name: "TriumphsMart Login"
            }
        );
        console.log("EmailJS login notification sent:", result.status);
        return true;
    } catch (err) {
        console.error("EmailJS login notification failed:", err);
        return false;
    }
}

/* ---- Send payment verification email to the OWNER ---- */
/* Sends the payer's details to the owner's email so they can verify the payment. */
async function sendPaymentVerificationEmail(details) {
    if (!isEmailJSConfigured()) {
        console.log("=== DEV MODE: Payment verification request ===", details);
        localStorage.setItem("dev_payment_verification", JSON.stringify({
            name: details.name,
            phone: details.phone,
            email: details.email,
            amount: details.amount,
            ref: details.ref,
            method: details.method,
            timestamp: Date.now()
        }));
        return { ok: true, devMode: true, message: "Payment verification request saved (dev mode)." };
    }
    if (!EMAILJS_STATE.initialized) {
        initEmailJS();
    }
    try {
        var result = await emailjs.send(
            EMAILJS_STATE.serviceId,
            EMAILJS_STATE.templateId,
            {
                to_email: OWNER_EMAIL,
                to_name: OWNER_NAME,
                app_name: "TriumphsMart Payment Verification",
                verification_code: "AMOUNT: " + details.amount + " NGN | REF: " + details.ref + " | PHONE: " + details.phone + " | NAME: " + details.name + " | METHOD: " + details.method,
                payer_name: details.name,
                payer_phone: details.phone,
                payer_email: details.email,
                payment_amount: details.amount,
                payment_ref: details.ref,
                payment_method: details.method
            }
        );
        console.log("Payment verification email sent to owner:", result.status);
        return { ok: true, emailSent: true };
    } catch (err) {
        console.error("Payment verification email failed:", err);
        // Fallback: store in localStorage so owner can check the request
        localStorage.setItem("dev_payment_verification", JSON.stringify({
            name: details.name,
            phone: details.phone,
            email: details.email,
            amount: details.amount,
            ref: details.ref,
            method: details.method,
            timestamp: Date.now()
        }));
        return { ok: true, devMode: true, message: "Payment verification saved (email failed — check localStorage)." };
    }
}

/* ---- Send order notification email to customer ---- */
async function sendOrderNotification(orderInfo) {
    if (!isEmailJSConfigured()) {
        console.log("=== DEV MODE: Order notification ===", orderInfo);
        return { ok: true, devMode: true };
    }
    if (!EMAILJS_STATE.initialized) {
        initEmailJS();
    }
    try {
        var result = await emailjs.send(
            EMAILJS_STATE.serviceId,
            EMAILJS_STATE.templateId,
            {
                to_email: orderInfo.email,
                to_name: orderInfo.name,
                verification_code: orderInfo.orderRef,
                app_name: "TriumphsMart Order #" + orderInfo.orderRef
            }
        );
        console.log("Order notification sent:", result.status);
        return { ok: true, emailSent: true };
    } catch (err) {
        console.error("Order notification failed:", err);
        return { ok: false, error: err };
    }
}

/* ---- Verify code against localStorage ---- */
async function verifyCodeRemotely(email, code) {
    var localCode = getStoredVerificationCode(email);
    if (localCode && localCode === code) {
        localStorage.removeItem("verification_code_" + email);
        return true;
    }
    // Dev mode fallback: check stored dev code
    var devCode = localStorage.getItem("dev_verification_code");
    var devEmail = localStorage.getItem("dev_verification_email");
    if (devCode && devCode === code && (!devEmail || devEmail === email)) {
        localStorage.removeItem("dev_verification_code");
        localStorage.removeItem("dev_verification_email");
        return true;
    }
    return false;
}

/* ---- Auto-init on script load ---- */
(function autoInit() {
    if (typeof emailjs !== "undefined") {
        initEmailJS();
    }
})();
