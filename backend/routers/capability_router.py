from fastapi import APIRouter, HTTPException
from services.capability_catalog import get_catalog, get_capability, CATEGORIES

router = APIRouter()


@router.get("/api/capabilities")
async def get_capabilities():
    return {"capabilities": get_catalog(), "categories": CATEGORIES}


@router.get("/api/capabilities/{cap_id}")
async def get_capability_detail(cap_id: str):
    cap = get_capability(cap_id)
    if not cap:
        raise HTTPException(status_code=404, detail="Capability not found")
    return {"id": cap_id, **cap}
