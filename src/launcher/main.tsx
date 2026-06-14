import React from 'react';
import { createRoot } from 'react-dom/client';
import BndzLauncherApp from './BndzLauncherApp';
import './styles/bndz-launcher.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BndzLauncherApp />
  </React.StrictMode>
);
