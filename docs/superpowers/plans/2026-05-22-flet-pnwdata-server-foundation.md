# flet-pnwdata Server Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the FastAPI backend half of the Flet PnW port: project scaffold, SQLite schema, external-API clients, background sync loop, and `/api/data` + `/api/sync` endpoints. At the end of this plan, a single `uvicorn` process runs, populates `data/pnw.db` every 10 minutes, and serves JSON identical in shape to the existing Next.js `/api/data` route.

**Architecture:** FastAPI app with an `asyncio`-driven background sync loop started in a lifespan handler. Pydantic models in `shared/` (so the future Flet client can reuse them) act as the wire-format contract. SQLite is the only persistence; rows store JSON blobs in a `data TEXT` column to match the existing Next.js schema. External APIs (PnW GraphQL, BK Net REST) are called via `httpx.AsyncClient`. Tests use `respx` to mock outbound HTTP and a temp-file SQLite for isolation.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, httpx, pydantic v2, python-dotenv, pytest, pytest-asyncio, respx, ruff.

This plan covers **server only**. The Flet client is built in a later plan.

---

## File Structure

Files this plan creates (under `flet-pnwdata/`):

```
flet-pnwdata/
├── pyproject.toml
├── .env.example
├── .gitignore
├── README.md
├── data/                            # gitignored
├── shared/
│   ├── __init__.py
│   └── models.py                    # pydantic models: Nation, War, BankRec, Alliance, ...
├── server/
│   ├── __init__.py
│   ├── settings.py                  # env-var loader
│   ├── db.py                        # sqlite connection + schema init
│   ├── pnw_api.py                   # PnW GraphQL client
│   ├── bknet_api.py                 # BK Net REST client
│   ├── sync.py                      # sync_once() + sync_loop()
│   ├── main.py                      # FastAPI app factory + lifespan
│   └── routes/
│       ├── __init__.py
│       ├── data.py                  # GET /api/data?type=<table>
│       └── sync.py                  # GET/POST /api/sync
└── tests/
    ├── __init__.py
    ├── conftest.py                  # shared fixtures: temp db, app client, fake env
    ├── fixtures/
    │   ├── pnw_response.json        # canned PnW GraphQL response
    │   └── bknet_response.json      # canned BK Net response
    ├── test_models.py
    ├── test_db.py
    ├── test_pnw_api.py
    ├── test_bknet_api.py
    ├── test_sync.py
    ├── test_routes_data.py
    ├── test_routes_sync.py
    └── test_end_to_end.py
```

Each module has one clear purpose: env (`settings.py`), persistence (`db.py`), one external service per file (`pnw_api.py`, `bknet_api.py`), orchestration (`sync.py`), HTTP surface (`routes/*.py`), wiring (`main.py`).

---

### Task 1: Project scaffold

**Files:**
- Create: `flet-pnwdata/pyproject.toml`
- Create: `flet-pnwdata/.env.example`
- Create: `flet-pnwdata/.gitignore`
- Create: `flet-pnwdata/README.md`
- Create: `flet-pnwdata/data/.gitkeep`
- Create: `flet-pnwdata/shared/__init__.py` (empty)
- Create: `flet-pnwdata/server/__init__.py` (empty)
- Create: `flet-pnwdata/server/routes/__init__.py` (empty)
- Create: `flet-pnwdata/tests/__init__.py` (empty)

- [ ] **Step 1: Create directories**

Run:
```bash
mkdir -p flet-pnwdata/{shared,server/routes,tests/fixtures,data}
touch flet-pnwdata/shared/__init__.py
touch flet-pnwdata/server/__init__.py
touch flet-pnwdata/server/routes/__init__.py
touch flet-pnwdata/tests/__init__.py
touch flet-pnwdata/data/.gitkeep
```

- [ ] **Step 2: Write pyproject.toml**

Create `flet-pnwdata/pyproject.toml`:

```toml
[project]
name = "flet-pnwdata"
version = "0.1.0"
description = "PnW alliance analytics — Flet port"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "httpx>=0.27",
    "pydantic>=2.9",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "respx>=0.21",
    "ruff>=0.7",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 120
target-version = "py312"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 3: Write .env.example**

Create `flet-pnwdata/.env.example`:

```
# PnW + BK Net
PNW_API_KEY=
BKNET_API_TOKEN=

# Server
SERVER_HOST=0.0.0.0
SERVER_PORT=8000

# Sync
SYNC_INTERVAL_SECONDS=600

# Database
DB_PATH=data/pnw.db
```

- [ ] **Step 4: Write .gitignore**

Create `flet-pnwdata/.gitignore`:

```
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.venv/
venv/
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
.env
.env.local
*.egg-info/
dist/
build/
```

- [ ] **Step 5: Write README.md**

Create `flet-pnwdata/README.md`:

````markdown
# flet-pnwdata

Python port of the PnW alliance analytics dashboard. This directory holds:

- `server/` — FastAPI backend (this plan)
- `shared/` — pydantic models shared with the Flet client (future)
- `client/` — Flet UI (future)

## Quick start (dev)

```bash
cd flet-pnwdata
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
cp .env.example .env  # fill in PNW_API_KEY
uvicorn server.main:app --reload --port 8000
```

## Run tests

```bash
pytest -v
```
````

- [ ] **Step 6: Install and verify**

Run:
```bash
cd flet-pnwdata && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
```
Expected: install succeeds, no errors.

Run:
```bash
.venv/bin/pytest --collect-only
```
Expected: "no tests collected" — confirms pytest discovers the package layout but has no tests yet.

- [ ] **Step 7: Commit**

```bash
cd flet-pnwdata && git add -f .gitignore pyproject.toml .env.example README.md data/.gitkeep shared/__init__.py server/__init__.py server/routes/__init__.py tests/__init__.py
git commit -m "feat(flet): scaffold flet-pnwdata project"
```

---

### Task 2: Pydantic models

**Files:**
- Create: `flet-pnwdata/shared/models.py`
- Test: `flet-pnwdata/tests/test_models.py`
- Test fixture: `flet-pnwdata/tests/fixtures/pnw_response.json`

Models mirror `src/lib/pnw.ts` so the JSON shape is identical to what the existing Next.js app produces.

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/fixtures/pnw_response.json` (a minimal, valid shape — used by multiple tests):

```json
{
  "nation": {
    "id": 12345,
    "nation_name": "Testlandia",
    "leader_name": "Tester",
    "discord": "tester#0",
    "score": 1234.5,
    "num_cities": 10,
    "color": "blue",
    "last_active": "2026-05-22T10:00:00+00:00",
    "soldiers": 100000,
    "tanks": 5000,
    "aircraft": 500,
    "ships": 50,
    "missiles": 0,
    "nukes": 0,
    "vacation_mode_turns": 0,
    "beige_turns": 0,
    "alliance_position": "MEMBER",
    "war_policy": "ATTRITION",
    "domestic_policy": "URBANIZATION",
    "offensive_wars_count": 0,
    "defensive_wars_count": 0,
    "money": 1000000.0,
    "continent": "north_america",
    "mass_irrigation": false,
    "international_trade_center": true,
    "telecommunications_satellite": false,
    "uranium_enrichment_program": false,
    "cities": [
      {"infrastructure": 2000, "land": 2000, "barracks": 5, "factory": 0, "hangar": 0, "drydock": 0, "hospital": 0, "policestation": 0, "recycling_center": 0, "subway": 0}
    ]
  },
  "war": {
    "id": 999,
    "date": "2026-05-21T00:00:00+00:00",
    "reason": "raid",
    "war_type": "ORDINARY",
    "turns_left": 60,
    "att_id": 1, "att_alliance_id": 100,
    "def_id": 2, "def_alliance_id": 200,
    "attacker": {"nation_name": "A", "leader_name": "A", "alliance": {"name": "AA"}, "soldiers": 1, "tanks": 1, "aircraft": 1, "ships": 1, "spies": 1},
    "defender": {"nation_name": "B", "leader_name": "B", "alliance": {"name": "BB"}, "soldiers": 1, "tanks": 1, "aircraft": 1, "ships": 1, "spies": 1},
    "att_points": 0, "def_points": 0, "att_peace": false, "def_peace": false,
    "att_resistance": 100, "def_resistance": 100,
    "ground_control": 0, "air_superiority": 0, "naval_blockade": 0
  }
}
```

Create `flet-pnwdata/tests/test_models.py`:

```python
import json
from pathlib import Path
from shared.models import Nation, War

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "pnw_response.json").read_text())


def test_nation_parses_minimal_pnw_shape():
    nation = Nation.model_validate(FIXTURE["nation"])
    assert nation.id == 12345
    assert nation.alliance_position == "MEMBER"
    assert nation.cities is not None and nation.cities[0].infrastructure == 2000
    assert nation.money == 1000000.0


def test_nation_resources_are_optional():
    payload = dict(FIXTURE["nation"])
    payload.pop("money")
    nation = Nation.model_validate(payload)
    assert nation.money is None


def test_war_parses_minimal_pnw_shape():
    war = War.model_validate(FIXTURE["war"])
    assert war.id == 999
    assert war.attacker.nation_name == "A"
    assert war.naval_blockade == 0
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_models.py -v`
Expected: ImportError — `shared.models` does not exist yet.

- [ ] **Step 3: Implement models**

Create `flet-pnwdata/shared/models.py`:

```python
"""Pydantic models for PnW + BK Net wire shapes.

These mirror src/lib/pnw.ts from the existing Next.js project so the JSON
returned by /api/data is byte-identical (same field names, same nesting).
"""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class City(_Base):
    infrastructure: float
    land: float
    barracks: int
    factory: int
    hangar: int
    drydock: int
    hospital: int
    policestation: int
    recycling_center: int
    subway: int


class Nation(_Base):
    id: int
    nation_name: str
    leader_name: str
    discord: str
    score: float
    num_cities: int
    color: str
    last_active: str
    soldiers: int
    tanks: int
    aircraft: int
    ships: int
    missiles: int
    nukes: int
    vacation_mode_turns: int
    beige_turns: int
    alliance_position: str
    war_policy: str
    domestic_policy: str
    offensive_wars_count: int
    defensive_wars_count: int
    money: float | None = None
    coal: float | None = None
    oil: float | None = None
    uranium: float | None = None
    iron: float | None = None
    bauxite: float | None = None
    lead: float | None = None
    gasoline: float | None = None
    munitions: float | None = None
    steel: float | None = None
    aluminum: float | None = None
    food: float | None = None
    credits: float | None = None
    continent: str | None = None
    mass_irrigation: bool | None = None
    international_trade_center: bool | None = None
    telecommunications_satellite: bool | None = None
    uranium_enrichment_program: bool | None = None
    cities: list[City] | None = None


class WarSide(_Base):
    nation_name: str
    leader_name: str
    alliance: dict | None = None  # {"name": "..."} or None
    soldiers: int
    tanks: int
    aircraft: int
    ships: int
    spies: int


class War(_Base):
    id: int
    date: str
    reason: str
    war_type: str
    turns_left: int
    att_id: int
    att_alliance_id: int
    def_id: int
    def_alliance_id: int
    attacker: WarSide
    defender: WarSide
    att_points: int
    def_points: int
    att_peace: bool
    def_peace: bool
    att_resistance: float
    def_resistance: float
    ground_control: int
    air_superiority: int
    naval_blockade: int


class BankRec(_Base):
    id: int
    date: str
    sender_id: int
    sender_type: int
    receiver_id: int
    receiver_type: int
    banker_id: int
    note: str
    money: float
    coal: float
    oil: float
    uranium: float
    iron: float
    bauxite: float
    lead: float
    gasoline: float
    munitions: float
    steel: float
    aluminum: float
    food: float
    tax_id: int
    sender: dict | None = None
    receiver: dict | None = None


class Alliance(_Base):
    id: int
    name: str
    acronym: str
    score: float
    color: str
    rank: int
    average_score: float
    flag: str
    forum_link: str
    discord_link: str
    money: float
    coal: float
    oil: float
    uranium: float
    iron: float
    bauxite: float
    lead: float
    gasoline: float
    munitions: float
    steel: float
    aluminum: float
    food: float
    member_count: int | None = None  # not in GraphQL; we derive it in sync


class TradePrice(_Base):
    id: int
    date: str
    coal: float
    oil: float
    uranium: float
    iron: float
    bauxite: float
    lead: float
    gasoline: float
    munitions: float
    steel: float
    aluminum: float
    food: float
    credits: float


class GameInfo(_Base):
    radiation: dict  # {"global": float, "north_america": float, ...}


class BknetMember(_Base):
    """Loose model — BK Net responses contain many fields we render as-is.
    We only validate enough to use it as a map key (`nation.id`)."""
    nation: dict
    discord: dict | None = None


class SyncStatus(_Base):
    id: int
    last_synced_at: int | None
    status: Literal["never", "syncing", "success", "error"]
    error: str | None
    member_count: int
    war_count: int
    bankrec_count: int
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_models.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd flet-pnwdata && git add shared/models.py tests/test_models.py tests/fixtures/pnw_response.json
git commit -m "feat(flet): add pydantic models mirroring PnW + BK Net shapes"
```

---

### Task 3: SQLite schema and connection

**Files:**
- Create: `flet-pnwdata/server/settings.py`
- Create: `flet-pnwdata/server/db.py`
- Test: `flet-pnwdata/tests/test_db.py`
- Create: `flet-pnwdata/tests/conftest.py`

- [ ] **Step 1: Write conftest with the temp-db fixture**

Create `flet-pnwdata/tests/conftest.py`:

```python
import os
import sqlite3
from pathlib import Path
import pytest


@pytest.fixture
def tmp_db_path(tmp_path: Path) -> Path:
    return tmp_path / "test.db"


@pytest.fixture
def db_conn(tmp_db_path: Path) -> sqlite3.Connection:
    from server.db import open_db, init_schema
    conn = open_db(str(tmp_db_path))
    init_schema(conn)
    yield conn
    conn.close()


@pytest.fixture
def fake_env(monkeypatch, tmp_db_path):
    monkeypatch.setenv("PNW_API_KEY", "fake-pnw-key")
    monkeypatch.setenv("BKNET_API_TOKEN", "fake-bknet-token")
    monkeypatch.setenv("DB_PATH", str(tmp_db_path))
    monkeypatch.setenv("SYNC_INTERVAL_SECONDS", "1")
```

- [ ] **Step 2: Write the failing test**

Create `flet-pnwdata/tests/test_db.py`:

```python
import sqlite3
from server.db import open_db, init_schema

EXPECTED_TABLES = {
    "nations", "applicants", "wars", "bankrecs",
    "alliance_meta", "trade_prices", "bknet_members",
    "game_info", "sync_status",
}


def test_init_schema_creates_all_tables(db_conn: sqlite3.Connection):
    rows = db_conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    names = {r[0] for r in rows}
    assert EXPECTED_TABLES.issubset(names)


def test_init_schema_seeds_sync_status(db_conn: sqlite3.Connection):
    row = db_conn.execute("SELECT id, status FROM sync_status WHERE id=1").fetchone()
    assert row == (1, "never")


def test_init_schema_is_idempotent(tmp_db_path):
    conn = open_db(str(tmp_db_path))
    init_schema(conn)
    init_schema(conn)  # should not raise
    rows = conn.execute("SELECT COUNT(*) FROM sync_status").fetchone()
    assert rows[0] == 1
    conn.close()


def test_open_db_enables_wal(db_conn: sqlite3.Connection):
    mode = db_conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode.lower() == "wal"
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_db.py -v`
Expected: ImportError on `server.db`.

- [ ] **Step 4: Implement settings.py**

Create `flet-pnwdata/server/settings.py`:

```python
"""Environment-variable loader."""
import os
from dotenv import load_dotenv

load_dotenv()


def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name, default)


def env_required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Required env var {name} is not set")
    return value


PNW_API_KEY = env("PNW_API_KEY", "")
BKNET_API_TOKEN = env("BKNET_API_TOKEN", "")
DB_PATH = env("DB_PATH", "data/pnw.db")
SYNC_INTERVAL_SECONDS = int(env("SYNC_INTERVAL_SECONDS", "600"))
SERVER_HOST = env("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(env("SERVER_PORT", "8000"))
```

- [ ] **Step 5: Implement db.py**

Create `flet-pnwdata/server/db.py`:

```python
"""SQLite schema and connection management.

Schema mirrors src/lib/db.ts from the Next.js app: rows store JSON blobs in
a `data TEXT` column plus an `updated_at INTEGER` (Unix ms). Singletons
(alliance_meta, trade_prices, game_info, sync_status) use id=1 with a CHECK.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS nations (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wars (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bankrecs (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alliance_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_prices (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bknet_members (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_synced_at INTEGER,
    status TEXT NOT NULL DEFAULT 'never',
    error TEXT,
    member_count INTEGER DEFAULT 0,
    war_count INTEGER DEFAULT 0,
    bankrec_count INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO sync_status (id, status) VALUES (1, 'never');
"""


def open_db(path: str) -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode enabled."""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
```

- [ ] **Step 6: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_db.py -v`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
cd flet-pnwdata && git add server/settings.py server/db.py tests/test_db.py tests/conftest.py
git commit -m "feat(flet): add SQLite schema + connection module"
```

---

### Task 4: PnW GraphQL client

**Files:**
- Create: `flet-pnwdata/server/pnw_api.py`
- Test: `flet-pnwdata/tests/test_pnw_api.py`

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_pnw_api.py`:

```python
import httpx
import respx
import pytest


@pytest.mark.asyncio
async def test_gql_sends_api_key_in_query_string(fake_env):
    from server.pnw_api import gql
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post(
            "https://api.politicsandwar.com/graphql",
            params={"api_key": "fake-pnw-key"},
        ).respond(json={"data": {"ok": True}})
        result = await gql("{ ok }", {})
        assert result == {"ok": True}
        assert route.called


@pytest.mark.asyncio
async def test_gql_raises_on_graphql_errors(fake_env):
    from server.pnw_api import gql, PnwGraphQLError
    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").respond(
            json={"errors": [{"message": "boom"}]}
        )
        with pytest.raises(PnwGraphQLError, match="boom"):
            await gql("{ x }", {})


@pytest.mark.asyncio
async def test_gql_sends_query_and_variables_as_json(fake_env):
    from server.pnw_api import gql
    with respx.mock() as mock:
        route = mock.post("https://api.politicsandwar.com/graphql").respond(
            json={"data": {}}
        )
        await gql("query Q($id:Int){ x(id:$id) }", {"id": 42})
        body = route.calls.last.request.content
        import json as _json
        parsed = _json.loads(body)
        assert parsed["query"].startswith("query Q")
        assert parsed["variables"] == {"id": 42}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_pnw_api.py -v`
Expected: ImportError — `server.pnw_api` does not exist.

- [ ] **Step 3: Implement pnw_api.py**

Create `flet-pnwdata/server/pnw_api.py`:

```python
"""PnW GraphQL client.

Ports the queries from src/lib/sync.ts. Each module-level string is the
GraphQL query body used by sync.py.
"""
from __future__ import annotations

import httpx

from server import settings


PNW_API_URL = "https://api.politicsandwar.com/graphql"


class PnwGraphQLError(RuntimeError):
    pass


ME_QUERY = "{ me { nation { alliance_id } } }"

ALLIANCE_QUERY = """
  query($id:[Int]) { alliances(id:$id) { data {
    id name acronym score color rank average_score flag forum_link discord_link
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food
  } } }
"""

MEMBERS_QUERY = """
  query($alliance_id:[Int]) { nations(alliance_id:$alliance_id, first:500) { data {
    id nation_name leader_name discord score num_cities color last_active continent
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food credits
    soldiers tanks aircraft ships missiles nukes
    vacation_mode_turns beige_turns alliance_position
    war_policy domestic_policy offensive_wars_count defensive_wars_count
    cities { infrastructure land barracks factory hangar drydock hospital policestation recycling_center subway }
    mass_irrigation international_trade_center telecommunications_satellite uranium_enrichment_program
  } } }
"""

WARS_QUERY = """
  query($alliance_id:[Int]) { wars(alliance_id:$alliance_id, active:true, first:1000) { data {
    id date reason war_type turns_left
    att_id att_alliance_id
    def_id def_alliance_id
    attacker { nation_name leader_name alliance { name } soldiers tanks aircraft ships spies }
    defender { nation_name leader_name alliance { name } soldiers tanks aircraft ships spies }
    att_points def_points att_peace def_peace
    att_resistance def_resistance
    ground_control air_superiority naval_blockade
  } } }
"""

BANK_RECS_QUERY = """
  query($or_id:[Int], $first:Int) { bankrecs(or_id:$or_id, or_type:[2], first:$first) { data {
    id date sender_id sender_type receiver_id receiver_type banker_id note
    money coal oil uranium iron bauxite lead gasoline munitions steel aluminum food tax_id
    sender { nation_name }
    receiver { nation_name }
  } } }
"""

TRADE_PRICES_QUERY = """
  { tradeprices(first:1) { data {
    id date coal oil uranium iron bauxite lead gasoline munitions steel aluminum food credits
  } } }
"""

GAME_INFO_QUERY = """
  { game_info { radiation { global north_america south_america europe africa asia australia } } }
"""


async def gql(query: str, variables: dict | None = None) -> dict:
    """Execute a GraphQL query against PnW. Returns the contents of `data`."""
    params = {"api_key": settings.PNW_API_KEY}
    payload = {"query": query, "variables": variables or {}}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(PNW_API_URL, params=params, json=payload)
        resp.raise_for_status()
        body = resp.json()
    if body.get("errors"):
        raise PnwGraphQLError(body["errors"][0].get("message", "unknown"))
    return body["data"]
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_pnw_api.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd flet-pnwdata && git add server/pnw_api.py tests/test_pnw_api.py
git commit -m "feat(flet): add PnW GraphQL client and queries"
```

---

### Task 5: BK Net REST client

**Files:**
- Create: `flet-pnwdata/server/bknet_api.py`
- Test: `flet-pnwdata/tests/test_bknet_api.py`

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_bknet_api.py`:

```python
import respx
import pytest


@pytest.mark.asyncio
async def test_fetch_members_sends_bearer_token(fake_env):
    from server.bknet_api import fetch_members
    with respx.mock() as mock:
        route = mock.get("https://bkpw.net/api/v1/members").respond(
            json={"members": [{"nation": {"id": 1}}]}
        )
        result = await fetch_members()
        assert result == {"members": [{"nation": {"id": 1}}]}
        sent = route.calls.last.request
        assert sent.headers["authorization"] == "Bearer fake-bknet-token"


@pytest.mark.asyncio
async def test_fetch_members_returns_none_without_token(monkeypatch):
    monkeypatch.delenv("BKNET_API_TOKEN", raising=False)
    # Reload module so it picks up the new env
    import importlib
    from server import bknet_api
    importlib.reload(bknet_api)
    result = await bknet_api.fetch_members()
    assert result is None


@pytest.mark.asyncio
async def test_fetch_members_raises_on_http_error(fake_env):
    from server.bknet_api import fetch_members, BknetError
    with respx.mock() as mock:
        mock.get("https://bkpw.net/api/v1/members").respond(status_code=500)
        with pytest.raises(BknetError):
            await fetch_members()
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_bknet_api.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement bknet_api.py**

Create `flet-pnwdata/server/bknet_api.py`:

```python
"""BK Net REST client.

Returns None if BKNET_API_TOKEN is not set; this lets sync skip BK Net
cleanly when the integration is not configured.
"""
from __future__ import annotations

import httpx

from server import settings


BKNET_API_URL = "https://bkpw.net/api/v1"


class BknetError(RuntimeError):
    pass


async def fetch_members() -> dict | None:
    """Fetch BK Net members. Returns None if no token is configured."""
    if not settings.BKNET_API_TOKEN:
        return None
    headers = {
        "Authorization": f"Bearer {settings.BKNET_API_TOKEN}",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{BKNET_API_URL}/members", headers=headers)
        if resp.status_code >= 400:
            raise BknetError(f"BK Net /members returned {resp.status_code}")
        return resp.json()
```

- [ ] **Step 4: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_bknet_api.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd flet-pnwdata && git add server/bknet_api.py tests/test_bknet_api.py
git commit -m "feat(flet): add BK Net REST client"
```

---

### Task 6: `sync_once()` — orchestrate one full sync

**Files:**
- Create: `flet-pnwdata/server/sync.py`
- Test: `flet-pnwdata/tests/test_sync.py`
- Create: `flet-pnwdata/tests/fixtures/bknet_response.json`

This is the largest task. `sync_once(conn)` fetches everything, writes to SQLite in one shot, and updates `sync_status`. APPLICANTs are filtered into a separate table. Wars are fully replaced; nations/applicants/bknet_members are upserted then culled.

- [ ] **Step 1: Write the BK Net fixture**

Create `flet-pnwdata/tests/fixtures/bknet_response.json`:

```json
{
  "members": [
    {"nation": {"id": 12345, "nation_name": "Testlandia"}, "discord": {"account": {"discord_username": "tester", "discord_id": "100"}}}
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `flet-pnwdata/tests/test_sync.py`:

```python
import json
from pathlib import Path
import respx
import pytest


def _mock_pnw_responses(mock: respx.Router):
    """Wire respx with one canned response per query in order of call."""
    payloads = [
        # ME
        {"data": {"me": {"nation": {"alliance_id": "100"}}}},
        # ALLIANCE
        {"data": {"alliances": {"data": [{
            "id": 100, "name": "Test Alliance", "acronym": "TA", "score": 1.0,
            "color": "blue", "rank": 1, "average_score": 1.0, "flag": "",
            "forum_link": "", "discord_link": "",
            "money": 0.0, "coal": 0.0, "oil": 0.0, "uranium": 0.0, "iron": 0.0,
            "bauxite": 0.0, "lead": 0.0, "gasoline": 0.0, "munitions": 0.0,
            "steel": 0.0, "aluminum": 0.0, "food": 0.0,
        }]}}},
        # MEMBERS — one MEMBER + one APPLICANT
        {"data": {"nations": {"data": [
            _nation(1, "MEMBER"),
            _nation(2, "APPLICANT"),
        ]}}},
        # WARS
        {"data": {"wars": {"data": [_war(999)]}}},
        # BANK_RECS
        {"data": {"bankrecs": {"data": [_bank(500)]}}},
        # TRADE_PRICES
        {"data": {"tradeprices": {"data": [_trade(1)]}}},
        # GAME_INFO
        {"data": {"game_info": {"radiation": {"global": 0.1, "north_america": 0.0,
            "south_america": 0.0, "europe": 0.0, "africa": 0.0, "asia": 0.0, "australia": 0.0}}}},
    ]
    mock.post("https://api.politicsandwar.com/graphql").mock(
        side_effect=[respx.MockResponse(json=p) for p in payloads]
    )


def _nation(nid: int, position: str) -> dict:
    return {
        "id": nid, "nation_name": f"n{nid}", "leader_name": f"l{nid}",
        "discord": "", "score": 1.0, "num_cities": 1, "color": "blue",
        "last_active": "2026-05-22T00:00:00+00:00",
        "soldiers": 0, "tanks": 0, "aircraft": 0, "ships": 0, "missiles": 0, "nukes": 0,
        "vacation_mode_turns": 0, "beige_turns": 0, "alliance_position": position,
        "war_policy": "ATTRITION", "domestic_policy": "URBANIZATION",
        "offensive_wars_count": 0, "defensive_wars_count": 0,
    }


def _war(wid: int) -> dict:
    return {
        "id": wid, "date": "2026-05-22T00:00:00+00:00", "reason": "", "war_type": "ORDINARY",
        "turns_left": 60, "att_id": 1, "att_alliance_id": 100, "def_id": 2, "def_alliance_id": 200,
        "attacker": {"nation_name": "A", "leader_name": "A", "alliance": None,
                     "soldiers": 0, "tanks": 0, "aircraft": 0, "ships": 0, "spies": 0},
        "defender": {"nation_name": "B", "leader_name": "B", "alliance": None,
                     "soldiers": 0, "tanks": 0, "aircraft": 0, "ships": 0, "spies": 0},
        "att_points": 0, "def_points": 0, "att_peace": False, "def_peace": False,
        "att_resistance": 100, "def_resistance": 100,
        "ground_control": 0, "air_superiority": 0, "naval_blockade": 0,
    }


def _bank(bid: int) -> dict:
    return {
        "id": bid, "date": "2026-05-22T00:00:00+00:00",
        "sender_id": 1, "sender_type": 1, "receiver_id": 2, "receiver_type": 2,
        "banker_id": 0, "note": "",
        "money": 0.0, "coal": 0.0, "oil": 0.0, "uranium": 0.0, "iron": 0.0,
        "bauxite": 0.0, "lead": 0.0, "gasoline": 0.0, "munitions": 0.0,
        "steel": 0.0, "aluminum": 0.0, "food": 0.0, "tax_id": 0,
        "sender": None, "receiver": None,
    }


def _trade(tid: int) -> dict:
    return {
        "id": tid, "date": "2026-05-22T00:00:00+00:00",
        "coal": 1.0, "oil": 1.0, "uranium": 1.0, "iron": 1.0, "bauxite": 1.0,
        "lead": 1.0, "gasoline": 1.0, "munitions": 1.0, "steel": 1.0,
        "aluminum": 1.0, "food": 1.0, "credits": 1.0,
    }


BKNET_FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "bknet_response.json").read_text()
)


@pytest.mark.asyncio
async def test_sync_once_writes_all_tables(fake_env, db_conn):
    from server.sync import sync_once
    with respx.mock() as mock:
        _mock_pnw_responses(mock)
        mock.get("https://bkpw.net/api/v1/members").respond(json=BKNET_FIXTURE)
        await sync_once(db_conn)

    # Nations: 1 MEMBER kept (APPLICANT goes to applicants)
    nations = db_conn.execute("SELECT data FROM nations").fetchall()
    assert len(nations) == 1
    assert json.loads(nations[0][0])["id"] == 1

    applicants = db_conn.execute("SELECT data FROM applicants").fetchall()
    assert len(applicants) == 1
    assert json.loads(applicants[0][0])["id"] == 2

    wars = db_conn.execute("SELECT data FROM wars").fetchall()
    assert len(wars) == 1

    bankrecs = db_conn.execute("SELECT data FROM bankrecs").fetchall()
    assert len(bankrecs) == 1

    alliance = db_conn.execute("SELECT data FROM alliance_meta WHERE id=1").fetchone()
    payload = json.loads(alliance[0])
    assert payload["id"] == 100
    assert payload["member_count"] == 1  # derived

    trade = db_conn.execute("SELECT data FROM trade_prices WHERE id=1").fetchone()
    assert json.loads(trade[0])["id"] == 1

    game = db_conn.execute("SELECT data FROM game_info WHERE id=1").fetchone()
    assert json.loads(game[0])["radiation"]["global"] == 0.1

    bknet = db_conn.execute("SELECT data FROM bknet_members").fetchall()
    assert len(bknet) == 1
    assert json.loads(bknet[0][0])["nation"]["id"] == 12345

    status = db_conn.execute(
        "SELECT status, member_count, war_count, bankrec_count FROM sync_status WHERE id=1"
    ).fetchone()
    assert status[0] == "success"
    assert status[1] == 1 and status[2] == 1 and status[3] == 1


@pytest.mark.asyncio
async def test_sync_once_marks_status_error_on_failure(fake_env, db_conn):
    from server.sync import sync_once
    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").respond(
            json={"errors": [{"message": "rate limited"}]}
        )
        with pytest.raises(Exception):
            await sync_once(db_conn)
    row = db_conn.execute("SELECT status, error FROM sync_status WHERE id=1").fetchone()
    assert row[0] == "error"
    assert "rate limited" in row[1]


@pytest.mark.asyncio
async def test_sync_once_tolerates_bknet_failure(fake_env, db_conn):
    """If BK Net is down, the rest of the sync should still complete."""
    from server.sync import sync_once
    with respx.mock() as mock:
        _mock_pnw_responses(mock)
        mock.get("https://bkpw.net/api/v1/members").respond(status_code=503)
        await sync_once(db_conn)
    status = db_conn.execute("SELECT status FROM sync_status WHERE id=1").fetchone()
    assert status[0] == "success"
    # bknet_members table should be empty (or whatever it was before)
    bknet = db_conn.execute("SELECT COUNT(*) FROM bknet_members").fetchone()
    assert bknet[0] == 0


@pytest.mark.asyncio
async def test_sync_once_culls_removed_nations(fake_env, db_conn):
    """If a nation present in a previous sync is missing this time, it should be deleted."""
    from server.sync import sync_once
    # Seed with a stale nation
    db_conn.execute("INSERT INTO nations (id, data, updated_at) VALUES (?, ?, ?)",
                    (999, '{"id": 999}', 0))
    with respx.mock() as mock:
        _mock_pnw_responses(mock)
        mock.get("https://bkpw.net/api/v1/members").respond(json=BKNET_FIXTURE)
        await sync_once(db_conn)
    rows = db_conn.execute("SELECT id FROM nations").fetchall()
    ids = {r[0] for r in rows}
    assert 999 not in ids
    assert 1 in ids


@pytest.mark.asyncio
async def test_sync_once_clears_applicants_when_empty(fake_env, db_conn):
    """If a sync returns no APPLICANTs, the applicants table should be fully cleared."""
    from server.sync import sync_once
    db_conn.execute("INSERT INTO applicants (id, data, updated_at) VALUES (?, ?, ?)",
                    (777, '{"id": 777}', 0))
    # Override MEMBERS to return zero applicants
    with respx.mock() as mock:
        payloads = [
            {"data": {"me": {"nation": {"alliance_id": "100"}}}},
            {"data": {"alliances": {"data": [{
                "id": 100, "name": "T", "acronym": "T", "score": 1.0, "color": "blue",
                "rank": 1, "average_score": 1.0, "flag": "", "forum_link": "", "discord_link": "",
                "money": 0.0, "coal": 0.0, "oil": 0.0, "uranium": 0.0, "iron": 0.0,
                "bauxite": 0.0, "lead": 0.0, "gasoline": 0.0, "munitions": 0.0,
                "steel": 0.0, "aluminum": 0.0, "food": 0.0,
            }]}}},
            {"data": {"nations": {"data": [_nation(1, "MEMBER")]}}},  # no applicants
            {"data": {"wars": {"data": []}}},
            {"data": {"bankrecs": {"data": []}}},
            {"data": {"tradeprices": {"data": [_trade(1)]}}},
            {"data": {"game_info": {"radiation": {"global": 0.0, "north_america": 0.0,
                "south_america": 0.0, "europe": 0.0, "africa": 0.0, "asia": 0.0, "australia": 0.0}}}},
        ]
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[respx.MockResponse(json=p) for p in payloads]
        )
        mock.get("https://bkpw.net/api/v1/members").respond(json=BKNET_FIXTURE)
        await sync_once(db_conn)
    assert db_conn.execute("SELECT COUNT(*) FROM applicants").fetchone()[0] == 0
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_sync.py -v`
Expected: ImportError on `server.sync`.

- [ ] **Step 4: Implement sync.py — `sync_once()`**

Create `flet-pnwdata/server/sync.py`:

```python
"""One-shot and looping sync against PnW + BK Net."""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time

from server import bknet_api, pnw_api, settings

log = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


async def sync_once(conn: sqlite3.Connection) -> None:
    """Fetch all PnW + BK Net data and write to SQLite. Updates sync_status."""
    log.info("[PnW Sync] Starting sync")
    conn.execute("UPDATE sync_status SET status='syncing' WHERE id=1")

    try:
        me = await pnw_api.gql(pnw_api.ME_QUERY)
        alliance_id = int(me["me"]["nation"]["alliance_id"])
        if not alliance_id:
            raise RuntimeError("Could not determine alliance ID from API key")

        # PnW fetches in parallel
        alliance_d, members_d, wars_d, bank_d, trade_d, game_d = await asyncio.gather(
            pnw_api.gql(pnw_api.ALLIANCE_QUERY, {"id": [alliance_id]}),
            pnw_api.gql(pnw_api.MEMBERS_QUERY, {"alliance_id": [alliance_id]}),
            pnw_api.gql(pnw_api.WARS_QUERY, {"alliance_id": [alliance_id]}),
            pnw_api.gql(pnw_api.BANK_RECS_QUERY, {"or_id": [alliance_id], "first": 500}),
            pnw_api.gql(pnw_api.TRADE_PRICES_QUERY),
            pnw_api.gql(pnw_api.GAME_INFO_QUERY),
        )

        # BK Net — failure must not fail the whole sync
        try:
            bknet_data = await bknet_api.fetch_members()
        except Exception as e:
            log.warning("[PnW Sync] BK Net unavailable, skipping: %s", e)
            bknet_data = None

        now = _now_ms()
        all_nations = members_d["nations"]["data"]
        applicants = [n for n in all_nations if n["alliance_position"] == "APPLICANT"]
        nations = [n for n in all_nations if n["alliance_position"] != "APPLICANT"]
        wars = wars_d["wars"]["data"]
        bankrecs = bank_d["bankrecs"]["data"]
        alliance = (alliance_d["alliances"]["data"] or [None])[0]
        trade = (trade_d["tradeprices"]["data"] or [None])[0]
        game = game_d["game_info"]

        # Single transaction
        with conn:
            if alliance:
                payload = {**alliance, "member_count": len(nations)}
                conn.execute(
                    "INSERT OR REPLACE INTO alliance_meta (id, data, updated_at) VALUES (1, ?, ?)",
                    (json.dumps(payload), now),
                )
            if trade:
                conn.execute(
                    "INSERT OR REPLACE INTO trade_prices (id, data, updated_at) VALUES (1, ?, ?)",
                    (json.dumps(trade), now),
                )
            conn.execute(
                "INSERT OR REPLACE INTO game_info (id, data, updated_at) VALUES (1, ?, ?)",
                (json.dumps(game), now),
            )

            _upsert_with_cull(conn, "nations", nations, now)
            _upsert_with_cull(conn, "applicants", applicants, now, clear_if_empty=True)

            # Wars: full replace
            conn.execute("DELETE FROM wars")
            conn.executemany(
                "INSERT INTO wars (id, data, updated_at) VALUES (?, ?, ?)",
                [(w["id"], json.dumps(w), now) for w in wars],
            )

            # Bankrecs: upsert (no cull — current Next.js doesn't cull bankrecs)
            conn.executemany(
                "INSERT OR REPLACE INTO bankrecs (id, data, updated_at) VALUES (?, ?, ?)",
                [(b["id"], json.dumps(b), now) for b in bankrecs],
            )

            if bknet_data and bknet_data.get("members"):
                bknet_members = bknet_data["members"]
                conn.executemany(
                    "INSERT OR REPLACE INTO bknet_members (id, data, updated_at) VALUES (?, ?, ?)",
                    [(m["nation"]["id"], json.dumps(m), now) for m in bknet_members],
                )
                if bknet_members:
                    keep = ",".join(str(m["nation"]["id"]) for m in bknet_members)
                    conn.execute(f"DELETE FROM bknet_members WHERE id NOT IN ({keep})")
                log.info("[PnW Sync] BK Net — %d members synced", len(bknet_members))

            conn.execute(
                "UPDATE sync_status SET last_synced_at=?, status='success', error=NULL, "
                "member_count=?, war_count=?, bankrec_count=? WHERE id=1",
                (now, len(nations), len(wars), len(bankrecs)),
            )

        log.info("[PnW Sync] Done — %d members, %d wars, %d bankrecs",
                 len(nations), len(wars), len(bankrecs))

    except Exception as e:
        log.exception("[PnW Sync] Failed")
        conn.execute("UPDATE sync_status SET status='error', error=? WHERE id=1", (str(e),))
        raise


def _upsert_with_cull(conn, table: str, rows: list[dict], now: int, *, clear_if_empty: bool = False) -> None:
    """Upsert `rows` into `table` and delete any rows with IDs not in this batch.

    When clear_if_empty is True and rows is empty, deletes everything (matches
    the applicants behavior in the Next.js sync — fully empty the table when
    there are no current applicants).
    """
    conn.executemany(
        f"INSERT OR REPLACE INTO {table} (id, data, updated_at) VALUES (?, ?, ?)",
        [(r["id"], json.dumps(r), now) for r in rows],
    )
    if rows:
        keep = ",".join(str(r["id"]) for r in rows)
        conn.execute(f"DELETE FROM {table} WHERE id NOT IN ({keep})")
    elif clear_if_empty:
        conn.execute(f"DELETE FROM {table}")


async def sync_loop(conn: sqlite3.Connection, stop_event: asyncio.Event) -> None:
    """Loop forever, calling sync_once every SYNC_INTERVAL_SECONDS."""
    while not stop_event.is_set():
        try:
            await sync_once(conn)
        except Exception:
            log.exception("[PnW Sync] Periodic sync failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.SYNC_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_sync.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
cd flet-pnwdata && git add server/sync.py tests/test_sync.py tests/fixtures/bknet_response.json
git commit -m "feat(flet): add sync_once() orchestrating PnW + BK Net writes"
```

---

### Task 7: Sync loop — verify it ticks

**Files:**
- Modify: `flet-pnwdata/tests/test_sync.py` (append)

`sync_loop()` is already implemented in Task 6. This task adds a test to verify the loop behavior using a short `SYNC_INTERVAL_SECONDS` from `fake_env` (which sets it to 1 second).

- [ ] **Step 1: Add `import asyncio` to the top of `tests/test_sync.py`**

Edit `flet-pnwdata/tests/test_sync.py` and add `import asyncio` near the existing `import json` and `import respx` lines.

- [ ] **Step 2: Write the failing test**

Append to `flet-pnwdata/tests/test_sync.py`:

```python
@pytest.mark.asyncio
async def test_sync_loop_calls_sync_once_until_stopped(fake_env, db_conn, monkeypatch):
    """The loop should call sync_once repeatedly and exit on stop_event."""
    from server import sync as sync_mod
    calls = []

    async def fake_sync_once(_conn):
        calls.append(1)

    monkeypatch.setattr(sync_mod, "sync_once", fake_sync_once)
    # SYNC_INTERVAL_SECONDS is 1 in fake_env; override to a much smaller value.
    monkeypatch.setattr(sync_mod.settings, "SYNC_INTERVAL_SECONDS", 0.01)

    stop_event = asyncio.Event()

    async def stopper():
        await asyncio.sleep(0.05)
        stop_event.set()

    await asyncio.gather(sync_mod.sync_loop(db_conn, stop_event), stopper())
    assert len(calls) >= 2
```

- [ ] **Step 3: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_sync.py::test_sync_loop_calls_sync_once_until_stopped -v`
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
cd flet-pnwdata && git add tests/test_sync.py
git commit -m "test(flet): verify sync loop ticks and respects stop_event"
```

---

### Task 8: FastAPI app skeleton with lifespan

**Files:**
- Create: `flet-pnwdata/server/main.py`
- Test: `flet-pnwdata/tests/test_app.py`
- Modify: `flet-pnwdata/tests/conftest.py` (append `app_client` fixture)

- [ ] **Step 1: Append the app_client fixture to conftest.py**

Edit `flet-pnwdata/tests/conftest.py` — append:

```python
@pytest.fixture
async def app_client(fake_env, tmp_db_path):
    """Returns an httpx.AsyncClient bound to a FastAPI app whose lifespan is
    suppressed (no real sync loop)."""
    from httpx import AsyncClient, ASGITransport
    from server.main import create_app
    app = create_app(start_sync_loop=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, app
```

- [ ] **Step 2: Write the failing test**

Create `flet-pnwdata/tests/test_app.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_app_boots_and_initializes_db(app_client):
    client, app = app_client
    # The db should be open and the sync_status seed row present
    conn = app.state.db
    row = conn.execute("SELECT status FROM sync_status WHERE id=1").fetchone()
    assert row[0] == "never"


@pytest.mark.asyncio
async def test_app_healthcheck(app_client):
    client, _ = app_client
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_app.py -v`
Expected: ImportError on `server.main`.

- [ ] **Step 4: Implement main.py**

Create `flet-pnwdata/server/main.py`:

```python
"""FastAPI application factory."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from server import db as db_module, settings


log = logging.getLogger("server")
logging.basicConfig(level=logging.INFO)


def create_app(*, start_sync_loop: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        conn = db_module.open_db(settings.DB_PATH)
        db_module.init_schema(conn)
        app.state.db = conn
        app.state.stop_event = asyncio.Event()

        sync_task: asyncio.Task | None = None
        if start_sync_loop:
            from server.sync import sync_loop
            sync_task = asyncio.create_task(sync_loop(conn, app.state.stop_event))

        try:
            yield
        finally:
            app.state.stop_event.set()
            if sync_task:
                await sync_task
            conn.close()

    app = FastAPI(title="flet-pnwdata", lifespan=lifespan)

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    return app


app = create_app()
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_app.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
cd flet-pnwdata && git add server/main.py tests/test_app.py tests/conftest.py
git commit -m "feat(flet): add FastAPI app factory with sync-loop lifespan"
```

---

### Task 9: `GET /api/data?type=<table>`

**Files:**
- Create: `flet-pnwdata/server/routes/data.py`
- Modify: `flet-pnwdata/server/main.py` (register router)
- Test: `flet-pnwdata/tests/test_routes_data.py`

Mirrors the 10 type cases from `src/app/api/data/route.ts`. Returns 400 on unknown types.

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_routes_data.py`:

```python
import json
import pytest


@pytest.mark.asyncio
async def test_members_returns_array_of_nation_data(app_client):
    client, app = app_client
    conn = app.state.db
    conn.execute("INSERT INTO nations (id, data, updated_at) VALUES (?, ?, ?)",
                 (1, json.dumps({"id": 1, "nation_name": "n1"}), 0))
    resp = await client.get("/api/data?type=members")
    assert resp.status_code == 200
    assert resp.json() == [{"id": 1, "nation_name": "n1"}]


@pytest.mark.asyncio
async def test_alliance_returns_null_when_empty(app_client):
    client, _ = app_client
    resp = await client.get("/api/data?type=alliance")
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_alliance_returns_singleton(app_client):
    client, app = app_client
    app.state.db.execute(
        "INSERT INTO alliance_meta (id, data, updated_at) VALUES (1, ?, ?)",
        (json.dumps({"id": 100, "name": "TA"}), 0),
    )
    resp = await client.get("/api/data?type=alliance")
    assert resp.status_code == 200
    assert resp.json() == {"id": 100, "name": "TA"}


@pytest.mark.asyncio
async def test_status_returns_sync_status_row(app_client):
    client, _ = app_client
    resp = await client.get("/api/data?type=status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == 1
    assert body["status"] == "never"


@pytest.mark.asyncio
async def test_unknown_type_returns_400(app_client):
    client, _ = app_client
    resp = await client.get("/api/data?type=nope")
    assert resp.status_code == 400
    assert resp.json() == {"error": "Unknown type"}


@pytest.mark.asyncio
@pytest.mark.parametrize("table,key", [
    ("wars", "wars"),
    ("bankrecs", "bankrecs"),
    ("bknet_members", "bknet_members"),
    ("applicants", "applicants"),
])
async def test_list_types_return_arrays(app_client, table, key):
    client, app = app_client
    app.state.db.execute(
        f"INSERT INTO {table} (id, data, updated_at) VALUES (?, ?, ?)",
        (5, json.dumps({"id": 5}), 0),
    )
    resp = await client.get(f"/api/data?type={key}")
    assert resp.status_code == 200
    assert resp.json() == [{"id": 5}]


@pytest.mark.asyncio
@pytest.mark.parametrize("table,key", [
    ("trade_prices", "trade_prices"),
    ("game_info", "game_info"),
])
async def test_singleton_types_return_null_when_missing(app_client, table, key):
    client, _ = app_client
    resp = await client.get(f"/api/data?type={key}")
    assert resp.status_code == 200
    assert resp.json() is None
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_routes_data.py -v`
Expected: 404 on every route — the router isn't registered yet.

- [ ] **Step 3: Implement routes/data.py**

Create `flet-pnwdata/server/routes/data.py`:

```python
"""GET /api/data?type=<table>.

Reads JSON blobs out of the SQLite tables populated by sync.py and returns
them as JSON. Mirrors the case statements in
src/app/api/data/route.ts exactly so the wire format is identical.
"""
from __future__ import annotations

import json
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

router = APIRouter()


LIST_TYPES = {
    "members": "nations",
    "applicants": "applicants",
    "wars": "wars",
    "bankrecs": "bankrecs",
    "bknet_members": "bknet_members",
}

SINGLETON_TYPES = {
    "alliance": "alliance_meta",
    "trade_prices": "trade_prices",
    "game_info": "game_info",
}


@router.get("/api/data")
async def get_data(request: Request, type: str = Query(...)):
    conn = request.app.state.db

    if type in LIST_TYPES:
        rows = conn.execute(f"SELECT data FROM {LIST_TYPES[type]}").fetchall()
        return [json.loads(r[0]) for r in rows]

    if type in SINGLETON_TYPES:
        row = conn.execute(
            f"SELECT data FROM {SINGLETON_TYPES[type]} WHERE id=1"
        ).fetchone()
        return json.loads(row[0]) if row else None

    if type == "status":
        row = conn.execute(
            "SELECT id, last_synced_at, status, error, member_count, war_count, bankrec_count "
            "FROM sync_status WHERE id=1"
        ).fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "last_synced_at": row[1],
            "status": row[2],
            "error": row[3],
            "member_count": row[4],
            "war_count": row[5],
            "bankrec_count": row[6],
        }

    return JSONResponse(status_code=400, content={"error": "Unknown type"})
```

- [ ] **Step 4: Register the router in main.py**

Edit `flet-pnwdata/server/main.py` — add at the top of `create_app()` after `app = FastAPI(...)`:

```python
    from server.routes import data as data_routes
    app.include_router(data_routes.router)
```

The full `create_app` should now look like:

```python
def create_app(*, start_sync_loop: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # ... unchanged
        ...

    app = FastAPI(title="flet-pnwdata", lifespan=lifespan)

    from server.routes import data as data_routes
    app.include_router(data_routes.router)

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    return app
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_routes_data.py -v`
Expected: 11 passed.

- [ ] **Step 6: Commit**

```bash
cd flet-pnwdata && git add server/routes/data.py server/main.py tests/test_routes_data.py
git commit -m "feat(flet): add GET /api/data?type=<table>"
```

---

### Task 10: `GET /api/sync` (read status) and `POST /api/sync` (manual trigger)

**Files:**
- Create: `flet-pnwdata/server/routes/sync.py`
- Modify: `flet-pnwdata/server/main.py` (register router)
- Test: `flet-pnwdata/tests/test_routes_sync.py`

POST is intentionally not auth-gated in this plan; Plan 3 (server auth) will add the role-config dependency. We add a placeholder comment now.

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_routes_sync.py`:

```python
import pytest
import respx
from tests.test_sync import _mock_pnw_responses, BKNET_FIXTURE  # reuse


@pytest.mark.asyncio
async def test_get_sync_returns_status_row(app_client):
    client, _ = app_client
    resp = await client.get("/api/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "never"
    assert body["member_count"] == 0


@pytest.mark.asyncio
async def test_post_sync_triggers_sync_once(app_client):
    client, app = app_client
    with respx.mock() as mock:
        _mock_pnw_responses(mock)
        mock.get("https://bkpw.net/api/v1/members").respond(json=BKNET_FIXTURE)
        resp = await client.post("/api/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    assert body["member_count"] == 1


@pytest.mark.asyncio
async def test_post_sync_returns_error_status_on_failure(app_client):
    client, _ = app_client
    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").respond(
            json={"errors": [{"message": "boom"}]}
        )
        resp = await client.post("/api/sync")
    # We surface the error via HTTP 500 + body
    assert resp.status_code == 500
    assert "boom" in resp.json()["error"]
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_routes_sync.py -v`
Expected: 404 on `/api/sync` — router not registered.

- [ ] **Step 3: Implement routes/sync.py**

Create `flet-pnwdata/server/routes/sync.py`:

```python
"""GET/POST /api/sync.

GET returns the sync_status row. POST triggers a one-shot sync and returns
the resulting status (used by the manual "Sync now" button in the UI).

NOTE: POST is currently unauthenticated. Plan 3 (server auth) wires it
through the role-config dependency so only admins can trigger.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from server.sync import sync_once

router = APIRouter()


def _status_dict(conn) -> dict:
    row = conn.execute(
        "SELECT id, last_synced_at, status, error, member_count, war_count, bankrec_count "
        "FROM sync_status WHERE id=1"
    ).fetchone()
    return {
        "id": row[0],
        "last_synced_at": row[1],
        "status": row[2],
        "error": row[3],
        "member_count": row[4],
        "war_count": row[5],
        "bankrec_count": row[6],
    }


@router.get("/api/sync")
async def get_sync_status(request: Request):
    return _status_dict(request.app.state.db)


@router.post("/api/sync")
async def trigger_sync(request: Request):
    conn = request.app.state.db
    try:
        await sync_once(conn)
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})
    return _status_dict(conn)
```

- [ ] **Step 4: Register the router**

Edit `flet-pnwdata/server/main.py` — add next to the data router include:

```python
    from server.routes import data as data_routes
    from server.routes import sync as sync_routes
    app.include_router(data_routes.router)
    app.include_router(sync_routes.router)
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_routes_sync.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
cd flet-pnwdata && git add server/routes/sync.py server/main.py tests/test_routes_sync.py
git commit -m "feat(flet): add GET/POST /api/sync"
```

---

### Task 11: End-to-end test — boot app, run sync, query data

**Files:**
- Create: `flet-pnwdata/tests/test_end_to_end.py`

A single test that exercises the full path: app boots → POST /api/sync writes everything → subsequent GET /api/data calls return the synced rows.

- [ ] **Step 1: Write the test**

Create `flet-pnwdata/tests/test_end_to_end.py`:

```python
import pytest
import respx
from tests.test_sync import _mock_pnw_responses, BKNET_FIXTURE


@pytest.mark.asyncio
async def test_full_sync_then_read(app_client):
    client, _ = app_client

    with respx.mock() as mock:
        _mock_pnw_responses(mock)
        mock.get("https://bkpw.net/api/v1/members").respond(json=BKNET_FIXTURE)
        sync_resp = await client.post("/api/sync")
    assert sync_resp.status_code == 200

    # Now read everything through /api/data
    members = (await client.get("/api/data?type=members")).json()
    assert len(members) == 1 and members[0]["id"] == 1

    applicants = (await client.get("/api/data?type=applicants")).json()
    assert len(applicants) == 1 and applicants[0]["id"] == 2

    wars = (await client.get("/api/data?type=wars")).json()
    assert len(wars) == 1 and wars[0]["id"] == 999

    bankrecs = (await client.get("/api/data?type=bankrecs")).json()
    assert len(bankrecs) == 1 and bankrecs[0]["id"] == 500

    alliance = (await client.get("/api/data?type=alliance")).json()
    assert alliance is not None and alliance["id"] == 100 and alliance["member_count"] == 1

    trade = (await client.get("/api/data?type=trade_prices")).json()
    assert trade is not None and trade["id"] == 1

    game = (await client.get("/api/data?type=game_info")).json()
    assert game["radiation"]["global"] == 0.1

    bknet = (await client.get("/api/data?type=bknet_members")).json()
    assert len(bknet) == 1 and bknet[0]["nation"]["id"] == 12345

    status = (await client.get("/api/data?type=status")).json()
    assert status["status"] == "success"
    assert status["member_count"] == 1
```

- [ ] **Step 2: Run test, verify it passes**

Run: `cd flet-pnwdata && .venv/bin/pytest tests/test_end_to_end.py -v`
Expected: 1 passed.

- [ ] **Step 3: Run the full suite**

Run: `cd flet-pnwdata && .venv/bin/pytest -v`
Expected: all tests pass — should be roughly 27 tests total.

- [ ] **Step 4: Commit**

```bash
cd flet-pnwdata && git add tests/test_end_to_end.py
git commit -m "test(flet): add end-to-end sync + read integration test"
```

---

### Task 12: Smoke test against a real PnW key (manual)

This task verifies the server works against the live PnW API. It is **manual** — no automated test — because we don't want to hit the live API from CI.

- [ ] **Step 1: Copy and populate .env**

```bash
cd flet-pnwdata && cp .env.example .env
# Edit .env and fill PNW_API_KEY (BKNET_API_TOKEN optional)
```

- [ ] **Step 2: Run the server**

```bash
cd flet-pnwdata && .venv/bin/uvicorn server.main:app --port 8000
```

Wait for the first sync to complete — it logs `[PnW Sync] Done — N members, M wars, K bankrecs`.

- [ ] **Step 3: Hit the endpoints from another terminal**

```bash
curl -s http://localhost:8000/api/health | jq
curl -s http://localhost:8000/api/sync | jq
curl -s "http://localhost:8000/api/data?type=members" | jq '. | length'
curl -s "http://localhost:8000/api/data?type=alliance" | jq '.name'
```

Expected:
- `/api/health` → `{"ok": true}`
- `/api/sync` → `status: "success"`, `member_count` > 0
- `members` → integer (your alliance's member count)
- `alliance` → your alliance name as a string

- [ ] **Step 4: Compare against the Next.js app**

In another terminal, with `npm run dev` running:
```bash
curl -s http://localhost:3000/api/data?type=members | jq '. | length'
curl -s http://localhost:3000/api/data?type=alliance | jq '.name'
```

The counts and names should match. If they diverge, capture which fields differ and file an issue — the wire format must match for the future Flet client to be portable between the two backends during development.

- [ ] **Step 5: Stop the server with Ctrl-C and verify shutdown is clean**

The lifespan should print a clean shutdown log (no traceback). The sync task should cancel within `SYNC_INTERVAL_SECONDS` (10 minutes by default — you can set `SYNC_INTERVAL_SECONDS=5` to verify shutdown timing is bounded).

- [ ] **Step 6: Commit nothing (this task is verification only)**

No code changes — this task is just confirming the deliverable works.

---

## Spec Coverage Check

Each spec requirement implemented in this plan:

| Spec requirement | Covered by |
|---|---|
| FastAPI server owns the SQLite DB | Task 3 + Task 8 |
| Background sync loop every 10 min | Task 6 + Task 7 |
| `GET /api/data?type=<table>` | Task 9 |
| `GET/POST /api/sync` | Task 10 |
| Schema: nations, applicants, wars, bankrecs, alliance_meta, trade_prices, bknet_members, game_info, sync_status | Task 3 |
| APPLICANT filter in nations | Task 6 |
| BK Net wrapped in try/except (resilience) | Task 6 |
| Pydantic types shared with Flet client | Task 2 |
| Single transaction per sync | Task 6 |
| `member_count` derived in sync (not from GraphQL) | Task 6 |
| Wars fully replaced each sync | Task 6 |
| Applicants table emptied when no applicants present | Task 6 |

Out-of-scope for Plan 1 (per the design — covered by later plans):
- `/api/warTargets`, `/api/conflictStats`, `/api/beigeWatch` — Plan 2
- `/api/export` (Excel) — Plan 2
- Auth, role gating, `/api/auth/exchange` — Plan 3
- `/api/war-config`, `/api/role-config` admin endpoints — Plan 3
- recruitment sync, stockpile alerts, quiz_sessions, discord_resolved tables — separate plan (these are bot-side concerns)
- Flet client (everything in `client/`) — Plans 4–9

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-flet-pnwdata-server-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
