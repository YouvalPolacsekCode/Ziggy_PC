from __future__ import annotations

import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from core.logger_module import log_info, log_error
from core.settings_loader import settings


def _cfg() -> dict:
    return settings.get("email", {})


def is_configured() -> bool:
    c = _cfg()
    return bool(c.get("enabled") and c.get("host") and c.get("username") and c.get("password"))


def send(to: str, subject: str, html: str, text: str | None = None) -> tuple[bool, str | None]:
    """Send an email. Returns (ok, error_message)."""
    if not is_configured():
        return False, "Email not configured"

    c = _cfg()
    host     = c["host"]
    port     = int(c.get("port", 587))
    username = c["username"]
    password = c["password"]
    from_addr = c.get("from_address") or username
    from_name = c.get("from_name", "Ziggy")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{from_name} <{from_addr}>"
    msg["To"]      = to

    if text:
        msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=10) as s:
            s.ehlo()
            s.starttls(context=context)
            s.login(username, password)
            s.sendmail(from_addr, to, msg.as_string())
        log_info(f"[Email] Sent '{subject}' → {to}")
        return True, None
    except Exception as e:
        log_error(f"[Email] Failed to send to {to}: {e}")
        return False, str(e)


def _branded_wrapper(inner_html: str, footer_url: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08)">
    <div style="background:#0f0f0f;padding:32px 36px 24px;text-align:center">
      <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.02em;color:#fff">
        Ziggy<span style="color:#7c3aed">.</span>
      </p>
      <p style="margin:6px 0 0;font-size:12px;color:#888">Smart home intelligence</p>
    </div>
    <div style="padding:32px 36px">{inner_html}</div>
    <div style="background:#f9f9f9;padding:16px 36px;border-top:1px solid #eee">
      <p style="margin:0;font-size:10px;color:#bbb">
        Or copy this link: <span style="color:#7c3aed;word-break:break-all">{footer_url}</span>
      </p>
    </div>
  </div>
</body>
</html>"""


def send_user_invite(to: str, home_name: str, invited_by: str, invite_url: str, role: str) -> tuple[bool, str | None]:
    """Invite an existing user to join this home."""
    role_label = {"super_admin": "Owner", "admin": "Admin", "user": "Member", "guest": "Guest"}.get(role, role)
    subject = f"You've been invited to {home_name} on Ziggy"

    inner = f"""
      <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#111">You're invited</p>
      <p style="margin:0 0 24px;font-size:13px;color:#666;line-height:1.5">
        <strong style="color:#111">{invited_by}</strong> has invited you to join
        <strong style="color:#111">{home_name}</strong> as a <strong style="color:#7c3aed">{role_label}</strong>.
      </p>
      <a href="{invite_url}" style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:-0.01em">
        Accept invite &amp; set up account
      </a>
      <p style="margin:20px 0 0;font-size:11px;color:#aaa;text-align:center;line-height:1.5">
        Link expires in 72 hours. If you weren't expecting this, you can ignore it.
      </p>
    """

    text = (
        f"You've been invited to {home_name} on Ziggy\n\n"
        f"{invited_by} has invited you as {role_label}.\n\n"
        f"Accept here: {invite_url}\n\nLink expires in 72 hours."
    )

    return send(to, subject, _branded_wrapper(inner, invite_url), text)


def send_home_invite(to: str, home_label: str, invited_by: str, invite_url: str) -> tuple[bool, str | None]:
    """Invite someone to set up a brand-new Ziggy home."""
    subject = "Your Ziggy smart home is ready to set up"

    inner = f"""
      <p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#111">Set up your Ziggy home</p>
      <p style="margin:0 0 6px;font-size:13px;color:#666;line-height:1.5">
        <strong style="color:#111">{invited_by}</strong> has set up a Ziggy smart home for you
        {f'— <strong>{home_label}</strong>' if home_label else ''}.
      </p>
      <p style="margin:0 0 24px;font-size:13px;color:#666;line-height:1.5">
        Click below to create your account and start controlling your home.
      </p>
      <a href="{invite_url}" style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:-0.01em">
        Set up my home
      </a>
      <p style="margin:20px 0 0;font-size:11px;color:#aaa;text-align:center;line-height:1.5">
        Link expires in 72 hours. If you weren't expecting this, you can ignore it.
      </p>
    """

    text = (
        f"Your Ziggy smart home is ready to set up\n\n"
        f"{invited_by} has set up a Ziggy home for you{f' ({home_label})' if home_label else ''}.\n\n"
        f"Create your account here: {invite_url}\n\nLink expires in 72 hours."
    )

    return send(to, subject, _branded_wrapper(inner, invite_url), text)
