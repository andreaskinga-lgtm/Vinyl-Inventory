#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/volume-common.sh"

if [ "$#" -ne 1 ]; then
  printf 'Usage: %s BACKUP_DESTINATION\n' "$0" >&2
  exit 2
fi

require_volume
stopped_app=0

restart_if_needed() {
  status=$?
  trap - EXIT
  if [ "$stopped_app" -eq 1 ]; then
    compose start --wait app >&2 || status=1
  fi
  exit "$status"
}
exit_for_signal() {
  signal_status=$1
  trap - HUP INT TERM
  exit "$signal_status"
}
trap restart_if_needed EXIT
trap 'exit_for_signal 129' HUP
trap 'exit_for_signal 130' INT
trap 'exit_for_signal 143' TERM

if app_requires_stop; then
  compose stop app >&2
  stopped_app=1
else
  writer_status=$?
  [ "$writer_status" -eq 1 ] || exit "$writer_status"
  printf 'Compose app is already stopped; it will remain stopped.\n' >&2
fi

archive_volume "$VOLUME_NAME" "$1" "$VOLUME_NAME"
