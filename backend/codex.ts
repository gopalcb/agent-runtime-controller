/** Own the Codex subprocess and its correlated, non-retrying JSON-RPC calls. */
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

export interface Transport {
  start(): Promise<void>;
  request(method: string, params?: any): Promise<any>;
  close(): void;
}

export type ApprovalResult = { decision: 'accept' | 'decline' };
export type ServerRequest = (method: string, params: any) => Promise<ApprovalResult>;
export type Notice = (method: string, params: any) => void;

type PendingRequest = {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export const APPROVAL_METHODS: readonly string[] = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
];

const INTEGRATION_KINDS = ['mcp_servers', 'plugins'];

/** Adapt the sibling orchestration service's stdio protocol, with scoped ownership. */
export class CodexTransport implements Transport {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, PendingRequest>();
  private readonly disabledFeatures = [
    'apps',
    'plugins',
    'remote_plugin',
    'browser_use',
    'computer_use',
    'hooks',
    'multi_agent',
    'skill_mcp_dependency_install',
  ];

  constructor(
    private root: string,
    private notice: Notice,
    private disconnected: (reason: string) => void,
    private executable = process.env.VISUAL_BUILDER_CODEX_BINARY || 'codex',
    private timeout = 30000,
    private serverRequest?: ServerRequest,
  ) {}

  /** Inspect inherited integrations, disable them, then verify the effective config. */
  async start() {
    if (this.child) return;

    try {
      // Probe configuration without creating a thread or running model tools.
      await this.connect([]);
      const initial = (
        await this.request('config/read', {
          cwd: this.root,
          includeLayers: false,
        })
      ).config;

      if (!initial || typeof initial !== 'object') {
        throw new Error('Cannot inspect effective Codex configuration');
      }

      const overrides: string[] = [];
      for (const kind of INTEGRATION_KINDS) {
        const names = Object.keys(initial[kind] || {});
        if (names.length) {
          const disabled = names.map((name) => JSON.stringify(name) + '={enabled=false}');
          overrides.push('-c', `${kind}={${disabled.join(',')}}`);
        }
      }

      this.close();
      await this.connect(overrides);
      const effective = (
        await this.request('config/read', {
          cwd: this.root,
          includeLayers: false,
        })
      ).config;

      for (const kind of INTEGRATION_KINDS) {
        const inherited = Object.values(effective?.[kind] || {});
        if (inherited.some((entry: any) => entry?.enabled !== false)) {
          throw new Error('Inherited Codex integrations could not be disabled');
        }
      }

      if (this.disabledFeatures.some((name) => effective?.features?.[name] !== false)) {
        throw new Error('Codex integration feature isolation could not be verified');
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** Launch one isolated app-server and complete its initialization handshake. */
  private async connect(overrides: string[]) {
    const configuration = [
      'sandbox_mode="workspace-write"',
      'approval_policy="never"',
      'sandbox_workspace_write.network_access=false',
      'sandbox_workspace_write.writable_roots=[]',
      'sandbox_workspace_write.exclude_tmpdir_env_var=true',
      'sandbox_workspace_write.exclude_slash_tmp=true',
      'web_search="disabled"',
      ...this.disabledFeatures.map((name) => `features.${name}=false`),
    ];
    const child = spawn(
      this.executable,
      [
        'app-server',
        '--listen',
        'stdio://',
        ...configuration.flatMap((value) => ['-c', value]),
        ...overrides,
      ],
      {
        cwd: this.root,
        env: { ...process.env, RUNTIME_CONTROLLER_CHILD: '1' },
        stdio: 'pipe',
      },
    );
    this.child = child;

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && !message.method) {
          const id = String(message.id);
          const pending = this.pending.get(id);
          if (!pending) return;

          this.pending.delete(id);
          clearTimeout(pending.timer);
          if (message.error) {
            pending.reject(new Error(message.error.message || 'Codex RPC failed'));
          } else {
            pending.resolve(message.result);
          }
        } else if (message.id !== undefined) {
          void this.handleServerRequest(child, message);
        } else if (message.method) {
          this.notice(message.method, message.params || {});
        }
      } catch {
        this.notice('transport.warning', { message: 'Ignored malformed Codex protocol line' });
      }
    });

    // Drain stderr without persisting credentials or unrelated configuration.
    child.stderr.resume();
    child.stdin.on('error', (error) => {
      if (this.child === child) this.stop(error.message, true);
    });
    child.once('error', (error) => {
      if (this.child === child) this.stop(error.message, true);
    });
    child.once('exit', () => {
      lines.close();
      if (this.child === child) {
        this.stop('Codex process disconnected; execution outcome may be unknown', true);
      }
    });

    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'visual_agent_builder',
          title: 'Visual Agent Builder',
          version: '0.1.0',
        },
      });
      this.send({ method: 'initialized', params: {} });
    } catch (error) {
      if (this.child === child) this.close();
      throw error;
    }
  }

  /** Reply to supported one-shot approvals only while their subprocess is owned. */
  private async handleServerRequest(child: ChildProcessWithoutNullStreams, message: any) {
    try {
      if (!this.serverRequest || !APPROVAL_METHODS.includes(message.method)) {
        throw new Error('Interactive request unsupported by this local builder');
      }

      const result = await this.serverRequest(message.method, message.params || {});
      if (!['accept', 'decline'].includes(result?.decision)) {
        throw new Error('Unsupported approval decision');
      }
      if (this.child === child) this.send({ id: message.id, result });
    } catch {
      if (this.child === child) {
        this.send({
          id: message.id,
          error: { code: -32601, message: 'Interactive request rejected by this local builder' },
        });
        this.notice('request.rejected', { method: message.method });
      }
    }
  }

  /** Write one protocol message to the currently owned subprocess. */
  private send(message: any) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('Codex is not connected');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  /** Correlate one request; timeout or disconnect never automatically retries it. */
  request(method: string, params: any = {}): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out; request was not retried`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });

      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** Release the process and every waiter before announcing unexpected disconnects. */
  private stop(reason: string, notify = false) {
    const child = this.child;
    this.child = undefined;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    child?.kill();

    if (notify) this.disconnected(reason);
  }

  /** Close the owned connection without reporting an unexpected disconnect. */
  close() {
    this.stop('Codex connection closed');
  }
}
