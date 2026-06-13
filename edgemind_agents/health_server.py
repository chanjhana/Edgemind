import asyncio
import logging
from aiohttp import web

log = logging.getLogger(__name__)

_agent_status: dict = {}


def update_agent_status(agent_name: str, status: str) -> None:
    _agent_status[agent_name] = status


async def health_handler(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "agents": _agent_status,
    })


async def run_health_server(port: int = 8090) -> None:
    app = web.Application()
    app.router.add_get("/health", health_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    log.info("Health server running on :%d", port)
    await asyncio.Event().wait()
