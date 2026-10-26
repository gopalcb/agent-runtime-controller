/** Own the separate Chromium window used to draw visual instructions. */
import { ServiceUnavailableException } from '@nestjs/common';
import { Browser, Page, chromium } from 'playwright';

export class VisualBrowser {
  private browser?: Browser;
  private canvas?: Page;
  private opening?: Promise<{ open: boolean }>;

  constructor(private url: string) {}

  get busy() {
    return !!this.opening;
  }

  get open() {
    return !!this.canvas && !this.canvas.isClosed();
  }

  /** Share an in-flight launch so repeated clicks open only one canvas. */
  launch() {
    if (this.opening) return this.opening;

    this.opening = this.create().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  private async create() {
    try {
      if (this.canvas && !this.canvas.isClosed()) {
        await this.canvas.bringToFront();
        return { open: true };
      }

      if (!this.browser?.isConnected()) {
        this.browser = await chromium.launch({
          headless: false,
          args: ['--window-size=1280,800'],
        });
        this.browser.on('disconnected', () => {
          this.canvas = undefined;
        });
      }

      this.canvas = await this.browser.newPage({ viewport: null });
      await this.canvas.goto(this.url + '/controller/canvas', {
        waitUntil: 'domcontentloaded',
      });
      return { open: true };
    } catch (error: any) {
      await this.close();
      throw new ServiceUnavailableException(
        'Unable to open the visual browser. Run npm exec playwright install chromium and ensure a desktop is available. ' +
          error.message.slice(0, 300),
      );
    }
  }

  /** Close only the browser owned by this controller. */
  async close() {
    await this.browser?.close();
    this.browser = undefined;
    this.canvas = undefined;
  }
}
