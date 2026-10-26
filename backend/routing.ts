/** HTTP endpoints, local request guards, and Angular routes for the selected project. */
import { spawnSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  INestApplication,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import express, { Request, Response, RequestHandler } from 'express';
import { chromium } from 'playwright';

import { listDocuments, readDocument } from './documents';
import { Projects } from './projects';
import { active } from './types';

/** Build route handlers that resolve the current project at request time. */
export function createApiModule(projects: Projects, url: string) {
  const startedAt = Date.now();
  const cli = spawnSync(process.env.VISUAL_BUILDER_CODEX_BINARY || 'codex', ['--version'], {
    timeout: 2000,
    encoding: 'utf8',
    maxBuffer: 4096,
  });
  const codex =
    cli.status === 0
      ? { status: 'available', version: cli.stdout.trim().slice(0, 100) }
      : { status: 'unavailable' };
  const identity = () => ({
    service: 'runtime-controller',
    version: '0.2.0',
    pid: process.pid,
    url,
    preferredUrl: 'http://localhost.runtime-controller:1001',
    project: projects.session.project,
  });

  // Read the current session on every request; never retain a switched-out store.
  const state = () => {
    const session = projects.session;
    return {
      project: session.project,
      projects: projects.list,
      instructions: session.store.state.instructions,
      runs: session.store.state.runs,
      events: session.store.state.events,
      settings: session.store.state.settings,
      approvals: session.runtime.approvals,
      installation: session.installation.read(),
      controller: identity(),
      health: {
        server: { status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) },
        project: { status: 'ok', root: session.store.root },
        codex,
        browser: { status: existsSync(chromium.executablePath()) ? 'available' : 'unavailable' },
        memory: { rssBytes: process.memoryUsage().rss },
      },
      runtime: { status: session.runtime.status },
      browser: { open: session.browser.open, liveOpen: session.liveBrowser.open },
    };
  };
  const bootstrap = () => ({ ...state(), token: projects.token });

  @Controller('api')
  class ApiController {
    @Get('identity')
    identity() {
      return identity();
    }

    @Get('bootstrap')
    bootstrap() {
      return bootstrap();
    }

    @Get('state')
    state() {
      return state();
    }

    @Get('documents')
    documents() {
      return listDocuments(projects.session.store.root);
    }

    @Get('documents/content')
    document(@Query('path') path?: string) {
      return readDocument(projects.session.store.root, path);
    }

    @Get('projects/folders')
    folders(@Query('path') path?: string) {
      return projects.folders(path);
    }

    @Post('projects/register')
    @HttpCode(200)
    register(@Body() body: { path?: unknown }) {
      return projects.register(body?.path);
    }

    @Post('projects/switch')
    @HttpCode(200)
    async switch(@Body() body: { path?: unknown }) {
      await projects.switch(body?.path);
      return bootstrap();
    }

    @Post('install')
    @HttpCode(202)
    install(@Body() body: { action?: unknown }) {
      if (projects.session.store.state.runs.some(active)) {
        throw new ConflictException('Finish the active run before installation');
      }
      return projects.session.installation.start(body?.action);
    }

    @Post('settings')
    @HttpCode(200)
    settings(@Body() body: unknown) {
      return projects.session.store.updateSettings(body);
    }

    @Post('approvals/:id')
    @HttpCode(200)
    approval(@Param('id') id: string, @Body() body: unknown) {
      return projects.session.runtime.respondApproval(id, body);
    }

    @Post('instructions')
    add(@Body() body: unknown) {
      return projects.session.store.add(body);
    }

    @Delete('instructions/:id')
    remove(@Param('id') id: string) {
      return projects.session.store.remove(id);
    }

    @Post('browser')
    @HttpCode(200)
    async launch() {
      const session = projects.session;
      const result = await session.browser.launch();
      session.store.event('browser.opened', 'Interactive work item canvas opened');
      return result;
    }

    @Post('browser/url')
    @HttpCode(200)
    async launchUrl(@Body() body: { url?: unknown }) {
      return projects.session.liveBrowser.launch(body?.url);
    }

    @Post('execute')
    execute(@Body() body: unknown) {
      if (
        projects.session.installation.running ||
        projects.session.installation.read().status !== 'completed'
      ) {
        throw new ConflictException('Complete project installation before executing work items');
      }
      return projects.session.runtime.execute(body);
    }

    @Post('runs/:id/cancel')
    @HttpCode(200)
    cancel(@Param('id') id: string) {
      return projects.session.runtime.cancel(id);
    }
  }

  @Module({ controllers: [ApiController] })
  class AppModule {}
  return AppModule;
}

/** Reject cross-origin, stale-project, or unauthorized writes before route dispatch. */
function createRequestGuard(projects: Projects, port: number): RequestHandler {
  const allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `localhost.runtime-controller:${port}`,
    'localhost.runtime-controller:1001',
    '127.0.0.1:1001',
    'localhost:1001',
    '127.0.0.1:4311',
    'localhost:4311',
  ]);
  const allowedOrigins = new Set([...allowedHosts].map((host) => `http://${host}`));

  return (req, res, next) => {
    if (!allowedHosts.has(req.headers.host || '')) {
      res.status(403).json({ message: 'Untrusted host' });
      return;
    }
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
      res.status(403).json({ message: 'Untrusted origin' });
      return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ message: 'Cross-site requests denied' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'",
    );
    if (
      req.path !== '/api/bootstrap' &&
      req.headers['x-project-id'] &&
      req.headers['x-project-id'] !== projects.session.project.id
    ) {
      res.status(409).json({
        code: 'project_changed',
        message: 'Project changed in another window; reload the selected project',
      });
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (projects.busy) {
        res.status(409).json({ message: 'Project switch in progress; retry after it finishes' });
        return;
      }
      const given = req.headers['x-builder-token'];
      const token = projects.token;
      if (
        typeof given !== 'string' ||
        Buffer.byteLength(given) !== Buffer.byteLength(token) ||
        !timingSafeEqual(Buffer.from(given), Buffer.from(token))
      ) {
        res.status(403).json({ message: 'Session token required; reload the controller' });
        return;
      }
      if (req.method !== 'DELETE' && !req.is('application/json')) {
        res.status(415).json({ message: 'JSON required' });
        return;
      }
    }
    next();
  };
}

/** Guard requests before parsing JSON; disable implicit index serving so root redirects work. */
export function configureHttp(app: INestApplication, projects: Projects, port: number): void {
  app.use(createRequestGuard(projects, port));
  app.use(express.json({ limit: '64kb' }));
  const server = app.getHttpAdapter().getInstance();
  const assets = resolve(__dirname, '../frontend/dist/browser');
  if (existsSync(assets)) {
    server.use(express.static(assets, { index: false }));
    for (const [from, to] of Object.entries({
      '/': '/controller/agent-runtime',
      '/history': '/controller/history',
      '/settings': '/controller/settings',
      '/observability': '/controller/observability',
      '/canvas': '/controller/canvas',
      '/controller': '/controller/agent-runtime',
    })) {
      server.get(from, (_req: Request, res: Response) => res.redirect(302, to));
    }
    server.get(
      [
        '/controller/agent-runtime',
        '/controller/history',
        '/controller/work-docs',
        '/controller/settings',
        '/controller/observability',
        '/controller/install',
        '/controller/canvas',
      ],
      (_req: Request, res: Response) => res.sendFile(resolve(assets, 'index.html')),
    );
  }
}
