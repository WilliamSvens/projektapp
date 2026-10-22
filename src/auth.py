from __future__ import annotations

import streamlit as st


def _auth_configured() -> bool:
    try:
        auth = st.secrets["auth"]
    except Exception:
        return False
    required = ("client_id", "client_secret", "redirect_uri", "cookie_secret", "server_metadata_url")
    return all(str(auth.get(key, "")).strip() for key in required)


def _allowed_emails() -> list[str]:
    try:
        emails = st.secrets.get("app", {}).get("allowed_emails", [])
    except Exception:
        return []
    if isinstance(emails, str):
        emails = [emails]
    return [email.strip().lower() for email in emails if str(email).strip()]


def require_login() -> None:
    if not _auth_configured():
        st.title("Projektapp")
        st.error("Google-inloggning är inte konfigurerad ännu.")
        st.markdown(
            """
            1. Kopiera `.streamlit/secrets.toml.example` till `.streamlit/secrets.toml`.
            2. Klistra in din Google Client ID och Client Secret.
            3. Sätt `cookie_secret` till en lång slumpmässig sträng.
            4. I Google Cloud Console, lägg till redirect URI:
               `http://localhost:8501/oauth2callback`
            5. Starta om appen.
            """
        )
        st.stop()

    if not getattr(st.user, "is_logged_in", False):
        st.title("Projektapp")
        st.write("Logga in med Google för att se dina fiber- och CAT6-projekt.")
        st.button("Logga in med Google", type="primary", on_click=st.login)
        st.caption("Fungerar även i telefonens webbläsare när appen körs mot en URL du kan nå.")
        st.stop()

    email = str(getattr(st.user, "email", "") or "").lower()
    allowed = _allowed_emails()
    if allowed and email not in allowed:
        st.title("Ingen åtkomst")
        st.error(f"{email} är inte behörig. Lägg till adressen i `allowed_emails` i secrets.toml.")
        st.button("Logga ut", on_click=st.logout)
        st.stop()
