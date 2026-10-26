/** Own the selected project session and keep recent-project registration separate from activation. */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { ProjectStore } from './store';
import { Runtime } from './runtime';
import { VisualBrowser } from './browser';
import { LiveBrowser } from './live-browser';
import { Installation } from './installation';
import { active } from './types';
import { writeJsonAtomic } from './state-file';

type Project = { id: string; name: string; root: string };
type Session = {
  store: ProjectStore;
  runtime: Runtime;
  browser: VisualBrowser;
  liveBrowser: LiveBrowser;
  installation: Installation;
  project: Project;
};
export class Projects {
  session: Session;
  token = randomBytes(32).toString('hex');
  private known: Project[] = [];
  private registry: string;
  private changing = false;

  get busy() {
    return this.changing;
  }

  /** Open the initial project and load its bounded recent-project registry. */
  constructor(
    root: string,
    private url: string,
  ) {
    this.session = this.createSession(root);
    try {
      const directory = join(this.session.store.root, '.codex', 'runtime-controller');
      if (
        existsSync(directory) &&
        (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())
      ) {
        throw new Error('Unsafe controller directory');
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      this.registry = join(directory, 'projects.json');
      if (existsSync(this.registry)) {
        this.assertRegistryFile();
        const value = JSON.parse(readFileSync(this.registry, 'utf8'));
        if (!Array.isArray(value)) {
          throw new Error('Invalid project registry');
        }
        this.known = value
          .filter((p) => p && typeof p.root === 'string')
          .slice(0, 100)
          .flatMap((p) => {
            try {
              return [this.describeProject(p.root)];
            } catch {
              // A previously registered project may have moved or been removed.
              return [];
            }
          });
      }
      this.remember(this.session.project);
    } catch (error) {
      this.session.store.close();
      throw error;
    }
  }

  /** Derive a stable identity from an existing canonical directory. */
  private describeProject(root: string): Project {
    const canonical = realpathSync(root);
    if (!lstatSync(canonical).isDirectory()) {
      throw new BadRequestException('Select a project directory');
    }
    return {
      id: createHash('sha256').update(canonical).digest('hex').slice(0, 24),
      name: canonical.split(/[\\/]/).filter(Boolean).pop() || canonical,
      root: canonical,
    };
  }

  /** Give each project its own store, agent runtime, installer, and capture browsers. */
  private createSession(root: string): Session {
    const project = this.describeProject(root);
    const store = new ProjectStore(project.root);
    return {
      project,
      store,
      runtime: new Runtime(store),
      browser: new VisualBrowser(this.url),
      liveBrowser: new LiveBrowser(store),
      installation: new Installation(store.root, Number(new URL(this.url).port)),
    };
  }

  /** Refuse linked, oversized, or non-regular registry files. */
  private assertRegistryFile() {
    const stat = lstatSync(this.registry);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) {
      throw new Error('Unsafe project registry');
    }
  }

  /** Persist the most recently selected or registered projects without duplicates. */
  private remember(project: Project) {
    const next = [project, ...this.known.filter((p) => p.id !== project.id)].slice(0, 100);
    if (existsSync(this.registry)) {
      this.assertRegistryFile();
    }
    writeJsonAtomic(this.registry, next);
    this.known = next;
  }

  get list() {
    return [...this.known];
  }

  /** Translate invalid folder input into a useful HTTP error. */
  private validateProject(value: unknown) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 4096 ||
      /[\u0000-\u001f]/.test(value)
    ) {
      throw new BadRequestException('Select an existing project folder');
    }
    try {
      return this.describeProject(value);
    } catch {
      throw new BadRequestException('Project folder is unavailable or not a directory');
    }
  }

  /** Remember a folder without creating its runtime or changing the selected project. */
  register(value: unknown) {
    const project = this.validateProject(value);
    this.remember(project);
    return { projects: this.list, project };
  }

  /** List visible child folders for the local project picker. */
  folders(value?: string) {
    const project = this.validateProject(value || homedir());
    try {
      const folders = readdirSync(project.root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 250)
        .map((e) => ({ name: e.name, path: join(project.root, e.name) }));
      return {
        path: project.root,
        parent: dirname(project.root) === project.root ? null : dirname(project.root),
        folders,
      };
    } catch {
      throw new BadRequestException('Cannot read this directory');
    }
  }

  /** Prepare the next session, close the old one, then publish a fresh mutation token. */
  async switch(value: unknown) {
    if (this.changing) {
      throw new ConflictException('A project switch is already in progress');
    }
    if (
      this.session.store.state.runs.some(active) ||
      this.session.installation.running ||
      this.session.installation.read().status === 'installing' ||
      this.session.browser.busy ||
      this.session.liveBrowser.busy
    ) {
      throw new ConflictException(
        'Finish the active run or installation before switching projects',
      );
    }
    const project = this.validateProject(value);
    if (project.id === this.session.project.id) {
      return;
    }

    this.changing = true;
    let next: Session | undefined;
    try {
      next = this.createSession(project.root);
      this.remember(project);

      // Closing capture contexts before publication prevents late saves into a new project.
      await this.close();
      this.session = next;
      next = undefined;
      this.token = randomBytes(32).toString('hex');
      this.session.store.event('project.selected', 'Selected project ' + project.name);
    } finally {
      if (next) {
        next.runtime.close();
        next.store.close();
      }
      this.changing = false;
    }
  }

  /** Close capture and installer workers before releasing the project lock. */
  async close() {
    await this.session.browser.close();
    await this.session.liveBrowser.close();
    await this.session.installation.close();
    this.session.runtime.close();
    this.session.store.close();
  }
}
