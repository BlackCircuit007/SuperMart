import smtplib, ssl
import os
from email.message import EmailMessage
from dotenv import load_dotenv

load_dotenv()

def send_verification_email(to_email, code):
    sender_email = os.getenv("EMAIL_ADDRESS")
    sender_password = os.getenv("EMAIL_APP_PASSWORD")

    subject = "Sweet Crumbs Verification Code"
    body = f"""Hello,

Your verification code is: {code}

Please enter this code to complete your registration."""

    msg = EmailMessage()
    msg["From"] = sender_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    context = ssl.create_default_context()

    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
        server.login(sender_email, sender_password)
        server.send_message(msg)

    print("Verification email sent successfully!")