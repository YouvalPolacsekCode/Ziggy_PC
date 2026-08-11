"""Only Ziggy staff may reach the ops console.

`super_admin` is not a restriction here: every customer is super_admin of their
OWN hub, so gating on the role alone puts a fleet console on David's and Tslil's
boxes. The fleet DATA sits behind a separate relay login either way, but the
surface should not exist for them at all.
"""

import pytest

from backend.routers import ops_router


@pytest.fixture(autouse=True)
def _default_founders(monkeypatch):
    monkeypatch.delenv("ZIGGY_FOUNDER_EMAILS", raising=False)
    yield


async def _call(user):
    """Run the founder dependency the way FastAPI would, minus the DI wiring."""
    return await ops_router.require_founder(user=user)


class TestWhoMayEnter:
    @pytest.mark.asyncio
    async def test_the_founder_is_allowed(self):
        assert await _call({"role": "super_admin", "email": "silentyouval@gmail.com"})

    @pytest.mark.asyncio
    async def test_case_and_padding_do_not_matter(self):
        assert await _call({"role": "super_admin", "email": "  SilentYouval@Gmail.com "})

    @pytest.mark.asyncio
    async def test_a_username_may_carry_the_identity(self):
        """Hub accounts predate the email column; some carry it as username."""
        assert await _call({"role": "super_admin", "username": "silentyouval@gmail.com"})

    @pytest.mark.asyncio
    async def test_a_customer_who_owns_their_own_hub_is_refused(self):
        """David is super_admin on his own box. That must not be enough."""
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as e:
            await _call({"role": "super_admin", "email": "davidpolacsek@gmail.com"})
        assert e.value.status_code == 403
        assert "staff" in e.value.detail.lower()

    @pytest.mark.asyncio
    async def test_the_relay_is_allowed_through(self):
        """The fleet console and the remediator reach a hub as relay_admin."""
        assert await _call({"role": "relay_admin", "email": "fleet-remediator@ziggy"})

    @pytest.mark.asyncio
    async def test_an_anonymous_looking_user_is_refused(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            await _call({"role": "super_admin"})


class TestAllowListIsConfigurable:
    @pytest.mark.asyncio
    async def test_env_replaces_the_default(self, monkeypatch):
        monkeypatch.setenv("ZIGGY_FOUNDER_EMAILS", "ops@ziggy.dev, second@ziggy.dev")
        assert await _call({"role": "super_admin", "email": "second@ziggy.dev"})

        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            # The built-in default no longer applies once the env names a list.
            await _call({"role": "super_admin", "email": "silentyouval@gmail.com"})

    @pytest.mark.asyncio
    async def test_an_empty_env_falls_back_to_the_default(self, monkeypatch):
        """A blank value must not lock the founder out of his own console."""
        monkeypatch.setenv("ZIGGY_FOUNDER_EMAILS", "   ")
        assert await _call({"role": "super_admin", "email": "silentyouval@gmail.com"})


class TestEveryEndpointIsGated:
    def test_no_ops_route_settles_for_super_admin(self):
        """A new endpoint added here must not quietly ship on the weaker gate."""
        import inspect
        src = inspect.getsource(ops_router)
        body = src.split("router = APIRouter", 1)[1]
        # whoami is the one deliberate exception: it must answer for non-founders
        # so the UI can redirect them instead of rendering a console that 403s.
        route_deps = [ln for ln in body.splitlines() if "Depends(require_role(" in ln]
        assert len(route_deps) == 2, (
            "expected exactly two require_role uses (require_founder's own "
            f"super_admin base, and whoami); found: {route_deps}"
        )
