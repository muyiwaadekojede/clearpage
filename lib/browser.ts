import type { Browser } from 'playwright';

declare global {
  // eslint-disable-next-line no-var
  var __clearpageBrowser: Browser | undefined;
}

let playwrightModulePromise: Promise<typeof import('playwright') | null> | null = null;

async function loadPlaywright(): Promise<typeof import('playwright') | null> {
  if (!playwrightModulePromise) {
    playwrightModulePromise = import('playwright').catch((error) => {
      console.error('Playwright import failed:', error);
      return null;
    });
  }

  return playwrightModulePromise;
}

export async function getBrowser(): Promise<Browser | null> {
  const playwright = await loadPlaywright();
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
