"""
orchestrator.py — AI reasoning layer using Llama-3.3-70b via Groq API.

Groq runs on custom LPU hardware: ~300 tokens/s, 1-2s response vs 2-4min on CPU.
Free tier: 30 RPM, no credit card. Sign up at console.groq.com.

Tool calling uses OpenAI-compatible format (Groq is OpenAI API compatible).
"""

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import openai

from edgemind_server.correlation_filter import CorrelatedSignalBundle
from edgemind_server.dependency_graph import DependencyGraph
from edgemind_server.tools import TOOL_DEFINITIONS, execute_tool

log = logging.getLogger(__name__)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
MAX_TOOL_TURNS = 4


@dataclass
class OrchestratorResult:
    root_cause_pod: str
    causal_chain: List[str]
    alert_type: str
    confidence: float
    insight: str
    recommendation: str
    tool_calls_made: List[str] = field(default_factory=list)
    analysis_duration_s: float = 0.0
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        return {
            "root_cause_pod": self.root_cause_pod,
            "causal_chain": self.causal_chain,
            "alert_type": self.alert_type,
            "confidence": self.confidence,
            "insight": self.insight,
            "recommendation": self.recommendation,
            "tool_calls_made": self.tool_calls_made,
            "analysis_duration_s": round(self.analysis_duration_s, 1),
            "timestamp": self.timestamp,
        }

    def confidence_label(self) -> str:
        if self.confidence >= 0.9:
            return "HIGH"
        elif self.confidence >= 0.7:
            return "MEDIUM-HIGH"
        elif self.confidence >= 0.5:
            return "MEDIUM"
        else:
            return "LOW — flagged for manual investigation"


SYSTEM_PROMPT_TEMPLATE = """You are EdgeMind, an AI orchestrator for industrial pump station monitoring on ABB Edgenius.

Your job is to analyze correlated anomaly findings from monitoring agents and identify the ROOT CAUSE.

{dependency_graph}

CONFIDENCE SCORING:
- >= 0.9: Multi-agent agreement AND temporal ordering matches pipeline topology
- 0.7-0.9: Two agents agree, causal chain plausible
- 0.5-0.7: Single agent or ambiguous
- < 0.5: Insufficient evidence — flag for manual investigation

INVESTIGATION STEPS:
1. Read findings — what pods are affected and what anomaly types?
2. Use query_prometheus to check pods in the causal chain
3. Use get_pod_logs to confirm error causes
4. Use get_kubernetes_events if lifecycle issues suspected

ALERT TYPES:
- "cascade": fault propagated downstream (e.g. sensor flood → collector → historian)
- "contention": two pods competing for same resource
- "lifecycle": OOMKill, crash loop, eviction

You MUST end your response with a JSON block in this exact format:
```json
{
  "root_cause_pod": "<pod name>",
  "causal_chain": ["<pod1>", "<pod2>", "<pod3>"],
  "alert_type": "cascade|contention|lifecycle",
  "confidence": 0.0,
  "insight": "<2-3 sentences in plain English for a field engineer>",
  "recommendation": "<1 sentence action>"
}
```

OPERATOR LANGUAGE — use these names in insight:
- sensor-sim-1/2/3 → "Pump 1/2/3 sensor"
- opc-ua-collector → "data collection service"
- data-historian-influxdb2 → "data historian"
- feature-extractor → "feature computation service"
- health-scorer → "health scoring service"
- alert-manager → "alert service"
- batch-sync → "bulk export service"
"""


class Orchestrator:
    def __init__(self, dependency_graph: DependencyGraph):
        self._graph = dependency_graph
        self._client = openai.OpenAI(
            api_key=GROQ_API_KEY,
            base_url="https://api.groq.com/openai/v1",
        )

    def _build_system_prompt(self) -> str:
        return SYSTEM_PROMPT_TEMPLATE.format(
            dependency_graph=self._graph.to_prompt_text()
        )

    def _build_user_message(self, bundle: CorrelatedSignalBundle) -> str:
        findings_text = json.dumps(bundle.findings, indent=2, default=str)
        return f"""CORRELATED ANOMALY BUNDLE:
Trigger reason: {bundle.trigger_reason}
Unique agents: {', '.join(bundle.unique_agents)}
Affected pods: {', '.join(bundle.unique_pods)}
Finding count: {len(bundle.findings)}
Severity counts: {bundle.severity_counts}

FINDINGS:
{findings_text}

Investigate this event. Use tools to gather context, then provide your analysis."""

    def _extract_json_result(self, content: str) -> Optional[Dict]:
        import re
        match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                pass
        try:
            start = content.rfind("{")
            end = content.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(content[start:end])
        except json.JSONDecodeError:
            pass
        return None

    def analyze(self, bundle: CorrelatedSignalBundle) -> OrchestratorResult:
        """Run full orchestrator analysis. Synchronous — call in thread pool."""
        start_time = time.time()
        self._graph.refresh()

        messages = [
            {"role": "system", "content": self._build_system_prompt()},
            {"role": "user", "content": self._build_user_message(bundle)},
        ]

        tool_calls_made = []
        final_content = ""

        for turn in range(MAX_TOOL_TURNS + 1):
            log.info("Orchestrator turn %d/%d", turn + 1, MAX_TOOL_TURNS + 1)
            try:
                response = self._client.chat.completions.create(
                    model=GROQ_MODEL,
                    messages=messages,
                    tools=TOOL_DEFINITIONS,
                    tool_choice="auto",
                    temperature=0.1,
                    max_tokens=2000,
                )
            except Exception as e:
                log.error("Groq API error: %s", e)
                break

            message = response.choices[0].message
            tool_calls = message.tool_calls or []
            content = message.content or ""

            # Append full assistant message (including tool_calls) to history
            messages.append(message)

            # No tool calls = final answer
            if not tool_calls:
                final_content = content
                break

            # Execute each tool call
            for tc in tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                log.info("Tool call: %s(%s)", tool_name, list(tool_args.keys()))
                tool_calls_made.append(tool_name)
                result = execute_tool(tool_name, tool_args)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

        duration = time.time() - start_time
        result_json = self._extract_json_result(final_content)

        if result_json:
            log.info(
                "Analysis complete: root_cause=%s confidence=%.2f duration=%.1fs",
                result_json.get("root_cause_pod"), result_json.get("confidence"), duration,
            )
            return OrchestratorResult(
                root_cause_pod=result_json.get("root_cause_pod", "unknown"),
                causal_chain=result_json.get("causal_chain", []),
                alert_type=result_json.get("alert_type", "cascade"),
                confidence=float(result_json.get("confidence", 0.5)),
                insight=result_json.get("insight", "Analysis complete."),
                recommendation=result_json.get("recommendation", "Investigate manually."),
                tool_calls_made=tool_calls_made,
                analysis_duration_s=duration,
            )
        else:
            log.warning("Could not parse orchestrator JSON result. Raw: %s", final_content[:200])
            return OrchestratorResult(
                root_cause_pod=bundle.unique_pods[0] if bundle.unique_pods else "unknown",
                causal_chain=bundle.unique_pods,
                alert_type="cascade",
                confidence=0.4,
                insight=f"Anomalies detected across {len(bundle.unique_pods)} pods. Manual investigation recommended.",
                recommendation="Review pod logs and Prometheus metrics for affected pods.",
                tool_calls_made=tool_calls_made,
                analysis_duration_s=duration,
            )

    def close(self):
        pass  # openai client has no explicit close