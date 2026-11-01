#!/usr/bin/env python3
"""
serendipity_cli.py
==================
Direct command-line interface to the Serendipity Maximizer v2 engine.

Usage examples:
  python3 scripts/serendipity_cli.py plan --json '{"core_tension":"...","source_domain":"..."}'
  python3 scripts/serendipity_cli.py evaluate --json '{...}'
  python3 scripts/serendipity_cli.py capture --json '{"mechanism":"...","why_surprising":"..."}'
  python3 scripts/serendipity_cli.py feedback --json '{"spark_id":"SPK-...","outcome":"pursued"}'
  python3 scripts/serendipity_cli.py query --json '{"query_tension":"..."}'
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from serendipity_engine import dispatch_tool  # noqa: E402

CMD_MAP = {
    "plan": "serendipity_plan_scan",
    "evaluate": "serendipity_evaluate_sparks",
    "capture": "serendipity_capture_spark",
    "feedback": "serendipity_record_feedback",
    "query": "serendipity_query_sparks",
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serendipity Maximizer v2 CLI")
    parser.add_argument("command", choices=sorted(CMD_MAP.keys()))
    parser.add_argument("--json", default="{}", help="JSON payload of tool arguments")
    args = parser.parse_args(argv)

    payload = json.loads(args.json)
    result = dispatch_tool(CMD_MAP[args.command], payload)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
