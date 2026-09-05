"""Authorization endpoint, hosted login, and identity/delegated consent."""

from __future__ import annotations

import re
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlencode

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates

from src.academy.models import AcademyAuthError
from src.crypto.hashing import sha256_hex
from src.crypto.vault_crypto import master_key_from_secret, seal
from src.crypto.vault_payload import CURRENT_VAULT_KEY_VERSION, VaultPlaintext, pack_vault_plaintext
from src.models.authorization_code import AuthorizationCode
from src.models.client import PublishingStatus
from src.models.consent import Consent, ConsentMode
from src.models.vault import VaultEntry
from src.oidc import deps
from src.oidc.pending_credentials import PendingCredentials
from src.oidc.scopes import parse_scopes, scope_labels
from src.session_cookie import LoginPendingState

if TYPE_CHECKING:
    from src.config import AppConfig
    from src.models.client import Client
    from src.oidc.pending_credentials import PendingCredentialStore
    from src.repos.auth_codes import AuthCodeRepo
    from src.repos.testers import TesterRepo
    from src.repos.vault import VaultRepo
    from src.session_cookie import SessionStore

router = APIRouter(tags=["oidc"])

SESSION_COOKIE_NAME = "oauth2_login"
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))

# PKCE code_challenge is BASE64URL without padding (ASCII).
_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]+$")

_IDENTITY_STORAGE = "We do not store your PESU credentials. This app cannot call the future API on your behalf."
_DELEGATED_STORAGE = (
    "We will store your password and Academy session because this client will make future API requests on your behalf."
)


def _set_session_cookie(response: Response, config: AppConfig, value: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=value,
        httponly=True,
        secure=config.app_env != "local",
        samesite="lax",
        max_age=config.session_cookie_ttl_seconds,
        path="/",
    )


def _clear_session_cookie(response: Response, config: AppConfig) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=config.app_env != "local",
        httponly=True,
        samesite="lax",
    )


def _load_pending(request: Request, store: SessionStore) -> LoginPendingState | None:
    raw = request.cookies.get(SESSION_COOKIE_NAME)
    if raw is None:
        return None
    return store.load(raw)


def _error_page(request: Request, *, title: str, message: str, status_code: int = 400) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "error.html",
        {"title": title, "message": message},
        status_code=status_code,
    )


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


def _testing_gate_required(status: PublishingStatus) -> bool:
    return status in {PublishingStatus.TESTING, PublishingStatus.PENDING_PRODUCTION}


async def _passes_testing_gate(
    *,
    client: Client,
    sub: str,
    testers: TesterRepo,
) -> bool:
    if not _testing_gate_required(client.publishing_status):
        return True
    if sub == client.owner_sub:
        return True
    return await testers.is_tester(client.client_id, sub)


def _consent_covers(existing: Consent | None, scopes: frozenset[str], mode: ConsentMode) -> bool:
    if existing is None:
        return False
    if mode == ConsentMode.DELEGATED and existing.mode != ConsentMode.DELEGATED:
        return False
    return scopes <= existing.scopes


def _append_redirect_params(redirect_uri: str, query: dict[str, str]) -> str:
    """Append query params with ``?`` or ``&`` depending on existing query."""
    sep = "&" if "?" in redirect_uri else "?"
    return f"{redirect_uri}{sep}{urlencode(query)}"


def _mode_for_client(client: Client) -> ConsentMode:
    return ConsentMode.DELEGATED if client.delegated_allowed else ConsentMode.IDENTITY


def _storage_sentence(mode: ConsentMode) -> str:
    if mode == ConsentMode.DELEGATED:
        return _DELEGATED_STORAGE
    return _IDENTITY_STORAGE


async def _seal_credentials_into_vault(
    *,
    creds: PendingCredentials,
    sub: str,
    config: AppConfig,
    vault: VaultRepo,
) -> None:
    if config.vault_master_key is None:
        msg = "VAULT_MASTER_KEY is required for delegated consent"
        raise ValueError(msg)

    plaintext = pack_vault_plaintext(
        VaultPlaintext(
            username=creds.username,
            password=creds.password,
            session=creds.session,
        )
    )
    master = master_key_from_secret(config.vault_master_key)
    blob = seal(master, plaintext, key_version=CURRENT_VAULT_KEY_VERSION)
    await vault.upsert_vault(
        VaultEntry(sub=sub, blob=blob, session_expires_at=creds.session.expires_at),
    )


def _discard_pending_creds(store: PendingCredentialStore, pending: LoginPendingState) -> None:
    if pending.pending_cred_id is not None:
        store.pop(pending.pending_cred_id)


async def _seal_delegated_or_error(
    request: Request,
    *,
    cred_id: str,
    sub: str,
    config: AppConfig,
) -> HTMLResponse | None:
    """Seal vault from pending creds; return an error page or None on success."""
    cred_store = deps.pending_credentials(request)
    creds = cred_store.get(cred_id)
    if creds is None:
        return _error_page(
            request,
            title="Session expired",
            message="Start again from your application.",
        )
    try:
        await _seal_credentials_into_vault(
            creds=creds,
            sub=sub,
            config=config,
            vault=deps.vault(request),
        )
    except Exception:
        return _error_page(
            request,
            title="Vault unavailable",
            message="Delegated credential storage is not configured. Try again later.",
            status_code=503,
        )
    cred_store.pop(cred_id)
    return None


async def _issue_code_redirect(
    *,
    pending: LoginPendingState,
    sub: str,
    auth_codes: AuthCodeRepo,
    config: AppConfig,
    clear_cookie: bool = True,
) -> RedirectResponse:
    raw_code = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    await auth_codes.store_code(
        AuthorizationCode(
            code_hash=sha256_hex(raw_code),
            client_id=pending.client_id,
            sub=sub,
            redirect_uri=pending.redirect_uri,
            scopes=pending.scopes,
            code_challenge=pending.code_challenge,
            code_challenge_method="S256",
            mode=pending.mode,
            expires_at=now + timedelta(seconds=config.authorization_code_ttl_seconds),
            created_at=now,
            nonce=pending.nonce,
        )
    )
    query: dict[str, str] = {"code": raw_code}
    if pending.state is not None:
        query["state"] = pending.state
    response = RedirectResponse(
        url=_append_redirect_params(pending.redirect_uri, query),
        status_code=302,
    )
    if clear_cookie:
        _clear_session_cookie(response, config)
    return response


@router.get("/authorize")
async def authorize(
    request: Request,
    response_type: str | None = None,
    client_id: str | None = None,
    redirect_uri: str | None = None,
    scope: str | None = None,
    state: str | None = None,
    nonce: str | None = None,
    code_challenge: str | None = None,
    code_challenge_method: str | None = None,
) -> Response:
    """Validate the authorization request and start the login session."""
    config = deps.config(request)
    store = deps.session_store(request)
    client_repo = deps.clients(request)

    if not client_id:
        return _error_page(request, title="Invalid request", message="Missing client_id.")

    client = await client_repo.get_client(client_id)
    if client is None:
        return _error_page(request, title="Unknown client", message="This application is not registered.")

    if not redirect_uri or redirect_uri not in client.redirect_uris:
        return _error_page(
            request,
            title="Invalid redirect",
            message="redirect_uri is missing or not registered for this client.",
        )

    if response_type != "code":
        return _error_page(request, title="Unsupported response", message="Only response_type=code is supported.")

    if not code_challenge or not code_challenge_method:
        return _error_page(
            request,
            title="PKCE required",
            message="Authorization requires PKCE with code_challenge and code_challenge_method=S256.",
        )
    if code_challenge_method != "S256":
        return _error_page(
            request,
            title="PKCE required",
            message="Only code_challenge_method=S256 is supported.",
        )
    if not _CHALLENGE_RE.fullmatch(code_challenge):
        return _error_page(
            request,
            title="Invalid PKCE",
            message="code_challenge must be a BASE64URL (S256) string.",
        )

    try:
        scopes = parse_scopes(scope or "")
    except ValueError:
        return _error_page(
            request,
            title="Invalid scope",
            message="A valid openid scope is required.",
        )

    pending = LoginPendingState(
        client_id=client.client_id,
        redirect_uri=redirect_uri,
        scopes=scopes,
        code_challenge=code_challenge,
        mode=_mode_for_client(client),
        authenticated_sub=None,
        state=state,
        nonce=nonce,
    )
    redirect = RedirectResponse(url="/login", status_code=302)
    _set_session_cookie(redirect, config, store.dump(pending))
    return redirect


@router.get("/login", response_class=HTMLResponse)
async def login_get(request: Request) -> Response:
    """Render the hosted PESU login form."""
    store = deps.session_store(request)
    pending = _load_pending(request, store)
    if pending is None:
        return _error_page(request, title="Session expired", message="Start again from your application.")
    return templates.TemplateResponse(
        request,
        "login.html",
        {"title": "Sign in — PESU OAuth2", "error": None},
    )


@router.post("/login")
async def login_post(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
) -> Response:
    """Authenticate via Academy, apply Testing gate, then consent or issue code."""
    config = deps.config(request)
    store = deps.session_store(request)
    limiter = deps.login_limiter(request)

    # 10 POSTs / minute / client IP (in-memory; see SlidingWindowRateLimiter caveat).
    if not limiter.allow(_client_ip(request)):
        return _error_page(
            request,
            title="Too many attempts",
            message="Too many login attempts. Please wait a minute and try again.",
            status_code=429,
        )

    pending = _load_pending(request, store)
    if pending is None:
        return _error_page(request, title="Session expired", message="Start again from your application.")

    client = await deps.clients(request).get_client(pending.client_id)
    if client is None:
        return _error_page(request, title="Unknown client", message="This application is not registered.")

    try:
        result = await deps.academy(request).login(username.strip(), password)
    except AcademyAuthError:
        # AC-007: failed Academy login must not upsert a user.
        return templates.TemplateResponse(
            request,
            "login.html",
            {
                "title": "Sign in — PESU OAuth2",
                "error": "Invalid username or password.",
            },
            status_code=200,
        )

    user = await deps.users(request).upsert_user_from_profile(result.profile)
    if not await _passes_testing_gate(client=client, sub=user.sub, testers=deps.testers(request)):
        return _error_page(
            request,
            title="Not authorized",
            message=(
                "This app is in Testing. Only the developer and invited testers "
                "can sign in until it is approved for Production."
            ),
            status_code=200,
        )

    pending_cred_id: str | None = None
    if pending.mode == ConsentMode.DELEGATED:
        pending_cred_id = deps.pending_credentials(request).put(
            PendingCredentials(
                username=username.strip(),
                password=password,
                session=result.session,
            )
        )
    del result
    del password

    updated = LoginPendingState(
        client_id=pending.client_id,
        redirect_uri=pending.redirect_uri,
        scopes=pending.scopes,
        code_challenge=pending.code_challenge,
        mode=pending.mode,
        authenticated_sub=user.sub,
        state=pending.state,
        nonce=pending.nonce,
        pending_cred_id=pending_cred_id,
    )
    return await _after_login_authenticated(
        request,
        pending=pending,
        updated=updated,
        user_sub=user.sub,
        client_id=client.client_id,
        pending_cred_id=pending_cred_id,
        config=config,
        store=store,
    )


async def _after_login_authenticated(
    request: Request,
    *,
    pending: LoginPendingState,
    updated: LoginPendingState,
    user_sub: str,
    client_id: str,
    pending_cred_id: str | None,
    config: AppConfig,
    store: SessionStore,
) -> Response:
    """Consent skip / redirect after successful Academy auth."""
    existing = await deps.consents(request).get_consent(user_sub, client_id)
    if _consent_covers(existing, pending.scopes, pending.mode):
        if pending.mode == ConsentMode.DELEGATED:
            if pending_cred_id is None:
                return _error_page(
                    request,
                    title="Session expired",
                    message="Start again from your application.",
                )
            seal_err = await _seal_delegated_or_error(
                request,
                cred_id=pending_cred_id,
                sub=user_sub,
                config=config,
            )
            if seal_err is not None:
                return seal_err
        return await _issue_code_redirect(
            pending=updated,
            sub=user_sub,
            auth_codes=deps.auth_codes(request),
            config=config,
        )

    redirect = RedirectResponse(url="/consent", status_code=302)
    _set_session_cookie(redirect, config, store.dump(updated))
    return redirect


@router.get("/consent", response_class=HTMLResponse)
async def consent_get(request: Request) -> Response:
    """Show consent with publisher, redirect URI, and mode-specific storage sentence."""
    store = deps.session_store(request)
    pending = _load_pending(request, store)
    if pending is None or pending.authenticated_sub is None:
        return _error_page(request, title="Session expired", message="Start again from your application.")

    client = await deps.clients(request).get_client(pending.client_id)
    if client is None:
        return _error_page(request, title="Unknown client", message="This application is not registered.")

    status_label = {
        PublishingStatus.TESTING: "Testing",
        PublishingStatus.PENDING_PRODUCTION: "Testing (pending Production)",
        PublishingStatus.PRODUCTION: "Production",
    }[client.publishing_status]

    return templates.TemplateResponse(
        request,
        "consent.html",
        {
            "title": "Authorize — PESU OAuth2",
            "app_name": client.name,
            "publisher": client.owner_sub,
            "redirect_uri": pending.redirect_uri,
            "publishing_status": status_label,
            "scopes": scope_labels(pending.scopes),
            "storage_sentence": _storage_sentence(pending.mode),
            "consent_mode": pending.mode.value,
        },
    )


@router.post("/consent")
async def consent_post(
    request: Request,
    decision: str = Form(...),
) -> Response:
    """Allow or deny consent; delegated Allow seals password+session into the vault."""
    config = deps.config(request)
    store = deps.session_store(request)
    cred_store = deps.pending_credentials(request)
    pending = _load_pending(request, store)
    if pending is None or pending.authenticated_sub is None:
        return _error_page(request, title="Session expired", message="Start again from your application.")

    if decision != "allow":
        _discard_pending_creds(cred_store, pending)
        query: dict[str, str] = {"error": "access_denied"}
        if pending.state is not None:
            query["state"] = pending.state
        response = RedirectResponse(
            url=_append_redirect_params(pending.redirect_uri, query),
            status_code=302,
        )
        _clear_session_cookie(response, config)
        return response

    if pending.mode == ConsentMode.DELEGATED:
        if pending.pending_cred_id is None:
            return _error_page(
                request,
                title="Session expired",
                message="Start again from your application.",
            )
        seal_err = await _seal_delegated_or_error(
            request,
            cred_id=pending.pending_cred_id,
            sub=pending.authenticated_sub,
            config=config,
        )
        if seal_err is not None:
            return seal_err

    await deps.consents(request).upsert_consent(
        Consent(
            sub=pending.authenticated_sub,
            client_id=pending.client_id,
            scopes=pending.scopes,
            mode=pending.mode,
            granted_at=datetime.now(UTC),
        )
    )
    # Identity Allow: credentials were never retained; vault stays empty.

    return await _issue_code_redirect(
        pending=pending,
        sub=pending.authenticated_sub,
        auth_codes=deps.auth_codes(request),
        config=config,
    )
