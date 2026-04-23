export type ImageMode = 'on' | 'off' | 'captions';
export type ExportFormat = 'pdf' | 'txt' | 'md' | 'docx';

export type ExtractErrorCode =
  | 'FETCH_FAILED'
  | 'EXTRACTION_FAILED'
  | 'PAYWALL_DETECTED'
  | 'EMPTY_CONTENT'
  | 'TIMEOUT';

export interface ReaderSettings {
  fontFace: 'serif' | 'sans-serif' | 'monospace' | 'dyslexic';
  fontSize: number;
  lineSpacing: number;
  colorTheme: 'light' | 'dark' | 'sepia';
}

export interface ExtractSuccessResponse {
  success: true;
  title: string;
  byline: string;
  siteName: string;
  publishedTime: string;
  excerpt: string;
  lang: string;
  content: string;
  textContent: string;
  wordCount: number;
  imageCount: number;
  sourceUrl: string;
}

export interface ExtractErrorResponse {
  success: false;
  errorCode: ExtractErrorCode;
  errorMessage: string;
}

export type ExtractResponse = ExtractSuccessResponse | ExtractErrorResponse;
