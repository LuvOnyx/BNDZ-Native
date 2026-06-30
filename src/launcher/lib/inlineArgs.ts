import type { LauncherCommand } from '../types';

export type InlineArgField = {
  key: string;
  label: string;
  placeholder?: string;
  value: string;
};

const ARG_RE = /\{([a-zA-Z0-9_]+)\}/g;

export function extractTemplateArgs(template: string): string[] {
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(ARG_RE.source, 'g');
  while ((m = re.exec(template)) !== null) keys.add(m[1]);
  return [...keys];
}

export function buildInlineArgFields(command: LauncherCommand | null, template?: string): InlineArgField[] {
  const src = template
    ?? command?.subtitle
    ?? command?.detail
    ?? '';
  if (!src.includes('{')) return [];
  return extractTemplateArgs(src).map(key => ({
    key,
    label: key.replace(/_/g, ' '),
    placeholder: key,
    value: '',
  }));
}

export function applyTemplateArgs(template: string, values: Record<string, string>): string {
  return template.replace(ARG_RE, (_, key: string) => values[key] ?? `{${key}}`);
}

export function resolveCommandWithInlineArgs(
  command: LauncherCommand,
  argValues: Record<string, string>,
): LauncherCommand {
  const template = command.subtitle || command.detail || '';
  if (!template.includes('{')) return command;
  const resolved = applyTemplateArgs(template, argValues);
  if (command.id.startsWith('quicklink-') || command.category === 'quicklink') {
    return { ...command, subtitle: resolved, detail: resolved };
  }
  return { ...command, subtitle: resolved };
}
