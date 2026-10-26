/** Launch and observe the Python installer without duplicating its deployment rules. */
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { BadRequestException, ConflictException } from '@nestjs/common';

export type InstallState = {
  status: 'not-installed' | 'installing' | 'completed' | 'failed';
  progress: number;
  steps: { id: string; label: string; status: string; message?: string }[];
  error?: string;
  version?: string;
};
/** Python owns deployment/state; this bridge only schedules and observes one worker. */
export class Installation {
  private child?: ChildProcess;
  private failure?: string;
  constructor(
    readonly root: string,
    private port = 10101,
  ) {}

  get running() {
    return !!this.child;
  }

  /** Read bounded worker progress and report interrupted installations as retryable failures. */
  read(): InstallState {
    if (this.failure) {
      return { status: 'failed', progress: 0, steps: [], error: this.failure };
    }
    const directory = join(this.root, '.codex', 'runtime-controller');
    const path = join(directory, 'install.json');
    try {
      if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) {
        throw new Error('Unsafe installer directory');
      }
      if (!existsSync(path)) {
        return { status: this.running ? 'installing' : 'not-installed', progress: 0, steps: [] };
      }
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
        throw new Error('Unsafe installer status');
      }
      const state = JSON.parse(readFileSync(path, 'utf8'));
      if (
        !['not-installed', 'installing', 'completed', 'failed'].includes(state.status) ||
        !Array.isArray(state.steps) ||
        !Number.isFinite(state.progress)
      ) {
        throw new Error('Invalid installer status');
      }
      if (state.status === 'installing' && !this.running && Number.isInteger(state.ownerPid)) {
        try {
          process.kill(state.ownerPid, 0);
        } catch {
          return {
            ...state,
            status: 'failed',
            error: 'Installation was interrupted. Retry to recover safely.',
          };
        }
      }
      return { ...state, progress: Math.max(0, Math.min(100, state.progress)) };
    } catch {
      return {
        status: 'failed',
        progress: 0,
        steps: [],
        error:
          'Installer status is unreadable or unsafe. Inspect the project runtime-controller directory.',
      };
    }
  }

  /** Check lifecycle transitions, then let one Python worker own installation and progress. */
  start(action: unknown): InstallState {
    if (!['install', 'retry', 'reinstall', 'reset'].includes(String(action))) {
      throw new BadRequestException('Choose install, retry, reinstall or reset');
    }
    if (this.running) {
      throw new ConflictException('Installation is already running');
    }
    const before = this.read();
    if (before.status === 'installing') {
      throw new ConflictException('Installation is already running for this project');
    }
    if (['reinstall', 'reset'].includes(String(action)) && before.status !== 'completed') {
      throw new ConflictException('Reset and reinstall are available after installation completes');
    }
    if (action === 'install' && before.status === 'completed') {
      throw new ConflictException('Installation is complete; use reset or reinstall');
    }
    if (action === 'retry' && before.status !== 'failed') {
      throw new ConflictException(
        'Retry is only available for an interrupted or failed installation',
      );
    }

    this.failure = undefined;
    const child = spawn(
      process.env.RUNTIME_CONTROLLER_PYTHON || 'python3',
      ['-m', 'installer', '--project', this.root, '--action', String(action)],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, PYTHONUNBUFFERED: '1', RUNTIME_CONTROLLER_PORT: String(this.port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    this.child = child;

    // Worker persists bounded sanitized progress. Never mirror arbitrary stderr to API/logs.
    child.stdout?.resume();
    child.stderr?.resume();
    child.once('error', () => {
      if (this.child === child) {
        this.child = undefined;
        this.failure = 'Could not start Python installer. Install Python 3.10+ and retry.';
      }
    });
    child.once('exit', (code) => {
      if (this.child === child) {
        this.child = undefined;
        if (code !== 0 && this.read().status !== 'failed') {
          this.failure =
            'Installer stopped before completion. Inspect installation progress and retry.';
        }
      }
    });
    return { status: 'installing', progress: 0, steps: [] };
  }

  /** Ask the owned worker to stop, with a bounded forced-termination fallback. */
  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    await new Promise<void>((resolveClose) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolveClose();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolveClose();
      });
      child.kill('SIGTERM');
    });
    this.child = undefined;
  }
}
