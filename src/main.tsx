import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './lib/bndzFontPack';
import { IPC } from './lib/ipcBridge';
import App from './App.tsx';
import './index.css';

// Eager init — external OLE drops must not race the lazy FS-event listener registration.
IPC.init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
