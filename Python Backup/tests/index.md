# tests/

One file per concern, plus helpers that are not tests.

* [Running the tests](running-tests.md) - how to run them, what the fixtures isolate, and the PTY check for the alternate screen.

## Helpers

These live here because they are repo tools rather than tests:

* `fake_mcp_server.py` — stands in for an MCP server over stdio.
* `validate_okf.py` — checks the three conformance rules of OKF v0.2 and reports
  broken cross-links. Run it after editing any markdown in this repository.
* `generate_file_map.py` — regenerates [the file map](../file-map.md) from the
  real repository, so the line counts cannot drift.
* `project_board.py` — creates the GitHub Project board with To Do / Doing /
  Done and fills it from [the backlog](../ideas.md). Idempotent; needs the
  `project` token scope.
