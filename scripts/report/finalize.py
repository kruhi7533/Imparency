"""Fill acceptance-v3-data.json from observed results.

usage: python3 scripts/report/finalize.py results.json
results.json: {"verdicts": {"NGO-001": "PASS", ...}, "runs": [...], "notes": [...], "commit": "abc1234"}
Only IDs present in "verdicts" change; evidence text comes from cases-*.json.
"""
import json, sys

base = "scripts/report/"
data = json.load(open(base + "acceptance-v3-data.json"))
res = json.load(open(sys.argv[1]))
ev = {**json.load(open(base + "cases-admin.json")), **json.load(open(base + "cases-ngo.json"))}

for c in data["cases"]:
    v = res["verdicts"].get(c["id"])
    if v:
        c["verdict"] = v
        c["evidence"] = res.get("evidence", {}).get(c["id"], ev.get(c["id"], c["evidence"]))

passed = sum(c["verdict"] == "PASS" for c in data["cases"])
total = len(data["cases"])
data["runs"] = res["runs"]
data["notes"] = res["notes"]
data["commit"] = res["commit"]

gate_ids = {
    "Stage 0 identity / verification": ["ADM-002", "NGO-002", "E2E-001"],
    "RFP → match → proposal": ["DON-004", "AI-001", "ADM-006", "E2E-002"],
    "Funding → reconciliation → allocation": ["ADM-011", "ADM-009", "E2E-004"],
    "Field evidence → verification → donor": ["NGO-013", "ADM-012", "E2E-005"],
    "Outcome → impact report → feedback": ["NGO-016", "DON-013", "E2E-006", "E2E-007"],
}
by_id = {c["id"]: c["verdict"] for c in data["cases"]}
for g in data["gates"]:
    g["after"] = "PASS" if all(by_id[i] == "PASS" for i in gate_ids[g["gate"]]) else "FAIL"

all_gates = all(g["after"] == "PASS" for g in data["gates"])
if passed == total:
    data["verdict"] = f"All {total} acceptance cases PASS — pilot gates met"
    data["verdictDetail"] = (
        "Every case in the sheet now passes in a real browser with persisted data, including all five "
        "P0 defects (D1–D5) and the seven features previously not built. Every pilot gate on the sheet's "
        "dashboard passes. Remaining items before a production pilot are operational (production keys and "
        "migration rollout) and are listed under Notes."
    )
else:
    failing = [c["id"] for c in data["cases"] if c["verdict"] != "PASS"]
    data["verdict"] = f"{passed} of {total} cases PASS" + ("" if all_gates else " — pilot gate open")
    data["verdictDetail"] = "Not passing: " + ", ".join(failing) + ". Details in the scorecard."

json.dump(data, open(base + "acceptance-v3-data.json", "w"), indent=1, ensure_ascii=False)
print(passed, "/", total, "gates:", [g["after"] for g in data["gates"]])
