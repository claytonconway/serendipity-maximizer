#!/usr/bin/env python3
"""
End-to-end unit & MCP JSON-RPC 2.0 tests for Serendipity Maximizer v2.
Zero external dependencies (runs with `python3 -m unittest discover -s tests -v`).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import serendipity_engine as eng  # noqa: E402
import serendipity_mcp_server as mcp  # noqa: E402


class SerendipityEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._prev_home = os.environ.get("SERENDIPITY_HOME")
        os.environ["SERENDIPITY_HOME"] = self._tmp.name

    def tearDown(self) -> None:
        if self._prev_home is None:
            os.environ.pop("SERENDIPITY_HOME", None)
        else:
            os.environ["SERENDIPITY_HOME"] = self._prev_home
        self._tmp.cleanup()

    def test_mid_distance_geometry_separates_cliche_bridge_and_noise(self) -> None:
        tension = (
            "Sustain intermittent mechanical actuation across a steep thermal gradient "
            "without adding parasitic mass or continuous heater power."
        )

        # 1. Cliche: identical domain + identical surface mechanism -> too-close (< 0.30)
        cliche = eng.serendipity_distance(
            source_domain="thermal actuation power management",
            lens_domain="thermal actuation power management",
            core_tension=tension,
            mechanism_text="Use thermal insulation and continuous heater power management for actuation.",
        )
        self.assertLess(cliche["distance"], 0.30)
        self.assertEqual(eng.classify_band(cliche["distance"]), eng.BAND_TOO_CLOSE)
        self.assertAlmostEqual(eng.g_dist(0.05), 0.20, places=4)

        # 2. Serendipitous Bridge: orthogonal domain + strong structural isomorphism -> [0.30, 0.70]
        bridge = eng.serendipity_distance(
            source_domain="electromechanical battery robotics",
            lens_domain="Polar & Desert Extremophile Vascular Counter-Currents",
            core_tension=tension,
            mechanism_text=(
                "Counter-current vascular heat exchangers trap thermal gradients locally "
                "during intermittent burst duty cycles without insulation mass."
            ),
        )
        self.assertGreaterEqual(bridge["distance"], 0.30)
        self.assertLessEqual(bridge["distance"], 0.70)
        self.assertEqual(eng.classify_band(bridge["distance"]), eng.BAND_SERENDIPITY)
        self.assertGreater(eng.g_dist(bridge["distance"]), 0.75)

        # 3. Noise: orthogonal domain + zero shared mechanism -> too-far (> 0.70)
        noise = eng.serendipity_distance(
            source_domain="electromechanical battery robotics",
            lens_domain="Medieval Illuminated Manuscript Calligraphy",
            core_tension=tension,
            mechanism_text="Quill nib parchment ink pigment gilding gothic Majuscule.",
        )
        self.assertGreater(noise["distance"], 0.70)
        self.assertEqual(eng.classify_band(noise["distance"]), eng.BAND_TOO_FAR)
        self.assertAlmostEqual(eng.g_dist(0.95), 0.15, places=4)

    def test_plan_scan_avoids_echo_chamber_and_rotates_lenses(self) -> None:
        plan1 = eng.plan_scan(
            core_tension="Prevent queue overflow and latency spikes under bursty flow congestion.",
            source_domain="Network Congestion Control & Distributed Backpressure",
            constraints_or_assumptions=["Cannot drop packets", "Zero central coordinator"],
            n_lenses=4,
        )
        lenses1 = [x["lens_id"] for x in plan1["recommended_lenses"]]
        self.assertEqual(len(lenses1), 4)
        # Should avoid picking the exact source_domain echo chamber
        self.assertNotIn("congestion-backpressure", lenses1)
        # Should cover multiple distinct serendipity moves
        moves1 = {x["assigned_move"] for x in plan1["recommended_lenses"]}
        self.assertGreaterEqual(len(moves1), 3)

        # Immediate second scan receives freshness rotation
        plan2 = eng.plan_scan(
            core_tension="Prevent queue overflow and latency spikes under bursty flow congestion.",
            source_domain="Network Congestion Control & Distributed Backpressure",
            n_lenses=4,
        )
        lenses2 = [x["lens_id"] for x in plan2["recommended_lenses"]]
        self.assertNotEqual(lenses1, lenses2)

    def test_evaluate_sparks_detects_independent_convergence_and_retypes_false_bridges(self) -> None:
        tension = "Absorb high-rate impulsive shock loads while staying compliant during slow motion."
        candidates = [
            {
                "title": "Sacrificial rate-locking shear bonds",
                "lens_domain": "Intertidal & Abyssal Marine Biomechanics",
                "move": "B",
                "source_mechanism": "Mussel byssal threads use reversible sacrificial bonds that lock stiffly under high strain-rate shock.",
                "transfer_hypothesis": "Use a rate-dependent sacrificial shear fluid/interface that locks stiffly under impulsive strain-rate shock while staying compliant under slow motion.",
                "first_test": "Test dilatant silicone-borate coupon under drop weight vs quasi-static bend.",
                "surprise": 4,
                "leverage": 5,
                "effort": "low",
            },
            {
                "title": "Hydrocluster dilatant impact locking",
                "lens_domain": "Shear-Thickening Fluids, Foams & Capillary Bridges",
                "move": "D",
                "source_mechanism": "Concentrated colloidal suspensions jam into rigid hydroclusters above a critical shear strain rate.",
                "transfer_hypothesis": "Fill a compliant joint sleeve with a shear-thickening suspension that locks stiffly under impulsive strain-rate shock while flowing freely during slow motion.",
                "first_test": "Measure torque-speed curve across 0.1 rad/s vs 20 rad/s.",
                "surprise": 4,
                "leverage": 5,
                "effort": "low",
            },
            {
                "title": "Same-domain standard shock absorber",
                "lens_domain": "Mechanical shock absorber damper suspension",
                "move": "B",
                "source_mechanism": "Standard hydraulic shock absorber damper absorbs impulsive shock loads.",
                "transfer_hypothesis": "Add a standard hydraulic shock absorber damper to absorb shock loads during motion.",
                "first_test": "Buy off-the-shelf damper.",
                "surprise": 1,
                "leverage": 2,
                "effort": "med",
            },
        ]

        res = eng.evaluate_sparks(
            core_tension=tension,
            source_domain="Mechanical shock absorber damper suspension",
            candidates=candidates,
        )
        self.assertTrue(res["convergence_detected"])
        self.assertEqual(len(res["convergences"]), 1)
        self.assertEqual(res["convergences"][0]["lens_count"], 2)

        # Convergent sparks rank above the cliche same-domain candidate
        top_two = res["ranked_sparks"][:2]
        self.assertTrue(all(x["convergent"] for x in top_two))

        # Same-domain "Bridge" claim was retyped to A (never excluded!)
        cliche_item = res["ranked_sparks"][2]
        self.assertEqual(cliche_item["distance_band"], eng.BAND_TOO_CLOSE)
        self.assertEqual(cliche_item["retyped_from"], "B")
        self.assertEqual(cliche_item["move"], "A")

    def test_same_lens_agreement_never_manufactures_fake_convergence(self) -> None:
        res = eng.evaluate_sparks(
            core_tension="Eliminate thermal drift in precision alignment.",
            source_domain="Optical metrology",
            candidates=[
                {
                    "title": "Bimetallic compensation A",
                    "lens_domain": "Mechanical Watchmaking & Horological Escapements",
                    "move": "C",
                    "source_mechanism": "Opposing thermal expansion arms cancel drift.",
                    "transfer_hypothesis": "Pair two opposing thermal expansion flexures so drift cancels.",
                },
                {
                    "title": "Bimetallic compensation B",
                    "lens_domain": "Mechanical Watchmaking & Horological Escapements",
                    "move": "C",
                    "source_mechanism": "Opposing thermal expansion arms cancel drift.",
                    "transfer_hypothesis": "Pair two opposing thermal expansion flexures so drift cancels.",
                },
            ],
        )
        self.assertFalse(res["convergence_detected"])

    def test_parroting_problem_statement_with_different_mechanisms_never_converges(self) -> None:
        tension = "Eliminate thermal drift in precision optical alignment under rapid temperature swings."
        res = eng.evaluate_sparks(
            core_tension=tension,
            source_domain="Optical metrology",
            candidates=[
                {
                    "title": "Maxwell three-vee kinematic mount",
                    "lens_domain": "Precision Kinematic Couplings & Printmaking Registration",
                    "move": "C",
                    "source_mechanism": "Three spheres in radial vee-grooves slide freely around a fixed centroid.",
                    "transfer_hypothesis": (
                        "Eliminate thermal drift in precision optical alignment under rapid temperature swings "
                        "by mounting on three radial kinematic vee-grooves."
                    ),
                },
                {
                    "title": "Rete mirabile counter-current loop",
                    "lens_domain": "Polar & Desert Extremophile Vascular Counter-Currents",
                    "move": "B",
                    "source_mechanism": "Opposing arterial and venous microchannels exchange heat passively.",
                    "transfer_hypothesis": (
                        "Eliminate thermal drift in precision optical alignment under rapid temperature swings "
                        "by routing counter-current coolant microchannels."
                    ),
                },
            ],
        )
        self.assertFalse(res["convergence_detected"])

    def test_capture_dedup_timeline_collision_and_regularized_steering(self) -> None:
        cap1 = eng.capture_spark(
            mechanism="Exact-constraint 3-groove kinematic coupling eliminates thermal expansion binding.",
            why_surprising="Removing over-constraining bolts increased repeatability while allowing free thermal growth.",
            move="C",
            revisit_when="Whenever precision joints bind or warp across wide temperature swings.",
            workspace_hint="/Users/someone/secret/my-project",
        )
        self.assertTrue(cap1["created"])
        spark_id = cap1["spark"]["id"]
        # Full path stripped to basename only
        self.assertEqual(cap1["spark"]["workspace_hint"], "my-project")

        # Duplicate capture is suppressed idempotently
        cap_dup = eng.capture_spark(
            mechanism="Exact-constraint 3-groove kinematic coupling eliminates thermal expansion binding.",
            why_surprising="Removing over-constraining bolts increased repeatability while allowing free thermal growth.",
            move="C",
        )
        self.assertFalse(cap_dup["created"])
        self.assertTrue(cap_dup["deduplicated"])

        # Timeline collision finds this banked spark on a future thermal-warping problem
        q = eng.query_sparks(
            query_tension="Joined plates warp and bind when cycling across wide temperature swings."
        )
        self.assertGreaterEqual(len(q["collisions"]), 1)
        self.assertEqual(q["collisions"][0]["id"], spark_id)

        # Bank -> later pursued triggers retroactive delayed-hit learning signal
        eng.record_feedback(spark_id, "banked")
        fb = eng.record_feedback(spark_id, "pursued", note="Applied to sensor mount!")
        self.assertEqual(fb["effective_learning_signal"], "delayed")

        # Accumulate >= 10 outcomes and verify L2-regularized refit invariants
        for i in range(10):
            c = eng.capture_spark(
                mechanism=f"Asymmetric ratchet check-valve variant {i} rectifies oscillatory pressure.",
                why_surprising=f"Parasitic oscillation {i} became net forward pumping.",
                move="C",
                surprise=5,
                leverage=5,
                distance=0.48,
            )
            last_fb = eng.record_feedback(c["spark"]["id"], "shipped")

        self.assertTrue(last_fb["steering_update"]["refitted"])
        w = last_fb["steering_update"]["weights"]
        self.assertAlmostEqual(sum(w.values()), 1.0, places=4)
        for v in w.values():
            self.assertGreaterEqual(v, eng.GUARDRAILS["weight_floor"] - 1e-6)
        self.assertGreaterEqual(last_fb["steering_update"]["band_center"], eng.GUARDRAILS["band_c_min"])
        self.assertLessEqual(last_fb["steering_update"]["band_center"], eng.GUARDRAILS["band_c_max"])

    def test_mcp_stdio_server_protocol_roundtrip(self) -> None:
        env = dict(os.environ)
        env["SERENDIPITY_HOME"] = self._tmp.name
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "serendipity_capture_spark",
                    "arguments": {
                        "mechanism": "Spread peak load into a frequency-swept chirp and re-compress downstream.",
                        "why_surprising": "Peak power limit was bypassed without losing temporal resolution.",
                        "move": "D",
                    },
                },
            },
        ]
        stdin_payload = "\n".join(json.dumps(r) for r in requests) + "\n"
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "serendipity_mcp_server.py")],
            input=stdin_payload,
            text=True,
            capture_output=True,
            env=env,
            check=True,
        )
        lines = [json.loads(line) for line in proc.stdout.strip().splitlines()]
        self.assertEqual(len(lines), 3)  # notification produced no response
        self.assertEqual(lines[0]["result"]["serverInfo"]["name"], "serendipity-maximizer-mcp")
        tool_names = [t["name"] for t in lines[1]["result"]["tools"]]
        self.assertEqual(len(tool_names), 5)
        call_res = json.loads(lines[2]["result"]["content"][0]["text"])
        self.assertTrue(call_res["created"])

    def test_plugin_manifest_and_clean_tree_invariants(self) -> None:
        manifest = json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))
        allowed_keys = {"name", "description", "logo", "suggestedPrompts", "displayName", "version", "disabled"}
        self.assertTrue(set(manifest.keys()).issubset(allowed_keys))
        self.assertEqual(manifest["name"], "serendipity-maximizer")
        self.assertEqual(len(manifest["suggestedPrompts"]), 3)
        self.assertTrue((ROOT / manifest["logo"]).is_file())
        self.assertFalse((ROOT / ".boundary-blocklist").exists())
        self.assertEqual(len(mcp.MCP_TOOLS), 5)


if __name__ == "__main__":
    unittest.main()
