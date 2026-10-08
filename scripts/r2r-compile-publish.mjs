#!/usr/bin/env node
/**
 * ReadyToRun-compile the managed assemblies of a BNDZ-Native publish folder in place.
 *
 * package-bndz-native.ps1 ships the `dotnet build` output, and the csproj's PublishReadyToRun
 * settings only apply to `dotnet publish`, so shipped builds were pure IL and JIT-compiled
 * every startup path (WinUI projections, BNDZCore, BNDZShell). This runs crossgen2 over every
 * IL-only assembly in the folder (same result as PublishReadyToRun, without changing the
 * proven build output layout).
 *
 * Usage: node scripts/r2r-compile-publish.mjs <publishDir> [--jobs N]
 * Needs the microsoft.netcore.app.crossgen2.win-x64 NuGet package (restored by Release builds
 * because the shell csproj sets PublishReadyToRun) and the .NET 10 shared runtimes.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
const jobsArg = args.indexOf('--jobs');
const jobs = jobsArg >= 0 ? Number(args[jobsArg + 1]) : Math.max(2, Math.min(8, os.cpus().length));
if (!dir || !fs.existsSync(dir)) {
  console.error('usage: node scripts/r2r-compile-publish.mjs <publishDir> [--jobs N]');
  process.exit(2);
}

const parseVer = (v) => v.split(/[.-]/).map(n => Number.parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = parseVer(a), y = parseVer(b); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const highest = (versions) => versions.sort(cmpVer).pop();

// Target framework major from the app's runtimeconfig (e.g. net10.0 -> 10).
const rc = fs.readdirSync(dir).find(f => f.endsWith('.runtimeconfig.json'));
const tfm = rc ? JSON.parse(fs.readFileSync(path.join(dir, rc), 'utf8'))?.runtimeOptions?.tfm : 'net10.0';
const major = String(tfm || 'net10.0').replace(/^net/, '').split('.')[0];

const dotnetRoot = process.env.DOTNET_ROOT || 'C:/Program Files/dotnet';
const sharedDir = (name) => {
  const base = path.join(dotnetRoot, 'shared', name);
  if (!fs.existsSync(base)) return null;
  const v = highest(fs.readdirSync(base).filter(x => x.startsWith(`${major}.`)));
  return v ? path.join(base, v) : null;
};
const netcore = sharedDir('Microsoft.NETCore.App');
const desktop = sharedDir('Microsoft.WindowsDesktop.App');
if (!netcore) { console.error(`r2r: .NET ${major} shared runtime not found under ${dotnetRoot}`); process.exit(3); }

const nugetRoots = [process.env.NUGET_PACKAGES, path.join(os.homedir(), '.nuget', 'packages')].filter(Boolean);
let crossgen = null;
for (const root of nugetRoots) {
  const pkg = path.join(root, 'microsoft.netcore.app.crossgen2.win-x64');
  if (!fs.existsSync(pkg)) continue;
  const versions = fs.readdirSync(pkg).filter(v => v.startsWith(`${major}.`)
    && fs.existsSync(path.join(pkg, v, 'tools', 'crossgen2.exe')));
  const v = highest(versions);
  if (v) { crossgen = path.join(pkg, v, 'tools', 'crossgen2.exe'); break; }
}
if (!crossgen) {
  console.error(`r2r: crossgen2 ${major}.x not found in ${nugetRoots.join(', ')} (run a Release restore of BNDZShell.App first)`);
  process.exit(4);
}

/** IL-only managed assembly without a ReadyToRun header. */
function needsR2R(file) {
  let b;
  try { b = fs.readFileSync(file); } catch { return false; }
  if (b.length < 0x200 || b.readUInt16LE(0) !== 0x5a4d) return false;
  try {
    const pe = b.readUInt32LE(0x3c);
    const magic = b.readUInt16LE(pe + 24);
    const dd = pe + 24 + (magic === 0x20b ? 112 : 96);
    const nsec = b.readUInt16LE(pe + 6);
    const sec = pe + 24 + b.readUInt16LE(pe + 20);
    const toOff = (rva) => {
      for (let i = 0; i < nsec; i++) {
        const s = sec + i * 40;
        const va = b.readUInt32LE(s + 12);
        const size = Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16));
        if (rva >= va && rva < va + size) return rva - va + b.readUInt32LE(s + 20);
      }
      return -1;
    };
    const cliRva = b.readUInt32LE(dd + 14 * 8);
    if (!cliRva) return false;
    const cli = toOff(cliRva);
    if (cli < 0) return false;
    const ilOnly = (b.readUInt32LE(cli + 16) & 1) === 1;
    const nativeHeaderSize = b.readUInt32LE(cli + 0x40 + 4);
    return ilOnly && nativeHeaderSize === 0;
  } catch { return false; }
}

const inputs = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.dll') && needsR2R(path.join(dir, f)));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bndz-r2r-'));
const refs = ['-r', `${dir}/*.dll`, '-r', `${netcore}/*.dll`];
if (desktop) refs.push('-r', `${desktop}/*.dll`);
console.log(`r2r: ${inputs.length} IL assemblies, crossgen2 ${path.basename(path.dirname(path.dirname(crossgen)))}, jobs ${jobs}`);

const t0 = Date.now();
let next = 0;
const failed = [];
const compiled = [];
async function worker() {
  while (next < inputs.length) {
    const f = inputs[next++];
    const code = await new Promise((resolve) => {
      const p = spawn(crossgen, [path.join(dir, f), '-o', path.join(outDir, f), '--targetos', 'windows', '--targetarch', 'x64', '-O', ...refs], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('close', (c) => { if (c !== 0) failed.push(`${f}: ${err.split('\n')[0].slice(0, 160)}`); resolve(c); });
    });
    if (code === 0) compiled.push(f);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
// Swap in only after every compile finished, so a crash never leaves a half-converted folder.
for (const f of compiled) fs.copyFileSync(path.join(outDir, f), path.join(dir, f));
fs.rmSync(outDir, { recursive: true, force: true });
console.log(`r2r: compiled ${compiled.length}, kept IL ${failed.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const f of failed.slice(0, 20)) console.log(`  kept IL: ${f}`);
