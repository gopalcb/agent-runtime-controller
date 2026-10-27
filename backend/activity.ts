/** Bounded, plain-text presentation of public agent activity; never persist raw payloads. */
import { Run } from './types';

const clean = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    : '';
const lines = (values: unknown[]) => values.map(clean).filter(Boolean).join('\n');

export function boundActivity(run: Run) {
  let remaining = 200000;
  const entries = run.activity || [];
  for (const entry of [...entries].reverse()) {
    const limit = Math.min(remaining, 30000);
    if (entry.text.length > limit) {
      entry.text = limit ? entry.text.slice(-limit) : '';
      run.activityTruncated = true;
    }
    remaining -= entry.text.length;
  }
  while (entries.length > 500) {
    entries.shift();
    run.activityTruncated = true;
  }
}

export function recordActivity(run: Run, method: string, params: any): boolean {
  if (method === 'turn/plan/updated') {
    if (
      !Array.isArray(params.plan) ||
      !params.plan.every(
        (step: any) =>
          typeof step?.step === 'string' &&
          ['pending', 'inProgress', 'completed'].includes(step.status),
      )
    )
      return false;
    run.plan = params.plan
      .slice(0, 100)
      .map((step: any) => ({ step: clean(step.step).slice(0, 2000), status: step.status }));
    run.planExplanation = clean(params.explanation).slice(0, 4000);
    return true;
  }
  const lifecycle = method === 'item/started' || method === 'item/completed';
  const deltaKinds: Record<string, string> = {
    'item/agentMessage/delta': 'agentMessage',
    'item/commandExecution/outputDelta': 'commandExecution',
    'item/fileChange/outputDelta': 'fileChange',
    'item/plan/delta': 'plan',
    'item/reasoning/summaryTextDelta': 'reasoning',
    'item/mcpToolCall/progress': 'mcpToolCall',
  };
  const item = params.item;
  const kind = lifecycle ? clean(item?.type) : deltaKinds[method];
  const id = lifecycle ? item?.id : params.itemId;
  if (!kind || typeof id !== 'string') return false;
  const entries = (run.activity ||= []);
  let entry = entries.find((entry) => entry.id === id);
  if (!entry) {
    entry = {
      id,
      time: new Date().toISOString(),
      kind,
      title: kind,
      text: '',
      status: 'inProgress',
    };
    entries.push(entry);
  }
  if (!lifecycle) {
    if (entry.status !== 'inProgress') return false;
    entry.text += clean(params.delta ?? params.message);
  } else {
    entry.status = method === 'item/completed' ? clean(item.status) || 'completed' : 'inProgress';
    entry.title = title(item);
    const body = content(item);
    // Final snapshots replace streamed content, preventing duplicate command/message output.
    if (body) entry.text = body;
  }
  boundActivity(run);
  return true;
}

function title(item: any): string {
  switch (item.type) {
    case 'commandExecution':
      return lines([
        `$ ${clean(item.command)}`,
        item.cwd ? `cwd: ${clean(item.cwd)}` : '',
        Number.isInteger(item.exitCode) ? `exit ${item.exitCode}` : '',
      ]).slice(0, 4000);
    case 'agentMessage':
      return 'codex';
    case 'reasoning':
      return 'Thinking';
    case 'fileChange':
      return 'File changes';
    case 'mcpToolCall':
      return `${clean(item.server)} / ${clean(item.tool)}`.slice(0, 4000);
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
      return `Tool · ${clean(item.tool)}`.slice(0, 4000);
    default:
      return clean(item.type).slice(0, 200);
  }
}

function content(item: any): string {
  switch (item.type) {
    case 'agentMessage':
    case 'plan':
      return clean(item.text);
    case 'commandExecution':
      return clean(item.aggregatedOutput);
    case 'reasoning':
      return lines(Array.isArray(item.summary) ? item.summary : []);
    case 'fileChange':
      return (Array.isArray(item.changes) ? item.changes : [])
        .map((change: any) =>
          lines([`${clean(change.kind?.type)} ${clean(change.path)}`, change.diff]),
        )
        .join('\n');
    case 'mcpToolCall':
      return lines([
        ...(Array.isArray(item.result?.content)
          ? item.result.content.map((part: any) => part.text)
          : []),
        item.error?.message,
      ]);
    case 'dynamicToolCall':
      return lines((item.contentItems || []).map((part: any) => part.text));
    case 'collabAgentToolCall':
      return Object.entries(item.agentsStates || {})
        .map(([id, state]: [string, any]) =>
          lines([`${id}: ${clean(state?.status)}`, state?.message]),
        )
        .join('\n');
    case 'functionCallOutput':
      return Array.isArray(item.output)
        ? lines(item.output.map((part: any) => part.text))
        : clean(item.output);
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return clean(item.review);
    case 'imageView':
      return clean(item.path);
    case 'webSearch':
      return clean(item.query);
    case 'subAgentActivity':
      return lines([item.kind, item.agentPath]);
    default:
      return '';
  }
}
