"""
One-time Gmail OAuth setup.
Run this once from the project root:  python scripts/setup_gmail.py

It opens a browser, asks you to grant Gmail access, and saves a token file
at the path defined by GMAIL_TOKEN_PATH (default: config/gmail_token.json).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]

creds_path = os.getenv("GMAIL_CREDENTIALS_PATH", "config/gmail_credentials.json")
token_path = os.getenv("GMAIL_TOKEN_PATH", "config/gmail_token.json")

if not os.path.exists(creds_path):
    print(f"[!] credentials.json not found at: {creds_path}")
    print("    Download it from Google Cloud Console:")
    print("    APIs & Services > Credentials > OAuth 2.0 Client IDs > Desktop app > Download JSON")
    print(f"    Save it to: {creds_path}")
    sys.exit(1)

from google_auth_oauthlib.flow import InstalledAppFlow

flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
creds = flow.run_local_server(port=0)

os.makedirs(os.path.dirname(token_path), exist_ok=True)
with open(token_path, "w") as f:
    f.write(creds.to_json())

print(f"[✓] Gmail token saved to: {token_path}")
print("    Ziggy can now read and send emails.")
