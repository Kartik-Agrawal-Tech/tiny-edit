# Golden fixtures

Each `.tw1` file pairs with a `before/` and `after/` snapshot directory.

Round-trip test: build index from `before/`, apply the `.tw1` frame, assert fs state matches `after/`.

These fixtures are populated as part of the test harness (see roadmap in README).
