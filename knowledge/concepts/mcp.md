---
type: Concept
title: MCP
description: External MCP servers over stdio, and how their tools join the agent's tool list.
tags: [roan, mcp, tools]
status: stable
generated: { by: hermes-agent/deepseek-v4.1-flash, at: 2026-09-30T08:12:52Z }
verified: { by: process:pytest, at: 2026-09-30T08:12:52Z }
sources:
  - id: mcp
    resource: ../../roan/mcp.py
    title: ../../roan/mcp.py
  - id: fake-server
    resource: ../../tests/fake_mcp_server.py
    title: ../../tests/fake_mcp_server.py
---

# Shape

`roan/mcp.py` implements a minimal MCP client over **stdio**: it starts a server
process, speaks JSON-RPC over stdin/stdout, and exposes the server's tools to the
agent.

    MCPServer(name, command, args, env)
      start()        spawn the process
      initialize()   the MCP handshake
      list_tools()   the server's tool schemas
      call_tool(tool, arguments) -> str
      stop()         shut the process down

`load_mcp_config()` reads the server list from the config.

# How tools reach the model

MCP tools are appended to the agent's own tool list at start-up, so from the
model's point of view they are ordinary tools. `request()` matches responses to
requests by id; `notify()` sends without waiting.

# Why hand-rolled

The official MCP SDK is a dependency (`mcp` in `pyproject.toml`), but the client
here is small enough to read end to end and has no transport beyond stdio. If
HTTP or SSE transport is ever needed, that is the moment to reconsider.

# Testing

`tests/fake_mcp_server.py` is a tiny stdio server used by `tests/test_mcp.py`, so
the client is tested without depending on any real MCP server being installed.
