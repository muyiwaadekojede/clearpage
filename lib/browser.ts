import type { Browser } from 'playwright';

declare global {
  // eslint-disable-next-line no-var
  var __clearpageBrowser: Browser | undefined;
}

let playwrightModule: { chromium: { launch: (opts: { headless: boolean }) => Promise<Browser> } } | null | undefined;

function loadPlaywright():
  | { chromium: { launch: (opts: { headless: boolean }) => Promise<Browser> } }
  | null {
  if (playwrightModule !== undefined) {
    return playwrightModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    playwrightModule = require('playwright') as {
      chromium: { launch: (opts: { headless: boolean }) => Promise<Browser> };
    };
  } catch (error) {
    console.error('Playwright require failed:', error);
    playwrightModule = null;
  }

  return playwrightModule;
}

export async function getBrowser(): Promise<Browser | null> {
  const playwright = loadPlaywright();
  if (!playwright) {
    return null;
  }

  try {
    if (!global.__clearpageBrowser || !global.__clearpageBrowser.isConnected()) {
      global.__clearpageBrowser = await playwright.chromium.launch({ headless: true });
    }
    return global.__clearpageBrowser;
  } catch (error) {
    console.error('Playwright browser launch failed:', error);
    return null;
  }
}
