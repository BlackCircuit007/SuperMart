"""
FreshMart Backend API
=====================
Serves EmailJS configuration to the frontend and provides
fallback verification-code endpoints (SMTP-based).

Primary email sending is handled client-side via EmailJS.
The backend acts as a config provider and optional fallback.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import random
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

# In-memory store for verification codes (fallback when EmailJS is unavailable)
verification_store = {}


@app.route("/config", methods=["GET"])
def get_config():
    """Serve EmailJS and environment configuration to the frontend."""
    return jsonify({
        "emailjs_service_id": os.getenv("EMAILJS_SERVICE_ID", ""),
        "emailjs_template_id": os.getenv("EMAILJS_TEMPLATE_ID", ""),
        "emailjs_login_template_id": os.getenv("EMAILJS_LOGIN_TEMPLATE_ID", ""),
        "emailjs_public_key": os.getenv("EMAILJS_PUBLIC_KEY", ""),
        "flask_port": int(os.getenv("FLASK_PORT", 5000))
    })


@app.route("/send-code", methods=["POST"])
def send_code():
    """
    Fallback endpoint: generates a verification code and stores it server-side.
    Returns the code in the response (dev mode only) so the frontend can
    fall back to EmailJS delivery or use the code directly if EmailJS fails.
    """
    data = request.json
    email = data.get("email")

    if not email:
        return jsonify({"success": False, "error": "Email is required"}), 400

    code = str(random.randint(100000, 999999))
    verification_store[email] = code

    # Try SMTP as legacy fallback (optional)
    try:
        from mailer import send_verification_email
        send_verification_email(email, code)
    except Exception as e:
        print(f"SMTP fallback failed: {e}")

    print(f"Verification code for {email}: {code}")

    return jsonify({
        "success": True,
        "code": code,  # Returned for dev/testing; EmailJS is the primary channel
        "message": "Code generated"
    })


@app.route("/verify-code", methods=["POST"])
def verify_code():
    """Verify a code against the server-side store (fallback)."""
    data = request.json
    email = data.get("email")
    code = data.get("code")

    if not email or not code:
        return jsonify({"success": False, "error": "Email and code are required"}), 400

    if verification_store.get(email) == code:
        # Invalidate after use
        verification_store.pop(email, None)
        return jsonify({"success": True})
    else:
        return jsonify({"success": False}), 400


if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", 5000))
    app.run(port=port, debug=True)
