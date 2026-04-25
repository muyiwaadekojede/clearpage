import sparticuzChromium from '@sparticuz/chromium';
import type { Browser, LaunchOptions } from 'playwright';

declare global {
  // eslint-disable-next-line no-var
  var __clearpageBrowser: Browser | undefined;
}

type PlaywrightLike = {
  chromium: {
    launch: (options?: LaunchOptions) => Promise<Browser>;
  };
};

type SparticuzChromiumLike = {
  args?: string[];
  headless?: boolean | 'shell';
  executablePath: () => Promise<string>;
};

let playwrightModule: PlaywrightLike | null | undefined;
const sparticuzModule = sparticuzChromium as unknown as SparticuzChromiumLike;
let lastBrowserError: string | null = null;
let launchMode: 'default' | 'sparticuz' | null = null;

function loadPlaywright(): PlaywrightLike | null {
  if (playwrightModule !== undefined) {
    return playwrightModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    playwrightModule = require('playwright') as PlaywrightLike;
  } catch (error) {
    console.error('Playwright require failed:', error);
    lastBrowserError = error instanceof Error ? error.message : String(error);
    playwrightModule = null;
  }

  return playwrightModule;
}

function looksLikeMissingBrowserBinary(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.toLowerCase().includes("executable doesn't exist") ||
    message.toLowerCase().includes('failed to launch') ||
    message.toLowerCase().includes('browser executable')
  );
}

async function launchWithSparticuz(playwright: PlaywrightLike): Promise<Browser | null> {
  if (!sparticuzModule || typeof sparticuzModule.executablePath !== 'function') {
    return null;
  }

  const executablePath = await sparticuzModule.executablePath();
  if (!executablePath) {
    return null;
  }

  return playwright.chromium.launch({
    headless: sparticuzModule.headless === false ? false : true,
    executablePath,
    args: sparticuzModule.args ?? [],
  });
}

export async function getBrowser(): Promise<Browser | null> {
  const playwright = loadPlaywright();
  if (!playwright) {
    return null;
  }

  try {
    if (!global.__clearpageBrowser || !global.__clearpageBrowser.isConnected()) {
      if (process.env.VERCEL) {
        const sparticuzBrowser = await launchWithSparticuz(playwright);
        if (sparticuzBrowser) {
          global.__clearpageBrowser = sparticuzBrowser;
          launchMode = 'sparticuz';
        } else {
          global.__clearpageBrowser = await playwright.chromium.launch({ headless: true });
          launchMode = 'default';
        }
      } else {
        try {
          global.__clearpageBrowser = await playwright.chromium.launch({ headless: true });
          launchMode = 'default';
        } catch (primaryError) {
          const shouldTrySparticuz = looksLikeMissingBrowserBinary(primaryError);

          if (!shouldTrySparticuz) {
            throw primaryError;
          }

          const fallbackBrowser = await launchWithSparticuz(playwright);
          if (!fallbackBrowser) {
            throw primaryError;
          }

          global.__clearpageBrowser = fallbackBrowser;
          launchMode = 'sparticuz';
        }
      }
    }
    lastBrowserError = null;
    return global.__clearpageBrowser;
  } catch (error) {
    console.error('Playwright browser launch failed:', error);
    lastBrowserError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export function getBrowserRuntimeState(): {
  playwrightModuleLoaded: boolean;
  sparticuzModuleLoaded: boolean;
  lastBrowserError: string | null;
  launchMode: 'default' | 'sparticuz' | null;
} {
  return {
    playwrightModuleLoaded: Boolean(playwrightModule),
    sparticuzModuleLoaded: Boolean(sparticuzModule && typeof sparticuzModule.executablePath === 'function'),
    lastBrowserError,
    launchMode,
  };
}
