import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  type ParagraphChild,
} from 'docx';
import { JSDOM } from 'jsdom';

type InlineStyle = {
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
};

type SupportedImageType = 'jpg' | 'png' | 'gif' | 'bmp';
const MAX_DOCX_IMAGE_BYTES = 3_000_000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function parseDataUri(src: string): { data: Buffer; mime: string } | null {
  const match = src.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;

  try {
    return { mime: match[1].toLowerCase(), data: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
}

function imageTypeFromMime(mime: string): SupportedImageType | null {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
  return null;
}

async function buildImageRunFromSrc(src: string): Promise<ImageRun | null> {
  let data: Buffer | null = null;
  let imageType: SupportedImageType | null = null;

  if (src.startsWith('data:')) {
    const parsed = parseDataUri(src);
    data = parsed?.data || null;
    imageType = parsed ? imageTypeFromMime(parsed.mime) : null;
  } else {
    try {
      const response = await fetchWithTimeout(src, 10_000);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

      if (!response.ok || !contentType.startsWith('image/')) {
        return null;
      }

      data = Buffer.from(await response.arrayBuffer());
      imageType = imageTypeFromMime(contentType);
    } catch {
      return null;
    }
  }

  if (!data || !imageType) return null;
  if (data.length > MAX_DOCX_IMAGE_BYTES) return null;

  return new ImageRun({
    type: imageType,
    data,
    transformation: {
      width: 520,
      height: 300,
    },
  });
}

async function inlineFromNode(node: Node, style: InlineStyle = {}): Promise<ParagraphChild[]> {
  if (node.nodeType === node.TEXT_NODE) {
    const text = collapseWhitespace(node.textContent || '');
    if (!text.trim()) return [];

    return [
      new TextRun({
        text,
        bold: style.bold,
        italics: style.italics,
        font: style.code ? 'Courier New' : undefined,
      }),
    ];
  }

  if (node.nodeType !== node.ELEMENT_NODE) {
    return [];
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (tag === 'strong' || tag === 'b') {
    return inlineFromChildren(element, { ...style, bold: true });
  }

  if (tag === 'em' || tag === 'i') {
    return inlineFromChildren(element, { ...style, italics: true });
  }

  if (tag === 'code') {
    return inlineFromChildren(element, { ...style, code: true });
  }

  if (tag === 'br') {
    return [new TextRun({ text: '', break: 1 })];
  }

  if (tag === 'a') {
    const href = element.getAttribute('href');
    const children = await inlineFromChildren(element, style);

    if (!href) return children;

    const textChildren = children.filter((child): child is TextRun => child instanceof TextRun);

    if (textChildren.length === 0) {
      const fallbackText = collapseWhitespace(element.textContent || '').trim() || href;
      return [new ExternalHyperlink({ link: href, children: [new TextRun({ text: fallbackText })] })];
    }

    return [new ExternalHyperlink({ link: href, children: textChildren })];
  }

  if (tag === 'img') {
    const src = element.getAttribute('src')?.trim();
    if (!src) {
      const alt = element.getAttribute('alt') || 'image unavailable';
      return [new TextRun({ text: `[Image: ${alt}]`, italics: true })];
    }

    const imageRun = await buildImageRunFromSrc(src);
    if (!imageRun) {
      const alt = element.getAttribute('alt') || 'image unavailable';
      return [new TextRun({ text: `[Image: ${alt}]`, italics: true })];
    }

    return [imageRun];
  }

  return inlineFromChildren(element, style);
}

async function inlineFromChildren(element: HTMLElement, style: InlineStyle = {}): Promise<ParagraphChild[]> {
  const children: ParagraphChild[] = [];

  for (const child of Array.from(element.childNodes)) {
    const parts = await inlineFromNode(child, style);
    children.push(...parts);
  }

  return children;
}

function headingForTag(
  tag: string,
): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  if (tag === 'h1') return HeadingLevel.HEADING_1;
  if (tag === 'h2') return HeadingLevel.HEADING_2;
  if (tag === 'h3') return HeadingLevel.HEADING_3;
  if (tag === 'h4') return HeadingLevel.HEADING_4;
  if (tag === 'h5') return HeadingLevel.HEADING_5;
  if (tag === 'h6') return HeadingLevel.HEADING_6;
  return undefined;
}

async function paragraphsFromElement(element: HTMLElement): Promise<Paragraph[]> {
  const tag = element.tagName.toLowerCase();

  const heading = headingForTag(tag);
  if (heading) {
    const children = await inlineFromChildren(element);
    return [
      new Paragraph({
        heading,
        children: children.length > 0 ? children : [new TextRun({ text: '' })],
      }),
    ];
  }

  if (tag === 'p') {
    const children = await inlineFromChildren(element);
    return [new Paragraph({ children })];
  }

  if (tag === 'blockquote') {
    const children = await inlineFromChildren(element);
    return [
      new Paragraph({
        indent: { left: 420 },
        children,
      }),
    ];
  }

  if (tag === 'pre') {
    const text = element.textContent || '';
    return [
      new Paragraph({
        children: [
          new TextRun({
            text,
            font: 'Courier New',
          }),
        ],
      }),
    ];
  }

  if (tag === 'ul') {
    const out: Paragraph[] = [];
    for (const li of Array.from(element.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const children = await inlineFromChildren(li as HTMLElement);
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          children,
        }),
      );
    }
    return out;
  }

  if (tag === 'ol') {
    const out: Paragraph[] = [];
    let index = 1;

    for (const li of Array.from(element.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const children = await inlineFromChildren(li as HTMLElement);
      out.push(
        new Paragraph({
          children: [new TextRun({ text: `${index}. ` }), ...children],
        }),
      );
      index += 1;
    }

    return out;
  }

  if (tag === 'img') {
    const src = element.getAttribute('src')?.trim() || '';
    const imageRun = src ? await buildImageRunFromSrc(src) : null;

    if (imageRun) {
      return [new Paragraph({ children: [imageRun] })];
    }

    const alt = element.getAttribute('alt') || 'image unavailable';
    return [new Paragraph({ children: [new TextRun({ text: `[Image: ${alt}]`, italics: true })] })];
  }

  const out: Paragraph[] = [];
  for (const child of Array.from(element.children)) {
    out.push(...(await paragraphsFromElement(child as HTMLElement)));
  }

  return out;
}

export async function exportDocxBuffer(input: {
  title: string;
  byline: string;
  sourceUrl: string;
  content: string;
}): Promise<Buffer> {
  const dom = new JSDOM(`<body>${input.content}</body>`);

  try {
    const paragraphs: Paragraph[] = [];

    for (const node of Array.from(dom.window.document.body.children)) {
      paragraphs.push(...(await paragraphsFromElement(node as HTMLElement)));
    }

    const document = new Document({
      creator: input.byline || 'Unknown',
      title: input.title,
      description: input.sourceUrl,
      subject: input.sourceUrl,
      sections: [
        {
          children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ children: [new TextRun('')] })],
        },
      ],
    });

    return await Packer.toBuffer(document);
  } finally {
    dom.window.close();
  }
}
