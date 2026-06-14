/** Neutral slot while native shell / Iconify icons load — no Lucide/Hero fallbacks */
export function IconPlaceholder({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={`shrink-0 rounded-[3px] bg-gradient-to-br from-white/[0.06] to-white/[0.02] ring-1 ring-white/[0.08] ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
