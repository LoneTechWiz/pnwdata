# flet-pnwdata Live Endpoints + Excel Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three live-data routes (`/api/warTargets`, `/api/beigeWatch`) and the server-side Excel export (`/api/export?type=<table>`) to the FastAPI backend from Plan 1. Live routes call PnW GraphQL directly with retry-on-429, and use `data/war-config.json` for enemy alliance IDs.

**Architecture:** Three new FastAPI routes that hit PnW live (no SQLite cache) for war-target finding and beige-watching, plus an export route that reads SQLite tables and streams an `.xlsx` workbook via openpyxl. Adds a `war_config` module to load `data/war-config.json`, and refactors `pnw_api.gql()` to retry on HTTP 429 with exponential backoff (matches the current Next.js `gql<T>()` behavior in `src/app/api/warTargets/route.ts`).

**Tech Stack:** FastAPI, httpx, respx, openpyxl, pydantic, pytest (all already installed in Plan 1 except openpyxl).

**Out of scope for this plan:**
- `/api/conflictStats` — does not exist in the current Next.js project. Skipped until it's actually built somewhere.
- Auth/role-gating on these endpoints — Plan 3 wires that in.

**Scope check:** This plan covers two independent route groups (live data, export) but they share enough infrastructure (`pnw_api` retry, the existing FastAPI app, the existing test fixtures) that splitting them further would create more coordination overhead than it saves. One plan.

This plan assumes Plan 1 is complete (`flet-pnwdata/` contains a working FastAPI server with 36 passing tests).

---

## File Structure

Files this plan creates or modifies (under `flet-pnwdata/`):

```
flet-pnwdata/
├── pyproject.toml                       # MODIFY — add openpyxl dep
├── data/
│   └── war-config.json                  # CREATE — sample config (gitignored anyway)
├── server/
│   ├── pnw_api.py                       # MODIFY — add retry-on-429; add 4 new queries
│   ├── war_config.py                    # CREATE — read/validate data/war-config.json
│   ├── prices.py                        # CREATE — load trade prices + value attack loot
│   ├── main.py                          # MODIFY — register 3 new routers
│   └── routes/
│       ├── war_targets.py               # CREATE — GET /api/warTargets
│       ├── beige_watch.py               # CREATE — GET /api/beigeWatch
│       └── export.py                    # CREATE — GET /api/export?type=<table>
├── shared/
│   └── live_models.py                   # CREATE — pydantic models for live responses
└── tests/
    ├── fixtures/
    │   └── war_config.json              # CREATE — fixture for war_config tests
    ├── test_war_config.py
    ├── test_prices.py
    ├── test_pnw_api_retry.py
    ├── test_routes_war_targets.py
    ├── test_routes_beige_watch.py
    └── test_routes_export.py
```

Each module is single-purpose: `war_config.py` only knows how to read a JSON file, `prices.py` only knows how to value a loot bundle, and each route file knows only one endpoint's request/response shape.

---

### Task 1: Add openpyxl dependency

**Files:**
- Modify: `flet-pnwdata/pyproject.toml`

- [ ] **Step 1: Edit pyproject.toml**

Open `flet-pnwdata/pyproject.toml`. In the `[project]` section's `dependencies` list, add `openpyxl>=3.1` so the list reads:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "httpx>=0.27",
    "pydantic>=2.9",
    "python-dotenv>=1.0",
    "openpyxl>=3.1",
]
```

- [ ] **Step 2: Reinstall**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pip install -e ".[dev]"
```
Expected: install completes, openpyxl is installed.

- [ ] **Step 3: Verify import works**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/python -c "import openpyxl; print(openpyxl.__version__)"
```
Expected: a version string like `3.1.x` printed.

- [ ] **Step 4: No commit** — DO NOT run git operations (per user direction).

---

### Task 2: War config reader

The Next.js routes read `data/war-config.json` with a `enemy_alliance_ids` array of positive integers. Both `/api/warTargets` and `/api/beigeWatch` need this loader, so it gets its own module.

**Files:**
- Create: `flet-pnwdata/server/war_config.py`
- Create: `flet-pnwdata/tests/fixtures/war_config.json`
- Test: `flet-pnwdata/tests/test_war_config.py`

- [ ] **Step 1: Write the fixture**

Create `flet-pnwdata/tests/fixtures/war_config.json`:

```json
{
  "enemy_alliance_ids": [100, 200, 300],
  "ally_alliance_ids": [400]
}
```

- [ ] **Step 2: Write the failing test**

Create `flet-pnwdata/tests/test_war_config.py`:

```python
import json
from pathlib import Path
import pytest

from server.war_config import (
    load_war_config,
    WarConfigError,
    enemy_alliance_ids,
)


def test_load_war_config_returns_parsed_dict(tmp_path: Path):
    cfg_path = tmp_path / "war-config.json"
    cfg_path.write_text(json.dumps({"enemy_alliance_ids": [1, 2, 3]}))
    data = load_war_config(str(cfg_path))
    assert data == {"enemy_alliance_ids": [1, 2, 3]}


def test_load_war_config_missing_file_raises(tmp_path: Path):
    with pytest.raises(WarConfigError, match="not found or invalid"):
        load_war_config(str(tmp_path / "missing.json"))


def test_load_war_config_invalid_json_raises(tmp_path: Path):
    cfg_path = tmp_path / "war-config.json"
    cfg_path.write_text("{ not valid json")
    with pytest.raises(WarConfigError, match="not found or invalid"):
        load_war_config(str(cfg_path))


def test_enemy_alliance_ids_returns_ints():
    cfg = {"enemy_alliance_ids": [100, "200", 300.0]}
    assert enemy_alliance_ids(cfg) == [100, 200, 300]


def test_enemy_alliance_ids_rejects_empty():
    with pytest.raises(WarConfigError, match="non-empty array"):
        enemy_alliance_ids({"enemy_alliance_ids": []})


def test_enemy_alliance_ids_rejects_missing_field():
    with pytest.raises(WarConfigError, match="non-empty array"):
        enemy_alliance_ids({})


def test_enemy_alliance_ids_rejects_non_positive_id():
    with pytest.raises(WarConfigError, match="positive integers"):
        enemy_alliance_ids({"enemy_alliance_ids": [100, -1, 200]})


def test_enemy_alliance_ids_rejects_zero():
    with pytest.raises(WarConfigError, match="positive integers"):
        enemy_alliance_ids({"enemy_alliance_ids": [0]})


def test_enemy_alliance_ids_rejects_non_numeric():
    with pytest.raises(WarConfigError, match="positive integers"):
        enemy_alliance_ids({"enemy_alliance_ids": ["foo"]})
```

- [ ] **Step 3: Run test, verify it fails**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_war_config.py -v
```
Expected: ImportError on `server.war_config`.

- [ ] **Step 4: Implement war_config.py**

Create `flet-pnwdata/server/war_config.py`:

```python
"""Read and validate data/war-config.json.

Mirrors the validation in src/app/api/warTargets/route.ts so the Python
endpoints surface the same error messages the Flet client can rely on.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class WarConfigError(RuntimeError):
    """Raised when war-config.json is missing, malformed, or has invalid IDs."""


def load_war_config(path: str | Path) -> dict[str, Any]:
    """Parse the war-config JSON file. Raises WarConfigError on any issue."""
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise WarConfigError(
            "data/war-config.json not found or invalid JSON — ask an admin to check it"
        ) from e


def enemy_alliance_ids(config: dict[str, Any]) -> list[int]:
    """Extract and validate enemy_alliance_ids from a parsed config dict."""
    raw = config.get("enemy_alliance_ids")
    if not isinstance(raw, list) or len(raw) == 0:
        raise WarConfigError(
            "war-config.json: enemy_alliance_ids must be a non-empty array — "
            "ask an admin to add alliance IDs"
        )
    try:
        ids = [int(x) for x in raw]
    except (TypeError, ValueError) as e:
        raise WarConfigError(
            "war-config.json: all enemy_alliance_ids must be positive integers"
        ) from e
    if any(i <= 0 for i in ids):
        raise WarConfigError(
            "war-config.json: all enemy_alliance_ids must be positive integers"
        )
    return ids


def ally_alliance_ids(config: dict[str, Any]) -> list[int]:
    """Extract ally_alliance_ids (optional). Returns empty list if absent."""
    raw = config.get("ally_alliance_ids", [])
    if not isinstance(raw, list):
        return []
    try:
        return [int(x) for x in raw if x is not None]
    except (TypeError, ValueError):
        return []
```

- [ ] **Step 5: Run test, verify it passes**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_war_config.py -v
```
Expected: 9 passed.

- [ ] **Step 6: Create a sample war-config.json**

Create `flet-pnwdata/data/war-config.json`:

```json
{
  "enemy_alliance_ids": [],
  "ally_alliance_ids": []
}
```

This file is in `data/` which is gitignored — but it's needed at runtime so the routes don't error before the user populates it.

- [ ] **Step 7: No commit.**

---

### Task 3: Add retry-on-429 to pnw_api.gql()

The Next.js `gql<T>()` retries on 429 with exponential backoff (`2000ms * (attempt+1)`, 3 retries). The current Python `gql()` does not. The live endpoints hit PnW much more aggressively than the periodic sync, so retry is essential here.

**Files:**
- Modify: `flet-pnwdata/server/pnw_api.py`
- Test: `flet-pnwdata/tests/test_pnw_api_retry.py`

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_pnw_api_retry.py`:

```python
import asyncio
import httpx
import respx
import pytest


@pytest.mark.asyncio
async def test_gql_retries_on_429_then_succeeds(fake_env, monkeypatch):
    """gql() should retry up to 3 times on 429, then succeed."""
    # Disable sleep so the test runs instantly.
    monkeypatch.setattr("server.pnw_api._retry_sleep", lambda _: asyncio.sleep(0))

    from server.pnw_api import gql
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                respx.MockResponse(status_code=429),
                respx.MockResponse(status_code=429),
                respx.MockResponse(json={"data": {"ok": True}}),
            ]
        )
        result = await gql("{ ok }")
        assert result == {"ok": True}
        assert route.call_count == 3


@pytest.mark.asyncio
async def test_gql_gives_up_after_retries_exhausted(fake_env, monkeypatch):
    """gql() should raise after exhausting retries on persistent 429."""
    monkeypatch.setattr("server.pnw_api._retry_sleep", lambda _: asyncio.sleep(0))

    from server.pnw_api import gql, PnwGraphQLError
    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                respx.MockResponse(status_code=429),
                respx.MockResponse(status_code=429),
                respx.MockResponse(status_code=429),
                respx.MockResponse(status_code=429),
            ]
        )
        with pytest.raises(PnwGraphQLError, match="rate limited"):
            await gql("{ ok }")


@pytest.mark.asyncio
async def test_gql_does_not_retry_on_500(fake_env):
    """500 errors should not be retried."""
    from server.pnw_api import gql, PnwGraphQLError
    with respx.mock(assert_all_called=True) as mock:
        route = mock.post("https://api.politicsandwar.com/graphql").respond(
            status_code=500
        )
        with pytest.raises(PnwGraphQLError, match="HTTP 500"):
            await gql("{ ok }")
        assert route.call_count == 1
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_pnw_api_retry.py -v
```
Expected: tests fail because `_retry_sleep` doesn't exist and `gql` doesn't retry.

- [ ] **Step 3: Modify pnw_api.py to add retry**

Open `flet-pnwdata/server/pnw_api.py`. Replace the `gql` function and add a `_retry_sleep` helper. Replace the existing `async def gql(...)` block with:

```python
import asyncio


async def _retry_sleep(seconds: float) -> None:
    """Indirection point so tests can monkeypatch to skip the sleep."""
    await asyncio.sleep(seconds)


MAX_RETRIES = 3


async def gql(query: str, variables: dict | None = None) -> dict:
    """Execute a GraphQL query against PnW. Returns the contents of `data`.

    Retries up to MAX_RETRIES times on HTTP 429 with exponential backoff
    (2s, 4s, 6s) — matches src/app/api/warTargets/route.ts.

    Reads PNW_API_KEY from os.environ at call time so tests using
    monkeypatch.setenv work regardless of when settings was first imported.
    """
    params = {"api_key": os.environ.get("PNW_API_KEY", "")}
    payload = {"query": query, "variables": variables or {}}
    async with httpx.AsyncClient(timeout=30.0) as client:
        for attempt in range(MAX_RETRIES + 1):
            resp = await client.post(PNW_API_URL, params=params, json=payload)
            if resp.status_code == 429:
                if attempt < MAX_RETRIES:
                    await _retry_sleep(2.0 * (attempt + 1))
                    continue
                raise PnwGraphQLError(
                    "PnW API rate limited (429) — try again in a moment"
                )
            if resp.status_code >= 400:
                raise PnwGraphQLError(f"PnW API HTTP {resp.status_code}")
            body = resp.json()
            if body.get("errors"):
                raise PnwGraphQLError(body["errors"][0].get("message", "unknown"))
            return body["data"]
    raise PnwGraphQLError("PnW API request failed after retries")
```

Note: `import asyncio` and `import os` should already be at the top of the file from Plan 1. If `os` is missing, add `import os`.

- [ ] **Step 4: Run retry tests, verify they pass**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_pnw_api_retry.py -v
```
Expected: 3 passed.

- [ ] **Step 5: Run the full suite to ensure no regressions**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -v
```
Expected: all previously passing tests (36) plus the 9 from war_config + 3 retry tests = 48 passed.

- [ ] **Step 6: No commit.**

---

### Task 4: Trade prices loader + loot valuation

The Next.js routes load `trade_prices` from SQLite and use it to value attack loot. Both `warTargets` and `beigeWatch` use the exact same `attackLootValue` function. Extract it.

**Files:**
- Create: `flet-pnwdata/server/prices.py`
- Test: `flet-pnwdata/tests/test_prices.py`

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_prices.py`:

```python
import json
import pytest

from server.prices import load_trade_prices, attack_loot_value


def test_load_trade_prices_returns_dict_when_row_exists(db_conn):
    db_conn.execute(
        "INSERT INTO trade_prices (id, data, updated_at) VALUES (1, ?, ?)",
        (json.dumps({
            "coal": 10.0, "oil": 20.0, "uranium": 30.0, "iron": 40.0,
            "bauxite": 50.0, "lead": 60.0, "gasoline": 70.0,
            "munitions": 80.0, "steel": 90.0, "aluminum": 100.0, "food": 110.0,
        }), 0),
    )
    prices = load_trade_prices(db_conn)
    assert prices is not None
    assert prices["coal"] == 10.0
    assert prices["food"] == 110.0


def test_load_trade_prices_returns_none_when_missing(db_conn):
    assert load_trade_prices(db_conn) is None


def test_attack_loot_value_money_only_when_no_prices():
    attacks = [
        {"money_looted": 1000, "coal_looted": 5, "oil_looted": 5, "uranium_looted": 0,
         "iron_looted": 0, "bauxite_looted": 0, "lead_looted": 0, "gasoline_looted": 0,
         "munitions_looted": 0, "steel_looted": 0, "aluminum_looted": 0, "food_looted": 0},
    ]
    assert attack_loot_value(attacks, None) == 1000


def test_attack_loot_value_sums_money_plus_resources():
    prices = {
        "coal": 10.0, "oil": 20.0, "uranium": 30.0, "iron": 40.0,
        "bauxite": 50.0, "lead": 60.0, "gasoline": 70.0,
        "munitions": 80.0, "steel": 90.0, "aluminum": 100.0, "food": 110.0,
    }
    attacks = [
        {"money_looted": 100, "coal_looted": 1, "oil_looted": 1, "uranium_looted": 0,
         "iron_looted": 0, "bauxite_looted": 0, "lead_looted": 0, "gasoline_looted": 0,
         "munitions_looted": 0, "steel_looted": 0, "aluminum_looted": 0, "food_looted": 0},
        {"money_looted": 200, "coal_looted": 0, "oil_looted": 0, "uranium_looted": 0,
         "iron_looted": 0, "bauxite_looted": 0, "lead_looted": 0, "gasoline_looted": 0,
         "munitions_looted": 0, "steel_looted": 1, "aluminum_looted": 0, "food_looted": 0},
    ]
    # Attack 1: 100 + 10 + 20 = 130
    # Attack 2: 200 + 90 = 290
    # Total: 420
    assert attack_loot_value(attacks, prices) == 420


def test_attack_loot_value_handles_empty_attacks_list():
    assert attack_loot_value([], None) == 0
    assert attack_loot_value([], {"coal": 1.0}) == 0
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_prices.py -v
```
Expected: ImportError on `server.prices`.

- [ ] **Step 3: Implement prices.py**

Create `flet-pnwdata/server/prices.py`:

```python
"""Trade prices loader and attack loot valuation.

Ports the inline `prices` lookup + `attackLootValue` function from
src/app/api/warTargets/route.ts and beigeWatch/route.ts (they have
identical implementations).
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any


PRICE_RESOURCES = (
    "coal", "oil", "uranium", "iron", "bauxite", "lead",
    "gasoline", "munitions", "steel", "aluminum", "food",
)


def load_trade_prices(conn: sqlite3.Connection) -> dict[str, float] | None:
    """Load the latest trade prices row from SQLite. Returns None if not present."""
    row = conn.execute("SELECT data FROM trade_prices WHERE id=1").fetchone()
    if not row:
        return None
    return json.loads(row[0])


def attack_loot_value(attacks: list[dict[str, Any]], prices: dict[str, float] | None) -> float:
    """Total loot value across attacks: money_looted plus per-resource value.

    If `prices` is None, only money_looted is counted (resources contribute 0).
    """
    total = 0.0
    for a in attacks:
        total += a.get("money_looted", 0) or 0
        if prices is None:
            continue
        for res in PRICE_RESOURCES:
            looted = a.get(f"{res}_looted", 0) or 0
            total += looted * prices.get(res, 0)
    return total
```

- [ ] **Step 4: Run test, verify it passes**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_prices.py -v
```
Expected: 5 passed.

- [ ] **Step 5: Full suite check**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -v
```
Expected: 53 passed (48 + 5).

- [ ] **Step 6: No commit.**

---

### Task 5: Live-data pydantic models

Add response models for `/api/warTargets` and `/api/beigeWatch`. The frontend will deserialize these.

**Files:**
- Create: `flet-pnwdata/shared/live_models.py`

- [ ] **Step 1: Implement live_models.py**

Create `flet-pnwdata/shared/live_models.py`:

```python
"""Response models for live PnW data endpoints.

Mirrors the TypeScript types in src/app/api/warTargets/route.ts and
beigeWatch/route.ts.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")


class WarTarget(_Base):
    id: int
    nation_name: str
    leader_name: str
    alliance_name: str
    score: float
    num_cities: int
    avg_infra: int
    soldiers: int
    tanks: int
    aircraft: int
    ships: int
    offensive_wars_count: int
    defensive_wars_count: int
    vacation_mode_turns: int
    beige_turns: int
    beige_loot: float | None = None
    beige_date: str | None = None
    beige_avg: float | None = None
    beige_count: int | None = None
    last_active: str


class WarTargetsResponse(_Base):
    targets: list[WarTarget]
    yourScore: float
    minScore: int
    maxScore: int
    yourLeader: str
    yourDiscord: str | None
    nationInAlliance: bool


class BeigeNation(_Base):
    id: int
    nation_name: str
    leader_name: str
    alliance_name: str
    score: float
    num_cities: int
    avg_infra: int
    beige_turns: int
    soldiers: int
    tanks: int
    aircraft: int
    ships: int
    offensive_wars_count: int
    defensive_wars_count: int
    inRange: bool | None
    beige_loot: float | None = None
    beige_date: str | None = None
    beige_avg: float | None = None
    beige_count: int | None = None


class BeigeWatchResponse(_Base):
    nations: list[BeigeNation]
    yourScore: float | None = None
    minScore: int | None = None
    maxScore: int | None = None
    yourLeader: str | None = None
    yourDiscord: str | None = None
```

- [ ] **Step 2: Quick sanity check**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/python -c "from shared.live_models import WarTarget, WarTargetsResponse, BeigeNation, BeigeWatchResponse; print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: No commit.**

---

### Task 6: Add new GraphQL queries to pnw_api.py

The live routes use 4 queries not yet in `pnw_api.py`: `NATION_SCORE_QUERY`, `OFFENSIVE_WARS_QUERY`, `BEIGE_WARS_QUERY`, `ENEMY_MEMBERS_QUERY` (the last one is for enemy alliances, separate from the existing `MEMBERS_QUERY` which is for the home alliance).

**Files:**
- Modify: `flet-pnwdata/server/pnw_api.py`

- [ ] **Step 1: Append the new query constants**

Open `flet-pnwdata/server/pnw_api.py` and append (after `GAME_INFO_QUERY`):

```python
NATION_SCORE_QUERY = """
  query($id:[Int]) { nations(id:$id) { data { score leader_name discord } } }
"""

OFFENSIVE_WARS_QUERY = """
  query($attid:[Int]) { wars(attid:$attid, active:true) { data { def_id } } }
"""

ENEMY_MEMBERS_QUERY = """
  query($alliance_id:[Int]) { nations(alliance_id:$alliance_id, first:500) { data {
    id nation_name leader_name score num_cities
    alliance { name }
    cities { infrastructure }
    soldiers tanks aircraft ships
    offensive_wars_count defensive_wars_count vacation_mode_turns beige_turns
    last_active
  } } }
"""

BEIGE_WARS_QUERY = """
  query($ids:[Int], $after:DateTime, $page:Int) {
    wars(or_id:$ids, active:false, after:$after, first:500, page:$page) {
      data {
        date att_id def_id winner_id
        attacks {
          money_looted coal_looted oil_looted uranium_looted iron_looted bauxite_looted
          lead_looted gasoline_looted munitions_looted steel_looted aluminum_looted food_looted
        }
      }
    }
  }
"""
```

- [ ] **Step 2: Verify imports still work**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/python -c "from server.pnw_api import NATION_SCORE_QUERY, OFFENSIVE_WARS_QUERY, ENEMY_MEMBERS_QUERY, BEIGE_WARS_QUERY; print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Full suite check**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -v
```
Expected: 53 passed (no test changes, just verifying no syntax errors).

- [ ] **Step 4: No commit.**

---

### Task 7: `GET /api/warTargets`

The endpoint:
1. Reads `nationId` query param (required positive int)
2. Loads enemy alliance IDs from `data/war-config.json`
3. Fetches your nation's score (NATION_SCORE_QUERY) and your offensive wars (OFFENSIVE_WARS_QUERY) in parallel
4. Computes score range (`floor(score*0.75)` to `ceil(score*4/3)`)
5. Fetches enemy alliance members via `Promise.allSettled` equivalent (`asyncio.gather(..., return_exceptions=True)`)
6. Filters: in range, not already at war, defensive_wars_count<3, not VM, not beige
7. Fetches beige war loot (capped at 5 pages, last 30 days)
8. Sorts by `avg_infra` descending
9. Returns `WarTargetsResponse`

**Files:**
- Create: `flet-pnwdata/server/routes/war_targets.py`
- Modify: `flet-pnwdata/server/main.py` (register router, and add a war-config path resolver)
- Test: `flet-pnwdata/tests/test_routes_war_targets.py`

- [ ] **Step 1: Add a war-config path helper to settings**

Edit `flet-pnwdata/server/settings.py`. After the existing constants, append:

```python
WAR_CONFIG_PATH = env("WAR_CONFIG_PATH", "data/war-config.json")
```

- [ ] **Step 2: Write the failing test**

Create `flet-pnwdata/tests/test_routes_war_targets.py`:

```python
import json
import pytest
import respx
from pathlib import Path


def _enemy_member(nid: int, *, score: float = 1000.0, vm: int = 0, beige: int = 0,
                  def_wars: int = 0, alliance: str = "Bad Guys") -> dict:
    return {
        "id": nid, "nation_name": f"target{nid}", "leader_name": f"leader{nid}",
        "score": score, "num_cities": 10,
        "alliance": {"name": alliance},
        "cities": [{"infrastructure": 2000}] * 10,
        "soldiers": 50000, "tanks": 2000, "aircraft": 100, "ships": 10,
        "offensive_wars_count": 0, "defensive_wars_count": def_wars,
        "vacation_mode_turns": vm, "beige_turns": beige,
        "last_active": "2026-05-22T00:00:00+00:00",
    }


def _write_war_config(tmp_path: Path, enemy_ids: list[int]) -> str:
    cfg = tmp_path / "war-config.json"
    cfg.write_text(json.dumps({"enemy_alliance_ids": enemy_ids}))
    return str(cfg)


@pytest.mark.asyncio
async def test_returns_targets_in_score_range(app_client, tmp_path, monkeypatch):
    client, app = app_client
    cfg_path = _write_war_config(tmp_path, [100])
    monkeypatch.setenv("WAR_CONFIG_PATH", cfg_path)

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                # NATION_SCORE (yourScore=1000) — runs first because gather sees it first
                respx.MockResponse(json={"data": {"nations": {"data": [{
                    "score": 1000.0, "leader_name": "Me", "discord": "me#0",
                }]}}}),
                # OFFENSIVE_WARS — no active wars
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
                # ENEMY_MEMBERS for alliance 100 — three candidates
                respx.MockResponse(json={"data": {"nations": {"data": [
                    _enemy_member(1, score=900.0),    # in range
                    _enemy_member(2, score=2000.0),   # out of range (too high)
                    _enemy_member(3, score=500.0),    # out of range (too low)
                ]}}}),
                # BEIGE_WARS_QUERY page 1 — empty
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
            ]
        )
        resp = await client.get("/api/warTargets?nationId=42")

    assert resp.status_code == 200
    body = resp.json()
    assert body["yourScore"] == 1000.0
    assert body["yourLeader"] == "Me"
    assert body["yourDiscord"] == "me#0"
    assert body["minScore"] == 750  # floor(1000 * 0.75)
    assert body["maxScore"] == 1334  # ceil(1000 * 4/3)
    assert len(body["targets"]) == 1
    assert body["targets"][0]["id"] == 1
    assert body["nationInAlliance"] is False  # nation 42 not in our DB


@pytest.mark.asyncio
async def test_filters_out_at_war_and_vm_and_beige(app_client, tmp_path, monkeypatch):
    client, app = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", _write_war_config(tmp_path, [100]))

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                respx.MockResponse(json={"data": {"nations": {"data": [{
                    "score": 1000.0, "leader_name": "Me", "discord": None,
                }]}}}),
                # OFFENSIVE_WARS — already at war with nation 1
                respx.MockResponse(json={"data": {"wars": {"data": [{"def_id": 1}]}}}),
                # ENEMY_MEMBERS
                respx.MockResponse(json={"data": {"nations": {"data": [
                    _enemy_member(1, score=900.0),                        # excluded: already at war
                    _enemy_member(2, score=900.0, vm=10),                  # excluded: VM
                    _enemy_member(3, score=900.0, beige=5),                # excluded: beige
                    _enemy_member(4, score=900.0, def_wars=3),             # excluded: 3 def wars
                    _enemy_member(5, score=900.0),                        # KEPT
                ]}}}),
                # BEIGE_WARS empty
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
            ]
        )
        resp = await client.get("/api/warTargets?nationId=42")

    assert resp.status_code == 200
    body = resp.json()
    target_ids = [t["id"] for t in body["targets"]]
    assert target_ids == [5]


@pytest.mark.asyncio
async def test_returns_400_on_missing_or_invalid_nationId(app_client):
    client, _ = app_client
    resp = await client.get("/api/warTargets")
    assert resp.status_code == 400
    resp = await client.get("/api/warTargets?nationId=abc")
    assert resp.status_code == 400
    resp = await client.get("/api/warTargets?nationId=-5")
    assert resp.status_code == 400
    resp = await client.get("/api/warTargets?nationId=0")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_returns_404_when_nation_not_found(app_client, tmp_path, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", _write_war_config(tmp_path, [100]))

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                respx.MockResponse(json={"data": {"nations": {"data": []}}}),
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
            ]
        )
        resp = await client.get("/api/warTargets?nationId=9999")

    assert resp.status_code == 404
    assert "9999" in resp.json()["error"]


@pytest.mark.asyncio
async def test_returns_500_when_war_config_missing(app_client, tmp_path, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", str(tmp_path / "missing.json"))

    resp = await client.get("/api/warTargets?nationId=42")
    assert resp.status_code == 500
    assert "war-config" in resp.json()["error"]


@pytest.mark.asyncio
async def test_returns_500_when_war_config_empty(app_client, tmp_path, monkeypatch):
    client, _ = app_client
    cfg = tmp_path / "war-config.json"
    cfg.write_text(json.dumps({"enemy_alliance_ids": []}))
    monkeypatch.setenv("WAR_CONFIG_PATH", str(cfg))

    resp = await client.get("/api/warTargets?nationId=42")
    assert resp.status_code == 500
    assert "non-empty" in resp.json()["error"]


@pytest.mark.asyncio
async def test_nation_in_alliance_true_when_in_db(app_client, tmp_path, monkeypatch):
    client, app = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", _write_war_config(tmp_path, [100]))
    # Insert nation 42 into the nations table
    app.state.db.execute(
        "INSERT INTO nations (id, data, updated_at) VALUES (?, ?, ?)",
        (42, json.dumps({"id": 42}), 0),
    )

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                respx.MockResponse(json={"data": {"nations": {"data": [{
                    "score": 1000.0, "leader_name": "Me", "discord": None,
                }]}}}),
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
                respx.MockResponse(json={"data": {"nations": {"data": []}}}),
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
            ]
        )
        resp = await client.get("/api/warTargets?nationId=42")

    assert resp.status_code == 200
    assert resp.json()["nationInAlliance"] is True


@pytest.mark.asyncio
async def test_returns_502_when_all_alliance_queries_fail(app_client, tmp_path, monkeypatch):
    """If every enemy alliance query fails, surface 502."""
    client, _ = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", _write_war_config(tmp_path, [100, 200]))

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                respx.MockResponse(json={"data": {"nations": {"data": [{
                    "score": 1000.0, "leader_name": "Me", "discord": None,
                }]}}}),
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
                # Both alliance queries fail
                respx.MockResponse(status_code=500),
                respx.MockResponse(status_code=500),
            ]
        )
        resp = await client.get("/api/warTargets?nationId=42")

    assert resp.status_code == 502
```

- [ ] **Step 3: Run test, verify it fails**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_war_targets.py -v
```
Expected: 404 on every route, then ImportError once the route file exists but doesn't.

- [ ] **Step 4: Implement war_targets.py**

Create `flet-pnwdata/server/routes/war_targets.py`:

```python
"""GET /api/warTargets — finds war targets in score range from enemy alliances.

Ports src/app/api/warTargets/route.ts. No SQLite cache except for the local
trade_prices row (for resource valuation) and the local nations+applicants
tables (to compute nationInAlliance).
"""
from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from server import pnw_api
from server.prices import attack_loot_value, load_trade_prices
from server.war_config import WarConfigError, enemy_alliance_ids, load_war_config

router = APIRouter()


def _war_config_path() -> str:
    """Read at call time so tests can monkeypatch WAR_CONFIG_PATH."""
    return os.environ.get("WAR_CONFIG_PATH", "data/war-config.json")


def _avg_infra(cities: list[dict]) -> int:
    if not cities:
        return 0
    return round(sum(c["infrastructure"] for c in cities) / len(cities))


def _beige_after_date(days_ago: int) -> str:
    d = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d} 00:00:00"


@router.get("/api/warTargets")
async def get_war_targets(request: Request):
    if not os.environ.get("PNW_API_KEY"):
        return JSONResponse(status_code=500, content={"error": "PNW_API_KEY is not configured"})

    # 1. Validate nationId
    nation_id_str = request.query_params.get("nationId")
    try:
        nation_id = int(nation_id_str) if nation_id_str else 0
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"error": "nationId must be a positive integer"})
    if nation_id <= 0:
        return JSONResponse(status_code=400, content={"error": "nationId must be a positive integer"})

    # 2. Read and validate war-config
    try:
        config = load_war_config(_war_config_path())
        enemy_ids = enemy_alliance_ids(config)
    except WarConfigError as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    # 3. Fetch your nation + active offensive wars in parallel
    try:
        nation_data, wars_data = await asyncio.gather(
            pnw_api.gql(pnw_api.NATION_SCORE_QUERY, {"id": [nation_id]}),
            pnw_api.gql(pnw_api.OFFENSIVE_WARS_QUERY, {"attid": [nation_id]}),
        )
    except pnw_api.PnwGraphQLError as e:
        return JSONResponse(status_code=502, content={"error": f"PnW API error: {e}"})

    nations_list = nation_data["nations"]["data"]
    if not nations_list:
        return JSONResponse(status_code=404, content={"error": f"Nation #{nation_id} not found"})
    your_nation = nations_list[0]
    your_score = your_nation["score"]
    your_leader = your_nation["leader_name"]
    your_discord = your_nation.get("discord")
    min_score = math.floor(your_score * 0.75)
    max_score = math.ceil(your_score * 4 / 3)
    at_war_with = {int(w["def_id"]) for w in wars_data["wars"]["data"]}

    # 4. Fetch enemy alliance members (allSettled equivalent)
    results = await asyncio.gather(
        *[pnw_api.gql(pnw_api.ENEMY_MEMBERS_QUERY, {"alliance_id": [aid]}) for aid in enemy_ids],
        return_exceptions=True,
    )
    succeeded = [r for r in results if not isinstance(r, Exception)]
    if not succeeded:
        return JSONResponse(status_code=502, content={"error": "PnW API error: all alliance queries failed"})
    all_enemies: list[dict] = []
    for r in succeeded:
        all_enemies.extend(r["nations"]["data"])

    # 5. Filter
    filtered = [
        n for n in all_enemies
        if min_score <= n["score"] <= max_score
        and int(n["id"]) not in at_war_with
        and n["defensive_wars_count"] < 3
        and n["vacation_mode_turns"] == 0
        and n["beige_turns"] == 0
    ]

    # 6. Beige loot history (capped at 5 pages, last 30 days)
    prices = load_trade_prices(request.app.state.db)
    target_ids = [int(n["id"]) for n in filtered]
    target_id_set = set(target_ids)
    beige_map: dict[int, dict] = {}

    if target_ids:
        after = _beige_after_date(30)
        try:
            for page in range(1, 6):
                beige_data = await pnw_api.gql(
                    pnw_api.BEIGE_WARS_QUERY,
                    {"ids": target_ids, "after": after, "page": page},
                )
                wars = beige_data["wars"]["data"]
                for w in wars:
                    if w["winner_id"] == "0":
                        continue
                    loser_id = int(w["def_id"]) if w["winner_id"] == w["att_id"] else int(w["att_id"])
                    if loser_id not in target_id_set:
                        continue
                    loot = attack_loot_value(w["attacks"], prices)
                    existing = beige_map.get(loser_id)
                    if not existing:
                        beige_map[loser_id] = {"loot": loot, "date": w["date"], "all_loots": [loot]}
                    else:
                        existing["all_loots"].append(loot)
                        if w["date"] > existing["date"]:
                            existing["loot"] = loot
                            existing["date"] = w["date"]
                if len(wars) < 500:
                    break
        except pnw_api.PnwGraphQLError:
            # Beige loot is best-effort; swallow and continue
            pass

    targets = []
    for n in filtered:
        beige = beige_map.get(int(n["id"]))
        targets.append({
            "id": int(n["id"]),
            "nation_name": n["nation_name"],
            "leader_name": n["leader_name"],
            "alliance_name": (n.get("alliance") or {}).get("name") or "Unknown",
            "score": n["score"],
            "num_cities": n["num_cities"],
            "avg_infra": _avg_infra(n["cities"]),
            "soldiers": n["soldiers"],
            "tanks": n["tanks"],
            "aircraft": n["aircraft"],
            "ships": n["ships"],
            "offensive_wars_count": n["offensive_wars_count"],
            "defensive_wars_count": n["defensive_wars_count"],
            "vacation_mode_turns": n["vacation_mode_turns"],
            "beige_turns": n["beige_turns"],
            "beige_loot": beige["loot"] if beige else None,
            "beige_date": beige["date"] if beige else None,
            "beige_avg": (
                round(sum(beige["all_loots"]) / len(beige["all_loots"])) if beige else None
            ),
            "beige_count": len(beige["all_loots"]) if beige else None,
            "last_active": n["last_active"],
        })
    targets.sort(key=lambda t: t["avg_infra"], reverse=True)

    # 7. nationInAlliance: does the requested nation exist in nations OR applicants?
    conn = request.app.state.db
    row = conn.execute(
        "SELECT id FROM nations WHERE id = ? "
        "UNION SELECT id FROM applicants WHERE id = ? "
        "LIMIT 1",
        (nation_id, nation_id),
    ).fetchone()
    nation_in_alliance = row is not None

    return {
        "targets": targets,
        "yourScore": your_score,
        "minScore": min_score,
        "maxScore": max_score,
        "yourLeader": your_leader,
        "yourDiscord": your_discord,
        "nationInAlliance": nation_in_alliance,
    }
```

- [ ] **Step 5: Register router in main.py**

Edit `flet-pnwdata/server/main.py`. Update the router includes block:

```python
    from server.routes import data as data_routes
    from server.routes import sync as sync_routes
    from server.routes import war_targets as war_targets_routes
    app.include_router(data_routes.router)
    app.include_router(sync_routes.router)
    app.include_router(war_targets_routes.router)
```

- [ ] **Step 6: Run tests, verify pass**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_war_targets.py -v
```
Expected: 8 passed.

- [ ] **Step 7: Full suite check**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -v
```
Expected: 61 passed (53 + 8).

- [ ] **Step 8: No commit.**

---

### Task 8: `GET /api/beigeWatch`

Very similar to `/api/warTargets` but:
- `nationId` is OPTIONAL (omitted → no score range, `inRange` field is `null` on each target)
- Filters only to `beige_turns > 0` (no score range filter, no VM filter, no def-wars filter)
- Beige loot looks back 90 days (not 30)
- Sorts by `beige_turns` ascending (lowest first — those exit beige soonest)

**Files:**
- Create: `flet-pnwdata/server/routes/beige_watch.py`
- Modify: `flet-pnwdata/server/main.py`
- Test: `flet-pnwdata/tests/test_routes_beige_watch.py`

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_routes_beige_watch.py`:

```python
import json
import pytest
import respx
from pathlib import Path


def _enemy_member(nid: int, *, beige: int, score: float = 1000.0) -> dict:
    return {
        "id": nid, "nation_name": f"target{nid}", "leader_name": f"leader{nid}",
        "score": score, "num_cities": 5,
        "alliance": {"name": "Bad Guys"},
        "cities": [{"infrastructure": 1500}] * 5,
        "soldiers": 10000, "tanks": 500, "aircraft": 20, "ships": 5,
        "offensive_wars_count": 0, "defensive_wars_count": 0,
        "vacation_mode_turns": 0, "beige_turns": beige,
        "last_active": "2026-05-22T00:00:00+00:00",
    }


def _write_war_config(tmp_path: Path, ids: list[int]) -> str:
    cfg = tmp_path / "war-config.json"
    cfg.write_text(json.dumps({"enemy_alliance_ids": ids}))
    return str(cfg)


@pytest.mark.asyncio
async def test_returns_only_beige_nations_no_score_range(app_client, tmp_path, monkeypatch):
    """Without nationId, return all beige nations, inRange=null."""
    client, _ = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", _write_war_config(tmp_path, [100]))

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                # ENEMY_MEMBERS
                respx.MockResponse(json={"data": {"nations": {"data": [
                    _enemy_member(1, beige=3),
                    _enemy_member(2, beige=0),   # excluded — not beige
                    _enemy_member(3, beige=5),
                ]}}}),
                # BEIGE_WARS empty
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
            ]
        )
        resp = await client.get("/api/beigeWatch")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["nations"]) == 2
    # Sorted by beige_turns ascending
    assert body["nations"][0]["id"] == 1
    assert body["nations"][1]["id"] == 3
    assert all(n["inRange"] is None for n in body["nations"])
    # No yourScore fields when no nationId
    assert "yourScore" not in body or body.get("yourScore") is None


@pytest.mark.asyncio
async def test_returns_score_range_when_nationId_given(app_client, tmp_path, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", _write_war_config(tmp_path, [100]))

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                # ENEMY_MEMBERS
                respx.MockResponse(json={"data": {"nations": {"data": [
                    _enemy_member(1, beige=3, score=900.0),   # in range
                    _enemy_member(2, beige=3, score=2000.0),  # out of range
                ]}}}),
                # NATION_SCORE (yourScore=1000)
                respx.MockResponse(json={"data": {"nations": {"data": [{
                    "score": 1000.0, "leader_name": "Me", "discord": "me",
                }]}}}),
                # BEIGE_WARS empty
                respx.MockResponse(json={"data": {"wars": {"data": []}}}),
            ]
        )
        resp = await client.get("/api/beigeWatch?nationId=42")

    assert resp.status_code == 200
    body = resp.json()
    assert body["yourScore"] == 1000.0
    assert body["minScore"] == 750
    assert body["maxScore"] == 1334
    # Both kept (no score filter on data set), but inRange flag set per-row
    ids_in_range = {n["id"]: n["inRange"] for n in body["nations"]}
    assert ids_in_range[1] is True
    assert ids_in_range[2] is False


@pytest.mark.asyncio
async def test_returns_400_on_invalid_nationId(app_client):
    client, _ = app_client
    resp = await client.get("/api/beigeWatch?nationId=abc")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_returns_500_on_missing_war_config(app_client, tmp_path, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", str(tmp_path / "missing.json"))
    resp = await client.get("/api/beigeWatch")
    assert resp.status_code == 500


@pytest.mark.asyncio
async def test_returns_502_when_all_alliance_queries_fail(app_client, tmp_path, monkeypatch):
    client, _ = app_client
    monkeypatch.setenv("WAR_CONFIG_PATH", _write_war_config(tmp_path, [100, 200]))

    with respx.mock() as mock:
        mock.post("https://api.politicsandwar.com/graphql").mock(
            side_effect=[
                respx.MockResponse(status_code=500),
                respx.MockResponse(status_code=500),
            ]
        )
        resp = await client.get("/api/beigeWatch")
    assert resp.status_code == 502
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_beige_watch.py -v
```
Expected: All 404 (router not registered).

- [ ] **Step 3: Implement beige_watch.py**

Create `flet-pnwdata/server/routes/beige_watch.py`:

```python
"""GET /api/beigeWatch — list enemy nations currently on beige.

Ports src/app/api/beigeWatch/route.ts. nationId is optional; if given,
attaches score range to the response and per-row `inRange` flags.
"""
from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from server import pnw_api
from server.prices import attack_loot_value, load_trade_prices
from server.war_config import WarConfigError, enemy_alliance_ids, load_war_config

router = APIRouter()


def _war_config_path() -> str:
    return os.environ.get("WAR_CONFIG_PATH", "data/war-config.json")


def _avg_infra(cities: list[dict]) -> int:
    if not cities:
        return 0
    return round(sum(c["infrastructure"] for c in cities) / len(cities))


def _beige_after_date(days_ago: int) -> str:
    d = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return f"{d.year:04d}-{d.month:02d}-{d.day:02d} 00:00:00"


@router.get("/api/beigeWatch")
async def get_beige_watch(request: Request):
    if not os.environ.get("PNW_API_KEY"):
        return JSONResponse(status_code=500, content={"error": "PNW_API_KEY is not configured"})

    # 1. Optional nationId
    nation_id_str = request.query_params.get("nationId")
    nation_id: int | None = None
    if nation_id_str is not None:
        try:
            nation_id = int(nation_id_str)
        except (TypeError, ValueError):
            return JSONResponse(status_code=400, content={"error": "nationId must be a positive integer"})
        if nation_id <= 0:
            return JSONResponse(status_code=400, content={"error": "nationId must be a positive integer"})

    # 2. War config
    try:
        config = load_war_config(_war_config_path())
        enemy_ids = enemy_alliance_ids(config)
    except WarConfigError as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

    # 3. Enemy members
    results = await asyncio.gather(
        *[pnw_api.gql(pnw_api.ENEMY_MEMBERS_QUERY, {"alliance_id": [aid]}) for aid in enemy_ids],
        return_exceptions=True,
    )
    succeeded = [r for r in results if not isinstance(r, Exception)]
    if not succeeded:
        return JSONResponse(status_code=502, content={"error": "PnW API error: all alliance queries failed"})
    all_enemies: list[dict] = []
    for r in succeeded:
        all_enemies.extend(r["nations"]["data"])

    beige_nations = [n for n in all_enemies if n["beige_turns"] > 0]

    # 4. Optional your-nation score range
    your_score = your_leader = your_discord = None
    min_score = max_score = None
    if nation_id is not None:
        try:
            data = await pnw_api.gql(pnw_api.NATION_SCORE_QUERY, {"id": [nation_id]})
        except pnw_api.PnwGraphQLError as e:
            return JSONResponse(status_code=502, content={"error": f"PnW API error: {e}"})
        nl = data["nations"]["data"]
        if not nl:
            return JSONResponse(status_code=404, content={"error": f"Nation #{nation_id} not found"})
        your_score = nl[0]["score"]
        your_leader = nl[0]["leader_name"]
        your_discord = nl[0].get("discord")
        min_score = math.floor(your_score * 0.75)
        max_score = math.ceil(your_score * 4 / 3)

    # 5. Beige loot history (capped at 5 pages, last 90 days)
    prices = load_trade_prices(request.app.state.db)
    target_ids = [int(n["id"]) for n in beige_nations]
    target_id_set = set(target_ids)
    beige_map: dict[int, dict] = {}

    if target_ids:
        after = _beige_after_date(90)
        try:
            for page in range(1, 6):
                bd = await pnw_api.gql(
                    pnw_api.BEIGE_WARS_QUERY,
                    {"ids": target_ids, "after": after, "page": page},
                )
                wars = bd["wars"]["data"]
                for w in wars:
                    if w["winner_id"] == "0":
                        continue
                    loser_id = int(w["def_id"]) if w["winner_id"] == w["att_id"] else int(w["att_id"])
                    if loser_id not in target_id_set:
                        continue
                    loot = attack_loot_value(w["attacks"], prices)
                    ex = beige_map.get(loser_id)
                    if not ex:
                        beige_map[loser_id] = {"loot": loot, "date": w["date"], "all_loots": [loot]}
                    else:
                        ex["all_loots"].append(loot)
                        if w["date"] > ex["date"]:
                            ex["loot"] = loot
                            ex["date"] = w["date"]
                if len(wars) < 500:
                    break
        except pnw_api.PnwGraphQLError:
            pass

    nations = []
    for n in beige_nations:
        b = beige_map.get(int(n["id"]))
        in_range = (
            (min_score <= n["score"] <= max_score)
            if min_score is not None and max_score is not None
            else None
        )
        nations.append({
            "id": int(n["id"]),
            "nation_name": n["nation_name"],
            "leader_name": n["leader_name"],
            "alliance_name": (n.get("alliance") or {}).get("name") or "Unknown",
            "score": n["score"],
            "num_cities": n["num_cities"],
            "avg_infra": _avg_infra(n["cities"]),
            "beige_turns": n["beige_turns"],
            "soldiers": n["soldiers"],
            "tanks": n["tanks"],
            "aircraft": n["aircraft"],
            "ships": n["ships"],
            "offensive_wars_count": n["offensive_wars_count"],
            "defensive_wars_count": n["defensive_wars_count"],
            "inRange": in_range,
            "beige_loot": b["loot"] if b else None,
            "beige_date": b["date"] if b else None,
            "beige_avg": round(sum(b["all_loots"]) / len(b["all_loots"])) if b else None,
            "beige_count": len(b["all_loots"]) if b else None,
        })
    nations.sort(key=lambda x: x["beige_turns"])

    response: dict = {"nations": nations}
    if your_score is not None:
        response["yourScore"] = your_score
        response["minScore"] = min_score
        response["maxScore"] = max_score
        response["yourLeader"] = your_leader
        response["yourDiscord"] = your_discord
    return response
```

- [ ] **Step 4: Register router in main.py**

Edit `flet-pnwdata/server/main.py`. Update the router-includes block:

```python
    from server.routes import data as data_routes
    from server.routes import sync as sync_routes
    from server.routes import war_targets as war_targets_routes
    from server.routes import beige_watch as beige_watch_routes
    app.include_router(data_routes.router)
    app.include_router(sync_routes.router)
    app.include_router(war_targets_routes.router)
    app.include_router(beige_watch_routes.router)
```

- [ ] **Step 5: Run tests, verify pass**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_beige_watch.py -v
```
Expected: 5 passed.

- [ ] **Step 6: Full suite check**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -v
```
Expected: 66 passed (61 + 5).

- [ ] **Step 7: No commit.**

---

### Task 9: `GET /api/export?type=<table>` — Excel download

For each list type (`members`, `applicants`, `wars`, `bankrecs`, `bknet_members`), generate an `.xlsx` workbook with rows pulled from SQLite. Returns the workbook as a streamed download with `Content-Disposition: attachment; filename=<type>.xlsx`.

Singleton types and `status` are not exportable — return 400 (a one-row Excel of a singleton is not useful, and the Flet client doesn't need it).

**Files:**
- Create: `flet-pnwdata/server/routes/export.py`
- Modify: `flet-pnwdata/server/main.py`
- Test: `flet-pnwdata/tests/test_routes_export.py`

- [ ] **Step 1: Write the failing test**

Create `flet-pnwdata/tests/test_routes_export.py`:

```python
import io
import json
import pytest
from openpyxl import load_workbook


@pytest.mark.asyncio
async def test_export_members_returns_xlsx_with_rows(app_client):
    client, app = app_client
    app.state.db.execute(
        "INSERT INTO nations (id, data, updated_at) VALUES (?, ?, ?)",
        (1, json.dumps({"id": 1, "nation_name": "Alpha", "score": 100.0}), 0),
    )
    app.state.db.execute(
        "INSERT INTO nations (id, data, updated_at) VALUES (?, ?, ?)",
        (2, json.dumps({"id": 2, "nation_name": "Beta", "score": 200.0}), 0),
    )
    resp = await client.get("/api/export?type=members")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "members.xlsx" in resp.headers["content-disposition"]

    wb = load_workbook(io.BytesIO(resp.content))
    ws = wb.active
    # Header row + 2 data rows
    assert ws.max_row == 3
    headers = [c.value for c in ws[1]]
    assert "id" in headers and "nation_name" in headers and "score" in headers


@pytest.mark.asyncio
async def test_export_empty_table_returns_header_only_xlsx(app_client):
    client, _ = app_client
    resp = await client.get("/api/export?type=members")
    assert resp.status_code == 200
    wb = load_workbook(io.BytesIO(resp.content))
    ws = wb.active
    # Header row only (or empty workbook with single dummy row)
    assert ws.max_row in (1, 0)


@pytest.mark.asyncio
async def test_export_unknown_type_returns_400(app_client):
    client, _ = app_client
    resp = await client.get("/api/export?type=nope")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_export_singleton_type_returns_400(app_client):
    """Singletons like alliance are not exportable."""
    client, _ = app_client
    resp = await client.get("/api/export?type=alliance")
    assert resp.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("table,type_key", [
    ("nations", "members"),
    ("applicants", "applicants"),
    ("wars", "wars"),
    ("bankrecs", "bankrecs"),
    ("bknet_members", "bknet_members"),
])
async def test_each_list_type_exports(app_client, table, type_key):
    client, app = app_client
    # bknet_members has a nested shape; we just check the route works.
    payload = {"id": 1} if table != "bknet_members" else {"nation": {"id": 1, "name": "x"}}
    app.state.db.execute(
        f"INSERT INTO {table} (id, data, updated_at) VALUES (?, ?, ?)",
        (1, json.dumps(payload), 0),
    )
    resp = await client.get(f"/api/export?type={type_key}")
    assert resp.status_code == 200
    wb = load_workbook(io.BytesIO(resp.content))
    assert wb.active.max_row >= 1
```

- [ ] **Step 2: Run test, verify it fails**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_export.py -v
```
Expected: 404 on every route.

- [ ] **Step 3: Implement export.py**

Create `flet-pnwdata/server/routes/export.py`:

```python
"""GET /api/export?type=<table> — stream a .xlsx of the requested table.

Reads JSON rows from SQLite, flattens any nested keys with a `.` joiner,
and writes one row per record. Header row is the union of top-level keys
across all rows (consistent order — keys discovered first appear first).
"""
from __future__ import annotations

import io
import json
from typing import Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response
from openpyxl import Workbook


router = APIRouter()

EXPORTABLE = {
    "members": "nations",
    "applicants": "applicants",
    "wars": "wars",
    "bankrecs": "bankrecs",
    "bknet_members": "bknet_members",
}


def _flatten(d: dict, prefix: str = "") -> dict[str, Any]:
    """Flatten nested dicts by joining keys with '.'. Lists are JSON-encoded."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, prefix=f"{key}."))
        elif isinstance(v, list):
            out[key] = json.dumps(v)
        else:
            out[key] = v
    return out


def _rows_for(conn, table: str) -> list[dict]:
    rows = conn.execute(f"SELECT data FROM {table}").fetchall()
    return [_flatten(json.loads(r[0])) for r in rows]


def _build_workbook(rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"

    # Build column order: preserve first-seen order across rows
    columns: list[str] = []
    seen: set[str] = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                columns.append(k)
                seen.add(k)

    if columns:
        ws.append(columns)
        for r in rows:
            ws.append([r.get(c, "") for c in columns])

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/api/export")
async def export_table(request: Request, type: str = Query(...)):
    if type not in EXPORTABLE:
        return JSONResponse(status_code=400, content={"error": "Unknown or non-exportable type"})

    rows = _rows_for(request.app.state.db, EXPORTABLE[type])
    xlsx_bytes = _build_workbook(rows)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{type}.xlsx"'},
    )
```

- [ ] **Step 4: Register router**

Edit `flet-pnwdata/server/main.py`. Update the router-includes block:

```python
    from server.routes import data as data_routes
    from server.routes import sync as sync_routes
    from server.routes import war_targets as war_targets_routes
    from server.routes import beige_watch as beige_watch_routes
    from server.routes import export as export_routes
    app.include_router(data_routes.router)
    app.include_router(sync_routes.router)
    app.include_router(war_targets_routes.router)
    app.include_router(beige_watch_routes.router)
    app.include_router(export_routes.router)
```

- [ ] **Step 5: Run tests, verify pass**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest tests/test_routes_export.py -v
```
Expected: 9 passed (4 individual + 5 parametrized).

- [ ] **Step 6: Full suite check**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/pytest -v
```
Expected: 75 passed (66 + 9).

- [ ] **Step 7: No commit.**

---

### Task 10: Manual smoke test against live PnW

This is the second manual smoke test (the first was at the end of Plan 1). No automated coverage.

- [ ] **Step 1: Ensure data/war-config.json has real enemy alliance IDs**

Edit `flet-pnwdata/data/war-config.json` and populate `enemy_alliance_ids` with at least one real PnW alliance ID:

```json
{
  "enemy_alliance_ids": [1234],
  "ally_alliance_ids": []
}
```

(Replace `1234` with an actual alliance ID. You can copy from the existing Next.js project's `data/war-config.json` if available.)

- [ ] **Step 2: Start the server**

Run:
```bash
cd /home/devin/dev/pnwdata/flet-pnwdata && .venv/bin/uvicorn server.main:app --port 8000
```

Wait for the lifespan to complete and the first sync to land. The server should be ready in ~10 seconds.

- [ ] **Step 3: Hit warTargets with your own nationId**

In another terminal:
```bash
curl -s "http://localhost:8000/api/warTargets?nationId=YOUR_NATION_ID" | jq '{ count: (.targets | length), yourScore, yourLeader, minScore, maxScore }'
```

Expected:
- `count` > 0 (assuming there are enemies in your score range)
- `yourScore` matches your nation's actual score
- `yourLeader` matches your nation's leader name
- `minScore`/`maxScore` flank `yourScore` (75%–133%)

- [ ] **Step 4: Hit beigeWatch**

```bash
curl -s "http://localhost:8000/api/beigeWatch" | jq '.nations | length'
curl -s "http://localhost:8000/api/beigeWatch?nationId=YOUR_NATION_ID" | jq '.nations | map(select(.inRange == true)) | length'
```

Expected:
- First call returns total beige-nations count
- Second call returns count of in-range beige nations (subset of the first)

- [ ] **Step 5: Download an export**

```bash
curl -s -o /tmp/members.xlsx "http://localhost:8000/api/export?type=members"
file /tmp/members.xlsx
```

Expected: `members.xlsx` is reported as `Microsoft OOXML` (or similar Excel/ZIP magic).

Open `/tmp/members.xlsx` in LibreOffice/Excel to confirm it has data.

- [ ] **Step 6: Compare against Next.js for shape parity**

With `npm run dev` running on port 3000 in the original project:

```bash
curl -s "http://localhost:3000/api/warTargets?nationId=YOUR_NATION_ID" | jq '.targets | length'
curl -s "http://localhost:8000/api/warTargets?nationId=YOUR_NATION_ID" | jq '.targets | length'
```

Counts should be similar (may differ slightly if a war was declared between the two calls). The JSON shapes should be identical.

- [ ] **Step 7: Stop the server with Ctrl-C**

Verify clean shutdown — no traceback in logs.

- [ ] **Step 8: No commit.**

---

## Spec Coverage Check

| Spec requirement | Covered by |
|---|---|
| `GET /api/warTargets?nationId=…` | Task 7 |
| `GET /api/beigeWatch?nationId=…` (optional nationId) | Task 8 |
| 30-day / 5-page beige-loot cap (commit cf39dd9) | Task 7 (`_beige_after_date(30)`, 5-page loop) |
| 90-day beige-loot history for beigeWatch | Task 8 (`_beige_after_date(90)`) |
| Retry-on-429 with exponential backoff | Task 3 |
| `data/war-config.json` reader + validation | Task 2 |
| Trade-prices loader + loot valuation (shared) | Task 4 |
| `GET /api/export?type=<table>` returning `.xlsx` | Task 9 |
| Live response models in `shared/` | Task 5 |
| New GraphQL queries (NATION_SCORE, OFFENSIVE_WARS, ENEMY_MEMBERS, BEIGE_WARS) | Task 6 |
| openpyxl dependency | Task 1 |
| Smoke test against live PnW | Task 10 |

Deferred (per spec — covered by later plans):
- `/api/conflictStats` — doesn't exist in current Next.js; removed from plan
- Auth gating on POST /api/sync, /api/role-config, /api/war-config — Plan 3
- `/api/role-config`, `/api/war-config` admin endpoints — Plan 3
- Flet client work — Plans 4–9

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-flet-pnwdata-live-endpoints.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
