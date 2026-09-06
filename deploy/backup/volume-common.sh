#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
DOCKER=${DOCKER:-docker}
VOLUME_NAME=${VINYL_VOLUME_NAME:-vinyl-inventory-data}
ARCHIVE_IMAGE=${VINYL_ARCHIVE_IMAGE:-alpine:3.20}

compose() {
  "$DOCKER" compose --project-directory "$PROJECT_DIR" \
    --file "$PROJECT_DIR/compose.yaml" "$@"
}

require_volume() {
  "$DOCKER" volume inspect "$VOLUME_NAME" >/dev/null
}

app_container_id() {
  compose ps --all --quiet app | head -n 1
}

app_requires_stop() {
  container_id=$(app_container_id)
  if [ -z "$container_id" ]; then
    return 1
  fi

  status=$("$DOCKER" inspect --format '{{.State.Status}}' "$container_id")
  case "$status" in
    running|restarting|paused)
      return 0
      ;;
    created|exited|dead)
      return 1
      ;;
    *)
      printf 'Cannot safely determine app writer state: %s\n' "$status" >&2
      return 2
      ;;
  esac
}

app_image() {
  container_id=$(app_container_id)
  if [ -z "$container_id" ]; then
    printf 'Compose app container does not exist; create it before using volume tools.\n' >&2
    return 1
  fi
  "$DOCKER" inspect --format '{{.Config.Image}}' "$container_id"
}

next_archive_path() {
  destination=$1
  prefix=$2
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  candidate="$destination/$prefix-$stamp.tar.gz"
  counter=1

  while [ -e "$candidate" ]; do
    candidate="$destination/$prefix-$stamp-$counter.tar.gz"
    counter=$((counter + 1))
  done
  printf '%s\n' "$candidate"
}

archive_volume() {
  source_volume=$1
  destination=$2
  prefix=$3
  caller_uid=$(id -u)
  caller_gid=$(id -g)

  mkdir -p -- "$destination"
  destination=$(CDPATH= cd -- "$destination" && pwd -P)
  volume_mount=$("$DOCKER" volume inspect \
    --format '{{.Mountpoint}}' "$source_volume")
  case "$destination/" in
    "$volume_mount"/*)
      printf 'Backup destination must be outside volume %s\n' "$source_volume" >&2
      return 1
      ;;
  esac

  archive=$(next_archive_path "$destination" "$prefix")
  archive_name=$(basename -- "$archive")
  partial_name=".$archive_name.partial.$$"
  partial_path="$destination/$partial_name"

  if ! "$DOCKER" run --rm --user 0:0 \
    --volume "$source_volume:/source:ro" \
    --volume "$destination:/archives" \
    --env VINYL_ARCHIVE_OPERATION=create \
    --env "VINYL_ARCHIVE_NAME=$partial_name" \
    "$ARCHIVE_IMAGE" sh -eu -c '
      tar -C /source -czf "/archives/$VINYL_ARCHIVE_NAME" .
      chown "$1:$2" "/archives/$VINYL_ARCHIVE_NAME"
      chmod 600 "/archives/$VINYL_ARCHIVE_NAME"
    ' sh "$caller_uid" "$caller_gid"
  then
    rm -f -- "$partial_path"
    return 1
  fi

  if ! tar -tzf "$partial_path" >/dev/null; then
    rm -f -- "$partial_path"
    printf 'Created archive failed validation\n' >&2
    return 1
  fi

  mv -- "$partial_path" "$archive"
  printf '%s\n' "$archive"
}

extract_archive() {
  archive=$1
  target_volume=$2
  archive_directory=$(dirname -- "$archive")
  archive_name=$(basename -- "$archive")

  "$DOCKER" run --rm --user 0:0 \
    --volume "$archive_directory:/archives:ro" \
    --volume "$target_volume:/target" \
    --env VINYL_ARCHIVE_OPERATION=extract \
    --env "VINYL_ARCHIVE_NAME=$archive_name" \
    "$ARCHIVE_IMAGE" sh -eu -c '
      tar -C /target -xzf "/archives/$VINYL_ARCHIVE_NAME"
      test -f /target/records.json
      test -f /target/genreOptions.json
      if find /target \( -type l -o \( ! -type d ! -type f \) \) -print |
        grep -q .
      then
        echo "Archive contains unsupported file types" >&2
        exit 1
      fi
    '
}

validate_staged_archive() {
  target_volume=$1
  image=$(app_image)

  "$DOCKER" run --rm --user 0:0 \
    --entrypoint node \
    --volume "$target_volume:/data:ro" \
    --env VINYL_ARCHIVE_OPERATION=validate \
    "$image" -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const required = ["records.json", "genreOptions.json"];
      const optional = [
        "discogsConfig.json",
        "records.json.bak",
        "genreOptions.json.bak",
        "discogsConfig.json.bak",
      ];
      const read = (name) =>
        JSON.parse(fs.readFileSync(path.join("/data", name), "utf8"));
      const records = read(required[0]);
      const genres = read(required[1]);
      if (!Array.isArray(records)) throw new Error("records.json must contain an array");
      if (!genres || !Array.isArray(genres.genres) || !Array.isArray(genres.subGenres)) {
        throw new Error("genreOptions.json must contain genre arrays");
      }
      for (const name of optional) {
        if (fs.existsSync(path.join("/data", name))) read(name);
      }
    '
}

replace_volume() {
  source_volume=$1
  target_volume=$2

  "$DOCKER" run --rm --user 0:0 \
    --volume "$source_volume:/source:ro" \
    --volume "$target_volume:/target" \
    --env VINYL_ARCHIVE_OPERATION=replace \
    "$ARCHIVE_IMAGE" sh -eu -c '
      find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
      tar -C /source -cf - . | tar -C /target -xf -
    '
}
