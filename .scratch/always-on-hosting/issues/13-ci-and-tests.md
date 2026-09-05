Type: grilling
Status: resolved
Blocked by: 01

# CI scope and the handler test boundary

## Question

No workflows exist. Repo convention (AGENTS.md) is that Vitest is *deliberately* scoped to pure
modules in `src/utils/` — no component or DOM tests.

Decide: does `ci.yml` run lint + `vitest run` on push and PR, on what Node versions? Do the
extracted server handlers get tests, and if so at what boundary — pure functions over a fake
`DATA_DIR` (fits the existing convention) or HTTP-level tests via supertest (a new dependency and
a new kind of test)? Does the release workflow gate on CI passing? Does the atomic-write
behaviour from the data-directory decision get an explicit test, given it's the one place a bug
loses the collection?

## Answer

Create `ci.yml` to run `npm run lint` and `npm test` on every pull request and on pushes to
`main`, using Node 22 only. Node 22 is the supported deployment runtime, so a matrix would add
maintenance without increasing confidence in the intended product.

Test the shared API directly at its Node middleware boundary: use temporary `DATA_DIR`
directories and lightweight fake request/response objects rather than adding Supertest or a
second HTTP-test stack. These tests cover routing, validation, persistence, and injected
dependencies while preserving the repository's deliberately small Vitest scope.

Add explicit filesystem regression tests for atomic writes: a successful atomic replacement, a
retained prior-version backup, and a simulated write failure that leaves the last valid data
intact. The GHCR release workflow must depend on successful CI before it publishes versioned,
immutable images.
