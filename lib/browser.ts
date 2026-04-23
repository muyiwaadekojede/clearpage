import { Browser, chromium } from 'playwright';

declare global {
  // eslint-disable-next-line no-var
  var __clearpageBrowser: Browser | undefined;
}

export async function getBrowser(): Promise<Browser> {
  if (!global.__clearpageBrowser || !global.__clearpageBrowser.isConnected()) {
    global.__clearpageBrowser = await chromium.launch({ headless: true });
  }

  return global.__clearpageBrowser;
}
