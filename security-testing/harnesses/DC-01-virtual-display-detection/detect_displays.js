/*
 * Bitecodes Proctor Validator — Display Topology Detector
 * Test control: DC-01 (virtual / indirect / headless display detection)
 *
 * PURPOSE (DEFENSIVE): enumerate the display topology of the current host and
 * surface signals a proctoring product should use to detect a hidden second
 * surface — extra logical displays, virtual/indirect-display drivers, and
 * displays that lack a physical EDID serial. This is a *detector*, not an
 * evader: it is loud, logged, and read-only. It changes nothing on the host.
 *
 * Software-side enumeration is heuristic and can be spoofed by a privileged
 * local user. Treat its output as one signal among several (camera-based
 * environment scan, network-side remote-session detection, live challenges),
 * never as an authoritative control on an unmanaged endpoint.
 */

'use strict';

const { execFileSync } = require('child_process');

// Known markers for synthetic / remote / casting display paths. Categories are
// advisory: "remote-access" and "external-or-casting" are often legitimate and
// should trigger review, not an automatic fail.
const SIGNATURES = [
  { re: /iddcx|indirect display|usbmmidd|amyuni|virtual\s*display|(^|\W)vdd(\W|$)|headless|superdisplay|twomon|deskreen|spacedesk|oray|sunlogin/i, category: 'virtual-display-driver' },
  { re: /parsec|splashtop|teamviewer|anydesk|(^|\W)vnc(\W|$)|(^|\W)rdp(\W|$)|remote desktop|chrome remote|nomachine/i, category: 'remote-access' },
  { re: /displaylink|duet|luna display|sidecar|airplay/i, category: 'external-or-casting' },
];

function classify(text) {
  if (!text) return [];
  const hits = [];
  for (const s of SIGNATURES) if (s.re.test(text)) hits.push(s.category);
  return hits;
}

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20000 });
  } catch {
    return '';
  }
}

// Return the first value whose key contains any of the given substrings.
function pick(obj, subs) {
  for (const k of Object.keys(obj || {})) {
    const lk = k.toLowerCase();
    if (subs.some((s) => lk.includes(s))) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).length) return v;
    }
  }
  return null;
}

function detectDarwin() {
  const out = run('system_profiler', ['SPDisplaysDataType', '-json']);
  const adapters = [];
  const displays = [];
  let parsed = null;
  try { parsed = JSON.parse(out); } catch { parsed = null; }
  const gpus = (parsed && parsed.SPDisplaysDataType) || [];
  for (const gpu of gpus) {
    const gpuName = gpu._name || pick(gpu, ['model']) || 'unknown-gpu';
    adapters.push({ name: gpuName, driver: pick(gpu, ['bundle', 'metal', 'vendor']) || '', categories: classify(gpuName) });
    const ndrvs = gpu.spdisplays_ndrvs || gpu._spdisplays_ndrvs || [];
    for (const d of ndrvs) {
      const online = d.spdisplays_online === undefined ? true : (d.spdisplays_online === 'spdisplays_yes' || d.spdisplays_online === true);
      const name = d._name || 'display';
      const serial = pick(d, ['serial']);
      const edid = pick(d, ['edid']);
      const resolution = pick(d, ['resolution', 'pixels']);
      displays.push({
        name,
        gpu: gpuName,
        online,
        hasSerial: !!serial,
        serial: serial ? String(serial) : null,
        hasEdid: !!edid,
        resolution: resolution ? String(resolution) : null,
        categories: classify(name),
      });
    }
  }
  return { adapters, displays, raw: parsed ? undefined : out.slice(0, 2000) };
}

function detectLinux() {
  const out = run('xrandr', ['--listmonitors']);
  const displays = [];
  out.split('\n').forEach((line) => {
    const m = line.match(/^\s*\d+:\s+\+?\*?(\S+)\s+(.+)$/);
    if (m) displays.push({ name: m[1], gpu: 'xrandr', online: true, hasSerial: false, serial: null, hasEdid: false, resolution: m[2].trim(), categories: classify(m[1]) });
  });
  const adaptersRaw = run('lspci', []);
  const adapters = adaptersRaw.split('\n').filter((l) => /vga|display|3d controller/i.test(l))
    .map((l) => ({ name: l.replace(/^\S+\s+/, '').trim(), driver: '', categories: classify(l) }));
  return { adapters, displays, raw: undefined };
}

function detectWindows() {
  // Single PowerShell pass emitting JSON. WmiMonitorID exposes EDID-derived
  // serials for physical panels; indirect-display drivers (IddCx) will not.
  const ps = [
    '$ErrorActionPreference="SilentlyContinue";',
    'function Dec($a){ if(-not $a){return $null}; -join ($a | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) }',
    '$mon = Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | ForEach-Object { [pscustomobject]@{ name=(Dec $_.UserFriendlyName); serial=(Dec $_.SerialNumberID); mfg=(Dec $_.ManufacturerName) } };',
    '$vc = Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverVersion; pnp=$_.PNPDeviceID; compat=$_.AdapterCompatibility } };',
    '$idd = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Service -match "IddCx|usbmmidd|amyuni|spacedesk|vdd" } | ForEach-Object { [pscustomobject]@{ name=$_.Name; service=$_.Service } };',
    '[pscustomobject]@{ monitors=$mon; adapters=$vc; indirect=$idd } | ConvertTo-Json -Depth 5 -Compress',
  ].join(' ');
  const out = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  let parsed = null;
  try { parsed = JSON.parse(out); } catch { parsed = null; }
  const asArr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
  const adapters = asArr(parsed && parsed.adapters).map((a) => ({ name: a.name || '', driver: a.driver || '', categories: classify(`${a.name} ${a.compat} ${a.pnp}`) }));
  asArr(parsed && parsed.indirect).forEach((i) => adapters.push({ name: i.name || '', driver: i.service || '', categories: classify(`${i.name} ${i.service}`).concat(['virtual-display-driver']) }));
  const displays = asArr(parsed && parsed.monitors).map((m) => ({ name: m.name || 'monitor', gpu: 'windows', online: true, hasSerial: !!m.serial, serial: m.serial || null, hasEdid: !!m.serial, resolution: null, categories: classify(m.name || '') }));
  return { adapters, displays, raw: parsed ? undefined : out.slice(0, 2000) };
}

function enumerate() {
  const platform = process.platform;
  let base;
  if (platform === 'darwin') base = detectDarwin();
  else if (platform === 'win32') base = detectWindows();
  else base = detectLinux();

  const onlineDisplays = base.displays.filter((d) => d.online !== false);
  const flaggedAdapters = base.adapters.filter((a) => a.categories.length);
  const flaggedDisplays = onlineDisplays.filter((d) => d.categories.length);
  const displaysWithoutSerial = onlineDisplays.filter((d) => !d.hasSerial).length;
  const categorySet = new Set();
  flaggedAdapters.concat(flaggedDisplays).forEach((x) => x.categories.forEach((c) => categorySet.add(c)));

  return {
    tool: 'bitecodes-proctor-validator',
    control: 'DC-01',
    platform,
    timestamp: new Date().toISOString(),
    displayCount: onlineDisplays.length,
    adapters: base.adapters,
    displays: onlineDisplays,
    signals: {
      displayCount: onlineDisplays.length,
      flaggedAdapters: flaggedAdapters.map((a) => ({ name: a.name, categories: a.categories })),
      flaggedDisplays: flaggedDisplays.map((d) => ({ name: d.name, categories: d.categories })),
      displaysWithoutSerial,
      suspiciousCategories: Array.from(categorySet),
      hasVirtualDisplayDriver: categorySet.has('virtual-display-driver'),
    },
    note: 'Software-side signals are heuristic and spoofable by a privileged local user. Combine with independent signals for high assurance.',
    raw: base.raw,
  };
}

module.exports = { enumerate, classify, SIGNATURES };

if (require.main === module) {
  process.stdout.write(JSON.stringify(enumerate(), null, 2) + '\n');
}
