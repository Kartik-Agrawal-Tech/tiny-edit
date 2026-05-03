import asyncio
from functools import lru_cache


async def fetch_user(user_id: int) -> dict:
    await asyncio.sleep(0)
    return {"id": user_id, "name": f"user_{user_id}"}


@lru_cache(maxsize=128)
def cached_value(key: str) -> int:
    return hash(key) & 0xFFFF


class Cache:
    def __init__(self):
        self.store: dict[str, int] = {}

    def get(self, key: str) -> int:
        return self.store.get(key, 0)

    async def set(self, key: str, value: int) -> None:
        self.store[key] = value
