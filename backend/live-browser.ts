/** Open local apps in an isolated browser and validate overlay bridge calls. */
import { lookup } from 'node:dns/promises';

import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Browser, BrowserContext, Page, chromium, Frame } from 'playwright';

import { installLiveOverlay } from './live-overlay';
import { evidenceUrl, localUrl } from './reference';
import { ProjectStore } from './store';

type BindingSource = { page: Page; frame: Frame; context: BrowserContext };

/** Target pages never receive the dashboard's API token. */
export class LiveBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private origin = '';
  private opening = false;
  private closing = false;

  constructor(
    private store: ProjectStore,
    private options: { headless?: boolean } = {},
  ) {}

  get busy() {
    return this.opening;
  }

  get open() {
    return !!this.page && !this.page.isClosed();
  }

  /** Reuse the current page or replace its isolated context for another target. */
  async launch(value: unknown) {
    const url = localUrl(value);
    if (url.hostname === 'localhost.runtime-controller') {
      const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
      if (
        !addresses.length ||
        addresses.some((address) => !['127.0.0.1', '::1'].includes(address.address))
      ) {
        throw new BadRequestException(
          'Configure localhost.runtime-controller to resolve to loopback before opening it',
        );
      }
    }

    if (this.closing) throw new ConflictException('Builder is shutting down');
    if (this.opening) throw new ConflictException('A local app is already opening');

    this.opening = true;
    try {
      if (this.page && !this.page.isClosed() && this.page.url() === url.href) {
        await this.page.bringToFront();
        return { open: true, url: evidenceUrl(url.href) };
      }

      await this.context?.close();
      this.page = undefined;
      this.context = undefined;

      if (!this.browser?.isConnected()) {
        const browser = await chromium.launch({
          headless: this.options.headless ?? false,
          args: ['--window-size=1280,800'],
        });
        if (this.closing) {
          await browser.close();
          throw new Error('Builder is shutting down');
        }

        this.browser = browser;
        browser.on('disconnected', () => {
          if (this.browser !== browser) return;
          this.browser = undefined;
          this.page = undefined;
          this.context = undefined;
        });
      }

      const context = await this.browser.newContext({
        viewport: null,
        serviceWorkers: 'block',
        acceptDownloads: false,
        bypassCSP: true,
      });
      this.context = context;
      this.origin = url.origin;

      await context.route('**/*', async (route) => {
        const request = route.request();
        const leavesApp =
          request.isNavigationRequest() &&
          request.frame().parentFrame() === null &&
          new URL(request.url()).origin !== url.origin;
        if (leavesApp) await route.abort('blockedbyclient');
        else await route.continue();
      });
      await context.exposeBinding('__formaVisual', (source, message) =>
        this.receive(source, message),
      );
      await context.addInitScript(installLiveOverlay, { origin: url.origin });

      const page = await context.newPage();
      this.page = page;
      context.on('page', (popup) => {
        if (popup !== this.page) void popup.close().catch(() => {});
      });

      const response = await page.goto(url.href, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      if (response && response.status() >= 400) {
        throw new Error(`The app returned HTTP ${response.status()}`);
      }
      await page.locator('[data-forma-visual-root]').waitFor({ timeout: 5000 });

      this.store.event('browser.url.opened', 'Opened local app: ' + evidenceUrl(url.href));
      return { open: true, url: evidenceUrl(url.href) };
    } catch (error: any) {
      await this.context?.close().catch(() => {});
      this.context = undefined;
      this.page = undefined;

      const message = String(error.message || '');
      const detail = message.includes('HTTP ')
        ? String(error.message)
        : 'Check that the app is running and the URL is reachable. Playwright Chromium and a desktop session are required.';
      throw new ServiceUnavailableException('Could not open the local app. ' + detail);
    } finally {
      this.opening = false;
    }
  }

  /** Validate the caller independently of the evidence supplied by the page. */
  receive(source: BindingSource, message: any) {
    if (
      !this.page ||
      source.page !== this.page ||
      source.frame !== this.page.mainFrame() ||
      new URL(source.frame.url()).origin !== this.origin
    ) {
      throw new BadRequestException('Selection is limited to the opened app and its main frame');
    }
    if (!message || typeof message !== 'object' || JSON.stringify(message).length > 24000) {
      throw new BadRequestException('Invalid visual instruction');
    }

    if (message.action === 'list') {
      const instructions = this.store.state.instructions
        .filter((item) => item.source && new URL(item.source.url).origin === this.origin)
        .map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          status: item.status,
          source: { url: item.source!.url, selector: item.source!.selector },
        }));
      return { instructions };
    }
    if (message.action !== 'save') {
      throw new BadRequestException('Unsupported visual instruction action');
    }

    return this.store.add({
      title: message.title,
      description: message.description,
      rect: message.element?.rect,
      viewport: message.element?.viewport,
      source: {
        ...message.element,
        kind: 'element',
        url: evidenceUrl(source.frame.url()),
      },
    });
  }

  /** Close all owned contexts and prevent a concurrent launch from publishing one. */
  async close() {
    this.closing = true;
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.context = undefined;
    this.page = undefined;
    this.browser = undefined;
  }
}
