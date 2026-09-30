# tests/

One file per concern, plus two helpers that are not tests.

* [Running the tests](running-tests.md) - how to run them, what the fixtures isolate, and the PTY check for the alternate screen.

## Helpers

`fake_mcp_server.py`, `validate_okf.py` and `generate_file_map.py` live here
because they are repo tools rather than tests. The first stands in for an MCP
server over stdio; the other two keep the knowledge bundle honest and regenerate
the file map.
