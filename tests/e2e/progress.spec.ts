import { expect, test, type Page } from '@playwright/test';

async function openPlayer(page: Page) {
  await page.goto(`/tests/obr-host.html?room=progress-${Date.now()}`);
  const desk = page.frameLocator('#desk');
  await expect(desk.getByText('ROOM CONNECTED', { exact: true })).toBeVisible();
  await desk.getByRole('button', { name: 'Load demo library', exact: true }).click();
  await desk.getByRole('button', { name: 'Play The Amber Archive', exact: true }).click();
  const slider = desk.getByRole('slider', { name: 'Music position', exact: true });
  await expect(slider).toBeEnabled();
  return { desk, slider };
}

async function seekCommands(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as any).hostData.log.filter(
        (m: any) =>
          m.id === 'OBR_BROADCAST_SEND_MESSAGE' &&
          m.data.data.type === 'command' &&
          m.data.data.command.type === 'seek',
      ).length,
  );
}

test('progress follows display frames without room writes or library rerenders, then freezes on pause', async ({
  page,
}) => {
  const { desk, slider } = await openPlayer(page);
  const writes = await page.evaluate(() => (window as any).hostData.writes);
  const desktop = page.frame({ url: /\/\?obrref=/ })!;
  await desktop.evaluate(() => {
    (window as any).__libraryMutations = 0;
    new MutationObserver((records) => {
      (window as any).__libraryMutations += records.length;
    }).observe(document.querySelector('.track-table')!, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
    });
  });
  const sampled = await slider.evaluate(async (element) => {
    const input = element as HTMLInputElement;
    const samples: number[] = [],
      start = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        samples.push(Number(input.value));
        if (performance.now() - start < 1000) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return {
      count: samples.length,
      distinct: new Set(samples).size,
      advance: samples.at(-1)! - samples[0],
    };
  });
  expect(sampled.count).toBeGreaterThan(15);
  expect(sampled.distinct / sampled.count).toBeGreaterThan(0.8);
  expect(sampled.advance).toBeGreaterThan(0.8);
  expect(await desktop.evaluate(() => (window as any).__libraryMutations)).toBe(0);
  expect(await page.evaluate(() => (window as any).hostData.writes)).toBe(writes);
  expect(await seekCommands(page)).toBe(0);
  await desk.getByRole('button', { name: 'Pause music', exact: true }).click();
  await expect(desk.getByRole('button', { name: 'Resume music', exact: true })).toBeEnabled();
  const paused = Number(await slider.inputValue());
  await page.waitForTimeout(600);
  expect(Number(await slider.inputValue())).toBeCloseTo(paused, 2);
  await desk.getByRole('button', { name: 'Resume music', exact: true }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(paused + 0.2);
  // The native slider and its readable value remain accessible to listeners/keyboard users.
  await expect(slider).toHaveAttribute('aria-valuetext', /of 0:16/);
});

test('drag previews locally through status refreshes, commits once on release, and holds through a delayed acknowledgement', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { desk, slider } = await openPlayer(page);
  await desk.getByRole('button', { name: 'Pause music', exact: true }).click();
  await expect(desk.getByRole('button', { name: 'Resume music', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const emit = (window as any).emitAll;
    (window as any).emitAll = (id: string, data: unknown) => {
      if (id === 'OBR_ROOM_METADATA_EVENT_CHANGE' || id.startsWith('OBR_BROADCAST_MESSAGE_'))
        setTimeout(() => emit(id, data), 650);
      else emit(id, data);
    };
  });
  const rect = (await slider.boundingBox())!;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(rect.x + rect.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.75, y, { steps: 18 });
  const preview = Number(await slider.inputValue());
  expect(preview).toBeGreaterThan(11);
  expect(preview).toBeLessThan(13);
  await expect(desk.locator('.seek-row .seek-preview')).toBeVisible();
  // Force the same local status report a fader/heartbeat would cause during a drag.
  await page.evaluate(() => (window as any).sendAsSelf({ type: 'hello' }));
  await page.waitForTimeout(750);
  expect(Number(await slider.inputValue())).toBeCloseTo(preview, 2);
  expect(await seekCommands(page)).toBe(0);
  // Pointer capture must also commit if the user releases outside the thin rail.
  await page.mouse.move(rect.x + rect.width * 0.75, y - 40);
  await page.mouse.up();
  await expect.poll(() => seekCommands(page)).toBe(1);
  expect(Number(await slider.inputValue())).toBeCloseTo(preview, 2);
  await page.waitForTimeout(1500);
  expect(Number(await slider.inputValue())).toBeCloseTo(preview, 2);
  expect(await seekCommands(page)).toBe(1);
  const stored = await page.evaluate(
    () => (window as any).hostData.metadata['app.resonance/transport'].music.position,
  );
  expect(stored).toBeCloseTo(preview, 2);
  await expect(desk.locator('.seek-row .seek-preview')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('keyboard seeks once per gesture, Escape cancels, and a track change clears the preview', async ({
  page,
}) => {
  const { desk, slider } = await openPlayer(page);
  await desk.getByRole('button', { name: 'Pause music', exact: true }).click();
  await expect(desk.getByRole('button', { name: 'Resume music', exact: true })).toBeEnabled();
  await slider.focus();
  await slider.press('Home');
  await expect.poll(() => seekCommands(page)).toBe(1);
  await expect.poll(async () => Number(await slider.inputValue())).toBe(0);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ArrowRight');
  expect(Number(await slider.inputValue())).toBe(3);
  await page.waitForTimeout(250);
  expect(await seekCommands(page)).toBe(1);
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => seekCommands(page)).toBe(2);
  await page.keyboard.down('PageUp');
  expect(Number(await slider.inputValue())).toBe(13);
  await slider.press('Escape');
  await page.keyboard.up('PageUp');
  await page.waitForTimeout(250);
  expect(await seekCommands(page)).toBe(2);
  expect(Number(await slider.inputValue())).toBe(3);
  await desk.getByRole('button', { name: 'Play A Quiet Place', exact: true }).click();
  await expect(desk.getByRole('heading', { name: 'A Quiet Place', exact: true })).toBeVisible();
  await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(2);
});

test('touch drag commits once and a cancelled touch leaves the room position intact', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 480, height: 850 },
    baseURL: 'http://127.0.0.1:5173',
  });
  try {
    const page = await context.newPage();
    const { desk, slider } = await openPlayer(page);
    await desk.getByRole('button', { name: 'Pause music', exact: true }).click();
    await expect(desk.getByRole('button', { name: 'Resume music', exact: true })).toBeEnabled();
    const rect = (await slider.boundingBox())!,
      y = rect.y + rect.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: rect.x + rect.width * 0.2, y, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: rect.x + rect.width * 0.65, y, id: 1 }],
    });
    const preview = Number(await slider.inputValue());
    expect(preview).toBeGreaterThan(8);
    expect(await seekCommands(page)).toBe(0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => seekCommands(page)).toBe(1);
    await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(preview, 2);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: rect.x + rect.width * 0.8, y, id: 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: rect.x + rect.width * 0.35, y, id: 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(250);
    expect(await seekCommands(page)).toBe(1);
    expect(Number(await slider.inputValue())).toBeCloseTo(preview, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});
