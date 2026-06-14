import { useMemo } from 'react';
import { useAppConfig } from '../data/configContext';
import { buildSettingsRuntime, type SettingsRuntimeContext } from '../lib/settingsRuntime';

export function useSettingsRuntime(): SettingsRuntimeContext {
  const { config } = useAppConfig();
  return useMemo(() => buildSettingsRuntime(config), [config]);
}
