/** SuperCmd detail-markdown port — lightweight Raycast-style renderer for AI responses */
import React, { useState } from 'react';

type ResolveImageSrc = (src: string) => string;

function MarkdownImage({
  src,
  alt,
  className,
  style,
  placeholderHeight,
}: {
  src: string;
  alt: string;
  className: string;
  style?: React.CSSProperties;
  placeholderHeight: number;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[var(--text-subtle)]"
        style={{ width: style?.width ?? placeholderHeight * 0.7, height: placeholderHeight }}
        aria-label={alt || 'Image unavailable'}
        role="img"
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => setErrored(true)}
    />
  );
}

function renderInlineMarkdown(text: string, resolveImageSrc: ResolveImageSrc): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a
          key={key++}
          href={linkMatch[2]}
          className="text-[var(--accent)] hover:underline"
          onClick={e => {
            e.preventDefault();
            window.open(linkMatch[2], '_blank');
          }}
        >
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="bg-[var(--kbd-bg)] px-1.5 py-0.5 rounded text-[11px] font-mono">
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="font-semibold">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    const plainMatch = remaining.match(/^[^[\]`*]+/);
    if (plainMatch) {
      parts.push(plainMatch[0]);
      remaining = remaining.slice(plainMatch[0].length);
    } else {
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function renderSimpleMarkdown(md: string, resolveImageSrc: ResolveImageSrc = s => s): React.ReactNode[] {
  const lines = md.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      elements.push(
        <pre
          key={elements.length}
          className="my-2 p-3 rounded-lg bg-black/30 border border-white/8 text-[12px] font-mono overflow-x-auto text-[var(--text-secondary)]"
        >
          <code>{codeLines.join('\n')}</code>
        </pre>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={elements.length} className="text-[13px] font-semibold text-[var(--text-primary)] mt-3 mb-1">
          {line.slice(4)}
        </h3>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={elements.length} className="text-[14px] font-semibold text-[var(--text-primary)] mt-3 mb-1">
          {line.slice(3)}
        </h2>,
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      elements.push(
        <div key={elements.length} className="flex items-start gap-2 text-sm ml-2">
          <span className="text-[var(--text-subtle)] mt-0.5">•</span>
          <span>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ''), resolveImageSrc)}</span>
        </div>,
      );
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      elements.push(<div key={elements.length} className="h-1" />);
      i += 1;
      continue;
    }

    elements.push(
      <p key={elements.length} className="text-sm leading-relaxed text-[var(--text-secondary)]">
        {renderInlineMarkdown(line, resolveImageSrc)}
      </p>,
    );
    i += 1;
  }

  return elements;
}
