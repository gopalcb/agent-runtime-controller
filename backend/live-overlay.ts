/** Serialized by Playwright: keep all browser dependencies inside this function. */
export function installLiveOverlay({ origin }: { origin: string }) {
  if (window !== window.top || location.origin !== origin) return;

  let host: HTMLElement;
  let shadow: ShadowRoot;
  let outline: HTMLElement;
  let editor: HTMLElement;
  let statusLabel: HTMLElement;

  let selecting = false;
  let selectedElement: Element | null = null;
  let selectionEvidence: any = null;
  let saving = false;

  const bridge = (message: unknown) => (window as any).__formaVisual(message);
  const isOverlayEvent = (event: Event) => !!host && event.composedPath().includes(host);

  const suppressEvent = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const hideOutline = () => {
    if (outline) outline.hidden = true;
  };

  /** Switch between app browsing and element selection. */
  const setSelectionMode = (on: boolean) => {
    selecting = on;
    selectedElement = null;
    hideOutline();
    shadow.querySelector('#select')!.setAttribute('aria-pressed', String(on));
    statusLabel.textContent = on ? 'Point to an element · click to describe' : 'Browse your app';
  };

  /** Prefer a unique id; otherwise describe the element's ancestry. */
  const buildSelector = (element: Element) => {
    const path: string[] = [];
    for (let node: Element | null = element; node && path.length < 14; node = node.parentElement) {
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
        path.unshift('#' + CSS.escape(node.id));
        break;
      }
      const siblings = node.parentElement
        ? Array.from(node.parentElement.children).filter((e) => e.tagName === node!.tagName)
        : [node];
      path.unshift(
        node.localName + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''),
      );
    }
    return path.join(' > ').slice(0, 1000);
  };

  /** Clip captured geometry to the visible viewport. */
  const visibleBounds = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    const x = Math.max(0, bounds.left);
    const y = Math.max(0, bounds.top);
    return {
      x,
      y,
      width: Math.max(0, Math.min(innerWidth, bounds.right) - x),
      height: Math.max(0, Math.min(innerHeight, bounds.bottom) - y),
    };
  };

  /** Copy bounded element context without form contents or active attributes. */
  const captureEvidence = (element: Element) => {
    // Whitelist markup attributes, never form values, scripts, links or event handlers.
    const clone = element.cloneNode(true) as Element;
    for (const node of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
      if (node.matches('input,textarea,select,script,style,iframe,[contenteditable]')) {
        node.textContent = '[content omitted]';
      }
      for (const attribute of Array.from(node.attributes)) {
        if (!['id', 'class', 'role', 'aria-label', 'data-testid'].includes(attribute.name)) {
          node.removeAttribute(attribute.name);
        }
      }
    }

    const style = getComputedStyle(element);
    const styles: Record<string, string> = {};
    for (const key of [
      'display',
      'position',
      'color',
      'backgroundColor',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'padding',
      'margin',
      'gap',
      'alignItems',
      'justifyContent',
      'borderRadius',
    ]) {
      styles[key] = (style as any)[key];
    }

    return {
      selector: buildSelector(element),
      tag: element.localName,
      text: (clone.textContent || '').slice(0, 1200),
      html: clone.outerHTML.slice(0, 6000),
      styles,
      scroll: { x: scrollX, y: scrollY },
      rect: visibleBounds(element),
      viewport: { width: innerWidth, height: innerHeight },
    };
  };

  const highlightTarget = (event: PointerEvent) => {
    if (!selecting || !editor.hidden || isOverlayEvent(event)) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.matches('html,body,iframe,input[type=password]')) {
      selectedElement = null;
      hideOutline();
      return;
    }
    selectedElement = element;
    const bounds = visibleBounds(element);
    outline.hidden = bounds.width < 8 || bounds.height < 8;
    Object.assign(outline.style, {
      left: bounds.x + 'px',
      top: bounds.y + 'px',
      width: bounds.width + 'px',
      height: bounds.height + 'px',
    });
    outline.textContent = element.localName + (element.id ? '#' + element.id : '');
  };

  /** Discard transient editor state while leaving saved instructions intact. */
  const resetEditor = () => {
    editor.hidden = true;
    selectionEvidence = null;
    setSelectionMode(false);
  };

  // Register before application handlers so selection does not activate the target.
  window.addEventListener('pointermove', highlightTarget, true);
  for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup'])
    window.addEventListener(
      name,
      (event) => {
        if (selecting && !isOverlayEvent(event)) suppressEvent(event);
      },
      true,
    );
  window.addEventListener(
    'click',
    (event) => {
      if (!selecting || isOverlayEvent(event)) return;
      suppressEvent(event);
      if (!selectedElement || !editor.hidden) return;
      selectionEvidence = captureEvidence(selectedElement);
      if (selectionEvidence.rect.width < 8 || selectionEvidence.rect.height < 8) return;
      editor.hidden = false;
      (shadow.querySelector('#name') as HTMLInputElement).value = '';
      (shadow.querySelector('#description') as HTMLTextAreaElement).value = '';
      shadow.querySelector('#error')!.textContent = '';
      (shadow.querySelector('#name') as HTMLInputElement).focus();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (!shadow) return;
      if (event.key === 'Escape') {
        if (
          saving ||
          (!selecting && editor.hidden && (shadow.querySelector('.saved') as HTMLElement).hidden)
        )
          return;
        (shadow.querySelector('.saved') as HTMLElement).hidden = true;
        suppressEvent(event);
        resetEditor();
        (shadow.querySelector('#select') as HTMLElement).focus();
      }
      if (event.key === 'Tab' && !editor.hidden) {
        const elements = Array.from(
          editor.querySelectorAll<HTMLElement>('input,textarea,button:not(:disabled)'),
        );
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && shadow.activeElement === first) {
          suppressEvent(event);
          last.focus();
        } else if (!event.shiftKey && shadow.activeElement === last) {
          suppressEvent(event);
          first.focus();
        }
      }
    },
    true,
  );

  /** Mount one shadow-root toolbar after the app's document is available. */
  const mount = () => {
    if (document.querySelector('[data-forma-visual-root]')) return;
    host = document.createElement('div');
    host.dataset.formaVisualRoot = '';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;color:#282533;font-size:13px}*{box-sizing:border-box}[hidden]{display:none!important}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #b49afc;outline-offset:3px}
      .bar{pointer-events:auto;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);padding:12px;border:1px solid #76668f;border-radius:17px;background:linear-gradient(125deg,#35313f,#19191f 65%,#30293e);color:#c3bace;box-shadow:0 0 32px #9970e566,inset 0 1px 0 #ffffff44,0 10px 32px #0005;white-space:nowrap}
      button{border:1px solid #dcd5ea;border-radius:8px;padding:11px 14px;background:#fff;color:#67547c}.bar button{background:#ffffff0a;border-color:#ffffff18;color:#dbd3e5}.bar button[aria-pressed=true],.primary{background:linear-gradient(135deg,#9572ed,#7252c9);color:#fff;border-color:#a78aed}.wordmark{font-size:18px;font-weight:700;color:white;padding:0 8px}.hint{font-size:11px;padding:0 6px;max-width:230px;white-space:normal}
      .outline{position:fixed;border:2px solid #9872f5;background:#9c7af517;box-shadow:0 0 0 1px #fff9,0 0 16px #9872f544;pointer-events:none;color:#6846ae;font-size:11px;padding:4px;overflow:hidden}.panel{pointer-events:auto;position:fixed;bottom:108px;left:50%;transform:translateX(-50%);width:420px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 130px);overflow:auto;padding:24px;background:#fff;border:1px solid #e9e1f4;border-radius:16px;box-shadow:0 15px 70px #21172e40}
      h2{font-size:19px;margin:0 0 20px;font-weight:600}label{display:block;margin:15px 0 8px;font-size:12px}input,textarea{width:100%;padding:11px 12px;border:1px solid #dcd5e8;border-radius:8px;background:#fcfbfe;color:#40354e}textarea{resize:vertical;min-height:100px}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.error{color:#b34455;font-size:12px}.saved-item{border-top:1px solid #eee6f4;padding:14px 0;overflow-wrap:anywhere}.saved-item p{font-size:12px;color:#86778f;line-height:1.6;white-space:pre-wrap}.saved-item code{font-size:10px;color:#8971b0}
      button,.bar,.panel,input,textarea{border-radius:4px}button,.bar button,.primary,.bar button[aria-pressed=true]{background:#24212e;color:#fff;border-color:#5b5669}button{font-size:12px;text-transform:uppercase}.bar button[aria-pressed=true]{outline:2px solid #b6a1ff;outline-offset:1px}.wordmark{letter-spacing:2px;font-size:15px}.saved-item p{color:#51465b}.saved-item code{color:#65478b}textarea{resize:none}
      @media(max-width:650px){.hint,.wordmark{display:none}.bar{gap:6px;padding:10px;bottom:18px}.bar button{font-size:11px;padding:11px 12px}.panel{padding:20px;bottom:96px}}
    </style><div class="outline" hidden></div><section class="panel editor" role="dialog" aria-modal="true" aria-labelledby="heading" hidden><h2 id="heading">Describe this element</h2><form><label for="name">Region name</label><input id="name" maxlength="160" required autocomplete="off"><label for="description">Instructions</label><textarea id="description" maxlength="12000" required></textarea><p class="error" id="error" role="alert"></p><div class="actions"><button type="button" id="cancel">Cancel</button><button class="primary" type="submit">Save instruction</button></div></form></section><section class="panel saved" aria-label="Saved instructions" hidden><h2>Saved instructions</h2><div id="items"></div></section><div class="bar" role="toolbar" aria-label="Visual instruction tools"><span class="wordmark">RELAY</span><button id="select" aria-pressed="false">Select element</button><button id="browse">Browse</button><button id="saved">Saved (0)</button><span class="hint" role="status">Browse your app</span></div>`;
    document.documentElement.appendChild(host);
    outline = shadow.querySelector('.outline')!;
    editor = shadow.querySelector('.editor')!;
    statusLabel = shadow.querySelector('.hint')!;
    const saved = shadow.querySelector<HTMLElement>('.saved')!;

    const refreshSavedInstructions = async () => {
      try {
        const data = await bridge({ action: 'list' });
        shadow.querySelector('#saved')!.textContent = `Saved (${data.instructions.length})`;
        const items = shadow.querySelector('#items')!;
        items.replaceChildren();
        for (const item of data.instructions.slice(-100).reverse()) {
          const row = document.createElement('div');
          row.className = 'saved-item';
          const title = document.createElement('strong');
          const description = document.createElement('p');
          const code = document.createElement('code');
          title.textContent = item.title;
          description.textContent = item.description;
          code.textContent = item.source.selector;
          row.append(title, description, code);
          items.append(row);
        }
      } catch {
        statusLabel.textContent = 'Could not load saved instructions';
      }
    };

    shadow.querySelector('#select')!.addEventListener('click', () => {
      if (saving) return;
      editor.hidden = true;
      saved.hidden = true;
      setSelectionMode(!selecting);
    });

    shadow.querySelector('#browse')!.addEventListener('click', () => {
      if (saving) return;
      editor.hidden = true;
      saved.hidden = true;
      setSelectionMode(false);
    });

    shadow.querySelector('#saved')!.addEventListener('click', () => {
      if (saving) return;
      editor.hidden = true;
      setSelectionMode(false);
      saved.hidden = !saved.hidden;
      void refreshSavedInstructions();
    });

    shadow.querySelector('#cancel')!.addEventListener('click', () => {
      resetEditor();
      (shadow.querySelector('#select') as HTMLElement).focus();
    });

    shadow.querySelector('form')!.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving || !selectionEvidence) return;

      const title = (shadow.querySelector('#name') as HTMLInputElement).value.trim();
      const description = (
        shadow.querySelector('#description') as HTMLTextAreaElement
      ).value.trim();
      if (!title || !description) return;

      saving = true;
      editor.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try {
        await bridge({ action: 'save', title, description, element: selectionEvidence });
        resetEditor();
        await refreshSavedInstructions();
        statusLabel.textContent = 'Instruction saved · ready in builder';
        (shadow.querySelector('#select') as HTMLElement).focus();
      } catch {
        shadow.querySelector('#error')!.textContent =
          'Could not save. Check the builder is running and try again.';
      } finally {
        saving = false;
        editor.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }
    });

    window.addEventListener('scroll', hideOutline, true);
    window.addEventListener('resize', hideOutline);
    void refreshSavedInstructions();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
