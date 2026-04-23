import { JSDOM } from 'jsdom';

function getNodeText(node: Node): string {
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}

function appendLine(lines: string[], line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  lines.push(trimmed);
  lines.push('');
}

function parseHtmlToTextWithHeadings(content: string): string {
  const dom = new JSDOM(`<body>${content}</body>`);

  try {
    const lines: string[] = [];

    function walk(node: Node): void {
      if (node.nodeType !== dom.window.Node.ELEMENT_NODE) {
        return;
      }

      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();

      if (tag === 'h1') {
        appendLine(lines, `=== ${getNodeText(element)}`);
        return;
      }

      if (tag === 'h2') {
        appendLine(lines, `--- ${getNodeText(element)}`);
        return;
      }

      if (tag === 'h3') {
        appendLine(lines, `~~~ ${getNodeText(element)}`);
        return;
      }

      if (tag === 'p' || tag === 'blockquote') {
        appendLine(lines, getNodeText(element));
        return;
      }

      if (tag === 'pre') {
        appendLine(lines, getNodeText(element));
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        for (const child of Array.from(element.children)) {
          if (child.tagName.toLowerCase() === 'li') {
            appendLine(lines, `- ${getNodeText(child)}`);
          }
        }
        return;
      }

      if (tag === 'li') {
        appendLine(lines, `- ${getNodeText(element)}`);
        return;
      }

      for (const child of Array.from(element.childNodes)) {
        walk(child);
      }
    }

    for (const child of Array.from(dom.window.document.body.childNodes)) {
      walk(child);
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    dom.window.close();
  }
}

export function buildTxtExport(input: {
  title: string;
  byline: string;
  sourceUrl: string;
  siteName: string;
  publishedTime: string;
  content: string;
  textContent: string;
}): string {
  const extractedAt = new Date().toISOString();
  const body = parseHtmlToTextWithHeadings(input.content) || input.textContent.trim();

  return [
    `Title: ${input.title || 'Untitled Article'}`,
    `Author: ${input.byline || 'Unknown'}`,
    `Source: ${input.sourceUrl}`,
    `Site: ${input.siteName || 'Unknown'}`,
    `Published: ${input.publishedTime || 'Unknown'}`,
    `Extracted: ${extractedAt}`,
    '---',
    '',
    body,
  ].join('\n');
}
