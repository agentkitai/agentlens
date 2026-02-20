{{/*
Expand the name of the chart.
*/}}
{{- define "agentlens.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "agentlens.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "agentlens.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agentlens.labels" -}}
helm.sh/chart: {{ include "agentlens.chart" . }}
{{ include "agentlens.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "agentlens.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agentlens.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "agentlens.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "agentlens.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the secret name to use for the app
*/}}
{{- define "agentlens.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "agentlens.fullname" . }}
{{- end }}
{{- end }}

{{/*
Return the DATABASE_URL secret name and key
*/}}
{{- define "agentlens.databaseSecretName" -}}
{{- if .Values.externalDatabase.enabled }}
  {{- if .Values.externalDatabase.existingSecret }}
    {{- .Values.externalDatabase.existingSecret }}
  {{- else }}
    {{- include "agentlens.fullname" . }}
  {{- end }}
{{- else if .Values.postgresql.enabled }}
  {{- printf "%s-postgresql" .Release.Name }}
{{- end }}
{{- end }}

{{- define "agentlens.databaseSecretKey" -}}
{{- if .Values.externalDatabase.enabled }}
  {{- if .Values.externalDatabase.existingSecret }}
    {{- .Values.externalDatabase.secretKey | default "database-url" }}
  {{- else }}
    {{- "database-url" }}
  {{- end }}
{{- else if .Values.postgresql.enabled }}
  {{- "password" }}
{{- end }}
{{- end }}

{{/*
Construct DATABASE_URL from sub-chart values
*/}}
{{- define "agentlens.databaseUrl" -}}
{{- if .Values.externalDatabase.enabled }}
  {{- .Values.externalDatabase.url }}
{{- else if .Values.postgresql.enabled }}
  {{- printf "postgresql://%s:$(DATABASE_PASSWORD)@%s-postgresql:5432/%s" .Values.postgresql.auth.username .Release.Name .Values.postgresql.auth.database }}
{{- end }}
{{- end }}

{{/*
Return the REDIS_URL secret name and key
*/}}
{{- define "agentlens.redisSecretName" -}}
{{- if .Values.externalRedis.enabled }}
  {{- if .Values.externalRedis.existingSecret }}
    {{- .Values.externalRedis.existingSecret }}
  {{- else }}
    {{- include "agentlens.fullname" . }}
  {{- end }}
{{- else if .Values.redis.enabled }}
  {{- include "agentlens.fullname" . }}
{{- end }}
{{- end }}

{{- define "agentlens.redisSecretKey" -}}
{{- if .Values.externalRedis.enabled }}
  {{- if .Values.externalRedis.existingSecret }}
    {{- .Values.externalRedis.secretKey | default "redis-url" }}
  {{- else }}
    {{- "redis-url" }}
  {{- end }}
{{- else if .Values.redis.enabled }}
  {{- "redis-url" }}
{{- end }}
{{- end }}

{{/*
Construct REDIS_URL from sub-chart values
*/}}
{{- define "agentlens.redisUrl" -}}
{{- if .Values.externalRedis.enabled }}
  {{- .Values.externalRedis.url }}
{{- else if .Values.redis.enabled }}
  {{- printf "redis://%s-redis-master:6379" .Release.Name }}
{{- end }}
{{- end }}

{{/*
Validation rules
*/}}
{{- define "agentlens.validateValues" -}}
{{- if and (eq .Values.config.storageBackend "sqlite") (gt (int .Values.replicaCount) 1) }}
  {{- fail "SQLite mode does not support multiple replicas. Set replicaCount=1 or use storageBackend=postgres." }}
{{- end }}
{{- if and (eq .Values.config.storageBackend "postgres") (not .Values.postgresql.enabled) (not .Values.externalDatabase.enabled) }}
  {{- fail "Postgres storage backend requires either postgresql.enabled=true (sub-chart) or externalDatabase.enabled=true." }}
{{- end }}
{{- if and .Values.externalDatabase.enabled (not .Values.externalDatabase.url) (not .Values.externalDatabase.existingSecret) }}
  {{- fail "externalDatabase.enabled=true requires either externalDatabase.url or externalDatabase.existingSecret to be set." }}
{{- end }}
{{- if and .Values.config.loreEnabled (eq .Values.config.loreMode "remote") (not .Values.config.loreApiUrl) }}
  {{- fail "Lore remote mode requires config.loreApiUrl to be set." }}
{{- end }}
{{- end }}

{{/*
Image reference
*/}}
{{- define "agentlens.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}
