# 2026-08-14 — Proctoring Product Red-Team Test Plan (v1.0)

> **Scope:** authorized internal security test of the owner's own remote-proctoring product, executed in an isolated lab. This plan exists to harden the owner's system through detection and remediation. It is not a guide to defeating third-party proctoring.

## Front Matter

---

## 1. Purpose & Objectives

This plan governs an adversarial security assessment of the owner's remote proctoring and exam-integrity product. The purpose is to strengthen the product's ability to **detect and resist candidate-side integrity evasion** before the technique is encountered in production.

Objectives:

- Enumerate and exercise realistic evasion techniques against an instrumented build of the owner's own product.
- Measure the product's **detection coverage, detection confidence, and time-to-detection** for each technique.
- Produce prioritized, actionable remediation guidance mapped to specific detection and telemetry gaps.
- Establish a repeatable, evidence-backed baseline against which future builds are retested.

Success is defined by improved detection outcomes, not by "breaking" the product. Every exercised technique must terminate in a defender-oriented finding with a concrete hardening recommendation.

---

## 2. Scope & Authorization

**Single-owner authorization.** This engagement is authorized by, and conducted solely against, systems and software owned and operated by the product owner. No third party's product, service, or infrastructure is in scope.

**Isolated lab only.** All activity occurs inside a private, network-isolated laboratory using the owner's own instrumented proctor build and disposable target hosts. No live examination, candidate, institution, or production environment participates.

**Defensive intent — explicit boundary.** This plan exists to **harden the owner's product only**. It is not, and must not be repurposed as, a guide to defeating, bypassing, or evading any third-party proctoring system. Techniques are documented at the level required to build detections, not to operationalize cheating. Where a technique could double as an attack recipe, detail is deliberately constrained to detection signals, telemetry, and remediation.

In scope:

- The owner's proctor client, its telemetry pipeline, and its integrity-scoring logic.
- Candidate-side environment manipulation observable to the product (display topology, virtual devices, input redirection, process and driver landscape, camera/environment channel).

Out of scope:

- Any third-party proctoring product or its countermeasures.
- Production services, real candidate data, and any Internet-facing owner asset.
- Legal, HR, or disciplinary determinations about real candidates.

---

## 3. Rules of Engagement

**In bounds:**

- Exercising cataloged techniques against disposable lab target VMs/hosts running the instrumented build.
- Installing, configuring, and observing virtual devices, drivers, and helper software on lab targets.
- Capturing telemetry, logs, screen state, and device-enumeration output as evidence.

**Out of bounds:**

- Any use of real candidate identities, biometrics, or personal data. Synthetic personas and lab-owned test accounts only.
- Any connection to production or Internet-facing systems.
- Persistence beyond the lab, exfiltration of any artifact outside the lab boundary, or reuse of techniques against non-owner systems.
- Destructive action against shared infrastructure.

**Data handling:**

- Treat all engagement output as Controlled Unclassified Information. No personally identifiable information is introduced or recorded.
- Evidence is stored only within the isolated lab evidence store and is purged on engagement close per the retention entry [confirm for your product].

**No real candidates, no production systems.** Every run uses synthetic test subjects on disposable hosts.

**Teardown:** On completion of each technique and at engagement close, target hosts are reset to a known-clean snapshot, injected drivers/devices are removed, and the lab network is returned to baseline before the next run.

---

## 4. Test Environment Setup

**Isolated network.** A physically or logically segmented lab network with no route to production or the Internet, except an explicitly gated, logged update channel if required [confirm for your product].

**Disposable targets.** Target candidate machines are VMs or bare-metal hosts provisioned from golden snapshots, one per operating system / configuration in the enrolled support matrix [confirm for your product]. Each is treated as single-use and reverted between runs.

**Instrumented proctor build.** A debug/instrumented build of the owner's proctor client with verbose integrity telemetry, decision-trace logging, and deterministic timestamps enabled. Build/version is recorded per run.

**Telemetry & log capture:** Client integrity events, device-enumeration snapshots (display topology, drivers, processes, input devices), heartbeat payloads, camera/environment-scan results, and server-side scoring decisions are captured to the lab evidence store.

**Evidence collection:** Screen recordings, device-enumeration dumps, driver/adapter inventories, and log excerpts are collected with run ID, technique ID, timestamp, and target snapshot ID.

**Reset between runs:** Revert target to golden snapshot, clear proctor state, rotate synthetic test account, verify baseline telemetry is clean before the next technique.

---

## 5. Methodology

Each cataloged threat is exercised as a discrete, time-boxed test case.

1. **Baseline enrollment.** Establish the clean enrolled state (declared display setup, device inventory, environment scan) and confirm the product records it.
2. **Technique execution.** Apply the evasion technique on the target under controlled conditions.
3. **Detection observation — the scored dimension.** Record whether the product detected the technique, through which signal, with what confidence, and how long detection took relative to technique onset. Detection, not exploit success, is the pass/fail axis.
4. **Pass/fail scoring (detection-oriented):**
   - **Pass** — the product raised a correct, actionable integrity signal at sufficient confidence within the target detection window.
   - **Partial** — detected late, at low confidence, or via a weak proxy signal only.
   - **Fail** — technique went undetected or produced no actionable signal.
5. **Time-boxing.** Each test case has a fixed exploration budget [confirm for your product, e.g. 60–90 min]; unresolved cases are logged as open and deferred rather than expanded ad hoc.
6. **Retest loop.** After remediation, the identical test case is re-executed against the new build to confirm the detection gap is closed and no regression occurred elsewhere.

---

## 6. Severity & Scoring Model

Severity is assigned along two axes: **integrity impact** (how decisively the technique defeats the intended integrity guarantee) and **detection confidence** (how reliably the current product surfaces it).

| Severity | Integrity impact | Detection confidence in current build |
|---|---|---|
| **Critical** | Technique grants sustained, undetectable access to exam content or external assistance and can invalidate a result outright. | No reliable detection; no actionable signal. |
| **High** | Technique meaningfully defeats an integrity control and is repeatable. | Absent, or weak/low-confidence signal only. |
| **Medium** | Technique degrades an integrity control or requires favorable conditions. | Partial detection; late or proxy signal. |
| **Low** | Technique has limited impact or is easily constrained by policy. | Detected with reasonable confidence; hardening is incremental. |

**Fix prioritization:** Prioritize by integrity impact first, then by the inverse of current detection confidence, then by ease and reliability of the proposed detection. Critical and High findings with no detection signal are remediated before lower-impact or already-partially-detected items. A technique the product cannot see at all outranks a more severe technique it already flags.

---

## 7. Reporting & Retest Workflow

- **Finding capture.** Each confirmed detection gap becomes a Finding recorded in the Vulnerability Report template, with test-case reference, observed vs. expected detection, evidence artifacts, severity justification, and remediation.
- **Triage.** Findings are reviewed with the product owner, severities confirmed, and a remediation owner assigned per finding.
- **Remediation.** Engineering implements the detection/hardening change; the change references the Finding ID.
- **Retest.** The original test case is re-run against the fixed build under identical lab conditions. Outcome is recorded in the finding's retest status and in the closing retest log (Pass / Fail / Partial, with date, tester, and build).
- **Regression check.** A sampled re-run of previously passing techniques confirms the fix introduced no new gap.
- **Sign-off.** The engagement closes when all Critical/High findings reach a resolved-and-retested state or an explicitly accepted-risk decision recorded by the owner [confirm for your product].

---

## Threat Catalog

Each threat is rated by its impact on exam integrity **if undetected**. Test cases pass when the proctoring system raises the expected signal; they fail when it does not.

### Display & Screen-Capture Evasion

Executive summary: This catalog covers eight technique classes by which an exam taker can route, duplicate, or observe the proctored display outside the field of view of a single webcam, defeating screen-only integrity assumptions. It is scoped for a defender designing detection and prevention tests against the owner's own proctoring product in an isolated lab. Each threat centers observable signals the client agent or backend can capture (enumerated display topology, GPU/adapter inventory, presence of remote-control or casting services, HDCP/output state, timing and input anomalies) and remediation that closes the gap (attestation of display topology, kiosk/secure-desktop enforcement, hardware-output policy, and human review triggers). Severity reflects impact on exam integrity if the technique goes undetected. Key structural weakness across the domain: purely software-side display enumeration can be spoofed by a sufficiently privileged local attacker, so high-assurance controls must combine client telemetry with independent signals (camera-based environment scan, network-side detection of remote sessions, and randomized live challenges). Two clarifying questions the owner should resolve before test execution: (1) What is the supported client surface — native locked-down app, or browser-based agent — since browser sandboxes cannot enumerate physical display hardware and shift several controls from prevention to detection-only? (2) Is a hardware trust anchor (TPM/attestation, managed device) in scope, or must controls assume an untrusted, user-administered endpoint? The answer materially changes achievable assurance: on an unmanaged endpoint several of these threats are only detectable probabilistically, not preventable. Logical caution: do not treat any single software display-count check as authoritative; a defender who ships only that check has built a validator, not a control.

#### [DC-01] Software virtual / headless display adapter presents a hidden second surface — Severity: High

**What it is.** A software-created virtual display (virtual monitor driver, headless GPU adapter, or OS extended-desktop virtual head) provides a rendering surface that is not physically visible to the webcam. The candidate mirrors or moves exam content, or renders helper content, onto the virtual surface while the camera sees only a clean primary monitor.

**What a cheater gains.** Local user or admin privilege on an unmanaged endpoint sufficient to install a display driver or enable an OS virtual display; no specialized hardware required.

**Detection signals to verify.**
- Logical display count greater than expected for the declared setup
- Adapter/driver strings matching known virtual-display or headless-GPU vendors, or unsigned/uncommon display drivers
- Display with no corresponding physical EDID / manufacturer serial
- Mid-session change in display topology from the enrolled baseline

**Lab test cases.**
- **DC-01-T1** — *Procedure:* In the lab, install a generic virtual-display driver and enable one extended virtual head, then start a proctored session. Repeat with the virtual head set to mirror and to extend. *Expected detection:* Client agent enumerates and reports total logical display count, adapter names, and driver identity to the backend within the session heartbeat. *Pass criteria:* Product raises a display-topology alert identifying more than one active display and flagging a virtual/synthetic adapter within 30 seconds of session start; fail if either the mirror or extend configuration is not reported.
- **DC-01-T2** — *Procedure:* Enable the virtual display AFTER the integrity check passes but before the first question loads. *Expected detection:* Continuous (not one-shot) topology monitoring detects the mid-session addition. *Pass criteria:* Alert fires within one heartbeat interval (target under 60s) of the display being added; fail if only start-of-session state is evaluated.

**Remediation.**
- Enumerate display topology at start and continuously via heartbeat; alert on any count above one and on virtual-adapter identity
- Require EDID/physical-panel attributes for every active display and flag displays lacking real EDID
- Enforce a single-display policy where feasible and block session start until extra heads are disabled
- Cross-check with camera-based environment scan so a spoofed software count is contradicted by physical observation

#### [DC-02] Physical extended / secondary monitor out of camera view — Severity: High

**What it is.** A second physical monitor is connected and set to extend the desktop. Exam content or reference material is dragged to the off-camera panel, or a helper views a mirrored feed there, while the single webcam frames only the primary screen.

**What a cheater gains.** Ordinary user with a spare monitor and a free video output; no elevated privilege or software installation needed.

**Detection signals to verify.**
- Two or more physical displays with valid distinct EDIDs
- Total desktop bounding area larger than a single panel resolution
- Display connect/disconnect events during the session
- Focus or window moving to coordinates outside the primary display bounds

**Lab test cases.**
- **DC-02-T1** — *Procedure:* Connect a real second monitor via a second output, set to extend, and begin the session. *Expected detection:* Agent reports two physical displays each with distinct EDID/serial. *Pass criteria:* Product blocks or alerts on the multi-monitor condition within 30 seconds and identifies two physical panels; fail if only one is reported or no alert is raised.
- **DC-02-T2** — *Procedure:* Hot-plug the second monitor mid-exam. *Expected detection:* Display hot-plug event captured by continuous monitoring. *Pass criteria:* Alert within one heartbeat interval of the hot-plug; fail if undetected until session end.

**Remediation.**
- Enforce single-active-display policy; refuse session start while extended displays are present and instruct candidate to disconnect
- Monitor cursor/window coordinates and flag activity outside the primary display rectangle
- Trigger a camera environment pan/room scan at enrollment to visually confirm monitor count
- Log display serials at enrollment and alert on any additional serial appearing later

#### [DC-03] HDMI splitter or capture card duplicating exam output to a second device — Severity: Critical

**What it is.** An HDMI/DisplayPort splitter or an inline capture card (or a capture card used as a pass-through monitor) duplicates the video signal to a second screen or recording device viewed by an accomplice. The host OS may see only a single normal monitor, so software display enumeration alone does not reveal the duplication.

**What a cheater gains.** Physical hardware between the machine and its display; may strip HDCP. No software footprint on the exam machine in the pure pass-through case.

**Detection signals to verify.**
- Display EDID/vendor matching capture-card or HDMI-encoder devices
- Monitor model/serial that does not correspond to a consumer display
- Output-protection (HDCP) negotiation failure or downgrade
- USB/PCIe capture-device presence in hardware inventory when the client can enumerate peripherals

**Lab test cases.**
- **DC-03-T1** — *Procedure:* Insert a capture card as a pass-through display so the OS enumerates a single monitor whose EDID is the capture device, then run a session. *Expected detection:* EDID/monitor-model inspection flags a capture/encoder device rather than a consumer panel; HDCP/output-protection state query reports an unexpected sink. *Pass criteria:* Product raises a hardware-sink anomaly when the display EDID matches capture-device signatures or when protected-output negotiation fails; fail if a capture EDID is accepted as a normal monitor.
- **DC-03-T2** — *Procedure:* Attempt to render a short HDCP-protected/output-protected test surface and observe whether the sink honors protection. *Expected detection:* Output-protection API reports the display cannot receive protected content or that protection was stripped. *Pass criteria:* Session is blocked or flagged when protected output cannot be established; fail if protection state is never queried.

**Remediation.**
- Query display EDID and maintain a deny-list of known capture/encoder sink signatures
- Where the platform supports it, require successful protected-output negotiation for the exam surface and block on failure
- Enumerate connected USB/PCIe devices and flag capture-class hardware
- Because pure pass-through leaves little software trace, escalate to camera-based room scan and randomized live-presence challenges as the compensating control

#### [DC-04] Wireless screen mirroring / casting to a nearby device — Severity: High

**What it is.** The candidate mirrors the display over Miracast, AirPlay, Chromecast, or a vendor wireless-display stack to a phone, tablet, or TV that a helper watches, or that the candidate uses as a second reference surface off camera.

**What a cheater gains.** User-level access to OS casting features; a receiver device on the same network or via direct wireless. No installation on the exam host in some OS-native cases.

**Detection signals to verify.**
- Active wireless-display/mirroring session reported by OS API
- Appearance of a wireless virtual display adapter in topology
- Cast/mirror service-discovery traffic in the local environment
- Sudden framerate/GPU-load changes consistent with an active encode-for-cast pipeline

**Lab test cases.**
- **DC-04-T1** — *Procedure:* Initiate OS-native wireless display mirroring to a lab receiver during a session. *Expected detection:* Agent detects an active wireless-display / cast session via OS API or the appearance of a virtual mirroring display device. *Pass criteria:* Alert within 30 seconds of the cast session starting, identifying an active mirroring/cast state; fail if casting proceeds silently.
- **DC-04-T2** — *Procedure:* Have a cast receiver advertising on the local network while the candidate machine is present. *Expected detection:* Network-side or client-side discovery of cast-protocol advertisements (mDNS/SSDP-class service discovery) recorded as an environmental risk signal. *Pass criteria:* Product logs presence of cast-capable receivers as a risk factor and can correlate with an active mirror; fail if discovery signals are ignored.

**Remediation.**
- Query OS wireless-display state at start and continuously; block session while a cast/mirror session is active
- Treat any wireless mirroring virtual display the same as a second monitor for topology alerts
- Where a network vantage exists, flag nearby cast receivers as elevated environmental risk warranting closer human review
- Disable or policy-block casting on managed endpoints

#### [DC-05] Remote-control / screen-share session exposing the exam to a helper — Severity: Critical

**What it is.** Remote-desktop or screen-share tools (VNC, RDP, and commercial remote-support suites) let an off-site accomplice view the exam in real time and, in some configurations, control the keyboard and mouse. The candidate appears alone to the camera while an unseen party observes or drives the session.

**What a cheater gains.** Installed remote-access software or an active outbound remote-support session; may grant full remote input control.

**Detection signals to verify.**
- Presence of remote-access processes, drivers, or listening ports for remote protocols
- Active remote session state reported by the OS (remote interactive session flags)
- Input events lacking a local physical-device origin, or unnatural input timing regularity
- Outbound connections to remote-support relay infrastructure during the exam

**Lab test cases.**
- **DC-05-T1** — *Procedure:* Run a common remote-access/screen-share agent and establish an inbound viewing session, then start the exam. *Expected detection:* Client detects listening remote-access services, active remote sessions, or known remote-tool processes; backend correlates concurrent remote session state. *Pass criteria:* Product raises a remote-session alert within 30 seconds and names the remote-access category; fail if an active remote viewer is not detected.
- **DC-05-T2** — *Procedure:* During the exam, inject input from the remote side and compare against local human input patterns. *Expected detection:* Input-provenance / timing analysis flags input not originating from local physical HID, or highly regular remote-injected timing. *Pass criteria:* Anomalous input-source signal is recorded and, above a defined confidence threshold, an alert fires; fail if remote input is indistinguishable and unflagged.

**Remediation.**
- Enumerate running processes/services/ports and alert on remote-access categories at start and continuously
- Query OS for active remote/interactive session flags and block session start when a remote session is present
- Analyze input provenance and timing; escalate low-confidence signals to human review
- On managed endpoints, application-control policy to prevent remote-access tools from running during exams

#### [DC-06] Second-machine capture via KVM / hardware capture feeding a helper PC — Severity: Critical

**What it is.** The exam display and inputs are routed through a hardware KVM or capture-plus-input bridge to a second computer operated by an accomplice, who sees the exam and can supply answers. Because the exam host may see a single normal monitor and standard HID, host-side software has limited visibility into the downstream capture path.

**What a cheater gains.** Physical KVM/capture hardware and a second machine; potentially emulated HID that injects accomplice input as if local.

**Detection signals to verify.**
- Capture-device EDID on the video sink
- HID descriptors indicating emulated/virtual keyboard-mouse rather than known physical devices
- Input timing consistent with a network relay round trip
- Elevated end-to-end response latency on time-boxed live challenges

**Lab test cases.**
- **DC-06-T1** — *Procedure:* Route the exam host's video output through a capture bridge to a second lab PC and observe host-side signals; where an input bridge is used, drive some input from the second PC. *Expected detection:* EDID anomaly of the sink (capture device) and/or HID descriptor anomalies indicating emulated rather than genuine physical input devices. *Pass criteria:* Product flags a capture-class sink or an emulated/composite HID device within the session, or records an input-timing anomaly above threshold; fail if the full capture-and-inject path produces no signal.
- **DC-06-T2** — *Procedure:* Present a randomized on-screen live-presence challenge requiring a physically-timed response the accomplice relay would delay. *Expected detection:* Response latency distribution exceeds the single-operator baseline consistent with a relay round trip. *Pass criteria:* Latency-based challenge flags responses outside the defined local-operator time bound at the configured confidence; fail if relayed responses fall within normal bounds undetected.

**Remediation.**
- Combine EDID sink inspection with HID device attestation to flag emulated input hardware
- Deploy randomized, time-bounded live-presence challenges tuned to detect relay latency
- Correlate camera evidence (candidate looking off-screen or at a second device) with the software signals
- Where hardware trust is available, require attested devices so unrecognized capture/HID bridges are rejected

#### [DC-07] Local display-recording capturing exam content for reuse or exfiltration — Severity: Medium

**What it is.** Screen-recording or region-capture software records the exam surface. The immediate integrity impact is content theft and question-bank harvesting for redistribution, and in real-time-stream configurations it enables live off-camera collaboration.

**What a cheater gains.** User-level screen-recording software or OS-native capture; optionally streaming the recording live to a remote viewer.

**Detection signals to verify.**
- Active use of OS screen-capture/duplication APIs targeting the exam surface
- Known screen-recorder or streaming processes running
- Graphics-capture hooks or window-capture handles on the exam window
- Sustained GPU encode load consistent with continuous recording

**Lab test cases.**
- **DC-07-T1** — *Procedure:* Run a screen recorder capturing the exam window during a session. *Expected detection:* Client detects active screen-capture APIs in use, or recorder processes, or a graphics-capture hook on the exam surface. *Pass criteria:* Product raises a screen-capture-active alert within 30 seconds of recording starting; fail if recording is not detected.
- **DC-07-T2** — *Procedure:* Enable OS content-protection/exclude-from-capture on the exam surface and attempt to record it. *Expected detection:* Recording of the protected surface yields blank/black frames. *Pass criteria:* Captured output of the exam region is blanked; fail if exam content is recorded in full fidelity.

**Remediation.**
- Set OS content-protection / exclude-from-capture on the exam surface so captures blank out
- Enumerate processes and capture-API usage; alert on active recorders
- Watermark rendered content with per-session identifiers to enable post-hoc leak tracing
- Rotate/randomize question presentation to reduce the value of harvested recordings

#### [DC-08] Off-screen rendering / desktop duplication bypassing the visible primary surface — Severity: Medium

**What it is.** The attacker uses desktop-duplication or off-screen/indirect display composition so a copy of the exam frame buffer is delivered to a hidden consumer (a background window, a virtual head, or a duplication client) while the visible primary monitor shows an innocuous view. This generalizes several prior classes to the frame-buffer level, where the exam pixels are duplicated in software before or instead of reaching a physical panel.

**What a cheater gains.** User or admin access to desktop-duplication/indirect-display composition APIs; able to run a background consumer of the duplicated frames.

**Detection signals to verify.**
- Multiple or unexpected consumers of desktop-duplication/frame-capture interfaces
- Indirect/virtual display devices bound to the exam output
- Anomalous compositor or GPU state indicating duplicated presentation
- Correlation of duplication signals with virtual-adapter topology anomalies

**Lab test cases.**
- **DC-08-T1** — *Procedure:* Run a background client that opens a desktop-duplication/indirect-display consumer of the exam surface during a session. *Expected detection:* Client detects additional consumers of the display-duplication interface or an indirect-display device bound to the exam output. *Pass criteria:* Product flags an unexpected duplication consumer / indirect display within 60 seconds; fail if the duplication proceeds without any signal.
- **DC-08-T2** — *Procedure:* Combine off-screen duplication with the DC-01 virtual head to route duplicated frames to a hidden surface, then run the topology and duplication checks together. *Expected detection:* Correlated alert from both topology monitoring and duplication-consumer detection. *Pass criteria:* At least one of the two controls fires and the product records the combined risk; fail only if neither control detects the layered technique.

**Remediation.**
- Monitor for additional consumers of desktop-duplication/frame-capture interfaces and alert on unexpected ones
- Apply content-protection on the exam surface so duplicated frames are blanked
- Treat indirect-display devices as second displays for topology alerting
- Layer software signals with camera-based observation, accepting that a fully privileged local attacker requires defense-in-depth rather than a single control

### Overlay & Invisible On-Screen Assistant Windows

This catalog covers eight technique classes by which a candidate can render assistance (answers, notes, live-help chat, AI output) on screen during a proctored exam while defeating both the proctor's live view and the session recording. The unifying defensive theme is that the proctoring client cannot trust its own screen capture as ground truth: an overlay can be always-on-top yet excluded from capture (display-affinity / capture-exclusion), click-through so it never steals focus, near-transparent so a shoulder-observer misses it, or rendered through accessibility/screen-reader surfaces that never appear in a pixel buffer at all. Detection therefore has to move off the pixel buffer and onto the OS window-manager and compositor: enumerate the true top-level window list and compare it against what capture returns, read per-window affinity/exclusion and layered/opacity attributes, watch for topmost click-through style bits, and monitor accessibility API activity. Severity is rated by exam-integrity impact if undetected; capture-exclusion overlays and accessibility-rendered help are the highest-impact because they are invisible to the exact channel proctors rely on. Every test case below is lab-runnable with an objective pass/fail signal and a stated time or confidence bound. Remediations emphasize environment attestation (block or flag capture-excluded/affinity-set windows), window-list-versus-capture reconciliation, and pre-exam hardening rather than best-effort pixel analysis. Note on scope: threats are described at the class level for building detection tests; no exploit code or evasion tooling configuration is provided.

#### [OV-01] Capture-excluded overlay (display-affinity / capture-exclusion flag) — Severity: Critical

**What it is.** The candidate runs a helper window that sets a per-window capture-exclusion attribute (for example the OS display-affinity 'exclude from capture' flag or the equivalent window-sharing exclusion). The window is fully visible to the human eye on the physical monitor but is rendered as blank/black in any screen-capture or screen-share stream, including the proctoring client's own recorder and any remote-view feed. Answers, an AI chat panel, or a crib sheet can sit permanently over the exam without ever appearing in the recording or the live proctor view. This is the highest-value evasion because it defeats the exact channel proctoring relies on for evidence.

**What a cheater gains.** Can run an unsigned local application or browser-attached helper with normal user privileges; no admin/root or kernel driver required on mainstream desktop OSes.

**Detection signals to verify.**
- A top-level window enumerated by the window manager whose rectangle overlaps the exam but whose captured pixels are uniformly blank/black (window-list vs capture-buffer mismatch)
- Per-window display-affinity / capture-exclusion attribute set to a non-default value
- Total captured 'covered' screen area smaller than the union of enumerated visible window rectangles
- Recorder reports frames of a region as empty while the compositor reports it occluded

**Lab test cases.**
- **OV-01-T1** — *Procedure:* In the lab, launch a benign marker window that sets the OS capture-exclusion / display-affinity 'exclude from capture' attribute and place it over the exam surface. Have the proctoring client capture the screen while the client also enumerates all top-level windows via the window-manager API. *Expected detection:* The client's window enumeration lists a visible top-level window whose bounding rectangle overlaps the exam surface, but the corresponding pixels in the capture buffer are blank/black; the client raises a 'capture-excluded window present' alert. *Pass criteria:* Alert fires within 15 seconds of the marker window becoming visible, with the offending window's handle/title recorded. FAIL if the exclusion window is present for 30 seconds without an alert.
- **OV-01-T2** — *Procedure:* Query the per-window display-affinity / capture-exclusion attribute directly for every top-level window at exam start and at 10-second polling intervals. *Expected detection:* Any window reporting a non-default exclusion/affinity value is flagged regardless of its pixel content. *Pass criteria:* 100% of windows with the exclusion attribute set are flagged within one polling interval; zero false negatives across 10 trials.

**Remediation.**
- Reconcile the OS window list against the capture buffer every polling cycle and block/terminate the exam when a visible-but-uncaptured window is found
- Read and hard-fail on any window carrying a capture-exclusion / display-affinity attribute at exam start and continuously
- Prefer OS capture paths that ignore the exclusion flag where the platform offers a privileged capture mode, and attest that mode is active
- Refuse to start the exam if the client cannot enumerate the authoritative top-level window list

#### [OV-02] Always-on-top click-through transparent overlay — Severity: High

**What it is.** A helper window is created with topmost/always-on-top plus click-through (transparent-to-input / layered hit-test bypass) style bits so it floats above the exam, never takes keyboard or mouse focus, and passes all clicks to the browser underneath. Combined with low opacity or a small heads-up panel, it displays hints while the candidate keeps interacting normally with the exam. Focus-loss and blur heuristics never fire because focus never actually leaves the exam window.

**What a cheater gains.** Standard user process able to create layered/transparent top-level windows with input pass-through style flags; widely available via ordinary UI toolkits.

**Detection signals to verify.**
- Top-level window above the exam in Z-order with topmost + input-transparent (click-through) extended styles
- Layered window with per-window alpha set present over the exam surface
- A window that never receives focus/input events yet persistently occupies foreground Z-order
- New topmost window created within seconds of exam start or question navigation

**Lab test cases.**
- **OV-02-T1** — *Procedure:* Place a topmost click-through window over the exam. From the proctoring client, enumerate windows in Z-order above the exam and read each window's extended style bits (topmost, transparent/click-through, layered). *Expected detection:* Client flags any window positioned above the exam in Z-order that carries topmost AND input-transparent style bits. *Pass criteria:* Alert within 10 seconds identifying the window; FAIL if a topmost click-through window sits above the exam for 30 seconds unflagged.
- **OV-02-T2** — *Procedure:* While the overlay is active, drive normal typing/clicking into the exam and confirm the exam retains focus the whole time. *Expected detection:* Detection must not depend on focus loss; the client flags the overlay purely from Z-order + style inspection even though focus never leaves the exam. *Pass criteria:* Overlay flagged with exam focus continuously held; confirms focus-based heuristics alone are insufficient (documented as a coverage gap).

**Remediation.**
- Enumerate Z-order above the exam and flag/terminate on topmost input-transparent windows
- Do not rely on focus-loss detection alone; combine with window-style inspection
- Enforce exam-window topmost priority and alert if any window sorts above it
- Maintain an allowlist of expected system windows (IME, accessibility) and treat all others as violations

#### [OV-03] Near-transparent / low-opacity overlay evading human proctor review — Severity: Medium

**What it is.** The assistant window is rendered at low opacity or with a faint, high-transparency color scheme so a live human proctor watching a downscaled, compressed video thumbnail cannot perceive it, and after-the-fact reviewers skimming the recording miss it. Unlike OV-01/OV-02 the window IS in the capture buffer, but it is tuned to survive human review and lossy video compression rather than machine detection.

**What a cheater gains.** Standard user process able to set per-window alpha or use translucent rendering; trivial for any UI toolkit.

**Detection signals to verify.**
- Per-window alpha attribute below fully opaque on a non-system window
- Persistent low-contrast text-edged region in the raw capture buffer that is absent from a baseline clean capture
- Discrepancy between what the raw recorder buffer contains and what the compressed proctor thumbnail conveys
- Foreground window whose composited alpha changes on question navigation

**Lab test cases.**
- **OV-03-T1** — *Procedure:* Render a text overlay at a range of opacity levels (for example 100% down to very low) over the exam. Run the client's automated overlay-region analysis on the raw (pre-compression) capture buffer, not the streamed thumbnail. *Expected detection:* Automated analysis flags presence of a persistent semi-transparent foreground region containing text-like edges above a set opacity threshold. *Pass criteria:* Client flags overlays at and above its stated minimum-opacity detection threshold within 20 seconds; the threshold value and its false-positive rate on clean sessions (<1%) are documented.
- **OV-03-T2** — *Procedure:* Read per-window alpha/opacity attributes from the window manager for all foreground windows. *Expected detection:* Any non-system window with alpha below opaque is flagged for review independent of pixel analysis. *Pass criteria:* All sub-opaque non-system windows flagged within one 10-second polling cycle.

**Remediation.**
- Analyze the raw capture buffer, never only the compressed proctor thumbnail, for overlay detection
- Flag any non-system window with sub-opaque alpha via window-manager attributes
- Record at sufficient resolution/bitrate that after-the-fact review is not the only line of defense
- Treat human proctor review as secondary to machine window-attribute checks

#### [OV-04] Accessibility / screen-reader surface used to deliver hidden help — Severity: Critical

**What it is.** Rather than drawing pixels, the helper injects content through the OS accessibility (assistive-technology) API or a screen-reader channel: answers are spoken via TTS, pushed to a braille display, or written into an off-screen accessibility tree/live-region that a screen reader voices. Nothing assistive appears in any pixel capture because the payload never becomes on-screen pixels. This is a capture-blind channel and is especially dangerous for audio-only or braille delivery.

**What a cheater gains.** User-level process registered as (or driving) an assistive-technology client, or a browser extension writing ARIA live-regions; no elevated privileges required.

**Detection signals to verify.**
- Assistive-technology API client registered/active without a declared accommodation
- Active speech-synthesis / TTS session during the exam
- Braille display or unexpected assistive HID device enumerated
- Off-screen or visually-hidden ARIA live-region nodes and unexpected accessibility-tree mutations in the exam DOM
- Audio output activity with no corresponding on-screen visual change

**Lab test cases.**
- **OV-04-T1** — *Procedure:* During a lab exam, activate an assistive-technology client / screen reader and have it voice injected answer text. The proctoring client monitors registration and activity of accessibility API clients and TTS/speech-synthesis usage. *Expected detection:* Client flags an active assistive-technology client or speech-synthesis session that is not part of a pre-declared accommodation. *Pass criteria:* Alert within 15 seconds of the accessibility client becoming active, naming the process; FAIL if screen-reader-driven answer delivery runs 30 seconds unflagged.
- **OV-04-T2** — *Procedure:* Inject content into off-screen ARIA live-regions inside the exam browser context and confirm it is voiced without rendering visible pixels. *Expected detection:* The exam page/DOM integrity monitor flags injected off-screen live-region nodes or unexpected accessibility-tree mutations. *Pass criteria:* Injected off-screen accessibility node detected within 10 seconds; captured video shows nothing, confirming pixel capture alone would miss it.

**Remediation.**
- Enumerate active accessibility clients at exam start and continuously; require pre-declared, verified accommodations and flag all others
- Monitor the exam DOM for injected/off-screen live-regions and hidden accessibility nodes
- Monitor for active speech-synthesis sessions and unexpected assistive HID (braille) devices
- Where policy allows, capture and log audio to make the audio channel reviewable

#### [OV-05] Overlay on a second display or extended desktop outside the captured surface — Severity: High

**What it is.** The assistant window is placed on a secondary monitor, a virtual/extended desktop, or a spanned display region that the proctoring client is not capturing. The exam surface on the primary display looks clean while help lives one display over. Closely related: the candidate keeps the exam on the captured display but reads help on an uncaptured extended surface.

**What a cheater gains.** User with a second monitor, virtual display driver, or extended-desktop configuration; no special privileges.

**Detection signals to verify.**
- More than one active display output enumerated
- Presence of a virtual/indirect display driver
- Total virtual-desktop bounds larger than the captured region
- Display hot-plug event during the exam
- Cursor or window rectangles reported at coordinates outside the captured surface

**Lab test cases.**
- **OV-05-T1** — *Procedure:* Attach a second display (physical or virtual) in the lab and place a helper window on it. The proctoring client enumerates all display adapters/outputs and virtual display devices at exam start and during the exam. *Expected detection:* Client detects more than one active display output (or a virtual display driver) and blocks or flags the session. *Pass criteria:* Multi-display / virtual-display condition flagged within 15 seconds of exam start and within 15 seconds of hot-plugging a display mid-exam; FAIL if a second output stays undetected 30 seconds.
- **OV-05-T2** — *Procedure:* Confirm the client captures the full virtual desktop bounds, then verify whether any enumerated display region is outside the captured area. *Expected detection:* Client flags any display output whose bounds are not fully covered by the capture region. *Pass criteria:* Any uncaptured display region flagged before the exam is allowed to proceed.

**Remediation.**
- Enforce single-display policy: block exam start and terminate on hot-plug when more than one output is present
- Enumerate and block known virtual/indirect display drivers
- Capture the entire virtual-desktop bounds and reconcile against enumerated outputs
- Flag any window whose coordinates fall outside the captured surface

#### [OV-06] Overlay injected via compositor / GPU overlay plane or hardware-cursor layer — Severity: High

**What it is.** Content is drawn through a path that bypasses the normal desktop composition captured by software recorders: a hardware overlay/video plane, a DirectComposition/compositor visual, an injected game-style overlay, or the hardware cursor sprite. Software screen capture that reads the desktop framebuffer may miss content composited late in the pipeline or drawn as the hardware cursor, so help can be painted where the recorder does not see it.

**What a cheater gains.** User process able to create compositor visuals or an injected rendering overlay, or to set an oversized/custom hardware cursor; some techniques need only standard graphics APIs.

**Detection signals to verify.**
- Difference between desktop-framebuffer capture and a composition-inclusive capture
- Active compositor visual / overlay swapchain owned by a non-system process over the exam
- Non-default, oversized, or dynamically-updated hardware cursor sprite
- Injected module loaded into the exam browser/graphics process presenting an overlay

**Lab test cases.**
- **OV-06-T1** — *Procedure:* Render a marker through a compositor/overlay-plane path (and separately as an oversized custom hardware cursor) over the exam. Capture using the client's normal recorder and compare against a full-composition capture that includes overlay planes and the cursor layer. *Expected detection:* Client detects the discrepancy between framebuffer capture and full-composition capture, or flags a non-default hardware cursor / active overlay-plane visual. *Pass criteria:* Discrepancy or overlay-plane/custom-cursor condition flagged within 20 seconds; FAIL if the compositor-drawn marker persists 30 seconds with no signal.

**Remediation.**
- Use a capture path that includes overlay/cursor composition and reconcile it against framebuffer capture
- Detect and flag injected rendering modules in the exam process
- Flag non-default hardware cursor definitions during the exam
- Prefer OS-supported full-composition capture APIs and attest they are active

#### [OV-07] Overlay timed/gated to evade periodic sampling and go dark during capture — Severity: Medium

**What it is.** Instead of hiding spatially, the helper hides temporally: it shows help only between the proctoring client's capture samples, or detects the recorder/screenshot event (window messages, capture-session state, screen-recording indicators) and blanks itself for the duration of the frame, then restores. If the client samples the screen periodically rather than continuously, an overlay can be present the whole time yet never appear in a sampled frame.

**What a cheater gains.** User process that can observe capture/screenshot signals or the client's sampling cadence and toggle its own visibility rapidly; no elevated privileges.

**Detection signals to verify.**
- Persistent enumerated window whose captured pixels are clean only at sample instants (enumeration vs sampling mismatch)
- Window visibility/show-hide events tightly correlated with capture or screenshot events
- A process subscribing to screen-capture/screenshot state notifications
- High-frequency show/hide toggling of a foreground window

**Lab test cases.**
- **OV-07-T1** — *Procedure:* Configure a lab overlay to blank itself whenever a capture/screenshot signal is observed, then restore. Run the proctoring client with its production sampling cadence and, separately, with continuous capture, while the window enumerator runs independently of the pixel sampler. *Expected detection:* Even though sampled frames appear clean, the independent window enumerator detects a persistent top-level helper window, and/or the client detects rapid visibility toggling correlated with capture events. *Pass criteria:* Helper window detected via enumeration within 20 seconds despite clean sampled frames; visibility-toggle-on-capture correlation logged. FAIL if only the pixel sampler is used and the overlay evades all sampled frames.

**Remediation.**
- Run continuous window enumeration independent of, and more frequent than, pixel sampling; do not rely on periodic screenshots alone
- Randomize and unpredictably jitter capture timing so an attacker cannot align to the cadence
- Flag processes that subscribe to capture/screenshot notifications
- Correlate window visibility events against capture events and alert on tight coupling

#### [OV-08] Overlay hidden inside a trusted or exempt window (IME, tooltip, notification, in-browser injected panel) — Severity: High

**What it is.** The helper disguises itself as, or hides within, a window class that proctoring allowlists or ignores: an input-method-editor candidate window, a system tooltip/balloon, a notification toast, or an injected panel inside the exam browser tab (extension/userscript DOM overlay). Because these classes are commonly exempted to avoid false positives, an assistant styled as one of them can display answers over the exam while the detector skips it.

**What a cheater gains.** User process able to spoof a window class or a browser extension/userscript able to inject DOM into the exam page; standard user privileges.

**Detection signals to verify.**
- IME candidate window present with no active input-method session or composition
- Tooltip/notification-class window that persists far beyond its normal lifetime or contains large text blocks
- Foreign high-z-index absolutely/fixed-positioned DOM element over the exam not emitted by the exam app
- Browser extension / content script with access to the exam origin that is not on the approved list
- Allowlisted window class whose size, lifetime, or position is anomalous for that class

**Lab test cases.**
- **OV-08-T1** — *Procedure:* Present a helper styled/classed as an IME candidate window and, separately, a tooltip/notification-class window, over the exam. Also inject a positioned DOM panel into the exam page via a test extension. Run the client's overlay detector with its normal allowlist. *Expected detection:* Client validates allowlisted classes rather than blindly trusting them: IME window without an active IME session, a tooltip that persists beyond its lifetime, and an injected in-page DOM overlay are each flagged. *Pass criteria:* Each disguised/injected overlay flagged within 20 seconds; FAIL if any allowlisted-class impostor or injected DOM panel persists 30 seconds unflagged.
- **OV-08-T2** — *Procedure:* From the exam page context, enumerate the DOM for foreign high-z-index positioned elements and detect active browser extensions with content-script access to the exam origin. *Expected detection:* Injected high-z-index overlay nodes and unexpected content-script extensions are flagged. *Pass criteria:* Injected overlay node and/or unexpected extension detected within 10 seconds of injection.

**Remediation.**
- Validate allowlisted window classes against their expected behavior (active IME session, tooltip lifetime) rather than trusting the class label
- Run a DOM-integrity monitor in the exam page that flags foreign positioned overlay nodes
- Enumerate and restrict browser extensions with content-script access to the exam origin; run the exam in a locked-down/kiosk profile
- Bound allowlist exemptions tightly by size, duration, and position and alert on outliers

### Virtualization, Remote Access & Sandboxing

Defender-oriented threat catalog covering candidates who take a proctored exam inside virtualized, remotely-controlled, or sandboxed environments to hide unauthorized assistance or reference material. Seven threat classes span guest-VM execution, nested/hypervisor concealment, cloud remote desktops (DaaS), remote-control tools (RDP/VNC/TeamViewer/AnyDesk/Chrome Remote Desktop) driven by a helper, browser/OS containment (Windows Sandbox, containers, browser-in-browser), and hardware KVM/capture-card bridges that defeat pure-software detection. Each entry centers on signals the proctoring agent can observe (hypervisor artifacts, timing/jitter, input provenance, network topology, peripheral enumeration) and the remediation that closes the gap. Severity reflects exam-integrity impact if the class goes undetected: remote human control and undetected second-screen bridges are the highest-value attacks because they grant real-time expert assistance invisible to a webcam-only proctor. All test cases are lab-runnable with objective pass/fail criteria and time or confidence bounds. Note that no single signal is decisive; robust defense requires correlating multiple weak indicators and treating agent absence or tampering as itself a failure condition. Physical second-device use with no host bridge is only partially in scope and is flagged where relevant.

#### [VM-01] Exam executed inside a guest virtual machine to sandbox and defeat the proctor — Severity: High

**What it is.** The candidate runs the exam client or lockdown browser inside a desktop hypervisor guest (VMware Workstation/ESXi, VirtualBox, Hyper-V, QEMU/KVM, Parallels). The host remains free for unmonitored reference material, a second person, or screen recording, while the proctor only ever sees the sanitized guest. This is the foundational class: many higher-order attacks depend on first establishing a VM boundary the proctor cannot see across.

**What a cheater gains.** Candidate has admin on their own machine and can install a mainstream hypervisor. May apply commodity 'anti-detection' guest hardening to strip obvious VM branding. Cannot easily forge low-level CPU timing or eliminate all paravirtual driver artifacts without deep expertise.

**Detection signals to verify.**
- Hypervisor-present CPUID leaf and hypervisor vendor signature
- RDTSC / CPUID instruction timing latency consistent with trap-and-emulate
- SMBIOS/DMI, disk model, and MAC OUI strings matching known hypervisor vendors
- Paravirtual devices and guest-tools drivers/services enumerated in the device tree
- Absence of expected physical peripherals (real GPU, battery, thermal sensors) on a purported laptop

**Lab test cases.**
- **VM-01-T1** — *Procedure:* In the lab, launch the exam client inside each target hypervisor guest with default settings. Record whether the agent flags a virtualized environment at session start. *Expected detection:* Agent raises a 'virtual machine detected' integrity event before the exam is allowed to begin. *Pass criteria:* PASS if VM is flagged in 100% of default-config guests within 60 seconds of client launch; FAIL if any default guest starts the exam with no VM event.
- **VM-01-T2** — *Procedure:* Repeat with commodity guest-hardening applied (renamed SMBIOS/DMI strings, removed guest additions, adjusted MAC OUI). Confirm the agent still detects virtualization via signals that do not rely on vendor branding. *Expected detection:* Detection persists using timing (CPUID/RDTSC virtualization latency), hypervisor CPU leaf presence, or paravirtual device topology rather than string matching alone. *Pass criteria:* PASS if hardened guest is still flagged in at least 90% of trials with a documented non-branding signal; FAIL if hardening reduces detection below 90%.

**Remediation.**
- Correlate multiple independent signals (timing + device topology + firmware strings) rather than any single string match
- Set policy: block or force live review when virtualization is detected, per exam risk tier
- Treat inability to read host-level attestation as elevated risk, not as pass
- Keep the detection signal set updated against current hardening techniques and re-baseline periodically

#### [VM-02] Nested virtualization or hypervisor-level concealment to hide the outer control layer — Severity: High

**What it is.** A hypervisor runs beneath the visible OS (nested VM, or a thin type-1/hypervisor shim) so the proctor's environment is itself a guest, while an outer layer the agent cannot introspect hosts assistance tooling, recording, or an operator. The goal is to invert the trust relationship: the proctored OS believes it is bare metal or a benign guest, while the truly privileged layer is invisible to it.

**What a cheater gains.** Advanced candidate able to enable nested virtualization or deploy a lightweight hypervisor. Can suppress in-guest branding but generally cannot eliminate residual timing skew, clock-source anomalies, or the cost of nested VM-exits.

**Detection signals to verify.**
- Compounded instruction-timing and VM-exit latency beyond single-level virtualization
- Multiple or inconsistent hypervisor signatures across CPU leaves
- Clock-source instability and TSC/wall-clock drift under load
- Inconsistency between claimed hardware and virtualization-feature flags (nested paging, exposed VT features)

**Lab test cases.**
- **VM-02-T1** — *Procedure:* Run the exam in an L2 guest under a nested-virtualization host in the lab. Measure whether the agent distinguishes nested from single-level virtualization or at minimum still flags virtualization. *Expected detection:* Agent flags virtualization and, where supported, records signals consistent with a nested/second hypervisor layer (compounded VM-exit latency, multiple hypervisor signatures). *Pass criteria:* PASS if the nested session is flagged in 100% of trials and nested-specific timing anomaly is logged in at least 70%; FAIL if nested session is not flagged as virtualized.
- **VM-02-T2** — *Procedure:* Compare distribution of RDTSC/clock-source jitter across bare metal, single VM, and nested VM over a fixed sampling window. Verify thresholds separate the three classes without excessive false positives on real hardware. *Expected detection:* Statistical timing profile of nested environment exceeds the single-VM threshold; bare-metal samples remain below the VM threshold. *Pass criteria:* PASS if nested vs bare-metal separation achieves ≥90% true-positive at ≤5% false-positive over ≥30s of sampling; FAIL otherwise.

**Remediation.**
- Add nested-aware timing thresholds calibrated on lab bare-metal and single-VM baselines
- Escalate any confirmed virtualization on high-stakes exams to human review regardless of nesting depth
- Log confidence bands rather than a boolean so borderline nested cases are triaged, not silently passed
- Where the platform supports it, require hardware-backed remote attestation of the boot chain

#### [VM-03] Exam run on a cloud desktop / DaaS instead of the local proctored machine — Severity: High

**What it is.** The candidate connects to a cloud-hosted Windows/Linux desktop (AWS WorkSpaces, Azure Virtual Desktop, Windows 365, Shadow, a rented GPU/VPS) and runs the exam there, or runs the proctor locally while doing real work on the remote desktop. The local endpoint becomes a thin viewport; the actual work environment lives in a data center the proctor cannot inspect.

**What a cheater gains.** Candidate can provision a consumer or enterprise cloud desktop and connect over a remote-desktop protocol. Limited ability to disguise datacenter network origin, virtualized instance hardware, or remote-session presence.

**Detection signals to verify.**
- Public IP / ASN reputation indicating cloud/hosting provider rather than residential ISP
- Virtualized-instance hardware fingerprint (hypervisor + cloud vendor device strings)
- Active remote-desktop client process and an established session to a remote host
- Round-trip input latency and frame characteristics consistent with a remote session
- Extra display outputs or capture sinks beyond the single expected screen

**Lab test cases.**
- **VM-03-T1** — *Procedure:* Launch the exam inside a cloud DaaS instance in the lab. Check whether the agent identifies both the virtualized instance and the datacenter/hosting network origin. *Expected detection:* Agent flags virtualization and classifies the public IP / ASN as hosting/datacenter rather than residential. *Pass criteria:* PASS if both virtualization and datacenter-origin are flagged within 60s in 100% of trials; FAIL if either indicator is missed.
- **VM-03-T2** — *Procedure:* Run the proctor locally while the candidate drives a remote cloud desktop on a second monitor/output. Verify the agent detects an active remote-desktop client session or the presence of an unaccounted display/output. *Expected detection:* Agent detects the remote-session client process, its network session, or an extra active display sink. *Pass criteria:* PASS if the remote-desktop usage is flagged in ≥90% of trials; FAIL if a local-proctor + remote-work split runs undetected.

**Remediation.**
- Add datacenter/hosting ASN classification to session risk scoring
- Enumerate active remote-desktop client and display topology at start and periodically during the exam
- Policy-block known DaaS hosting ranges for high-stakes exams, with human-review fallback
- Bind the session to expected geolocation/network profile and flag mismatches

#### [VM-04] Real-time remote control by a helper via RDP/VNC (screen and input handed to an accomplice) — Severity: Critical

**What it is.** During the exam the candidate's screen and keyboard/mouse are shared to an off-site accomplice over RDP or VNC. The helper reads the questions and drives answers in real time. The webcam shows a candidate apparently working alone, but the input originates from another human on another machine.

**What a cheater gains.** Accomplice with network reachability to the candidate machine (direct, VPN, or relay). Can operate the standard RDP/VNC stack; may attempt to run the server on nonstandard ports or tunnel it, but cannot easily eliminate the remote-input and remote-session signatures.

**Detection signals to verify.**
- Active RDP/VNC listener and established remote session on the endpoint
- Input events flagged as injected / originating from a remote-session channel rather than physical HID
- Session-state transitions (console session disconnected/redirected)
- Network flow to a peer consistent with continuous screen streaming
- Divergence between input activity and webcam-observed candidate motion

**Lab test cases.**
- **VM-04-T1** — *Procedure:* Establish an active RDP and (separately) a VNC session into the exam machine in the lab. Have the remote party generate input while the local candidate is idle. Confirm the agent detects an active remote-control session. *Expected detection:* Agent raises a remote-session event identifying an active RDP/VNC server session and remotely-injected input. *Pass criteria:* PASS if remote control is flagged within 30s of the session becoming active in 100% of trials; FAIL if any active session runs unflagged.
- **VM-04-T2** — *Procedure:* Correlate input provenance while the remote party types and the local webcam shows the candidate's hands off the keyboard. Verify the agent flags input arriving with no corresponding local human activity. *Expected detection:* Agent flags a mismatch between injected/remote input events and absent local physical input / webcam hand-motion. *Pass criteria:* PASS if input-provenance mismatch is flagged in ≥90% of trials; FAIL if remotely-driven answering with idle local candidate is not flagged.

**Remediation.**
- Enumerate remote-session state and remote-input flags continuously, not only at start
- Fuse input-provenance with webcam activity so 'answering while physically idle' is a hard alert
- Block exam start while any remote-desktop server/session is active
- Alert on new remote sessions established mid-exam and require re-verification

#### [VM-05] Remote-assistance tools (TeamViewer / AnyDesk / Chrome Remote Desktop / relay services) for helper access — Severity: Critical

**What it is.** Instead of raw RDP/VNC, the candidate uses consumer remote-support software that traverses NAT via vendor relay servers, so an accomplice connects with no port-forwarding and often through an encrypted relay that hides the peer. Same outcome as VM-04 — outside human control or viewing — but easier to set up and harder to spot by port scanning alone.

**What a cheater gains.** Non-expert candidate; these tools are one-click and relay-based. May rename or portable-launch the client, but the tool's driver/service, mirror-display components, and relay traffic patterns remain observable on the host.

**Detection signals to verify.**
- Known remote-assistance service/driver loaded (including mirror-display / input-injection drivers)
- Injected input events not tied to physical HID during an active third-party session
- Outbound connections to recognized remote-assistance relay endpoints/ASNs
- Virtual/mirror display adapter present alongside the physical display
- Process behavior (screen capture + input synthesis + steady outbound stream) matching a remote-control profile

**Lab test cases.**
- **VM-05-T1** — *Procedure:* In the lab, connect to the exam machine using each target remote-assistance tool and generate remote input. Confirm the agent identifies the tool's presence and active session by process/driver/service and relay traffic, not only by TCP port. *Expected detection:* Agent flags a known remote-assistance tool running with an active session, independent of listening-port heuristics. *Pass criteria:* PASS if each tool's active session is flagged within 30s in 100% of trials; FAIL if any tool operates undetected.
- **VM-05-T2** — *Procedure:* Rename/portable-launch the client and confirm detection persists via behavioral signals (mirror driver, injected input, relay endpoint) rather than executable name. *Expected detection:* Detection survives renaming; agent cites a non-filename signal (virtual display/mirror driver, injected input, or relay network fingerprint). *Pass criteria:* PASS if renamed client is still flagged in ≥90% of trials with a documented non-name signal; FAIL otherwise.

**Remediation.**
- Maintain and regularly update a signature/behavior list for common remote-assistance tools and their relays
- Detect on driver/service/behavior, never on executable name alone
- Block exam start when a remote-assistance agent is active and re-scan periodically during the session
- Fuse with input-provenance and webcam signals so relay-hidden peers are still caught by local behavior

#### [VM-06] OS-level sandbox / container / browser-in-browser execution to isolate and blind the proctor — Severity: Medium

**What it is.** The candidate confines the exam to a lightweight container or OS sandbox (Windows Sandbox, containers, application sandboxing) or runs a lockdown browser inside a nested/virtualized browser or a browser-in-browser overlay, so the agent's view of processes, windows, and the desktop is scoped to the container while the real desktop stays free. Weaker isolation than a full VM but often overlooked, and effective against agents that assume they see the whole host.

**What a cheater gains.** Intermediate candidate able to enable a built-in sandbox feature or run a container/nested browser. Cannot fully hide the sandbox/container runtime, the restricted process/namespace view, or the virtualized display path from a host-aware agent.

**Detection signals to verify.**
- Sandbox/container runtime artifacts and restricted process/namespace or session view
- Missing or virtualized devices expected on a full host
- Nested/embedded browser context indicators and virtualized display path
- Agent's own visibility checks (window enumeration, screen-capture completeness) returning constrained results
- Discrepancy between claimed full-screen lockdown and detectable outer surfaces

**Lab test cases.**
- **VM-06-T1** — *Procedure:* Run the exam client inside an OS sandbox and inside a container in the lab. Verify the agent detects that it is executing within a constrained/sandboxed context rather than on the full host. *Expected detection:* Agent flags sandbox/container execution (sandbox runtime present, restricted namespace/session, limited device/process visibility). *Pass criteria:* PASS if sandbox and container execution are each flagged within 60s in 100% of trials; FAIL if either runs treated as bare host.
- **VM-06-T2** — *Procedure:* Run the lockdown browser inside a nested browser / browser-in-browser overlay and attempt to display an outer reference window behind it. Confirm the agent detects nested-browser rendering or its inability to enumerate the true desktop. *Expected detection:* Agent detects nested/embedded browser context or reports that full-desktop visibility cannot be attested. *Pass criteria:* PASS if nested-browser execution is flagged, or exam is blocked for unverifiable desktop visibility, in ≥90% of trials; FAIL if the overlay setup proceeds as trusted.

**Remediation.**
- Require the agent to attest full-host visibility and treat a constrained view as failure, not pass
- Detect sandbox/container runtimes explicitly and gate exam start on them
- Enforce true OS-level full-screen with tamper checks rather than trusting an in-page lock
- Alert when process/window enumeration returns implausibly sparse results for a real desktop

#### [VM-07] Hardware KVM / capture-card bridge feeding a second machine that software cannot introspect — Severity: Critical

**What it is.** The candidate places a hardware layer between input/display and the exam machine: a hardware KVM or HDMI splitter/capture card mirrors the exam screen to a second computer (or an accomplice's), and a hardware input injector (scriptable USB HID) feeds answers back. Because the bridge is external hardware, no host software agent sees the second machine at all; only peripheral-enumeration and behavioral tells remain. This is the hardest class for a pure-software proctor and partially overlaps physical second-device threats.

**What a cheater gains.** Well-resourced candidate with commodity HDMI capture, KVM, and a programmable USB-HID device. Can defeat all in-OS process/network detection because the mirroring and injection happen below the OS on separate hardware. Cannot avoid presenting anomalous USB HID descriptors, duplicated/EDID-cloned display sinks, or non-human input timing.

**Detection signals to verify.**
- USB HID descriptors matching known programmable-injector devices or duplicated/implausible keyboard enumeration
- Inter-keystroke and mouse-movement timing distributions that are statistically non-human (too regular, paste-like bursts)
- Extra, mirrored, or EDID-cloned display sinks inconsistent with one declared monitor
- Webcam-observed candidate idle while input is being generated
- Sudden bursts of perfectly-formed answer text with no editing/backtracking behavior

**Lab test cases.**
- **VM-07-T1** — *Procedure:* Attach an HDMI splitter/capture path and a programmable USB-HID injector in the lab. Have the injector type answer text. Verify the agent flags anomalous HID enumeration and/or non-human input timing even though no remote software is present. *Expected detection:* Agent flags a suspicious/duplicate HID device or input whose inter-key timing distribution is statistically non-human. *Pass criteria:* PASS if injected-input or anomalous-HID is flagged in ≥85% of trials over a fixed typing sample; FAIL if hardware-injected answering runs unflagged.
- **VM-07-T2** — *Procedure:* Introduce an EDID-cloning splitter/capture sink and verify the agent detects an extra or mirrored display sink or unexpected EDID characteristics. *Expected detection:* Agent reports an additional/mirrored display path or EDID anomaly inconsistent with a single physical monitor. *Pass criteria:* PASS if the duplicated/captured display path is flagged in ≥80% of trials; FAIL if screen mirroring to a capture card is undetected.

**Remediation.**
- Enumerate USB HID and display topology at start and continuously; alert on new or duplicate sinks/devices
- Add keystroke-dynamics and mouse-dynamics anomaly scoring to catch injected input
- Fuse webcam activity with input timing so 'typing while physically idle' is a hard alert
- For highest-stakes exams, require a room/hardware pre-check and treat this class as needing live human review, since software alone cannot fully close it

### Browser & Lockdown Integrity

Defender-oriented threat catalog covering seven distinct technique classes by which a candidate can subvert a browser-based lockdown/proctoring client: opening developer tools or the console, installing malicious extensions or userscripts, tampering with the proctor client JavaScript or its telemetry, driving the browser via headless automation and the Chrome DevTools Protocol (CDP), injecting foreign modules/threads into the browser process, attaching a script or native debugger to pause and rewrite runtime behavior, and running the exam outside the intended locked-down client (unmanaged browser, spoofed client, or nested VM). Each threat is described at the level a defender needs to design a lab detection/prevention test. Every entry centers observable detection signals the product can collect and concrete remediation that closes the gap. Test cases are lab-runnable with objective pass/fail criteria and time/confidence bounds. Severity reflects impact on exam integrity if the class goes undetected. No exploit code or weaponization steps are included.

#### [BR-01] DevTools / Console open for live DOM and runtime inspection — Severity: High

**What it is.** The candidate opens browser developer tools (Elements, Console, Sources, Network) to read exam content, exfiltrate answer keys embedded in the DOM or network responses, evaluate arbitrary JavaScript against the page, edit DOM nodes to reveal hidden content, or set breakpoints. This is the lowest-effort tamper class and is often the precursor to more advanced tampering.

**What a cheater gains.** Candidate has ordinary local user rights and keyboard access; no special tooling required beyond the shipped browser.

**Detection signals to verify.**
- Client-side devtools-open heuristics (window.outerWidth/innerWidth delta, debugger-timing probes, console getter tripwires) reporting to the server
- Loss of focus/visibility events correlated with a new devtools window
- Server sees console-only API calls or object property accesses that the normal UI never triggers
- Sudden gaps in expected telemetry heartbeats coincident with a Sources/breakpoint pause

**Lab test cases.**
- **BR-01-T1** — *Procedure:* In the lab, load the exam in the proctor client, then open DevTools via each vector separately: F12, Ctrl/Cmd+Shift+I, Ctrl/Cmd+Shift+J, right-click Inspect, and the browser menu. Record which vectors raise an alert. *Expected detection:* An integrity event of type devtools_open is emitted for every vector within 2 seconds of opening. *Pass criteria:* PASS if all five vectors each generate exactly one devtools_open (or equivalent) server-side event within 2s; FAIL if any vector produces no event.
- **BR-01-T2** — *Procedure:* With DevTools open, dock it undocked (separate window) and re-run detection. Also test the timing/size heuristic by narrowing the window without opening DevTools to confirm it does not false-positive. *Expected detection:* Undocked DevTools still detected; simply resizing the window does NOT raise a devtools_open event. *Pass criteria:* PASS if undocked DevTools is flagged within 2s AND a pure window resize over 30s yields zero devtools_open events (false-positive rate 0 in the resize trial); FAIL otherwise.

**Remediation.**
- Emit a server-side integrity event on any devtools-open heuristic and treat exam continuation as conditional on its absence (fail-closed)
- Do not embed answer keys, scoring, or next-question content in the DOM or in client-readable network payloads; grade server-side
- Ship the exam in a managed lockdown build that disables DevTools at the browser-policy level rather than relying only on JS heuristics
- Correlate devtools events with a proctor review queue rather than silently continuing

#### [BR-02] Malicious browser extension or userscript injecting into the exam page — Severity: Critical

**What it is.** A candidate-installed extension, content script, or userscript-manager script runs in or alongside the exam page to read questions, auto-answer, suppress proctor overlays, forward screen content to a helper, or mutate the DOM. Extensions run with elevated privileges relative to page JS and can persist across reloads.

**What a cheater gains.** Candidate can install extensions or load an unpacked/developer extension before the exam; may use a general-purpose userscript manager rather than a bespoke tool.

**Detection signals to verify.**
- MutationObserver detecting nodes/attributes the client never created
- Unexpected script origins, injected <script>/<style>, or overridden globals (e.g., patched fetch/XHR/addEventListener)
- Managed-browser extension inventory containing entries not on the allowlist
- Content-Security-Policy violation reports for script/connect sources

**Lab test cases.**
- **BR-02-T1** — *Procedure:* Install a benign lab content script that injects a marker DOM node and mutates one exam element on load. Start the exam and observe whether the client reports unexpected DOM mutations or injected script origins. *Expected detection:* The proctor client flags an unexpected injected node / MutationObserver anomaly and reports an extension_injection event with the offending node signature. *Pass criteria:* PASS if the injected marker triggers an integrity event within 5s of page load; FAIL if the marker persists undetected through one full question.
- **BR-02-T2** — *Procedure:* Enumerate the browser's loaded extensions in the lockdown build via the product's allowlist check. Load one extension that is not on the allowlist. *Expected detection:* The non-allowlisted extension is detected and either blocks exam start or raises a high-severity event. *Pass criteria:* PASS if exam start is blocked OR a high-severity extension_present event fires before question 1 is shown; FAIL if the exam proceeds with no event.

**Remediation.**
- Run the exam only in a managed lockdown build that enforces an extension allowlist (block all others) via enterprise policy
- Serve the exam under a strict CSP with report-uri, and treat any script-src/connect-src violation as an integrity event
- Baseline the expected DOM and globals at load; alert on deviation (injected nodes, patched prototypes)
- Isolate exam rendering (e.g., closed shadow DOM / dedicated origin) to reduce content-script reach and make injection observable

#### [BR-03] Tampering with the proctor client JavaScript or its telemetry channel — Severity: Critical

**What it is.** The candidate modifies, replaces, or neutralizes the proctor client's own code or the data it sends: disabling event listeners, stubbing the telemetry/heartbeat uploader, forging 'all clear' signals, replaying cached responses, or serving a patched client via a local proxy. The goal is to keep the exam running while the integrity signal is silently defeated.

**What a cheater gains.** Candidate can intercept/modify client responses locally (local proxy, cache poisoning, host redirection) or override client functions at runtime.

**Detection signals to verify.**
- Server-side heartbeat watchdog observing gaps, out-of-order, or duplicated (replayed) telemetry
- Subresource Integrity failures or bundle-hash/signature mismatch at load
- Telemetry lacking a per-session nonce/sequence or failing server-side signature checks
- Anomalous timing: events that should co-occur (focus loss + report) arriving decoupled or never

**Lab test cases.**
- **BR-03-T1** — *Procedure:* In the lab, override the client's telemetry-send function with a no-op after load, then trigger events that should be reported (blur, paste, second screen). Observe the server. *Expected detection:* The server detects the missing/altered heartbeat via a fail-closed watchdog and flags telemetry_loss, ending or pausing the exam. *Pass criteria:* PASS if a missing-heartbeat alert fires within one heartbeat interval + 5s and the session is paused/flagged; FAIL if the exam continues with no alert after 3 missed intervals.
- **BR-03-T2** — *Procedure:* Serve a modified copy of the client bundle (one byte changed) through a lab proxy and load the exam. *Expected detection:* Client integrity verification (SRI / signed bundle / server-side attestation) rejects the modified bundle. *Pass criteria:* PASS if the modified bundle fails to initialize the exam OR raises a client_integrity_fail event before question 1; FAIL if the tampered bundle runs normally.

**Remediation.**
- Design the telemetry channel fail-closed: absence or staleness of signed heartbeats pauses/voids the exam rather than being ignored
- Sign each telemetry message with a per-session server-issued key and monotonically increasing nonce to defeat stubbing and replay
- Serve the client with SRI and verify a server-side attestation/bundle hash before issuing exam content
- Grade and gate question delivery server-side so a neutralized client cannot self-certify

#### [BR-04] Headless automation and CDP-driven browser control — Severity: Critical

**What it is.** The exam is driven by an automation framework (headless or headful) or via a CDP/WebDriver remote-control endpoint, letting a script or a remote helper read questions and inject answers, screenshot content for an off-box solver, or run the session unattended. CDP also enables programmatic DOM/network access equivalent to DevTools without a visible UI.

**What a cheater gains.** Candidate can launch the browser with a remote-debugging port enabled or under an automation driver, or connect an automation client to a running instance.

**Detection signals to verify.**
- navigator.webdriver true, missing/inconsistent browser feature surfaces, headless user-agent or GPU/font/permission anomalies
- Presence of automation-injected global variables or WebDriver bindings
- CDP/remote-debug runtime indicators and event-loop timing signatures of programmatic input
- Input dynamics lacking human variance (instantaneous, pixel-identical, or perfectly periodic pointer/keyboard events)

**Lab test cases.**
- **BR-04-T1** — *Procedure:* Launch the exam in a browser started under a standard automation driver, then in one started with a remote-debugging/CDP port enabled. For each, check the product's automation-detection result. *Expected detection:* Automation fingerprints (navigator.webdriver, driver-injected globals, CDP-runtime indicators) are detected and reported as automation_detected. *Pass criteria:* PASS if both the driver-launched and the CDP-port-launched sessions raise automation_detected before question 1; FAIL if either starts the exam with no event.
- **BR-04-T2** — *Procedure:* Run the exam in a normal headful browser (no automation) as a control to measure false positives over a 5-minute session. *Expected detection:* No automation_detected events on a clean human session. *Pass criteria:* PASS if zero automation_detected events fire in the clean control over 5 minutes; FAIL if any false positive occurs.

**Remediation.**
- Fingerprint for automation and CDP at load and periodically; fail-closed when detected
- Enforce that the exam runs only inside the managed lockdown client that launches the browser without remote-debugging and with automation disabled
- Analyze server-side input-timing/biometric variance to flag machine-generated interaction
- Bind the session to attested launch parameters so a browser started with a debugging port cannot obtain exam content

#### [BR-05] Process or module injection into the browser process — Severity: High

**What it is.** A foreign module, library, or thread is injected into the running browser process (OS-level module injection, function hooking, or memory patching) to read or alter exam data, hook input, or disable integrity checks from below the JavaScript layer where page-level defenses cannot see it.

**What a cheater gains.** Candidate has local rights sufficient to run a helper process that attaches to or injects into the browser; may use general-purpose injection utilities rather than a bespoke tool.

**Detection signals to verify.**
- Loaded-module inventory containing unsigned or non-allowlisted DLLs/dylibs/.so in the browser process
- Foreign remote threads, unexpected memory-region protections (writable+executable), or hooked API prologues in the browser process
- Integrity-check functions returning altered results versus a known-good baseline
- OS security telemetry (code-signing/notarization violations) for the browser process

**Lab test cases.**
- **BR-05-T1** — *Procedure:* In the lab, load a benign, signed marker module into the browser process address space using a standard OS injection method. Check whether the lockdown client's process-integrity monitor reports an unexpected loaded module. *Expected detection:* The monitor enumerates loaded modules and flags the non-allowlisted/unsigned module as module_injection. *Pass criteria:* PASS if the injected marker module is flagged within 10s of injection and the session is paused/flagged; FAIL if it remains undetected for one full question.
- **BR-05-T2** — *Procedure:* Attempt injection while the lockdown client's tamper protection is active and record whether injection is prevented outright versus merely detected. *Expected detection:* Injection is blocked or immediately alerts. *Pass criteria:* PASS if injection is prevented OR a high-severity alert fires within 10s; FAIL if injection succeeds silently.

**Remediation.**
- Ship a lockdown client with process-integrity/anti-injection protection that enumerates modules and blocks/alerts on foreign code
- Enforce OS code-integrity policies (signed-module enforcement, hardened runtime) for the exam browser
- Run the exam only on managed endpoints where local injection privileges are constrained
- Corroborate client integrity with server-side attestation so a subverted process cannot self-report healthy

#### [BR-06] Debugger attach to pause and rewrite runtime behavior — Severity: High

**What it is.** The candidate attaches a JavaScript debugger (via Sources/breakpoints or a remote debug endpoint) or a native debugger to the browser process to halt execution, inspect/modify variables, skip integrity checks, alter answers or scoring logic in memory, or freeze the timer and telemetry while working offline.

**What a cheater gains.** Candidate can set breakpoints in page code or attach a native debugger to the browser process with local rights.

**Detection signals to verify.**
- debugger-statement timing probes showing multi-second execution stalls
- Heartbeat/timer discontinuities and monotonic-clock jumps inconsistent with wall-clock progress
- OS debugger-present flags on the browser process
- Breakpoint-induced gaps between paired events (e.g., answer submit vs. integrity check)

**Lab test cases.**
- **BR-06-T1** — *Procedure:* Set a breakpoint in the exam's script and pause execution for 60 seconds, then resume. Observe whether the server detects the stall via heartbeat/timer discontinuity. *Expected detection:* A debugger-timing tripwire and/or server heartbeat gap flags execution_paused / debugger_detected. *Pass criteria:* PASS if a debugger_detected or telemetry_loss event fires within one heartbeat interval + 5s of the pause; FAIL if the 60s pause leaves no server-side trace.
- **BR-06-T2** — *Procedure:* Attach a native debugger to the browser process and set a software breakpoint; check whether the process-integrity monitor detects the attached debugger. *Expected detection:* Debugger-present indicator raises a high-severity event. *Pass criteria:* PASS if a debugger-present alert fires within 10s of attach; FAIL if the debugger remains undetected for one full question.

**Remediation.**
- Use debugger-timing tripwires plus a fail-closed server watchdog that voids/pauses on execution stalls
- Enforce server-authoritative timing (exam clock and question gating computed server-side, not from client-reported time)
- Enable anti-debug protection in the lockdown client and disable remote JS debugging at browser-policy level
- Route scoring and integrity verification server-side so an in-memory patch cannot change the recorded outcome

#### [BR-07] Running the exam outside the intended lockdown client (unmanaged browser, spoofed client, or nested VM) — Severity: Critical

**What it is.** Rather than defeating a control inside the client, the candidate avoids the client entirely: taking the exam in a normal unmanaged browser, spoofing the lockdown client's identity/user-agent/attestation to the server, or running the whole locked-down environment inside a VM so a second, unmonitored machine or host displays the content to a helper.

**What a cheater gains.** Candidate controls the endpoint and can present a fake client identity to the server or nest the exam environment inside virtualization/remote-display.

**Detection signals to verify.**
- Absence of a valid, per-session, cryptographically signed lockdown-client attestation at handshake
- User-agent/client-identity claims not backed by attestation (spoof mismatch)
- Hypervisor/VM artifacts (CPUID/timing/device signatures) and remote-display/screen-sharing indicators
- Multiple concurrent or geographically inconsistent sessions bound to one candidate token

**Lab test cases.**
- **BR-07-T1** — *Procedure:* Attempt to open the exam URL directly in a standard, unmanaged browser (no lockdown client). Then attempt to connect while presenting the lockdown client's user-agent/identity string but without a valid attestation token. *Expected detection:* Server refuses to deliver exam content without a valid, cryptographically attested lockdown-client handshake; UA spoofing alone does not pass. *Pass criteria:* PASS if both attempts are denied exam content and logged as client_attestation_fail; FAIL if either the plain unmanaged browser or the UA-spoofed session receives question 1.
- **BR-07-T2** — *Procedure:* Run the lockdown client inside a virtual machine and inside a remote-display session; check the product's virtualization/remote-session detection. *Expected detection:* VM/hypervisor and remote-display indicators are detected and raise environment_untrusted. *Pass criteria:* PASS if both the VM and the remote-display sessions raise environment_untrusted before question 1; FAIL if either proceeds with no event, with a target false-positive rate under 1% on a clean bare-metal control.

**Remediation.**
- Gate all exam content on a server-verified, cryptographic client-attestation handshake; never trust user-agent or self-declared identity
- Detect virtualization and remote-display environments and block or escalate per policy
- Bind each session token to a single attested client instance and reject concurrent/duplicate use
- Require the managed lockdown client (not a general browser) as the only path to content, enforced server-side

### Input & Peripheral Channels

Defender-oriented threat catalog covering how candidates can subvert exam integrity through the input/peripheral layer: a second or hidden keyboard, programmable macro keypads, HID-injection ("keystroke injection") devices, KVM switches routing input to a hidden helper, software autotype/clipboard-injection tools, foot pedals, and wireless HID relays. Each threat is framed at the level a defender needs to design a detection or prevention test. The core defensive challenge across this domain is that the operating system presents most of these devices as a single, legitimate HID keyboard/mouse stream, so detection must lean on device enumeration, timing/cadence analysis of the keystroke stream, clipboard/injection heuristics, and environment attestation rather than on any single "malicious device" flag. Seven threats (IN-01 through IN-07) are provided with observable detection signals, remediation, and lab-runnable test cases carrying objective pass/fail criteria. Severity reflects impact on exam integrity if the technique goes undetected.

#### [IN-01] Second or hidden physical keyboard providing parallel input — Severity: High

**What it is.** The candidate connects a second keyboard (wired or wireless) in addition to the sanctioned one. The hidden keyboard is used by the candidate, or by an off-camera helper, to type answers, trigger navigation, or drive assistive tooling while the primary keyboard stays in frame for the camera. Because both devices enumerate as standard HID keyboards, the OS merges their events into one input stream, so the extra device is invisible unless the proctoring agent inspects device enumeration or per-device event origin.

**What a cheater gains.** Physical access to the test machine's USB/Bluetooth interfaces and the ability to attach an additional off-camera input device; optionally a second person operating it.

**Detection signals to verify.**
- More than one HID device with keyboard usage page enumerated at session start or appearing mid-session
- USB/Bluetooth device-connect events after the integrity baseline is captured
- Keystroke stream showing two distinct hardware timing fingerprints (e.g. differing repeat-rate and scan-code characteristics)
- Input events arriving while the on-camera keyboard shows no hand movement (cross-correlate with webcam if available)

**Lab test cases.**
- **IN-01-T1** — *Procedure:* In the lab, connect one approved keyboard, then attach a second USB keyboard mid-session. Confirm the agent enumerates connected HID keyboards at session start and continuously (poll interval documented). *Expected detection:* Agent raises a 'multiple keyboard devices present' alert identifying that two HID keyboards of usage-page keyboard are enumerated. *Pass criteria:* Alert fires within 15 seconds of the second keyboard being connected AND records both device identifiers; no alert on the single-keyboard control run (zero false positives across 10 control runs).
- **IN-01-T2** — *Procedure:* With two keyboards attached, alternate typing between them and capture the agent's per-device event attribution or aggregate keystroke log. *Expected detection:* Agent flags input originating from a device other than the one active/registered at enrollment, or flags device-count change during the exam. *Pass criteria:* Every switch to the second device produces a logged anomaly within 5 seconds; log distinguishes the two source devices where the OS exposes device handles.

**Remediation.**
- Enumerate all HID keyboards at baseline and continuously; hard-block or alert on count greater than one
- Bind the session to a single registered input device handle and flag events from any other handle
- Alert on any HID connect event after baseline capture and require re-attestation
- Where policy permits, enable a lockdown mode that rejects newly attached input devices during the exam

#### [IN-02] Programmable macro keypad delivering pre-loaded content on one keypress — Severity: High

**What it is.** A programmable macro keypad, macro-capable mechanical keyboard, or gaming device is loaded with stored text (answers, formulas, code snippets) that is emitted as a burst of keystrokes when a single physical key is pressed. To the OS this looks like an ordinary keyboard typing very fast. The distinguishing observable is the cadence: hundreds of characters appear with near-uniform, machine-regular inter-key timing and no realistic human error/correction pattern.

**What a cheater gains.** Ability to pre-program a consumer macro device before the exam and press a trigger key during it; no software install on the exam machine required.

**Detection signals to verify.**
- Sustained typing rate exceeding a human-plausible ceiling
- Abnormally low variance in inter-key intervals (machine-regular cadence)
- Long insertions with zero backspaces/corrections and no pauses
- Identical byte-for-byte text blocks recurring across attempts or candidates

**Lab test cases.**
- **IN-02-T1** — *Procedure:* Program a macro device to emit a 200-character block on one keypress. Trigger it inside the exam input field and capture the agent's keystroke-timing analysis. *Expected detection:* Agent flags a keystroke burst whose inter-key intervals fall below a human-plausible floor and whose variance is abnormally low. *Pass criteria:* Burst is flagged when sustained typing exceeds a defined rate threshold (e.g. > 20 chars/sec sustained over > 1 sec) with inter-key standard deviation below the human baseline; flagged within 3 seconds of the burst.
- **IN-02-T2** — *Procedure:* Run 10 genuine human typing sessions of comparable text as controls against the same detector. *Expected detection:* Detector separates machine bursts from human typing. *Pass criteria:* Zero of 10 human control sessions are flagged as macro bursts (false-positive rate 0%) while all macro triggers from IN-02-T1 are flagged (true-positive rate 100%).

**Remediation.**
- Implement server-side and client-side keystroke-cadence analysis with a documented human-plausibility model
- Rate-limit or challenge on burst insertions that exceed the ceiling
- Compare submitted long-form text against a corpus to detect verbatim reuse
- Log inter-key timing so reviewers can audit flagged bursts

#### [IN-03] HID keystroke-injection device (BadUSB-class) autotyping content — Severity: Critical

**What it is.** A device that presents itself as a keyboard but is actually a small programmable microcontroller (BadUSB / Rubber-Ducky-class) injects a scripted sequence of keystrokes to type answers, open helper resources, or manipulate the exam UI. It differs from a macro keypad in that it needs no human trigger and can act autonomously and covertly. Defensively it is characterized by unattended, perfectly-timed input bursts and by device descriptors that may not match a genuine consumer keyboard.

**What a cheater gains.** Ability to plug in a small programmable HID device; the device runs its own stored script without any software installed on the host.

**Detection signals to verify.**
- Keystroke bursts with no accompanying human presence/motion signal
- Newly enumerated HID device with descriptor not matching enrolled hardware
- Machine-exact inter-key timing identical to IN-02 signature but unattended
- Automated focus changes, window switches, or navigation not initiated by observed user action

**Lab test cases.**
- **IN-03-T1** — *Procedure:* Attach a programmable HID device configured to inject a benign scripted keystroke sequence after a delay. Observe whether the agent detects input with no corresponding human presence. *Expected detection:* Agent flags automated input: a keystroke burst occurring while webcam/presence signals show no hand-on-keyboard activity, or input timing that is machine-exact. *Pass criteria:* Injection is flagged within 5 seconds of onset AND the event is correlated with 'no human input motion' where presence sensing exists; logged with device identifier.
- **IN-03-T2** — *Procedure:* Compare the injecting device's USB descriptor (vendor/product identifiers, HID report descriptor) against an allowlist of enrolled devices. *Expected detection:* Agent flags a device whose descriptor is not on the enrolled allowlist or newly appears mid-session. *Pass criteria:* Non-allowlisted HID keyboard device is flagged at connect time in 100% of trials; enrolled device produces no alert.

**Remediation.**
- Maintain a device allowlist keyed on descriptor and connection identifier; block/alert on unknowns
- Correlate input events with webcam presence/motion to detect unattended typing
- Alert on any HID connect after baseline and require re-verification
- Use OS lockdown/USB-policy controls to restrict new HID devices during the exam

#### [IN-04] KVM switch routing keyboard/mouse to a hidden helper machine — Severity: Critical

**What it is.** A hardware KVM (keyboard-video-mouse) switch or a video-capture-plus-input-injection rig lets the candidate share their keyboard and mouse with a second, off-camera computer, or lets a remote helper on that second machine drive input. The exam machine sees a normal keyboard/mouse; the candidate can toggle between machines or mirror the exam screen to a helper who types responses back. Observables include the same keystroke stream showing two distinct human timing fingerprints, brief input dropouts at switch points, and mismatches between on-camera hand activity and received input.

**What a cheater gains.** Ability to interpose a KVM/capture device between input peripherals and the exam machine and to operate or share control with a second computer/helper.

**Detection signals to verify.**
- Periodic input-stream gaps or HID re-enumeration coinciding with control switches
- Two distinct human keystroke-timing fingerprints within one session
- Received input while webcam shows no hand movement
- Second-display/HDMI-sink presence or unexpected external video output detected at OS level

**Lab test cases.**
- **IN-04-T1** — *Procedure:* Insert a KVM between the keyboard/mouse and the exam machine. Toggle input control on and off during typing and capture the agent's input-continuity and timing logs. *Expected detection:* Agent flags input-stream discontinuities (gaps/reconnect events) at switch points and/or a change in keystroke timing fingerprint indicating a different operator. *Pass criteria:* At least one switch-related anomaly (device re-enumeration, focus loss, or timing-fingerprint change) is logged within 10 seconds of each toggle across 10 trials.
- **IN-04-T2** — *Procedure:* Have a helper on the second machine type an answer while the on-camera candidate's hands are still. Cross-correlate received input with webcam motion. *Expected detection:* Agent flags received input during observed hand-inactivity (input/motion mismatch). *Pass criteria:* Every helper-typed segment during hand-inactivity is flagged within 5 seconds; false-positive rate below 5% across 10 genuine-typing controls.

**Remediation.**
- Detect and alert on external/mirrored displays and unexpected video sinks
- Monitor input-stream continuity and re-enumeration events; alert on repeated gaps
- Cross-correlate input with webcam presence/motion to catch operator mismatch
- Where policy permits, block secondary displays and require single-monitor attestation

#### [IN-05] Software autotype and clipboard-injection tools inserting stored answers — Severity: High

**What it is.** A software tool running on the exam machine (autotype utility, text-expander, password-manager-style autotype, or clipboard manager) inserts stored text into the exam field via simulated keystrokes or programmatic paste. Unlike hardware injection this leaves host-side traces: the offending process, synthetic-input API usage, and large clipboard-to-field transfers. Observables include paste events into answer fields, injected-input flags exposed by the OS, and long insertions with no keystroke events at all.

**What a cheater gains.** Ability to run background software on the exam machine and invoke synthetic-input or paste APIs; defeated by strong lockdown but common on unmanaged devices.

**Detection signals to verify.**
- OS-reported synthetic/injected input flag on events
- Field content growing with no matching hardware keystroke events
- Paste events and large clipboard-to-field transfers
- Presence of known autotype/text-expander/clipboard-manager processes in the process list

**Lab test cases.**
- **IN-05-T1** — *Procedure:* Use a text-expander/autotype tool to inject a stored block into the exam field. Capture whether the agent detects synthetic (injected) input versus physical keystrokes. *Expected detection:* Agent flags input carrying the OS 'injected/synthetic' marker or text appearing in the field with no corresponding hardware keystroke events. *Pass criteria:* Injected block is flagged within 3 seconds in 100% of trials; the flag records the injection method (synthetic-input vs paste).
- **IN-05-T2** — *Procedure:* Paste a large clipboard payload into the answer field. Observe clipboard/paste monitoring. *Expected detection:* Agent flags a paste event and/or a field content jump inconsistent with typed input. *Pass criteria:* Paste of more than a defined threshold (e.g. > 40 chars in one event) is flagged within 2 seconds; clipboard source logged where available; zero false positives on normal typing controls.

**Remediation.**
- Reject or flag events marked as synthetic/injected by the OS
- Disable or monitor paste into answer fields; log and alert on large pastes
- Enumerate running processes and alert on known autotype/clipboard tooling
- Prefer a locked-down browser/kiosk mode that blocks synthetic input and clipboard access during the exam

#### [IN-06] Foot pedal or concealed input trigger for stealth signaling and paste — Severity: Medium

**What it is.** A programmable foot pedal (or other concealed switch enumerating as an HID device) is mapped to a keystroke or macro, letting the candidate trigger a paste, advance a helper's script, or send a covert signal without any visible hand movement. Because feet and under-desk devices are off-camera, the tell is input events that occur with no observed hand activity and an extra low-key-count HID device in the enumeration.

**What a cheater gains.** Ability to attach an off-camera programmable pedal/switch and map it to an input action before the exam.

**Detection signals to verify.**
- Extra HID input device enumerated beyond enrolled peripherals
- Input events with no corresponding hand movement on camera
- Recurring single-event triggers with identical scan code at irregular intervals
- Device connect after baseline capture

**Lab test cases.**
- **IN-06-T1** — *Procedure:* Attach a foot pedal mapped to a keystroke/macro. Confirm the agent enumerates it and identifies it as an additional HID input device. *Expected detection:* Agent flags an additional HID input device beyond the enrolled keyboard/mouse. *Pass criteria:* The pedal is detected and flagged as an unenrolled HID input device within 15 seconds of connection in 100% of trials.
- **IN-06-T2** — *Procedure:* Activate the pedal to emit its mapped action while the candidate's hands are visibly on the desk and still. *Expected detection:* Agent flags input received during observed hand-inactivity. *Pass criteria:* Each pedal activation during hand-inactivity is flagged within 5 seconds; correlated with webcam motion where available.

**Remediation.**
- Enumerate and allowlist all HID input devices; flag any beyond keyboard and mouse
- Correlate discrete input triggers with webcam presence/motion
- Require a full desk/environment scan including under-desk area at enrollment
- Alert and re-attest on any post-baseline HID connect

#### [IN-07] Wireless/Bluetooth HID relay using a phone or companion device as keyboard — Severity: High

**What it is.** A phone, tablet, or small companion device is paired over Bluetooth (or a proprietary dongle) to act as a wireless HID keyboard/mouse for the exam machine, letting a candidate or remote helper inject input from a device that is easy to conceal and hard to see on camera. The exam machine sees a Bluetooth HID keyboard; the tells are a wireless/Bluetooth transport on the input device, a device that appears mid-session, and input arriving with no local hand activity.

**What a cheater gains.** Ability to pair a Bluetooth/proprietary HID emulator (phone app or dongle) to the exam machine and drive input from it, possibly remotely.

**Detection signals to verify.**
- Input device reporting Bluetooth/wireless transport rather than the enrolled wired device
- New HID device pairing/connecting during the session
- Active Bluetooth radio with paired HID peripherals at baseline
- Input events with no corresponding activity on the on-camera keyboard

**Lab test cases.**
- **IN-07-T1** — *Procedure:* Pair a Bluetooth HID keyboard emulator to the exam machine. Confirm the agent reports the input device's transport type and enrollment status. *Expected detection:* Agent flags a keyboard whose transport is wireless/Bluetooth and/or which is not on the enrolled device allowlist. *Pass criteria:* The Bluetooth HID device is flagged at pairing/connection within 15 seconds in 100% of trials, with transport type logged.
- **IN-07-T2** — *Procedure:* Send injected keystrokes from the paired device while the on-camera keyboard is untouched. *Expected detection:* Agent flags input arriving with no observed local keyboard activity, attributed to the wireless device. *Pass criteria:* Each remote-injected segment is flagged within 5 seconds and attributed to the non-enrolled wireless device; zero false positives across 10 wired-typing controls.

**Remediation.**
- Report and allowlist input-device transport; flag or block wireless HID keyboards during the exam
- Alert on Bluetooth pairing/connection events during the session
- Require radio/Bluetooth state disclosure at enrollment and re-attest on change
- Correlate input with webcam activity to detect input from concealed wireless devices

### Identity Verification & Liveness

Defender-oriented threat catalog covering the identity and liveness attack surface of a remote proctoring/exam-integrity product. Seven threat classes are documented: static photo/video replay against face match, deepfake and virtual-camera injected feeds, proxy/impersonator test-takers, forged or substituted ID documents, mid-exam candidate swap, presentation-attack instruments (masks/printed overlays), and biometric template or enrollment poisoning. Each entry centers on the observable detection signals the product can collect (feed-injection fingerprints, active-liveness challenge responses, face-embedding continuity, document authentication, environment/device telemetry) and the remediation that closes the gap. Every test case is lab-runnable with an objective pass/fail bound. Severity reflects impact on exam integrity if the class goes undetected. This catalog is strictly for authorized testing of the owner's own system; it describes technique classes at the level needed to design detection tests and deliberately excludes working exploit code or turnkey evasion tooling.

#### [ID-01] Static photo / pre-recorded video replay against face match — Severity: High

**What it is.** An attacker defeats enrollment or periodic face-match checks by presenting a still photo (printed or on a second screen) or a looped/pre-recorded video of the legitimate candidate to the webcam, rather than a live person. This is the baseline presentation attack: the biometric matcher sees a face that matches the enrolled reference, but no live human is present. Applies to initial identity capture and to any passive re-verification during the exam.

**What a cheater gains.** Possesses a photo or video of the enrolled candidate and physical or virtual control of the camera feed; no specialized ML skills required.

**Detection signals to verify.**
- Failure to satisfy randomized active-liveness challenges (blink/turn/read-nonce on cue) within a time bound
- Absence of 3D depth / micro-parallax cues consistent with a flat surface
- Screen artifacts: moire patterns, backlight bleed, bezel edges, refresh-rate flicker
- Frame-hash or perceptual-hash loop detection indicating repeated identical frames
- Static or physiologically implausible remote-photoplethysmography (rPPG) signal (no pulse-driven skin color variation)

**Lab test cases.**
- **ID-01-T1** — *Procedure:* In the lab, present a high-resolution printed photo and a phone/tablet screen showing a still image of the enrolled reference to the webcam during the liveness/enrollment step. Repeat with a pre-recorded loop of the candidate blinking and turning. *Expected detection:* Active-liveness challenge (randomized head turn, blink-on-cue, or read-aloud prompt) fails for still images; passive PAD flags screen-bezel/moire/reflection and depth-absence for the video replay. *Pass criteria:* System raises a liveness-fail or presentation-attack alert for 100% of still-photo trials and >=95% of video-replay trials within 10 seconds of challenge issuance; zero of these trials advance to a verified state.
- **ID-01-T2** — *Procedure:* Issue five randomized active-liveness challenges and measure whether a looped recording can satisfy an out-of-band prompt (e.g., a challenge string generated after recording began). *Expected detection:* Challenge-response mismatch: recorded feed cannot answer a nonce issued at runtime. *Pass criteria:* 100% of challenges that demand post-recording responsiveness are marked failed when answered by a pre-recorded feed; median decision latency < 8 seconds.

**Remediation.**
- Require active, randomized, runtime-generated liveness challenges rather than passive capture alone
- Deploy passive PAD scoring (moire/reflection/texture/depth) as a second independent layer
- Add rPPG or micro-motion pulse detection to distinguish live skin from replay
- Bind each verification to a fresh server-issued nonce so pre-recorded media cannot pre-satisfy it
- Log and alert on repeated identical frame hashes across the session

#### [ID-02] Deepfake / virtual-camera injected feed — Severity: Critical

**What it is.** The attacker bypasses the physical camera entirely by injecting a synthetic or manipulated video stream into the capture pipeline via a virtual-camera driver, OBS-style feed, or driver shim. The injected content may be a real-time face-swap/deepfake of the enrolled candidate driven by the impersonator's movements, allowing it to pass naive active-liveness prompts. This is the highest-sophistication feed-level attack and directly undermines the trust that the camera shows the real room.

**What a cheater gains.** Can install a virtual-camera device or intercept the media pipeline and run real-time face reenactment; moderate-to-advanced technical skill.

**Detection signals to verify.**
- Presence of virtual-camera / non-physical capture devices in the OS device list
- Missing or failed hardware camera attestation / secure capture path
- Temporal and boundary artifacts (warping, blending seams, flicker) under occlusion or motion stress
- Face fails to respond correctly to an on-screen active-illumination flash (color/brightness challenge)
- Absent or inconsistent rPPG pulse signal in the synthesized face region
- Mismatch between reported camera capabilities/metadata and observed stream properties

**Lab test cases.**
- **ID-02-T1** — *Procedure:* Enumerate the OS video-capture devices seen by the proctoring client in a lab image where a virtual-camera driver is installed alongside a physical webcam. Verify the client's device-integrity/attestation check. *Expected detection:* Client flags a non-physical/virtual capture device or absence of a hardware-attested camera and blocks or elevates the session. *Pass criteria:* 100% of sessions using a registered virtual-camera device are flagged or blocked before exam entry; detection recorded in audit log with device identifier.
- **ID-02-T2** — *Procedure:* Feed a known synthetic/reenacted face stream and issue challenges targeting deepfake weak points (extreme profile turn, hand-occlusion-then-reveal, rapid lighting change from an on-screen flash). *Expected detection:* Synthesis artifacts appear: warping at occlusion boundaries, temporal inconsistency, failure to render sudden lighting on the face, or PAD/deepfake classifier score above threshold. *Pass criteria:* Deepfake/injected-feed classifier plus challenge-artifact scoring flags >=90% of injected-feed trials within 15 seconds; false-positive rate on genuine-live control set <=2%.

**Remediation.**
- Enforce device attestation and prefer hardware-backed secure capture where the platform supports it
- Detect and block known virtual-camera drivers and enumerate all capture devices at session start
- Use active-illumination (screen-flash color) challenges that physically-present faces reflect and synthesized ones do not
- Run a dedicated deepfake/injection classifier independent of the face matcher
- Correlate rPPG and micro-motion with the face-swap-prone regions; alert on absence

#### [ID-03] Proxy / impersonator test-taker (surrogate sits the exam) — Severity: Critical

**What it is.** A different person than the registered candidate takes the exam. In the simplest case the impersonator enrolls once with a real live face (their own) using the candidate's stolen credentials; the biometric is genuinely live but is the wrong identity. Liveness checks alone do not stop this, so detection depends on binding the live face to the authenticated enrolled reference and to a verified government ID.

**What a cheater gains.** Has the candidate's login credentials and a willing surrogate; may or may not possess the candidate's ID document.

**Detection signals to verify.**
- Live-face embedding distance to enrolled reference exceeds acceptance threshold
- Live-face vs ID-document-photo mismatch
- Enrollment biometric that diverges from historical sessions for the same account
- Behavioral/typing or voice biometric drift versus the account baseline (where collected)
- Geolocation/device fingerprint inconsistent with the candidate's history

**Lab test cases.**
- **ID-03-T1** — *Procedure:* In the lab, have a person other than the enrolled reference complete the full identity flow (live selfie + presented ID). Compare live face embedding against both the enrolled reference and the ID-document photo. *Expected detection:* Face-match score between the live surrogate and the enrolled/ID reference falls below the acceptance threshold, raising an identity-mismatch alert. *Pass criteria:* Face matcher rejects the surrogate at the operating threshold with false-accept rate <=0.1% on the lab impostor set; mismatch alert logged 100% of the time.
- **ID-03-T2** — *Procedure:* Test credential-only sign-in where no prior enrolled biometric exists (first-time surrogate). Verify the system forces a live-face-to-ID binding before allowing exam start. *Expected detection:* System requires a document-to-selfie match and blocks entry when the ID photo and live face do not correspond. *Pass criteria:* No session reaches exam start without a passing document-to-live face match; unmatched attempts blocked and flagged 100% of trials.

**Remediation.**
- Always bind live face to both an authenticated enrolled reference and a verified ID document, not to credentials alone
- Tune matcher operating point to a low false-accept rate and require manual review on borderline scores
- Maintain a per-account biometric history and alert on identity drift across sessions
- Add step-up verification (secondary biometric or live proctor review) when confidence is marginal
- Cross-check device and geolocation against the candidate's established profile

#### [ID-04] Forged, tampered, or substituted ID document — Severity: High

**What it is.** The attacker presents a fabricated, digitally edited, photo-substituted, or expired identity document during the document-verification step, or displays a document image on a screen rather than a physical credential. The goal is to make a mismatched or fraudulent identity pass the document check and anchor a false face-to-ID binding.

**What a cheater gains.** Can edit a document image, print a substitute, or display a stolen document scan; skill ranges from basic photo editing to template forgery.

**Detection signals to verify.**
- Failed machine-readable-zone (MRZ) or barcode checksum / field cross-consistency
- Missing or inconsistent security features (hologram, microprint, UV/IR patterns where capturable, font and layout deviations)
- Screen-capture indicators: moire, glare, pixel grid, refresh flicker on the presented document
- Digital-edit forensics: compression/noise discontinuities around the photo or text fields
- Expiry date in the past or issue data inconsistent with stated identity

**Lab test cases.**
- **ID-04-T1** — *Procedure:* Submit a set of lab documents including: a genuine physical ID, a photo-swapped edit, a screen-displayed scan, and an expired credential. Run the document authenticator. *Expected detection:* Authenticator flags missing/failed security features (hologram/MRZ checksum/font/microprint), screen-capture artifacts, edit inconsistencies, and expiry. *Pass criteria:* System correctly rejects 100% of photo-swapped, screen-displayed, and expired samples and accepts genuine controls; MRZ checksum validation fails closed on tampered zones.
- **ID-04-T2** — *Procedure:* Present a document whose face photo does not match the live candidate to confirm the document-to-selfie binding is enforced independently of document authenticity scoring. *Expected detection:* Document-face to live-face mismatch alert fires even if the document itself scores as authentic. *Pass criteria:* Mismatch between document photo and live face is flagged in 100% of trials, independent of the authenticity score.

**Remediation.**
- Validate MRZ/barcode checksums and cross-field consistency; fail closed on any tampered zone
- Require a physical document capture with glare/tilt prompts to defeat flat screen displays
- Run document forgery/edit forensics and template verification against known document types
- Enforce an independent document-photo-to-live-face match regardless of authenticity score
- Route low-confidence or novel document types to human review before binding identity

#### [ID-05] Mid-exam candidate swap after successful verification — Severity: Critical

**What it is.** The registered candidate passes the initial identity and liveness check, then a different person takes over partway through the exam, or the candidate leaves and returns while an accomplice answers. Because verification is front-loaded, integrity depends on continuous identity assurance throughout the session rather than a single gate at the start.

**What a cheater gains.** Legitimate candidate cooperates with a swap; requires only physical seat access and timing around any periodic check windows.

**Detection signals to verify.**
- Continuous face-embedding distance from the enrolled reference crossing the identity-change threshold mid-session
- Face-absence gaps exceeding a configured duration
- Multiple distinct faces detected in frame
- Discontinuities in appearance (clothing, lighting, seating) between consecutive frames
- Periodic re-liveness challenge failures or ignored prompts
- Behavioral/keystroke biometric shift versus the session's own baseline

**Lab test cases.**
- **ID-05-T1** — *Procedure:* After a genuine candidate passes initial verification, substitute a second person in front of the camera at random points during the lab session, including during and between any scheduled re-check windows. *Expected detection:* Continuous face-presence and identity monitoring detects the new face embedding diverging from the enrolled reference and raises a swap/identity-change alert. *Pass criteria:* Every swap is detected within 60 seconds of the new face appearing (or within one monitoring interval), with an identity-change alert logged; missed-swap rate 0% across trials.
- **ID-05-T2** — *Procedure:* Introduce a face-absence gap (candidate leaves frame) and a two-faces-in-frame condition (candidate plus coach). *Expected detection:* Absence-of-authorized-face and multiple-face events are flagged with timestamps. *Pass criteria:* 100% of face-absence gaps exceeding the configured threshold and 100% of multiple-face events are flagged within the monitoring interval.

**Remediation.**
- Run continuous (not one-time) identity verification with periodic randomized re-challenges
- Alert on face-absence, multiple-face, and identity-change events with tight time bounds
- Correlate continuous face embedding against the session's enrolled reference throughout
- Add behavioral biometric continuity monitoring where available
- Escalate persistent or high-confidence mid-session changes to live proctor intervention or session termination

#### [ID-06] 3D mask / wearable presentation-attack instrument — Severity: Medium

**What it is.** The attacker defeats depth- and texture-based liveness by presenting a three-dimensional artifact — a silicone/resin mask, a curved photo, a cutout with eye/mouth holes, or a high-quality face overlay — that reproduces the enrolled candidate's face with real depth and can move. This class specifically targets liveness systems that assume any 3D, moving face is genuine.

**What a cheater gains.** Can obtain or fabricate a wearable 3D facial artifact of the enrolled candidate; higher cost and effort than a flat photo.

**Detection signals to verify.**
- Unnatural skin reflectance/texture and specular response under active screen-flash illumination
- Rigid or absent micro-expressions and blink dynamics
- Visible seams, edges, or mask boundary artifacts
- Gaze that does not track randomized on-screen targets
- Absent rPPG pulse signal from non-skin material

**Lab test cases.**
- **ID-06-T1** — *Procedure:* Present lab presentation-attack instruments (paper mask with eye holes, curved photo, and a molded 3D face artifact) to the liveness system under active-illumination and micro-expression challenges. *Expected detection:* PAD flags unnatural skin texture/reflectance, rigid or absent micro-expressions, seam/edge artifacts, and abnormal specular response to screen-flash illumination. *Pass criteria:* PAD classifier flags >=95% of mask/instrument trials within 15 seconds; genuine-live control false-positive rate <=3%.
- **ID-06-T2** — *Procedure:* Issue expression and gaze challenges (smile, look to a randomly indicated corner, speak a nonce) that require coordinated eye, mouth, and skin motion. *Expected detection:* Instrument fails to produce natural coordinated micro-motion, gaze tracking, or mouth articulation. *Pass criteria:* 100% of instruments fail the coordinated expression/gaze challenge; decision logged with challenge nonce.

**Remediation.**
- Combine active-illumination challenges with material/reflectance analysis in the PAD layer
- Require coordinated expression, gaze-tracking, and speech challenges that rigid instruments cannot satisfy
- Add rPPG liveness to reject non-living materials
- Where hardware allows, use depth/IR sensing to characterize true facial geometry and texture
- Escalate borderline PAD scores to human review

#### [ID-07] Enrollment poisoning / biometric template substitution — Severity: High

**What it is.** Rather than defeating a check at exam time, the attacker corrupts the trusted reference itself: enrolling the surrogate's face under the candidate's account, injecting a manipulated reference during onboarding, or exploiting weak re-enrollment/reset flows to overwrite the stored template. Once the reference is poisoned, all later live checks pass legitimately against the wrong identity, making downstream detection ineffective.

**What a cheater gains.** Can access the enrollment/re-enrollment or account-recovery flow and submit a chosen reference; may leverage weak identity proofing at onboarding.

**Detection signals to verify.**
- New enrollment/reference embedding diverging from prior verified references or the ID-document photo
- Re-enrollment or template reset performed without step-up re-proofing
- Enrollment device/geolocation inconsistent with account history
- High rate of enrollment retries or resets on an account
- Absence of an immutable audit trail for template changes

**Lab test cases.**
- **ID-07-T1** — *Procedure:* In the lab, attempt to enroll or re-enroll a reference face that does not match the account's verified ID document, and attempt a template reset without strong re-proofing. *Expected detection:* Enrollment is gated by a document-to-face match and a strong re-proofing step; mismatched or unverified enrollment is rejected and logged. *Pass criteria:* 100% of enrollment/re-enrollment attempts lacking a passing document-to-face binding are blocked; every template change writes an immutable audit record.
- **ID-07-T2** — *Procedure:* Compare a newly enrolled reference against prior references and ID photo for the same account to detect silent identity drift at enrollment time. *Expected detection:* System flags a new reference whose embedding diverges from prior verified references or the ID photo. *Pass criteria:* Enrollment-drift detector flags 100% of substituted-reference trials for manual review before the new template becomes authoritative.

**Remediation.**
- Gate all enrollment and re-enrollment on a passing document-to-live-face binding
- Require strong step-up re-proofing for any template reset or recovery
- Detect enrollment-time identity drift against prior references and hold new templates for review
- Write immutable, tamper-evident audit logs for every template create/update/delete
- Rate-limit and alert on repeated enrollment/reset attempts and anomalous enrollment devices

### Network & Out-of-Band Communication

Defender-oriented threat catalog covering how an exam candidate can use network manipulation and out-of-band channels to receive external help or conceal activity during a proctored session. Eight threat classes are documented: VPN/proxy/anonymizer tunneling, cellular tethering to escape monitored networks, a second/companion device, live screen-streaming to a remote helper, out-of-band real-time chat channels, DNS anomalies and encrypted-DNS tunneling, remote-desktop takeover by an accomplice, and virtual camera/audio device injection. Each threat is framed around the signals the proctoring product can observe on the endpoint and network, the remediation that closes the gap, and lab-runnable test cases with objective pass/fail criteria. Severity reflects impact on exam integrity if the technique goes undetected. Descriptions stay at the class level for detection engineering and deliberately exclude working exploit code or weaponization steps. Note: several detections require an endpoint agent with network-metadata and process visibility; browser-only lockdown products will have reduced coverage against NW-02, NW-03, NW-04, and NW-07, which is itself a design finding worth surfacing to the product owner.

#### [NW-01] VPN, Proxy, or Anonymizer Tunneling to Mask Location or Bypass Controls — Severity: High

**What it is.** The candidate routes exam traffic through a commercial VPN, HTTP/SOCKS proxy, or an anonymizing overlay to hide true geolocation, defeat IP allow-lists, evade geofencing, or obscure that a second endpoint shares the candidate's identity. This can enable a remote impersonator to appear to sit in the expected region, or let the candidate mask concurrent connections to helper services.

**What a cheater gains.** Can install client software or configure OS-level network settings before the exam; can pay for commercial anonymization services; may control the local router.

**Detection signals to verify.**
- Egress IP belongs to a hosting/datacenter ASN or a known-anonymizer reputation list rather than a residential/mobile ASN
- Presence of a virtual or tunnel network adapter (TAP/TUN-style) reported by an endpoint agent
- Mismatch between IP-based geolocation and device-reported timezone, locale, or GPS
- Round-trip latency and TLS-handshake fingerprints inconsistent with the claimed geography
- Sudden egress-IP change mid-session indicating tunnel activation

**Lab test cases.**
- **NW-01-T1** — *Procedure:* In the lab, connect the exam client through three known commercial VPN egress nodes and one self-hosted proxy, then start a proctored session for each configuration. *Expected detection:* Product flags a VPN/proxy/anonymizer indicator for each of the four sessions (via egress-IP reputation, datacenter-ASN classification, or client-detected virtual network adapter). *Pass criteria:* PASS if 4 of 4 sessions raise the anonymization flag within 60 seconds of session start; FAIL if any session is scored clean.
- **NW-01-T2** — *Procedure:* Compare the geolocation asserted by the egress IP against a device-reported coarse location signal (timezone, browser locale, or agent-reported region) for a session forced through a foreign VPN node. *Expected detection:* Product raises a geolocation-mismatch alert when egress region and device-reported region disagree beyond a set threshold. *Pass criteria:* PASS if the mismatch alert fires and records both compared values; FAIL if no mismatch is logged.

**Remediation.**
- Score egress IP against datacenter-ASN and anonymizer-reputation feeds at session start and on every reconnect
- Enumerate active network adapters via the endpoint agent and flag virtual tunnel interfaces
- Cross-check IP geolocation against independent device locale/timezone signals and alert on divergence
- Treat anonymized egress as elevated risk requiring stronger identity re-verification, not automatic failure
- Record egress-IP change events with timestamps for reviewer adjudication

#### [NW-02] Cellular Tethering or Hotspot to Escape a Monitored Network Path — Severity: Medium

**What it is.** The candidate moves the exam device (or a helper device) onto a phone-provided cellular hotspot to bypass any institution-controlled network, egress filtering, or DNS inspection, and to create an unmonitored path for out-of-band coordination. Tethering also frees a second device to reach helper services without touching the exam machine.

**What a cheater gains.** Owns a smartphone with a cellular data plan; can toggle the exam device between Wi-Fi/Ethernet and a personal hotspot; may switch mid-session.

**Detection signals to verify.**
- Egress ASN classified as a mobile network operator
- Mid-session change of local IP, gateway MAC, or SSID reported by the endpoint agent
- Loss and re-establishment of connection consistent with an interface switch
- Default-gateway or adapter change events in the endpoint telemetry

**Lab test cases.**
- **NW-02-T1** — *Procedure:* Start a session on wired/Wi-Fi, then mid-exam switch the exam device to a phone hotspot and continue. *Expected detection:* Product records a network-transition event and re-classifies egress ASN as a mobile carrier, raising a mid-session network-change alert. *Pass criteria:* PASS if the transition is logged with before/after ASN and a mobile-egress flag within 90 seconds; FAIL if the switch is silent.
- **NW-02-T2** — *Procedure:* Run the full session entirely over a cellular hotspot from session start. *Expected detection:* Product identifies mobile-carrier egress and applies its policy (allow-with-flag or step-up verification) rather than treating it as trusted institutional network. *Pass criteria:* PASS if egress is classified as mobile and the configured policy action is recorded; FAIL if egress is scored as generic/trusted with no mobile classification.

**Remediation.**
- Log every network-interface and gateway change during the session as a discrete reviewable event
- Classify egress carrier type (residential, mobile, datacenter) and apply differentiated risk policy
- Pin the network context captured at identity verification and alert when it changes mid-exam
- Where policy requires a fixed proctored network, require pre-exam network attestation and block undeclared transitions

#### [NW-03] Companion Second Device for Lookups or Answer Relay — Severity: High

**What it is.** The candidate uses a phone, tablet, or additional computer on the same or a separate network to search for answers, run a chatbot, or receive a relayed answer feed while the primary exam device stays compliant. Because the second device may never touch the exam endpoint, network-only detection is limited and must be combined with environmental signals.

**What a cheater gains.** Possesses one or more additional internet-capable devices physically near the workspace; can position them off-camera.

**Detection signals to verify.**
- Additional active peers discovered during same-LAN enumeration (where permitted and disclosed)
- Repeated downward or off-screen gaze and head-pose events correlated with answer timing
- Secondary-screen glow or reflection in webcam frames
- Audio of a second device (notification tones, key taps) captured by the microphone
- Answer-latency patterns inconsistent with independent reasoning (long pause then rapid correct entry)

**Lab test cases.**
- **NW-03-T1** — *Procedure:* Place a second device on the same local network as the exam machine and generate interactive query traffic during the session. *Expected detection:* If the product performs local-network enumeration or same-LAN device discovery, it reports the count of active peers and flags an unexpected additional device. *Pass criteria:* PASS if the additional device is enumerated and flagged within the session, OR the product documents this as an accepted coverage gap; FAIL if the product silently claims a clean single-device environment.
- **NW-03-T2** — *Procedure:* Operate the second device off-camera and correlate candidate gaze/head-pose downward glances with answer-entry timing. *Expected detection:* Behavioral proctoring raises repeated off-screen-attention events time-correlated with answer submissions. *Pass criteria:* PASS if at least 80 percent of scripted glance events produce an attention-away flag; FAIL if fewer than 50 percent are flagged.

**Remediation.**
- Fuse network-enumeration signals with gaze, audio, and answer-timing analytics rather than relying on any single channel
- Require a pre-exam 360-degree room and desk scan and re-prompt on suspicion
- Flag statistically anomalous answer-latency-versus-difficulty patterns for human review
- Explicitly document second-device network blind spots to the product owner so proctoring policy compensates

#### [NW-04] Live Screen-Streaming of the Exam to a Remote Helper — Severity: Critical

**What it is.** The candidate shares or streams the exam screen in real time to an accomplice (via a conferencing app, browser-based screen share, or a streaming service) so the helper can read questions and relay answers through a separate covert channel. The exam content leaves the endpoint continuously, which produces characteristic outbound-media traffic.

**What a cheater gains.** Can run a screen-share/conferencing client or browser tab alongside the exam, or use the OS screen-capture API; has a confederate available live.

**Detection signals to verify.**
- Active screen-capture or display-duplication API usage reported by the endpoint agent
- Known conferencing/streaming/remote processes running concurrently with the exam
- Sustained outbound UDP/WebRTC media flows and elevated upstream bandwidth atypical for an exam
- A second capture surface or overlay present over the exam window
- Peer-to-peer connection establishment (STUN/TURN signaling) during the session

**Lab test cases.**
- **NW-04-T1** — *Procedure:* During a session, start an outbound screen-share to a remote endpoint using a common conferencing client and a browser-based share, one per trial. *Expected detection:* Endpoint agent detects an active screen-capture/streaming process or an unexpected foreground capture surface and raises a screen-sharing alert; network telemetry shows sustained outbound media (WebRTC/UDP) throughput. *Pass criteria:* PASS if both trials raise a screen-share/capture alert within 60 seconds; FAIL if either streaming trial goes unflagged.
- **NW-04-T2** — *Procedure:* Measure sustained outbound bandwidth and connection profile during a screen-stream versus a baseline exam session. *Expected detection:* Product flags anomalous sustained outbound throughput and peer-to-peer media session characteristics relative to the exam-only baseline. *Pass criteria:* PASS if outbound-media anomaly is flagged with recorded throughput values exceeding the baseline threshold; FAIL if traffic profile is not evaluated.

**Remediation.**
- Enforce process and display-capture monitoring; block or alert on active screen-capture surfaces during lockdown
- Baseline normal exam network profile and alert on sustained outbound media throughput
- Detect and log conferencing/streaming client processes and P2P signaling
- Where the platform supports it, deny additional capture of the exam display and terminate on violation with reviewer evidence

#### [NW-05] Out-of-Band Real-Time Chat Channels for Answer Relay — Severity: High

**What it is.** The candidate maintains a covert text or voice channel (messaging app, collaborative document, low-profile web chat, or a browser extension) to send questions to and receive answers from a helper. The channel is often low-bandwidth and intermittent, making it harder to see than streaming, and may run on a second device to avoid endpoint detection entirely.

**What a cheater gains.** Can keep a background app, hidden tab, or browser extension active; may pre-arrange a confederate; can type or dictate covertly.

**Detection signals to verify.**
- Prohibited or unexpected communication processes and browser extensions enumerated by the agent
- Frequent focus-loss, alt-tab, or clipboard-paste events during questions
- Intermittent voice or whisper activity on the microphone in a purportedly solo environment
- Low-volume periodic outbound connections to messaging/collaboration domains
- Clipboard content changes preceding answer entry

**Lab test cases.**
- **NW-05-T1** — *Procedure:* On the exam endpoint, keep a background messaging client and a hidden browser tab open and exchange messages during the session. *Expected detection:* Endpoint agent enumerates running communication processes and background/hidden tabs and raises a prohibited-application alert; focus-loss and alt-tab events are logged. *Pass criteria:* PASS if the messaging process or hidden tab is detected and at least one focus-change event is logged within 60 seconds of use; FAIL if unflagged.
- **NW-05-T2** — *Procedure:* Run the chat channel exclusively on a separate device and dictate/read covertly while the microphone is active. *Expected detection:* Audio analytics flag intermittent speech or whispering inconsistent with a solo test-taker; behavioral analytics flag correlated typing bursts. *Pass criteria:* PASS if speech-presence events are flagged during scripted dictation windows with at least 70 percent coverage; FAIL if no audio anomaly is raised.

**Remediation.**
- Enforce an application/extension allow-list during lockdown and alert on communication tooling
- Log focus-change, clipboard, and paste events and correlate them with question timing
- Apply microphone speech-presence analytics for solo-environment sessions
- Combine endpoint gaps with audio/behavioral signals to cover second-device-only channels

#### [NW-06] DNS Anomalies and Encrypted-DNS Tunneling — Severity: Medium

**What it is.** The candidate uses DNS-over-HTTPS/TLS or a DNS tunnel to bypass network-based content filtering and DNS inspection, reaching helper services or exfiltrating question text through a channel that looks like ordinary name resolution. Encrypted DNS also hides which domains the exam device contacts from network monitors.

**What a cheater gains.** Can configure browser or OS resolver settings to encrypted DNS; may point resolution at a controlled resolver; can operate a low-throughput covert channel.

**Detection signals to verify.**
- Connections to known DoH/DoT resolver endpoints, or OS/browser configured to bypass the network resolver
- Abnormally high DNS query rate to a single parent domain
- High-entropy, unusually long, or TXT-heavy query/response patterns
- DNS traffic to resolvers outside the approved set
- Resolver configuration change events reported by the endpoint agent

**Lab test cases.**
- **NW-06-T1** — *Procedure:* Configure the exam device to use an external DoH/DoT resolver instead of the network-provided resolver and start a session. *Expected detection:* Product detects encrypted-DNS usage or connections to known DoH endpoints and raises a resolver-policy-violation alert. *Pass criteria:* PASS if encrypted-DNS or non-approved-resolver usage is flagged within the session; FAIL if resolver behavior is not evaluated.
- **NW-06-T2** — *Procedure:* Generate a controlled DNS-tunnel-style pattern (high-frequency, high-entropy subdomain lookups to one parent domain) in the lab. *Expected detection:* DNS analytics flag anomalous query volume and high-entropy/oversized query patterns to a single domain. *Pass criteria:* PASS if the anomalous DNS pattern is flagged with recorded query-rate and entropy indicators; FAIL if the pattern passes as normal.

**Remediation.**
- Require use of an approved resolver and detect/flag encrypted-DNS bypass at session start
- Apply DNS analytics for query-rate, length, and entropy anomalies indicative of tunneling
- Alert on resolver-configuration changes captured by the endpoint agent
- Where policy allows, constrain name resolution to a controlled resolver during lockdown

#### [NW-07] Remote-Desktop Takeover by an Accomplice — Severity: Critical

**What it is.** A remote helper connects into the exam device via remote-access software and either drives the session directly or reads and answers in real time, while the candidate appears present on camera. This is more powerful than screen-streaming because the accomplice can control input, and it produces both process and network indicators.

**What a cheater gains.** Can pre-install or launch remote-access/remote-desktop software; has a confederate ready to connect inbound.

**Detection signals to verify.**
- Known remote-access/remote-desktop processes or services running during the session
- Inbound control connections and associated listening ports
- Input events lacking corresponding local HID activity (synthetic input)
- Cursor jumps and control patterns atypical of a local user
- Additional active console/RDP session reported by the OS

**Lab test cases.**
- **NW-07-T1** — *Procedure:* Establish an inbound remote-desktop/remote-assistance session to the exam device from a second machine during the exam. *Expected detection:* Endpoint agent detects the active remote-access process and inbound control session and raises a remote-control alert; input events show characteristics of a non-local controller. *Pass criteria:* PASS if a remote-control alert fires within 60 seconds of connection with the responsible process identified; FAIL if the remote session is unflagged.
- **NW-07-T2** — *Procedure:* Observe input-device behavior during remote control versus local use (for example, cursor teleportation and absence of local HID activity). *Expected detection:* Product flags input-injection or absent-local-HID anomalies consistent with remote control. *Pass criteria:* PASS if at least one input-anomaly indicator is recorded during the remote-control window; FAIL if none is produced.

**Remediation.**
- Detect and block remote-access software during lockdown and alert on active inbound control sessions
- Monitor for synthetic/injected input lacking local hardware origin
- Enumerate active OS logon/console sessions and flag additional interactive sessions
- Terminate the exam and preserve evidence on confirmed remote control

#### [NW-08] Virtual Camera or Virtual Audio Device Injecting an External Feed — Severity: High

**What it is.** The candidate installs a virtual camera or virtual audio driver so the proctoring feed shows a pre-recorded or looped video, or so an accomplice's audio/video is piped in, decoupling what the proctor sees from the real environment. This can mask a helper's presence or a substitute test-taker while a covert network channel carries answers.

**What a cheater gains.** Can install virtual-device drivers or use software that registers a virtual camera/microphone; can prepare or stream a substitute feed.

**Detection signals to verify.**
- Capture device identified as a virtual/software driver rather than physical hardware
- Camera feed failing real-time randomized liveness challenges
- Frame characteristics indicating looped, encoded, or replayed video (compression artifacts, repeating frames)
- Audio and video device names matching known virtual-device software
- Newly registered capture devices appearing shortly before the exam

**Lab test cases.**
- **NW-08-T1** — *Procedure:* Select a registered virtual camera and virtual microphone as the proctoring capture devices and start a session feeding a looped clip. *Expected detection:* Product enumerates capture devices, identifies the virtual/software driver, and raises a non-physical-capture-device alert. *Pass criteria:* PASS if the virtual camera and microphone are flagged as software devices within 60 seconds; FAIL if either is accepted as a genuine hardware device.
- **NW-08-T2** — *Procedure:* Feed a looped or static video through the virtual camera and run liveness/challenge prompts (blink, turn head, show a gesture on request). *Expected detection:* Liveness analytics detect absence of real-time response to randomized challenges and flag a non-live feed. *Pass criteria:* PASS if the randomized liveness challenge fails to be satisfied and a non-live-feed alert is raised; FAIL if the looped feed passes liveness.

**Remediation.**
- Enumerate and validate capture devices against physical-hardware expectations; flag virtual drivers
- Apply randomized real-time liveness challenges that a pre-recorded feed cannot satisfy
- Analyze frames for loop/replay and re-encoding artifacts
- Block or require reviewer approval when software capture devices are selected for proctoring

### Proctor Agent & Evidence Integrity

Defensive threat catalog for the Proctor Agent & Evidence Integrity domain of a remote proctoring product, authored for the product owner's authorized lab testing. Eight threat classes cover attacks that neutralize the agent (kill/suspend/patch), subvert its observation surface (API/kernel hooking, spoofed telemetry), distort its notion of time (clock/timezone manipulation), and break the chain of custody for evidence (upload blocking/corruption, recorded-media tampering, and impersonation of a healthy agent). Each threat is described at the technique-class level a defender needs to build detection and prevention, deliberately excluding working exploit code or turnkey evasion payloads. Every threat centers server-observable detection signals and remediation that closes the gap, plus lab-runnable test cases with objective pass/fail criteria and time bounds. Severity reflects impact on exam integrity if the technique goes undetected. The dominant defensive theme is that the agent cannot be trusted to report on its own health: integrity must be anchored server-side through continuous authenticated heartbeats, cryptographic sealing of evidence at capture time, out-of-band liveness and time references, and fail-closed policies that treat silence, gaps, and unverifiable evidence as violations rather than benign conditions.

#### [AT-01] Agent termination or suspension mid-session — Severity: Critical

**What it is.** The candidate kills, force-quits, or indefinitely suspends (SIGSTOP-class freeze, process-freezer, or debugger break) the proctoring agent after the session has been authenticated, creating a blind window during which no telemetry, screen, or camera evidence is produced. Suspension is more dangerous than a clean kill because the process still exists and naive liveness checks that only test for process presence continue to pass. The core defensive failure is treating absence of an alert as evidence of good behavior.

**What a cheater gains.** Local interactive user with the ability to run standard OS process-control utilities or a task manager against a process running at their own privilege level.

**Detection signals to verify.**
- Missed authenticated heartbeats on the server within the expected cadence (server-timed, not client-timed)
- Heartbeat nonce/monotonic sequence-counter discontinuity across a gap
- TCP/WebSocket control channel closed without a signed graceful-shutdown message
- Duration of continuous evidence coverage shorter than session wall-clock duration

**Lab test cases.**
- **AT-01-TC1** — *Procedure:* In the lab, start a proctored session, then terminate the agent process using an ordinary OS task manager or kill command. Observe the backend. *Expected detection:* Server-side heartbeat monitor raises a 'agent lost' / session-integrity violation for the candidate. *Pass criteria:* Alert is raised server-side within 30 seconds of the missed heartbeat and the session is flagged for review or auto-paused; no reliance on the client to self-report its own death.
- **AT-01-TC2** — *Procedure:* Start a session, then suspend/freeze the agent process (stop signal or freezer) so it remains resident but stops executing, hold for 90 seconds, then resume. *Expected detection:* Backend detects the heartbeat gap despite the process still existing, and the resumed heartbeats show a monotonic-counter or nonce discontinuity. *Pass criteria:* Violation raised within 30 seconds of heartbeat stall AND the frozen interval is marked as an evidence gap in the session record; a mere 'process present' check must NOT clear the flag.

**Remediation.**
- Require a short-interval authenticated heartbeat with a signed monotonic counter; treat any gap beyond threshold as a fail-closed integrity violation
- Anchor liveness detection entirely server-side so the client cannot suppress its own alert
- Run a lightweight watchdog/second process that independently reports agent health and its own health
- Define policy that unexplained coverage gaps invalidate the affected exam window pending human review

#### [AT-02] Binary or memory patching of the agent — Severity: Critical

**What it is.** The candidate modifies the agent on disk or in memory so it keeps running and keeps sending heartbeats, but its detection logic is neutered (checks stubbed to always-pass, event hooks disabled, or evidence sampling silently reduced). Because the process stays alive and communicative, liveness passes while integrity is hollowed out. Defenders must be able to attest that the running code is the code they shipped.

**What a cheater gains.** Local user able to edit files in the install directory or attach a debugger to their own process to alter code paths; no kernel privilege required if the agent runs in user space.

**Detection signals to verify.**
- On-disk binary/module hash or code-signature mismatch against the known-good manifest
- Runtime code-segment checksum drift from the attested baseline
- Debugger-attach, ptrace, or process-injection events reported by the agent or OS
- Feature-level telemetry (e.g., expected periodic detector outputs) missing while heartbeats persist

**Lab test cases.**
- **AT-02-TC1** — *Procedure:* Modify a copy of the agent binary/module on disk (any byte change) in the lab, launch it, and start a session. *Expected detection:* Startup/continuous integrity attestation reports a binary hash or code-signature mismatch to the backend. *Pass criteria:* Backend rejects or flags the session before the exam begins, within 10 seconds of launch, based on a server-verified hash/signature, not a client-computed self-check that the patched binary could forge.
- **AT-02-TC2** — *Procedure:* Attach a debugger to the running agent and alter an in-memory code path that governs a detection check; leave heartbeats flowing. *Expected detection:* Anti-debug / runtime self-integrity telemetry reports debugger attachment or a code-region checksum change. *Pass criteria:* Debugger-attach or memory-mutation event reaches the backend and flags the session within 30 seconds; heartbeats continuing must NOT clear the flag.

**Remediation.**
- Verify code identity server-side via signed attestation and reject unsigned/altered builds; do not trust a client self-hash alone
- Enable anti-tamper/anti-debug protections and report attach/injection events out of band
- Emit heartbeats that include a signed digest of active detector state so a hollowed agent is distinguishable from a healthy one
- Pin and continuously re-verify critical code regions; fail closed on drift

#### [AT-03] API and kernel hooking to blind observation — Severity: Critical

**What it is.** The candidate interposes on the APIs the agent relies on (screen capture, camera enumeration, window/process listing, input events) via user-mode hooking, DLL/shared-library injection, or a driver/filter that returns sanitized results. The agent runs unmodified but is fed a curated view of the machine, so forbidden applications, virtual cameras, or additional displays become invisible to it. The defensive crux is detecting that the observation surface itself has been intercepted.

**What a cheater gains.** Local user capable of injecting libraries or, at higher impact, installing a filter driver/kernel shim; ranges from moderate to advanced skill.

**Detection signals to verify.**
- Disagreement between two independent methods of enumerating the same resource (processes, displays, devices)
- Unexpected/unsigned modules loaded into the agent's process space
- Camera/audio source classified as virtual or lacking physical-sensor provenance
- Hook-table / IAT / syscall-trampoline anomalies on APIs the agent depends on

**Lab test cases.**
- **AT-03-TC1** — *Procedure:* In the lab, inject a benign interception module that alters the result of an enumeration API the agent uses (e.g., hides one entry from a process or display list), then run a session. *Expected detection:* Agent's cross-check between two independent enumeration methods disagrees, and/or an unexpected module is reported loaded in the agent's address space. *Pass criteria:* Discrepancy or foreign-module-injection event is reported to the backend and the session is flagged within 60 seconds; detection must not depend solely on the hooked API.
- **AT-03-TC2** — *Procedure:* Register a virtual camera / capture-filter and select it as the exam camera source. *Expected detection:* Agent reports the camera device as virtual/non-physical (driver class, absence of a real sensor, or known virtual-device signature). *Pass criteria:* Virtual-camera classification reaches the backend and blocks or flags the session before exam start, with objective device-provenance evidence recorded.

**Remediation.**
- Acquire critical signals through multiple independent paths and treat disagreement as a violation
- Validate device provenance (reject virtual cameras/mics unless explicitly allowed) and record the evidence
- Detect and report library injection and API-hook signatures; prefer lower-level or kernel-assisted acquisition where policy allows
- Fail closed when the integrity of the observation path cannot be established

#### [AT-04] Spoofed or synthetic telemetry / replay — Severity: High

**What it is.** Rather than disabling the agent, the candidate feeds the backend fabricated but well-formed telemetry: a static or looped camera feed, a clean screen frame replayed while cheating happens off-frame, or a captured 'good' heartbeat/event stream replayed to mask a swapped-out client. The data plane looks healthy; the content is fake. Defenders must bind evidence to a live, unique, current capture.

**What a cheater gains.** Local user able to substitute a media source or, more advanced, capture and replay the agent's outbound stream to the backend.

**Detection signals to verify.**
- Failed active liveness challenges (server-issued nonce shown/echoed, prompted head movement, on-screen token in frame)
- Video loop periodicity, frozen background, or unnatural absence of sensor noise/micro-motion
- Duplicate message nonces or non-monotonic counters at the backend
- Timestamps outside the allowed freshness window relative to server time

**Lab test cases.**
- **AT-04-TC1** — *Procedure:* Feed the exam a looping pre-recorded video as the camera source for 2 minutes during a session. *Expected detection:* Liveness/freshness analysis flags absent natural micro-motion, loop periodicity, or a failed server-issued liveness challenge (e.g., prompted action or on-screen nonce). *Pass criteria:* Session flagged within 60 seconds AND at least one active liveness challenge fails; a passive 'a frame arrived' check must not suffice.
- **AT-04-TC2** — *Procedure:* Capture a legitimate stretch of heartbeat/event traffic, then replay it to the backend from a substitute client while the real agent is offline. *Expected detection:* Backend rejects replayed messages via per-message nonce, monotonic counter, and server-bound session token; timestamps fail the freshness window. *Pass criteria:* Replayed stream is rejected/flagged within 30 seconds and cannot advance the session; duplicate nonce or stale timestamp is logged.

**Remediation.**
- Issue unpredictable server-side liveness challenges and require timely correct responses
- Embed a rotating server nonce into the capture path so evidence must be current and unique
- Enforce per-message nonces, monotonic counters, and short freshness windows to defeat replay
- Correlate camera, screen, and input streams for mutual consistency and flag divergence

#### [AT-05] Local clock and timezone manipulation — Severity: High

**What it is.** The candidate changes the system clock, timezone, or NTP source to distort timestamps that the product uses for evidence ordering, exam-window enforcement, or freshness checks. Goals include appearing to finish within the window, reordering or backdating evidence, or sliding events outside a monitored interval. Any integrity logic that trusts client-supplied time is exposed.

**What a cheater gains.** Local user with permission to change date/time/timezone settings or redirect time synchronization on their own machine.

**Detection signals to verify.**
- Client-reported time diverging from authenticated server time beyond tolerance
- Non-monotonic or backward-jumping client timestamps within a session
- Timezone-offset or time-source change events reported by the agent
- Evidence sequence numbers inconsistent with client timestamp ordering

**Lab test cases.**
- **AT-05-TC1** — *Procedure:* During a lab session, shift the system clock forward and backward by several minutes and continue generating events. *Expected detection:* Backend detects client-vs-server time skew beyond tolerance and/or non-monotonic client timestamps. *Pass criteria:* Skew/monotonicity violation raised within 60 seconds and evidence ordering falls back to trusted server time; client timestamps alone are never authoritative.
- **AT-05-TC2** — *Procedure:* Change the system timezone mid-session and/or point time sync at an attacker-controlled source. *Expected detection:* Agent reports timezone/time-source change and the resulting offset is reconciled against an independent trusted time reference. *Pass criteria:* Timezone/time-source change is logged and flagged within 60 seconds; exam-window enforcement uses server time and is unaffected by the client change.

**Remediation.**
- Make authenticated server time authoritative for all windows, ordering, and freshness; never trust client clocks
- Attach a server-side receive-timestamp and monotonic sequence number to every evidence item
- Continuously monitor client-server skew and flag drift beyond a defined bound
- Detect and log timezone/NTP-source changes as integrity events

#### [AT-06] Blocking or degrading evidence upload — Severity: High

**What it is.** The candidate prevents evidence from reaching the backend by firewalling the upload endpoint, throttling the connection, sinkholing the domain via hosts/DNS, or forcing offline buffering that they later discard. If the product treats 'no evidence received' as benign, the blind window is free of penalty. Defenders must make missing evidence a first-class violation and protect buffered evidence from loss.

**What a cheater gains.** Local user able to alter host firewall, DNS/hosts resolution, or network routing on their machine.

**Detection signals to verify.**
- Evidence-upload gap while control heartbeats continue (or both drop together)
- Post-reconnect gap in a signed monotonic evidence sequence / hash chain
- Sustained upload throughput far below the expected media bitrate
- DNS/endpoint resolution anomalies or connection resets to the ingest host

**Lab test cases.**
- **AT-06-TC1** — *Procedure:* Block the evidence-upload endpoint (firewall rule or DNS sinkhole) for 2 minutes mid-session, then restore connectivity. *Expected detection:* Backend observes an upload gap / heartbeat-only-loss and, on reconnection, reconciles a signed local sequence that proves how many items are missing. *Pass criteria:* Upload gap flagged within 60 seconds AND, on reconnect, the count of unrecovered evidence items is quantified and the window marked for review; silence must never be scored as compliant.
- **AT-06-TC2** — *Procedure:* Force the agent into offline-buffer mode, complete a portion of the exam, then discard or corrupt the local buffer before it uploads. *Expected detection:* On reconnect, the signed monotonic sequence reveals missing/short buffer; item-count and hash-chain reconciliation fails. *Pass criteria:* Reconciliation detects the shortfall within the first upload after reconnect and flags the session; a partial or emptied buffer cannot pass as complete.

**Remediation.**
- Treat missing evidence as fail-closed: unexplained gaps invalidate the affected window pending review
- Number and hash-chain every evidence item so the backend can prove exactly what is missing
- Encrypt and integrity-protect offline buffers; require full reconciled upload before results are released
- Alert on upload-throughput collapse and endpoint-resolution anomalies

#### [AT-07] Tampering with recorded media integrity — Severity: High

**What it is.** The candidate alters captured evidence between capture and storage/review: splicing or cutting frames, substituting segments, re-encoding to strip forbidden content, or editing at rest if storage is reachable. If evidence is not sealed at the moment of capture, edited media can pass as authentic. Defenders need capture-time cryptographic binding and continuity that survives to the review console.

**What a cheater gains.** Local user able to intercept the media pipeline before sealing, or an insider/attacker with access to evidence at rest lacking end-to-end protection.

**Detection signals to verify.**
- Failed per-segment signature or hash-chain verification over captured frames
- Timeline discontinuity, duplicated, or missing frame ranges
- Absent or inconsistent capture-time nonce/watermark embedded server-side
- Container metadata inconsistent with a single continuous capture

**Lab test cases.**
- **AT-07-TC1** — *Procedure:* Excise a segment from a captured evidence stream (cut N seconds) and present the shortened media to the backend/review pipeline. *Expected detection:* Per-segment hash-chain / signature verification fails at the cut, and the continuity timeline shows a discontinuity. *Pass criteria:* Verification fails and the tampered media is rejected or flagged before it can be treated as authentic, with the discontinuity precisely located; a passing signature must be required for evidence to count.
- **AT-07-TC2** — *Procedure:* Re-encode or substitute a captured segment with altered content while preserving container/timestamps. *Expected detection:* Cryptographic signature over the original frames fails to verify; capture-time nonce/watermark is absent or inconsistent. *Pass criteria:* Signature/watermark verification fails and the segment is marked untrusted within the ingest/verification stage; re-encoded content cannot silently replace the original.

**Remediation.**
- Sign and hash-chain evidence at capture time so any later edit breaks verification
- Embed a rotating server-issued nonce/watermark into frames to bind them to the live session
- Protect evidence end-to-end and enforce integrity verification at ingest and again at review
- Reject or quarantine any media that fails verification rather than showing it as authentic

#### [AT-08] Impersonation of a healthy agent (rogue client / fake heartbeat) — Severity: High

**What it is.** The candidate runs a substitute program, script, or emulator that speaks the agent's protocol and emits plausible heartbeats and minimal telemetry while the genuine agent is absent or a second unmonitored machine does the real work. The backend believes a compliant agent is present. This is the convergence point of several prior threats and is defeated only by strong client authentication and attestation, not by protocol conformance alone.

**What a cheater gains.** Advanced local user who has reverse-engineered enough of the client protocol to emit conforming messages from a stand-in process.

**Detection signals to verify.**
- Heartbeats that conform to the protocol but lack valid signed attestation bound to a fresh server challenge
- Attestation material reused across sessions or failing freshness binding
- Telemetry richness/behavioral fingerprint inconsistent with the genuine agent
- Environment/hardware attestation mismatch with the enrolled device

**Lab test cases.**
- **AT-08-TC1** — *Procedure:* In the lab, run a minimal stand-in client that sends protocol-conformant heartbeats/telemetry without the genuine agent's attestation material, and attempt to sustain a session. *Expected detection:* Backend requires per-session hardware/software attestation and signed heartbeats keyed to a provisioned client secret; the stand-in cannot produce valid attestation. *Pass criteria:* Session is refused or flagged within 30 seconds because attestation/signature verification fails; protocol conformance alone must not grant a healthy status.
- **AT-08-TC2** — *Procedure:* Replay a genuine agent's prior attestation/heartbeat material from the stand-in client in a new session. *Expected detection:* Server challenge-response binds attestation to a fresh nonce and session token, so replayed material fails freshness/binding checks. *Pass criteria:* Replayed attestation is rejected within 30 seconds; the session cannot proceed on stale credentials.

**Remediation.**
- Require cryptographic client authentication and fresh challenge-bound attestation for every session; conformance is not identity
- Bind heartbeats to a per-session server nonce and a provisioned client secret so they cannot be forged or replayed
- Verify device/environment attestation against the enrolled machine and flag mismatches
- Fail closed when attestation cannot be verified rather than accepting a well-formed but unauthenticated client

### Environmental & Physical

Defender-oriented threat catalog covering the Environmental & Physical attack surface of a remote proctoring / exam-integrity product. It enumerates eight technique classes by which a candidate can obtain unauthorized assistance from the physical space around the workstation: an off-camera accomplice, static printed or handwritten reference material, secondary devices such as phones, covert audio receivers paired with a remote helper, exploitation of mirrors and reflective surfaces, staged or incomplete room scans, whispered or acoustically-encoded coaching, and deliberate camera framing that hides the working surface. Each threat is described at the level a defender needs to design detection or prevention tests, centers the observable signals the product can act on (video, audio, gaze, network/device telemetry, timing), and specifies remediation that closes the gap. Every test case is lab-runnable with an objective pass/fail criterion and a time or confidence bound. Severity reflects impact on exam integrity if the technique goes undetected. This catalog is intentionally defensive: it does not provide working evasion payloads, tool configurations, or weaponization steps.

#### [EN-01] Second (accomplice) person present in the exam room — Severity: Critical

**What it is.** A helper is physically present but stays outside the camera frame, feeding answers verbally, via gestures, or by writing on shared paper. The accomplice may enter only intermittently, remain seated to the side of the candidate, or coach from behind the monitor. Detection must rely on multi-modal cues because the accomplice deliberately avoids the primary camera cone.

**What a cheater gains.** Physical co-presence of a knowledgeable helper who can see the questions (over the shoulder or via a shared screen) and communicate answers in real time without appearing centered in the webcam frame.

**Detection signals to verify.**
- Voice diarization detecting a second speaker distinct from the enrolled candidate
- More than one face or human silhouette detected in any video frame
- Candidate gaze or head repeatedly orienting to an off-camera fixed point (side/behind monitor)
- Candidate lips not moving while non-candidate speech is present on the audio track
- Directional audio energy arriving from an angle inconsistent with the candidate's seated position

**Lab test cases.**
- **EN-01-T1** — *Procedure:* In the lab, seat a confederate 1-2 meters to the side of the candidate, outside the primary camera cone, and have them speak short coaching phrases at conversational volume during a scripted 10-minute session. *Expected detection:* The audio pipeline raises a second-speaker / multi-voice event with a diarization label distinct from the enrolled candidate. *Pass criteria:* PASS if a distinct second-speaker alert fires within 30 seconds of the confederate's first utterance and correctly attributes at least 80 percent of confederate speech segments to a non-candidate speaker.
- **EN-01-T2** — *Procedure:* Have the confederate briefly lean into the frame edge (partial face/torso) twice during the session, each appearance lasting 2-4 seconds. *Expected detection:* Video person-count analytic flags more than one human silhouette/face in frame. *Pass criteria:* PASS if a multi-person alert is raised for at least one of the two brief appearances with the timestamp within 2 seconds of the actual appearance; FAIL if neither appearance is flagged.

**Remediation.**
- Enable continuous multi-speaker audio diarization with alerting on any non-enrolled voice
- Run per-frame person-count detection and escalate on count greater than one for a configurable minimum duration
- Require a 360-degree room and under-desk scan at start and at random re-scan prompts mid-exam
- Correlate gaze-off-screen events with audio events to raise a composite coaching-risk score
- Use a wide field-of-view camera or secondary phone camera to widen the monitored cone

#### [EN-02] Printed or handwritten reference notes — Severity: High

**What it is.** Static cheat material placed outside the camera frame, taped to the monitor bezel, hidden under the keyboard, on the wall behind the camera, or written on the desk/skin. The candidate consults it with brief downward or lateral glances. Because the material is static and silent, detection depends primarily on gaze behavior and environment scanning rather than audio.

**What a cheater gains.** Pre-staged written answers or formula sheets positioned in blind spots that the candidate can read with minimal, low-suspicion glances.

**Detection signals to verify.**
- Repeated short-duration gaze deviations to a consistent off-screen location
- Head-tilt/downward pitch patterns inconsistent with reading the on-screen question
- Objects detected on desk or walls during room scan that persist into the exam
- Reading eye-movement micro-saccades occurring while no text is displayed on screen
- Reduced typing/answer latency immediately following each off-screen glance

**Lab test cases.**
- **EN-02-T1** — *Procedure:* Tape a small note card just below the webcam, out of frame. Have the candidate glance down to read it 8 times over 5 minutes, each glance 1-2 seconds, otherwise looking at the screen. *Expected detection:* Gaze-tracking analytic logs repeated off-screen downward gaze deviations exceeding threshold. *Pass criteria:* PASS if at least 6 of 8 downward glances are logged as off-screen gaze events and an aggregate gaze-anomaly alert is raised by the end of the session.
- **EN-02-T2** — *Procedure:* During the mandatory pre-exam room scan, place a formula sheet flat on the desk in the scan path; then during the exam consult it. *Expected detection:* Room-scan review (automated or human) captures the sheet; or gaze pattern during exam flags repeated desk-surface fixation. *Pass criteria:* PASS if the room-scan recording clearly captures the sheet in at least one frame AND the system retains that frame for reviewer flagging; FAIL if the scan path never covers the desk surface.

**Remediation.**
- Enforce a slow, guided pre-exam scan covering desk, monitor edges, walls, and under-keyboard, with automated coverage-completeness checks
- Calibrate gaze tracking per candidate and alert on repeated fixations outside the screen boundary
- Require a clear-desk attestation with a close-up desk sweep
- Retain flagged gaze-event video clips for human review with objective glance-count thresholds

#### [EN-03] Secondary device (phone / tablet) used for lookup — Severity: High

**What it is.** A phone or tablet held below the desk or beside the keyboard is used to search answers, read messages, or receive relayed content. Detection can leverage both physical cues (hand disappearing below frame, gaze to lap) and, where lockdown or network monitoring is in scope, device/network telemetry indicating a companion device.

**What a cheater gains.** Concealed use of an internet-connected secondary device to look up answers or receive help while keeping the primary exam workstation apparently compliant.

**Detection signals to verify.**
- Hand repeatedly exiting the bottom of the frame followed by downward gaze
- Sustained gaze angle toward lap/desk-below inconsistent with screen reading
- Screen illumination reflected on the candidate's face/chin from below (phone glow)
- Notification chimes or vibration buzz on the audio track
- Companion device active on the same network (where network telemetry is in scope)

**Lab test cases.**
- **EN-03-T1** — *Procedure:* Have the candidate lower one hand to their lap holding a phone and glance down to it 5 times over 5 minutes, each 2-3 seconds. *Expected detection:* Gaze-to-lap plus hand-exit-frame analytic raises a device-suspicion event. *Pass criteria:* PASS if at least 4 of 5 lap glances produce a downward off-screen gaze event and at least one composite 'possible secondary device' alert is raised within the session.
- **EN-03-T2** — *Procedure:* With network-side monitoring in scope, place an actively browsing phone on the same local network during the exam and generate search traffic. *Expected detection:* Companion-device or new-device-on-network signal, or audible/RF notification cue, is logged. *Pass criteria:* PASS if the monitoring layer records a distinct secondary active device or a notification/audio cue within 60 seconds of the generated traffic; mark N/A only if network monitoring is explicitly out of scope for the deployment.

**Remediation.**
- Combine gaze-to-lap detection with hand-tracking to flag below-desk interaction
- Prompt periodic hands-on-desk / show-hands checks at random intervals
- Detect and log notification/vibration audio signatures
- Where policy permits, monitor for companion devices and require phones be placed visibly out of reach on camera before start

#### [EN-04] Hidden earpiece with remote human helper — Severity: Critical

**What it is.** A concealed wireless earpiece (in-ear micro receiver) lets an off-site helper who can somehow see the questions read answers aloud to the candidate. The candidate may sub-vocalize the questions or rely on a paired covert microphone. This is a high-skill class; detection centers on candidate behavior (listening pauses, sub-vocalization, ear-touching) and, where in scope, on audio leakage and question-exfiltration paths.

**What a cheater gains.** Real-time covert two-way audio channel to an external expert, minimizing visible artifacts by using a small in-ear device and quiet whispering or sub-vocal reading.

**Detection signals to verify.**
- In-ear object detected during a mandated close-up left/right ear scan
- Repeated hand-to-ear gestures
- Consistent listening pauses (gaze holding, no typing) immediately preceding correct answers
- Candidate whispering or sub-vocalizing while reading questions
- Faint intermittent audio bleed from the earpiece speaker on the mic

**Lab test cases.**
- **EN-04-T1** — *Procedure:* Fit the candidate with a visible-in-close-up in-ear device and run a session where they pause 4 times to 'listen' for 3-5 seconds before answering, occasionally touching the ear. *Expected detection:* Ear-region object detection during scan OR behavioral analytic flagging repeated listening-pauses correlated with answer entry. *Pass criteria:* PASS if the pre-exam close-up ear scan captures the device in a retained frame, OR at least 3 of 4 listening-pause-then-answer patterns are flagged as anomalous timing events.
- **EN-04-T2** — *Procedure:* Have the candidate quietly sub-vocalize / whisper each question at very low volume as if relaying it to a helper. *Expected detection:* Sensitive audio analytic detects candidate whisper/sub-vocalization not matching normal silence during reading. *Pass criteria:* PASS if the audio pipeline raises a whisper/low-level-speech event for at least half of the whispered questions with confidence above the configured threshold.

**Remediation.**
- Require an explicit hair-back, both-ears close-up scan before exam start
- Prohibit any earbuds/headphones and verify ears are clear on camera
- Run whisper-sensitive audio detection tuned below conversational volume
- Flag timing anomalies where consistent pre-answer pauses correlate with accuracy
- Randomly prompt the candidate to repeat instructions aloud to surface concealed audio channels

#### [EN-05] Mirrors and reflective surfaces — Severity: Medium

**What it is.** Two abuse patterns: (a) a mirror, glossy surface, or second monitor positioned to let the candidate view hidden notes or a helper without turning visibly; and (b) reflections in eyeglasses, eyes, or background glass that inadvertently reveal prohibited content — which the DEFENDER can exploit as a detection signal. The proctoring product must both detect illicit reflective aids and use reflections forensically.

**What a cheater gains.** Use of reflective surfaces to read concealed material at a natural head angle, or placement of mirrors to monitor an accomplice's cues without an obvious turn of the head.

**Detection signals to verify.**
- Reflective/mirror-like surfaces detected in the workspace during scan
- Consistent gaze off the screen axis at a shallow, repeated angle
- Bright rectangular reflections in eyeglasses inconsistent with the exam window content
- A secondary display's glow reflected in the background or on the candidate
- Head held unusually still while eyes track a fixed off-screen point

**Lab test cases.**
- **EN-05-T1** — *Procedure:* Place a small mirror angled beside the monitor reflecting an off-screen note. Have the candidate read from the mirror with subtle eye movements during a 5-minute session. *Expected detection:* Room-scan/object analytic flags a reflective surface in the workspace; gaze analytic flags consistent off-axis fixation. *Pass criteria:* PASS if the pre-exam scan review flags the reflective object in a retained frame OR a repeated off-axis gaze fixation alert is raised; FAIL if neither.
- **EN-05-T2** — *Procedure:* Have a candidate wearing glasses display a second screen with content; capture whether the product retains high-enough-resolution frames to analyze glasses reflections during review. *Expected detection:* System preserves eyeglass/eye-region frames at resolution sufficient for a reviewer to assess reflected content. *Pass criteria:* PASS if retained frames of the eye/glasses region meet a defined minimum resolution (for example, eye-region width of at least a configured pixel count) enabling reflection review; FAIL if frames are too low-resolution to inspect.

**Remediation.**
- Instruct removal of mirrors and reflective objects and confirm via scan
- Detect and flag reflective surfaces and additional screens during the environment check
- Capture and retain eye/glasses frames at sufficient resolution for reflection forensics
- Alert on repeated off-axis gaze fixations and correlate with detected reflective objects

#### [EN-06] Room-scan gaps and staged environment — Severity: High

**What it is.** The pre-exam environment scan is rushed, partial, or performed away from where prohibited materials are staged, so notes, devices, or a second person are simply outside the scanned area. Attackers exploit predictable scan choreography (fixed path, no under-desk or behind-camera coverage) or perform the scan in a clean room then move to a prepared one.

**What a cheater gains.** Knowledge of the scan's blind spots and lack of randomization, allowing prohibited items to be staged where the scan never looks, or the scan to be satisfied in a different location than the exam is taken.

**Detection signals to verify.**
- Scan motion telemetry showing key regions (desk, under-desk, walls, behind-camera) never entered the frame
- Scan completed implausibly fast relative to a minimum-duration baseline
- Background features during the exam not matching those captured during the scan
- Lighting or acoustic fingerprint shift between scan and exam

**Lab test cases.**
- **EN-06-T1** — *Procedure:* Perform the room scan while a note sheet sits under the keyboard and a phone sits behind the monitor, following only the minimum motions the UI prompts. *Expected detection:* Scan-coverage analytic detects that desk-surface, under-keyboard, and behind-monitor regions were not covered and blocks start or forces a re-scan. *Pass criteria:* PASS if the system flags incomplete coverage and requires additional scanning of the missed regions before allowing exam start; FAIL if a minimal scan is accepted as complete.
- **EN-06-T2** — *Procedure:* Complete a compliant scan in Room A, then within the exam move the workstation view to Room B (simulated via background swap). *Expected detection:* Background-consistency analytic detects that the exam environment differs from the scanned environment. *Pass criteria:* PASS if a background/environment-change alert fires within 30 seconds of the environment differing from the scanned baseline.

**Remediation.**
- Enforce a guided scan with automated coverage checks for all mandated regions before start
- Randomize scan prompts and require mid-exam spot re-scans to defeat pre-staging
- Maintain a scanned-environment baseline and continuously verify background consistency
- Set a minimum scan duration and reject implausibly fast scans

#### [EN-07] Audio-channel coaching and acoustic cues — Severity: High

**What it is.** An accomplice in or near the room provides help through low whispers, coded taps/knocks, or agreed acoustic signals (for example, a cough meaning 'option B'). Content-based detection may miss coded cues, so the defender must detect anomalous sound events and correlate them with answer-entry timing rather than relying solely on speech transcription.

**What a cheater gains.** Delivery of answer hints through quiet or non-linguistic acoustic signals that evade obvious speech detection while still conveying information.

**Detection signals to verify.**
- Recurring non-speech transients (taps, knocks, coughs) with regular timing relative to answers
- Low-volume whispers or speech not matching candidate lip movement
- Background voice segments attributed to a non-enrolled speaker
- Correlation between discrete audio events and answer-selection timestamps

**Lab test cases.**
- **EN-07-T1** — *Procedure:* During a scripted session, introduce a repeated non-speech cue (for example, a knock pattern) timed a few seconds before each answer selection, 5 times over 5 minutes. *Expected detection:* Acoustic-event detector logs recurring transient sounds and the system correlates their timing with answer-entry events. *Pass criteria:* PASS if at least 4 of 5 cue events are logged as distinct acoustic anomalies AND a correlation alert is raised linking the recurring cue to answer timing.
- **EN-07-T2** — *Procedure:* Have a helper whisper single-word hints at very low volume near the candidate. *Expected detection:* Whisper-sensitive audio analytic flags low-level speech events not attributable to the candidate. *Pass criteria:* PASS if at least half of the whispered hints trigger a low-level second-source speech event above the configured confidence threshold.

**Remediation.**
- Run continuous acoustic-event detection covering non-speech transients, not just transcription
- Correlate audio-event timestamps with answer-entry timing to surface coded cueing
- Diarize and alert on any non-candidate voice, including whispers
- Require a quiet-environment attestation and flag sessions with recurring structured sounds

#### [EN-08] Camera framing and occlusion manipulation — Severity: Medium

**What it is.** The candidate deliberately tilts, raises, or partially occludes the camera so the working surface, lap, or an adjacent area falls outside the frame — creating a sanctioned blind spot for notes, a phone, or a second person. Includes obscuring the lens partially, aiming it at the face only, or nudging it mid-exam.

**What a cheater gains.** Control of camera placement to keep the head compliant on-screen while excluding the hands, desk, or surroundings where prohibited activity occurs.

**Detection signals to verify.**
- Hands or desk surface not present in the frame at start or during the exam
- Sudden shifts in frame composition or camera angle mid-session
- Partial lens occlusion or persistent out-of-frame lower body
- Face centered while the mandated working-surface region is empty or excluded

**Lab test cases.**
- **EN-08-T1** — *Procedure:* Angle the webcam upward so only the face and upper wall are visible, excluding the desk and hands, and begin the exam. *Expected detection:* Framing-quality check detects that hands/desk are not visible and blocks start or prompts re-framing. *Pass criteria:* PASS if the system rejects the framing and requires the desk/hands to be visible before start; FAIL if a face-only framing is accepted.
- **EN-08-T2** — *Procedure:* Mid-exam, nudge the camera so the frame shifts significantly (hands leave view) for 60 seconds, then restore. *Expected detection:* Frame-stability / occlusion analytic flags the sudden framing change and loss of the working area. *Pass criteria:* PASS if a framing-change or occlusion alert fires within 15 seconds of the shift and the interval is logged for review.

**Remediation.**
- Enforce a start-time framing check requiring visible face, hands, and desk within defined regions
- Continuously monitor frame stability and alert on significant angle or composition changes
- Detect and flag lens occlusion or loss of the working-surface region
- Prompt automatic re-framing and pause the exam clock until compliant framing is restored

### AI-Assistance & Behavioral Anomaly Detection

Defensive threat catalog covering the ways a candidate can leverage LLM/AI assistance during a remotely proctored exam and the observable signals a proctoring product can use to detect them. Eight technique classes are documented at defender altitude: invisible/overlay desktop assistants, out-of-band phone AI, verbatim paste of AI output, response-timing anomalies, keystroke-dynamics/transcription cadence, window-focus and remote-desktop patterns, browser-extension/DOM injection helpers, and stylometric AI-text fingerprints. Each threat centers detection signals the product can observe and remediation that closes the gap. Every test case is lab-runnable with an objective pass/fail bound. Severity reflects impact on exam integrity if the technique goes undetected. Highest-risk classes are out-of-band phone AI and content-protected overlay assistants, because both can be invisible to screen-capture-based monitoring; these warrant layered behavioral and environmental controls rather than reliance on any single signal.

#### [AI-01] Invisible or content-protected desktop AI assistant (overlay reads screen, surfaces answers) — Severity: Critical

**What it is.** A helper application runs locally and reads the on-screen question via OS screen APIs or accessibility hooks, then displays AI-generated answers in a window that is deliberately excluded from screen capture (content-protection / display-affinity flags) or rendered as a translucent always-on-top overlay positioned outside the proctoring capture region. The proctor's screen recording appears clean because the assistant window is invisible to capture, even though it is visible to the candidate.

**What a cheater gains.** Candidate can install and run local software with normal user privileges before the exam and knows how to enable capture-exclusion or off-capture positioning.

**Detection signals to verify.**
- Top-level window with capture-exclusion / display-affinity attribute set during the exam
- Always-on-top translucent window overlapping the exam viewport
- Local process invoking screen-capture, screenshot, or accessibility-tree APIs at a cadence correlated with question navigation
- Discrepancy between OS window inventory and frames present in the captured video
- Unsigned or recently installed executable holding foreground focus adjacency to the browser

**Lab test cases.**
- **AI-01-T1** — *Procedure:* In the lab, launch a benign stand-in overlay app that sets a capture-exclusion flag and stays always-on-top over the exam window. Start the proctoring session and complete a mock exam while the overlay is present. Inspect the product's captured video and its process/window telemetry. *Expected detection:* Product raises an alert for an always-on-top or capture-excluded top-level window overlapping the exam, or flags a process enumerating screen/accessibility APIs, even though the window is absent from the recorded frames. *Pass criteria:* PASS if an alert naming the anomalous window or process is generated within 60 seconds of the overlay appearing. FAIL if the session records as clean with no alert.
- **AI-01-T2** — *Procedure:* Enumerate known display-affinity / capture-exclusion window styles on the test OS and confirm whether the agent inventories top-level windows with their capture-affinity attribute. Compare the count of visible top-level windows reported by the agent against the OS truth for the session. *Expected detection:* Agent reports the presence of a window carrying a capture-exclusion attribute and includes it in the window inventory. *Pass criteria:* PASS if the capture-excluded window is enumerated and flagged. FAIL if the agent's window inventory omits windows that carry capture-exclusion flags.

**Remediation.**
- Enumerate top-level windows via OS APIs and flag any window carrying capture-exclusion/display-affinity flags rather than trusting the video stream alone
- Monitor for processes calling screen-capture and accessibility APIs during the exam and correlate with question-advance events
- Maintain an allowlist of expected processes and alert on new top-level windows appearing after lockdown starts
- Require a full-screen lockdown mode that revokes focus to any newly created top-level window and logs the event

#### [AI-02] Out-of-band phone-based AI (second device photographs screen, AI answers off-camera) — Severity: Critical

**What it is.** The candidate uses a separate phone or tablet, outside the proctored machine entirely, to photograph or livestream the question to an AI assistant and read the answer from the second screen. Because the assistance never touches the exam machine, no host-based signal exists; detection depends on environmental (webcam/audio), gaze, and behavioral-timing evidence.

**What a cheater gains.** Candidate possesses a second internet-connected device kept off the exam machine and glances at it between reading a question and answering.

**Detection signals to verify.**
- Recurrent gaze/head-pose deviations off the screen plane time-locked to question onset
- Additional-screen glow reflected in eyes or glasses
- Whisper/TTS-readback audio or a second voice during a silent exam
- Answer latency inflated by a consistent read-and-relay lag versus baseline
- Hands leaving the keyboard region before each correct answer

**Lab test cases.**
- **AI-02-T1** — *Procedure:* Run mock exams where a confederate performs repeated off-screen downward/sideways gaze shifts of 2 to 6 seconds correlated with question onset, then answers. Include control sessions with no second device. Review gaze/head-pose analytics output. *Expected detection:* Product flags recurring gaze-off-screen episodes that cluster immediately after question display and precede answer entry. *Pass criteria:* PASS if the tool flags at least 80 percent of the scripted look-away-then-answer episodes and does not flag more than 1 in the matched control session. FAIL otherwise.
- **AI-02-T2** — *Procedure:* Introduce faint second-screen glow reflection in glasses/eyes and low-volume TTS answer readback in some sessions. Check whether the product's audio and reflection analytics surface either signal. *Expected detection:* Product raises an environmental alert on detected additional-screen reflection or on speech/whisper audio during a no-talking exam. *Pass criteria:* PASS if either the reflection or the audio signal produces an alert with timestamp in the affected sessions. FAIL if both sessions pass silently.

**Remediation.**
- Deploy gaze and head-pose analytics tuned to detect look-away episodes time-locked to question display and correlate with answer timing
- Run continuous audio anomaly detection for speech/whispers during no-talk exams
- Require a 360-degree room and desk scan at session start and periodic re-scans
- Add reflection analysis on the eye/glasses region to infer additional screens
- Fuse environmental signals with timing anomalies rather than alerting on any single weak signal to control false positives

#### [AI-03] Verbatim paste of AI-generated answer text — Severity: High

**What it is.** The candidate copies AI output from another application or device buffer and pastes it into a free-text answer field, or types it with clipboard-assisted insertion. The tell is a large block of text entering the field in a single event with no incremental authoring, and content whose style does not match the candidate's baseline.

**What a cheater gains.** Candidate can place external text on the clipboard or use an input-injection helper to insert an answer without character-by-character authoring.

**Detection signals to verify.**
- Single input event increasing field length by a large character delta with no corresponding keystroke stream
- Clipboard paste event fired inside a locked-down answer field
- Answer text style/perplexity inconsistent with the candidate's typed baseline
- Zero intra-answer editing (no backspaces/corrections) on a long response

**Lab test cases.**
- **AI-03-T1** — *Procedure:* In lab sessions, paste multi-sentence blocks into answer fields via clipboard and via simulated bulk insertion. Include control sessions with genuine typing. Inspect the input-event telemetry. *Expected detection:* Product flags a paste/bulk-insert event where field length jumps by many characters in a single input event with no matching keydown sequence. *Pass criteria:* PASS if every paste/bulk-insert of 40+ characters is flagged within the same question and no genuinely typed control answer is flagged. FAIL on any missed paste or any false flag on typed controls.
- **AI-03-T2** — *Procedure:* Feed known-AI-generated and known-human answers of matched length into the content analyzer for the same prompts. Record classifier scores. *Expected detection:* Content/stylometry analyzer assigns AI-likelihood scores that separate the two sets. *Pass criteria:* PASS if AI-likelihood scoring separates AI from human answers with an operating point achieving at least 80 percent true-positive at no more than 10 percent false-positive on the lab set. FAIL if separation is below that bound.

**Remediation.**
- Disable or intercept paste in answer fields under lockdown and log every paste attempt with size and source when possible
- Reconcile field-length deltas against the captured keystroke stream and flag unexplained jumps
- Run stylometric/AI-text scoring on free-text answers as a secondary review signal, not an automatic fail
- Capture a short typed baseline sample at exam start for per-candidate comparison

#### [AI-04] Response-timing anomalies from AI assistance — Severity: High

**What it is.** AI help compresses or homogenizes the time between question presentation and answer submission. Signatures include implausibly short times on high-difficulty items, uniform latency across items of very different difficulty, or a consistent fixed offset consistent with a read-relay-transcribe loop. Timing is a device-independent signal that works even when the assistance itself is off-machine.

**What a cheater gains.** Candidate obtains answers from an external AI fast enough that per-item response time no longer scales with item difficulty.

**Detection signals to verify.**
- Response time below a difficulty-calibrated floor for hard items
- Weak or absent correlation between item difficulty and time-to-answer
- Abnormally low variance of per-item latency across mixed-difficulty items
- Consistent fixed latency offset consistent with a relay loop
- Time-to-first-keystroke that is long (reading elsewhere) followed by fast, error-free entry

**Lab test cases.**
- **AI-04-T1** — *Procedure:* Build a lab exam with items pre-calibrated by difficulty. Run assisted sessions (external answers) and unassisted baseline sessions. Compare per-item response-time distributions against difficulty. *Expected detection:* Analytics flags sessions where response time fails to correlate with item difficulty or falls below a hard-item floor. *Pass criteria:* PASS if assisted sessions are flagged for timing anomaly at least 80 percent of the time while unassisted baselines are flagged at most 10 percent. FAIL outside those bounds.
- **AI-04-T2** — *Procedure:* Inject sessions exhibiting near-constant per-item latency (low variance) across mixed-difficulty items. Confirm the variance/uniformity detector responds. *Expected detection:* Product raises a uniform-latency anomaly for the low-variance sessions. *Pass criteria:* PASS if all scripted uniform-latency sessions are flagged and natural-variance baselines are not. FAIL on any miss or baseline false positive.

**Remediation.**
- Pre-calibrate item difficulty and score per-item response time against a difficulty-aware model
- Track latency variance and flag uniformity as well as speed outliers
- Combine timing with time-to-first-keystroke and edit-count features for a composite anomaly score
- Route timing-flagged sessions to human review rather than auto-invalidating

#### [AI-05] Keystroke-dynamics and transcription-cadence anomalies — Severity: Medium

**What it is.** When a candidate transcribes an AI answer read from elsewhere, the keystroke rhythm differs from authentic composition: steady copy-cadence with few corrections, absent think-pauses, burst-typing of exact tokens, or a per-candidate typing biometric that drifts mid-exam (suggesting a different operator or robotic injection). These dynamics are observable without capturing content.

**What a cheater gains.** Candidate types out externally supplied text, or an input-injection tool emits keystrokes, altering the natural timing signature.

**Detection signals to verify.**
- Inter-key interval distribution inconsistent with the enrolled per-candidate baseline
- Abnormally low correction/backspace rate on long answers
- Absence of natural composition pauses; steady copy-cadence
- Machine-regular (near-zero variance) inter-key timing indicating injection
- Mid-exam drift in typing biometric suggesting operator change

**Lab test cases.**
- **AI-05-T1** — *Procedure:* Collect a per-candidate typing baseline, then run sessions where the candidate transcribes dictated external text and sessions of genuine composition. Compare inter-key interval distributions, correction rates, and pause structure. *Expected detection:* Product flags transcription sessions for atypical cadence (low correction rate, missing composition pauses) or drift from the enrolled biometric. *Pass criteria:* PASS if transcription sessions are flagged at least 75 percent of the time with at most 15 percent false-positive on genuine composition. FAIL outside bounds.
- **AI-05-T2** — *Procedure:* Feed synthetically injected keystroke streams (machine-uniform inter-key timing) into the analyzer. Confirm the machine-cadence detector fires. *Expected detection:* Product flags implausibly regular inter-key timing consistent with programmatic injection. *Pass criteria:* PASS if all injected uniform-cadence streams are flagged and human baselines are not. FAIL on any miss.

**Remediation.**
- Enroll a keystroke-dynamics baseline per candidate at exam start and monitor for drift
- Score correction rate and pause structure as composition-authenticity features
- Flag near-uniform inter-key timing as probable programmatic injection
- Use keystroke anomalies as a corroborating signal fused with timing and paste detection

#### [AI-06] Window-focus loss, tab switching, and remote-desktop/VM helper patterns — Severity: High

**What it is.** The candidate switches focus to another window/tab/monitor to consult an AI tool, or runs the exam inside a VM or remote-desktop session so a helper on the host (or a remote operator) can see the screen and feed answers. Signals include focus/blur events, secondary-display presence, virtualization artifacts, and remote-control input signatures.

**What a cheater gains.** Candidate can alt-tab to a helper app, attach a second monitor, or run the exam inside a virtual machine or remote-desktop session.

**Detection signals to verify.**
- Window blur / focus-loss and tab-visibility-change events during the exam
- More than one active display connected to the exam machine
- Virtualization artifacts (hypervisor indicators, virtual devices)
- Remote-desktop/remote-control input signatures or virtual input drivers
- Full-screen exit or minimize events under lockdown

**Lab test cases.**
- **AI-06-T1** — *Procedure:* During locked-down mock exams, perform scripted focus-loss/tab-switch events and second-monitor attachment. Inspect focus and display telemetry. *Expected detection:* Product logs each window blur/focus-loss and detects the additional display, correlating events with question activity. *Pass criteria:* PASS if every scripted focus-loss and the second-monitor attachment is logged with a timestamp and surfaced as an alert. FAIL on any unlogged event.
- **AI-06-T2** — *Procedure:* Run the exam client inside a VM and separately under a remote-desktop session in the lab. Check whether the client detects virtualization and remote-control input signatures. *Expected detection:* Client reports a virtualized environment and/or active remote-control session and blocks or flags the attempt. *Pass criteria:* PASS if both the VM and the remote-desktop session are detected and flagged/blocked at launch. FAIL if either runs undetected.

**Remediation.**
- Enforce full-screen lockdown and log every focus-loss, blur, and visibility-change event
- Detect and reject or flag additional connected displays at launch and during the exam
- Detect virtualized and remote-controlled environments at launch and gate entry
- Alert on virtual input drivers and remote-control sessions establishing mid-exam

#### [AI-07] Browser extension or in-page DOM injection AI helper — Severity: High

**What it is.** A browser extension, bookmarklet, or injected script reads the rendered question text from the DOM and either calls an AI service or displays a hint inline, without a separate visible window. The exam runs in a browser, so the helper lives in the same page context and can be invisible in screen capture while still reading question content.

**What a cheater gains.** Candidate can install a browser extension or inject script into the exam page before or during the session in a non-hardened browser.

**Detection signals to verify.**
- Unauthorized/unexpected browser extensions present at launch
- Foreign DOM nodes injected into the exam page or unexpected mutation-observer activity
- Outbound network requests from the exam page to non-allowlisted endpoints
- Developer tools or console open during the exam
- Exam running outside the hardened lockdown client

**Lab test cases.**
- **AI-07-T1** — *Procedure:* Load the exam in a browser with a benign stand-in extension that reads exam DOM nodes and injects an overlay element. Check whether the lockdown browser/agent detects extensions and unexpected DOM mutations or outbound calls. *Expected detection:* Product detects the presence of an unauthorized extension and/or foreign DOM mutations and outbound network calls from the exam page. *Pass criteria:* PASS if the extension presence or the injected DOM node is detected and flagged before answer submission. FAIL if the helper operates undetected.
- **AI-07-T2** — *Procedure:* Attempt to run the exam outside the hardened/lockdown browser (standard browser with dev tools and extensions enabled). Confirm the gating. *Expected detection:* Exam refuses to start or flags the session when not run in the hardened lockdown client. *Pass criteria:* PASS if the non-hardened environment is blocked or flagged at launch. FAIL if the exam proceeds normally.

**Remediation.**
- Require a hardened lockdown browser that disables extensions and dev tools and refuse to run elsewhere
- Monitor the exam DOM for unexpected mutations and injected nodes
- Constrain and monitor page network egress to an allowlist
- Serve question content in a way that resists trivial DOM scraping and detect scripted reads

#### [AI-08] Stylometric / AI-text fingerprint in free-text responses — Severity: Medium

**What it is.** Even when no host-based tell exists, AI-authored free-text answers often carry statistical fingerprints (low perplexity, low burstiness, uniform sentence structure, generic hedging, absence of the candidate's idiosyncrasies). A content-analysis layer flags answers whose style is inconsistent with the candidate's baseline or characteristic of machine generation.

**What a cheater gains.** Candidate submits AI-authored prose for free-response items by any channel, including channels that leave no device signal.

**Detection signals to verify.**
- Low perplexity / low burstiness relative to human writing
- Uniform sentence length and generic structure atypical of the candidate baseline
- Style divergence from the candidate's enrolled writing sample
- Absence of expected domain errors or idiosyncrasies given the candidate's other answers

**Lab test cases.**
- **AI-08-T1** — *Procedure:* Assemble a labeled lab corpus of AI-authored and human-authored answers for identical prompts, plus a per-candidate baseline sample. Run the content analyzer and record scores. *Expected detection:* Analyzer separates AI from human answers and flags divergence from the candidate baseline. *Pass criteria:* PASS if the analyzer achieves at least 80 percent true-positive at no more than 15 percent false-positive on the labeled corpus. FAIL below that operating point.
- **AI-08-T2** — *Procedure:* Submit lightly paraphrased AI text (a common evasion) and confirm whether scoring degrades gracefully and still routes borderline cases to human review. *Expected detection:* Borderline/paraphrased items receive intermediate scores and are queued for human review rather than silently passing. *Pass criteria:* PASS if paraphrased-AI items land above the review threshold and enter the human-review queue. FAIL if they pass as clean without review.

**Remediation.**
- Run stylometric and AI-likelihood scoring on free-text answers as a review-triage signal, never as an automatic fail
- Capture a per-candidate writing baseline for comparison
- Set a conservative threshold that routes borderline cases to trained human reviewers
- Combine content scores with timing, paste, and keystroke evidence before any integrity decision

---

## Coverage Review & Recommended Additions

**Techniques to add.**
- Head-worn / wrist-worn covert displays: AR smart glasses and smartwatches used as reference or answer channels are not distinguished from the generic 'second device' (EN-03/NW-03); they render notes in the candidate's line of sight and evade room scans differently.
- Exam-item harvesting / content exfiltration at scale: systematic screenshot, OCR, or transcription of live items to build braindump banks. DC-07 only mentions 'reuse' in passing; there is no content-security treatment of item theft.
- Pre-knowledge / leaked-item exposure (braindumps): candidate memorized or purchased live items before sitting. No content-lifecycle / item-exposure domain exists.
- Peer / group collusion: multiple candidates sitting the same form simultaneously and sharing answers in real time, distinct from the single-helper model assumed throughout NW/EN.
- Insider and supply-chain compromise: colluding proctor or test-center staff, tampered lockdown-client installer, or compromised delivery infrastructure. Entirely absent.
- Behavioral-biometric spoofing / anti-idle automation: mouse jigglers, synthetic activity, and replayed keystroke-dynamics profiles that defeat continuous authentication. AI-05 lists cadence detection but no threat entry for actively spoofing it.
- Ultrasonic / covert acoustic and haptic cueing: inaudible-tone or vibration signaling beyond the human earpiece (EN-04) and audible coaching (EN-07).
- Client-side exam-timer, retry, and answer-submission tampering: manipulating the timer, resubmitting graded payloads, or forging scoring calls — distinct from telemetry spoofing (AT-04).
- Session / retake abuse: token reuse, session-resumption, or scheduling exploits granting extra attempts or mid-exam re-entry.
- Sanctioned-gap exploitation: bathroom breaks and other approved off-camera excursions used to consult resources.
- Device-inventory spoofing: masking extra monitors, USB HID devices, or virtual adapters from the pre-exam environment check so the enumeration itself is falsified.

**Test cases to tighten.**
- OV-03 'near-transparent / low-opacity overlay evading human proctor review': 'evading human review' is subjective. Tighten to a machine check — flag any top-level window with per-pixel alpha below a defined threshold or with a measurable pixel-diff against the captured frame.
- AI-04 'response-timing anomalies': vague. Define an objective metric — answer latency versus a per-item difficulty baseline, flagged when below the Nth percentile of a validated cohort distribution.
- AI-05 / AI-08 keystroke-dynamics and stylometric fingerprints: not objectively verifiable as written. Specify the enrollment baseline, the distance metric, and the decision threshold with target false-positive rate.
- ID-06 '3D mask / wearable presentation-attack': no acceptance criterion. Bind to ISO/IEC 30107-3 with stated APCER/BPCER targets at a fixed operating point.
- EN-05 'mirrors and reflective surfaces' and EN-07 'acoustic cues': no pass/fail. Define detectable signal (reflected second-screen luminance region; correlated off-camera speech segments) and a scored threshold.
- DC-08 'off-screen rendering / desktop duplication': hard to verify as stated. Specify the observable — enumerated duplication API handles or surface count exceeding the captured-surface count.
- AI-06 'window-focus loss, tab switching, VM helper patterns': this is a bundle of signals, not one verifiable case. Split into discrete counters (focus-loss events, tab-switch count) each with a threshold, so results are reproducible.

**Severity consistency notes.**
- Same-vector browser AI helper rated inconsistently: BR-02 'malicious extension' = Critical but AI-07 'extension / DOM-injection AI helper' = High. Align these — they are the same injection vector.
- Screen-streaming to a remote helper spans two severities: DC-04 wireless mirroring = High and DC-05 screen-share = Critical and NW-04 live streaming = Critical. The underlying capability (helper sees the exam live) should carry one severity.
- Virtual-camera injection is Critical for identity (ID-02) but High for feed injection (NW-08) despite being the same technical mechanism; document why or align.
- Presentation-attack ladder is uneven: ID-01 photo replay = High, ID-02 deepfake = Critical, ID-06 3D mask = Medium. A well-made 3D mask is at least as hard to detect as photo replay, so Medium looks low.
- Stealth paste-trigger devices disagree: IN-02 macro keypad = High but IN-06 foot pedal = Medium, though both deliver stored content on a single covert actuation.
- DC-07 local recording = Medium undervalues content-theft / item-harvesting impact, which is a program-level (not session-level) compromise.
- AI-04/05/06/08 are detection signals scored with threat severities, mixing two axes; detectability should not be rated on the same scale as attacker impact.

**Additional recommended threats.**

| Domain | Title | Severity | Rationale |
|---|---|---|---|
| Content Security & Item Exposure | Live-item harvesting and braindump reconstruction (OCR/screenshot/transcription of exam items) | Critical | Compromises the item bank for every future candidate, not just one session; program-wide impact that the current session-integrity-only catalog omits. |
| Content Security & Item Exposure | Pre-knowledge from leaked or purchased items (braindumps) | High | Defeats the assessment entirely with no in-session anomaly to detect; requires content-lifecycle and item-rotation controls absent from the catalog. |
| Governance & Insider Threat | Colluding proctor / test-center staff or tampered lockdown-client installer | Critical | An insider or supply-chain compromise bypasses all client-side controls at once; no domain currently addresses trust in the delivery chain. |
| Input & Peripheral Channels | Head-worn AR smart glasses or smartwatch as covert display/answer channel | High | In-line-of-sight rendering evades room scans and camera framing differently from a phone; increasingly available consumer hardware. |
| Proctor Agent & Evidence Integrity | Behavioral-biometric spoofing and anti-idle automation (mouse jigglers, replayed keystroke profiles) | High | Directly defeats continuous authentication and idle detection that the AI-behavioral domain relies on for evidence. |
| Network & Out-of-Band Communication | Real-time peer/group collusion across simultaneous sittings of the same form | High | Answer sharing among candidates is a distinct threat model from the single-helper assumption and scales with cohort size. |
| Browser & Lockdown Integrity | Client-side timer, retry, and answer-submission payload tampering | High | Manipulating timing or graded payloads alters outcomes directly and is separate from telemetry spoofing (AT-04). |

**Notes.**
- Separate 'attacker techniques' from 'detection signals' in the schema. AI-04, AI-05, AI-06, and AI-08 are observability signals; scoring them with impact severities conflates two independent axes and drives several of the severity inconsistencies.
- Remote control, KVM/capture bridges, and virtual-camera injection each appear across three to four domains (DC/VM/NW/IN) with drifting severities. Assign one canonical ID per capability and cross-reference it so severity and test criteria stay single-sourced.
- Adopt a published, uniform severity rubric (impact x exploitability x detectability) and re-score the whole catalog against it; most flagged inconsistencies stem from the absence of a shared rubric.
- Every entry is currently a title only. Add explicit, objectively verifiable pass/fail acceptance criteria and a required evidence artifact per threat, and cite standards where they exist (e.g., ISO/IEC 30107-3 for presentation-attack detection).
- Add a Content Security & Item Exposure domain and a Governance & Insider Threat domain. The catalog is comprehensive on session integrity but silent on the item lifecycle and on trust in the delivery chain.
- Map each threat to at least one detection control and account for legitimate-use false positives (genuine screen readers, magnifiers, accessibility tooling) so hardening does not over-block disabled candidates.
- Stay defender-oriented: keep entries as detection/monitoring objectives and evidence requirements, not reproduction steps.

---

## Appendix — Test Execution Checklist

| Test ID | Domain | Threat | Result (Pass/Fail) | Notes |
|---|---|---|---|---|
| DC-01-T1 | Display & Screen-Capture Evasion | Software virtual / headless display adapter presents a hidden second surface |  |  |
| DC-01-T2 | Display & Screen-Capture Evasion | Software virtual / headless display adapter presents a hidden second surface |  |  |
| DC-02-T1 | Display & Screen-Capture Evasion | Physical extended / secondary monitor out of camera view |  |  |
| DC-02-T2 | Display & Screen-Capture Evasion | Physical extended / secondary monitor out of camera view |  |  |
| DC-03-T1 | Display & Screen-Capture Evasion | HDMI splitter or capture card duplicating exam output to a second device |  |  |
| DC-03-T2 | Display & Screen-Capture Evasion | HDMI splitter or capture card duplicating exam output to a second device |  |  |
| DC-04-T1 | Display & Screen-Capture Evasion | Wireless screen mirroring / casting to a nearby device |  |  |
| DC-04-T2 | Display & Screen-Capture Evasion | Wireless screen mirroring / casting to a nearby device |  |  |
| DC-05-T1 | Display & Screen-Capture Evasion | Remote-control / screen-share session exposing the exam to a helper |  |  |
| DC-05-T2 | Display & Screen-Capture Evasion | Remote-control / screen-share session exposing the exam to a helper |  |  |
| DC-06-T1 | Display & Screen-Capture Evasion | Second-machine capture via KVM / hardware capture feeding a helper PC |  |  |
| DC-06-T2 | Display & Screen-Capture Evasion | Second-machine capture via KVM / hardware capture feeding a helper PC |  |  |
| DC-07-T1 | Display & Screen-Capture Evasion | Local display-recording capturing exam content for reuse or exfiltration |  |  |
| DC-07-T2 | Display & Screen-Capture Evasion | Local display-recording capturing exam content for reuse or exfiltration |  |  |
| DC-08-T1 | Display & Screen-Capture Evasion | Off-screen rendering / desktop duplication bypassing the visible primary surface |  |  |
| DC-08-T2 | Display & Screen-Capture Evasion | Off-screen rendering / desktop duplication bypassing the visible primary surface |  |  |
| OV-01-T1 | Overlay & Invisible On-Screen Assistant Windows | Capture-excluded overlay (display-affinity / capture-exclusion flag) |  |  |
| OV-01-T2 | Overlay & Invisible On-Screen Assistant Windows | Capture-excluded overlay (display-affinity / capture-exclusion flag) |  |  |
| OV-02-T1 | Overlay & Invisible On-Screen Assistant Windows | Always-on-top click-through transparent overlay |  |  |
| OV-02-T2 | Overlay & Invisible On-Screen Assistant Windows | Always-on-top click-through transparent overlay |  |  |
| OV-03-T1 | Overlay & Invisible On-Screen Assistant Windows | Near-transparent / low-opacity overlay evading human proctor review |  |  |
| OV-03-T2 | Overlay & Invisible On-Screen Assistant Windows | Near-transparent / low-opacity overlay evading human proctor review |  |  |
| OV-04-T1 | Overlay & Invisible On-Screen Assistant Windows | Accessibility / screen-reader surface used to deliver hidden help |  |  |
| OV-04-T2 | Overlay & Invisible On-Screen Assistant Windows | Accessibility / screen-reader surface used to deliver hidden help |  |  |
| OV-05-T1 | Overlay & Invisible On-Screen Assistant Windows | Overlay on a second display or extended desktop outside the captured surface |  |  |
| OV-05-T2 | Overlay & Invisible On-Screen Assistant Windows | Overlay on a second display or extended desktop outside the captured surface |  |  |
| OV-06-T1 | Overlay & Invisible On-Screen Assistant Windows | Overlay injected via compositor / GPU overlay plane or hardware-cursor layer |  |  |
| OV-07-T1 | Overlay & Invisible On-Screen Assistant Windows | Overlay timed/gated to evade periodic sampling and go dark during capture |  |  |
| OV-08-T1 | Overlay & Invisible On-Screen Assistant Windows | Overlay hidden inside a trusted or exempt window (IME, tooltip, notification, in-browser injected panel) |  |  |
| OV-08-T2 | Overlay & Invisible On-Screen Assistant Windows | Overlay hidden inside a trusted or exempt window (IME, tooltip, notification, in-browser injected panel) |  |  |
| VM-01-T1 | Virtualization, Remote Access & Sandboxing | Exam executed inside a guest virtual machine to sandbox and defeat the proctor |  |  |
| VM-01-T2 | Virtualization, Remote Access & Sandboxing | Exam executed inside a guest virtual machine to sandbox and defeat the proctor |  |  |
| VM-02-T1 | Virtualization, Remote Access & Sandboxing | Nested virtualization or hypervisor-level concealment to hide the outer control layer |  |  |
| VM-02-T2 | Virtualization, Remote Access & Sandboxing | Nested virtualization or hypervisor-level concealment to hide the outer control layer |  |  |
| VM-03-T1 | Virtualization, Remote Access & Sandboxing | Exam run on a cloud desktop / DaaS instead of the local proctored machine |  |  |
| VM-03-T2 | Virtualization, Remote Access & Sandboxing | Exam run on a cloud desktop / DaaS instead of the local proctored machine |  |  |
| VM-04-T1 | Virtualization, Remote Access & Sandboxing | Real-time remote control by a helper via RDP/VNC (screen and input handed to an accomplice) |  |  |
| VM-04-T2 | Virtualization, Remote Access & Sandboxing | Real-time remote control by a helper via RDP/VNC (screen and input handed to an accomplice) |  |  |
| VM-05-T1 | Virtualization, Remote Access & Sandboxing | Remote-assistance tools (TeamViewer / AnyDesk / Chrome Remote Desktop / relay services) for helper access |  |  |
| VM-05-T2 | Virtualization, Remote Access & Sandboxing | Remote-assistance tools (TeamViewer / AnyDesk / Chrome Remote Desktop / relay services) for helper access |  |  |
| VM-06-T1 | Virtualization, Remote Access & Sandboxing | OS-level sandbox / container / browser-in-browser execution to isolate and blind the proctor |  |  |
| VM-06-T2 | Virtualization, Remote Access & Sandboxing | OS-level sandbox / container / browser-in-browser execution to isolate and blind the proctor |  |  |
| VM-07-T1 | Virtualization, Remote Access & Sandboxing | Hardware KVM / capture-card bridge feeding a second machine that software cannot introspect |  |  |
| VM-07-T2 | Virtualization, Remote Access & Sandboxing | Hardware KVM / capture-card bridge feeding a second machine that software cannot introspect |  |  |
| BR-01-T1 | Browser & Lockdown Integrity | DevTools / Console open for live DOM and runtime inspection |  |  |
| BR-01-T2 | Browser & Lockdown Integrity | DevTools / Console open for live DOM and runtime inspection |  |  |
| BR-02-T1 | Browser & Lockdown Integrity | Malicious browser extension or userscript injecting into the exam page |  |  |
| BR-02-T2 | Browser & Lockdown Integrity | Malicious browser extension or userscript injecting into the exam page |  |  |
| BR-03-T1 | Browser & Lockdown Integrity | Tampering with the proctor client JavaScript or its telemetry channel |  |  |
| BR-03-T2 | Browser & Lockdown Integrity | Tampering with the proctor client JavaScript or its telemetry channel |  |  |
| BR-04-T1 | Browser & Lockdown Integrity | Headless automation and CDP-driven browser control |  |  |
| BR-04-T2 | Browser & Lockdown Integrity | Headless automation and CDP-driven browser control |  |  |
| BR-05-T1 | Browser & Lockdown Integrity | Process or module injection into the browser process |  |  |
| BR-05-T2 | Browser & Lockdown Integrity | Process or module injection into the browser process |  |  |
| BR-06-T1 | Browser & Lockdown Integrity | Debugger attach to pause and rewrite runtime behavior |  |  |
| BR-06-T2 | Browser & Lockdown Integrity | Debugger attach to pause and rewrite runtime behavior |  |  |
| BR-07-T1 | Browser & Lockdown Integrity | Running the exam outside the intended lockdown client (unmanaged browser, spoofed client, or nested VM) |  |  |
| BR-07-T2 | Browser & Lockdown Integrity | Running the exam outside the intended lockdown client (unmanaged browser, spoofed client, or nested VM) |  |  |
| IN-01-T1 | Input & Peripheral Channels | Second or hidden physical keyboard providing parallel input |  |  |
| IN-01-T2 | Input & Peripheral Channels | Second or hidden physical keyboard providing parallel input |  |  |
| IN-02-T1 | Input & Peripheral Channels | Programmable macro keypad delivering pre-loaded content on one keypress |  |  |
| IN-02-T2 | Input & Peripheral Channels | Programmable macro keypad delivering pre-loaded content on one keypress |  |  |
| IN-03-T1 | Input & Peripheral Channels | HID keystroke-injection device (BadUSB-class) autotyping content |  |  |
| IN-03-T2 | Input & Peripheral Channels | HID keystroke-injection device (BadUSB-class) autotyping content |  |  |
| IN-04-T1 | Input & Peripheral Channels | KVM switch routing keyboard/mouse to a hidden helper machine |  |  |
| IN-04-T2 | Input & Peripheral Channels | KVM switch routing keyboard/mouse to a hidden helper machine |  |  |
| IN-05-T1 | Input & Peripheral Channels | Software autotype and clipboard-injection tools inserting stored answers |  |  |
| IN-05-T2 | Input & Peripheral Channels | Software autotype and clipboard-injection tools inserting stored answers |  |  |
| IN-06-T1 | Input & Peripheral Channels | Foot pedal or concealed input trigger for stealth signaling and paste |  |  |
| IN-06-T2 | Input & Peripheral Channels | Foot pedal or concealed input trigger for stealth signaling and paste |  |  |
| IN-07-T1 | Input & Peripheral Channels | Wireless/Bluetooth HID relay using a phone or companion device as keyboard |  |  |
| IN-07-T2 | Input & Peripheral Channels | Wireless/Bluetooth HID relay using a phone or companion device as keyboard |  |  |
| ID-01-T1 | Identity Verification & Liveness | Static photo / pre-recorded video replay against face match |  |  |
| ID-01-T2 | Identity Verification & Liveness | Static photo / pre-recorded video replay against face match |  |  |
| ID-02-T1 | Identity Verification & Liveness | Deepfake / virtual-camera injected feed |  |  |
| ID-02-T2 | Identity Verification & Liveness | Deepfake / virtual-camera injected feed |  |  |
| ID-03-T1 | Identity Verification & Liveness | Proxy / impersonator test-taker (surrogate sits the exam) |  |  |
| ID-03-T2 | Identity Verification & Liveness | Proxy / impersonator test-taker (surrogate sits the exam) |  |  |
| ID-04-T1 | Identity Verification & Liveness | Forged, tampered, or substituted ID document |  |  |
| ID-04-T2 | Identity Verification & Liveness | Forged, tampered, or substituted ID document |  |  |
| ID-05-T1 | Identity Verification & Liveness | Mid-exam candidate swap after successful verification |  |  |
| ID-05-T2 | Identity Verification & Liveness | Mid-exam candidate swap after successful verification |  |  |
| ID-06-T1 | Identity Verification & Liveness | 3D mask / wearable presentation-attack instrument |  |  |
| ID-06-T2 | Identity Verification & Liveness | 3D mask / wearable presentation-attack instrument |  |  |
| ID-07-T1 | Identity Verification & Liveness | Enrollment poisoning / biometric template substitution |  |  |
| ID-07-T2 | Identity Verification & Liveness | Enrollment poisoning / biometric template substitution |  |  |
| NW-01-T1 | Network & Out-of-Band Communication | VPN, Proxy, or Anonymizer Tunneling to Mask Location or Bypass Controls |  |  |
| NW-01-T2 | Network & Out-of-Band Communication | VPN, Proxy, or Anonymizer Tunneling to Mask Location or Bypass Controls |  |  |
| NW-02-T1 | Network & Out-of-Band Communication | Cellular Tethering or Hotspot to Escape a Monitored Network Path |  |  |
| NW-02-T2 | Network & Out-of-Band Communication | Cellular Tethering or Hotspot to Escape a Monitored Network Path |  |  |
| NW-03-T1 | Network & Out-of-Band Communication | Companion Second Device for Lookups or Answer Relay |  |  |
| NW-03-T2 | Network & Out-of-Band Communication | Companion Second Device for Lookups or Answer Relay |  |  |
| NW-04-T1 | Network & Out-of-Band Communication | Live Screen-Streaming of the Exam to a Remote Helper |  |  |
| NW-04-T2 | Network & Out-of-Band Communication | Live Screen-Streaming of the Exam to a Remote Helper |  |  |
| NW-05-T1 | Network & Out-of-Band Communication | Out-of-Band Real-Time Chat Channels for Answer Relay |  |  |
| NW-05-T2 | Network & Out-of-Band Communication | Out-of-Band Real-Time Chat Channels for Answer Relay |  |  |
| NW-06-T1 | Network & Out-of-Band Communication | DNS Anomalies and Encrypted-DNS Tunneling |  |  |
| NW-06-T2 | Network & Out-of-Band Communication | DNS Anomalies and Encrypted-DNS Tunneling |  |  |
| NW-07-T1 | Network & Out-of-Band Communication | Remote-Desktop Takeover by an Accomplice |  |  |
| NW-07-T2 | Network & Out-of-Band Communication | Remote-Desktop Takeover by an Accomplice |  |  |
| NW-08-T1 | Network & Out-of-Band Communication | Virtual Camera or Virtual Audio Device Injecting an External Feed |  |  |
| NW-08-T2 | Network & Out-of-Band Communication | Virtual Camera or Virtual Audio Device Injecting an External Feed |  |  |
| AT-01-TC1 | Proctor Agent & Evidence Integrity | Agent termination or suspension mid-session |  |  |
| AT-01-TC2 | Proctor Agent & Evidence Integrity | Agent termination or suspension mid-session |  |  |
| AT-02-TC1 | Proctor Agent & Evidence Integrity | Binary or memory patching of the agent |  |  |
| AT-02-TC2 | Proctor Agent & Evidence Integrity | Binary or memory patching of the agent |  |  |
| AT-03-TC1 | Proctor Agent & Evidence Integrity | API and kernel hooking to blind observation |  |  |
| AT-03-TC2 | Proctor Agent & Evidence Integrity | API and kernel hooking to blind observation |  |  |
| AT-04-TC1 | Proctor Agent & Evidence Integrity | Spoofed or synthetic telemetry / replay |  |  |
| AT-04-TC2 | Proctor Agent & Evidence Integrity | Spoofed or synthetic telemetry / replay |  |  |
| AT-05-TC1 | Proctor Agent & Evidence Integrity | Local clock and timezone manipulation |  |  |
| AT-05-TC2 | Proctor Agent & Evidence Integrity | Local clock and timezone manipulation |  |  |
| AT-06-TC1 | Proctor Agent & Evidence Integrity | Blocking or degrading evidence upload |  |  |
| AT-06-TC2 | Proctor Agent & Evidence Integrity | Blocking or degrading evidence upload |  |  |
| AT-07-TC1 | Proctor Agent & Evidence Integrity | Tampering with recorded media integrity |  |  |
| AT-07-TC2 | Proctor Agent & Evidence Integrity | Tampering with recorded media integrity |  |  |
| AT-08-TC1 | Proctor Agent & Evidence Integrity | Impersonation of a healthy agent (rogue client / fake heartbeat) |  |  |
| AT-08-TC2 | Proctor Agent & Evidence Integrity | Impersonation of a healthy agent (rogue client / fake heartbeat) |  |  |
| EN-01-T1 | Environmental & Physical | Second (accomplice) person present in the exam room |  |  |
| EN-01-T2 | Environmental & Physical | Second (accomplice) person present in the exam room |  |  |
| EN-02-T1 | Environmental & Physical | Printed or handwritten reference notes |  |  |
| EN-02-T2 | Environmental & Physical | Printed or handwritten reference notes |  |  |
| EN-03-T1 | Environmental & Physical | Secondary device (phone / tablet) used for lookup |  |  |
| EN-03-T2 | Environmental & Physical | Secondary device (phone / tablet) used for lookup |  |  |
| EN-04-T1 | Environmental & Physical | Hidden earpiece with remote human helper |  |  |
| EN-04-T2 | Environmental & Physical | Hidden earpiece with remote human helper |  |  |
| EN-05-T1 | Environmental & Physical | Mirrors and reflective surfaces |  |  |
| EN-05-T2 | Environmental & Physical | Mirrors and reflective surfaces |  |  |
| EN-06-T1 | Environmental & Physical | Room-scan gaps and staged environment |  |  |
| EN-06-T2 | Environmental & Physical | Room-scan gaps and staged environment |  |  |
| EN-07-T1 | Environmental & Physical | Audio-channel coaching and acoustic cues |  |  |
| EN-07-T2 | Environmental & Physical | Audio-channel coaching and acoustic cues |  |  |
| EN-08-T1 | Environmental & Physical | Camera framing and occlusion manipulation |  |  |
| EN-08-T2 | Environmental & Physical | Camera framing and occlusion manipulation |  |  |
| AI-01-T1 | AI-Assistance & Behavioral Anomaly Detection | Invisible or content-protected desktop AI assistant (overlay reads screen, surfaces answers) |  |  |
| AI-01-T2 | AI-Assistance & Behavioral Anomaly Detection | Invisible or content-protected desktop AI assistant (overlay reads screen, surfaces answers) |  |  |
| AI-02-T1 | AI-Assistance & Behavioral Anomaly Detection | Out-of-band phone-based AI (second device photographs screen, AI answers off-camera) |  |  |
| AI-02-T2 | AI-Assistance & Behavioral Anomaly Detection | Out-of-band phone-based AI (second device photographs screen, AI answers off-camera) |  |  |
| AI-03-T1 | AI-Assistance & Behavioral Anomaly Detection | Verbatim paste of AI-generated answer text |  |  |
| AI-03-T2 | AI-Assistance & Behavioral Anomaly Detection | Verbatim paste of AI-generated answer text |  |  |
| AI-04-T1 | AI-Assistance & Behavioral Anomaly Detection | Response-timing anomalies from AI assistance |  |  |
| AI-04-T2 | AI-Assistance & Behavioral Anomaly Detection | Response-timing anomalies from AI assistance |  |  |
| AI-05-T1 | AI-Assistance & Behavioral Anomaly Detection | Keystroke-dynamics and transcription-cadence anomalies |  |  |
| AI-05-T2 | AI-Assistance & Behavioral Anomaly Detection | Keystroke-dynamics and transcription-cadence anomalies |  |  |
| AI-06-T1 | AI-Assistance & Behavioral Anomaly Detection | Window-focus loss, tab switching, and remote-desktop/VM helper patterns |  |  |
| AI-06-T2 | AI-Assistance & Behavioral Anomaly Detection | Window-focus loss, tab switching, and remote-desktop/VM helper patterns |  |  |
| AI-07-T1 | AI-Assistance & Behavioral Anomaly Detection | Browser extension or in-page DOM injection AI helper |  |  |
| AI-07-T2 | AI-Assistance & Behavioral Anomaly Detection | Browser extension or in-page DOM injection AI helper |  |  |
| AI-08-T1 | AI-Assistance & Behavioral Anomaly Detection | Stylometric / AI-text fingerprint in free-text responses |  |  |
| AI-08-T2 | AI-Assistance & Behavioral Anomaly Detection | Stylometric / AI-text fingerprint in free-text responses |  |  |

