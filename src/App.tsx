/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, Suspense } from 'react';
import BNDZUI from './components/BNDZUI';
import PluginPopoutShell from './components/PluginPopoutShell';
import BndzPaneShell from './components/BndzPaneShell';
import { ConfigProvider } from './data/configContext';
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
import { applyNativeShellDocumentMark, isNativeShellBoot } from './lib/nativeShellBoot';
import { applyPaneDocumentMark, readPaneBootFromUrl } from './lib/paneBoot';

const PLUGIN_BOOT = readPluginWindowBootFromUrl();
const PANE_BOOT = readPaneBootFromUrl();
applyNativeShellDocumentMark();
applyPaneDocumentMark(PANE_BOOT);

export default function App() {
  const [splashDone, setSplashDone] = useState(() => {
    if (PLUGIN_BOOT || PANE_BOOT) return true;
    // Native shell compare sessions skip splash so both versions are ready faster.
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

  return (
    <ConfigProvider>
      <ClipboardProvider>
        <PluginRegistryProvider>
          <ModalProvider>
            <AiModelGateProvider>
            <LegalAcceptGate>
            {!splashDone && <LaunchSplash onDone={handleSplashDone} />}
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
