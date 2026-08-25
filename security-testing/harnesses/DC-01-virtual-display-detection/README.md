# Bitecodes Proctor Validator — DC-01: Virtual / Indirect Display Detection

**Owner:** Bitecodes · **Control:** DC-01 · **Version:** 1.0.0 · **Date:** 2026-08-25

A **defensive**, in-lab harness that verifies your own proctoring product detects a
hidden second display surface (a virtual, indirect, or headless display used to
view reference material or helper content off-camera). It is the detection side,
not the evasion side: it is read-only, loud, and fully logged, and it changes
nothing on the host.

Maps to test cases **DC-01-T1** and **DC-01-T2** in the Red-Team Test Plan.

---

## What it contains

| File | Role |
|---|---|
| `detect_displays.js` | Reference display-topology detector. Enumerates displays/adapters and flags virtual-display drivers, remote-access surfaces, and displays lacking a physical EDID serial. |
| `validate_dc01.js` | Validation runner. Snapshots a clean baseline, confirms a real stimulus was introduced, then asserts your product raised the expected alert in time. Emits PASS / FAIL / INVALID. |
| `runs/` | Timestamped JSON evidence, one file per check. |

Requires Node.js >= 16. No third-party dependencies. Supported hosts: macOS
(tested), Windows (PowerShell path), Linux (`xrandr`/`lspci` path).

---

## Scope and safety

- Run only on **hosts you own**, in an **isolated lab**, against **your own**
  proctoring build. This harness is not a means to defeat third-party proctoring.
- Software-side display enumeration is **heuristic and spoofable** by a
  privileged local user. Treat DC-01 as one signal; pair it with camera-based
  environment scans, network-side remote-session detection, and live challenges
  for high assurance.
- **Client-surface caveat:** a browser-only proctoring agent cannot enumerate
  physical display hardware, so several DC-01 signals shift from *prevention* to
  *detection-only* or require a native/managed client. `[confirm for your product]`

---

## How to run

### 1. Snapshot a clean baseline (start of session, no extra displays)

```bash
node validate_dc01.js baseline
```

### 2. Introduce the stimulus — openly and documented

In the lab, add one virtual/extended display using a **standard, visible**
utility, and record what you did in your test notes. Examples:

- **macOS:** enable AirPlay/Sidecar to a second device, or install a documented
  virtual-display driver package.
- **Windows:** enable an indirect display (IddCx) via a documented virtual-monitor
  utility, or attach a second physical monitor / HDMI dummy plug.
- **Linux:** add a virtual head with `xrandr` (e.g. `--addmode` + `--setmonitor`).

Do this in the open; the harness is meant to *observe* the change, not hide it.

### 3. Run the check

```bash
# DC-01-T1: display present from the start (30s deadline)
node validate_dc01.js check --test DC-01-T1 --product-alerts ./product_alerts.json

# DC-01-T2: display added mid-session (60s deadline)
node validate_dc01.js check --test DC-01-T2 --product-alerts ./product_alerts.json
```

### 4. Inspect the evidence

Each run writes `runs/<timestamp>_<test>.json` with the full signal set and verdict.

---

## Verdicts

| Verdict | Meaning |
|---|---|
| `PASS` | Stimulus present **and** your product alerted within the deadline. |
| `FAIL` | Stimulus present but your product did **not** alert in time. This is a finding — record it in the vulnerability report. |
| `INVALID` | No extra/virtual display appeared vs baseline. The test did not exercise the control; introduce the stimulus first. |
| `NEEDS-PRODUCT-FEED` | Stimulus present and the reference detector flagged it, but no product alert log was supplied to confirm your product did. Pass `--product-alerts`. |

Exit code is `0` for PASS / NEEDS-PRODUCT-FEED, `1` for FAIL / INVALID — usable in CI.

---

## Product alert feed format

Export your product's alerts for the session as a JSON array so the runner can
assert your product itself detected the change:

```json
[
  { "timestamp": "2026-08-25T03:46:10.465Z", "type": "integrity", "message": "Multiple displays detected: extended desktop topology change" }
]
```

An alert counts as a match when its timestamp falls between the baseline and the
deadline **and** its text matches display/monitor/topology/virtual/indirect
keywords. Adjust the matcher (`ALERT_MATCH` in `validate_dc01.js`) to your
product's exact alert vocabulary.

---

## Extending to other controls

This harness is the template for the rest of the Red-Team Test Plan: snapshot a
clean baseline, verify the stimulus is genuinely present, then assert your product
detected it within a deadline. Reuse `validate_dc01.js` as the pattern for OV, VM,
BR, and the remaining domains.
