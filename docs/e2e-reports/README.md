# Nightly E2E reports

One file per night (`<date>.md`, Vietnam time), written by the `report` job of `.github/workflows/e2e-nightly.yml`: results of the whole suite on a throwaway stack, the read-only smoke tests on production, what the test agent planned and wrote, and, on nights the AI engine changed, the critical prompt-injection cases and the main flow test run with the real Claude. Each report arrives as a PR together with the new tests; nothing is merged automatically.
