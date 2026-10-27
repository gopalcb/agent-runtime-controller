/** Project persistence and API contracts shared by storage, runtime and routes. */
import type { ElementSource } from './reference';
import type { Settings } from './settings';

export type { Settings } from './settings';

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type Approval = {
  id: string;
  runId: string;
  method: string;
  description: string;
  createdAt: string;
};

export type Rect = { x: number; y: number; width: number; height: number };

export type Instruction = {
  id: string;
  title: string;
  description: string;
  rect: Rect;
  source?: ElementSource;
  viewport: { width: number; height: number };
  status: 'todo' | 'running' | 'completed' | 'failed';
  createdAt: string;
};

export type Run = {
  activity?: RunActivity[];
  activityTruncated?: boolean;
  plan?: { step: string; status: 'pending' | 'inProgress' | 'completed' }[];
  planExplanation?: string;
  id: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  instructionIds: string[];
  instructions: Instruction[];
  createdAt: string;
  finishedAt?: string;
  settings?: Settings;
  tokenUsage?: TokenUsage;
  prompt: string;
  error?: string;
  output: string;
  threadId?: string;
  turnId?: string;
};

export type RunActivity = {
  id: string;
  time: string;
  kind: string;
  title: string;
  text: string;
  status: string;
};

export type Activity = {
  id: string;
  time: string;
  type: string;
  message: string;
  runId?: string;
};

export type State = {
  version: 1;
  settings: Settings;
  instructions: Instruction[];
  runs: Run[];
  events: Activity[];
};

/** Starting runs already hold project ownership and must block another dispatch. */
export const active = (run: Run) => run.status === 'starting' || run.status === 'running';
