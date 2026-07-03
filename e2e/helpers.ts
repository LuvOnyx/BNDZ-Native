import path from 'path';
import { fileURLToPath } from 'url';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

const E2E_ROOT = path.dirname(fileURLToPath(import.meta.url));

export const organizeFixtureWin = path.join(E2E_ROOT, '.work', 'organize-fixture');
export const dupFixtureWin = path.join(E2E_ROOT, '.work', 'dup-fixture');

export function panePathFromWin(winPath: string): string {
  return `/${winPath.replace(/\\/g, '/')}`;
}

/** Skip splash, dismiss first-run overlays, and wait for the FM shell. */
export async function bootApp(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('bndz-launch-splash-seen', '1');
  });
  await page.goto('/');
  await page.getByTestId('bndz-app').waitFor({ state: 'visible', timeout: 45_000 });
  await page.getByText('Loading BNDZ…').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});

  const neverTutorial = page.getByRole('button', { name: 'Never show again' });
  if (await neverTutorial.isVisible().catch(() => false)) {
    await neverTutorial.click();
  }
  const dismissLicense = page.getByRole('button', { name: 'Dismiss' });
  if (await dismissLicense.isVisible().catch(() => false)) {
    await dismissLicense.click();
  }
}

export async function navigateTo(page: Page, panePath: string) {
  await page.evaluate((p) => {
    window.dispatchEvent(new CustomEvent('bndz-navigate', { detail: { path: p } }));
  }, panePath);
  await page.waitForTimeout(400);
}

export async function openStorageWizard(page: Page, mode: 'organize' | 'cleanup') {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'storage-cleanup' } }));
  });
  await expect(page.getByText('Smart Storage')).toBeVisible({ timeout: 15_000 });
  await page.evaluate((m) => {
    window.dispatchEvent(new CustomEvent('bndz-storage-wizard', { detail: { mode: m } }));
  }, mode);
  await expect(page.getByRole('heading', { name: mode === 'organize' ? 'Smart Organize Wizard' : 'Storage Cleanup Wizard' })).toBeVisible({ timeout: 15_000 });
}

export async function useCurrentFolderInWizard(page: Page) {
  await page.getByRole('button', { name: 'Use current folder' }).click();
}

export async function continueWizard(page: Page) {
  await page.getByRole('button', { name: 'Continue' }).click();
}
