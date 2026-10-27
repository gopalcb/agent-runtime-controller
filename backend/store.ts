/** Persist work items, settings, runs, and activity under an exclusively owned project. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { active, Instruction, State } from './types';
import { elementSource } from './reference';
import { DEFAULT_SETTINGS, settings } from './settings';
import { writeJsonAtomic } from './state-file';

/** Owns one canonical project and one atomic state file. Never accepts paths from HTTP. */
export class ProjectStore {
  readonly root: string;
  readonly directory: string;
  readonly project: { name: string; root: string };
  state: State;
  private lock: string;
  private lockId = randomUUID();

  /** Resolve the project, acquire its lock, and mark unfinished runs as interrupted. */
  constructor(project: string) {
    this.root = realpathSync(project);
    if (!lstatSync(this.root).isDirectory()) {
      throw new Error('Project must be a directory');
    }
    this.project = { name: basename(this.root), root: this.root };
    for (const directory of [
      join(this.root, '.codex'),
      join(this.root, '.codex', 'visual-builder'),
    ]) {
      if (
        existsSync(directory) &&
        (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory())
      ) {
        throw new Error('Refusing unsafe project state directory: ' + directory);
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    this.directory = join(this.root, '.codex', 'visual-builder');
    this.lock = join(this.directory, 'owner.lock');
    if (existsSync(this.lock)) {
      this.assertFile(this.lock);
      const owner = JSON.parse(readFileSync(this.lock, 'utf8'));
      if (!Number.isInteger(owner.pid) || owner.pid < 1) {
        throw new Error('Invalid state lock; inspect owner.lock');
      }
      try {
        process.kill(owner.pid, 0);
        throw new Error('A builder already owns this project');
      } catch (error: any) {
        if (error.code !== 'ESRCH') {
          throw error;
        }
      }
      throw new Error(
        'Stale builder lock found. Confirm the previous builder stopped, then remove ' +
          this.lock +
          ' and restart.',
      );
    }
    const fd = openSync(this.lock, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, id: this.lockId }));
    } finally {
      closeSync(fd);
    }
    try {
      const filename = join(this.directory, 'state.json');
      this.state = existsSync(filename)
        ? this.readState(filename)
        : { version: 1, settings: { ...DEFAULT_SETTINGS }, instructions: [], runs: [], events: [] };
      for (const run of this.state.runs.filter(active)) {
        run.status = 'interrupted';
        for (const entry of run.activity || []) {
          if (entry.status === 'inProgress') entry.status = 'interrupted';
        }
        run.finishedAt = new Date().toISOString();
        run.error = 'Server stopped before completion. Inspect project changes before retrying.';
        for (const item of this.state.instructions.filter((i) =>
          run.instructionIds.includes(i.id),
        )) {
          item.status = 'failed';
        }
      }
      const instructionsPath = join(this.directory, 'AGENTS.md');
      if (existsSync(instructionsPath)) {
        this.assertFile(instructionsPath);
      }
      if (!existsSync(instructionsPath)) {
        writeFileSync(
          instructionsPath,
          '# Visual builder agent\n\nWork only in the bound project. Follow its AGENTS.md. Implement visual instructions using Angular and NestJS, preserving existing conventions and unrelated work. Validate relevant behavior and report unrun checks.\n',
          { flag: 'wx', mode: 0o600 },
        );
      }
      this.save();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** Reject links and non-regular files before reading or replacing project state. */
  private assertFile(path: string) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
      throw new Error('Refusing unsafe state file');
    }
  }

  /** Load the supported state shape and migrate missing settings to safe defaults. */
  private readState(path: string): State {
    this.assertFile(path);
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (
      state.version !== 1 ||
      !Array.isArray(state.instructions) ||
      !Array.isArray(state.runs) ||
      !Array.isArray(state.events)
    ) {
      throw new Error('Unsupported or corrupt project state');
    }
    state.settings =
      state.settings === undefined ? { ...DEFAULT_SETTINGS } : settings(state.settings);
    return state;
  }

  /** Validate settings once and record the change for future runs. */
  updateSettings(value: unknown) {
    const validated = settings(value);
    this.state.settings = validated;
    this.event('settings.updated', 'Codex settings updated for future runs');
    return validated;
  }

  /** Atomically replace state only after checking the existing destination. */
  save() {
    const path = join(this.directory, 'state.json');
    if (existsSync(path)) {
      this.assertFile(path);
    }
    writeJsonAtomic(path, this.state);
  }

  /** Append bounded activity and persist the associated state change. */
  event(type: string, message: string, runId?: string) {
    this.state.events.push({
      id: randomUUID(),
      time: new Date().toISOString(),
      type,
      message: message.slice(0, 4000),
      runId,
    });
    this.state.events = this.state.events.slice(-1000);
    this.save();
  }

  /** Validate and save a pending instruction with optional sanitized element evidence. */
  add(value: any): Instruction {
    if (
      !value ||
      typeof value.title !== 'string' ||
      !value.title.trim() ||
      value.title.length > 160 ||
      typeof value.description !== 'string' ||
      !value.description.trim() ||
      value.description.length > 12000
    ) {
      throw new BadRequestException(
        'Title and description are required (160 / 12000 character limits)',
      );
    }

    const { rect, viewport } = value;
    if (
      !rect ||
      !viewport ||
      ![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(
        Number.isFinite,
      ) ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.width < 8 ||
      rect.height < 8 ||
      viewport.width > 10000 ||
      viewport.height > 10000 ||
      rect.x + rect.width > viewport.width + 1 ||
      rect.y + rect.height > viewport.height + 1
    ) {
      throw new BadRequestException('Rectangle must fit within its viewport and be at least 8 × 8');
    }

    const item: Instruction = {
      id: randomUUID(),
      title: value.title.trim(),
      description: value.description.trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: viewport.width, height: viewport.height },
      status: 'todo',
      createdAt: new Date().toISOString(),
    };
    if (value.source !== undefined) {
      item.source = elementSource(value.source);
    }

    this.state.instructions.push(item);
    this.event('instruction.saved', item.title);
    return item;
  }

  /** Remove an instruction unless an agent is currently working on it. */
  remove(id: string) {
    const item = this.state.instructions.find((i) => i.id === id);
    if (!item) {
      throw new BadRequestException('Instruction not found');
    }
    if (item.status === 'running') {
      throw new ConflictException('Cannot remove running instructions');
    }
    this.state.instructions = this.state.instructions.filter((i) => i.id !== id);
    this.event('instruction.removed', item.title);
    return { removed: true };
  }

  /** Release only the lock acquired by this store instance. */
  close() {
    if (existsSync(this.lock)) {
      this.assertFile(this.lock);
      if (JSON.parse(readFileSync(this.lock, 'utf8')).id === this.lockId) {
        rmSync(this.lock);
      }
    }
  }
}
