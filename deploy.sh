#!/usr/bin/env sh
set -eu

APP_SERVICE="${APP_SERVICE:-bot}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
HEALTH_INTERVAL_SECONDS="${DEPLOY_HEALTH_INTERVAL_SECONDS:-5}"
SHUTDOWN_TIMEOUT_SECONDS="${DEPLOY_SHUTDOWN_TIMEOUT_SECONDS:-90}"
LOG_TAIL_LINES="${DEPLOY_LOG_TAIL_LINES:-100}"
HISTORY_FILE="${DEPLOY_HISTORY_FILE:-logs/deployment-history.tsv}"

COMPOSE="docker compose"

info() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage:
  ./deploy.sh down       Stop the bot safely, then stop the Compose stack.
  ./deploy.sh up         Build/start the Compose stack and wait for bot health.
  ./deploy.sh restart    Run down, then up.
  ./deploy.sh status     Show Compose status and recent deployment history.
  ./deploy.sh logs       Show recent bot logs.

Environment overrides:
  APP_SERVICE=bot
  POSTGRES_SERVICE=postgres
  DEPLOY_HEALTH_TIMEOUT_SECONDS=180
  DEPLOY_HEALTH_INTERVAL_SECONDS=5
  DEPLOY_SHUTDOWN_TIMEOUT_SECONDS=90
  DEPLOY_LOG_TAIL_LINES=100
  DEPLOY_HISTORY_FILE=logs/deployment-history.tsv

Never use docker compose down -v for production deploys unless volume data loss is intentional.
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required"
}

require_tools() {
  require_command docker
  require_command git
  docker compose version >/dev/null 2>&1 || fail "docker compose plugin is required"
}

require_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "current directory is not a Git repo"
  git rev-parse --verify HEAD >/dev/null 2>&1 || fail "current directory has no valid Git commit"
}

now_utc() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

current_commit_sha() {
  git rev-parse HEAD 2>/dev/null || printf 'unknown'
}

current_commit_message() {
  git log -1 --pretty=%s 2>/dev/null | tr '\t\r\n' '   ' || printf 'unknown'
}

append_history() {
  event="$1"
  status="$2"
  note="$3"

  mkdir -p "$(dirname "$HISTORY_FILE")"
  if [ ! -f "$HISTORY_FILE" ]; then
    printf 'timestamp_utc\tevent\tstatus\tcommit_sha\tcommit_message\tnote\n' >"$HISTORY_FILE"
  fi

  safe_note="$(printf '%s' "$note" | tr '\t\r\n' '   ')"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(now_utc)" \
    "$event" \
    "$status" \
    "$(current_commit_sha)" \
    "$(current_commit_message)" \
    "$safe_note" >>"$HISTORY_FILE"
}

service_container_id() {
  $COMPOSE ps -q "$1" 2>/dev/null || true
}

container_state() {
  container_id="$1"
  docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null || printf 'missing'
}

container_health() {
  container_id="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container_id" 2>/dev/null || printf 'missing'
}

print_failure_logs() {
  info "Recent $APP_SERVICE logs:"
  $COMPOSE logs --tail="$LOG_TAIL_LINES" "$APP_SERVICE" || true
}

warn_if_postgres_unavailable_for_shutdown() {
  postgres_container="$(service_container_id "$POSTGRES_SERVICE")"
  if [ -z "$postgres_container" ]; then
    info "$POSTGRES_SERVICE is not running; shutdown notification dispatch logs may not be written"
    return
  fi

  postgres_state="$(container_state "$postgres_container")"
  if [ "$postgres_state" != "running" ]; then
    info "$POSTGRES_SERVICE is $postgres_state; shutdown notification dispatch logs may not be written"
  fi
}

wait_for_bot_health() {
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))

  while [ "$(date +%s)" -le "$deadline" ]; do
    container_id="$(service_container_id "$APP_SERVICE")"
    if [ -z "$container_id" ]; then
      info "Waiting for $APP_SERVICE container..."
      sleep "$HEALTH_INTERVAL_SECONDS"
      continue
    fi

    state="$(container_state "$container_id")"
    health="$(container_health "$container_id")"

    case "$state:$health" in
      running:healthy)
        info "$APP_SERVICE is healthy"
        return 0
        ;;
      running:no-healthcheck)
        info "$APP_SERVICE is running"
        return 0
        ;;
      exited:*|dead:*|removing:*)
        print_failure_logs
        fail "$APP_SERVICE container is $state"
        ;;
      running:unhealthy)
        print_failure_logs
        fail "$APP_SERVICE container is unhealthy"
        ;;
      *)
        info "Waiting for $APP_SERVICE health: state=$state health=$health"
        sleep "$HEALTH_INTERVAL_SECONDS"
        ;;
    esac
  done

  print_failure_logs
  fail "timed out waiting for $APP_SERVICE to become healthy"
}

command_down() {
  require_tools
  require_git_repo

  append_history "down" "started" "safe shutdown requested"

  bot_container="$(service_container_id "$APP_SERVICE")"
  if [ -n "$bot_container" ]; then
    warn_if_postgres_unavailable_for_shutdown
    info "Stopping $APP_SERVICE with ${SHUTDOWN_TIMEOUT_SECONDS}s grace period"
    $COMPOSE stop -t "$SHUTDOWN_TIMEOUT_SECONDS" "$APP_SERVICE"
  else
    info "$APP_SERVICE is not running"
  fi

  info "Stopping Compose stack"
  $COMPOSE down --timeout "$SHUTDOWN_TIMEOUT_SECONDS"
  append_history "down" "completed" "compose stack stopped"
}

command_up() {
  require_tools
  require_git_repo

  append_history "up" "started" "build and startup requested"
  info "Building and starting Compose stack"
  $COMPOSE up -d --build

  wait_for_bot_health
  append_history "up" "completed" "bot health check passed"
}

command_status() {
  require_tools
  $COMPOSE ps
  if [ -f "$HISTORY_FILE" ]; then
    info "Recent deployment history:"
    tail -n 10 "$HISTORY_FILE"
  fi
}

command_logs() {
  require_tools
  $COMPOSE logs --tail="$LOG_TAIL_LINES" "$APP_SERVICE"
}

case "${1:-}" in
  down)
    command_down
    ;;
  up)
    command_up
    ;;
  restart)
    command_down
    command_up
    ;;
  status)
    command_status
    ;;
  logs)
    command_logs
    ;;
  -h|--help|help|'')
    usage
    ;;
  *)
    usage
    fail "unknown command: $1"
    ;;
esac
