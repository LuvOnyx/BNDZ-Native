import type { AppConfig } from '../data/configContext';

export type ShellExecuteOptions = {
  useCustom?: boolean;
  interpreter?: string;
  args?: string;
};

/** Optional custom shell interpreter from Templates → Command line. */
export function buildShellExecuteOptions(config?: AppConfig | null): ShellExecuteOptions | undefined {
  if (!config?.useCustomCommandLineInterpreterElseDefaultToCmdExe) return undefined;
  const interpreter = String(config.unwiredConfig15 || '').trim();
  if (!interpreter) return undefined;
  return {
    useCustom: true,
    interpreter,
    args: String(config.unwiredConfig16 || '').trim(),
  };
}

/** Expand %WD%, %PATH%, %CMD% placeholders in custom shell argument templates. */
export function expandShellArgsTemplate(
  template: string,
  vars: { workingDir?: string; path?: string; command?: string },
): string {
  let out = template || '';
  if (vars.workingDir) out = out.replace(/%WD%/gi, vars.workingDir);
  if (vars.path) out = out.replace(/%PATH%/gi, vars.path);
  if (vars.command) out = out.replace(/%CMD%/gi, vars.command);
  return out;
}
