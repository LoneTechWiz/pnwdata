# flet-pnwdata Server Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Discord-OAuth-based authentication to the FastAPI backend: the Flet client (web/desktop/mobile) obtains a Discord access token via Flet's built-in OAuth flow, posts it to `POST /api/auth/exchange`, and receives a server-signed JWT. The JWT carries Discord identity + guild role IDs and gates the admin endpoints (`/api/role-config`, `/api/war-config`, and `POST /api/sync`).

**Architecture:** The Flet client owns the OAuth dance (browser/webview/system-browser depending on platform). The server's job is to (a) verify the Discord access token by calling Discord, (b) look up the user's guild membership + roles via the bot token, (c) issue a 7-day HS256 JWT, and (d) provide a FastAPI dependency that enforces role-config access on protected routes. JWT is sent as `Authorization: Bearer <token>` on subsequent requests — no cookies, so the same flow works on web, desktop, and mobile.

**Tech Stack:** FastAPI, PyJWT (new dependency), httpx, pydantic, pytest, respx (all already installed except PyJWT).

**Scope check:** This plan covers one cohesive subsystem (auth + admin config endpoints) — a single plan is appropriate.

This plan assumes Plans 1 and 2 are complete (75 tests passing).

---

## File Structure

Files this plan creates or modifies (under `flet-pnwdata/`):

```
flet-pnwdata/
├── pyproject.toml                       # MODIFY — add PyJWT
├── data/
│   └── role-config.json                 # CREATE — sample config (gitignored)
├── server/
│   ├── settings.py                      # MODIFY — add SESSION_SECRET, DISCORD_* vars
│   ├── session.py                       # CREATE — JWT issue/verify
│   ├── discord_api.py                   # CREATE — Discord API client (user + guild member + roles)
│   ├── role_config.py                   # CREATE — read/write data/role-config.json + has_access()
│   ├── war_config.py                    # MODIFY — add write_war_config()
│   ├── auth.py                          # CREATE — FastAPI dependency for Bearer auth + role gating
│   ├── main.py                          # MODIFY — register 3 new routers
│   └── routes/
│       ├── auth.py                      # CREATE — /api/auth/exchange + /api/auth/me + /api/auth/logout
│       ├── role_config.py               # CREATE — GET/POST /api/role-config (admin only)
│       ├── war_config.py                # CREATE — GET/POST /api/war-config (admin only)
│       └── sync.py                      # MODIFY — gate POST with require_admin
└── tests/
    ├── test_session.py
    ├── test_discord_api.py
    ├── test_role_config.py
    ├── test_auth_dependency.py
    ├── test_routes_auth.py
    ├── test_routes_role_config.py
    ├── test_routes_war_config.py
    └── test_routes_sync.py              # MODIFY — add auth checks
```

Each module has one job: `session.py` only signs/verifies tokens; `discord_api.py` only talks to Discord; `role_config.py` only reads/writes one JSON file; `auth.py` only enforces auth at request time. Routes are kept thin.

---

### Task 1: Add PyJWT dependency + auth env vars

**Files:**
- Modify: `flet-pnwdata/pyproject.toml`
- Modify: `flet-pnwdata/.env.example`
- Modify: `flet-pnwdata/server/settings.py`

- [ ] **Step 1: Add PyJWT to pyproject.toml**

Edit `flet-pnwdata/pyproject.toml`. In `[project].dependencies`, append `"PyJWT>=2.9"`:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "httpx>=0.27",
    "pydantic>=2.9",
    "python-dotenv>=1.0",
    "openpyxl>=3.1",
    "PyJWT>=2.9",
]
```

- [ ] **Step 2: Reinstall and verify**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pip install -e ".[dev]"
.venv/bin/python -c "import jwt; print(jwt.__version__)"
```
Expected: install succeeds, prints a version like `2.9.x` or `2.10.x`.

- [ ] **Step 3: Add new env vars to .env.example**

Edit `flet-pnwdata/.env.example`. Append:

```
# Auth
SESSION_SECRET=        # min 32 chars; HS256 signing key for JWTs
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
DISCORD_BOT_TOKEN=
DISCORD_ADMIN_ROLE=Emperor

# Paths
ROLE_CONFIG_PATH=data/role-config.json
```

- [ ] **Step 4: Add settings constants**

Edit `flet-pnwdata/server/settings.py`. Append after the existing constants:

```python
SESSION_SECRET = env("SESSION_SECRET", "")
DISCORD_CLIENT_ID = env("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = env("DISCORD_CLIENT_SECRET", "")
DISCORD_GUILD_ID = env("DISCORD_GUILD_ID", "")
DISCORD_BOT_TOKEN = env("DISCORD_BOT_TOKEN", "")
DISCORD_ADMIN_ROLE = env("DISCORD_ADMIN_ROLE", "Emperor")
ROLE_CONFIG_PATH = env("ROLE_CONFIG_PATH", "data/role-config.json")
```

- [ ] **Step 5: Sample role-config.json**

Create `flet-pnwdata/data/role-config.json`:

```json
{
  "pages": {}
}
```

- [ ] **Step 6: Full suite still passes**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q
```
Expected: 75 passed.

- [ ] **Step 7: No commit.**

---

### Task 2: Session module (JWT issue/verify)

**Files:**
- Create: `flet-pnwdata/server/session.py`
- Test: `flet-pnwdata/tests/test_session.py`

Mirrors `src/lib/session.ts` from the Next.js project. Payload: `{discordId, username, avatar, roleIds, isEmperor}`. HS256, 7-day expiry, signed with `SESSION_SECRET`. The Next.js port stored these in a cookie; this Python port returns the raw token to the client (who stores it in `client_storage`).

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_session.py`:

```python
import time
import pytest

from server.session import (
    SessionPayload,
    create_session_token,
    verify_session_token,
    SessionVerificationError,
)


SECRET = "x" * 32


def _payload(**overrides) -> SessionPayload:
    base: SessionPayload = {
        "discordId": "12345",
        "username": "tester",
        "avatar": "abc",
        "roleIds": ["role1", "role2"],
        "isEmperor": False,
    }
    base.update(overrides)
    return base


def test_create_and_verify_round_trips(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    token = create_session_token(_payload())
    decoded = verify_session_token(token)
    assert decoded["discordId"] == "12345"
    assert decoded["username"] == "tester"
    assert decoded["roleIds"] == ["role1", "role2"]
    assert decoded["isEmperor"] is False


def test_verify_returns_emperor_flag_intact(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    token = create_session_token(_payload(isEmperor=True))
    decoded = verify_session_token(token)
    assert decoded["isEmperor"] is True


def test_verify_rejects_token_signed_with_wrong_secret(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    token = create_session_token(_payload())
    monkeypatch.setenv("SESSION_SECRET", "y" * 32)
    with pytest.raises(SessionVerificationError):
        verify_session_token(token)


def test_verify_rejects_garbage(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    with pytest.raises(SessionVerificationError):
        verify_session_token("not.a.jwt")


def test_create_token_rejects_short_secret(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "tooshort")
    with pytest.raises(RuntimeError, match="at least 32"):
        create_session_token(_payload())


def test_verify_rejects_expired_token(monkeypatch):
    """If the JWT exp claim is in the past, verification should fail."""
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    # Issue with a tiny expiry by monkeypatching the duration constant
    import server.session as session_mod
    monkeypatch.setattr(session_mod, "SESSION_MAX_AGE_SECONDS", 1)
    token = create_session_token(_payload())
    time.sleep(1.5)
    with pytest.raises(SessionVerificationError):
        verify_session_token(token)
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_session.py -v`
Expected: ImportError on `server.session`.

- [ ] **Step 3: Implement session.py**

Create `flet-pnwdata/server/session.py`:

```python
"""JWT session helpers.

Mirrors src/lib/session.ts from the Next.js port. The Next.js version
stored the token in an HttpOnly cookie; the Flet port returns the raw
token string and lets the client store it via page.client_storage.

Reads SESSION_SECRET from os.environ at call time so tests using
monkeypatch.setenv work regardless of when settings was first imported.
"""
from __future__ import annotations

import os
import time
from typing import TypedDict, cast

import jwt


SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7  # 7 days
ALGORITHM = "HS256"


class SessionPayload(TypedDict):
    discordId: str
    username: str
    avatar: str | None
    roleIds: list[str]
    isEmperor: bool


class SessionVerificationError(RuntimeError):
    """Raised when a token cannot be verified (bad signature, expired, malformed)."""


def _get_secret() -> str:
    secret = os.environ.get("SESSION_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("SESSION_SECRET must be set and at least 32 characters")
    return secret


def create_session_token(payload: SessionPayload) -> str:
    """Sign a session payload as an HS256 JWT with a 7-day expiry."""
    now = int(time.time())
    claims = {
        **payload,
        "iat": now,
        "exp": now + SESSION_MAX_AGE_SECONDS,
    }
    return jwt.encode(claims, _get_secret(), algorithm=ALGORITHM)


def verify_session_token(token: str) -> SessionPayload:
    """Decode and verify a JWT. Raises SessionVerificationError on any issue."""
    try:
        claims = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
    except jwt.PyJWTError as e:
        raise SessionVerificationError(str(e)) from e
    # Strip iat/exp before returning the SessionPayload
    return cast(SessionPayload, {
        "discordId": claims["discordId"],
        "username": claims["username"],
        "avatar": claims.get("avatar"),
        "roleIds": claims.get("roleIds", []),
        "isEmperor": bool(claims.get("isEmperor", False)),
    })
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_session.py -v`
Expected: 6 passed.

- [ ] **Step 5: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 81 passed (75 + 6).

- [ ] **Step 6: No commit.**

---

### Task 3: Discord API client

**Files:**
- Create: `flet-pnwdata/server/discord_api.py`
- Test: `flet-pnwdata/tests/test_discord_api.py`

Three functions:
- `fetch_user(access_token)` → GET /users/@me using user's OAuth token, returns `{id, username, avatar}`
- `fetch_guild_member(guild_id, user_id)` → GET /guilds/{guild_id}/members/{user_id} using BOT token, returns `{roles: [str]}`
- `fetch_guild_roles(guild_id)` → GET /guilds/{guild_id}/roles using BOT token, returns `[{id, name}]`

Each raises `DiscordApiError` on non-2xx response.

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_discord_api.py`:

```python
import pytest
import respx

from server.discord_api import (
    fetch_user,
    fetch_guild_member,
    fetch_guild_roles,
    DiscordApiError,
)


@pytest.mark.asyncio
async def test_fetch_user_sends_bearer_token():
    with respx.mock() as mock:
        route = mock.get("https://discord.com/api/v10/users/@me").respond(
            json={"id": "100", "username": "tester", "avatar": "abc"}
        )
        result = await fetch_user("user-token")
        assert result == {"id": "100", "username": "tester", "avatar": "abc"}
        assert route.calls.last.request.headers["authorization"] == "Bearer user-token"


@pytest.mark.asyncio
async def test_fetch_user_raises_on_401():
    with respx.mock() as mock:
        mock.get("https://discord.com/api/v10/users/@me").respond(status_code=401)
        with pytest.raises(DiscordApiError, match="401"):
            await fetch_user("bad-token")


@pytest.mark.asyncio
async def test_fetch_guild_member_sends_bot_token(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token-xyz")
    with respx.mock() as mock:
        route = mock.get(
            "https://discord.com/api/v10/guilds/55555/members/100"
        ).respond(json={"roles": ["r1", "r2"], "user": {"id": "100"}})
        result = await fetch_guild_member("55555", "100")
        assert result == {"roles": ["r1", "r2"], "user": {"id": "100"}}
        assert route.calls.last.request.headers["authorization"] == "Bot bot-token-xyz"


@pytest.mark.asyncio
async def test_fetch_guild_member_raises_when_not_in_guild(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot")
    with respx.mock() as mock:
        mock.get("https://discord.com/api/v10/guilds/55555/members/100").respond(status_code=404)
        with pytest.raises(DiscordApiError, match="404"):
            await fetch_guild_member("55555", "100")


@pytest.mark.asyncio
async def test_fetch_guild_roles_sends_bot_token(monkeypatch):
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot-token-xyz")
    with respx.mock() as mock:
        route = mock.get("https://discord.com/api/v10/guilds/55555/roles").respond(
            json=[{"id": "r1", "name": "Emperor"}, {"id": "r2", "name": "Member"}]
        )
        result = await fetch_guild_roles("55555")
        assert result == [{"id": "r1", "name": "Emperor"}, {"id": "r2", "name": "Member"}]
        assert route.calls.last.request.headers["authorization"] == "Bot bot-token-xyz"
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_discord_api.py -v`
Expected: ImportError on `server.discord_api`.

- [ ] **Step 3: Implement discord_api.py**

Create `flet-pnwdata/server/discord_api.py`:

```python
"""Discord API client.

Three single-purpose helpers used by the auth exchange flow. All read
DISCORD_BOT_TOKEN from os.environ at call time so tests using
monkeypatch.setenv work regardless of import order.
"""
from __future__ import annotations

import os

import httpx


DISCORD_API_BASE = "https://discord.com/api/v10"


class DiscordApiError(RuntimeError):
    """Raised when a Discord API call returns a non-2xx response."""


async def fetch_user(access_token: str) -> dict:
    """GET /users/@me with the user's OAuth access token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{DISCORD_API_BASE}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code >= 400:
        raise DiscordApiError(f"Discord /users/@me returned {resp.status_code}")
    return resp.json()


async def fetch_guild_member(guild_id: str, user_id: str) -> dict:
    """GET /guilds/{guild_id}/members/{user_id} with the bot token.

    Returns the raw member object including `roles: list[str]`.
    Raises DiscordApiError if the user is not in the guild (404) or on
    other failures.
    """
    bot_token = os.environ.get("DISCORD_BOT_TOKEN", "")
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{DISCORD_API_BASE}/guilds/{guild_id}/members/{user_id}",
            headers={"Authorization": f"Bot {bot_token}"},
        )
    if resp.status_code >= 400:
        raise DiscordApiError(
            f"Discord guild member fetch returned {resp.status_code} "
            f"(guild={guild_id}, user={user_id})"
        )
    return resp.json()


async def fetch_guild_roles(guild_id: str) -> list[dict]:
    """GET /guilds/{guild_id}/roles with the bot token."""
    bot_token = os.environ.get("DISCORD_BOT_TOKEN", "")
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{DISCORD_API_BASE}/guilds/{guild_id}/roles",
            headers={"Authorization": f"Bot {bot_token}"},
        )
    if resp.status_code >= 400:
        raise DiscordApiError(f"Discord guild roles fetch returned {resp.status_code}")
    return resp.json()
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_discord_api.py -v`
Expected: 5 passed.

- [ ] **Step 5: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 86 passed (81 + 5).

- [ ] **Step 6: No commit.**

---

### Task 4: Role-config reader/writer

**Files:**
- Create: `flet-pnwdata/server/role_config.py`
- Test: `flet-pnwdata/tests/test_role_config.py`

Mirrors `src/lib/role-config.ts`. Three exports: `read_role_config(path)`, `write_role_config(path, config)`, `has_access(config, route, role_ids)`.

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_role_config.py`:

```python
import json
from pathlib import Path

from server.role_config import (
    read_role_config,
    write_role_config,
    has_access,
    RoleConfig,
)


def test_read_returns_empty_pages_when_file_missing(tmp_path: Path):
    cfg = read_role_config(str(tmp_path / "missing.json"))
    assert cfg == {"pages": {}}


def test_read_returns_empty_pages_when_file_corrupt(tmp_path: Path):
    p = tmp_path / "broken.json"
    p.write_text("{ not json")
    cfg = read_role_config(str(p))
    assert cfg == {"pages": {}}


def test_read_returns_parsed_pages(tmp_path: Path):
    p = tmp_path / "role-config.json"
    p.write_text(json.dumps({"pages": {"/dashboard": ["role1", "role2"]}}))
    cfg = read_role_config(str(p))
    assert cfg == {"pages": {"/dashboard": ["role1", "role2"]}}


def test_write_creates_or_overwrites(tmp_path: Path):
    p = tmp_path / "role-config.json"
    write_role_config(str(p), {"pages": {"/admin": ["roleX"]}})
    assert json.loads(p.read_text()) == {"pages": {"/admin": ["roleX"]}}


def test_has_access_returns_true_when_user_has_allowed_role():
    cfg: RoleConfig = {"pages": {"/dashboard": ["role1", "role2"]}}
    assert has_access(cfg, "/dashboard", ["role0", "role2"]) is True


def test_has_access_returns_false_when_user_has_no_allowed_role():
    cfg: RoleConfig = {"pages": {"/dashboard": ["role1", "role2"]}}
    assert has_access(cfg, "/dashboard", ["role99"]) is False


def test_has_access_returns_false_when_path_not_configured():
    cfg: RoleConfig = {"pages": {"/dashboard": ["role1"]}}
    assert has_access(cfg, "/secret-page", ["role1"]) is False


def test_has_access_returns_false_when_user_has_no_roles():
    cfg: RoleConfig = {"pages": {"/dashboard": ["role1"]}}
    assert has_access(cfg, "/dashboard", []) is False
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_role_config.py -v`
Expected: ImportError on `server.role_config`.

- [ ] **Step 3: Implement role_config.py**

Create `flet-pnwdata/server/role_config.py`:

```python
"""Read/write data/role-config.json and check route access.

Mirrors src/lib/role-config.ts. The config file shape is:

  {"pages": {"/some/route": ["role-id-1", "role-id-2"], ...}}

A missing or malformed file degrades to `{"pages": {}}` (matches Next.js behavior).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict


class RoleConfig(TypedDict):
    pages: dict[str, list[str]]


def read_role_config(path: str) -> RoleConfig:
    """Read the role config. Returns {"pages": {}} if missing or invalid."""
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return {"pages": {}}
    pages = data.get("pages") if isinstance(data, dict) else None
    if not isinstance(pages, dict):
        return {"pages": {}}
    return {"pages": pages}


def write_role_config(path: str, config: RoleConfig) -> None:
    Path(path).write_text(json.dumps(config, indent=2))


def has_access(config: RoleConfig, route: str, role_ids: list[str]) -> bool:
    allowed = config["pages"].get(route)
    if not allowed:
        return False
    return any(rid in allowed for rid in role_ids)
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_role_config.py -v`
Expected: 8 passed.

- [ ] **Step 5: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 94 passed (86 + 8).

- [ ] **Step 6: No commit.**

---

### Task 5: Auth dependency for FastAPI routes

**Files:**
- Create: `flet-pnwdata/server/auth.py`
- Test: `flet-pnwdata/tests/test_auth_dependency.py`

This module exports two FastAPI dependencies:
- `require_session(request)` → returns the decoded session, 401 if missing/invalid
- `require_admin_for(route)` → factory that returns a dependency requiring (isEmperor OR has_access for that route)

Routes use them like:
```python
@router.get("/api/role-config", dependencies=[Depends(require_admin_for("/role-config"))])
```

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_auth_dependency.py`:

```python
import json
from pathlib import Path
import pytest
from fastapi import FastAPI, Depends
from httpx import AsyncClient, ASGITransport

from server.auth import require_session, require_admin_for
from server.session import create_session_token


SECRET = "x" * 32


def _build_app() -> FastAPI:
    app = FastAPI()

    @app.get("/protected")
    async def protected(session = Depends(require_session)):
        return {"discordId": session["discordId"]}

    @app.get("/admin-only")
    async def admin(session = Depends(require_admin_for("/some-admin-route"))):
        return {"ok": True}

    return app


async def _client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.asyncio
async def test_require_session_returns_401_without_token(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    app = _build_app()
    async with await _client(app) as client:
        resp = await client.get("/protected")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_require_session_returns_401_with_garbage_token(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    app = _build_app()
    async with await _client(app) as client:
        resp = await client.get("/protected", headers={"Authorization": "Bearer abc.def.ghi"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_require_session_accepts_valid_token(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    token = create_session_token({
        "discordId": "100", "username": "u", "avatar": None,
        "roleIds": [], "isEmperor": False,
    })
    app = _build_app()
    async with await _client(app) as client:
        resp = await client.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == {"discordId": "100"}


@pytest.mark.asyncio
async def test_require_admin_emperor_bypasses_role_check(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    # role-config doesn't include the admin route — but isEmperor=true bypasses
    cfg = tmp_path / "role-config.json"
    cfg.write_text(json.dumps({"pages": {}}))
    monkeypatch.setenv("ROLE_CONFIG_PATH", str(cfg))

    token = create_session_token({
        "discordId": "100", "username": "u", "avatar": None,
        "roleIds": [], "isEmperor": True,
    })
    app = _build_app()
    async with await _client(app) as client:
        resp = await client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_require_admin_allows_user_with_role(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    cfg = tmp_path / "role-config.json"
    cfg.write_text(json.dumps({"pages": {"/some-admin-route": ["my-role"]}}))
    monkeypatch.setenv("ROLE_CONFIG_PATH", str(cfg))

    token = create_session_token({
        "discordId": "100", "username": "u", "avatar": None,
        "roleIds": ["my-role"], "isEmperor": False,
    })
    app = _build_app()
    async with await _client(app) as client:
        resp = await client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_require_admin_denies_user_without_role(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    cfg = tmp_path / "role-config.json"
    cfg.write_text(json.dumps({"pages": {"/some-admin-route": ["my-role"]}}))
    monkeypatch.setenv("ROLE_CONFIG_PATH", str(cfg))

    token = create_session_token({
        "discordId": "100", "username": "u", "avatar": None,
        "roleIds": ["different-role"], "isEmperor": False,
    })
    app = _build_app()
    async with await _client(app) as client:
        resp = await client.get("/admin-only", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_require_admin_returns_401_without_token(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    app = _build_app()
    async with await _client(app) as client:
        resp = await client.get("/admin-only")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_auth_dependency.py -v`
Expected: ImportError on `server.auth`.

- [ ] **Step 3: Implement auth.py**

Create `flet-pnwdata/server/auth.py`:

```python
"""FastAPI dependencies for Bearer-token auth + role gating.

Usage in route definitions:

    @router.get("/api/foo", dependencies=[Depends(require_session)])
    async def foo(): ...

    @router.post("/api/admin", dependencies=[Depends(require_admin_for("/admin"))])
    async def admin(): ...
"""
from __future__ import annotations

import os
from typing import Callable

from fastapi import Depends, HTTPException, Request, status

from server.role_config import has_access, read_role_config
from server.session import (
    SessionPayload,
    SessionVerificationError,
    verify_session_token,
)


def _role_config_path() -> str:
    """Read at call time so tests can monkeypatch ROLE_CONFIG_PATH."""
    return os.environ.get("ROLE_CONFIG_PATH", "data/role-config.json")


def require_session(request: Request) -> SessionPayload:
    """Read Authorization: Bearer <token>, verify, return the payload.

    Raises 401 on missing or invalid token.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        return verify_session_token(token)
    except SessionVerificationError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid token: {e}")


def require_admin_for(route: str) -> Callable[..., SessionPayload]:
    """Build a dependency that requires (isEmperor) OR (has_access for `route`).

    Both `/role-config` and `/war-config` use this to gate their endpoints.
    Returns 401 if no token, 403 if token is valid but user lacks access.
    """
    def dep(session: SessionPayload = Depends(require_session)) -> SessionPayload:
        if session["isEmperor"]:
            return session
        config = read_role_config(_role_config_path())
        if has_access(config, route, session["roleIds"]):
            return session
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return dep
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_auth_dependency.py -v`
Expected: 7 passed.

- [ ] **Step 5: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 101 passed (94 + 7).

- [ ] **Step 6: No commit.**

---

### Task 6: `POST /api/auth/exchange`, `GET /api/auth/me`, `POST /api/auth/logout`

**Files:**
- Create: `flet-pnwdata/server/routes/auth.py`
- Modify: `flet-pnwdata/server/main.py` (register router)
- Test: `flet-pnwdata/tests/test_routes_auth.py`

The exchange flow:
1. Client POSTs `{"discord_access_token": "..."}` to `/api/auth/exchange`
2. Server calls Discord `/users/@me` with that token → gets `{id, username, avatar}`
3. Server calls Discord `/guilds/{GUILD_ID}/members/{user.id}` with the bot token → gets `{roles: [str]}`
4. Server calls Discord `/guilds/{GUILD_ID}/roles` with the bot token → finds Emperor role by name (or by snowflake if DISCORD_ADMIN_ROLE is numeric)
5. Server signs JWT and returns `{"token": "...", "session": {...}}`

`/api/auth/me` just returns the decoded session — useful for the client to ping after page reload.

`/api/auth/logout` is server-side stateless (no token blocklist), so it just returns `{"ok": true}`. The client is responsible for forgetting the token.

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_routes_auth.py`:

```python
import pytest
import respx

from server.session import create_session_token

SECRET = "x" * 32


@pytest.mark.asyncio
async def test_exchange_returns_token_and_session(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    monkeypatch.setenv("DISCORD_GUILD_ID", "55555")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot")
    monkeypatch.setenv("DISCORD_ADMIN_ROLE", "Emperor")

    with respx.mock() as mock:
        mock.get("https://discord.com/api/v10/users/@me").respond(
            json={"id": "100", "username": "tester", "avatar": "abc"}
        )
        mock.get("https://discord.com/api/v10/guilds/55555/members/100").respond(
            json={"roles": ["r1", "r2"], "user": {"id": "100"}}
        )
        mock.get("https://discord.com/api/v10/guilds/55555/roles").respond(
            json=[
                {"id": "r-emperor", "name": "Emperor"},
                {"id": "r1", "name": "Member"},
            ]
        )
        resp = await client.post(
            "/api/auth/exchange",
            json={"discord_access_token": "fake-token"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert "token" in body
    assert body["session"]["discordId"] == "100"
    assert body["session"]["username"] == "tester"
    assert body["session"]["roleIds"] == ["r1", "r2"]
    assert body["session"]["isEmperor"] is False  # user doesn't have r-emperor


@pytest.mark.asyncio
async def test_exchange_sets_emperor_when_user_has_role(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    monkeypatch.setenv("DISCORD_GUILD_ID", "55555")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot")
    monkeypatch.setenv("DISCORD_ADMIN_ROLE", "Emperor")

    with respx.mock() as mock:
        mock.get("https://discord.com/api/v10/users/@me").respond(
            json={"id": "100", "username": "boss", "avatar": None}
        )
        mock.get("https://discord.com/api/v10/guilds/55555/members/100").respond(
            json={"roles": ["r-emperor"], "user": {"id": "100"}}
        )
        mock.get("https://discord.com/api/v10/guilds/55555/roles").respond(
            json=[{"id": "r-emperor", "name": "Emperor"}]
        )
        resp = await client.post(
            "/api/auth/exchange",
            json={"discord_access_token": "fake-token"},
        )

    assert resp.status_code == 200
    assert resp.json()["session"]["isEmperor"] is True


@pytest.mark.asyncio
async def test_exchange_supports_snowflake_admin_role(app_client, monkeypatch):
    """When DISCORD_ADMIN_ROLE is numeric, match it as a role ID, not name."""
    client, _ = app_client
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    monkeypatch.setenv("DISCORD_GUILD_ID", "55555")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot")
    monkeypatch.setenv("DISCORD_ADMIN_ROLE", "987654321")  # numeric snowflake

    with respx.mock() as mock:
        mock.get("https://discord.com/api/v10/users/@me").respond(
            json={"id": "100", "username": "boss", "avatar": None}
        )
        mock.get("https://discord.com/api/v10/guilds/55555/members/100").respond(
            json={"roles": ["987654321"], "user": {"id": "100"}}
        )
        mock.get("https://discord.com/api/v10/guilds/55555/roles").respond(
            json=[{"id": "987654321", "name": "NotEmperor"}]
        )
        resp = await client.post(
            "/api/auth/exchange",
            json={"discord_access_token": "fake-token"},
        )

    assert resp.status_code == 200
    assert resp.json()["session"]["isEmperor"] is True


@pytest.mark.asyncio
async def test_exchange_400_on_missing_token_field(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    resp = await client.post("/api/auth/exchange", json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_exchange_401_when_discord_rejects_token(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    monkeypatch.setenv("DISCORD_GUILD_ID", "55555")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot")

    with respx.mock() as mock:
        mock.get("https://discord.com/api/v10/users/@me").respond(status_code=401)
        resp = await client.post(
            "/api/auth/exchange",
            json={"discord_access_token": "bad"},
        )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_exchange_403_when_user_not_in_guild(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    monkeypatch.setenv("DISCORD_GUILD_ID", "55555")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "bot")

    with respx.mock() as mock:
        mock.get("https://discord.com/api/v10/users/@me").respond(
            json={"id": "100", "username": "tester", "avatar": None}
        )
        mock.get("https://discord.com/api/v10/guilds/55555/members/100").respond(status_code=404)
        resp = await client.post(
            "/api/auth/exchange",
            json={"discord_access_token": "fake"},
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_me_returns_current_session(app_client, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    token = create_session_token({
        "discordId": "100", "username": "u", "avatar": None,
        "roleIds": ["r1"], "isEmperor": False,
    })
    resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["discordId"] == "100"


@pytest.mark.asyncio
async def test_me_returns_401_without_token(app_client):
    client, _ = app_client
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_logout_returns_ok(app_client):
    client, _ = app_client
    resp = await client.post("/api/auth/logout")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_auth.py -v`
Expected: 404 on every route (router not registered).

- [ ] **Step 3: Implement routes/auth.py**

Create `flet-pnwdata/server/routes/auth.py`:

```python
"""Auth endpoints.

POST /api/auth/exchange   — exchange Discord access token for server JWT
GET  /api/auth/me         — return decoded session (requires Bearer token)
POST /api/auth/logout     — no-op (client clears token); returns {"ok": true}
"""
from __future__ import annotations

import os
import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from server import discord_api
from server.auth import require_session
from server.session import SessionPayload, create_session_token


router = APIRouter()


class ExchangeBody(BaseModel):
    discord_access_token: str


@router.post("/api/auth/exchange")
async def exchange(request: Request):
    # Parse + validate body manually so we return our own 400 shape
    try:
        raw = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON body"})
    token = (raw or {}).get("discord_access_token")
    if not token or not isinstance(token, str):
        return JSONResponse(
            status_code=400, content={"error": "discord_access_token is required"}
        )

    guild_id = os.environ.get("DISCORD_GUILD_ID", "")
    admin_role = os.environ.get("DISCORD_ADMIN_ROLE", "Emperor")
    if not guild_id:
        return JSONResponse(status_code=500, content={"error": "DISCORD_GUILD_ID not configured"})

    # 1. Verify the user via their access token
    try:
        user = await discord_api.fetch_user(token)
    except discord_api.DiscordApiError:
        return JSONResponse(status_code=401, content={"error": "Invalid Discord token"})

    # 2. Look up the user in the guild via bot token
    try:
        member = await discord_api.fetch_guild_member(guild_id, user["id"])
    except discord_api.DiscordApiError:
        return JSONResponse(status_code=403, content={"error": "User is not a member of the guild"})

    role_ids: list[str] = member.get("roles", [])

    # 3. Resolve Emperor: DISCORD_ADMIN_ROLE can be a role name OR a numeric snowflake
    is_emperor = False
    try:
        guild_roles = await discord_api.fetch_guild_roles(guild_id)
    except discord_api.DiscordApiError:
        guild_roles = []
    is_snowflake = re.fullmatch(r"\d+", admin_role) is not None
    emperor_role_id: str | None = None
    if is_snowflake:
        for r in guild_roles:
            if r["id"] == admin_role:
                emperor_role_id = r["id"]
                break
    else:
        for r in guild_roles:
            if r["name"] == admin_role:
                emperor_role_id = r["id"]
                break
    if emperor_role_id is not None:
        is_emperor = emperor_role_id in role_ids

    # 4. Sign JWT
    session: SessionPayload = {
        "discordId": user["id"],
        "username": user["username"],
        "avatar": user.get("avatar"),
        "roleIds": role_ids,
        "isEmperor": is_emperor,
    }
    jwt_token = create_session_token(session)
    return {"token": jwt_token, "session": session}


@router.get("/api/auth/me")
async def me(session: SessionPayload = Depends(require_session)):
    return session


@router.post("/api/auth/logout")
async def logout():
    return {"ok": True}
```

- [ ] **Step 4: Register router in main.py**

Edit `flet-pnwdata/server/main.py`. Update the router-includes block to add the auth router:

```python
    from server.routes import data as data_routes
    from server.routes import sync as sync_routes
    from server.routes import war_targets as war_targets_routes
    from server.routes import beige_watch as beige_watch_routes
    from server.routes import export as export_routes
    from server.routes import auth as auth_routes
    app.include_router(data_routes.router)
    app.include_router(sync_routes.router)
    app.include_router(war_targets_routes.router)
    app.include_router(beige_watch_routes.router)
    app.include_router(export_routes.router)
    app.include_router(auth_routes.router)
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_auth.py -v`
Expected: 9 passed.

- [ ] **Step 6: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 110 passed (101 + 9).

- [ ] **Step 7: No commit.**

---

### Task 7: `GET/POST /api/role-config` (admin-only)

**Files:**
- Create: `flet-pnwdata/server/routes/role_config.py`
- Modify: `flet-pnwdata/server/main.py`
- Test: `flet-pnwdata/tests/test_routes_role_config.py`

GET returns the parsed config; POST validates and writes. Both require admin (Emperor OR has_access for `/role-config`).

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_routes_role_config.py`:

```python
import json
from pathlib import Path
import pytest

from server.session import create_session_token

SECRET = "x" * 32


def _setup(monkeypatch, tmp_path: Path) -> Path:
    cfg = tmp_path / "role-config.json"
    cfg.write_text(json.dumps({"pages": {"/role-config": ["admin-role"]}}))
    monkeypatch.setenv("ROLE_CONFIG_PATH", str(cfg))
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    return cfg


def _admin_token() -> str:
    return create_session_token({
        "discordId": "100", "username": "admin", "avatar": None,
        "roleIds": [], "isEmperor": True,
    })


def _user_with_role(role_id: str) -> str:
    return create_session_token({
        "discordId": "200", "username": "user", "avatar": None,
        "roleIds": [role_id], "isEmperor": False,
    })


@pytest.mark.asyncio
async def test_get_returns_403_without_token(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.get("/api/role-config")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_returns_403_for_non_admin(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    token = _user_with_role("some-other-role")
    resp = await client.get("/api/role-config", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_returns_config_for_emperor(app_client, monkeypatch, tmp_path):
    cfg_path = _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.get("/api/role-config", headers={"Authorization": f"Bearer {_admin_token()}"})
    assert resp.status_code == 200
    assert resp.json() == {"pages": {"/role-config": ["admin-role"]}}


@pytest.mark.asyncio
async def test_get_returns_config_for_user_with_admin_role(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    token = _user_with_role("admin-role")
    resp = await client.get("/api/role-config", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_post_writes_new_config(app_client, monkeypatch, tmp_path):
    cfg_path = _setup(monkeypatch, tmp_path)
    client, _ = app_client
    new_config = {"pages": {"/role-config": ["admin-role"], "/dashboard": ["member-role"]}}
    resp = await client.post(
        "/api/role-config",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json=new_config,
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert json.loads(cfg_path.read_text()) == new_config


@pytest.mark.asyncio
async def test_post_400_on_invalid_shape(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.post(
        "/api/role-config",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json={"not_pages": {}},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_post_403_for_non_admin(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    token = _user_with_role("not-admin")
    resp = await client.post(
        "/api/role-config",
        headers={"Authorization": f"Bearer {token}"},
        json={"pages": {}},
    )
    assert resp.status_code == 403
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_role_config.py -v`
Expected: 404 / route not registered.

- [ ] **Step 3: Implement routes/role_config.py**

Create `flet-pnwdata/server/routes/role_config.py`:

```python
"""GET/POST /api/role-config (admin-only)."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from server.auth import require_admin_for
from server.role_config import read_role_config, write_role_config

router = APIRouter()


def _path() -> str:
    return os.environ.get("ROLE_CONFIG_PATH", "data/role-config.json")


@router.get("/api/role-config", dependencies=[Depends(require_admin_for("/role-config"))])
async def get_role_config():
    return read_role_config(_path())


@router.post("/api/role-config", dependencies=[Depends(require_admin_for("/role-config"))])
async def post_role_config(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON body"})
    pages = (body or {}).get("pages")
    if not isinstance(pages, dict):
        return JSONResponse(status_code=400, content={"error": "Invalid config"})
    # Coerce: keys are strings, values are lists of strings
    coerced: dict[str, list[str]] = {}
    for k, v in pages.items():
        if not isinstance(k, str) or not isinstance(v, list):
            return JSONResponse(status_code=400, content={"error": "Invalid config"})
        coerced[k] = [str(x) for x in v]
    write_role_config(_path(), {"pages": coerced})
    return {"ok": True}
```

- [ ] **Step 4: Register router in main.py**

Edit `flet-pnwdata/server/main.py`. Add the role_config router. The block should now include:

```python
    from server.routes import role_config as role_config_routes
    app.include_router(role_config_routes.router)
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_role_config.py -v`
Expected: 7 passed.

- [ ] **Step 6: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 117 passed (110 + 7).

- [ ] **Step 7: No commit.**

---

### Task 8: `GET/POST /api/war-config` (admin-only)

**Files:**
- Modify: `flet-pnwdata/server/war_config.py` (add `write_war_config`)
- Create: `flet-pnwdata/server/routes/war_config.py`
- Modify: `flet-pnwdata/server/main.py`
- Test: `flet-pnwdata/tests/test_routes_war_config.py`

- [ ] **Step 1: Add `write_war_config` to war_config.py**

Edit `flet-pnwdata/server/war_config.py`. Append:

```python
def write_war_config(path: str | Path, config: dict) -> None:
    """Serialize config (with `enemy_alliance_ids` and `ally_alliance_ids`) to disk."""
    Path(path).write_text(json.dumps(config, indent=2))
```

- [ ] **Step 2: Write the failing test**

Create `flet-pnwdata/tests/test_routes_war_config.py`:

```python
import json
from pathlib import Path
import pytest

from server.session import create_session_token

SECRET = "x" * 32


def _setup(monkeypatch, tmp_path: Path) -> tuple[Path, Path]:
    war_cfg = tmp_path / "war-config.json"
    war_cfg.write_text(json.dumps({
        "enemy_alliance_ids": [100, 200],
        "ally_alliance_ids": [300],
    }))
    role_cfg = tmp_path / "role-config.json"
    role_cfg.write_text(json.dumps({"pages": {"/war-config": ["war-admin"]}}))
    monkeypatch.setenv("WAR_CONFIG_PATH", str(war_cfg))
    monkeypatch.setenv("ROLE_CONFIG_PATH", str(role_cfg))
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    return war_cfg, role_cfg


def _admin_token() -> str:
    return create_session_token({
        "discordId": "100", "username": "admin", "avatar": None,
        "roleIds": [], "isEmperor": True,
    })


@pytest.mark.asyncio
async def test_get_returns_401_without_token(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.get("/api/war-config")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_returns_403_for_non_admin(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    token = create_session_token({
        "discordId": "200", "username": "u", "avatar": None,
        "roleIds": ["no-access"], "isEmperor": False,
    })
    resp = await client.get("/api/war-config", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_returns_config_for_emperor(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.get("/api/war-config", headers={"Authorization": f"Bearer {_admin_token()}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["enemy_alliance_ids"] == [100, 200]
    assert body["ally_alliance_ids"] == [300]


@pytest.mark.asyncio
async def test_post_writes_new_config(app_client, monkeypatch, tmp_path):
    war_cfg, _ = _setup(monkeypatch, tmp_path)
    client, _ = app_client
    new = {"enemy_alliance_ids": [777], "ally_alliance_ids": [888, 999]}
    resp = await client.post(
        "/api/war-config",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json=new,
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert json.loads(war_cfg.read_text()) == new


@pytest.mark.asyncio
async def test_post_400_on_missing_fields(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.post(
        "/api/war-config",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json={"enemy_alliance_ids": [1]},  # missing ally_alliance_ids
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_post_400_on_non_array_field(app_client, monkeypatch, tmp_path):
    _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.post(
        "/api/war-config",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json={"enemy_alliance_ids": "not an array", "ally_alliance_ids": []},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_post_coerces_strings_to_ints(app_client, monkeypatch, tmp_path):
    war_cfg, _ = _setup(monkeypatch, tmp_path)
    client, _ = app_client
    resp = await client.post(
        "/api/war-config",
        headers={"Authorization": f"Bearer {_admin_token()}"},
        json={"enemy_alliance_ids": ["100", "200"], "ally_alliance_ids": ["300"]},
    )
    assert resp.status_code == 200
    saved = json.loads(war_cfg.read_text())
    assert saved == {"enemy_alliance_ids": [100, 200], "ally_alliance_ids": [300]}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_war_config.py -v`
Expected: 404 / not registered.

- [ ] **Step 4: Implement routes/war_config.py**

Create `flet-pnwdata/server/routes/war_config.py`:

```python
"""GET/POST /api/war-config (admin-only)."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from server.auth import require_admin_for
from server.war_config import load_war_config, write_war_config, WarConfigError

router = APIRouter()


def _path() -> str:
    return os.environ.get("WAR_CONFIG_PATH", "data/war-config.json")


@router.get("/api/war-config", dependencies=[Depends(require_admin_for("/war-config"))])
async def get_war_config():
    try:
        return load_war_config(_path())
    except WarConfigError as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@router.post("/api/war-config", dependencies=[Depends(require_admin_for("/war-config"))])
async def post_war_config(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON body"})
    enemy = (body or {}).get("enemy_alliance_ids")
    ally = (body or {}).get("ally_alliance_ids")
    if not isinstance(enemy, list) or not isinstance(ally, list):
        return JSONResponse(
            status_code=400,
            content={"error": "enemy_alliance_ids and ally_alliance_ids must be arrays"},
        )
    try:
        enemy_ints = [int(x) for x in enemy]
        ally_ints = [int(x) for x in ally]
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"error": "IDs must be numeric"})
    write_war_config(_path(), {"enemy_alliance_ids": enemy_ints, "ally_alliance_ids": ally_ints})
    return {"ok": True}
```

- [ ] **Step 5: Register router in main.py**

Edit `flet-pnwdata/server/main.py`. Add:

```python
    from server.routes import war_config as war_config_routes
    app.include_router(war_config_routes.router)
```

- [ ] **Step 6: Run tests, verify pass**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_war_config.py -v`
Expected: 7 passed.

- [ ] **Step 7: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 124 passed (117 + 7).

- [ ] **Step 8: No commit.**

---

### Task 9: Gate `POST /api/sync` as admin-only

**Files:**
- Modify: `flet-pnwdata/server/routes/sync.py` (add the dependency)
- Modify: `flet-pnwdata/tests/test_routes_sync.py` (add auth headers to existing tests)

The existing `test_routes_sync.py` calls `POST /api/sync` without auth. After this task, that POST requires admin.

- [ ] **Step 1: Update sync.py to gate POST**

Edit `flet-pnwdata/server/routes/sync.py`. Modify the file so:

1. Import the admin dependency at the top:

```python
from server.auth import require_admin_for
```

2. Add `dependencies=[Depends(require_admin_for("/sync"))]` to the POST route declaration:

```python
@router.post(
    "/api/sync",
    dependencies=[Depends(require_admin_for("/sync"))],
)
async def trigger_sync(request: Request):
    ...
```

3. Import `Depends` from fastapi:

```python
from fastapi import APIRouter, Depends, Request
```

The GET stays public — it's a read-only status poll.

- [ ] **Step 2: Update existing sync tests to use admin tokens**

Edit `flet-pnwdata/tests/test_routes_sync.py`. The existing `test_post_sync_triggers_sync_once` and `test_post_sync_returns_error_status_on_failure` will fail because POST now needs auth. Modify them to include a Bearer token AND add SESSION_SECRET to fake_env's environment.

At the top of the file, add:

```python
from server.session import create_session_token

SECRET = "x" * 32

def _admin_token(monkeypatch) -> str:
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    return create_session_token({
        "discordId": "100", "username": "admin", "avatar": None,
        "roleIds": [], "isEmperor": True,
    })
```

Then modify the two POST tests to accept `monkeypatch`, build a token, and send it as a Bearer header. For example:

```python
@pytest.mark.asyncio
async def test_post_sync_triggers_sync_once(app_client, monkeypatch):
    client, app = app_client
    token = _admin_token(monkeypatch)
    with respx.mock() as mock:
        _mock_pnw_responses(mock)
        mock.get("https://bkpw.net/api/v1/members").respond(json=BKNET_FIXTURE)
        resp = await client.post("/api/sync", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    assert body["member_count"] == 1


@pytest.mark.asyncio
async def test_post_sync_returns_error_status_on_failure(app_client, monkeypatch):
    client, _ = app_client
    token = _admin_token(monkeypatch)
    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").respond(
            json={"errors": [{"message": "boom"}]}
        )
        resp = await client.post("/api/sync", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 500
    assert "boom" in resp.json()["error"]
```

Add one new test verifying the gating itself:

```python
@pytest.mark.asyncio
async def test_post_sync_returns_401_without_token(app_client):
    client, _ = app_client
    resp = await client.post("/api/sync")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_post_sync_returns_403_for_non_admin(app_client, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", SECRET)
    client, _ = app_client
    token = create_session_token({
        "discordId": "100", "username": "u", "avatar": None,
        "roleIds": ["random"], "isEmperor": False,
    })
    resp = await client.post("/api/sync", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
```

- [ ] **Step 3: Run sync tests**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_sync.py -v`
Expected: 5 passed (3 existing modified + 2 new).

- [ ] **Step 4: Full suite check**

Run: `cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -q`
Expected: 126 passed (124 + 2 new — the 3 modified existing tests stay counted in the prior total).

Wait — let me recompute. Plan 1 had 36 tests including 3 sync tests. Plan 2 added 39 to get 75. Plan 3 added through Task 8: 6 + 5 + 8 + 7 + 9 + 7 + 7 = 49, so 75 + 49 = 124. Task 9 adds 2 new tests (gating). Full suite: 126.

- [ ] **Step 5: No commit.**

---

### Task 10: Manual smoke test against Discord

This task is **manual** because it hits Discord's live API and requires real OAuth credentials.

- [ ] **Step 1: Populate auth env vars**

Edit `flet-pnwdata/.env` and ensure these are set:
```
SESSION_SECRET=<some 32+ char random string>
DISCORD_CLIENT_ID=<your Discord app's client id>
DISCORD_CLIENT_SECRET=<your Discord app's client secret>
DISCORD_GUILD_ID=<your guild id>
DISCORD_BOT_TOKEN=<bot token with View Server Members permission>
DISCORD_ADMIN_ROLE=Emperor
```

- [ ] **Step 2: Get a Discord access token manually**

The simplest way to get a real access token for testing is to use the existing Next.js app's OAuth flow (if it's running), and inspect the `__session` cookie. Decode it (HS256 with the Next.js `SESSION_SECRET`) to get the user info — but you actually need a Discord access token, not the Next.js session cookie.

Easier path: hit Discord's OAuth URL directly:
```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT&response_type=code&scope=identify
```

In a real flow you'd exchange the resulting `code` for an access token. For manual testing, the Next.js callback at `/api/auth/callback` already does this — you can put a `console.log(access_token)` there temporarily to capture one.

Alternatively, in production you'll get the access token from Flet's `OAuthProvider` on the client.

- [ ] **Step 3: Start the server**

```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/uvicorn server.main:app --port 8000
```

- [ ] **Step 4: Hit /api/auth/exchange with the access token**

```bash
curl -s -X POST http://localhost:8000/api/auth/exchange \
  -H 'Content-Type: application/json' \
  -d '{"discord_access_token":"YOUR_DISCORD_ACCESS_TOKEN"}' | jq
```

Expected: `{"token": "<jwt>", "session": {"discordId": "...", "username": "...", "isEmperor": true|false, ...}}`

- [ ] **Step 5: Verify the JWT works on /api/auth/me**

```bash
TOKEN=<paste the token from the previous step>
curl -s http://localhost:8000/api/auth/me -H "Authorization: Bearer $TOKEN" | jq
```

Expected: same session payload.

- [ ] **Step 6: Verify role-gated endpoint**

If your session has `isEmperor=true`:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/role-config -H "Authorization: Bearer $TOKEN"
# Expected: 200
```

Without the token:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/role-config
# Expected: 401
```

- [ ] **Step 7: Stop server with Ctrl-C. No commit.**

---

## Spec Coverage Check

| Spec requirement | Covered by |
|---|---|
| `POST /api/auth/exchange` (Discord token → JWT) | Task 6 |
| JWT (HS256, 7-day expiry, SESSION_SECRET-signed) | Task 2 |
| `Authorization: Bearer <token>` enforcement | Task 5 |
| Guild member resolution via bot token (per commit 412cf35) | Task 3 + Task 6 |
| `isEmperor` lookup by role name OR snowflake | Task 6 |
| Role-based gating via `data/role-config.json` | Tasks 4, 5 |
| `GET/POST /api/role-config` (admin only) | Task 7 |
| `GET/POST /api/war-config` (admin only) | Task 8 |
| `POST /api/sync` admin gating | Task 9 |
| `GET /api/auth/me` | Task 6 |
| `POST /api/auth/logout` | Task 6 |

Out of scope (deferred):
- Refresh-token rotation — spec explicitly defers
- Server-side JWT revocation list — spec explicitly defers
- Flet client OAuth wiring — Plan 6 (client auth)
- Token-based gating on the live endpoints (`/api/warTargets`, `/api/beigeWatch`) — these are public per the spec

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-flet-pnwdata-server-auth.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
