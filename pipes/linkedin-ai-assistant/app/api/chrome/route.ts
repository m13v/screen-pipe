import { NextResponse } from 'next/server';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { setupBrowser, getActiveBrowser, quitBrowser } from '@/lib/browser-setup';
import os from 'os';
import { ChromeSession } from '@/lib/chrome-session';
import { RouteLogger } from '@/lib/route-logger';
import type { Page } from 'puppeteer-core';
// import { pipe } from "@screenpipe/js";

const logger = new RouteLogger('chrome-route');

const execPromise = promisify(exec);

// helper to get chrome path based on platform
function getChromePath() {
  switch (os.platform()) {
    case "darwin": {
      const isArm = os.arch() === 'arm64';
      logger.log(`mac architecture: ${os.arch()}`);
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    }
    case "linux":
      return "/usr/bin/google-chrome";
    case "win32":
      return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    default:
      throw new Error("unsupported platform");
  }
}

interface ScreenDimensions {
    width: number;
    height: number;
}

function getScreenDimensions(requestDims?: ScreenDimensions) {
    const defaultDims = { width: 2560, height: 1440 };
    
    if (requestDims) {
        logger.log(`using client screen dimensions: ${requestDims.width}x${requestDims.height}`);
        return requestDims;
    }
    
    logger.log(`no dimensions provided, using defaults: ${defaultDims.width}x${defaultDims.height}`);
    return defaultDims;
}

export async function POST(request: Request) {
    logger.log('handling POST request in /api/chrome');
    try {
        const body = await request.json();
        const { url } = body;

        // if url is provided, handle navigation
        if (url) {
            logger.log(`browser setup`);
            const { page } = await setupBrowser(logger);
            logger.log('browser setup complete, starting navigation');
            
            // Actually navigate to the page
            const result = await navigateToPage(page, url);
            logger.log(`navigation complete, status: ${result.status}, final url: ${result.finalUrl}`);
            
            return NextResponse.json({
                success: true,
                status: result.status,
                finalUrl: result.finalUrl,
                logs: logger.getLogs()
            });
        }

        // otherwise handle chrome launch
        const screenDims = getScreenDimensions(body.screenDims);
        const additionalFlags = [
          '--remote-debugging-port=9222',
          '--restore-last-session',
          '--no-first-run',
          '--no-default-browser-check',
          `--window-position=${screenDims.width / 2},0`,
          `--window-size=${screenDims.width / 2},${screenDims.height}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-background-networking',
          '--disable-features=TranslateUI',
          '--disable-features=IsolateOrigins',
          '--disable-site-isolation-trials',
        ].flat();
        // Log environment info
        logger.log(`environment: ${process.env.NODE_ENV}`);
        logger.log(`current platform: ${os.platform()}`);
        logger.log(`system architecture: ${os.arch()}`);
        logger.log(`cpu info: ${JSON.stringify(os.cpus()[0], null, 2)}`);

        logger.log("checking for existing chrome instance...");
        let wsUrl: string | null = null;
        try {
          const response = await fetch('http://127.0.0.1:9222/json/version');
          if (response.ok) {
            const data = await response.json() as { webSocketDebuggerUrl: string };
            wsUrl = data.webSocketDebuggerUrl.replace('ws://localhost:', 'ws://127.0.0.1:');
            logger.log(`found existing chrome instance at ${wsUrl}`);
          } else {
            logger.log('no existing chrome instance found, launching a new one');
          }
        } catch (error) {
          logger.error(`error checking for existing chrome instance: ${error}`);
          logger.log('launching a new chrome instance');
        }

        if (!wsUrl) {
          logger.log("attempting to launch chrome");
          logger.log("killing existing chrome instances...");
          await quitChrome(); // only kill if we are about to launch a new one
          await quitBrowser(logger);

          const chromePath = getChromePath();
          logger.log(`using chrome path: ${chromePath}`);
          logger.log(`checking if chrome exists: ${require('fs').existsSync(chromePath)}`);

          logger.log("spawning chrome with debugging port 9222...");
          const isArmMac = os.platform() === 'darwin' && os.arch() === 'arm64';
          const spawnCommand = isArmMac ? 'arch' : chromePath;
          const spawnArgs = isArmMac ? [
            '-arm64',
            chromePath,
            ...additionalFlags
          ] : [
            ...additionalFlags
          ];

          const chromeProcess = spawn(spawnCommand, spawnArgs, {
            detached: true,
            stdio: 'ignore'
          });

          chromeProcess.unref();
          logger.log("chrome process spawned and detached");

          logger.log("waiting for chrome to initialize...");
          await new Promise(resolve => setTimeout(resolve, 3000));

          let attempts = 0;
          const maxAttempts = 5;
          logger.log(`attempting to connect to debug port (max ${maxAttempts} attempts)`);

          while (attempts < maxAttempts) {
            try {
              logger.log(`connection attempt ${attempts + 1}/${maxAttempts}`);
              const response = await fetch('http://127.0.0.1:9222/json/version');
              const data = await response.json();

              if (response.ok && data.webSocketDebuggerUrl) {
                logger.log('chrome debug port responding');
                wsUrl = data.webSocketDebuggerUrl.replace('ws://localhost:', 'ws://127.0.0.1:');
                logger.log(`websocket url: ${wsUrl}`);
                await ChromeSession.getInstance().setWsUrl(wsUrl!);
                break;
              }
            } catch (err) {
              logger.error(`attempt ${attempts + 1} failed: ${err}`);
            }
            attempts++;
            logger.log(`waiting 1s before retry ${attempts}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          if (!wsUrl) {
            throw new Error('failed to connect to chrome debug port after all attempts');
          }
        }

        return NextResponse.json({
          success: true,
          wsUrl,
          logs: logger.getLogs()
        });
    } catch (err) {
        logger.error(`operation failed: ${err}`);
        return NextResponse.json({
            success: false,
            error: 'operation failed',
            details: err instanceof Error ? err.message : String(err),
            logs: logger.getLogs()
        }, { status: 500 });
    }
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action');
        
        switch (action) {
            case 'status':
                logger.log('checking chrome connection status...');
                const storedUrl = ChromeSession.getInstance().getWsUrl();
                logger.log(`stored url from session: ${storedUrl}`);

                try {
                    const response = await fetch('http://127.0.0.1:9222/json/version');
                    const data = await response.json();
                    const wsUrl = data.webSocketDebuggerUrl;

                    if (wsUrl) {
                        logger.log('chrome connected, getting websocket url');
                        // Update session with new URL if different
                        if (storedUrl !== wsUrl) {
                            await ChromeSession.getInstance().setWsUrl(wsUrl);
                        }
                        logger.log(`websocket url: ${wsUrl}`);
                        return NextResponse.json({ 
                            status: 'connected',
                            wsUrl,
                            logs: logger.getLogs()
                        });
                    }
                } catch (error) {
                    logger.log('chrome not running or not responding');
                    ChromeSession.getInstance().clear();
                }

                return NextResponse.json({ 
                    status: 'disconnected',
                    logs: logger.getLogs()
                });
                
            case 'check-login':
                const isLoggedIn = await checkLoginStatus();
                return NextResponse.json({
                    success: true,
                    isLoggedIn,
                    logs: logger.getLogs()
                });
                
            default:
                return NextResponse.json(
                    { error: 'invalid action' },
                    { status: 400 }
                );
        }
    } catch (error) {
        logger.error(`operation failed: ${error}`);
        return NextResponse.json({
            success: false,
            error: 'operation failed',
            details: error instanceof Error ? error.message : String(error),
            logs: logger.getLogs()
        }, { status: 500 });
    }
}

// Helper functions
async function navigateToPage(page: Page, url: string) {
    try {
        logger.log('starting navigation');
        logger.log(`target url: ${url}`);

        // Simplified navigation - remove waitUntil and timeout for now
        logger.log('navigating to page (simplified settings)...');
        const response = await page.goto(url); // Basic navigation
        logger.log(`navigation response status: ${response?.status() || 0}`);

        // Wait for the main content to load - keep this part for now
        logger.log('waiting for content to load...');
        try {
            await Promise.race([
                page.waitForSelector('body', { timeout: 30000 }),
                page.waitForSelector('#artdeco-global-alert-container', { timeout: 30000 }),
                page.waitForSelector('.authentication-outlet', { timeout: 30000 })
            ]);
            logger.log('content loaded');
        } catch (err) {
            logger.log('timeout waiting for content, but continuing...');
        }

        // Store the page in ChromeSession after successful navigation
        ChromeSession.getInstance().setActivePage(page);
        logger.log('page stored in chrome session');

        return {
            status: response?.status() || 0,
            finalUrl: page.url()
        };

    } catch (error) {
        logger.error(`navigation error: ${error}`);
        logger.error(`full navigation error object: ${JSON.stringify(error, null, 2)}`); // Log full error

        // Take a screenshot on error
        try {
            logger.log('taking screenshot of failed navigation...');
            await page.screenshot({ path: 'navigation-error.png' }); // Save screenshot
            logger.log('screenshot saved to navigation-error.png');
        } catch (screenshotError) {
            logger.error(`error taking screenshot: ${screenshotError}`);
        }


        // Try to continue even if there's an error
        ChromeSession.getInstance().setActivePage(page);
        return {
            status: 0,
            finalUrl: page.url()
        };
    }
}

async function checkLoginStatus() {
    logger.log('checking linkedin login status');
    
    const { page } = getActiveBrowser();
    
    if (!page) {
        logger.log('no active browser session found');
        throw new Error('no active browser session');
    }

    logger.log('evaluating login state...');
    // Check for elements that indicate logged-in state
    const isLoggedIn = await page.evaluate(() => {
        // Check for feed-specific elements that only appear when logged in
        const feedElements = document.querySelector('.scaffold-layout__main')
        const navElements = document.querySelector('.global-nav__me')
        
        // Return true if we find elements specific to logged-in state
        return !!(feedElements || navElements)
    });

    logger.log(`login status: ${isLoggedIn ? 'logged in' : 'logged out'}`);
    return isLoggedIn;
}

async function quitChrome() {
  const platform = os.platform();
  logger.log(`quitting chrome on platform: ${platform}`);
  const killCommand =
    platform === "win32"
      ? `taskkill /F /IM chrome.exe`
      : `pkill -f -- "Google Chrome"`;

  try {
    logger.log('executing kill command:', killCommand);
    await execPromise(killCommand);
    logger.log("chrome killed successfully");
  } catch (error) {
    logger.log("no chrome process found to kill", error);
  }
}

export async function DELETE() {
    logger.log('killing chrome process...');
    const chromeSession = ChromeSession.getInstance();
    
    try {
        const platform = process.platform;
        const cmd = platform === 'win32' 
            ? 'taskkill /F /IM chrome.exe'
            : 'pkill -f "(Google Chrome|chrome-debug)"';
            
        await execPromise(cmd);
        chromeSession.clear();
        
        logger.log('chrome process killed successfully');
        return NextResponse.json({ 
            success: true,
            logs: logger.getLogs() 
        });
    } catch (error) {
        // If error is ESRCH (no process found), that's fine
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            logger.log('no chrome process found to kill');
            return NextResponse.json({ 
                success: true,
                logs: logger.getLogs() 
            });
        }
        
        logger.error(`failed to kill chrome: ${error}`);
        return NextResponse.json({ 
            success: false,
            error: String(error),
            logs: logger.getLogs() 
        }, { status: 500 });
    }
}



