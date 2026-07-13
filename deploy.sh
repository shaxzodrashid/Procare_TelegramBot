#!/usr/bin/env sh
set -eu

APP_SERVICE="${APP_SERVICE:-bot}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
DEPLOY_GIT_REMOTE="${DEPLOY_GIT_REMOTE:-origin}"
DEPLOY_GIT_BRANCH="${DEPLOY_GIT_BRANCH:-main}"
HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-180}"
HEALTH_INTERVAL_SECONDS="${DEPLOY_HEALTH_INTERVAL_SECONDS:-5}"
SHUTDOWN_TIMEOUT_SECONDS="${DEPLOY_SHUTDOWN_TIMEOUT_SECONDS:-90}"
LOG_TAIL_LINES="${DEPLOY_LOG_TAIL_LINES:-100}"

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
  ./deploy.sh up         Pull main, build/start the Compose stack, and mark users after code updates.
  ./deploy.sh restart    Run down, pull main, then up.
  ./deploy.sh status     Show Compose status and recent deployment history.
  ./deploy.sh logs       Show recent bot logs.

Environment overrides:
  APP_SERVICE=bot
  POSTGRES_SERVICE=postgres
  DEPLOY_GIT_REMOTE=origin
  DEPLOY_GIT_BRANCH=main
  DEPLOY_HEALTH_TIMEOUT_SECONDS=180
  DEPLOY_HEALTH_INTERVAL_SECONDS=5
  DEPLOY_SHUTDOWN_TIMEOUT_SECONDS=90
  DEPLOY_LOG_TAIL_LINES=100

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

current_commit_sha() {
  git rev-parse HEAD 2>/dev/null || printf 'unknown'
}

current_commit_message() {
  git log -1 --pretty=%B 2>/dev/null | tr '\r\n' '  ' || printf 'unknown'
}

pull_main_branch() {
  info "Updating repository from ${DEPLOY_GIT_REMOTE}/${DEPLOY_GIT_BRANCH}"
  git fetch "$DEPLOY_GIT_REMOTE" "$DEPLOY_GIT_BRANCH"

  current_branch="$(git branch --show-current 2>/dev/null || true)"
  if [ "$current_branch" != "$DEPLOY_GIT_BRANCH" ]; then
    git rev-parse --verify "$DEPLOY_GIT_BRANCH" >/dev/null 2>&1 || \
      fail "local branch $DEPLOY_GIT_BRANCH does not exist"
    git checkout "$DEPLOY_GIT_BRANCH"
  fi

  git pull --ff-only "$DEPLOY_GIT_REMOTE" "$DEPLOY_GIT_BRANCH"
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

ensure_logs_directory() {
  mkdir -p logs
  chown 1000:1000 logs 2>/dev/null || true
  chmod 775 logs 2>/dev/null || true
}

print_health_report() {
  info "Health endpoint report:"
  if ! $COMPOSE exec -T "$APP_SERVICE" sh -c 'if [ "$API_ENABLED" = "false" ]; then echo "health API disabled"; exit 0; fi; node -e "const port=process.env.API_PORT||3000; fetch(`http://127.0.0.1:${port}/health`).then(async (res)=>{ const body=await res.text(); console.log(body); process.exit(res.ok ? 0 : 1); }).catch((error)=>{ console.error(error); process.exit(1); });"'; then
    print_failure_logs
    fail "$APP_SERVICE health endpoint diagnosis failed"
  fi
}

sql_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

postgres_container_id() {
  service_container_id "$POSTGRES_SERVICE"
}

require_postgres_running() {
  postgres_container="$(postgres_container_id)"
  [ -n "$postgres_container" ] || fail "$POSTGRES_SERVICE is not running; cannot record deployment history"

  postgres_state="$(container_state "$postgres_container")"
  [ "$postgres_state" = "running" ] || fail "$POSTGRES_SERVICE is $postgres_state; cannot record deployment history"
}

psql_exec() {
  $COMPOSE exec -T "$POSTGRES_SERVICE" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

ensure_deployment_history_table() {
  require_postgres_running
  psql_exec <<'SQL'
CREATE TABLE IF NOT EXISTS deployment_history (
  id BIGSERIAL PRIMARY KEY,
  stopped_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  shutdown_period INTERVAL NULL,
  shutdown_period_seconds INTEGER NULL,
  git_commit_sha VARCHAR(40) NULL,
  git_commit_message TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'started',
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS deployment_history_stopped_at_index ON deployment_history (stopped_at);
CREATE INDEX IF NOT EXISTS deployment_history_started_at_index ON deployment_history (started_at);
CREATE INDEX IF NOT EXISTS deployment_history_status_index ON deployment_history (status);
SQL
}

record_deploy_down() {
  ensure_deployment_history_table
  commit_sha="$(sql_quote "$(current_commit_sha)")"
  commit_message="$(sql_quote "$(current_commit_message)")"
  note="$(sql_quote "safe shutdown requested; grace period ${SHUTDOWN_TIMEOUT_SECONDS}s")"

  psql_exec <<SQL
INSERT INTO deployment_history (
  stopped_at,
  git_commit_sha,
  git_commit_message,
  status,
  note,
  created_at,
  updated_at
)
VALUES (
  CURRENT_TIMESTAMP,
  $commit_sha,
  $commit_message,
  'stopped',
  $note,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
RETURNING id, stopped_at, git_commit_sha, git_commit_message;
SQL
}

record_deploy_up_started() {
  ensure_deployment_history_table
  commit_sha="$(sql_quote "$(current_commit_sha)")"
  commit_message="$(sql_quote "$(current_commit_message)")"
  note="$(sql_quote "startup requested")"

  psql_exec <<SQL
WITH open_deployment AS (
  SELECT id
  FROM deployment_history
  WHERE stopped_at IS NOT NULL
    AND started_at IS NULL
  ORDER BY stopped_at DESC
  LIMIT 1
),
updated AS (
  UPDATE deployment_history
  SET
    git_commit_sha = $commit_sha,
    git_commit_message = $commit_message,
    status = 'starting',
    note = $note,
    updated_at = CURRENT_TIMESTAMP
  WHERE id IN (SELECT id FROM open_deployment)
  RETURNING id
)
INSERT INTO deployment_history (
  git_commit_sha,
  git_commit_message,
  status,
  note,
  created_at,
  updated_at
)
SELECT
  $commit_sha,
  $commit_message,
  'starting',
  $note,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM updated)
RETURNING id;
SQL
}

record_deploy_up_completed() {
  ensure_deployment_history_table
  commit_sha="$(sql_quote "$(current_commit_sha)")"
  commit_message="$(sql_quote "$(current_commit_message)")"
  note="$(sql_quote "bot health check passed")"

  psql_exec <<SQL
WITH target AS (
  SELECT id
  FROM deployment_history
  WHERE started_at IS NULL
  ORDER BY stopped_at DESC NULLS LAST, created_at DESC
  LIMIT 1
)
UPDATE deployment_history
SET
  started_at = CURRENT_TIMESTAMP,
  shutdown_period = CASE
    WHEN stopped_at IS NULL THEN NULL
    ELSE CURRENT_TIMESTAMP - stopped_at
  END,
  shutdown_period_seconds = CASE
    WHEN stopped_at IS NULL THEN NULL
    ELSE FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - stopped_at)))::INTEGER
  END,
  git_commit_sha = $commit_sha,
  git_commit_message = $commit_message,
  status = 'healthy',
  note = $note,
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM target)
RETURNING id, stopped_at, started_at, shutdown_period, shutdown_period_seconds, git_commit_sha, git_commit_message;
SQL
}

mark_users_for_restart_if_code_changed() {
  ensure_deployment_history_table
  commit_sha="$(sql_quote "$(current_commit_sha)")"

  psql_exec <<SQL
WITH previous_healthy_deployment AS (
  SELECT git_commit_sha
  FROM deployment_history
  WHERE status = 'healthy'
    AND started_at IS NOT NULL
    AND git_commit_sha IS NOT NULL
  ORDER BY started_at DESC
  LIMIT 1
),
code_change AS (
  SELECT 1
  WHERE NOT EXISTS (SELECT 1 FROM previous_healthy_deployment)
     OR EXISTS (
       SELECT 1
       FROM previous_healthy_deployment
       WHERE git_commit_sha <> $commit_sha
     )
),
updated_users AS (
  UPDATE users
  SET
    should_restart = TRUE,
    updated_at = CURRENT_TIMESTAMP
  WHERE should_restart = FALSE
    AND EXISTS (SELECT 1 FROM code_change)
  RETURNING id
)
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM code_change) THEN 'code_changed'
    ELSE 'unchanged'
  END AS codebase_status,
  COUNT(*) AS users_marked_for_restart
FROM updated_users;
SQL
}

show_deployment_history() {
  require_postgres_running
  ensure_deployment_history_table
  psql_exec <<'SQL'
SELECT
  id,
  stopped_at,
  started_at,
  shutdown_period,
  shutdown_period_seconds,
  git_commit_sha,
  git_commit_message,
  status
FROM deployment_history
ORDER BY COALESCE(started_at, stopped_at, created_at) DESC
LIMIT 10;
SQL
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

wait_for_postgres_ready() {
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))

  while [ "$(date +%s)" -le "$deadline" ]; do
    postgres_container="$(postgres_container_id)"
    if [ -z "$postgres_container" ]; then
      info "Waiting for $POSTGRES_SERVICE container..."
      sleep "$HEALTH_INTERVAL_SECONDS"
      continue
    fi

    postgres_state="$(container_state "$postgres_container")"
    if [ "$postgres_state" != "running" ]; then
      info "Waiting for $POSTGRES_SERVICE: state=$postgres_state"
      sleep "$HEALTH_INTERVAL_SECONDS"
      continue
    fi

    if psql_exec >/dev/null 2>&1 <<'SQL'
SELECT 1;
SQL
    then
      info "$POSTGRES_SERVICE is accepting SQL"
      return 0
    fi

    info "Waiting for $POSTGRES_SERVICE SQL readiness..."
    sleep "$HEALTH_INTERVAL_SECONDS"
  done

  fail "timed out waiting for $POSTGRES_SERVICE SQL readiness"
}

command_down() {
  require_tools
  require_git_repo

  record_deploy_down

  bot_container="$(service_container_id "$APP_SERVICE")"
  if [ -n "$bot_container" ]; then
    info "Stopping $APP_SERVICE with ${SHUTDOWN_TIMEOUT_SECONDS}s grace period"
    $COMPOSE stop -t "$SHUTDOWN_TIMEOUT_SECONDS" "$APP_SERVICE"
  else
    info "$APP_SERVICE is not running"
  fi

  info "Stopping Compose stack"
  $COMPOSE down --timeout "$SHUTDOWN_TIMEOUT_SECONDS"
}

command_up() {
  require_tools
  require_git_repo

  pull_main_branch
  ensure_logs_directory
  info "Building and starting Compose stack"
  $COMPOSE up -d --build

  wait_for_postgres_ready
  record_deploy_up_started
  wait_for_bot_health
  mark_users_for_restart_if_code_changed
  print_health_report
  record_deploy_up_completed
}

command_status() {
  require_tools
  $COMPOSE ps
  info "Recent deployment history:"
  show_deployment_history
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
