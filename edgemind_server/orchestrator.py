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

PUMP_TO_SENSOR = {"pump1": "sensor-sim-1", "pump2": "sensor-sim-2", "pump3": "sensor-sim-3"}
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
3. Use get_pod_logs on feature-extractor to gather the full set of trend
   metrics for the affected pump: bearing_health, vib_trend, radial_trend,
   tangential_trend, axial_trend, temp_trend, rpm_trend. Compare which specific
   components are changing and in what direction/magnitude — this tells you
   the actual physical nature of the degradation (e.g. axial-only vs radial+tangential
   vs temperature-driven vs sudden step-change vs gradual drift). Describe what
   you observe in the insight using the specific components involved, not just
   'bearing health dropped.'
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

            # Deterministic correction: pump_health_critical findings must map to
            # the sensor-sim pod for the affected pump, regardless of model output.
            for finding in bundle.findings:
                if finding.get("anomaly_type") == "pump_health_critical" and "pump" in finding:
                    correct_sensor = PUMP_TO_SENSOR.get(finding["pump"])
                    if correct_sensor and root_cause != correct_sensor:
                        log.warning(
                            "Correcting root_cause_pod from %s to %s based on pump field",
                            root_cause,
                            correct_sensor,
                        )
                        root_cause = correct_sensor
                        if correct_sensor not in causal_chain:
                            causal_chain.insert(0, correct_sensor)
                    break

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

    def answer_user_query(
        self,
        message: str,
        history: list,
        recent_findings: list,
        recent_alerts: list,
        metrics: dict
    ) -> str:
        """
        Industrial chatbot copilot query. Answers user questions based on live system context:
        topology, recent raw findings, orchestrator alerts, and live Prometheus metrics.
        """
        topology_text = self._graph.to_prompt_text()
        
        # Format a clean, bounded context
        findings_clean = [
            {
                "timestamp": f.get("timestamp"),
                "pod": f.get("pod"),
                "agent": f.get("agent"),
                "anomaly_type": f.get("anomaly_type"),
                "severity": f.get("severity")
            } for f in recent_findings[:15]
        ]
        
        alerts_clean = [
            {
                "timestamp": a.get("timestamp"),
                "root_cause_pod": a.get("root_cause_pod"),
                "alert_type": a.get("alert_type"),
                "confidence": a.get("confidence"),
                "nlp_summary": a.get("nlp_summary")
            } for a in recent_alerts[:5]
        ]
        
        # Extract live values for quick reference in prompt
        pod_metrics = {}
        for pod, data in metrics.get("pods", {}).items():
            if any(pod.startswith(prefix) for prefix in ["sensor-sim-", "edgemind-", "redis", "opc-ua-", "data-", "feature-", "health-", "alert-", "batch-", "mock-"]):
                pod_metrics[pod] = {
                    "cpu_usage_pct": round(data.get("cpu_usage", 0) * 100, 1) if data.get("cpu_usage") is not None else None,
                    "mem_rss_mb": round(data.get("mem_rss", 0) / (1024 * 1024), 1) if data.get("mem_rss") is not None else None
                }

        context_prompt = f"""You are EdgeMind Copilot, an industrial chatbot assistant for a Kubernetes-based pump station monitor.
The user is viewing the dashboard and asks: "{message}"

Here is the current live system context:

1. PIPELINE TOPOLOGY:
{topology_text}

2. DETECTED INCIDENTS & ROOT CAUSES (Alerts):
{json.dumps(alerts_clean, indent=2)}

3. RECENT RAW FINDINGS (Anomalies):
{json.dumps(findings_clean, indent=2)}

4. POD TELEMETRY SNAPSHOT:
{json.dumps(pod_metrics, indent=2)}

Please answer the user's question directly, using the live telemetry or incident context if relevant.
Guidelines:
- Keep your answer professional, accurate, and direct.
- Do not make up metrics or incidents that are not shown in the context.
- Keep the response brief, ideally under 4 sentences.
- Speak in plain English suitable for an operations engineer.
"""
        messages = [
            {"role": "system", "content": "You are a professional industrial Copilot for EdgeMind. Answer concisely based on telemetry data."},
        ]
        
        # Bounded history
        for msg in history[-6:]:
            messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
            
        messages.append({"role": "user", "content": context_prompt})

        try:
            resp = self._client.chat.completions.create(
                model=LLM_MODEL,
                messages=messages,
                temperature=0.2,
                max_completion_tokens=400
            )
            return resp.choices[0].message.content or "No response from LLM."
        except Exception as e:
            log.error("LLM Chat query failed: %s", e)
            return f"Error communicating with LLM: {str(e)}"

    def close(self):
        pass