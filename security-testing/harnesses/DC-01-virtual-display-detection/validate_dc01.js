/*
 * Bitecodes Proctor Validator — DC-01 detection-validation runner
 *
 * Validates that YOUR proctoring product detects a hidden second surface.
 * It does not create anything covertly: the tester introduces the virtual
 * display openly (see README), and this runner (1) confirms the stimulus is
 * actually present via the reference detector, then (2) asserts your product
 * raised the expected topology alert inside the deadline.
 *
 *   node validate_dc01.js baseline
 *       Snapshot the clean start-of-session topology to runs/baseline.json.
 *
 *   node validate_dc01.js check --test DC-01-T1 [--product-alerts <file>] [--deadline 30]
 *       Re-scan, diff against baseline, and emit PASS / FAIL / INVALID.
 *
 * Verdicts:
 *   INVALID  - no extra/virtual display appeared vs baseline; the test did not
 *              exercise the control, so detection cannot be judged.
 *   FAIL     - stimulus present, but the product did not alert in time.
 *   PASS     - stimulus present and the product alerted in time.
 *   NEEDS-PRODUCT-FEED - stimulus present and the reference detector flagged it,
 *              but no product alert log was supplied to confirm the product did.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { enumerate } = require('./detect_displays');

const RUNS = path.join(__dirname, 'runs');
const BASELINE = path.join(RUNS, 'baseline.json');
const DEADLINES = { 'DC-01-T1': 30, 'DC-01-T2': 60 };
const ALERT_MATCH = /display|monitor|topology|screen|virtual|indirect|second.?screen|extended/i;

function ensureRuns() { if (!fs.existsSync(RUNS)) fs.mkdirSync(RUNS, { recursive: true }); }

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; a[k] = v; }
    else a._.push(t);
  }
  return a;
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function cmdBaseline() {
  ensureRuns();
  const snap = enumerate();
  fs.writeFileSync(BASELINE, JSON.stringify(snap, null, 2));
  console.log(`[baseline] saved ${BASELINE}`);
  console.log(`[baseline] displays=${snap.displayCount} virtualDriver=${snap.signals.hasVirtualDisplayDriver} categories=[${snap.signals.suspiciousCategories.join(', ')}]`);
  if (snap.displayCount > 1 || snap.signals.hasVirtualDisplayDriver) {
    console.log('[baseline] WARNING: baseline is not clean (extra or virtual display already present). Reset the host before testing.');
  }
}

function loadProductAlerts(file) {
  // Expected format: JSON array of { timestamp: ISO8601, type: string, message: string }.
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.log(`[check] could not read product-alerts file: ${e.message}`);
    return null;
  }
}

function cmdCheck(args) {
  ensureRuns();
  if (!fs.existsSync(BASELINE)) { console.error('[check] no baseline found. Run: node validate_dc01.js baseline'); process.exit(2); }
  const test = String(args.test || 'DC-01-T1');
  const deadline = Number(args.deadline || DEADLINES[test] || 30);
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const checkStart = new Date();
  const current = enumerate();

  // --- Stimulus verification: did a hidden/extra surface actually appear? ---
  const addedDisplays = current.displayCount - baseline.displayCount;
  const baseCats = new Set(baseline.signals.suspiciousCategories);
  const newCategories = current.signals.suspiciousCategories.filter((c) => !baseCats.has(c));
  const newVirtualDriver = current.signals.hasVirtualDisplayDriver && !baseline.signals.hasVirtualDisplayDriver;
  const stimulusPresent = addedDisplays > 0 || newVirtualDriver || newCategories.includes('virtual-display-driver');

  // --- Product-alert evaluation (optional) ---
  let productVerdict = 'no-feed';
  let matchedAlerts = [];
  if (args['product-alerts']) {
    const alerts = loadProductAlerts(String(args['product-alerts']));
    if (alerts) {
      const windowStart = new Date(baseline.timestamp).getTime();
      const cutoff = checkStart.getTime() + deadline * 1000;
      matchedAlerts = alerts.filter((al) => {
        const t = Date.parse(al.timestamp);
        const text = `${al.type || ''} ${al.message || ''}`;
        return !Number.isNaN(t) && t >= windowStart && t <= cutoff && ALERT_MATCH.test(text);
      });
      productVerdict = matchedAlerts.length ? 'alerted-in-time' : 'no-alert-in-time';
    }
  }

  // --- Final verdict ---
  let verdict;
  if (!stimulusPresent) verdict = 'INVALID';
  else if (productVerdict === 'alerted-in-time') verdict = 'PASS';
  else if (productVerdict === 'no-alert-in-time') verdict = 'FAIL';
  else verdict = 'NEEDS-PRODUCT-FEED';

  const result = {
    tool: 'bitecodes-proctor-validator',
    control: 'DC-01',
    testCase: test,
    verdict,
    deadlineSeconds: deadline,
    stimulus: { present: stimulusPresent, addedDisplays, newVirtualDriver, newCategories },
    referenceDetector: { baselineDisplays: baseline.displayCount, currentDisplays: current.displayCount, currentSignals: current.signals },
    product: { verdict: productVerdict, matchedAlerts },
    baselineTimestamp: baseline.timestamp,
    checkTimestamp: checkStart.toISOString(),
  };

  const outFile = path.join(RUNS, `${stamp()}_${test}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  console.log(`\n=== DC-01 / ${test} → ${verdict} ===`);
  console.log(`stimulus present : ${stimulusPresent} (added displays=${addedDisplays}, new virtual driver=${newVirtualDriver})`);
  console.log(`reference detector: baseline=${baseline.displayCount} display(s) -> now=${current.displayCount}; categories=[${current.signals.suspiciousCategories.join(', ')}]`);
  console.log(`product alerts   : ${productVerdict}${matchedAlerts.length ? ` (${matchedAlerts.length} matched)` : ''}`);
  if (verdict === 'INVALID') console.log('note             : introduce the virtual display FIRST (see README), then re-run check.');
  if (verdict === 'NEEDS-PRODUCT-FEED') console.log('note             : pass --product-alerts <file> to assert your product itself detected this.');
  console.log(`log              : ${outFile}\n`);

  process.exitCode = (verdict === 'PASS' || verdict === 'NEEDS-PRODUCT-FEED') ? 0 : 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  if (sub === 'baseline') return cmdBaseline();
  if (sub === 'check') return cmdCheck(args);
  console.log('usage:\n  node validate_dc01.js baseline\n  node validate_dc01.js check --test DC-01-T1 [--product-alerts <file>] [--deadline 30]');
  process.exitCode = 2;
}

main();
