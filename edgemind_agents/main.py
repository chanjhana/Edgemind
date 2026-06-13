import asyncio
import logging
import os
import signal
import sys

import redis.asyncio as aioredis
from kubernetes import client as k8s_client, config as k8s_config

from edgemind_agents.anomaly_types import REDIS_URL, PROMETHEUS_URL
from edgemind_agents.collector import MetricCollector
from edgemind_agents.agents.cpu_agent import CPUAgent
from edgemind_agents.agents.memory_agent import MemoryAgent
from edgemind_agents.agents.storage_agent import StorageAgent
from edgemind_agents.agents.network_log_agent import NetworkLogAgent
from edgemind_agents.health_server import run_health_server

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)-8s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("edgemind.main")


async def run_with_restart(coro_func, name: str, delay_s: int = 5):
    while True:
        try:
            await coro_func()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error("[%s] crashed: %s: %s. Restarting in %ds.", name, type(e).__name__, e, delay_s)
            await asyncio.sleep(delay_s)


async def main():
    log.info("edgemind-agents starting")

    redis = aioredis.from_url(
        os.environ.get("REDIS_URL", REDIS_URL),
        decode_responses=True,
    )
    await redis.ping()
    log.info("Redis connected")

    try:
        k8s_config.load_incluster_config()
        log.info("Kubernetes in-cluster config loaded")
    except Exception:
        log.warning("In-cluster config failed — trying local kubeconfig")
        k8s_config.load_kube_config()
    k8s_v1 = k8s_client.CoreV1Api()

    queues = {
        "cpu":     asyncio.Queue(maxsize=1),
        "memory":  asyncio.Queue(maxsize=1),
        "storage": asyncio.Queue(maxsize=1),
        "network": asyncio.Queue(maxsize=1),
    }

    prometheus_url = os.environ.get("PROMETHEUS_URL", PROMETHEUS_URL)
    collector     = MetricCollector(queues, prometheus_url=prometheus_url)
    cpu_agent     = CPUAgent("cpu", queues["cpu"], redis)
    memory_agent  = MemoryAgent("memory", queues["memory"], redis)
    storage_agent = StorageAgent("storage", queues["storage"], redis, k8s_v1)
    network_agent = NetworkLogAgent("network_log", queues["network"], redis, k8s_v1)

    tasks = [
        asyncio.create_task(run_with_restart(collector.run,      "collector")),
        asyncio.create_task(run_with_restart(cpu_agent.run,      "cpu_agent")),
        asyncio.create_task(run_with_restart(memory_agent.run,   "memory_agent")),
        asyncio.create_task(run_with_restart(storage_agent.run,  "storage_agent")),
        asyncio.create_task(run_with_restart(network_agent.run,  "network_agent")),
        asyncio.create_task(run_health_server(port=8090)),
    ]

    shutdown_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown_event.set)

    log.info("edgemind-agents running — %d tasks", len(tasks))
    await shutdown_event.wait()

    log.info("Shutdown signal received. Cancelling tasks.")
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await redis.aclose()
    log.info("edgemind-agents stopped cleanly.")


if __name__ == "__main__":
    asyncio.run(main())
