import TurndownService from 'turndown';

function escapeYamlString(value: string): string {
  return (value || '').replace(/"/g, '\\"');
}

export function buildMarkdownExport(input: {
  title: string;
  byline: string;
  sourceUrl: string;
  siteName: string;
  publishedTime: string;
  content: string;
}): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  turndown.addRule('preserveImageCaptions', {
    filter: (node) => {
      if (node.nodeName !== 'EM') return false;
      const text = node.textContent || '';
      return /^\[Image:\s*/.test(text);
    },
    replacement: (content) => `*${content}*`,
  });

  const markdownBody = turndown.turndown(input.content).trim();
  const extractedAt = new Date().toISOString();

  const frontmatter = [
    '---',
    `title: "${escapeYamlString(input.title || 'Untitled Article')}"`,
    `author: "${escapeYamlString(input.byline || 'unknown')}"`,
    `source: "${escapeYamlString(input.sourceUrl)}"`,
    `site: "${escapeYamlString(input.siteName || 'Unknown')}"`,
    `published: "${escapeYamlString(input.publishedTime || 'Unknown')}"`,
    `extracted: "${extractedAt}"`,
    '---',
    '',
  ].join('\n');

  return `${frontmatter}${markdownBody}\n`;
}
