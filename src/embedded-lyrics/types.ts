export type LyricsFormat = "lrc" | "ttml";

export interface TimedWord {
  text: string;
  start?: number;
  end?: number;
}

export interface LyricLine {
  id: string;
  time: string;
  milliseconds: number | null;
  text: string;
  words?: TimedWord[];
  section?: string;
  voice?: string;
  existing?: string;
  existingLanguage?: string;
  translations?: Record<string, string>;
  sameTimeCandidates?: string[];
}

export interface EmbeddedLyrics {
  id: string;
  name: string;
  format: LyricsFormat | null;
  lines: LyricLine[];
  error?: string;
}

export interface Alignment {
  id: string;
  fragments: number[];
  evidence: "timestamp" | "source" | "order" | "manual";
}

export interface PastedLine {
  index: number;
  text: string;
  milliseconds: number | null;
  sourceText?: string;
  fromSearch?: true;
}

export interface WriteRequest {
  fieldId: string;
  language: string;
  translations: Record<string, string>;
  overwrite: boolean;
  lrcReplaceIds: string[];
}
