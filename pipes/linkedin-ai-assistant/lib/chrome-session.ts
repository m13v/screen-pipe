import { promises as fs } from 'fs';
import path from 'path';
import { Page, Browser } from 'puppeteer-core';
import { RouteLogger } from './route-logger';

const logger = new RouteLogger('chrome-session');
const SESSION_FILE = path.join(process.cwd(), 'lib', 'storage', 'chrome-session.json');

export class ChromeSession {
    private static instance: ChromeSession;
    private wsUrl: string | null = null;
    private isConnected: boolean = false;
    private activePage: Page | null = null;
    private activePageId: string | null = null;
    private activeBrowser: Browser | null = null;
    private savePromise: Promise<void> | null = null;
    private loadPromise: Promise<void> | null = null;

    private constructor() {
        // Load state immediately
        this.loadState();
    }

    static getInstance(): ChromeSession {
        if (!ChromeSession.instance) {
            ChromeSession.instance = new ChromeSession();
        }
        return ChromeSession.instance;
    }

    private async loadState() {
        if (this.loadPromise) {
            await this.loadPromise;
            return;
        }

        this.loadPromise = (async () => {
            logger.log(`loading state from: ${SESSION_FILE}`);
            try {
                const data = await fs.readFile(SESSION_FILE, 'utf-8');
                const state = JSON.parse(data);
                
                if (state.wsUrl && typeof state.wsUrl === 'string') {
                    this.wsUrl = state.wsUrl;
                    this.isConnected = true;
                }
                
                logger.log(`state loaded: wsUrl=${this.wsUrl}, connected=${this.isConnected}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                    logger.log('no saved state found');
                } else {
                    logger.error(`failed to load state: ${err}`);
                }
            } finally {
                this.loadPromise = null;
            }
        })();

        return this.loadPromise;
    }

    private async saveState() {
        if (this.savePromise) {
            await this.savePromise;
            return;
        }

        this.savePromise = (async () => {
            const state = {
                wsUrl: this.wsUrl,
                isConnected: this.isConnected,
                activePageId: this.activePageId
            };

            try {
                await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
                await fs.writeFile(SESSION_FILE, JSON.stringify(state, null, 2));
                logger.log(`state saved: wsUrl=${this.wsUrl}, connected=${this.isConnected}`);
            } catch (err) {
                logger.error(`failed to save state: ${err}`);
            } finally {
                this.savePromise = null;
            }
        })();

        return this.savePromise;
    }

    async setWsUrl(url: string) {
        if (!url) {
            logger.error('attempted to set null wsUrl');
            return;
        }

        if (this.wsUrl === url) {
            logger.log('wsUrl unchanged');
            return;
        }
        
        logger.log(`updating wsUrl: ${url}`);
        this.wsUrl = url;
        this.isConnected = true;
        await this.saveState();
    }

    getWsUrl(): string | null {
        return this.wsUrl;
    }

    setActivePage(page: Page) {
        this.activePage = page;
        // @ts-ignore - different puppeteer versions have different Target APIs
        this.activePageId = page.target()._targetId || page.target().id() || page.target().targetId();
        this.saveState();
    }

    getActivePage(): Page | null {
        this.validateConnection().catch(() => this.clear());
        return this.activePage;
    }

    getActivePageId(): string | null {
        return this.activePageId;
    }

    isActive(): boolean {
        return this.isConnected;
    }

    clear() {
        this.wsUrl = null;
        this.isConnected = false;
        this.activePage = null;
        this.activePageId = null;
        this.saveState();
        logger.log('chrome session cleared');
    }

    setActiveBrowser(browser: Browser) {
        this.activeBrowser = browser;
        this.isConnected = true;
        this.saveState();
    }

    getActiveBrowser(): Browser | null {
        this.validateConnection().catch(() => this.clear());
        return this.activeBrowser;
    }

    async validateConnection(): Promise<boolean> {
        if (!this.activeBrowser || !this.activePage) {
            return false;
        }

        try {
            // Test if browser is still connected
            const pages = await this.activeBrowser.pages();
            if (!pages.length || this.activePage.isClosed()) {
                this.clear();
                return false;
            }
            return true;
        } catch (error) {
            logger.error(`browser connection validation failed: ${error}`);
            this.clear();
            return false;
        }
    }
} 