/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, Suspense } from 'react';
import BNDZUI from './components/BNDZUI';
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

export default function App() {
  const [splashDone, setSplashDone] = useState(() => {
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
