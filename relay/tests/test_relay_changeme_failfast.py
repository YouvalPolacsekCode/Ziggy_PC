"""Stream 3 — prod boot refuses dev-default secrets.

Covers relay/app/config_guard.assert_prod_secrets():
  * prod + changeme/unset RELAY_JWT_SECRET or RELAY_ADMIN_PASSWORD → raises
  * prod + strong secrets → OK
  * dev (no ZIGGY_ENV/FLY_APP_NAME) → never raises, even with changeme
  * FLY_APP_NAME alone counts as prod
"""

from __future__ import annotations

import pytest

from relay.app.config_guard import assert_prod_secrets, check_prod_secrets, is_prod

STRONG_JWT = "a" * 40
STRONG_PW = "correct horse battery staple"


def _env(**over):
    base = {}
    base.update(over)
    return base


def test_is_prod_detection():
    assert is_prod(_env(ZIGGY_ENV="prod")) is True
    assert is_prod(_env(FLY_APP_NAME="ziggy-relay")) is True
    assert is_prod(_env()) is False
    assert is_prod(_env(ZIGGY_ENV="dev")) is False


def test_prod_changeme_jwt_raises():
    with pytest.raises(RuntimeError) as e:
        assert_prod_secrets(_env(ZIGGY_ENV="prod", RELAY_JWT_SECRET="changeme",
                                 RELAY_ADMIN_PASSWORD=STRONG_PW))
    assert "RELAY_JWT_SECRET" in str(e.value)


def test_prod_unset_jwt_raises():
    with pytest.raises(RuntimeError):
        assert_prod_secrets(_env(ZIGGY_ENV="prod", RELAY_ADMIN_PASSWORD=STRONG_PW))


def test_prod_short_jwt_raises():
    with pytest.raises(RuntimeError):
        assert_prod_secrets(_env(ZIGGY_ENV="prod", RELAY_JWT_SECRET="short",
                                 RELAY_ADMIN_PASSWORD=STRONG_PW))


def test_prod_changeme_admin_pw_raises():
    with pytest.raises(RuntimeError) as e:
        assert_prod_secrets(_env(ZIGGY_ENV="prod", RELAY_JWT_SECRET=STRONG_JWT,
                                 RELAY_ADMIN_PASSWORD="changeme"))
    assert "RELAY_ADMIN_PASSWORD" in str(e.value)


def test_prod_strong_secrets_ok():
    assert_prod_secrets(_env(ZIGGY_ENV="prod", RELAY_JWT_SECRET=STRONG_JWT,
                             RELAY_ADMIN_PASSWORD=STRONG_PW))  # no raise


def test_fly_app_name_counts_as_prod():
    with pytest.raises(RuntimeError):
        assert_prod_secrets(_env(FLY_APP_NAME="ziggy-relay", RELAY_JWT_SECRET="changeme",
                                 RELAY_ADMIN_PASSWORD=STRONG_PW))


def test_dev_never_raises_even_with_changeme():
    # No ZIGGY_ENV / FLY_APP_NAME → dev → guard is a no-op.
    assert_prod_secrets(_env(RELAY_JWT_SECRET="changeme", RELAY_ADMIN_PASSWORD="changeme"))


def test_check_reports_both_problems():
    problems = check_prod_secrets(_env(RELAY_JWT_SECRET="", RELAY_ADMIN_PASSWORD=""))
    assert len(problems) == 2
