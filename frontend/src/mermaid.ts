/** Render escaped Markdown diagram blocks without trusting document HTML or inline SVG. */
import DOMPurify from 'dompurify';

let renderer: Promise<(typeof import('mermaid'))['default']> | undefined;
let diagramId = 0;
const MAX_DIAGRAM_LENGTH = 50_000;

/** Load the bundled renderer only when a document actually contains Mermaid. */
function loadRenderer() {
  renderer ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: MAX_DIAGRAM_LENGTH,
      maxEdges: 500,
      logLevel: 'fatal',
      htmlLabels: false,
      fontFamily: 'Arial, sans-serif',
      flowchart: { htmlLabels: false },
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'suppressErrorRendering',
        'htmlLabels',
        'flowchart',
        'themeCSS',
        'fontFamily',
      ],
    });
    return mermaid;
  });
  return renderer;
}

/** Claim each source block once; document changes replace these nodes and cancel stale results. */
export function renderMermaidBlocks(container: HTMLElement): void {
  for (const block of Array.from(
    container.querySelectorAll<HTMLElement>('pre.mermaid-source:not([data-mermaid-state])'),
  )) {
    block.dataset['mermaidState'] = 'pending';
    block.setAttribute('aria-busy', 'true');
    void renderDiagram(block);
  }
}

/** Use an off-screen layout surface, then display the generated SVG as a noninteractive image. */
async function renderDiagram(block: HTMLElement): Promise<void> {
  const source = block.textContent || '';
  const staging = document.createElement('div');
  staging.className = 'mermaid-staging';
  staging.setAttribute('aria-hidden', 'true');

  try {
    if (source.length > MAX_DIAGRAM_LENGTH) throw new Error('Diagram exceeds rendering limit');
    // Reject HTML and encoded markup before Mermaid measures labels in the DOM.
    if (/<\s*[a-z!\/]/i.test(source)) throw new Error('HTML labels are not supported');
    const plain = DOMPurify.sanitize(source, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
      RETURN_DOM: true,
    }).textContent;
    if (plain !== source) throw new Error('HTML labels are not supported');
    const mermaid = await loadRenderer();
    if (!block.isConnected) return;

    staging.style.width = `${block.parentElement?.clientWidth || 800}px`;
    document.body.append(staging);
    const { svg } = await mermaid.render(`work-doc-diagram-${++diagramId}`, source, staging);
    if (!block.isConnected) return;

    const figure = document.createElement('figure');
    figure.className = 'mermaid-diagram';
    const image = document.createElement('img');
    image.alt = 'Mermaid diagram';
    // Image documents cannot run SVG scripts or diagram click handlers in the app.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Diagram source';
    details.append(summary);
    figure.append(image, details);
    block.replaceWith(figure);
    block.dataset['mermaidState'] = 'rendered';
    details.append(block);
  } catch {
    if (!block.isConnected) return;
    block.dataset['mermaidState'] = 'failed';
    const message = document.createElement('p');
    message.className = 'mermaid-error';
    message.setAttribute('role', 'status');
    message.textContent =
      source.length > MAX_DIAGRAM_LENGTH
        ? 'This diagram exceeds the 50,000 character rendering limit. Source is shown below.'
        : 'Could not render this Mermaid diagram. Check the syntax below.';
    block.before(message);
  } finally {
    block.removeAttribute('aria-busy');
    staging.remove();
  }
}
