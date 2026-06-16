"""
orchestrator.py — AI reasoning layer using OpenAI-compatible API.

Default model: gpt-5.4-nano ($0.20/M input, $1.25/M output, ~$0.002/call)
Prompt caching: automatic on OpenAI — static system prompt is cached after
first call, saving ~50% on input tokens for all subsequent calls.

Tool calling uses OpenAI Chat Completions format.
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

LLM_API_KEY = os.environ.get("LLM_API_KEY", os.environ.get("GROQ_API_KEY", ""))
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", os.environ.get("GROQ_MODEL", "gpt-5.4-mini"))
MAX_ANALYSIS_TIME_S = 60

# Static system prompt — no dynamic content so OpenAI can cache it automatically.
# The dependency graph moves to the user message (dynamic per-call context).
SYSTEM_PROMPT = """You are EdgeMind, an AI orchestrator for industrial pump station monitoring on ABB Edgenius.

Your job is to analyze correlated anomaly findings from monitoring agents and identify the ROOT CAUSE.

CONFIDENCE SCORING:
- >= 0.9: Multi-agent agreement AND temporal ordering matches pipeline topology
- 0.7-0.9: Two agents agree, causal chain plausible
- 0.5-0.7: Single agent or ambiguous
- < 0.5: Insufficient evidence — flag for manual investigation

INVESTIGATION STEPS:
1. Read findings — identify affected pods and anomaly types
2. Use query_prometheus to check resource metrics on pods in the causal chain
3. Use get_pod_logs on the affected pod AND its upstream dependencies to gather
   raw evidence — error messages, metric values, trends, timestamps
4. Use get_kubernetes_events if lifecycle issues are suspected
5. Reason from the evidence to identify root cause — do not assume a fault type,
   let the data guide your conclusion

EVIDENCE INTEGRITY: Only cite specific facts, numbers, or events that you
actually observed in tool results. If a log or metric shows no errors,
state clearly that no errors were found — do not invent failure modes,
timeouts, or anomalies that are not present in the retrieved data. If you
are uncertain or the evidence is inconclusive, say so in the insight and
lower the confidence score accordingly. A correct root_cause_pod paired
with fabricated supporting evidence is worse than an honest 'insufficient
evidence' response.

CAUSAL CHAIN RULE: Always trace findings back to the origin of the pipeline.
If a downstream pod (batch-sync, alert-manager, mock-upload) shows anomalies,
check what triggered it upstream. Use get_pod_logs on the triggering pod and
continue tracing upstream until you reach the pod that first showed abnormal
behaviour. The root_cause_pod must be the EARLIEST pod in the causal chain,
not a downstream effect.

ALERT TYPES:
- "cascade": fault propagated downstream through the pipeline
- "contention": pods competing for shared resources
- "lifecycle": OOMKill, crash loop, eviction

You MUST end your response with a JSON block in this exact format:
```json
{
  "root_cause_pod": "<pod name>",
  "causal_chain": ["<pod1>", "<pod2>", "<pod3>"],
  "alert_type": "cascade|contention|lifecycle",
  "confidence": 0.0,
  "insight": "<2-3 sentences describing what the evidence shows, in plain English for a field engineer>",
  "recommendation": "<1 sentence action based on the evidence>"
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


class Orchestrator:
    def __init__(self, dependency_graph: DependencyGraph):
        self._graph = dependency_graph
        self._client = openai.OpenAI(
            api_key=LLM_API_KEY,
            base_url=LLM_BASE_URL,
        )

    def _build_user_message(self, bundle: CorrelatedSignalBundle) -> str:
        """
        Dynamic per-call message. Includes dependency graph so the static
        system prompt never changes — maximising OpenAI prompt cache hits.
        """
        findings_text = json.dumps(bundle.findings, indent=2, default=str)
        return f"""PIPELINE CONTEXT:
{self._graph.to_prompt_text()}

CORRELATED ANOMALY BUNDLE:
Trigger reason: {bundle.trigger_reason}
Unique agents: {', '.join(bundle.unique_agents)}
Affected pods: {', '.join(bundle.unique_pods)}
Finding count: {len(bundle.findings)}
Severity counts: {bundle.severity_counts}

FINDINGS:
{findings_text}

Investigate this event. Use tools to gather context, trace the causal chain
back to its origin, then provide your analysis."""

    def _clean_pod_name(self, name: str) -> str:
        """Strip ReplicaSet + pod hash suffixes from full pod names."""
        import re
        return re.sub(r'-[a-z0-9]{5,12}-[a-z0-9]{5}$', '', name)

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

    def _force_final_answer(self, messages: list) -> str:
        """One extra call with tool_choice='none' to obtain the JSON conclusion."""
        try:
            resp = self._client.chat.completions.create(
                model=LLM_MODEL,
                messages=messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="none",
                temperature=0.1,
                max_completion_tokens=2000,
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            log.error("LLM API error (force final): %s", e)
            return ""

    def analyze(self, bundle: CorrelatedSignalBundle) -> OrchestratorResult:
        """Run full orchestrator analysis. Synchronous — call in thread pool."""
        start_time = time.time()
        self._graph.refresh()

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": self._build_user_message(bundle)},
        ]

        tool_calls_made = []
        final_content = ""
        seen_calls: set = set()
        turn = 0

        while True:
            elapsed = time.time() - start_time
            if elapsed > MAX_ANALYSIS_TIME_S:
                log.warning("Analysis timeout after %.1fs — forcing final answer", elapsed)
                final_content = self._force_final_answer(messages)
                break

            turn += 1
            log.info("Orchestrator turn %d (%.1fs elapsed)", turn, elapsed)
            try:
                response = self._client.chat.completions.create(
                    model=LLM_MODEL,
                    messages=messages,
                    tools=TOOL_DEFINITIONS,
                    tool_choice="auto",
                    temperature=0.1,
                    max_completion_tokens=2000,
                )
            except Exception as e:
                log.error("LLM API error: %s", e)
                break

            message = response.choices[0].message
            tool_calls = message.tool_calls or []
            content = message.content or ""

            # Log cache usage if available
            usage = getattr(response, "usage", None)
            if usage:
                details = getattr(usage, "prompt_tokens_details", None)
                if details:
                    cached = getattr(details, "cached_tokens", 0)
                    if cached:
                        log.info("Cache hit: %d tokens cached", cached)

            messages.append(message)

            if not tool_calls:
                final_content = content
                break

            # Execute tool calls; deduplicate by tool-name-prefixed key so
            # the model can't loop on the same fetch indefinitely.
            executed_any = False
            for tc in tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                if tool_name == "query_prometheus":
                    dedup_key = f"query_prometheus:{tool_args.get('promql', '')}"
                elif tool_name == "get_pod_logs":
                    dedup_key = f"get_pod_logs:{tool_args.get('pod_name', '')}/{tool_args.get('namespace', '')}"
                elif tool_name == "get_kubernetes_events":
                    dedup_key = f"get_kubernetes_events:{tool_args.get('namespace', '')}/{tool_args.get('pod_name', '')}"
                else:
                    dedup_key = f"{tool_name}:{sorted(tool_args.items())}"

                if dedup_key in seen_calls:
                    log.warning("Duplicate tool call skipped: %s", dedup_key)
                    # Must still respond to every tool_call_id in the assistant
                    # message or the next API call will fail validation.
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": "[Duplicate call — result already fetched this session. Do not repeat this call.]",
                    })
                else:
                    seen_calls.add(dedup_key)
                    executed_any = True
                    log.info("Tool call: %s(%s)", tool_name, list(tool_args.keys()))
                    tool_calls_made.append(tool_name)
                    result = execute_tool(tool_name, tool_args)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })

            if not executed_any:
                log.warning("All tool calls were duplicates — forcing final answer")
                final_content = self._force_final_answer(messages)
                break

        duration = time.time() - start_time
        result_json = self._extract_json_result(final_content)

        if result_json:
            root_cause = self._clean_pod_name(result_json.get("root_cause_pod", "unknown"))
            causal_chain = [self._clean_pod_name(p) for p in result_json.get("causal_chain", [])]
            log.info(
                "Analysis complete: root_cause=%s confidence=%.2f duration=%.1fs",
                root_cause,
                result_json.get("confidence"),
                duration,
            )
            return OrchestratorResult(
                root_cause_pod=root_cause,
                causal_chain=causal_chain,
                alert_type=result_json.get("alert_type", "cascade"),
                confidence=float(result_json.get("confidence", 0.5)),
                insight=result_json.get("insight", "Analysis complete."),
                recommendation=result_json.get("recommendation", "Investigate manually."),
                tool_calls_made=tool_calls_made,
                analysis_duration_s=duration,
            )
        else:
            log.warning("Could not parse LLM JSON result. Raw: %s", final_content[:200])
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
        pass