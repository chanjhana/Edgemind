import asyncio
import json
import logging
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict

import redis.asyncio as aioredis

from edgemind_agents.anomaly_types import (
    REDIS_FINDINGS_KEY,
    FINDINGS_MAX_LEN,
    REDIS_HEARTBEAT_KEY,
)
from edgemind_agents.models import MetricSnapshot

log = logging.getLogger(__name__)


class BaseAgent(ABC):
    def __init__(self, name: str, queue: asyncio.Queue, redis: aioredis.Redis):
        self.name = name
        self.queue = queue
        self.redis = redis
        self._warmup_done = False

    async def publish_finding(self, finding: Dict[str, Any]) -> None:
        finding["finding_id"] = str(uuid.uuid4())
        finding["timestamp"] = datetime.now(timezone.utc).isoformat()
        finding["agent"] = self.name
        payload = json.dumps(finding)
        pipe = self.redis.pipeline()
        pipe.lpush(REDIS_FINDINGS_KEY, payload)
        pipe.ltrim(REDIS_FINDINGS_KEY, 0, FINDINGS_MAX_LEN - 1)
        await pipe.execute()
        log.info(
            "[%s] finding published: %s severity=%s pod=%s",
            self.name,
            finding.get("anomaly_type"),
            finding.get("severity"),
            finding.get("pod"),
        )

    async def heartbeat(self) -> None:
        key = REDIS_HEARTBEAT_KEY.format(agent=self.name)
        await self.redis.set(key, datetime.now(timezone.utc).isoformat(), ex=30)

    async def _heartbeat_loop(self) -> None:
        while True:
            try:
                await self.heartbeat()
            except Exception as e:
                log.warning("[%s] heartbeat failed: %s", self.name, e)
            await asyncio.sleep(10)

    @abstractmethod
    async def process(self, snapshot: MetricSnapshot) -> None:
        ...

    async def run(self) -> None:
        hb_task = asyncio.create_task(self._heartbeat_loop())
        try:
            while True:
                snapshot = await self.queue.get()
                try:
                    await self.process(snapshot)
                except Exception as e:
                    log.error("[%s] process error: %s", self.name, e, exc_info=True)
        finally:
            hb_task.cancel()
