#!/bin/bash
# Career Mission Control launcher.
#
#   launch.sh            start the local server if needed, then open the dashboard
#   launch.sh --start    start the local server if needed, do not open a browser
#   launch.sh --stop     stop the local server
#   launch.sh --status   print whether the server is running
#
# Safe to double-click twice: a second run never starts a second server, it
# just opens another browser window. All paths resolve relative to this file.
# CMC_PORT overrides the port (default 4777); tests use that.

PORT="${CMC_PORT:-4777}"
URL="http://127.0.0.1:${PORT}/"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${DIR}/data"
LOG="${DATA}/server.log"
if [ "${PORT}" = "4777" ]; then
  PIDFILE="${DATA}/server.pid"
else
  PIDFILE="${DATA}/server-${PORT}.pid"
fi

mkdir -p "${DATA}"

health() {
  curl -s -f -m 2 "${URL}_cmc/health" 2>/dev/null
}

# pid of whatever listens on our port (empty if nothing does)
listening_pid() {
  ss -ltnp 2>/dev/null | awk -v port=":${PORT}" '$4 ~ port"$" {print $0}' \
    | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n 1
}

# true when that pid is really our server.py
is_our_server() {
  [ -n "$1" ] && tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null | grep -q "server.py"
}

start_server() {
  cd "${DIR}" || exit 1
  # setsid puts the server in its own session so closing the launcher's
  # process group (the desktop entry, a terminal) does not take it down
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup python3 "${DIR}/server.py" --port "${PORT}" >> "${LOG}" 2>&1 < /dev/null &
  else
    nohup python3 "${DIR}/server.py" --port "${PORT}" >> "${LOG}" 2>&1 < /dev/null &
  fi
  local i=0
  while [ "${i}" -lt 40 ]; do
    if health >/dev/null; then
      return 0
    fi
    sleep 0.25
    i=$((i + 1))
  done
  return 1
}

ensure_running() {
  if health >/dev/null; then
    return 0
  fi
  echo "Starting Career Mission Control server on port ${PORT}..."
  if ! start_server; then
    echo "The server did not answer within 10 seconds. See ${LOG}"
    return 1
  fi
  echo "Server is up at ${URL}"
}

open_window() {
  if command -v brave-browser >/dev/null 2>&1; then
    nohup brave-browser --new-window "${URL}" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "${URL}" >/dev/null 2>&1 &
  else
    echo "No browser found. Open ${URL} by hand."
    return 1
  fi
}

case "${1:-}" in
  --stop)
    # prefer whatever is listening on the port, then the pid file; either
    # way only kill a pid whose command line is really our server.py
    pid="$(listening_pid)"
    if [ -z "${pid}" ] && [ -f "${PIDFILE}" ]; then
      pid="$(cat "${PIDFILE}" 2>/dev/null)"
    fi
    if ! is_our_server "${pid}"; then
      pid=""
    fi
    if [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}"
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 "${pid}" 2>/dev/null || break
        sleep 0.2
      done
      kill -0 "${pid}" 2>/dev/null && kill -9 "${pid}" 2>/dev/null
      rm -f "${PIDFILE}"
      echo "Career Mission Control server stopped (pid ${pid})."
    else
      rm -f "${PIDFILE}"
      echo "Career Mission Control server is not running."
    fi
    ;;
  --status)
    if out="$(health)"; then
      echo "Running at ${URL}"
      echo "${out}"
    else
      echo "Not running (nothing answers at ${URL})."
      exit 1
    fi
    ;;
  --start)
    ensure_running || exit 1
    ;;
  --help|-h)
    sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
  *)
    ensure_running || exit 1
    open_window
    ;;
esac
