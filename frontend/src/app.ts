import { renderMarkdown } from './markdown';
import { renderMermaidBlocks } from './mermaid';
import { Component, HostListener, computed, signal, OnDestroy, afterEveryRender, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Rect { x: number; y: number; width: number; height: number }
interface Viewport { width: number; height: number }
interface ElementSource { kind: 'element'; url: string; selector: string; tag: string; text: string; html: string; styles: Record<string, string>; scroll: { x: number; y: number } }
interface Instruction { id: string; title: string; description: string; rect: Rect; viewport: Viewport; status: string; createdAt: string; source?: ElementSource }
interface TokenUsage { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number }
interface Settings { sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'; approvalPolicy: 'never' | 'on-request' | 'untrusted'; model: string; reasoningEffort: '' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'; networkAccess: boolean }
interface Approval { id: string; runId: string; method: string; description: string; createdAt: string }
interface Health { server: { status: string; uptimeSeconds: number }; project: { status: string; root: string }; codex: { status: string; version?: string }; browser: { status: string }; memory: { rssBytes: number } }
interface Run { tokenUsage?: TokenUsage; id: string; status: string; instructionIds: string[]; createdAt: string; finishedAt?: string; error?: string; output?: string; prompt?: string }
interface Event { id: string; time: string; type: string; message: string; runId?: string }
interface Project { id: string; name: string; root: string }
interface Installation { status: 'not-installed' | 'installing' | 'completed' | 'failed'; progress: number; steps: { id: string; label: string; status: string; message?: string }[]; error?: string; version?: string }
type Page = 'builder' | 'history' | 'settings' | 'observability' | 'install' | 'work-docs';
interface BuilderState { installation?: Installation; projects?: Project[]; settings?: Settings; approvals?: Approval[]; health?: Health; project: Project; instructions: Instruction[]; runs: Run[]; events: Event[]; runtime: { status: string }; browser: { open: boolean }; token?: string }

@Component({
  selector: 'app-icon',
  standalone: true,
  inputs: ['name'],
  template: `<i [class]="'bi bi-' + (icons[name] || name)" aria-hidden="true"></i>`,
  styles: [':host{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex-shrink:0}.bi{font-size:16px;line-height:1}']
})
export class IconComponent {
  name = 'square';
  icons: Record<string, string> = { cursor: 'cursor', plus: 'plus-lg', arrow: 'arrow-right', external: 'box-arrow-up-right', history: 'clock-history', pulse: 'activity', layers: 'layers', play: 'play', trash: 'trash3', close: 'x-lg', check: 'check-lg', code: 'code-slash', folder: 'folder2-open', spark: 'stars', info: 'info-circle', grid: 'grid', stop: 'stop', back: 'arrow-left', terminal: 'terminal', mouse: 'mouse' };
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './app.html'
})
export class AppComponent implements OnDestroy {
  readonly canvas = ['/canvas', '/controller/canvas'].includes(location.pathname.replace(/\/$/, ''));
  readonly page = signal<Page>(this.pageFromPath());
  readonly state = signal<BuilderState | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly notice = signal('');
  readonly busy = signal('');
  readonly drawing = signal(false);
  readonly draft = signal<Rect | null>(null);
  readonly editing = signal(false);
  readonly urlDialog = signal(false);
  readonly urlError = signal('');
  readonly viewport = signal<Viewport>({ width: window.innerWidth, height: window.innerHeight });
  readonly draftViewport = signal<Viewport>({ width: window.innerWidth, height: window.innerHeight });
  readonly selectedRun = signal<string | null>(null);
  readonly todos = computed(() => this.state()?.instructions.filter(item => item.status === 'todo') ?? []);
  readonly archivedItems = computed(() => this.state()?.instructions.filter(item => item.status === 'completed') ?? []);
  readonly otherItems = computed(() => this.state()?.instructions.filter(item => !['todo', 'completed'].includes(item.status)) ?? []);
  readonly installation = computed<Installation>(() => this.state()?.installation ?? { status: 'not-installed', progress: 0, steps: [] });
  readonly installed = computed(() => this.installation().status === 'completed');
  readonly projectDialog = signal(false);
  readonly addDialog = signal(false);
  readonly folderLoading = signal(false);
  readonly folderError = signal('');
  readonly folderResult = signal<{ path: string; parent: string | null; folders: {name: string; path: string}[] } | null>(null);
  projectPath = '';
  private dialogOpener: HTMLElement | null = null;
  projectLabel() { const root = this.state()?.project.root ?? ''; const parts = root.split('/').filter(Boolean); return '../' + parts.slice(-2).join('/'); }
  runtimeLabel() { return !this.state() ? 'Unavailable' : this.activeRun() ? 'Working' : 'Idle'; }
  openAdd(event: MouseEvent) { this.dialogOpener = event.currentTarget as HTMLElement; this.addDialog.set(true); setTimeout(() => document.getElementById('add-drawing')?.focus()); }
  closeAdd() { this.addDialog.set(false); setTimeout(() => this.dialogOpener?.focus()); }
  chooseDrawing() { this.closeAdd(); this.openCanvas(); }
  chooseUrl(event: MouseEvent) { this.addDialog.set(false); this.openUrlDialog(event); this.urlOpener = this.dialogOpener; }
  openProject(event: MouseEvent) { this.dialogOpener = event.currentTarget as HTMLElement; this.projectPath = this.state()?.project.root ?? ''; this.projectDialog.set(true); this.folderError.set(''); void this.browseFolders(); setTimeout(() => document.getElementById('project-path')?.focus()); }
  closeProject() { if (this.busy() === 'project') return; this.projectDialog.set(false); setTimeout(() => this.dialogOpener?.focus()); }
  async browseFolders(path = this.projectPath) {
    this.folderLoading.set(true); this.folderError.set('');
    try { const response = await fetch('/api/projects/folders?path=' + encodeURIComponent(path), { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Could not browse folders.'); this.folderResult.set(data); this.projectPath = data.path; }
    catch (error) { this.folderError.set(error instanceof Error ? error.message : 'Could not browse folders.'); }
    finally { this.folderLoading.set(false); }
  }
  private clearProjectUI() {
    this.projectEpoch++;
    this.documents.set([]); this.documentContent.set(''); this.documentPath.set(''); this.docsError.set(''); this.docsLoading.set(false); this.docSearch = ''; this.documentRequest++; this.followOutput.set(true);
    this.selectedIds.set([]); this.selectedRun.set(null); this.settingsLoaded = false; this.settings = { sandbox: 'workspace-write', approvalPolicy: 'never', model: '', reasoningEffort: '', networkAccess: false };
    this.executionDialog.set(false); this.addDialog.set(false); this.urlDialog.set(false); this.projectDialog.set(false); this.editing.set(false); this.draft.set(null); this.drawing.set(false); this.start = null;
    this.folderResult.set(null); this.folderError.set(''); this.urlError.set(''); this.notice.set(''); this.projectPath = ''; this.title = ''; this.description = ''; this.prompt = ''; this.runSearch = ''; this.runStatus = ''; this.runSince = ''; this.eventSearch = ''; this.eventType = ''; this.eventSession = ''; this.eventSeverity = '';
  }
  async switchProject() {
    if (this.activeRun() || this.installation().status === 'installing') return;
    const path = this.projectPath.trim(); if (!path) return;
    await this.action('project', async () => { const data = await this.mutate('/projects/switch', {path}) as BuilderState; this.clearProjectUI(); this.token = data.token || ''; this.state.set(data); this.settings = {...this.settings, ...data.settings}; this.settingsLoaded = true; this.settingsProjectId = data.project.id; this.navigate(data.installation?.status === 'completed' ? 'builder' : 'install'); });
  }
  install(action: 'install' | 'retry' | 'reinstall' | 'reset') {
    if (this.installation().status === 'installing' || this.activeRun()) return;
    if (['reinstall', 'reset'].includes(action) && !window.confirm(action === 'reset' ? 'Reset managed runtime files for this project? Edited and unrelated files are preserved.' : 'Reinstall managed runtime files for this project? Edited and unrelated files are preserved.')) return;
    void this.action('install', async () => { await this.mutate('/install', {action}); });
  }
  readonly canvasInstructions = computed(() => this.state()?.instructions.filter(item => item.source?.kind !== 'element') ?? []);
  readonly activeRun = computed(() => this.state()?.runs.find(run => ['starting', 'running'].includes(run.status)));
  readonly runs = computed(() => this.state()?.runs ?? []);
  readonly events = computed(() => [...(this.state()?.events ?? [])].reverse());
  readonly completed = computed(() => this.state()?.runs.filter(run => run.status === 'completed').length ?? 0);
  readonly failures = computed(() => this.state()?.runs.filter(run => ['failed', 'interrupted'].includes(run.status)).length ?? 0);
  readonly details = computed<Run | undefined>(() => this.runs().find(run => run.id === this.selectedRun()) ?? this.runs()[0]);
  readonly selectedIds = signal<string[]>([]);
  readonly selectedItems = computed(() => this.todos().filter(item => this.selectedIds().includes(item.id)));
  readonly executionDialog = signal(false);
  settings: Settings = { sandbox: 'workspace-write', approvalPolicy: 'never', model: '', reasoningEffort: '', networkAccess: false };
  private settingsLoaded = false;
  private settingsProjectId = '';
  private executionOpener: HTMLElement | null = null;
  runSearch = ''; runStatus = ''; runSince = '';
  eventSearch = ''; eventType = ''; eventSession = ''; eventSeverity = '';
  prompt = '';

  toggleItem(id: string) { this.selectedIds.update(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]); }
  selectAll(checked: boolean) { this.selectedIds.set(checked ? this.todos().map(item => item.id) : []); }
  openExecution(event: MouseEvent) {
    if (!this.installed() || !this.selectedItems().length || this.activeRun() || this.busy()) return;
    this.executionOpener = event.currentTarget as HTMLElement;
    this.executionDialog.set(true);
    setTimeout(() => document.getElementById('execute-cancel')?.focus());
  }
  closeExecution() {
    if (this.busy() === 'execute') return;
    this.executionDialog.set(false);
    setTimeout(() => this.executionOpener?.focus());
  }
  sandboxChanged() { if (this.settings.sandbox === 'danger-full-access') this.settings.networkAccess = true; }
  saveSettings() {
    void this.action('settings', async () => {
      await this.mutate('/settings', { ...this.settings });
      this.notice.set('Settings saved. They apply to future runs.');
    });
  }
  decideApproval(approval: Approval, decision: 'accept' | 'decline') {
    void this.action(approval.id, async () => { await this.mutate(`/approvals/${encodeURIComponent(approval.id)}`, { decision }); });
  }
  filteredRuns() {
    return this.runs().filter(run => (!this.runStatus || run.status === this.runStatus) && (!this.runSince || run.createdAt.slice(0, 10) >= this.runSince) && (!this.runSearch || `${run.id} ${run.prompt || ''} ${run.status}`.toLowerCase().includes(this.runSearch.toLowerCase())));
  }
  severity(event: Event) { return /error|failed|interrupted|reject|declin/i.test(event.type) ? 'error' : /warn/i.test(event.type) ? 'warning' : /debug|trace/i.test(event.type) ? 'debug' : 'info'; }
  filteredEvents() {
    return this.events().filter(event => (!this.eventSeverity || this.severity(event) === this.eventSeverity) && (!this.eventType || event.type === this.eventType) && (!this.eventSession || event.runId === this.eventSession) && (!this.eventSearch || `${event.type} ${event.message} ${event.runId || ''}`.toLowerCase().includes(this.eventSearch.toLowerCase())));
  }
  eventTypes() { return [...new Set(this.events().map(event => event.type))].sort(); }
  reportedRuns() { return this.runs().filter(run => run.tokenUsage != null); }
  recordedTotal() { return this.reportedRuns().reduce((sum, run) => sum + run.tokenUsage!.totalTokens, 0); }


  @ViewChild('terminal') terminal?: ElementRef<HTMLElement>;
  @ViewChild('documentBody') documentBody?: ElementRef<HTMLElement>;
  readonly followOutput = signal(true);
  private lastOutput = '';
  readonly liveOutput = computed(() => {
    const run = this.activeRun();
    if (!run) return '';
    return run.output || this.state()?.events.filter(event => event.runId === run.id).map(event => event.message).join('\n') || 'Waiting for agent output…';
  });
  private scrollOutput() {
    const node = this.terminal?.nativeElement;
    if (!node) { this.lastOutput = ''; return; }
    const key = this.activeRun()?.id + this.liveOutput();
    if (node && this.followOutput() && key !== this.lastOutput) { node.scrollTop = node.scrollHeight; this.lastOutput = key; }
  }
  toggleFollow() { this.followOutput.update(value => !value); this.lastOutput = ''; }
  readonly documents = signal<{path:string;size:number;modifiedAt:string}[]>([]);
  readonly documentPath = signal('');
  readonly documentContent = signal('');
  readonly documentHtml = computed(() => renderMarkdown(this.documentContent()));
  readonly docsLoading = signal(false);
  readonly docsError = signal('');
  readonly docsTruncated = signal(false);
  docSearch = '';
  private documentRequest = 0;
  filteredDocuments() { return this.documents().filter(doc => doc.path.toLowerCase().includes(this.docSearch.toLowerCase())); }
  async loadDocuments() {
    const project = this.state()?.project.id, epoch = this.projectEpoch;
    if (!project) return;
    this.docsLoading.set(true); this.docsError.set('');
    try {
      const response = await fetch('/api/documents', {cache:'no-store',headers:{'X-Project-Id':project}});
      const data = await response.json();
      if (epoch !== this.projectEpoch || project !== this.state()?.project.id) return;
      if (!response.ok) throw new Error(data.message || 'Could not list documents');
      this.documents.set(data.documents); this.docsTruncated.set(data.truncated);
      const selected = data.documents.find((doc:{path:string}) => doc.path === this.documentPath()) || data.documents[0];
      if (selected) await this.openDocument(selected.path);
      else { this.documentPath.set(''); this.documentContent.set(''); }
    } catch(error) { if(epoch === this.projectEpoch) this.docsError.set(error instanceof Error ? error.message : 'Could not list documents'); }
    finally { if(epoch === this.projectEpoch) this.docsLoading.set(false); }
  }
  async openDocument(path:string) {
    const project = this.state()?.project.id, epoch = this.projectEpoch, request = ++this.documentRequest;
    if(!project) return;
    this.documentPath.set(path); this.documentContent.set(''); this.docsError.set('');
    try {
      const response = await fetch('/api/documents/content?path='+encodeURIComponent(path),{cache:'no-store',headers:{'X-Project-Id':project}});
      const data = await response.json();
      if(epoch !== this.projectEpoch || request !== this.documentRequest) return;
      if(!response.ok) throw new Error(data.message || 'Could not read document');
      this.documentContent.set(data.content);
    } catch(error) { if(epoch === this.projectEpoch && request === this.documentRequest) this.docsError.set(error instanceof Error ? error.message : 'Could not read document'); }
  }

  title = '';
  description = '';
  targetUrl = 'http://localhost:4200';
  private token = '';
  private urlOpener: HTMLElement | null = null;
  private start: { x: number; y: number; pointerId: number } | null = null;
  private timer: ReturnType<typeof setInterval>;
  private refreshPending = false;
  private projectEpoch = 0;
  private destroyed = false;

  constructor() {
    // Scroll after Angular has rendered the latest output into the conditional terminal.
    afterEveryRender(() => {
      this.scrollOutput();
      if (this.documentBody) renderMermaidBlocks(this.documentBody.nativeElement);
    });
    history.replaceState({}, '', this.canvas ? '/controller/canvas' : this.route(this.page()));
    void this.refresh(true);
    this.timer = setInterval(() => void this.refresh(), 2000);
  }

  ngOnDestroy() { this.destroyed = true; clearInterval(this.timer); }

  async refresh(bootstrap = false) {
    if (this.refreshPending) return;
    this.refreshPending = true;
    const epoch = this.projectEpoch;
    try {
      const response = await fetch(bootstrap || !this.token ? '/api/bootstrap' : '/api/state', { cache: 'no-store', headers: !bootstrap && this.state()?.project.id ? { 'X-Project-Id': this.state()!.project.id } : {} });
      if (epoch !== this.projectEpoch) return;
      if (response.status === 409) { this.clearProjectUI(); this.state.set(null); this.token = ''; this.refreshPending = false; await this.refresh(true); this.error.set('Project changed in another window. Review the active project before continuing.'); return; }
      if (!response.ok) throw new Error(`Could not connect to the project (${response.status}).`);
      const data: BuilderState = await response.json();
      if (this.destroyed || epoch !== this.projectEpoch) return;
      if (this.settingsProjectId && data.project.id !== this.settingsProjectId) { this.clearProjectUI(); this.token = ''; if (!data.token) { this.refreshPending = false; await this.refresh(true); return; } }
      if (data.token) this.token = data.token;
      this.state.set(data);
      if (this.page() === 'work-docs' && bootstrap) void this.loadDocuments();
      if (!this.settingsLoaded) { this.settings = { ...this.settings, ...data.settings }; this.settingsLoaded = true; this.settingsProjectId = data.project.id; }
      this.selectedIds.update(ids => ids.filter(id => data.instructions.some(item => item.id === id && item.status === 'todo')));
      if (this.error().startsWith('Could not connect')) this.error.set('');
    } catch (error) {
      if (epoch !== this.projectEpoch) return;
      this.state.set(null);
      this.token = '';
      this.error.set('Could not connect to the project. ' + (error instanceof Error ? error.message : 'Retrying…'));
    } finally {
      this.loading.set(false);
      this.refreshPending = false;
    }
  }

  async mutate(path: string, body?: unknown, method = 'POST'): Promise<unknown> {
    if (!this.token) throw new Error('The project is still connecting. Please try again.');
    const response = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Builder-Token': this.token, 'X-Project-Id': this.state()?.project.id || '' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(body ?? {}) })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && /project.*chang|stale.*project|project.*mismatch|project_changed/i.test(`${data.message || ''} ${data.code || ''} ${data.error || ''}`)) { this.clearProjectUI(); this.state.set(null); this.token = ''; this.refreshPending = false; await this.refresh(true); throw new Error('Project changed in another window. Review the active project before continuing.'); }
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : `Request failed (${response.status}).`);
    return data;
  }

  async action(key: string, work: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(key);
    this.error.set('');
    this.notice.set('');
    try { await work(); await this.refresh(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'Something went wrong. Please try again.'); }
    finally { this.busy.set(''); }
  }

  openCanvas() {
    void this.action('browser', async () => {
      await this.mutate('/browser');
      this.notice.set('Your visual canvas is open in the controlled browser. Draw a region to get started.');
    });
  }

  openUrlDialog(event: MouseEvent) {
    if (this.busy() || !this.state()) return;
    this.urlOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    this.urlError.set('');
    this.urlDialog.set(true);
    setTimeout(() => document.getElementById('target-url')?.focus());
  }

  closeUrlDialog(force = false) {
    if (!force && this.busy() === 'url') return;
    this.urlDialog.set(false);
    this.urlError.set('');
    setTimeout(() => this.urlOpener?.focus());
  }

  async submitUrl() {
    if (this.busy()) return;
    let url: URL;
    try {
      const value = this.targetUrl.trim();
      if (!value || value.length > 2048 || /\s/.test(value)) throw new Error();
      url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`);
      if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]', 'localhost.runtime-controller'].includes(url.hostname) || url.username || url.password) throw new Error();
    } catch {
      this.urlError.set('Enter a localhost HTTP or HTTPS URL without credentials.');
      document.getElementById('target-url')?.focus();
      return;
    }
    this.busy.set('url');
    this.urlError.set('');
    this.notice.set('');
    try {
      await this.mutate('/browser/url', { url: url.href });
      this.targetUrl = url.href;
      this.closeUrlDialog(true);
      this.notice.set('Local app opened. Select an element to add instructions.');
      await this.refresh();
    } catch (error) {
      this.urlError.set(error instanceof Error ? error.message : 'Could not open the local app.');
    } finally {
      this.busy.set('');
      if (!this.urlDialog()) setTimeout(() => this.urlOpener?.focus());
    }
  }

  execute() {
    if (!this.installed() || !this.executionDialog() || !this.selectedItems().length || this.activeRun()) return;
    void this.action('execute', async () => {
      const run = await this.mutate('/execute', { instructionIds: this.selectedItems().map(item => item.id), prompt: this.prompt.trim() }) as Run;
      this.selectedRun.set(run.id);
      this.executionDialog.set(false);
      this.selectedIds.set([]);
      this.prompt = '';
      setTimeout(() => this.executionOpener?.focus());
      this.notice.set('Selected instructions sent to Codex. Follow the run below.');
    });
  }

  remove(item: Instruction) {
    void this.action(item.id, async () => { await this.mutate(`/instructions/${encodeURIComponent(item.id)}`, undefined, 'DELETE'); });
  }

  cancel(run: Run) {
    void this.action('cancel', async () => { await this.mutate(`/runs/${encodeURIComponent(run.id)}/cancel`); });
  }

  private pageFromPath(): Page {
    const name = location.pathname.replace(/\/$/, '').split('/').pop();
    return ['settings', 'observability', 'history', 'install', 'work-docs'].includes(name || '') ? name as Page : 'builder';
  }
  private route(page: Page) { return '/controller/' + (page === 'builder' ? 'agent-runtime' : page); }
  navigate(page: Page) {
    this.page.set(page);
    if (page === 'work-docs' && this.state()) void this.loadDocuments();
    if (location.pathname !== this.route(page)) history.pushState({}, '', this.route(page));
    this.notice.set('');
  }
  showRun(id: string) { this.selectedRun.set(id); this.navigate('history'); }
  @HostListener('window:popstate') popstate() { this.page.set(this.pageFromPath()); if (this.page() === 'work-docs') void this.loadDocuments(); }

  toggleDrawing() {
    this.drawing.update(value => !value);
    this.draft.set(null);
    this.start = null;
    this.error.set('');
  }

  pointerDown(event: PointerEvent) {
    if (!this.drawing() || this.editing() || event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, textarea, .canvas-toolbar, .dialog-backdrop')) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    this.draftViewport.set({ ...this.viewport() });
    this.draft.set({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
  }

  pointerMove(event: PointerEvent) {
    if (!this.start || this.start.pointerId !== event.pointerId || this.editing()) return;
    const x = Math.max(0, Math.min(event.clientX, this.viewport().width));
    const y = Math.max(0, Math.min(event.clientY, this.viewport().height));
    this.draft.set({ x: Math.min(x, this.start.x), y: Math.min(y, this.start.y), width: Math.abs(x - this.start.x), height: Math.abs(y - this.start.y) });
  }

  pointerUp(event: PointerEvent) {
    if (!this.start || event.pointerId !== this.start.pointerId) return;
    this.pointerMove(event);
    this.start = null;
    const rect = this.draft();
    if (!rect || rect.width < 12 || rect.height < 12) { this.draft.set(null); return; }
    this.title = '';
    this.description = '';
    this.editing.set(true);
    setTimeout(() => document.getElementById('region-title')?.focus());
  }

  pointerCancel() { if (!this.editing()) { this.start = null; this.draft.set(null); } }

  dismissEditor() {
    if (this.busy() === 'save') return;
    this.editing.set(false);
    this.draft.set(null);
    this.start = null;
    setTimeout(() => document.getElementById('draw-button')?.focus());
  }

  saveRegion() {
    if (!this.draft() || !this.title.trim() || !this.description.trim()) return;
    void this.action('save', async () => {
      await this.mutate('/instructions', { title: this.title.trim(), description: this.description.trim(), rect: this.draft(), viewport: this.draftViewport() });
      this.editing.set(false);
      this.draft.set(null);
      setTimeout(() => document.getElementById('draw-button')?.focus());
    });
  }

  @HostListener('window:resize') resize() {
    this.viewport.set({ width: window.innerWidth, height: window.innerHeight });
    if (!this.editing()) { this.start = null; this.draft.set(null); }
  }
  @HostListener('document:keydown', ['$event']) keydown(event: KeyboardEvent) {
    if (this.addDialog() || this.projectDialog()) {
      if (event.key === 'Escape') { event.preventDefault(); this.addDialog() ? this.closeAdd() : this.closeProject(); }
      this.trapDialog(event, this.projectDialog() ? '.project-dialog' : '.add-dialog'); return;
    }
    if (this.executionDialog()) {
      if (event.key === 'Escape') { event.preventDefault(); this.closeExecution(); }
      this.trapDialog(event, '.execute-dialog');
      return;
    }
    if (this.urlDialog()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeUrlDialog();
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(document.querySelectorAll<HTMLElement>('.url-dialog input:not([disabled]), .url-dialog button:not([disabled])'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first) event.preventDefault();
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.key === 'Escape') {
      if (this.editing()) this.dismissEditor();
      else { this.drawing.set(false); this.draft.set(null); this.start = null; }
    }
    if (event.key === 'Tab' && this.editing()) {
      const focusable = Array.from(document.querySelectorAll<HTMLElement>('.region-dialog input, .region-dialog textarea, .region-dialog button:not([disabled])'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  private trapDialog(event: KeyboardEvent, selector: string) {
    if (event.key !== 'Tab') return;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`${selector} button:not([disabled]), ${selector} textarea:not([disabled]), ${selector} input:not([disabled]), ${selector} select:not([disabled])`));
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
  }
  rectStyle(item: Instruction): Record<string, string> {
    return { left: `${item.rect.x / item.viewport.width * 100}%`, top: `${item.rect.y / item.viewport.height * 100}%`, width: `${item.rect.width / item.viewport.width * 100}%`, height: `${item.rect.height / item.viewport.height * 100}%` };
  }
  size(rect: Rect) { return `${Math.round(rect.width)} × ${Math.round(rect.height)}`; }
  shortId(id: string) { return id.slice(0, 8); }
  isActive(run: Run) { return ['starting', 'running'].includes(run.status); }
}
