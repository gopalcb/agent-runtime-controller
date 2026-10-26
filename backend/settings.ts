/** Validate project-local execution settings and translate them to Codex policies. */
import { BadRequestException } from '@nestjs/common';

export type Settings = {
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy: 'never' | 'on-request' | 'untrusted';
  model: string;
  reasoningEffort: '' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  networkAccess: boolean;
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sandbox: 'workspace-write',
  approvalPolicy: 'never',
  model: '',
  reasoningEffort: '',
  networkAccess: false,
});

/** Validate a complete plugin-local settings object; never edit inherited Codex config. */
export function settings(value: any): Settings {
  const expectedKeys = Object.keys(DEFAULT_SETTINGS);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(DEFAULT_SETTINGS, key)) ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new BadRequestException('A complete settings object is required');
  }

  if (
    !['read-only', 'workspace-write', 'danger-full-access'].includes(value.sandbox) ||
    !['never', 'on-request', 'untrusted'].includes(value.approvalPolicy)
  ) {
    throw new BadRequestException('Unsupported sandbox or approval policy');
  }

  if (
    typeof value.model !== 'string' ||
    value.model.length > 160 ||
    (value.model.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value.model.trim()))
  ) {
    throw new BadRequestException('Model must be an identifier, at most 160 characters');
  }

  if (
    !['', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value.reasoningEffort) ||
    typeof value.networkAccess !== 'boolean'
  ) {
    throw new BadRequestException('Unsupported reasoning effort or network setting');
  }

  if (value.sandbox === 'danger-full-access' && !value.networkAccess) {
    throw new BadRequestException(
      'Full access cannot restrict network access; explicitly enable network access',
    );
  }

  return {
    sandbox: value.sandbox,
    approvalPolicy: value.approvalPolicy,
    model: value.model.trim(),
    reasoningEffort: value.reasoningEffort,
    networkAccess: value.networkAccess,
  };
}

/** Express the selected access mode without inheriting additional writable roots. */
export function sandboxPolicy(value: Settings, root: string) {
  if (value.sandbox === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (value.sandbox === 'read-only')
    return { type: 'readOnly', networkAccess: value.networkAccess };

  return {
    type: 'workspaceWrite',
    writableRoots: [root],
    networkAccess: value.networkAccess,
    excludeTmpdirEnvVar: true,
    excludeSlashTmp: true,
  };
}
