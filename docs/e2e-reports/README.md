# Nightly E2E reports

One file per night (`<date>.md`, Vietnam time), written by the `report` job of `.github/workflows/e2e-nightly.yml`: results of the whole suite on a throwaway stack, the read-only smoke tests on production, and what the test agent planned and wrote. Each report arrives as a PR together with the new tests; nothing is merged automatically.
