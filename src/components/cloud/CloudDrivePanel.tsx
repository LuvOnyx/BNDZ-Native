import React, { useCallback, useEffect, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';
import { Icons8Icon } from '../Icons8Icon';
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
  FLY_REGIONS,
  layoutPreviewDrives,
  normalizeLocalPath,
  driveHint,
  exportFolderError,
  formatSnapshotSize,
  nextAction,
  normalizeTunnelHostname,
  placementLabel,
  preflightLocalPath,
  stateLabel,
  type CloudDrivePlacement,
  type CloudDriveProbe,
  type CloudDriveRecord,
} from '../../lib/cloudDrive';

type Props = {
  variant?: 'plugin' | 'settings';
};

const HOST_NOTE = 'Cloud Drive runs inside the BNDZ Windows host. This panel is the remote control.';

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
  const [placement, setPlacement] = useState<CloudDrivePlacement>('cloud');
  const [name, setName] = useState('Private drive');
  const [sizeGb, setSizeGb] = useState(20);
  const [region, setRegion] = useState<string>('iad');
  const [diskPath, setDiskPath] = useState('');
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
  }, []);

  useEffect(() => {
    if (previewLayout) {
      setDrives(layoutPreviewDrives());
      setHostNote(HOST_NOTE);
      return;
    }
    void refresh();
  }, [previewLayout, refresh]);

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

  const createDrive = async () => {
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
      const msg = r.drive?.message || (placement === 'cloud'
        ? 'Drive record is in BNDZ. Files stay on the Fly machine, not on this PC.'
        : 'Sealed disk slot is on the drive you picked.');
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
      pushToast({ kind: 'success', title, message: r.drive?.message || 'Updated.' });
    } catch (e) {
      pushToast({ kind: 'error', title: 'Cloud Drive', message: e instanceof Error ? e.message : String(e) });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

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

  const copyText = async (value: string, title: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      pushToast({ kind: 'success', title, message: 'Copied.' });
    } catch {
      pushToast({ kind: 'warning', title, message: value });
    }
  };

  return (
    <div className="bndz-cloud-stage flex flex-col gap-4 px-4 pb-4">
      <p className="text-[12px] leading-relaxed text-slate-300/90 m-0">
        Your files live on a private machine with its own disk. BNDZ only remote-controls it.
        Cloud uses your Fly account. This PC keeps a sealed disk image on a drive you pick — not a shared folder, and not Docker.
      </p>

      {hostNote && (
        <div className="bndz-cloud-note">{hostNote}</div>
      )}

      <p className="bndz-cloud-next">{nextAction(probe, placement, diskPath)}</p>

      <div className="bndz-cloud-meters" aria-label="Cloud Drive readiness">
        <Meter label="Fly token" value={probe.tokenConfigured ? 'Stored' : 'Needed'} hint={probe.tokenMessage} />
        <Meter label="Hyper-V" value={probe.hyperV ? (probe.elevated ? 'Ready' : 'Needs admin') : 'Not found'} />
        <Meter label="WSL2" value={probe.wslVersion === '2' ? 'Version 2' : probe.wslPresent ? 'Present' : 'Not found'} />
        <Meter label="cloudflared" value={probe.cloudflaredPresent ? 'Installed' : 'Not found'} hint={probe.cloudflaredMessage} />
      </div>
      {probe.guidance && (
        <details className="bndz-cloud-guidance">
          <summary>If Start fails</summary>
          <p>{probe.guidance}</p>
        </details>
      )}

      <p className="bndz-cloud-section-label">1 · Placement</p>
      <div className="bndz-cloud-bays" role="radiogroup" aria-label="Cloud Drive placement">
        <Bay
          selected={placement === 'cloud'}
          title="Cloud elsewhere"
          seal="Fly"
          body="MicroVM and volume on your Fly org. You pay Fly. BNDZ stores the token encrypted and never logs it."
          onSelect={() => setPlacement('cloud')}
        />
        <Bay
          selected={placement === 'local'}
          title="This PC — separate drive"
          seal="Disk"
          body="Same isolation shape. The sealed VHDX sits on a folder you pick (D:, USB, NAS letter), not on the system volume."
          onSelect={() => setPlacement('local')}
        />
      </div>

      <p className="bndz-cloud-section-label">2 · Name and disk</p>
      <PluginCard className="bndz-cloud-form">
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="bndz-plugin-field-label">Name</span>
            <input className={PLUGIN_INPUT_CLASS} value={name} maxLength={64} onChange={e => setName(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="bndz-plugin-field-label">Size (GB)</span>
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
                <span className="bndz-plugin-field-label">Region</span>
                <select className={PLUGIN_SELECT_CLASS} value={region} onChange={e => setRegion(e.target.value)}>
                  {FLY_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="bndz-plugin-field-label">Fly API token</span>
                <input
                  className={PLUGIN_INPUT_CLASS}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  name="bndz-fly-token"
                  placeholder={probe.tokenConfigured ? 'Token stored — paste only to replace it' : 'Paste a BYO org token'}
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
              <span className="bndz-plugin-field-label">Disk folder</span>
              <div className="flex gap-2">
                <input
                  className={PLUGIN_INPUT_CLASS + ' flex-1'}
                  value={diskPath}
                  placeholder="D:\BNDZ Drives"
                  onChange={e => setDiskPath(e.target.value)}
                />
                <PluginToolbarButton icon="folder_open_ui" onClick={() => void pickPath()}>Browse…</PluginToolbarButton>
              </div>
            </label>
          )}
          <div>
            <p className="bndz-cloud-section-label">3 · Create</p>
            <PluginToolbarButton disabled={busy} onClick={() => void createDrive()}>Create drive</PluginToolbarButton>
          </div>
        </div>
      </PluginCard>

      <section className="bndz-cloud-move is-local" aria-label="Open an existing sealed folder">
        <h4 className="bndz-cloud-section-label">Open existing</h4>
        <p className="bndz-cloud-message">
          Point BNDZ at a sealed folder you already copied. It needs drive.json. The private key stays on the PC that created the drive.
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
      </section>

      <PluginSectionTitle icon="hard_drive_ui" action={
        <PluginToolbarButton disabled={busy} onClick={() => void refresh()}>Refresh</PluginToolbarButton>
      }>
        Drives
      </PluginSectionTitle>

      {drives.length === 0 ? (
        <PluginEmptyState
          icon="cloud_drive"
          title="No Cloud Drives yet"
          description={nextAction(probe, placement, diskPath)}
        />
      ) : drives.map(drive => (
        <article key={drive.id} className={`bndz-cloud-cartridge is-${drive.placement === 'local' ? 'local' : 'cloud'}`}>
          <div className="bndz-cloud-cartridge-spine" aria-hidden />
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
              {drive.flyApp ? ` · ${drive.flyApp}` : ''}
              {drive.hypervisor ? ` · ${drive.hypervisor}` : ''}
              {drive.fingerprint ? ` · ${drive.fingerprint}` : ''}
            </p>
            {drive.diskPath && <p className="bndz-cloud-path" title={drive.diskPath}>{drive.diskPath}</p>}
            <p className="bndz-cloud-next">{driveHint(drive)}</p>
            {drive.state !== 'error' && drive.sshNote && <p className="bndz-cloud-message is-note">{drive.sshNote}</p>}
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
                  onCopy={copyText}
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
            <ShareNote drive={drive} onCopy={copyText} />
            <div className="flex flex-wrap gap-2 mt-2">
              <PluginToolbarButton disabled={busy || drive.state === 'deleting'} onClick={() => void run(drive.id, 'start')}>Start</PluginToolbarButton>
              <PluginToolbarButton disabled={busy || drive.state === 'deleting'} onClick={() => void run(drive.id, 'stop')}>Stop</PluginToolbarButton>
              <PluginToolbarButton disabled={busy || !drive.sshCommand} onClick={() => void copyText(drive.sshCommand || '', 'SSH command')}>Copy SSH</PluginToolbarButton>
              <PluginToolbarButton disabled={busy || !drive.publicKey} onClick={() => void copyText(drive.publicKey || '', 'Public key')}>Copy public key</PluginToolbarButton>
              <PluginToolbarButton disabled={busy} onClick={() => { setConfirmId(drive.id); setConfirmName(''); }}>Delete</PluginToolbarButton>
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
        Stop the drive, then copy the sealed folder. Open that copy here or on another PC to start the same files.
        A snapshot is crash-consistent. This copy is the portable disk.
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

function ShareNote({
  drive,
  onCopy,
}: {
  drive: CloudDriveRecord;
  onCopy: (value: string, title: string) => void;
}) {
  const panel = drive.endpoints?.find(endpoint => endpoint.id === 'panel');
  const url = panel?.copyText || '';
  return (
    <section className="bndz-cloud-shares" aria-label={`${drive.name} share links`}>
      <h4 className="bndz-cloud-section-label">Share links</h4>
      <p className="bndz-cloud-message">
        Create them in the drive’s web panel. Each link can expire, take a password, and be revoked. The drive serves the files, not this PC.
      </p>
      <div className="flex flex-wrap gap-2">
        <PluginToolbarButton disabled={!panel?.canCopy || !url} onClick={() => onCopy(url, 'Panel URL')}>Copy panel URL</PluginToolbarButton>
        <PluginToolbarButton disabled={!panel?.canCopy || !url} onClick={() => { if (url) window.open(url, '_blank'); }}>Open panel</PluginToolbarButton>
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
        <div key={endpoint.id} className="bndz-cloud-protocol">
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
  onCopy,
}: {
  drive: CloudDriveRecord;
  busy: boolean;
  onChanged: () => Promise<void> | void;
  onCopy: (value: string, title: string) => void;
}) {
  const [token, setToken] = useState('');
  const [hostname, setHostname] = useState(drive.tunnelHostname || '');
  const [pending, setPending] = useState(false);
  useEffect(() => { setHostname(drive.tunnelHostname || ''); }, [drive.tunnelHostname]);
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

  const saveHost = async () => {
    const normalized = normalizeTunnelHostname(hostname);
    if (!normalized.ok) {
      pushToast({ kind: 'warning', title: 'Hostname', message: normalized.error });
      return;
    }
    setPending(true);
    try {
      const r = await IPC.cloudDriveSetTunnelHostname(drive.id, normalized.hostname);
      await apply(r, normalized.hostname ? 'Hostname saved' : 'Hostname cleared');
    } catch (e) {
      pushToast({ kind: 'error', title: 'Hostname', message: e instanceof Error ? e.message : 'Could not save the hostname.' });
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

  const panel = drive.endpoints?.find(endpoint => endpoint.id === 'panel');

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
      <label className="grid gap-1">
        <span className="bndz-plugin-field-label">Public hostname</span>
        <input
          className={PLUGIN_INPUT_CLASS}
          value={hostname}
          spellCheck={false}
          placeholder="drive.example.com"
          onChange={e => setHostname(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <PluginToolbarButton disabled={locked} onClick={() => void saveHost()}>Save hostname</PluginToolbarButton>
        <PluginToolbarButton
          disabled={locked || !panel?.canCopy || !panel.copyText}
          onClick={() => onCopy(panel?.copyText || '', 'Panel URL')}
        >
          Copy panel URL
        </PluginToolbarButton>
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
