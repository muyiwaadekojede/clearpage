export type ImageMode = 'on' | 'off' | 'captions';
export type ExportFormat = 'pdf' | 'txt' | 'md' | 'docx';
export type BatchInputMode = 'url' | 'document';

export type ExtractErrorCode =
  | 'FETCH_FAILED'
  | 'EXTRACTION_FAILED'
  | 'PAYWALL_DETECTED'
  | 'EMPTY_CONTENT'
  | 'TIMEOUT'
  | 'DIRECT_FILE_URL';

export interface ReaderSettings {
  fontFace: 'serif' | 'sans-serif' | 'monospace' | 'dyslexic';
  fontSize: number;
  lineSpacing: number;
  colorTheme: 'light' | 'dark' | 'sepia';
}

export interface ExtractSuccessResponse {
  success: true;
  extractionId?: string;
  title: string;
  byline: string;
  siteName: string;
  publishedTime: string;
  excerpt: string;
  lang: string;
  content: string;
  contentVariants: Record<ImageMode, string>;
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

export interface BatchDocumentUploadInput {
  uploadId: string;
}
