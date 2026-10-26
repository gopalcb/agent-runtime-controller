/** Validate local browser targets and bound the evidence stored with work items. */
import { BadRequestException } from '@nestjs/common';

export type ElementSource = {
  kind: 'element';
  url: string;
  selector: string;
  tag: string;
  text: string;
  html: string;
  styles: Record<string, string>;
  scroll: { x: number; y: number };
};

/** Accept local HTTP(S) targets without credentials or executable URL schemes. */
export function localUrl(value: unknown): URL {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new BadRequestException('Enter a local app URL, such as http://localhost:4200');
  }

  const input = value.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : 'http://' + input);
  } catch {
    throw new BadRequestException('Enter a valid localhost HTTP or HTTPS URL');
  }

  const localHosts = ['localhost', '127.0.0.1', '[::1]', 'localhost.runtime-controller'];
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !localHosts.includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port === '0'
  ) {
    throw new BadRequestException(
      'Use localhost, 127.0.0.1 or [::1] (or the configured controller hostname) over HTTP(S), without credentials',
    );
  }

  url.hash = '';
  return url;
}

/** Remove query strings and fragments before saving a page URL as evidence. */
export function evidenceUrl(value: string): string {
  const url = localUrl(value);
  url.search = '';
  return url.href;
}

/** Keep only the supported evidence fields and their documented size limits. */
export function elementSource(value: any): ElementSource {
  if (
    !value ||
    value.kind !== 'element' ||
    typeof value.selector !== 'string' ||
    !value.selector.trim() ||
    value.selector.length > 1000 ||
    typeof value.tag !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.tag)
  ) {
    throw new BadRequestException('Invalid element reference');
  }

  const boundedText = (text: unknown, limit: number) =>
    typeof text === 'string' ? text.slice(0, limit) : '';
  const styles: Record<string, string> = {};
  const supportedStyles = [
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
  ];

  for (const key of supportedStyles) {
    if (typeof value.styles?.[key] === 'string') {
      styles[key] = boundedText(value.styles[key], 180);
    }
  }

  return {
    kind: 'element',
    url: evidenceUrl(value.url),
    selector: value.selector,
    tag: value.tag,
    text: boundedText(value.text, 1200),
    html: boundedText(value.html, 6000),
    styles,
    scroll: {
      x: Number.isFinite(value.scroll?.x) ? Math.max(0, value.scroll.x) : 0,
      y: Number.isFinite(value.scroll?.y) ? Math.max(0, value.scroll.y) : 0,
    },
  };
}
