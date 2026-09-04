Status: ready-for-agent
Kind: implementation
Model: gpt-5.6-luna
Blocked by: 16

# Add the Node 22 CI workflow

## Goal

Make the repository's existing lint and Vitest checks mandatory and reusable by release
automation.

Before editing, read **CI, images, releases, and updates** in
[`Always-on LAN hosting`](../spec.md) and
[`CI scope and the handler test boundary`](13-ci-and-tests.md).

## Files

- Add `.github/workflows/ci.yml`.

## Steps

1. Trigger on every pull request and pushes to `main`.
2. Grant `contents: read` only.
3. Use Node 22, npm cache keyed by the lockfile, `npm ci`, `npm run lint`, and `npm test`.
4. Expose the same check sequence through `workflow_call` so release automation can gate on it
   without copying commands.
5. Add concurrency that cancels superseded runs on the same branch or pull request.

## Completion criteria

- Workflow syntax is valid and contains no matrix or unnecessary permission.
- A pull request and a `main` push each produce one lint/test result.
- A deliberate test failure prevents the job from succeeding.
- The workflow contains no secrets and does not publish artifacts or images.
