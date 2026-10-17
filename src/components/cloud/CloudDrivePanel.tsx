import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { Icons8Icon } from '../Icons8Icon';
import { BndzCloudGlyph } from '../BndzCloudGlyph';
import { pushToast } from '../ToastHost';
import PluginPanelShell from '../plugins/PluginPanelShell';
import {
  PluginToolbarButton,
  PluginCard,
  PluginEmptyState,
  PluginSectionTitle,
  PLUGIN_INPUT_CLASS,
  PLUGIN_SELECT_CLASS,
} from '../plugins/PluginPanelPrimitives';
import {
  CLOUD_DRIVE_BASE_DOMAIN,
  FLY_REGIONS,
  layoutPreviewDrives,
  normalizeLocalPath,
  defaultPlacement,
  driveHint,
  exportFolderError,
  formatSnapshotSize,
  landingUrl,
  localBackend,
  localAccelerated,
  localModeLabel,
  nextAction,
  placementLabel,
  preflightLocalPath,
  slugify,
  stateLabel,
  validateSlug,
  type CloudDrivePlacement,
  type CloudDriveProbe,
  type CloudDriveRecord,
} from '../../lib/cloudDrive';

type Props = {
  variant?: 'plugin' | 'settings';
};

const HOST_NOTE = 'Cloud Drive runs inside the BNDZ Windows host. This panel is the remote control.';

const REGION_LABELS: Record<string, string> = {
  iad: 'US East (Virginia)',
  ewr: 'US East (New Jersey)',
  sjc: 'US West (California)',
  lhr: 'London',
  fra: 'Frankfurt',
  syd: 'Sydney',
};

function sameFolder(a?: string | null, b?: string | null): boolean {
  const norm = (value?: string | null) => (value || '').trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const left = norm(a);
  return left.length > 0 && left === norm(b);
}

export default function CloudDrivePanel({ variant = 'plugin' }: Props) {
  const body = <CloudDriveBody />;
  if (variant === 'settings') return body;
  return (
    <PluginPanelShell
      title="Cloud Drive"
      icon="cloud_drive"
      iconColor="#7dd3fc"
      variant="embedded"
      subtitle="BNDZ remote-controls a private microVM. Files stay on that disk."
    >
      {body}
    </PluginPanelShell>
  );
}

function CloudDriveBody() {
  const [drives, setDrives] = useState<CloudDriveRecord[]>([]);
  const [probe, setProbe] = useState<CloudDriveProbe>({});
  const [probeReady, setProbeReady] = useState(false);
  const [placement, setPlacement] = useState<CloudDrivePlacement>('local');
  const placementSet = useRef(false);
  const [name, setName] = useState('Private drive');
  const [slug, setSlug] = useState('private-drive');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState('');
  const [sizeGb, setSizeGb] = useState(20);
  const [region, setRegion] = useState<string>('iad');
  const [diskPath, setDiskPath] = useState('');
  const diskSeeded = useRef(false);
  const autoStart = useRef<Set<string>>(new Set());
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  const [openPath, setOpenPath] = useState('');
  const [copiedSlots, setCopiedSlots] = useState<Record<string, string>>({});
  const [hostNote, setHostNote] = useState<string | null>(IPC.isNative ? null : HOST_NOTE);
  const previewLayout = !IPC.isNative && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('cloudDrivePreview');

  const refresh = useCallback(async () => {
    const listed = await IPC.cloudDriveList();
    if (listed.error && !IPC.isNative) setHostNote(HOST_NOTE);
    setDrives(listed.drives);
    if (listed.probe) setProbe(listed.probe);
    else {
      const probed = await IPC.cloudDriveProbe();
      if (probed.probe) setProbe(probed.probe);
    }
    setProbeReady(true);
  }, []);

  useEffect(() => {
    if (previewLayout) {
      setDrives(layoutPreviewDrives());
      setHostNote(HOST_NOTE);
      return;
    }
    void refresh();
  }, [previewLayout, refresh]);

  // Creating and starting finish in the background on the backend (a first
  // start downloads the engine and takes minutes). Poll the list so the card
  // shows live progress instead of one long blocked call.
  const anyTransient = drives.some(d => d.state === 'creating' || d.state === 'starting');
  useEffect(() => {
    if (!anyTransient || previewLayout) return;
    const t = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(t);
  }, [anyTransient, previewLayout, refresh]);

  useEffect(() => {
    if (placementSet.current || previewLayout || !probeReady) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem('bndz.cloudDrive.lastPlacement'); } catch { stored = null; }
    setPlacement(defaultPlacement(probe, probe.lastPlacement || stored));
    placementSet.current = true;
  }, [previewLayout, probe, probeReady]);

  useEffect(() => {
    if (diskSeeded.current || previewLayout || !probeReady) return;
    diskSeeded.current = true;
    if (!diskPath.trim() && probe.suggestedDiskPath) setDiskPath(probe.suggestedDiskPath);
  }, [previewLayout, probeReady, probe.suggestedDiskPath, diskPath]);

  const choosePlacement = (next: CloudDrivePlacement) => {
    placementSet.current = true;
    setPlacement(next);
    try { localStorage.setItem('bndz.cloudDrive.lastPlacement', next); } catch { /* private mode */ }
    if (IPC.isNative) void IPC.cloudDriveSetPlacement(next);
  };

  const enableLocal = async () => {
    const how = probe.enableLocalHowTo
      || 'Optional. Faster mode turns on Windows Hypervisor Platform and Virtual Machine Platform. Windows asks for administrator approval and needs a restart. Your drives work either way.';
    if (!IPC.isNative) {
      pushToast({ kind: 'info', title: 'Faster mode', message: how });
      return;
    }
    setBusy(true);
    try {
      const r = await IPC.cloudDriveEnableLocal();
      pushToast({ kind: 'info', title: r.started ? 'Windows is asking for approval' : 'Faster mode', message: (r.started ? 'Restart Windows when it finishes. ' : '') + (r.message || how) });
    } catch {
      pushToast({ kind: 'info', title: 'Faster mode', message: how });
    } finally {
      setBusy(false);
    }
  };


  const saveToken = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      pushToast({ kind: 'warning', title: 'Fly token', message: 'Paste a bring-your-own Fly org token.' });
      return;
    }
    setBusy(true);
    try {
      const r = await IPC.cloudDriveSetToken(trimmed);
      if (!r.ok) throw new Error(r.error || 'Token was not stored.');
      setToken('');
      if (r.probe) setProbe(r.probe);
      pushToast({
        kind: 'success',
        title: 'Token stored',
        message: r.orgSlug ? `Fly accepted the token for org ${r.orgSlug}.` : 'Fly accepted the token. It stays in the Windows secure store.',
      });
      await refresh();
    } catch (e) {
      pushToast({ kind: 'error', title: 'Token not stored', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const clearToken = async () => {
    setBusy(true);
    try {
      const r = await IPC.cloudDriveClearToken();
      if (!r.ok) throw new Error(r.error || 'Could not clear the token.');
      if (r.probe) setProbe(r.probe);
      pushToast({ kind: 'success', title: 'Token cleared', message: 'The Fly token was removed from this Windows user store.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Clear failed', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const pickPath = async () => {
    const dest = await IPC.openFolderDialog('Choose the drive folder for the sealed disk');
    if (dest) setDiskPath(dest);
  };

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name) || 'drive');
  }, [name, slugTouched]);

  useEffect(() => {
    const local = validateSlug(slug);
    if (local) {
      setSlugStatus(local);
      return;
    }
    if (previewLayout || !IPC.isNative) {
      setSlugStatus('Available');
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      void IPC.cloudDriveCheckSlug(slug).then(r => {
        if (cancel) return;
        setSlugStatus(r.ok ? 'Available' : (r.error || 'That path is already taken.'));
      }).catch(() => {
        if (!cancel) setSlugStatus('');
      });
    }, 280);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [slug, previewLayout]);

  const createDrive = async () => {
    const slugError = validateSlug(slug);
    if (slugError) {
      pushToast({ kind: 'warning', title: 'Address', message: slugError });
      return;
    }
    if (placement === 'cloud' && slugStatus && slugStatus !== 'Available') {
      pushToast({ kind: 'warning', title: 'Address', message: slugStatus });
      return;
    }
    if (placement === 'local') {
      const localError = preflightLocalPath(diskPath);
      if (localError) {
        pushToast({ kind: 'warning', title: 'Pick another drive', message: localError });
        return;
      }
    }
    setBusy(true);
    try {
      const r = await IPC.cloudDriveCreate({
        name: name.trim() || 'Private drive',
        slug: slug.trim().toLowerCase(),
        placement,
        sizeGb,
        region,
        diskPath: placement === 'local' ? normalizeLocalPath(diskPath) : '',
        flyToken: placement === 'cloud' && token.trim() ? token.trim() : undefined,
      });
      if (token.trim()) setToken('');
      if (!r.ok) throw new Error(r.error || r.drive?.message || 'Create failed');
      if (r.drives) setDrives(r.drives);
      else await refresh();
      if (r.drive?.id) autoStart.current.add(r.drive.id);
      const msg = r.drive?.state === 'creating'
        ? 'Creating your drive and starting it. Its card below shows live progress.'
        : (r.drive?.message || (placement === 'cloud'
          ? 'Drive record is in BNDZ. Files stay on the Fly machine, not on this PC.'
          : 'Sealed disk slot is on the drive you picked.'));
      pushToast({ kind: r.drive?.state === 'error' ? 'warning' : 'success', title: 'Cloud Drive', message: msg });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Create failed', message: e instanceof Error ? e.message : String(e) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const run = async (id: string, op: 'start' | 'stop' | 'refresh') => {
    setBusy(true);
    try {
      const r = op === 'start'
        ? await IPC.cloudDriveStart(id)
        : op === 'stop'
          ? await IPC.cloudDriveStop(id)
          : await IPC.cloudDriveRefresh(id);
      if (r.drives) setDrives(r.drives);
      if (!r.ok) throw new Error(r.error || r.drive?.message || 'Request failed');
      const title = op === 'start' ? 'Start' : op === 'stop' ? 'Stop' : 'Status';
      // Start returns as soon as the backend takes the job; the drive card
      // (polled above) shows it becoming Running. Only flag a real failure.
      pushToast({
        kind: 'success',
        title,
        message: r.drive?.message || 'Updated.',
      });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Cloud Drive', message: e instanceof Error ? e.message : String(e) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // One-tap create: when a just-created drive finishes creating and sits
  // stopped, start it automatically so Create means "ready to use".
  useEffect(() => {
    if (previewLayout) return;
    for (const d of drives) {
      if (!autoStart.current.has(d.id)) continue;
      if (d.state === 'stopped') {
        autoStart.current.delete(d.id);
        void run(d.id, 'start');
      } else if (d.state === 'running' || d.state === 'error') {
        autoStart.current.delete(d.id);
      }
    }
  }, [drives, previewLayout]);

  const remove = async (drive: CloudDriveRecord) => {
    if (confirmName.trim() !== drive.name) {
      pushToast({ kind: 'warning', title: 'Confirm delete', message: 'Type the drive name exactly.' });
      return;
    }
    setBusy(true);
    try {
      const r = await IPC.cloudDriveDelete(drive.id, confirmName.trim());
      if (!r.ok) throw new Error(r.error || 'Delete failed');
      setConfirmId(null);
      setConfirmName('');
      if (r.drives) setDrives(r.drives);
      pushToast({ kind: 'success', title: 'Drive deleted', message: 'The machine record was removed from BNDZ.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Delete failed', message: e instanceof Error ? e.message : String(e) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const copyFtpPassword = async (driveId: string) => {
    setBusy(true);
    try {
      const revealed = await IPC.cloudDriveRevealFtpPassword(driveId);
      if (!revealed.ok || !revealed.password) throw new Error(revealed.error || 'No FTPS password is stored.');
      await navigator.clipboard.writeText(revealed.password);
      pushToast({ kind: 'success', title: 'FTPS password', message: 'Copied. It is not shown in the panel.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'FTPS password', message: e instanceof Error ? e.message : 'Could not copy.' });
    } finally {
      setBusy(false);
    }
  };

  const applyDrives = (r: { drives?: CloudDriveRecord[] }) => {
    if (r.drives) setDrives(r.drives);
  };

  const openExisting = async (folder: string) => {
    if (previewLayout || !IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Cloud Drive', message: HOST_NOTE });
      return;
    }
    const localError = preflightLocalPath(folder);
    if (localError) {
      pushToast({ kind: 'warning', title: 'Open existing', message: localError });
      return;
    }
    setBusy(true);
    try {
      const r = await IPC.cloudDriveOpenExisting(normalizeLocalPath(folder));
      applyDrives(r);
      if (!r.ok) throw new Error(r.error || 'Could not open that folder.');
      pushToast({ kind: 'success', title: 'Opened sealed folder', message: r.drive?.hostKeyNote || r.drive?.message || 'The drive now points at that folder.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Open existing', message: e instanceof Error ? e.message : 'Could not open that folder.' });
    } finally {
      setBusy(false);
    }
  };

  const engineHere = Boolean(probe.suggestedRuntimeReady && sameFolder(diskPath, probe.suggestedDiskPath));

  const copyText = async (value: string, title: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      pushToast({ kind: 'success', title, message: 'Copied.' });
    } catch {
      pushToast({ kind: 'warning', title, message: value });
    }
  };

  const runningCount = drives.filter(d => d.state === 'running').length;
  const totalGb = drives.reduce((sum, d) => sum + (d.sizeGb || 0), 0);

  return (
    <div className="bndz-cloud-stage flex flex-col gap-4 px-4 pb-4">
      <div className="bndz-cloud-header">
        <div className="bndz-cloud-medallion is-hero">
          <BndzCloudGlyph size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="bndz-cloud-title">BNDZ Cloud</h2>
          <p className="text-[12px] leading-relaxed text-slate-300/90 m-0">
            Make a private drive in three steps: name it, pick where it lives, create it. BNDZ does the rest and starts it for you.
          </p>
        </div>
        {drives.length > 0 && (
          <div className="bndz-cloud-summary" aria-label="Drive summary">
            <span className="bndz-cloud-badge">{drives.length} {drives.length === 1 ? 'drive' : 'drives'}</span>
            <span className="bndz-cloud-badge is-quiet">{runningCount} running</span>
            {totalGb > 0 && <span className="bndz-cloud-badge is-quiet">{totalGb} GB</span>}
          </div>
        )}
      </div>

      {hostNote && (
        <div className="bndz-cloud-note">{hostNote}</div>
      )}

      <p className="bndz-cloud-next">{nextAction(probe, placement, diskPath)}</p>

      <details className="bndz-cloud-guidance">
        <summary>Advanced — readiness, web address, help</summary>
      <div className="bndz-cloud-meters" aria-label="Cloud Drive readiness">
        {placement === 'cloud' ? (
          <Meter label="Fly token" value={probe.tokenConfigured ? 'Stored' : 'Needed'} hint={probe.tokenMessage} />
        ) : (
          <Meter label="Disk folder" value={preflightLocalPath(diskPath) ? 'Needed' : 'Ready'} hint={diskPath || 'Pick a folder off C:.'} />
        )}
        <Meter label="This PC" value={localAccelerated(probe) ? 'Accelerated' : 'Compatibility'} hint={probe.localBackendMessage || localModeLabel(probe)} />
        <Meter
          label={placement === 'local' ? 'Engine' : 'System'}
          value={placement === 'local'
            ? (engineHere ? 'Downloaded' : 'On first start')
            : (localBackend(probe) === 'hyper-v' ? (probe.rootfsPresent ? 'Pinned' : 'Missing') : 'Ready')}
          hint={placement === 'local'
            ? (engineHere
              ? 'The engine is already in this folder. Start does not download it again.'
              : 'First start downloads about 390 MB into the folder you pick, not onto C:.')
            : (localBackend(probe) === 'hyper-v' ? probe.rootfsMessage : 'Downloads once on first start (about 390 MB) to the drive you pick, not to C:.')}
        />
        {placement === 'cloud' && (
          <Meter label="Address" value={probe.cloudflareTokenConfigured ? 'Published' : 'Reserved'} hint={probe.cloudflareMessage} />
        )}
      </div>
      {probe.guidance && (
        <details className="bndz-cloud-guidance">
          <summary>If Start fails</summary>
          <p>{probe.guidance}</p>
        </details>
      )}

      <details className="bndz-cloud-guidance">
        <summary>Web address for drives (optional — only for reaching them away from home)</summary>
        <AddressAdmin probe={probe} busy={busy} onProbe={setProbe} onBusy={setBusy} />
      </details>
      </details>

      <p className="bndz-cloud-section-label">1 · Name</p>
      <PluginCard className="bndz-cloud-form">
        <label className="grid gap-1">
          <span className="bndz-plugin-field-label">Name</span>
          <input className={PLUGIN_INPUT_CLASS} value={name} maxLength={64} placeholder="e.g. Family photos" onChange={e => setName(e.target.value)} />
        </label>
      </PluginCard>

      <p className="bndz-cloud-section-label">2 · Where it lives</p>
      <div className="bndz-cloud-bays" role="radiogroup" aria-label="Cloud Drive placement">
        <Bay
          selected={placement === 'local'}
          title="This PC"
          seal="Disk"
          body="Runs on this PC, in a folder you pick. No account needed."
          onSelect={() => choosePlacement('local')}
        />
        <Bay
          selected={placement === 'cloud'}
          title="Cloud"
          seal="Fly"
          body="Runs on Fly, a hosting company. Needs a Fly account — you paste a token in the next step."
          onSelect={() => choosePlacement('cloud')}
        />
      </div>
      {placement === 'local' && !localAccelerated(probe) && (
        <div className="bndz-cloud-note">
          <p className="m-0">{localModeLabel(probe)}. This PC works as it is. Faster mode is optional and needs a Windows restart.</p>
          <div className="mt-2">
            <PluginToolbarButton disabled={busy} onClick={() => void enableLocal()}>Turn on faster mode</PluginToolbarButton>
          </div>
        </div>
      )}

      <p className="bndz-cloud-section-label">3 · Details</p>
      <PluginCard className="bndz-cloud-form">
        <div className="grid gap-3">
          {placement === 'cloud' && (
          <label className="grid gap-1">
            <span className="bndz-plugin-field-label">Web address</span>
            <div className="bndz-cloud-pathbox">
              <span className="bndz-cloud-pathbox-prefix">{(probe.publicBaseDomain || CLOUD_DRIVE_BASE_DOMAIN) + '/'}</span>
              <input
                value={slug}
                maxLength={61}
                spellCheck={false}
                autoCapitalize="off"
                aria-label="Path name"
                onChange={e => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
              />
            </div>
            {slugStatus && <p className={slugStatus === 'Available' ? 'bndz-cloud-message' : 'bndz-cloud-next'}>{slugStatus}</p>}
          </label>
          )}
          <label className="grid gap-1">
            <span className="bndz-plugin-field-label">How much space (GB)</span>
            <input
              className={PLUGIN_INPUT_CLASS}
              type="number"
              min={1}
              max={500}
              value={sizeGb}
              onChange={e => setSizeGb(Number(e.target.value) || 20)}
            />
          </label>
          {placement === 'cloud' ? (
            <>
              <label className="grid gap-1">
                <span className="bndz-plugin-field-label">Server location</span>
                <select className={PLUGIN_SELECT_CLASS} value={region} onChange={e => setRegion(e.target.value)}>
                  {FLY_REGIONS.map(r => <option key={r} value={r}>{REGION_LABELS[r] || r}</option>)}
                </select>
              </label>
              <p className="bndz-cloud-message">
                Cloud drives run on Fly, a separate company, so a Fly account is required — BNDZ can't make one for you.
                Paste your Fly token here and BNDZ keeps it in Windows secure storage on this PC. It is never shown again.
              </p>
              <label className="grid gap-1">
                <span className="bndz-plugin-field-label">Fly token</span>
                <input
                  className={PLUGIN_INPUT_CLASS}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  name="bndz-fly-token"
                  placeholder={probe.tokenConfigured ? 'Token stored — paste only to replace it' : 'Paste your Fly token'}
                  value={token}
                  onChange={e => setToken(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <PluginToolbarButton disabled={busy || !token.trim()} onClick={() => void saveToken()}>Save token</PluginToolbarButton>
                <PluginToolbarButton disabled={busy || !probe.tokenConfigured} onClick={() => void clearToken()}>Clear token</PluginToolbarButton>
              </div>
            </>
          ) : (
            <label className="grid gap-1">
              <span className="bndz-plugin-field-label">Where on this PC</span>
              <div className="flex gap-2">
                <input
                  className={PLUGIN_INPUT_CLASS + ' flex-1'}
                  value={diskPath}
                  placeholder="D:\BNDZ Drives"
                  onChange={e => setDiskPath(e.target.value)}
                />
                <PluginToolbarButton icon="folder_open_ui" onClick={() => void pickPath()}>Browse…</PluginToolbarButton>
              </div>
              <p className="bndz-cloud-message">
                {engineHere
                  ? 'This folder already has the engine from the last run.'
                  : "The drive's files are created inside this folder. Keep it off C: so Windows doesn't run out of room."}
              </p>
            </label>
          )}
          <div>
            <PluginToolbarButton disabled={busy || Boolean(validateSlug(slug)) || (placement === 'cloud' && slugStatus !== '' && slugStatus !== 'Available')} onClick={() => void createDrive()}>Create drive</PluginToolbarButton>
            <p className="bndz-cloud-message">Creates the drive and starts it. The first start takes a few minutes — progress shows on the drive's card below.</p>
          </div>
        </div>
      </PluginCard>

      <details className="bndz-cloud-guidance">
        <summary>Open a drive folder you already have</summary>
        <p className="bndz-cloud-message">
          Point BNDZ at a drive folder you already copied to this PC.
        </p>
        <div className="flex gap-2">
          <input
            className={PLUGIN_INPUT_CLASS + ' flex-1'}
            value={openPath}
            placeholder="E:\BNDZ Drives\BNDZ\CloudDrives\…"
            onChange={e => setOpenPath(e.target.value)}
          />
          <PluginToolbarButton
            icon="folder_open_ui"
            disabled={busy}
            onClick={async () => {
              const dest = await IPC.openFolderDialog('Choose a sealed Cloud Drive folder');
              if (dest) setOpenPath(dest);
            }}
          >
            Browse…
          </PluginToolbarButton>
        </div>
        <div>
          <PluginToolbarButton disabled={busy || !openPath.trim()} onClick={() => void openExisting(openPath)}>Open folder</PluginToolbarButton>
        </div>
      </details>

      <PluginSectionTitle icon="hard_drive_ui" action={
        <PluginToolbarButton disabled={busy} onClick={() => void refresh()}>Refresh</PluginToolbarButton>
      }>
        Drives
      </PluginSectionTitle>

      {drives.length === 0 ? (
        <PluginEmptyState
          icon="bndz_cloud"
          title="No Cloud Drives yet"
          description={nextAction(probe, placement, diskPath)}
        />
      ) : drives.map(drive => (
        <article key={drive.id} className={`bndz-cloud-cartridge is-${drive.placement === 'local' ? 'local' : 'cloud'}`}>
          <div className="bndz-cloud-cartridge-spine" aria-hidden />
          <div className={`bndz-cloud-medallion is-${drive.state || 'stopped'}`}>
            <BndzCloudGlyph size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`bndz-cloud-lamp is-${drive.state || 'stopped'}`} aria-hidden />
              <h3 className="m-0 text-sm font-semibold text-white">{drive.name}</h3>
              <span className="bndz-cloud-badge">{placementLabel(drive.placement)}</span>
              <span className="bndz-cloud-badge is-quiet">{stateLabel(drive.state)}</span>
              {drive.id.startsWith('preview-') && <span className="bndz-cloud-badge is-quiet">Layout preview</span>}
            </div>
            <p className="bndz-cloud-meta">
              {drive.sizeGb ? `${drive.sizeGb} GB` : ''}
              {drive.region ? ` · ${drive.region}` : ''}
              {drive.hypervisor ? ` · ${drive.hypervisor}` : ''}
              {drive.fingerprint ? ` · ${drive.fingerprint}` : ''}
            </p>
            {drive.diskPath && <p className="bndz-cloud-path" title={drive.diskPath}>{drive.diskPath}</p>}
            {(drive.state === 'creating' || drive.state === 'starting') && (
              <div className="bndz-cloud-progress" role="status">
                <span>{drive.message || `${stateLabel(drive.state)}…`}</span>
                <div className="bndz-cloud-progress-bar" aria-hidden />
              </div>
            )}
            <p className="bndz-cloud-next">{driveHint(drive)}</p>
            {drive.state !== 'error' && drive.sshNote && <p className="bndz-cloud-message is-note">{drive.sshNote}</p>}
            <AddressPlate
              drive={drive}
              busy={busy}
              preview={previewLayout}
              onChanged={async () => { if (!previewLayout) await refresh(); }}
              onCopy={copyText}
            />
            <ProtocolList
              drive={drive}
              busy={busy}
              onCopy={copyText}
              onCopyFtpPassword={() => void copyFtpPassword(drive.id)}
            />
            {drive.placement === 'local' ? (
              <>
                <AwayAccess
                  drive={drive}
                  busy={busy}
                  onChanged={async () => { if (!previewLayout) await refresh(); }}
                />
                <LocalMove
                  drive={drive}
                  busy={busy}
                  preview={previewLayout}
                  copiedTo={copiedSlots[drive.id]}
                  onCopied={path => setCopiedSlots(prev => ({ ...prev, [drive.id]: path }))}
                  onDrives={applyDrives}
                  onOpen={openExisting}
                />
              </>
            ) : (
              <CloudSnapshots
                drive={drive}
                busy={busy}
                preview={previewLayout}
                onDrives={async drives => {
                  if (drives) setDrives(drives);
                  else if (!previewLayout) await refresh();
                }}
              />
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <PluginToolbarButton disabled={busy || drive.state === 'deleting' || drive.state === 'creating' || drive.state === 'starting' || drive.state === 'running'} onClick={() => void run(drive.id, 'start')}>Start</PluginToolbarButton>
              <PluginToolbarButton disabled={busy || drive.state === 'deleting' || drive.state === 'creating' || drive.state === 'starting'} onClick={() => void run(drive.id, 'stop')}>Stop</PluginToolbarButton>
              <PluginToolbarButton disabled={busy || !drive.sshCommand} onClick={() => void copyText(drive.sshCommand || '', 'SSH command')}>Copy SSH</PluginToolbarButton>
              <PluginToolbarButton disabled={busy || !drive.publicKey} onClick={() => void copyText(drive.publicKey || '', 'Public key')}>Copy public key</PluginToolbarButton>
              <PluginToolbarButton disabled={busy || drive.state === 'creating' || drive.state === 'starting'} onClick={() => { setConfirmId(drive.id); setConfirmName(''); }}>Delete</PluginToolbarButton>
            </div>
            {confirmId === drive.id && (
              <div className="bndz-cloud-confirm">
                <p>Type <strong>{drive.name}</strong> to destroy this drive.</p>
                <div className="flex gap-2">
                  <input className={PLUGIN_INPUT_CLASS} value={confirmName} onChange={e => setConfirmName(e.target.value)} />
                  <PluginToolbarButton disabled={busy} onClick={() => void remove(drive)}>Delete drive</PluginToolbarButton>
                </div>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function CloudSnapshots({
  drive,
  busy,
  preview,
  onDrives,
}: {
  drive: CloudDriveRecord;
  busy: boolean;
  preview: boolean;
  onDrives: (drives?: CloudDriveRecord[]) => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const locked = busy || pending;
  const snapshots = drive.snapshots ?? [];

  const run = async (op: 'create' | 'list' | 'drop' | 'restore', snapshotId = '') => {
    if (preview || !IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Snapshots', message: HOST_NOTE });
      return;
    }
    setPending(true);
    try {
      const r = op === 'create'
        ? await IPC.cloudDriveSnapshotCreate(drive.id)
        : op === 'list'
          ? await IPC.cloudDriveSnapshotList(drive.id)
          : op === 'drop'
            ? await IPC.cloudDriveDropPreviousVolume(drive.id)
            : await IPC.cloudDriveSnapshotRestore(drive.id, snapshotId);
      await onDrives(r.drives);
      if (!r.ok) throw new Error(r.error || r.drive?.message || 'Fly did not finish that.');
      const title = op === 'create' ? 'Snapshot saved' : op === 'restore' ? 'Snapshot restored' : op === 'drop' ? 'Previous volume dropped' : 'Snapshots';
      pushToast({ kind: 'success', title, message: r.drive?.message || 'Updated.' });
      if (op === 'restore') setRestoreId(null);
    } catch (e) {
      pushToast({ kind: 'error', title: 'Snapshots', message: e instanceof Error ? e.message : 'Could not update snapshots.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="bndz-cloud-move" aria-label={`${drive.name} snapshots`}>
      <h4 className="bndz-cloud-section-label">Snapshots</h4>
      <p className="bndz-cloud-message">
        A snapshot is a crash-consistent copy of the Fly volume. Stop the drive first if you need a quiet disk.
        Restore builds a new volume and replaces the machine, so the SSH server host key changes. Your client key does not.
        The previous volume stays in Fly and still bills until you drop it.
      </p>
      {drive.hostKeyNote && <p className="bndz-cloud-next">{drive.hostKeyNote}</p>}
      {drive.previousFlyVolumeId && (
        <p className="bndz-cloud-message">Previous volume {drive.previousFlyVolumeId} is still billing.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <PluginToolbarButton disabled={locked} onClick={() => void run('create')}>Snapshot now</PluginToolbarButton>
        <PluginToolbarButton disabled={locked} onClick={() => void run('list')}>Refresh snapshots</PluginToolbarButton>
        {drive.previousFlyVolumeId && (
          <PluginToolbarButton disabled={locked} onClick={() => void run('drop')}>Drop previous volume</PluginToolbarButton>
        )}
      </div>
      {snapshots.length === 0 ? (
        <p className="bndz-cloud-message is-note">No snapshots stored on this drive yet.</p>
      ) : snapshots.map(snap => (
        <div key={snap.id} className="bndz-cloud-snap">
          <div>
            <span className="bndz-cloud-protocol-copy">{snap.id}</span>
            <p className="bndz-cloud-protocol-note">
              {[snap.status, snap.createdAt ? snap.createdAt.replace('T', ' ').replace('Z', ' UTC') : '', formatSnapshotSize(snap.sizeBytes)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <PluginToolbarButton disabled={locked} onClick={() => setRestoreId(snap.id)}>Restore</PluginToolbarButton>
          {restoreId === snap.id && (
            <div className="bndz-cloud-confirm">
              <p>Replace the machine from {snap.id}. Confirm the new SSH host key on the next connection.</p>
              <PluginToolbarButton disabled={locked} onClick={() => void run('restore', snap.id)}>Replace machine</PluginToolbarButton>
            </div>
          )}
        </div>
      ))}
      <p className="bndz-cloud-message is-note">
        To take the files off Fly, open the panel and use Download archive. That tar is the portable copy. A snapshot stays in your Fly account.
      </p>
    </section>
  );
}

function LocalMove({
  drive,
  busy,
  preview,
  copiedTo,
  onCopied,
  onDrives,
  onOpen,
}: {
  drive: CloudDriveRecord;
  busy: boolean;
  preview: boolean;
  copiedTo?: string;
  onCopied: (path: string) => void;
  onDrives: (r: { drives?: CloudDriveRecord[] }) => void;
  onOpen: (folder: string) => Promise<void>;
}) {
  const [dest, setDest] = useState('');
  const [pending, setPending] = useState(false);
  const locked = busy || pending;
  const running = drive.state === 'running' || drive.state === 'creating' || drive.state === 'deleting';

  const copySlot = async () => {
    if (preview || !IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Move', message: HOST_NOTE });
      return;
    }
    const plan = exportFolderError(drive.diskPath || '', dest, drive.id);
    if (plan) {
      pushToast({ kind: 'warning', title: 'Move', message: plan });
      return;
    }
    setPending(true);
    try {
      const r = await IPC.cloudDriveExport(drive.id, normalizeLocalPath(dest));
      onDrives(r);
      if (!r.ok || !r.exportedPath) throw new Error(r.error || 'Could not copy the sealed folder.');
      onCopied(r.exportedPath);
      pushToast({ kind: 'success', title: 'Sealed folder copied', message: r.drive?.message || r.exportedPath });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Move', message: e instanceof Error ? e.message : 'Could not copy the sealed folder.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="bndz-cloud-move is-local" aria-label={`${drive.name} move`}>
      <h4 className="bndz-cloud-section-label">Move</h4>
      <p className="bndz-cloud-message">
        Stop the drive, then copy the sealed folder. The copy includes the data disk. The Linux rootfs stays on this PC and is attached again on Start.
        A snapshot is crash-consistent. This copy is the portable data disk.
      </p>
      {running && <p className="bndz-cloud-next">Stop the drive before copying the sealed folder.</p>}
      {drive.hostKeyNote && <p className="bndz-cloud-next">{drive.hostKeyNote}</p>}
      <div className="flex gap-2">
        <input
          className={PLUGIN_INPUT_CLASS + ' flex-1'}
          value={dest}
          placeholder="E:\BNDZ Drives"
          onChange={e => setDest(e.target.value)}
        />
        <PluginToolbarButton
          icon="folder_open_ui"
          disabled={locked}
          onClick={async () => {
            const picked = await IPC.openFolderDialog('Choose where to copy the sealed disk');
            if (picked) setDest(picked);
          }}
        >
          Browse…
        </PluginToolbarButton>
      </div>
      <div className="flex flex-wrap gap-2">
        <PluginToolbarButton disabled={locked || running || !dest.trim()} onClick={() => void copySlot()}>Copy sealed folder</PluginToolbarButton>
        {copiedTo && (
          <PluginToolbarButton disabled={locked || running} onClick={() => void onOpen(copiedTo)}>Use this copy</PluginToolbarButton>
        )}
      </div>
      {copiedTo && <p className="bndz-cloud-path">{copiedTo}</p>}
    </section>
  );
}

function AddressAdmin({
  probe,
  busy,
  onProbe,
  onBusy,
}: {
  probe: CloudDriveProbe;
  busy: boolean;
  onProbe: (probe: CloudDriveProbe) => void;
  onBusy: (busy: boolean) => void;
}) {
  const base = probe.publicBaseDomain || CLOUD_DRIVE_BASE_DOMAIN;
  const [domain, setDomain] = useState(base);
  const [token, setToken] = useState('');
  const [originSecret, setOriginSecret] = useState('');
  useEffect(() => { setDomain(probe.publicBaseDomain || CLOUD_DRIVE_BASE_DOMAIN); }, [probe.publicBaseDomain]);

  const saveDomain = async () => {
    if (!IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Base domain', message: HOST_NOTE });
      return;
    }
    onBusy(true);
    try {
      const r = await IPC.cloudDriveSetPublicDomain(domain.trim());
      if (!r.ok) throw new Error(r.error || 'Could not save the base domain.');
      if (r.probe) onProbe(r.probe);
      pushToast({ kind: 'success', title: 'Base domain', message: `Drives use names on ${domain.trim() || CLOUD_DRIVE_BASE_DOMAIN}.` });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Base domain', message: e instanceof Error ? e.message : 'Could not save the base domain.' });
    } finally {
      onBusy(false);
    }
  };

  const saveToken = async () => {
    if (!IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Cloudflare', message: HOST_NOTE });
      return;
    }
    onBusy(true);
    try {
      const r = await IPC.cloudDriveSetCloudflareToken(token.trim());
      if (!r.ok) throw new Error(r.error || 'Could not store the token.');
      setToken('');
      if (r.probe) onProbe(r.probe);
      pushToast({ kind: 'success', title: 'Cloudflare token stored', message: 'It stays in the Windows secure store and is not shown again.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Cloudflare', message: e instanceof Error ? e.message : 'Could not store the token.' });
    } finally {
      onBusy(false);
    }
  };

  const saveOrigin = async () => {
    if (!IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Origin secret', message: HOST_NOTE });
      return;
    }
    onBusy(true);
    try {
      const r = await IPC.cloudDriveSetOriginSecret(originSecret.trim());
      if (!r.ok) throw new Error(r.error || 'Could not store the origin secret.');
      setOriginSecret('');
      if (r.probe) onProbe(r.probe);
      pushToast({ kind: 'success', title: 'Origin secret stored', message: 'It stays in the Windows secure store. Start a drive again so the guest receives it.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Origin secret', message: e instanceof Error ? e.message : 'Could not store the origin secret.' });
    } finally {
      onBusy(false);
    }
  };

  return (
    <section className="bndz-cloud-address" aria-label="Cloud Drive address">
      <h4 className="bndz-cloud-section-label">Address</h4>
      <p className="bndz-cloud-address-url">{probe.landingUrl || landingUrl(base)}</p>
      <p className="bndz-cloud-message">
        {probe.landingUrl || landingUrl(base)} is the account page. Each drive is a path under that host. {probe.cloudflareMessage || 'Deploy cloud/router once, then save a Cloudflare token and the origin secret.'}
      </p>
      <label className="grid gap-1">
        <span className="bndz-plugin-field-label">Base domain</span>
        <input className={PLUGIN_INPUT_CLASS} value={domain} spellCheck={false} onChange={e => setDomain(e.target.value)} />
      </label>
      <label className="grid gap-1">
        <span className="bndz-plugin-field-label">Cloudflare API token</span>
        <input
          className={PLUGIN_INPUT_CLASS}
          type="password"
          autoComplete="off"
          spellCheck={false}
          name="bndz-cloudflare-token"
          placeholder={probe.cloudflareTokenConfigured ? 'Token stored — paste only to replace it' : 'Paste an API token'}
          value={token}
          onChange={e => setToken(e.target.value)}
        />
      </label>
      <label className="grid gap-1">
        <span className="bndz-plugin-field-label">Origin lock secret</span>
        <input
          className={PLUGIN_INPUT_CLASS}
          type="password"
          autoComplete="off"
          spellCheck={false}
          name="bndz-origin-secret"
          placeholder={probe.originSecretConfigured ? 'Secret stored — paste only to replace it' : 'Paste cloud/router/.origin-secret'}
          value={originSecret}
          onChange={e => setOriginSecret(e.target.value)}
        />
      </label>
      {probe.originSecretMessage && <p className="bndz-cloud-message">{probe.originSecretMessage}</p>}
      <div className="flex flex-wrap gap-2">
        <PluginToolbarButton disabled={busy} onClick={() => void saveDomain()}>Save domain</PluginToolbarButton>
        <PluginToolbarButton disabled={busy || !token.trim()} onClick={() => void saveToken()}>Save Cloudflare token</PluginToolbarButton>
        <PluginToolbarButton disabled={busy || !originSecret.trim()} onClick={() => void saveOrigin()}>Save origin secret</PluginToolbarButton>
      </div>
    </section>
  );
}

function AddressPlate({
  drive,
  busy,
  preview,
  onChanged,
  onCopy,
}: {
  drive: CloudDriveRecord;
  busy: boolean;
  preview: boolean;
  onChanged: () => Promise<void> | void;
  onCopy: (value: string, title: string) => void;
}) {
  const panel = drive.endpoints?.find(endpoint => endpoint.id === 'panel');
  const send = drive.shareUrl || (panel?.copyText?.startsWith('https://') ? panel.copyText : '');
  const [pending, setPending] = useState(false);
  const [nextSlug, setNextSlug] = useState(drive.publicSlug || '');
  const [slugNote, setSlugNote] = useState('');
  useEffect(() => { setNextSlug(drive.publicSlug || ''); }, [drive.publicSlug, drive.id]);
  useEffect(() => {
    const local = validateSlug(nextSlug);
    if (local) {
      setSlugNote(local);
      return;
    }
    if (nextSlug === (drive.publicSlug || '')) {
      setSlugNote('This is the current path.');
      return;
    }
    if (preview || !IPC.isNative) {
      setSlugNote('Available');
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      void IPC.cloudDriveCheckSlug(nextSlug, drive.id).then(r => {
        if (cancel) return;
        setSlugNote(r.ok ? 'Available' : (r.error || 'That path is already taken.'));
      }).catch(() => { if (!cancel) setSlugNote(''); });
    }, 280);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [nextSlug, drive.id, drive.publicSlug, preview]);

  const rename = async () => {
    const local = validateSlug(nextSlug);
    if (local) {
      pushToast({ kind: 'warning', title: 'Address', message: local });
      return;
    }
    if (preview || !IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Address', message: HOST_NOTE });
      return;
    }
    setPending(true);
    try {
      const r = await IPC.cloudDriveRenameSlug(drive.id, nextSlug.trim().toLowerCase());
      if (!r.ok) throw new Error(r.error || 'Could not rename the path.');
      await onChanged();
      pushToast({ kind: 'success', title: 'Address', message: 'The old path redirects here for 30 days. Share links keep working.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Address', message: e instanceof Error ? e.message : 'Could not rename the path.' });
    } finally {
      setPending(false);
    }
  };

  const publish = async () => {
    if (preview || !IPC.isNative) {
      pushToast({ kind: 'warning', title: 'Address', message: HOST_NOTE });
      return;
    }
    setPending(true);
    try {
      const r = await IPC.cloudDrivePublish(drive.id);
      if (!r.ok) throw new Error(r.error || 'Could not publish the address.');
      await onChanged();
      pushToast({ kind: 'success', title: 'Address', message: r.drive?.publishMessage || 'The address is reserved.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Address', message: e instanceof Error ? e.message : 'Could not publish the address.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="bndz-cloud-address" aria-label={`${drive.name} address`}>
      <h4 className="bndz-cloud-section-label">Send this</h4>
      {send ? (
        <p className="bndz-cloud-address-url">{send}</p>
      ) : (
        <p className="bndz-cloud-next">The address is assigned when the drive is created.</p>
      )}
      <p className="bndz-cloud-message">{drive.addressGuide || `Share links stay at /s/ and a token. ${landingUrl()} is the account page.`}</p>
      {(drive.slugRedirects || []).map(redirect => (
        <p key={redirect.from} className="bndz-cloud-message is-note">{redirect.from} redirects here until {redirect.untilUtc}.</p>
      ))}
      {drive.publishMode && <p className="bndz-cloud-message is-note">{drive.publishMode === 'published' ? 'Published' : 'Reserved'}{drive.publishMessage ? ` · ${drive.publishMessage}` : ''}</p>}
      <label className="grid gap-1">
        <span className="bndz-plugin-field-label">Path name</span>
        <div className="bndz-cloud-pathbox">
          <span className="bndz-cloud-pathbox-prefix">{CLOUD_DRIVE_BASE_DOMAIN + '/'}</span>
          <input
            value={nextSlug}
            maxLength={61}
            spellCheck={false}
            aria-label="Rename path"
            onChange={e => setNextSlug(e.target.value.toLowerCase())}
          />
        </div>
        {slugNote && <p className={slugNote === 'Available' || slugNote === 'This is the current path.' ? 'bndz-cloud-message' : 'bndz-cloud-next'}>{slugNote}</p>}
      </label>
      <div className="flex flex-wrap gap-2">
        <PluginToolbarButton disabled={busy || pending || Boolean(validateSlug(nextSlug)) || nextSlug === (drive.publicSlug || '')} onClick={() => void rename()}>Rename path</PluginToolbarButton>
        <PluginToolbarButton disabled={busy || pending} onClick={() => void publish()}>Publish</PluginToolbarButton>
        <PluginToolbarButton disabled={!send} onClick={() => onCopy(send, 'Send this')}>Copy link</PluginToolbarButton>
        <PluginToolbarButton disabled={!send} onClick={() => { if (send) window.open(send, '_blank'); }}>Open panel</PluginToolbarButton>
      </div>
    </section>
  );
}

function ProtocolList({
  drive,
  busy,
  onCopy,
  onCopyFtpPassword,
}: {
  drive: CloudDriveRecord;
  busy: boolean;
  onCopy: (value: string, title: string) => void;
  onCopyFtpPassword: () => void;
}) {
  const endpoints = drive.endpoints ?? [];
  if (endpoints.length === 0) {
    return <p className="bndz-cloud-message is-note">Protocol endpoints are published by the BNDZ host.</p>;
  }
  return (
    <section className="bndz-cloud-protocols" aria-label={`${drive.name} protocols`}>
      <h4 className="bndz-cloud-section-label">Protocols</h4>
      {endpoints.map(endpoint => (
        <div key={endpoint.id} className={`bndz-cloud-protocol${endpoint.id === 'machine' ? ' is-machine' : ''}${endpoint.id === 'panel' ? ' is-send' : ''}`}>
          <span className={`bndz-cloud-lamp is-${endpoint.state || 'pending'}`} aria-hidden />
          <span className="bndz-cloud-protocol-label">{endpoint.label}</span>
          <span className="bndz-cloud-protocol-copy">{endpoint.copyText || '—'}</span>
          <PluginToolbarButton
            disabled={busy || !endpoint.canCopy || !endpoint.copyText}
            onClick={() => onCopy(endpoint.copyText || '', endpoint.label)}
          >
            Copy
          </PluginToolbarButton>
          {endpoint.note && <p className="bndz-cloud-protocol-note">{endpoint.note}</p>}
          {endpoint.id === 'ftps' && (
            <div className="bndz-cloud-protocol-note">
              <PluginToolbarButton disabled={busy} onClick={onCopyFtpPassword}>Copy FTPS password</PluginToolbarButton>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function AwayAccess({
  drive,
  busy,
  onChanged,
}: {
  drive: CloudDriveRecord;
  busy: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const locked = busy || pending;

  const apply = async (r: { ok: boolean; drives?: CloudDriveRecord[]; error?: string }, title: string) => {
    if (!r.ok) throw new Error(r.error || `${title} failed`);
    await onChanged();
    pushToast({ kind: 'success', title, message: 'Updated.' });
  };

  const saveToken = async () => {
    const trimmed = token.trim();
    if (trimmed.length < 20 || /\s/.test(trimmed)) {
      pushToast({ kind: 'warning', title: 'Tunnel token', message: 'Paste the install token from Cloudflare, with no spaces.' });
      return;
    }
    setPending(true);
    try {
      const r = await IPC.cloudDriveSetTunnelToken(drive.id, trimmed);
      if (!r.ok) throw new Error(r.error || 'Could not store the token.');
      setToken('');
      await onChanged();
      pushToast({ kind: 'success', title: 'Tunnel token stored', message: 'It stays in the Windows secure store and is not shown again.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Tunnel token', message: e instanceof Error ? e.message : 'Could not store the token.' });
    } finally {
      setPending(false);
    }
  };

  const runTunnel = async (op: 'start' | 'stop' | 'clear') => {
    setPending(true);
    try {
      const r = op === 'start'
        ? await IPC.cloudDriveTunnelStart(drive.id)
        : op === 'stop'
          ? await IPC.cloudDriveTunnelStop(drive.id)
          : await IPC.cloudDriveClearTunnelToken(drive.id);
      if (op === 'clear') setToken('');
      await apply(r, op === 'start' ? 'Away access' : op === 'stop' ? 'Tunnel stopped' : 'Token cleared');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Away access', message: e instanceof Error ? e.message : 'Could not update the tunnel.' });
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="bndz-cloud-away" aria-label={`${drive.name} away access`}>
      <div className="flex items-center gap-2">
        <span className={`bndz-cloud-lamp is-${drive.tunnelState || 'token-needed'}`} aria-hidden />
        <h4 className="bndz-cloud-section-label">Away access</h4>
        <span className="bndz-cloud-badge is-quiet">{drive.tunnelState || 'token-needed'}</span>
      </div>
      <p className="bndz-cloud-message">{drive.awayGuide}</p>
      {drive.tunnelMessage && <p className="bndz-cloud-message is-note">{drive.tunnelMessage}</p>}
      <label className="grid gap-1">
        <span className="bndz-plugin-field-label">Cloudflare Tunnel token</span>
        <input
          className={PLUGIN_INPUT_CLASS}
          type="password"
          autoComplete="off"
          spellCheck={false}
          name="bndz-tunnel-token"
          placeholder={drive.tunnelTokenConfigured ? 'Token stored — paste only to replace it' : 'Paste the tunnel install token'}
          value={token}
          onChange={e => setToken(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <PluginToolbarButton disabled={locked || !token.trim()} onClick={() => void saveToken()}>Save token</PluginToolbarButton>
        <PluginToolbarButton disabled={locked || !drive.tunnelTokenConfigured} onClick={() => void runTunnel('clear')}>Clear token</PluginToolbarButton>
        <PluginToolbarButton disabled={locked} onClick={() => void runTunnel('start')}>Start tunnel</PluginToolbarButton>
        <PluginToolbarButton disabled={locked} onClick={() => void runTunnel('stop')}>Stop tunnel</PluginToolbarButton>
      </div>
    </section>
  );
}

function Meter({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bndz-cloud-meter" title={hint}>
      <div className="bndz-cloud-meter-value">{value}</div>
      <div className="bndz-cloud-meter-label">{label}</div>
    </div>
  );
}

function Bay({
  selected,
  title,
  seal,
  body,
  onSelect,
}: {
  selected: boolean;
  title: string;
  seal: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`bndz-cloud-bay${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <span className="bndz-cloud-bay-seal">{seal}</span>
      <span className="bndz-cloud-bay-title">{title}</span>
      <span className="bndz-cloud-bay-body">{body}</span>
    </button>
  );
}
