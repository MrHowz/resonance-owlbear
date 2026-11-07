import { expect, test, type Page } from '@playwright/test';

async function openDesk(page: Page) {
  await page.context().addInitScript(() => {
    const NativeAudio = window.Audio;
    (window as any).__audios = [];
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const audio = new target(...args);
        (window as any).__audios.push(audio);
        return audio;
      },
    });
  });
  await page.goto(`/tests/obr-host.html?room=faders-${Date.now()}`);
  const desk = page.frameLocator('#desk');
  await expect(desk.getByText('ROOM CONNECTED', { exact: true })).toBeVisible();
  await desk.getByRole('button', { name: 'Load demo library', exact: true }).click();
  await desk.getByRole('button', { name: 'Play The Amber Archive', exact: true }).click();
  await expect(desk.getByRole('slider', { name: 'Music position', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const emit = (window as any).emitAll;
    (window as any).emitAll = (id: string, data: unknown) => {
      if (id === 'OBR_ROOM_METADATA_EVENT_CHANGE' || id.startsWith('OBR_BROADCAST_MESSAGE_'))
        setTimeout(() => emit(id, data), 400);
      else emit(id, data);
    };
  });
  return desk;
}

test('both room faders follow the pointer and update sound during the drag without a command backlog', async ({
  page,
}) => {
  const desk = await openDesk(page);
  for (const bus of ['Music', 'Ambience']) {
    const slider = desk.getByRole('slider', { name: `${bus} room volume`, exact: true });
    await slider.scrollIntoViewIfNeeded();
    const rect = (await slider.boundingBox())!,
      y = rect.y + rect.height / 2;
    const start = Date.now();
    await page.mouse.move(rect.x + rect.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.7, y, { steps: 30 });
    const preview = Number(await slider.inputValue());
    expect(preview).toBeGreaterThan(0.6);
    const stored = () =>
      page.evaluate(
        (bus) =>
          (window as any).hostData.metadata['app.resonance/transport'][bus.toLowerCase()].gain,
        bus,
      );
    await expect.poll(stored).toBeCloseTo(preview, 3); // Already shared BEFORE release.
    await page.waitForTimeout(550);
    expect(Number(await slider.inputValue())).toBe(preview);
    const text = await slider.evaluate(
      (el) => el.closest('.smooth-slider')!.querySelector('.slider-value')!.textContent,
    );
    expect(text).toBe(`${Math.round(preview * 100)}%`);
    await page.mouse.move(rect.x + rect.width * 0.7, y + 35);
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(Number(await slider.inputValue())).toBe(preview);
    const commands = await page.evaluate(
      (bus) =>
        (window as any).hostData.log.filter(
          (m: any) =>
            m.id === 'OBR_BROADCAST_SEND_MESSAGE' &&
            m.data.data.type === 'command' &&
            m.data.data.command.type === 'gain' &&
            m.data.data.command.bus === bus.toLowerCase(),
        ).length,
      bus,
    );
    expect(commands).toBeLessThanOrEqual(Math.ceil((Date.now() - start) / 100) + 2);
  }
  await expect
    .poll(() =>
      page
        .frame({ url: /background\.html/ })!
        .evaluate(() => (window as any).__audios.find((a: HTMLAudioElement) => !a.paused).volume),
    )
    .toBeLessThan(0.55);
});

test('personal master and every settings fader stay independent through delayed status messages', async ({
  page,
}) => {
  const desk = await openDesk(page);
  const writes = await page.evaluate(() => (window as any).hostData.writes);
  const master = desk.getByRole('slider', { name: 'Personal volume', exact: true });
  await master.focus();
  await master.press('Home');
  await master.press('ArrowRight');
  expect(Number(await master.inputValue())).toBe(0.01);
  await desk.getByRole('button', { name: 'Audio settings', exact: true }).click();
  for (const [key, amount] of [
    ['music', 0.1],
    ['ambience', 0.2],
    ['sfx', 0.3],
  ] as const) {
    const slider = desk.getByRole('slider', { name: `Personal ${key} volume`, exact: true });
    await slider.focus();
    await slider.press('Home');
    for (let i = 0; i < amount * 10; i++) await slider.press('PageUp');
    expect(Number(await slider.inputValue())).toBeCloseTo(amount, 3);
  }
  await page.waitForTimeout(900);
  const saved = await page
    .frame({ url: /background\.html/ })!
    .evaluate(() => JSON.parse(localStorage.getItem('resonance-preferences')!));
  expect(saved).toMatchObject({
    master: 0.01,
    music: 0.1,
    ambience: 0.2,
    sfx: 0.3,
    muted: false,
    fade: 2.5,
  });
  for (const [key, amount] of [
    ['music', 0.1],
    ['ambience', 0.2],
    ['sfx', 0.3],
  ] as const)
    expect(
      Number(
        await desk
          .getByRole('slider', { name: `Personal ${key} volume`, exact: true })
          .inputValue(),
      ),
    ).toBeCloseTo(amount, 3);
  expect(await page.evaluate(() => (window as any).hostData.writes)).toBe(writes);
  await expect
    .poll(() =>
      page
        .frame({ url: /background\.html/ })!
        .evaluate(() => (window as any).__audios.find((a: HTMLAudioElement) => !a.paused).volume),
    )
    .toBeCloseTo(0.0008, 4);
});

test('touch volume drag is live, cancel restores the initial level, and small layouts fit', async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 480, height: 850 },
    baseURL: 'http://127.0.0.1:5173',
  });
  try {
    const page = await context.newPage();
    const desk = await openDesk(page);
    const slider = desk.getByRole('slider', { name: 'Personal volume', exact: true });
    const initial = Number(await slider.inputValue());
    const rect = (await slider.boundingBox())!,
      y = rect.y + rect.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: rect.x + rect.width * 0.8, y, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: rect.x + rect.width * (0.8 - (0.65 * step) / 8), y, id: 1 }],
      });
      await page.waitForTimeout(20);
    }
    const preview = Number(await slider.inputValue());
    expect(preview).toBeLessThan(0.3);
    await expect
      .poll(() =>
        page
          .frame({ url: /background\.html/ })!
          .evaluate(() => (window as any).__audios.find((a: HTMLAudioElement) => !a.paused).volume),
      )
      .toBeLessThan(0.25);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(async () => Number(await slider.inputValue())).toBe(initial);
    await expect
      .poll(() =>
        page
          .frame({ url: /background\.html/ })!
          .evaluate(() => JSON.parse(localStorage.getItem('resonance-preferences')!).master),
      )
      .toBe(initial);
    await desk.getByRole('button', { name: 'Audio settings', exact: true }).click();
    for (const width of [480, 375, 320]) {
      await page.setViewportSize({ width, height: 850 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        await page
          .frame({ url: /\/\?obrref=/ })!
          .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
    }
  } finally {
    await context.close();
  }
});
