Type: grilling
Status: resolved
Blocked by:

# Data directory: seeding, atomic writes, backup and restore

## Question

`data/` is gitignored, so a fresh install starts with nothing. Every record mutation POSTs the
whole collection back to `data/records.json`.

Decide: how does the server bootstrap a missing `DATA_DIR` (create empty files? seed
`genreOptions.json` from `src/data/genreOptions.js`? refuse to start?); how are writes made
atomic so a power cut mid-write can't truncate the collection (write-temp-then-rename, fsync,
retained `.bak`?); what the volume mount looks like in Compose; and what the documented backup
and restore procedure is for a non-technical reader.

Related prior art: `.scratch/discogs-deletion-data-loss/spec.md` — a data-loss issue already
exists in this area; check whether the durability decision here subsumes or conflicts with it.

## Answer

On its first startup against an empty `DATA_DIR`, the server creates `records.json` as `[]` and
creates `genreOptions.json` from the shipped static genre/sub-genre defaults. It does not create
`discogsConfig.json` until credentials are saved. This preserves the empty-first-run decision
without making the first mutation or backup responsible for initialization.

Every persisted JSON file uses the same power-loss-safe write protocol: serialize to a uniquely
named temporary file in the target directory, `fsync` that file, atomically rename it over the
target, then `fsync` the directory. Before replacing an existing primary file, atomically replace
its single `.bak` sibling with the prior valid version. The retained files are therefore the
current valid value and one immediately previous valid value; no history rotation is part of this
service. This is complementary to, rather than a substitute for, the fixed Discogs deletion
logic in [Discogs sync can delete both pressings of an ambiguously-matched album](../../discogs-deletion-data-loss/spec.md):
atomic writes prevent torn files, while that work prevents a valid but unwanted collection
mutation.

Compose owns a named `vinyl-inventory-data` volume mounted at `/data`; the non-root application
process must be able to initialize and write that directory. Backup is manual by default: the
deployment guide supplies a timestamped archive command for the whole named volume and an
optional cron/systemd-timer example, but installs no scheduler. Retain multiple dated archives
off the Pi's SD card.

Restore operates on the entire `/data` volume, including saved Discogs configuration, so an
archive is a secret. The guide must stop the service, archive the current volume before making
any destructive change, restore one selected archive, restart the service, and confirm the
collection loads.
