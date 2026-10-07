#!/usr/bin/env bash
# Installed once by the administrator; image updates cannot modify this script.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
exec 9>/run/mosaic-update.lock
flock -n 9 || exit 0

# This root-owned file may override paths, network and image repository.
[[ ! -f /etc/mosaic/deploy.conf ]] || source /etc/mosaic/deploy.conf
IMAGE=${IMAGE:-ghcr.io/l1nkkkk/mosaic}
APP_DIR=${APP_DIR:-/var/lib/mosaic}
NETWORK=${NETWORK:-astrnet}
BASE_PATH=${BASE_PATH:-/mosaic}
PORT=${PORT:-6300}
ENV_FILE=${ENV_FILE:-/etc/mosaic/app.env}
[[ -f "$ENV_FILE" ]] || { echo 'Missing private app.env' >&2; exit 1; }
install -d -m 700 "$APP_DIR" "$APP_DIR/backups"
install -d -m 700 -o 1000 -g 1000 "$APP_DIR/data"
install -d -m 755 "$APP_DIR/monitor"
work=$(mktemp -d "$APP_DIR/.deploy-XXXXXX")
changed=0
committed=0
cleanup() {
  local result=$?
  trap - EXIT
  docker rm -f mosaic-candidate >/dev/null 2>&1 || true
  if [[ $changed == 1 && $committed == 0 ]]; then
    docker rm -f mosaic >/dev/null 2>&1 || true
    if docker container inspect mosaic-previous >/dev/null 2>&1; then
      docker rename mosaic-previous mosaic
      docker start mosaic >/dev/null
      echo 'Deployment failed; previous Mosaic container restored.' >&2
    fi
  fi
  rm -rf -- "$work"
  exit "$result"
}
trap cleanup EXIT

if ! docker pull "$IMAGE:main" >"$work/pull.log" 2>&1; then cat "$work/pull.log" >&2; exit 1; fi
next=$(docker image inspect "$IMAGE:main" --format '{{.Id}}')
current=$(docker container inspect mosaic --format '{{.Image}}' 2>/dev/null || true)
if [[ $next == "$current" ]] && [[ $(docker container inspect mosaic --format '{{.State.Running}}') == true ]]; then exit 0; fi

run_container() {
  local name=$1 data=$2 port=$3 restart=$4
  docker run -d --name "$name" --restart "$restart" --network "$NETWORK" \
    --env-file "$ENV_FILE" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 \
    --memory 192m --memory-swap 192m --cpus 0.5 \
    --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 \
    --mount "type=bind,src=$data,dst=/data" \
    --mount "type=bind,src=$APP_DIR/monitor,dst=/status,readonly" \
    -p "127.0.0.1:$port:3000" "$next" >/dev/null
}

healthy() {
  local port=$1
  for attempt in {1..25}; do
    if curl --silent --fail --max-time 2 "http://127.0.0.1:$port$BASE_PATH/api/health" >"$work/health.json"; then return 0; fi
    sleep 1
  done
  return 1
}

# Validate startup against a copy. Only one process may write the live data.
cp -a "$APP_DIR/data" "$work/data"
chmod 755 "$work"
docker rm -f mosaic-candidate >/dev/null 2>&1 || true
run_container mosaic-candidate "$work/data" "$((PORT + 1))" no
if ! healthy "$((PORT + 1))"; then docker logs --tail 30 mosaic-candidate >&2; exit 1; fi
docker rm -f mosaic-candidate >/dev/null

docker rm -f mosaic-previous >/dev/null 2>&1 || true
if docker container inspect mosaic >/dev/null 2>&1; then
  docker stop --time 12 mosaic >/dev/null
  # The old writer is stopped before the final backup and replacement.
  cp -a "$APP_DIR/data" "$APP_DIR/backups/before-update-$(date -u +%Y%m%dT%H%M%SZ)"
  docker rename mosaic mosaic-previous
fi
changed=1
run_container mosaic "$APP_DIR/data" "$PORT" unless-stopped
if ! healthy "$PORT"; then docker logs --tail 30 mosaic >&2; exit 1; fi
committed=1
echo "Mosaic deployed: $(cat "$work/health.json")"

# Keep the running and previous website images; never prune unrelated services.
previous=$(docker container inspect mosaic-previous --format '{{.Image}}' 2>/dev/null || true)
while read -r old; do
  [[ -z $old || $old == "$next" || $old == "$previous" ]] || docker image rm "$old" >/dev/null 2>&1 || true
done < <(docker image ls --filter label=org.opencontainers.image.source=https://github.com/L1nkkkk/mosaic --quiet --no-trunc | sort -u)
mapfile -t backups < <(find "$APP_DIR/backups" -mindepth 1 -maxdepth 1 -type d -name 'before-update-*' | sort -r)
for old in "${backups[@]:5}"; do rm -rf -- "$old"; done
