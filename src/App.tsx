/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, Suspense } from 'react';
import BNDZUI from './components/BNDZUI';
import PluginPopoutShell from './components/PluginPopoutShell';
import BndzPaneShell from './components/BndzPaneShell';
import { ConfigProvider, useAppConfig } from './data/configContext';
import { ClipboardProvider } from './data/ClipboardContext';
import ModalProvider from './components/ModalProvider';
import { AiModelGateProvider } from './components/AiModelGateProvider';
import ToastHost from './components/ToastHost';
import { PluginRegistryProvider } from './data/PluginRegistryContext';
import { initGlobalEscapeListener } from './lib/globalEscape';
import LaunchSplash from './components/LaunchSplash';
import PerfHud from './components/PerfHud';
import LegalAcceptGate from './components/LegalAcceptGate';
import { readPluginWindowBootFromUrl } from './lib/pluginWindowBoot';
import { getStartupBehavior } from './lib/settingsBehavior';
import { applyNativeShellDocumentMark, isNativeShellBoot } from './lib/nativeShellBoot';
import { applyPaneDocumentMark, readPaneBootFromUrl } from './lib/paneBoot';
import { applyFilesHostDocumentMark, isFilesHostBoot } from './lib/filesHostBoot';

const PLUGIN_BOOT = readPluginWindowBootFromUrl();
const PANE_BOOT = readPaneBootFromUrl();
const FILES_HOST = isFilesHostBoot();
applyNativeShellDocumentMark();
applyPaneDocumentMark(PANE_BOOT);
applyFilesHostDocumentMark();

function LaunchSplashGate({ onDone }: { onDone: () => void }) {
  const { config } = useAppConfig();
  const wantSplash = getStartupBehavior(config).showSplashScreenWhileLoading;
  useEffect(() => {
    if (!wantSplash) onDone();
  }, [wantSplash, onDone]);
  if (!wantSplash) return null;
  return <LaunchSplash onDone={onDone} />;
}

export default function App() {
  const [splashDone, setSplashDone] = useState(() => {
    if (PLUGIN_BOOT || PANE_BOOT || FILES_HOST) return true;
    if (isNativeShellBoot()) return true;
    try {
      return localStorage.getItem('bndz-launch-splash-seen') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => initGlobalEscapeListener(), []);

  const handleSplashDone = () => {
    try {
      localStorage.setItem('bndz-launch-splash-seen', '1');
    } catch { /* ignore */ }
    setSplashDone(true);
  };

  if (PLUGIN_BOOT) {
    return (
      <ConfigProvider>
        <PluginRegistryProvider>
          <PluginPopoutShell initial={PLUGIN_BOOT} />
          <ToastHost />
        </PluginRegistryProvider>
      </ConfigProvider>
    );
  }

  if (PANE_BOOT) {
    return (
      <ConfigProvider>
        <ClipboardProvider>
          <PluginRegistryProvider>
            <ModalProvider>
              <AiModelGateProvider>
                <BndzPaneShell initial={PANE_BOOT} />
                <ToastHost />
              </AiModelGateProvider>
            </ModalProvider>
          </PluginRegistryProvider>
        </ClipboardProvider>
      </ConfigProvider>
    );
  }

  // FilesMerge main browser: full classic BNDZUI (tree + list + preview + plugins).
  if (FILES_HOST) {
    return (
      <ConfigProvider>
        <ClipboardProvider>
          <PluginRegistryProvider>
            <ModalProvider>
              <AiModelGateProvider>
                <Suspense fallback={null}>
                  <BNDZUI />
                </Suspense>
                <ToastHost />
              </AiModelGateProvider>
            </ModalProvider>
          </PluginRegistryProvider>
        </ClipboardProvider>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider>
      <ClipboardProvider>
        <PluginRegistryProvider>
          <ModalProvider>
            <AiModelGateProvider>
            <LegalAcceptGate>
            {!splashDone && <LaunchSplashGate onDone={handleSplashDone} />}
            <Suspense fallback={null}>
              <BNDZUI />
            </Suspense>
            <ToastHost />
            <PerfHud />
            </LegalAcceptGate>
            </AiModelGateProvider>
          </ModalProvider>
        </PluginRegistryProvider>
      </ClipboardProvider>
    </ConfigProvider>
  );
}
