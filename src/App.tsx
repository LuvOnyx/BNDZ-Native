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
import { applyNativeShellHostDocumentMark } from './lib/nativeShellHostBoot';
import { applyPaneDocumentMark, readPaneBootFromUrl } from './lib/paneBoot';
import { applyFilesHostDocumentMark, isFilesHostBoot } from './lib/filesHostBoot';
import BndzErrorBoundary from './components/BndzErrorBoundary';

const PLUGIN_BOOT = readPluginWindowBootFromUrl();
const PANE_BOOT = readPaneBootFromUrl();
const FILES_HOST = isFilesHostBoot();
if (PLUGIN_BOOT && (PLUGIN_BOOT.stickyId || PLUGIN_BOOT.pluginId === 'sticky-note')) {
  try {
    document.documentElement.dataset.bndzStickyWidget = '1';
    document.documentElement.dataset.bndzShell = 'native-host';
  } catch { /* ignore */ }
}
const CRAFT_ISLAND =
  PANE_BOOT?.pane === 'chrome' || PANE_BOOT?.pane === 'sidebar' ? PANE_BOOT.pane : null;
applyNativeShellDocumentMark();
applyNativeShellHostDocumentMark();
applyPaneDocumentMark(PANE_BOOT);
applyFilesHostDocumentMark();
if (CRAFT_ISLAND) {
  try {
    document.documentElement.dataset.bndzIsland = CRAFT_ISLAND;
    document.documentElement.dataset.bndzShell = 'native-host';
    document.body?.classList.add('bndz-native-host-body');
  } catch { /* ignore */ }
}

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
        <ClipboardProvider>
          <PluginRegistryProvider>
            <ModalProvider>
              <PluginPopoutShell initial={PLUGIN_BOOT} />
              <ToastHost />
            </ModalProvider>
          </PluginRegistryProvider>
        </ClipboardProvider>
      </ConfigProvider>
    );
  }

  if (CRAFT_ISLAND) {
    return (
      <ConfigProvider>
        <ClipboardProvider>
          <PluginRegistryProvider>
            <ModalProvider>
              <AiModelGateProvider>
                <Suspense fallback={null}>
                  <BndzErrorBoundary label="BNDZ">
                    <BNDZUI />
                  </BndzErrorBoundary>
                </Suspense>
                <ToastHost />
              </AiModelGateProvider>
            </ModalProvider>
          </PluginRegistryProvider>
        </ClipboardProvider>
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
                  <BndzErrorBoundary label="BNDZ">
                    <BNDZUI />
                  </BndzErrorBoundary>
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
              <BndzErrorBoundary label="BNDZ">
                <BNDZUI />
              </BndzErrorBoundary>
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
