import React, { useCallback, useEffect, useState } from 'react';
import { Icons8Icon } from '../Icons8Icon';
import { IPC } from '../../lib/ipcBridge';
import { toWindowsPath } from '../../lib/pathUtils';

export type JobTicket = {
  id: string;
  folderPath: string;
  title: string;
  dueUtc: string;
  status: string;
  notes?: string;
  createdUtc?: string;
  updatedUtc?: string;
};

function normalizeTicket(raw: Record<string, unknown>): JobTicket {
  return {
    id: String(raw.id ?? raw.Id ?? ''),
    folderPath: String(raw.folderPath ?? raw.FolderPath ?? ''),
    title: String(raw.title ?? raw.Title ?? ''),
    dueUtc: String(raw.dueUtc ?? raw.DueUtc ?? ''),
    status: String(raw.status ?? raw.Status ?? 'open'),
    notes: (raw.notes ?? raw.Notes) as string | undefined,
    createdUtc: (raw.createdUtc ?? raw.CreatedUtc) as string | undefined,
    updatedUtc: (raw.updatedUtc ?? raw.UpdatedUtc) as string | undefined,
  };
}

function isOverdue(dueUtc: string, status: string): boolean {
  if (status === 'done' || status === 'cancelled') return false;
  const due = new Date(dueUtc);
  return !Number.isNaN(due.getTime()) && due < new Date();
}

function slaLabel(dueUtc: string): string {
  const due = new Date(dueUtc);
  if (Number.isNaN(due.getTime())) return '—';
  const diff = due.getTime() - Date.now();
  if (diff < 0) {
    const hrs = Math.floor(-diff / 3_600_000);
    return hrs < 24 ? `${hrs}h overdue` : `${Math.floor(hrs / 24)}d overdue`;
  }
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 24) return `${hrs}h left`;
  return `${Math.floor(hrs / 24)}d left`;
}

interface Props {
  folderPath: string | null;
  onChanged?: () => void;
}

export default function JobTicketPanel({ folderPath, onChanged }: Props) {
  const [tickets, setTickets] = useState<JobTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!folderPath) {
      setTickets([]);
      return;
    }
    setLoading(true);
    try {
      const res = await IPC.jobTicketList(toWindowsPath(folderPath));
      if (res.ok) {
        setTickets((res.tickets || []).map(t => normalizeTicket(t as Record<string, unknown>)));
      }
    } finally {
      setLoading(false);
    }
  }, [folderPath]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveTicket = async () => {
    if (!folderPath || !title.trim() || !dueLocal) return;
    setBusy(true);
    try {
      const dueUtc = new Date(dueLocal).toISOString();
      const res = await IPC.jobTicketSave({
        folderPath: toWindowsPath(folderPath),
        title: title.trim(),
        dueUtc,
        notes: notes.trim() || undefined,
        status: 'open',
      });
      if (res.ok) {
        setEditing(false);
        setTitle('');
        setDueLocal('');
        setNotes('');
        await refresh();
        onChanged?.();
        window.dispatchEvent(new CustomEvent('bndz-job-ticket-changed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const markDone = async (ticket: JobTicket) => {
    setBusy(true);
    try {
      await IPC.jobTicketSave({ ...ticket, status: 'done' });
      await refresh();
      onChanged?.();
      window.dispatchEvent(new CustomEvent('bndz-job-ticket-changed'));
    } finally {
      setBusy(false);
    }
  };

  const deleteTicket = async (ticketId: string) => {
    setBusy(true);
    try {
      await IPC.jobTicketDelete(ticketId);
      await refresh();
      onChanged?.();
      window.dispatchEvent(new CustomEvent('bndz-job-ticket-changed'));
    } finally {
      setBusy(false);
    }
  };

  if (!folderPath) return null;

  const openTickets = tickets.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const hasOverdue = openTickets.some(t => isOverdue(t.dueUtc, t.status));

  return (
    <div className="border-t border-white/[0.06] px-4 py-3 bndz-job-ticket-panel">
      <div className="flex items-center gap-1.5 mb-2">
        <Icons8Icon id="clock_ui" size={13} className="opacity-60" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Job Tickets</span>
        {hasOverdue && (
          <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold">OVERDUE</span>
        )}
        {loading && <span className="text-[10px] text-gray-600 ml-auto animate-pulse">…</span>}
        {!editing && (
          <button
            type="button"
            className="ml-auto text-[10px] text-[#7eb8e8] hover:text-white"
            onClick={() => setEditing(true)}
          >
            + Attach
          </button>
        )}
      </div>

      {editing && (
        <div className="mb-3 p-2.5 rounded-lg border border-white/[0.08] bg-white/[0.03] space-y-2">
          <input
            className="w-full px-2 py-1 text-xs rounded bg-black/30 border border-white/10"
            placeholder="Ticket title (e.g. Deliver stems)"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <input
            type="datetime-local"
            className="w-full px-2 py-1 text-xs rounded bg-black/30 border border-white/10"
            value={dueLocal}
            onChange={e => setDueLocal(e.target.value)}
          />
          <input
            className="w-full px-2 py-1 text-xs rounded bg-black/30 border border-white/10"
            placeholder="Notes (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className="flex-1 text-[10px] py-1.5 rounded bg-[#7eb8e8]/20 text-[#7eb8e8] border border-[#7eb8e8]/30" disabled={busy} onClick={() => void saveTicket()}>Save</button>
            <button type="button" className="text-[10px] py-1.5 px-2 rounded text-gray-500" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {openTickets.length === 0 && !editing && (
        <p className="text-[10px] text-gray-600 italic">No open tickets on this folder.</p>
      )}

      <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto bndz-scrollbar">
        {openTickets.map(ticket => {
          const overdue = isOverdue(ticket.dueUtc, ticket.status);
          return (
            <div
              key={ticket.id}
              className={`flex items-start gap-2 px-2 py-1.5 rounded-lg border text-[11px] ${overdue ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'}`}
            >
              <div className="min-w-0 flex-1">
                <div className={`font-medium truncate ${overdue ? 'text-red-200' : 'text-gray-200'}`}>{ticket.title}</div>
                <div className={`text-[9px] mt-0.5 ${overdue ? 'text-red-400' : 'text-gray-500'}`}>{slaLabel(ticket.dueUtc)}</div>
              </div>
              <button type="button" className="text-[9px] text-emerald-400 hover:text-emerald-300 shrink-0" disabled={busy} onClick={() => void markDone(ticket)}>Done</button>
              <button type="button" className="text-[9px] text-gray-600 hover:text-red-400 shrink-0" disabled={busy} onClick={() => void deleteTicket(ticket.id)}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function JobTicketOverdueBadge({ count, title }: { count: number; title?: string }) {
  if (!count) return null;
  return (
    <span
      className="bndz-job-ticket-badge inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-red-500/25 text-red-300 border border-red-500/35 shrink-0"
      title={title || `${count} overdue ticket${count === 1 ? '' : 's'}`}
    >
      <Icons8Icon id="clock_ui" size={10} />
      {count > 1 ? count : '!'}
    </span>
  );
}
