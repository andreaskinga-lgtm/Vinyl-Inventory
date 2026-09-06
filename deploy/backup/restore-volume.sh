#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/volume-common.sh"

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  printf 'Usage: %s ARCHIVE [SAFETY_BACKUP_DESTINATION]\n' "$0" >&2
  exit 2
fi

archive=$1
if [ ! -f "$archive" ]; then
  printf 'Archive is missing or is not a regular file: %s\n' "$archive" >&2
  exit 1
fi
archive_directory=$(CDPATH= cd -- "$(dirname -- "$archive")" && pwd -P)
archive="$archive_directory/$(basename -- "$archive")"
safety_destination=${2:-$archive_directory}
mkdir -p -- "$safety_destination"
safety_destination=$(CDPATH= cd -- "$safety_destination" && pwd -P)

if ! tar -tzf "$archive" >/dev/null; then
  printf 'Archive is not a readable gzip-compressed tar file: %s\n' "$archive" >&2
  exit 1
fi

require_volume
stage_volume="${VOLUME_NAME}-restore-stage-$$"
"$DOCKER" volume create "$stage_volume" >/dev/null
cleanup_stage() {
  "$DOCKER" volume rm "$stage_volume" >/dev/null 2>&1 || true
}
exit_for_signal() {
  signal_status=$1
  trap - HUP INT TERM
  exit "$signal_status"
}
trap cleanup_stage EXIT
trap 'exit_for_signal 129' HUP
trap 'exit_for_signal 130' INT
trap 'exit_for_signal 143' TERM

if ! extract_archive "$archive" "$stage_volume"; then
  printf 'Archive validation failed; current volume was not changed.\n' >&2
  exit 1
fi
if ! validate_staged_archive "$stage_volume"; then
  printf 'Archive JSON validation failed; current volume was not changed.\n' >&2
  exit 1
fi

if app_requires_stop; then
  compose stop app >&2
else
  writer_status=$?
  [ "$writer_status" -eq 1 ] || exit "$writer_status"
  printf 'Compose app is already stopped.\n' >&2
fi

pre_restore_archive=$(archive_volume \
  "$VOLUME_NAME" "$safety_destination" "$VOLUME_NAME-pre-restore")
printf 'Current volume preserved at %s\n' "$pre_restore_archive" >&2

if ! "$DOCKER" volume inspect "$stage_volume" >/dev/null; then
  printf 'Restore staging volume disappeared; current volume was not changed.\n' >&2
  exit 1
fi
if ! replace_volume "$stage_volume" "$VOLUME_NAME"; then
  failed_archive=$(archive_volume \
    "$VOLUME_NAME" "$safety_destination" "$VOLUME_NAME-failed-restore") || true
  printf 'Restore failed; the app remains stopped.\n' >&2
  printf 'Pre-restore state: %s\n' "$pre_restore_archive" >&2
  if [ -n "${failed_archive:-}" ]; then
    printf 'Failed restore state: %s\n' "$failed_archive" >&2
  fi
  exit 1
fi

compose start --wait app >&2
printf '%s\n' "$pre_restore_archive"
