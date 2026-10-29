export type Platform = "netease" | "qq" | "kugou";
export type Quality = "standard" | "high" | "lossless" | "hires";
export type Kind = "song" | "artist" | "album" | "playlist" | "chart";
export type Item = {
  id: string;
  key: string;
  platform: Platform | "local";
  kind: Kind;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  trackCount?: number;
  meta: Record<string, unknown>;
  path?: string;
  format?: string;
  bytes?: number;
  bitrate?: number;
  sampleRate?: number;
  favorite?: boolean;
  addedAt?: number;
};
export type Account = {
  id: string;
  platform: Platform;
  uid: string;
  nickname: string;
  active: boolean;
  verified: boolean;
  updatedAt: number;
  hasCredential: boolean;
};
export type Download = {
  id: string;
  track: Item;
  quality: Quality;
  status:
    | "queued"
    | "resolving"
    | "downloading"
    | "tagging"
    | "completed"
    | "failed"
    | "paused"
    | "cancelled";
  progress: number;
  received: number;
  total: number;
  speed: number;
  message: string;
  path?: string;
  actualQuality?: string;
  metadata?: {
    status: "written" | "partial" | "failed" | "disabled";
    warnings: string[];
    missingFields?: string[];
  };
  createdAt: number;
};
export type Settings = {
  downloadDir: string;
  quality: Quality;
  autoLyrics: boolean;
  autoMetadata: boolean;
  saveTranslation: boolean;
  lyricFormat: "auto" | "lrc" | "elrc" | "ttml";
  lyricSource: "auto" | "platform" | "amll";
  preferredResolver: string;
  groupByPlatform: boolean;
  concurrency: number;
  usePublicFallback: boolean;
  theme: "light" | "dark" | "system";
};
export type Provider = {
  id: Platform;
  name: string;
  enabled: boolean;
  baseUrl: string;
  trustRemoteCredentials: boolean;
  health?: { ok: boolean; latency: number; message: string; checkedAt: number };
};
export type Result = {
  items: Item[];
  errors: { platform: string; message: string }[];
  hasMore: boolean;
};
export type Lyrics = {
  original: string;
  translation: string;
  romanization: string;
  hasWordTiming?: boolean;
  source?: string;
};
export type Bootstrap = {
  version: string;
  settings: Settings;
  accounts: Account[];
  downloads: Download[];
  library: Item[];
  providers: Provider[];
  acceptedDisclaimer: boolean;
  platform: string;
};
export type MusicTags = Record<string, string | number>;
export type TagSnapshot = {
  item: Item;
  tags: MusicTags;
  lyrics: string;
  writable: boolean;
  warning: string;
  revision: string;
  cover: string;
  backupAvailable: boolean;
};
export type TagCandidate = {
  matchId: string;
  source: string;
  sourceName: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  durationDifference: number | null;
  score?: number;
  cover: string;
  releaseId?: string;
  tags: MusicTags;
};
export type TagSaveResult = { items: Item[]; editor: TagSnapshot };
export type TagArtwork = {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
};
export interface API {
  bootstrap(): Promise<Bootstrap>;
  search(q: {
    query: string;
    kind: string;
    platform: string;
    page: number;
    limit: number;
  }): Promise<Result>;
  charts(platform: Platform): Promise<Result>;
  recommend(platform: Platform): Promise<Result>;
  collection(item: Item, page?: number): Promise<Result>;
  resolve(
    item: Item,
    quality: Quality,
  ): Promise<{
    mediaUrl: string;
    source: string;
    quality: string;
    trial: boolean;
  }>;
  lyrics(item: Item): Promise<Lyrics>;
  saveLyrics(
    item: Item,
    options?: string | { format: string; bilingual: boolean; kind?: string },
  ): Promise<string | null>;
  download(
    items: Item[],
    quality: Quality,
  ): Promise<{ added: number; jobs: Download[] }>;
  downloadAction(id: string, action: string): Promise<Download[]>;
  chooseDirectory(): Promise<string | null>;
  scanLibrary(
    folder?: string,
  ): Promise<{ items: Item[]; imported: number; failures: unknown[] } | null>;
  importMusic(): Promise<{
    items: Item[];
    imported: number;
    failures: unknown[];
  } | null>;
  libraryAction(id: string, action: string): Promise<Item[]>;
  tagRead(id: string): Promise<TagSnapshot>;
  tagSave(
    id: string,
    patch: {
      revision: string;
      tags: MusicTags;
      lyrics?: string;
      artwork?: string | null;
    },
  ): Promise<TagSaveResult>;
  tagRestore(id: string, revision: string): Promise<TagSaveResult>;
  tagSaveCopy(
    id: string,
    patch: {
      revision: string;
      tags: MusicTags;
      lyrics?: string;
      artwork?: string | null;
    },
  ): Promise<TagSaveResult | null>;
  tagMatchDetails(
    matchId: string,
  ): Promise<{ tags: MusicTags; missingFields: string[]; warnings: string[] }>;
  tagSearch(input: {
    localId: string;
    query: string;
    source: string;
  }): Promise<{
    items: TagCandidate[];
    errors: { source: string; message: string }[];
  }>;
  tagArtwork(url?: string): Promise<TagArtwork | null>;
  tagMatchCover(matchId: string): Promise<TagArtwork | null>;
  tagMatchLyrics(
    matchId: string,
    options: { format: string; bilingual: boolean },
  ): Promise<{
    text: string;
    source: string;
    format: string;
    hasWordTiming: boolean;
  }>;
  saveSettings(
    patch: Partial<Settings> & { acceptedDisclaimer?: boolean },
  ): Promise<Settings>;
  saveAccount(value: Record<string, unknown>): Promise<Account[]>;
  logout(id: string): Promise<Account[]>;
  accountPlaylists(platform: Platform, page?: number): Promise<Result>;
  openLogin(
    platform: Platform,
    collect?: boolean,
  ): Promise<{ accounts?: Account[] }>;
  auth(
    platform: Platform,
    action: string,
    sessionId?: string,
  ): Promise<{
    sessionId?: string;
    image?: string;
    message: string;
    done?: boolean;
    accounts?: Account[];
  }>;
  profiles(): Promise<{ config: any; summary: Provider[] }>;
  saveProfiles(config: any): Promise<Provider[]>;
  resetProfiles(): Promise<Provider[]>;
  testProvider(
    platform: Platform,
  ): Promise<{ ok: boolean; latency: number; count: number; message: string }>;
  openFolder(id?: string): Promise<void>;
  exportDiagnostics(): Promise<string | null>;
  windowAction(action: string): Promise<void>;
  onDownload(cb: (jobs: Download[]) => void): () => void;
  onLibrary(cb: (items: Item[]) => void): () => void;
}
declare global {
  interface Window {
    sonora: API;
  }
}
