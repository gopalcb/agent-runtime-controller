/** Assemble the controller, own its shutdown, and optionally open the local dashboard. */
import 'reflect-metadata';
import { spawn } from 'node:child_process';

import { NestFactory } from '@nestjs/core';

import { Projects } from './projects';
import { configureHttp, createApiModule } from './routing';

type ApplicationOptions = { project: string; port: number };

/** Create an unbound application so tests and the CLI can manage the listening port. */
export async function createApplication(options: ApplicationOptions) {
  const url = `http://127.0.0.1:${options.port}`;
  const projects = new Projects(options.project, url);

  try {
    const app = await NestFactory.create(createApiModule(projects, url), {
      logger: ['error', 'warn'],
      bodyParser: false,
    });
    configureHttp(app, projects, options.port);
    await app.init();

    let closing = false;
    const close = async () => {
      if (closing) {
        return;
      }
      closing = true;
      await projects.close();
      await app.close();
    };

    return {
      app,
      projects,
      get store() {
        return projects.session.store;
      },
      get runtime() {
        return projects.session.runtime;
      },
      get browser() {
        return projects.session.browser;
      },
      get liveBrowser() {
        return projects.session.liveBrowser;
      },
      get installation() {
        return projects.session.installation;
      },
      get token() {
        return projects.token;
      },
      url,
      close,
    };
  } catch (error) {
    await projects.close();
    throw error;
  }
}

/** Bind to loopback and close owned resources when the process receives a stop signal. */
export async function start(options: ApplicationOptions & { open: boolean }) {
  const server = await createApplication(options);
  try {
    await server.app.listen(options.port, '127.0.0.1');
  } catch (error) {
    await server.close();
    throw error;
  }
  const route =
    server.installation.read().status === 'completed'
      ? '/controller/agent-runtime'
      : '/controller/install';
  console.log(`Runtime Controller: ${server.url}${route}\nProject: ${server.store.root}`);
  server.store.event('server.started', 'Controller started for ' + server.store.project.name);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void server.close().then(() => {
        process.exitCode = 0;
      });
    });
  }
  if (options.open) {
    const command =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer.exe'
          : 'xdg-open';
    const child = spawn(command, [server.url + route], { stdio: 'ignore' });
    child.on('error', () => console.log('Open the URL above in your browser.'));
  }
  return server;
}
