import puppeteer, { Browser, Page } from 'puppeteer-core';
import { ChromeSession } from './chrome-session';
import { RouteLogger } from './route-logger';

let activeBrowser: Browser | null = null;
let activePage: Page | null = null;
const defaultLogger = new RouteLogger('browser-setup');

// Export this function so it can be used elsewhere if needed
export async function getDebuggerUrl(logger: RouteLogger = defaultLogger): Promise<string> {
    logger.log('attempting to get debugger url...');
    try {
        const response = await fetch('http://127.0.0.1:9222/json/version');
        if (!response.ok) {
            logger.error(`failed to get debugger url: ${response.status} ${response.statusText}`);
            throw new Error('failed to get fresh websocket url');
        }
        const data = await response.json() as { webSocketDebuggerUrl: string };
        const wsUrl = data.webSocketDebuggerUrl.replace('ws://localhost:', 'ws://127.0.0.1:');
        logger.log('got debugger url: ' + wsUrl);
        return wsUrl;
    } catch (error) {
        logger.error(`failed to fetch debugger url: ${error}`);
        throw error;
    }
}

// we rely on an existing or newly launched chrome instance
export async function setupBrowser(logger: RouteLogger = defaultLogger): Promise<{ browser: Browser; page: Page }> {
    logger.log('checking for existing browser...');
    if (!activeBrowser) {
        const session = ChromeSession.getInstance();
        let wsUrl: string;
        
        try {
            wsUrl = session.getWsUrl() || await getDebuggerUrl(logger);
            logger.log(`attempting to connect using ws url: ${wsUrl}`);
        } catch (error) {
            logger.error(`failed to get ws url: ${error}`);
            throw error;
        }

        let retries = 5;
        let lastError;

        while (retries > 0) {
            try {
                logger.log(`connection attempt ${6 - retries}...`);
                logger.log('waiting 2s before connection attempt...');
                await new Promise(resolve => setTimeout(resolve, 2000));

                logger.log('connecting to browser...');
                activeBrowser = await puppeteer.connect({
                    browserWSEndpoint: wsUrl,
                    defaultViewport: null,
                });
                session.setActiveBrowser(activeBrowser);
                logger.log('browser connected successfully');

                logger.log('waiting 2s before getting pages...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                logger.log('getting browser pages...');
                let pages = await activeBrowser.pages();
                logger.log(`found ${pages.length} pages`);

                // Find LinkedIn page or create new one without closing others
                logger.log('searching for linkedin or blank page...');
                let linkedinPage = pages.find(page => {
                    const url = page.url();
                    logger.log(`checking page url: ${url}`);
                    return url.startsWith('https://www.linkedin.com') || url === 'about:blank';
                });

                if (linkedinPage) {
                    logger.log('found existing linkedin or blank page, reusing it');
                    activePage = linkedinPage;
                    if (linkedinPage.url() === 'about:blank') {
                        logger.log('using blank page for linkedin');
                    }
                    logger.log('bringing page to front...');
                    await activePage.bringToFront();
                    logger.log('brought linkedin page to front');
                } else {
                    logger.log('creating new tab for linkedin');
                    activePage = await activeBrowser.newPage();
                    logger.log('new page created');
                    logger.log('bringing page to front...');
                    await activePage.bringToFront();
                    logger.log('new tab created and brought to front');
                }
                
                logger.log('setting active page in session...');
                session.setActivePage(activePage);
                logger.log('browser setup complete');
                break;
            } catch (error) {
                lastError = error;
                logger.error(`connection attempt ${6 - retries} failed with error: ${error}`);
                if (error instanceof Error) {
                    logger.error(`error stack: ${error.stack}`);
                }
                retries--;
                
                if (retries > 0) {
                    try {
                        logger.log('attempting to get fresh ws url...');
                        wsUrl = await getDebuggerUrl(logger);
                        logger.log(`got fresh ws url for retry: ${wsUrl}`);
                    } catch (wsError) {
                        logger.error(`failed to get fresh ws url: ${wsError}`);
                    }
                    
                    logger.log(`retrying in 2s... (${retries} attempts left)`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        if (!activeBrowser) {
            logger.error(`all connection attempts failed. last error: ${lastError}`);
            throw new Error(`failed to connect to browser after 5 attempts: ${lastError}`);
        }
    } else {
        logger.log('using existing browser connection');
    }

    if (!activeBrowser || !activePage) {
        logger.error('browser or page not properly initialized');
        throw new Error('browser or page not initialized');
    }

    logger.log('setup browser completed successfully');
    return { browser: activeBrowser, page: activePage };
}

// helper to return the active browser and page
export function getActiveBrowser() {
    const session = ChromeSession.getInstance();
    return { 
        browser: session.getActiveBrowser(),
        page: session.getActivePage() 
    };
}

// used to disconnect puppeteer if desired
export async function quitBrowser(logger: RouteLogger = defaultLogger) {
    ChromeSession.getInstance().clear();
    if (activeBrowser) {
        try {
            await activeBrowser.disconnect();
            logger.log('browser disconnected');
        } catch (error) {
            logger.error(`error disconnecting browser: ${error}`);
        }
        activeBrowser = null;
        activePage = null;
        logger.log('browser session cleared');
    }
}