import { useCallback, useEffect, useRef, useState } from 'react';
import { IPC } from '../../lib/ipcBridge';

/**
 * GitHub feed — a live-data Home plugin (Homarr-style integration).
 * Shows the account's recent public activity: pushes, pull requests,
 * issues, releases, stars. Username comes from config.githubFeedUser
 * (default LuvOnyx); no token needed for public activity.
 */

type GhEvent = {
  id: string;
  type: string;
  created_at: string;
  repo?: { name?: string };
  actor?: { login?: string; avatar_url?: string };
  payload?: any;
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

function describe(ev: GhEvent): string {
  const p = ev.payload ?? {};
  switch (ev.type) {
    case 'PushEvent': {
      const n = Array.isArray(p.commits) ? p.commits.length : p.size;
      const branch = typeof p.ref === 'string' ? p.ref.replace('refs/heads/', '') : '';
      return `pushed ${n ? `${n} commit${n === 1 ? '' : 's'}` : 'commits'}${branch ? ` to ${branch}` : ''}`;
    }
    case 'PullRequestEvent': {
      const title = p.pull_request?.title ? ` — ${p.pull_request.title}` : '';
      return `${p.action ?? 'updated'} pull request #${p.number ?? ''}${title}`;
    }
    case 'IssuesEvent':
      return `${p.action ?? 'updated'} issue #${p.issue?.number ?? ''}${p.issue?.title ? ` — ${p.issue.title}` : ''}`;
    case 'CreateEvent':
      return `created ${p.ref_type ?? 'repository'}${p.ref ? ` ${p.ref}` : ''}`;
    case 'DeleteEvent':
      return `deleted ${p.ref_type ?? 'ref'} ${p.ref ?? ''}`;
    case 'ReleaseEvent':
      return `${p.action ?? 'published'} release ${p.release?.tag_name ?? ''}`;
    case 'WatchEvent':
      return 'starred';
    case 'ForkEvent':
      return 'forked';
    case 'PublicEvent':
      return 'made the repository public';
    case 'MemberEvent':
      return `${p.action ?? 'updated'} a collaborator`;
    default:
      return ev.type.replace(/Event$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }
}

export default function GitHubFeedModule({ config, updateConfig }: {
  config?: Record<string, any>;
  updateConfig?: (patch: Record<string, any>) => void;
}) {
  const user = (typeof config?.githubFeedUser === 'string' && config.githubFeedUser.trim())
    ? config.githubFeedUser.trim()
    : 'LuvOnyx';
  const [events, setEvents] = useState<GhEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState(false);
  const [draftUser, setDraftUser] = useState(user);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=12`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(res.status === 404 ? 'user not found' : `GitHub ${res.status}`);
      const data = (await res.json()) as GhEvent[];
      if (!aliveRef.current) return;
      setEvents(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : 'could not reach GitHub');
    }
  }, [user]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const t = setInterval(() => { void load(); }, 5 * 60 * 1000);
    return () => { aliveRef.current = false; clearInterval(t); };
  }, [load]);

  const openRepo = (repo?: string) => {
    if (!repo) return;
    try { void IPC.shellExecute('open', `https://github.com/${repo}`); } catch { /* shell unavailable */ }
  };

  return (
    <section className="bndz-home-ghfeed" aria-label="GitHub feed">
      <div className="bndz-home-section-label">
        <span>GitHub</span>
        {editingUser ? (
          <span className="bndz-home-ghfeed-useredit">
            <input
              value={draftUser}
              autoFocus
              onChange={e => setDraftUser(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { updateConfig?.({ githubFeedUser: draftUser.trim() || 'LuvOnyx' }); setEditingUser(false); }
                if (e.key === 'Escape') setEditingUser(false);
              }}
              onBlur={() => setEditingUser(false)}
              aria-label="GitHub username"
            />
          </span>
        ) : (
          <button
            type="button"
            className="bndz-home-ghfeed-user"
            title="Change GitHub username"
            onClick={() => { setDraftUser(user); setEditingUser(true); }}
          >
            @{user}
          </button>
        )}
        <button type="button" className="bndz-home-ghfeed-refresh" title="Refresh feed" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {events === null && !error && (
        <div className="bndz-home-ghfeed-note">Loading GitHub activity…</div>
      )}
      {error && (
        <div className="bndz-home-ghfeed-note">Couldn't load the feed ({error}). It'll retry on its own.</div>
      )}
      {events !== null && events.length === 0 && !error && (
        <div className="bndz-home-ghfeed-note">No public activity yet for @{user}.</div>
      )}
      {events !== null && events.length > 0 && (
        <ul className="bndz-home-ghfeed-list">
          {events.slice(0, 8).map(ev => (
            <li key={ev.id} className="bndz-home-ghfeed-item">
              {ev.actor?.avatar_url
                ? <img className="bndz-home-ghfeed-avatar" src={ev.actor.avatar_url} alt="" width={18} height={18} loading="lazy" />
                : <span className="bndz-home-ghfeed-avatar is-fallback" />}
              <span className="bndz-home-ghfeed-text">
                <span className="bndz-home-ghfeed-action">{describe(ev)}</span>
                {ev.repo?.name && (
                  <>
                    {' '}
                    <button type="button" className="bndz-home-ghfeed-repo" onClick={() => openRepo(ev.repo?.name)}>
                      {ev.repo.name}
                    </button>
                  </>
                )}
              </span>
              <span className="bndz-home-ghfeed-time">{relTime(ev.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
