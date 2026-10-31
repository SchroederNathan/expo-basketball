import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = mkdtempSync(join(tmpdir(), 'curtain-gpu-'));
let browser;
try {
  const entry = join(temporary, 'check.ts');
  writeFileSync(entry, `
    import { checkCurtainGpu } from ${JSON.stringify(join(root, 'scripts/curtain/gpu-check.ts'))};
    import { checkUnsupportedWeb } from ${JSON.stringify(join(root, 'scripts/curtain/web-check.tsx'))};
    try {
      const results = [...await checkCurtainGpu(), await checkUnsupportedWeb()];
      document.body.textContent = JSON.stringify({ ok: true, results });
    } catch (error) {
      document.body.textContent = JSON.stringify({ ok: false, error: String(error?.stack ?? error) });
    }
  `);
  const bundle = await Bun.build({ entrypoints: [entry], target: 'browser', outdir: temporary });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  browser = await chromium.launch({
    executablePath: process.env.CURTAIN_CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://curtain.test/**', async (route) => {
    if (route.request().url().endsWith('.js')) {
      await route.fulfill({ contentType: 'text/javascript', body: readFileSync(join(temporary, 'check.js')) });
    } else {
      await route.fulfill({ contentType: 'text/html', body: '<html><body><script type="module" src="./check.js"></script></body></html>' });
    }
  });
  await page.goto('https://curtain.test/');
  await page.waitForFunction(() => document.body.textContent.startsWith('{'), { timeout: 60000 });
  const result = JSON.parse(await page.locator('body').textContent());
  if (!result.ok || errors.length) throw new Error(JSON.stringify({ result, errors }, null, 2));
  console.log(result.results.join('\n'));
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
