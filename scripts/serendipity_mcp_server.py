#!/usr/bin/env python3
"""
serendipity_mcp_server.py
=========================
Zero-dependency Model Context Protocol (MCP) Stdio JSON-RPC 2.0 server
for the Serendipity Maximizer v2 plugin (`serendipity-maximizer-mcp`).

Conforms to MCP Specification 2024-11-05, 2025-03-26, and 2025-06-18 over
newline-delimited UTF-8 JSON-RPC 2.0 stdio transport.
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from serendipity_engine import __version__, dispatch_tool  # noqa: E402

SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

MCP_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "serendipity_plan_scan",
        "description": (
            "Plan a zero-friction cross-domain serendipity scan from a domain-neutral structural "
            "tension (`core_tension`). Selects diverse mid-distance orthogonal fields separated from "
            "`source_domain`, applies UCB exploration bonuses across serendipity moves (A/B/C/D), and "
            "collides the tension against the user's local banked spark timeline (`~/.gemini/serendipity/`)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "core_tension": {
                    "type": "string",
                    "description": "Domain-neutral 1-3 sentence structural trade-off or bottleneck (strip project/industry jargon first).",
                },
                "source_domain": {
                    "type": "string",
                    "description": "Brief label of the user's current working domain so the planner avoids echo-chamber fields.",
                },
                "constraints_or_assumptions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of rigid constraints or held assumptions that could be inverted.",
                },
                "n_lenses": {
                    "type": "integer",
                    "description": "Number of orthogonal lenses to recommend (default 4, range 2-6).",
                },
            },
            "required": ["core_tension", "source_domain"],
        },
    },
    {
        "name": "serendipity_evaluate_sparks",
        "description": (
            "Score candidate sparks returned by parallel blinded orthogonal-lens subagents. "
            "Computes mid-distance serendipity geometry d = 0.5*d_domain + 0.5*(1 - s_mechanism), "
            "peaked asymmetric g_dist(d), BridgeShape integrity retyping (never excluding ideas), "
            "corpus novelty, and detects True Independent Convergence when 2+ distinct orthogonal "
            "lenses land on the same underlying mechanism."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "core_tension": {"type": "string"},
                "source_domain": {"type": "string"},
                "candidates": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "lens_domain": {"type": "string"},
                            "move": {
                                "type": "string",
                                "enum": ["A", "B", "C", "D"],
                                "description": "A=Anomaly, B=Bridge, C=Constraint Flip, D=Scale Shift",
                            },
                            "source_mechanism": {"type": "string"},
                            "transfer_hypothesis": {"type": "string"},
                            "first_test": {"type": "string"},
                            "surprise": {"type": "integer", "minimum": 1, "maximum": 5},
                            "leverage": {"type": "integer", "minimum": 1, "maximum": 5},
                            "effort": {"type": "string", "enum": ["low", "med", "high"]},
                            "epistemic_status": {"type": "string", "enum": ["known", "hypothesis", "verify"]},
                        },
                        "required": ["title", "lens_domain", "move", "source_mechanism", "transfer_hypothesis"],
                    },
                },
            },
            "required": ["core_tension", "source_domain", "candidates"],
        },
    },
    {
        "name": "serendipity_capture_spark",
        "description": (
            "Save a distilled, domain-neutral mechanism spark to `~/.gemini/serendipity/sparks.jsonl` "
            "(used when the user replies 'spark' to an ambient nudge or banks a scan result). "
            "Always strip proprietary/project nouns before calling."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "mechanism": {
                    "type": "string",
                    "description": "1-2 sentence reusable, domain-neutral structural mechanism.",
                },
                "why_surprising": {
                    "type": "string",
                    "description": "What held assumption or constraint this violated or inverted.",
                },
                "move": {"type": "string", "enum": ["A", "B", "C", "D"]},
                "revisit_when": {
                    "type": "string",
                    "description": "Problem pattern or trigger condition where this spark will pay off later.",
                },
                "source_field": {"type": "string"},
                "first_test": {"type": "string"},
                "surprise": {"type": "integer", "minimum": 1, "maximum": 5},
                "leverage": {"type": "integer", "minimum": 1, "maximum": 5},
                "effort": {"type": "string", "enum": ["low", "med", "high"]},
                "capture_mode": {"type": "string", "enum": ["ambient", "scan"]},
                "status": {"type": "string", "enum": ["banked", "active", "pursued"]},
                "workspace_hint": {"type": "string", "description": "Optional short workspace basename only."},
                "distance": {"type": "number"},
            },
            "required": ["mechanism", "why_surprising"],
        },
    },
    {
        "name": "serendipity_record_feedback",
        "description": (
            "Record a one-word outcome ('pursued', 'shipped', 'banked', 'dismissed') on a stored spark "
            "and update the L2-regularized online steering weights (including retroactive delayed-hit "
            "credit when a previously banked spark is pursued or shipped)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "spark_id": {"type": "string"},
                "outcome": {"type": "string", "enum": ["pursued", "shipped", "banked", "dismissed"]},
                "note": {"type": "string"},
            },
            "required": ["spark_id", "outcome"],
        },
    },
    {
        "name": "serendipity_query_sparks",
        "description": (
            "List, collide against a `query_tension`, or delete entries in the user's local spark log "
            "(`~/.gemini/serendipity/sparks.jsonl`), and inspect current steering weights."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query_tension": {
                    "type": "string",
                    "description": "Optional structural tension to collide against banked sparks.",
                },
                "status": {
                    "type": "string",
                    "enum": ["all", "banked", "active", "pursued", "shipped", "dismissed"],
                },
                "limit": {"type": "integer"},
                "delete_id": {"type": "string", "description": "Optional spark ID to remove cleanly."},
            },
        },
    },
]


def handle_rpc_message(msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    method = msg.get("method", "")
    req_id = msg.get("id", None)
    params = msg.get("params") or {}

    if "id" not in msg:
        return None

    if method == "initialize":
        client_ver = str(params.get("protocolVersion", "2025-03-26"))
        negotiated = client_ver if client_ver in SUPPORTED_PROTOCOL_VERSIONS else "2025-03-26"
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": negotiated,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {
                    "name": "serendipity-maximizer-mcp",
                    "version": __version__,
                },
            },
        }

    if method == "ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": {}}

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": MCP_TOOLS}}

    if method == "resources/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"resources": []}}

    if method == "prompts/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"prompts": []}}

    if method == "tools/call":
        t_name = str(params.get("name", ""))
        t_args = params.get("arguments") or {}
        try:
            output = dispatch_tool(t_name, t_args)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(output, indent=2)}],
                    "isError": False,
                },
            }
        except Exception as exc:
            err_payload = {
                "error": str(exc),
                "tool": t_name,
                "traceback": traceback.format_exc(limit=4),
            }
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": json.dumps(err_payload, indent=2)}],
                    "isError": True,
                },
            }

    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main() -> int:
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            err_resp = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {exc}"},
            }
            sys.stdout.write(json.dumps(err_resp) + "\n")
            sys.stdout.flush()
            continue

        resp = handle_rpc_message(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
