/* ============================================================
 *  FRESHMART — EmailJS & Environment Configuration
 *  Loads EmailJS credentials from the backend /config endpoint
 *  and initialises the EmailJS SDK for register/login flows.
 * ============================================================ */

var ENV = {
    BACKEND_URL: (typeof window !== "undefined" && window.ENV_BACKEND_URL) || "http://127.0.0.1:5000",
    EMAILJS_LOADED: false
};

// EmailJS configuration state
var EMAILJS_STATE = {
    serviceId: null,
    templateId: null,
    loginTemplateId: null,
    publicKey: null,
    initialized: false,
    backendAvailable: false
};

/**
 * Fetch EmailJS configuration from the backend /config endpoint.
 * Returns true if config was loaded successfully.
 */
async function loadEmailJSConfig() {
    try {
        var response = await fetch(ENV.BACKEND_URL + "/config", {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });

        if (!response.ok) throw new Error("Config endpoint returned " + response.status);

        var config = await response.json();

        EMAILJS_STATE.serviceId = config.emailjs_service_id || config.service_id || "";
        EMAILJS_STATE.templateId = config.emailjs_template_id || config.templateId || "";
        EMAILJS_STATE.loginTemplateId = config.emailjs_login_template_id || config.loginTemplateId || "";
        EMAILJS_STATE.publicKey = config.emailjs_public_key || config.publicKey || "";
        EMAILJS_STATE.backendAvailable = true;

        // Initialise EmailJS SDK if the library is loaded and we have a key
        if (typeof emailjs !== "undefined" && EMAILJS_STATE.publicKey) {
            emailjs.init(EMAILJS_STATE.publicKey);
            EMAILJS_STATE.initialized = true;
        }

        console.log("EmailJS config loaded successfully");
        return true;

    } catch (err) {
        console.warn("Could not load EmailJS config from backend:", err);
        EMAILJS_STATE.backendAvailable = false;
        return false;
    }
}

/**
 * Generate a random 6-digit verification code.
 */
function generateVerificationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Store a verification code in localStorage with a timestamp.
 * The code expires after 10 minutes.
 */
function storeVerificationCode(email, code) {
    localStorage.setItem("verification_code_" + email, JSON.stringify({
        code: code,
        timestamp: Date.now()
    }));
}

/**
 * Retrieve a verification code from localStorage if it exists and hasn't expired.
 */
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

/**
 * Send a verification email via EmailJS.
 * Falls back to the backend /send-code endpoint if EmailJS is unavailable.
 */
async function sendVerificationEmail(email, code, userName) {
    // Ensure config is loaded
    if (!EMAILJS_STATE.initialized) {
        await loadEmailJSConfig();
    }

    // Primary: EmailJS
    if (EMAILJS_STATE.initialized && EMAILJS_STATE.serviceId && EMAILJS_STATE.templateId) {
        try {
            var result = await emailjs.send(
                EMAILJS_STATE.serviceId,
                EMAILJS_STATE.templateId,
                {
                    to_email: email,
                    to_name: userName || "there",
                    verification_code: code,
                    app_name: "FreshMart"
                }
            );
            console.log("EmailJS verification email sent:", result.status);
            return true;
        } catch (err) {
            console.error("EmailJS send failed:", err);
        }
    }

    // Fallback: backend /send-code (stores code server-side too)
    if (EMAILJS_STATE.backendAvailable) {
        try {
            var response = await fetch(ENV.BACKEND_URL + "/send-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email, code: code })
            });
            var result = await response.json();
            if (result.success) {
                console.log("Backend fallback: code sent to", email);
                return true;
            }
        } catch (err) {
            console.error("Backend send-code fallback failed:", err);
        }
    }

    // Final fallback: simulate in dev mode (shows alert)
    if (typeof alert !== "undefined") {
        // In development, we can use the code directly from backend response
        try {
            var response = await fetch(ENV.BACKEND_URL + "/send-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email })
            });
            var result = await response.json();
            if (result.success && result.code) {
                console.log("Dev mode: verification code =", result.code);
                return true;
            }
        } catch (err) {
            console.error("All email delivery methods failed:", err);
        }
    }

    return false;
}

/**
 * Send a login notification email via EmailJS.
 */
async function sendLoginNotification(email, userName) {
    // Ensure config is loaded
    if (!EMAILJS_STATE.initialized) {
        await loadEmailJSConfig();
    }

    var templateId = EMAILJS_STATE.loginTemplateId || EMAILJS_STATE.templateId;

    if (EMAILJS_STATE.initialized && EMAILJS_STATE.serviceId && templateId) {
        try {
            var result = await emailjs.send(
                EMAILJS_STATE.serviceId,
                templateId,
                {
                    to_email: email,
                    to_name: userName || "there",
                    login_time: new Date().toLocaleString(),
                    app_name: "FreshMart Login"
                }
            );
            console.log("EmailJS login notification sent:", result.status);
            return true;
        } catch (err) {
            console.error("EmailJS login notification failed:", err);
        }
    }

    console.warn("Login notification not sent (EmailJS unavailable)");
    return false;
}

/**
 * Verify a code against server-side store (backend fallback) or
 * localStorage (EmailJS path).
 */
async function verifyCodeRemotely(email, code) {
    var localCode = getStoredVerificationCode(email);
    if (localCode && localCode === code) {
        localStorage.removeItem("verification_code_" + email);
        return true;
    }

    // Try backend verification as fallback
    if (EMAILJS_STATE.backendAvailable) {
        try {
            var response = await fetch(ENV.BACKEND_URL + "/verify-code", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email, code: code })
            });
            var result = await response.json();
            return result.success;
        } catch (err) {
            console.error("Backend verify-code failed:", err);
        }
    }

    return false;
}

// Auto-load config on script init (non-blocking)
(function autoLoadConfig() {
    if (typeof emailjs !== "undefined") {
        loadEmailJSConfig();
    }
})();
