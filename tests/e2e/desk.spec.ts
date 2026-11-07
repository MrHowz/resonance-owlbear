import { expect, test } from '@playwright/test';
test('library edit, search, CSV import, backup, scenes, queue and mobile layout', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Play The Amber Archive', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Play The Amber Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause music', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play Rain on the Rooftops', exact: true }).click();
  await page.getByRole('button', { name: 'Save as a scene', exact: true }).click();
  await page.getByLabel('Scene name', { exact: true }).fill('Storm at the archive');
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  await page.getByRole('button', { name: 'Queue A Quiet Place', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Repeat music', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Next queued track', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A Quiet Place', exact: true })).toBeVisible();
  await page.getByLabel('Search library').fill('rooftps');
  await expect(page.locator('.track-row')).toHaveCount(1);
  await page.getByLabel('Search library').clear();
  await page.getByRole('button', { name: 'Add track', exact: true }).click();
  await page.getByLabel('Track title', { exact: true }).fill('Custom magic');
  await page.getByLabel('Public audio URL', { exact: true }).fill('https://example.com/magic.mp3');
  await page.getByLabel('Play as', { exact: true }).selectOption('sfx');
  await page.getByLabel('Tags', { exact: true }).fill('custom, spell');
  await page.getByRole('button', { name: 'Save track', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Trigger Custom magic', exact: true }),
  ).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({
    name: 'tracks.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('title,url,tags\nImported,https://example.com/import.mp3,imported|test'),
  });
  await page.getByRole('button', { name: 'Import library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play Imported', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('resonance-backup.json');
  await page.getByRole('button', { name: 'Scenes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Storm at the archive', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Launch scene', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'The Amber Archive', exact: true })).toBeVisible();
  for (const width of [480, 375, 320]) {
    await page.setViewportSize({ width, height: 860 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole('button', { name: 'Stop all', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Let the story begin', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('actual SDK iframes: shared playback, late join, player permissions and background lifecycle', async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    const NativeAudio = window.Audio;
    (window as any).__audios = [];
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const a = new target(...args);
        (window as any).__audios.push(a);
        return a;
      },
    });
  });
  const room = `sdk-${Date.now()}`;
  await page.goto(`/tests/obr-host.html?room=${room}`);
  const gm = page.frameLocator('#desk');
  await expect(gm.getByText('ROOM CONNECTED', { exact: true })).toBeVisible();
  await gm.getByRole('button', { name: 'Load demo library', exact: true }).click();
  await gm.getByRole('button', { name: 'Play The Amber Archive', exact: true }).click();
  const background = () => page.frame({ url: /background\.html/ })!;
  await expect
    .poll(() =>
      background().evaluate(
        () => (window as any).__audios.filter((a: HTMLAudioElement) => !a.paused).length,
      ),
    )
    .toBe(1);
  await page.waitForTimeout(1400);
  const listenerPage = await context.newPage();
  await listenerPage.goto(`/tests/obr-host.html?room=${room}&role=PLAYER`);
  const listener = listenerPage.frameLocator('#desk');
  await expect(
    listener.getByRole('heading', { name: 'The Amber Archive', exact: true }),
  ).toBeVisible();
  await expect(listener.getByRole('button', { name: 'Pause music', exact: true })).toBeDisabled();
  await expect(
    listener.getByRole('slider', { name: 'Music room volume', exact: true }),
  ).toBeDisabled();
  await expect(
    listener.getByRole('slider', { name: 'Ambience room volume', exact: true }),
  ).toBeDisabled();
  const listenerBackground = listenerPage.frame({ url: /background\.html/ })!;
  await expect
    .poll(() =>
      listenerBackground.evaluate(
        () => (window as any).__audios.filter((a: HTMLAudioElement) => !a.paused).length,
      ),
    )
    .toBe(1);
  const positions = await Promise.all([
    background().evaluate(
      () => (window as any).__audios.find((a: HTMLAudioElement) => !a.paused).currentTime,
    ),
    listenerBackground.evaluate(
      () => (window as any).__audios.find((a: HTMLAudioElement) => !a.paused).currentTime,
    ),
  ]);
  expect(Math.abs(positions[0] - positions[1])).toBeLessThan(0.8);
  const revision = await page.evaluate(
    () => (window as any).hostData.metadata['app.resonance/transport'].revision,
  );
  await listenerPage.evaluate(() =>
    (window as any).sendAsSelf({ type: 'command', role: 'GM', command: { type: 'stopAll' } }),
  );
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(
      () => (window as any).hostData.metadata['app.resonance/transport'].revision,
    ),
  ).toBe(revision);
  await listener.getByRole('slider', { name: 'Personal volume', exact: true }).focus();
  await listener.getByRole('slider', { name: 'Personal volume', exact: true }).press('Home');
  await listener.getByRole('slider', { name: 'Personal volume', exact: true }).press('ArrowRight');
  await expect
    .poll(() =>
      listenerBackground.evaluate(
        () => (window as any).__audios.find((a: HTMLAudioElement) => !a.paused).volume,
      ),
    )
    .toBeLessThan(0.1);
  expect(
    await background().evaluate(
      () => (window as any).__audios.find((a: HTMLAudioElement) => !a.paused).volume,
    ),
  ).toBeGreaterThan(0.5);
  expect(
    await page.evaluate(
      () => (window as any).hostData.metadata['app.resonance/transport'].revision,
    ),
  ).toBe(revision);
  await gm.getByRole('button', { name: 'Play A Quiet Place', exact: true }).click();
  await expect
    .poll(() =>
      background().evaluate(
        () => (window as any).__audios.filter((a: HTMLAudioElement) => !a.paused).length,
      ),
    )
    .toBe(2);
  await page.evaluate(() => (window as any).hideDesk());
  await page.waitForTimeout(3000);
  expect(
    await background().evaluate(
      () => (window as any).__audios.filter((a: HTMLAudioElement) => !a.paused).length,
    ),
  ).toBe(1);
  expect(
    await background().evaluate(() =>
      (window as any).__audios.some((a: HTMLAudioElement) =>
        a.getAttribute('src')?.endsWith('archive.wav'),
      ),
    ),
  ).toBe(false);
  expect(
    await background().evaluate(() =>
      (window as any).__audios.some((a: HTMLAudioElement) => !a.paused && a.currentTime > 1),
    ),
  ).toBe(true);
  await page.evaluate(() => (window as any).showDesk());
  await expect(
    page.frameLocator('#desk').getByRole('heading', { name: 'A Quiet Place', exact: true }),
  ).toBeVisible();
  await page
    .frameLocator('#desk')
    .getByRole('button', { name: 'Pause music', exact: true })
    .click();
  await expect
    .poll(() =>
      listenerBackground.evaluate(
        () => (window as any).__audios.filter((a: HTMLAudioElement) => !a.paused).length,
      ),
    )
    .toBe(0);
});
