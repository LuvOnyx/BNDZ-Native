import { test, expect } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';
import {
  bootApp,
  continueWizard,
  dupFixtureWin,
  navigateTo,
  openStorageWizard,
  organizeFixtureWin,
  panePathFromWin,
  useCurrentFolderInWizard,
} from './helpers';

test.describe('BNDZ critical paths', () => {
  test('app shell boots in web mode', async ({ page }) => {
    await bootApp(page);
    await expect(page.getByText('File')).toBeVisible();
    await expect(page.getByTestId('bndz-app')).toBeVisible();
  });

  test('command palette opens and filters actions', async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press('Control+Shift+P');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await palette.locator('input').fill('settings');
    await expect(palette.getByText('Open Settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('storage cleanup plugin opens from custom event', async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('bndz-open-bottom-plugin', { detail: { id: 'storage-cleanup' } }));
    });
    await expect(page.getByText('Smart Storage')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cleanup Wizard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Organize Wizard' })).toBeVisible();
  });

  test('organize wizard: select → preview → confirm moves files', async ({ page }) => {
    await bootApp(page);
    await navigateTo(page, panePathFromWin(organizeFixtureWin));
    await openStorageWizard(page, 'organize');

    await expect(page.getByText('Smart Organize Wizard')).toBeVisible();
    await useCurrentFolderInWizard(page);
    await continueWizard(page);

    const wizard = page.getByTestId('storage-cleanup-wizard');
    await expect(wizard.getByText(/files will be organized/i)).toBeVisible({ timeout: 20_000 });
    await expect(wizard.getByText(/files → Documents\//)).toBeVisible();
    await expect(wizard.getByText(/files → Images\//)).toBeVisible();
    await expect(wizard.getByText(/files → Code\//)).toBeVisible();

    await wizard.getByRole('button', { name: /Organize \d+ files/i }).click();
    await expect(wizard.getByText(/Organized 3 file/i)).toBeVisible({ timeout: 20_000 });

    await expect(fs.stat(path.join(organizeFixtureWin, 'Documents', 'readme.md'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(organizeFixtureWin, 'Images', 'photo.png'))).resolves.toBeDefined();
    await expect(fs.stat(path.join(organizeFixtureWin, 'Code', 'script.js'))).resolves.toBeDefined();
  });

  test('cleanup wizard: scan duplicates → preview delete plan', async ({ page }) => {
    await bootApp(page);
    await navigateTo(page, panePathFromWin(dupFixtureWin));
    await openStorageWizard(page, 'cleanup');

    await expect(page.getByText('Storage Cleanup Wizard')).toBeVisible();
    await page.getByTestId('storage-cleanup-wizard').locator('select').first().selectOption('1');
    await useCurrentFolderInWizard(page);
    await continueWizard(page);

    await expect(page.getByText(/duplicate files will be removed/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Reclaim/i)).toBeVisible();
    await expect(page.getByText('Keep:')).toBeVisible();

    await page.getByRole('button', { name: /Delete \d+ duplicates/i }).click();
    const wizard = page.getByTestId('storage-cleanup-wizard');
    await expect(wizard.getByText(/Removed 1 duplicate/i)).toBeVisible({ timeout: 20_000 });

    const remaining = await fs.readdir(dupFixtureWin);
    const datFiles = remaining.filter(f => f.endsWith('.dat'));
    expect(datFiles).toHaveLength(2);
    expect(datFiles).toContain('unique.dat');
  });
});
