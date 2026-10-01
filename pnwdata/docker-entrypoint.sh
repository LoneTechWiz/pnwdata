#!/usr/bin/env bash
set -Eeuo pipefail

worker_pid=""
web_pid=""

shutdown() {
  trap - SIGTERM SIGINT
  if [[ -n "$worker_pid" ]]; then kill -TERM "$worker_pid" 2>/dev/null || true; fi
  if [[ -n "$web_pid" ]]; then kill -TERM "$web_pid" 2>/dev/null || true; fi
  if [[ -n "$worker_pid" ]]; then wait "$worker_pid" 2>/dev/null || true; fi
  if [[ -n "$web_pid" ]]; then wait "$web_pid" 2>/dev/null || true; fi
}

trap 'shutdown; exit 143' SIGTERM SIGINT

required_variables=(
  PNW_API_KEY
  PUBLIC_APP_URL
  SESSION_SECRET
  BOT_SERVICE_TOKEN
  DARTH_PROTOCOL_URL
)

missing_variables=()
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    missing_variables+=("$variable_name")
  fi
done

if (( ${#missing_variables[@]} > 0 )); then
  printf 'Missing required environment variables: %s\n' "${missing_variables[*]}" >&2
  exit 1
fi

./node_modules/.bin/tsx scripts/sync-worker.ts &
worker_pid=$!

./node_modules/.bin/next start --hostname "${HOSTNAME:-0.0.0.0}" --port "${PORT:-3000}" &
web_pid=$!

set +e
wait -n "$worker_pid" "$web_pid"
status=$?
set -e

shutdown
exit "$status"
