{{/*
Image reference for an EdgeMind-built service.
Usage: {{ include "edgemind.image" (dict "repo" "agents" "tag" .Values.edgemindAgents.tag "root" .) }}
*/}}
{{- define "edgemind.image" -}}
{{- $root := .root -}}
{{- $tag := .tag | default $root.Values.global.imageTag -}}
{{- printf "%s/%s:%s" $root.Values.global.imageRegistry .repo $tag -}}
{{- end -}}

{{/*
Common metadata labels. Added to metadata.labels only — never to selectors or
pod-template labels (those stay faithful to the original manifests so selectors
remain immutable / matching).
*/}}
{{- define "edgemind.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: edgemind
{{- end -}}
