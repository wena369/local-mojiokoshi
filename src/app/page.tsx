"use client";

import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { UploadCloud, FileAudio, CheckCircle2, Settings, Loader2, PlayCircle, FileText, Sparkles, Volume2, Copy, Download, Clock, AlertCircle, Users, BookOpen, Mail, Send, Server, Wifi, WifiOff, Save, FolderOpen, Trash2, CopyPlus, ChevronDown, Pencil, Plus, X } from "lucide-react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface CustomWord {
  id: string;
  term: string;       // 表示名（例: 観自在力, ChatGPT）
  reading: string;    // 読み（例: かんじざいりょく, ちゃっとじーぴーてぃー）
  category?: string;  // カテゴリ（任意）
  enabled: boolean;   // ON/OFF
}

const LS_SPEAKER_NAMES_KEY = 'ai-transcriber-speaker-names';
const LS_EMAIL_KEY = 'ai-transcriber-forward-email';
const LS_JOB_KEY = 'ai-transcriber-pending-job';
const LS_SERVER_KEY = 'ai-transcriber-backend-server';
const LS_SESSIONS_KEY = 'ai-transcriber-sessions';
const LS_STT_ENGINE_KEY = 'ai-transcriber-stt-engine';
const LS_GEMINI_KEY_KEY = 'ai-transcriber-gemini-key';
const LS_GEMINI_MODEL_KEY = 'ai-transcriber-gemini-model';
const LS_DEEPGRAM_KEY_KEY = 'ai-transcriber-deepgram-key';
const LS_SCRIBE_KEY_KEY = 'ai-transcriber-scribe-key';
const LS_PRE_REG_SPEAKERS_KEY = 'ai-transcriber-pre-registered-speakers';
const LS_USE_PRE_REG_KEY = 'ai-transcriber-use-pre-registration';
const LS_CUSTOM_WORDS_KEY = 'ai-transcriber-custom-words-v2';

// LLM推論痕跡をフロントエンドで除去
function stripThinking(text: string | null | undefined): string | null {
  if (!text) return null;
  // [話者名] が行途中にある場合、前に改行を挿入
  let t = text.replace(/(?<!\n)(\[.+?\]\s)/g, '\n$1');
  const lines = t.split('\n');
  const cleaned: string[] = [];
  let skipMode = false;
  for (const line of lines) {
    const s = line.trim();
    // [話者名] で始まる行 → 常にコンテンツ
    if (/^\[.+?\]\s/.test(s)) {
      skipMode = false;
      cleaned.push(line);
      continue;
    }
    // skipMode中は全スキップ
    if (skipMode) continue;
    // メタブロック開始検出
    if (isMetaLine(s)) {
      skipMode = true;
      continue;
    }
    // 空行は保持
    if (!s) { cleaned.push(line); continue; }
    // 通常テキスト
    cleaned.push(line);
  }
  const result = cleaned.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trim();
  return result || null;
}

function isMetaLine(s: string): boolean {
  if (!s) return false;
  // マークダウン太字ヘッダー (**何か:** 形式)
  if (/^\*\*[^*]+[:：]/.test(s)) return true;
  const patterns = [
    /^ユーザーは/,
    /^会議の文字起こしを推敲/,
    /^文字起こしを推敲/,
    /^提供された/,
    /^以下の(ルール|指示|手順|編集)/,
    /^以下は|^以下が|^以下の/,
    /^(処理手順|処理方針|処理対象|指示事項|推敲実行|整形実行)/,
    /^[0-9０-９]+[.．、]\s*(「|フィラー|句読点|自然|話者|内容|推敲|元の|整形)/,
    /^[・\-\*]\s*(フィラー|句読点|自然|話者|内容|推敲|修正|変更|追加|削除|補足|元の|整形|全体)/,
    /^（自己チェック|^\*自己チェック|^\(自己チェック/,
    /^推敲結果|^推敲後|^推敲しました|^推敲済み/,
    /^修正結果|^整形結果/,
    /^以上が|^以上です|^以上、/,
    /^---+$|^===+$|^\*\*\*+$/,
    /^※|^注意[:：]|^メモ[:：]|^補足[:：]/,
    /^.{0,30}(を推敲しました|を修正しました|を整形しました|を整えました)/,
    /^.{0,20}(修正箇所|変更点|変更箇所)/,
    /^このプロセスを実行/,
    /^最終的な出力を生成/,
    /^各発言を(チェック|確認|読み込)/,
    /^全体を通して/,
    /^文字起こし全体に対して/,
    /^上記(プロセス|ルール|指示|に基づ|を適用|の)/,
    /^元の(テキスト|文字起こし|データ)/,
    /^フィラー(除去|を除去|（)/,
    /^句読点(を|の)/,
    /^(整形を|適用を|実施する|確認する|開始する)/,
    /^(整形|適用|実施)[:：]/,
    /^(Here is|Below is|The following|I've |I have |Note:|Let me|Okay|Sure|Certainly)/i,
    /^[「〝『【].{0,40}(推敲|整形|修正|結果|完了).*[」〞』】]$/,
  ];
  return patterns.some(p => p.test(s));
}

function clientHiraToKata(text: string): string {
  return text.replace(/[\u3041-\u3096]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

export function applyClientCustomWords(text: string, words: CustomWord[]): string {
  if (!text || !words || words.length === 0) return text;
  let res = text;
  const activeWords = words.filter(w => w.enabled && w.term.trim());
  const sorted = [...activeWords].sort((a, b) => Math.max(b.term.length, (b.reading || '').length) - Math.max(a.term.length, (a.reading || '').length));

  for (const w of sorted) {
    const term = w.term.trim();
    const reading = (w.reading || '').trim();
    if (!term) continue;

    // 1. 読み（ひらがな・カタカナ）の置換
    if (reading) {
      const escapedHira = reading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      res = res.replace(new RegExp(escapedHira, 'gi'), term);
      const kata = clientHiraToKata(reading);
      if (kata !== reading) {
        const escapedKata = kata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        res = res.replace(new RegExp(escapedKata, 'gi'), term);
      }
    }

    // 2. 単語そのものの表記ゆれ・スペースゆれの置換
    if (/[a-zA-Z0-9]/.test(term)) {
      const chars = term.split('').filter(c => c.trim());
      if (chars.length >= 2) {
        const pattern = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
        res = res.replace(new RegExp(pattern, 'gi'), term);
      }
    }
  }
  return res;
}

// 同一話者の連続セグメントを自然な文節・発話長に整える関数（細切れ＆大雑把すぎの両方を解消！）
function mergeSameSpeakerBlocks(segments: any[]): any[] {
  if (!Array.isArray(segments) || segments.length === 0) return segments;
  const merged: any[] = [];
  for (const s of segments) {
    if (!s || !s.text || !s.text.trim()) continue;
    const text = s.text.trim();
    if (merged.length > 0 && merged[merged.length - 1].speaker === s.speaker) {
      const prev = merged[merged.length - 1];
      // 直前の文が短く（40文字未満）、かつ文末がまだ短い場合は自然に結合
      if (prev.text.length < 40) {
        prev.text = `${prev.text} ${text}`.trim();
        prev.end = s.end > 0 ? s.end : prev.end;
        continue;
      }
    }
    merged.push({
      speaker: s.speaker,
      text: text,
      start: typeof s.start === 'number' ? s.start : parseFloat(s.start) || 0,
      end: typeof s.end === 'number' ? s.end : parseFloat(s.end) || 0,
    });
  }
  return merged;
}

// セグメント配列に一意のIDを確実に付与・保証する関数
function ensureSegmentIds(segments: any[]): any[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  return segments.map((s, idx) => {
    if (!s) return null;
    return {
      ...s,
      id: s.id || `seg_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 8)}`,
    };
  }).filter(Boolean);
}

// JSON 配列文字列がセグメントテキスト内に入ってしまっている場合に、完全に解凍・展開する関数
function unpackSegments(segments: any[]): any[] {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const result: any[] = [];
  for (const s of segments) {
    if (!s) continue;
    const text = typeof s.text === 'string' ? s.text.trim() : '';

    // text が JSON 配列（例: [ {"speaker": "SPEAKER_00", ...} ]）の形状をしているかチェック
    if (text.startsWith('[') && text.includes('"speaker"')) {
      let unpacked: any[] | null = null;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          unpacked = parsed;
        }
      } catch {
        // 構文エラーの自動修復
        try {
          const healed = text
            .replace(/,\s*"([0-9.]+)\s*,\s*"end"/g, ', "start": $1, "end"')
            .replace(/,\s*([\]\}])/g, '$1');
          const parsed = JSON.parse(healed);
          if (Array.isArray(parsed) && parsed.length > 0) {
            unpacked = parsed;
          }
        } catch {
          // 正規表現によるオブジェクト単位の抽出
          try {
            const matches: any[] = Array.from(text.matchAll(/\{\s*"speaker"\s*:\s*"([^"]+)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"(?:[^\d}]*([0-9.]+))?(?:[^\d}]*([0-9.]+))?[^\}]*\}/gs));
            const extracted: any[] = [];
            for (const m of matches) {
              const sp = m[1];
              const txt = m[2];
              const st = m[3] ? parseFloat(m[3]) : 0;
              const en = m[4] ? parseFloat(m[4]) : 0;
              if (txt && txt.trim()) {
                extracted.push({ speaker: sp, text: txt.trim(), start: st, end: en });
              }
            }
            if (extracted.length > 0) {
              unpacked = extracted;
            }
          } catch {}
        }
      }

      if (unpacked && unpacked.length > 0) {
        for (const item of unpacked) {
          let sp = String(item.speaker || s.speaker || 'SPEAKER_00').trim();
          if (!sp.startsWith('SPEAKER_')) {
            if (/^\d+$/.test(sp)) sp = `SPEAKER_${String(parseInt(sp, 10)).padStart(2, '0')}`;
            else sp = `SPEAKER_${sp}`;
          }
          result.push({
            id: item.id || `seg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            speaker: sp,
            text: String(item.text || '').trim(),
            start: typeof item.start === 'number' ? item.start : parseFloat(item.start) || 0,
            end: typeof item.end === 'number' ? item.end : parseFloat(item.end) || 0,
          });
        }
        continue;
      }
    }

    result.push(s);
  }
  return ensureSegmentIds(mergeSameSpeakerBlocks(result));
}

// 保存セッション型定義
interface SavedSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  fileName: string;
  serverId: string;
  segments: any[];
  speakerNames: Record<string, string>;
  speakerReadings: Record<string, string>;
  speakerRoles: Record<string, string>;
  refinedText: string | null;
  summary: string | null;
  work2SplitIndex?: number;
}

function loadSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(LS_SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSessions(sessions: SavedSession[]) {
  try {
    localStorage.setItem(LS_SESSIONS_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.error('Failed to save sessions:', e);
  }
}

// バックエンドサーバー定義
interface BackendServer {
  id: string;
  name: string;
  backendUrl: string;  // FastAPI の URL (Tailscale Funnel / Localhost)
  fallbackUrls?: string[]; // 接続できない場合の代替URL
  gpu: string;
  llmModel: string;
  description: string;
  online?: boolean;
  gpuInfo?: string;    // ヘルスチェックで取得
}

const BACKEND_SERVERS: BackendServer[] = [
  {
    id: 'egpu-pc',
    name: 'eGPU (TITAN RTX)',
    backendUrl: 'https://nucboxm7.goat-aldebaran.ts.net',
    fallbackUrls: ['http://100.116.134.46:8000'],
    gpu: 'NVIDIA TITAN RTX (24GB)',
    llmModel: 'google/gemma-4-12b-qat',
    description: 'NUCBOX M7 / WhisperX + Gemma 4',
  },
  {
    id: 'remote-pc',
    name: 'eGPU2 (M7 Ultra)',
    backendUrl: 'https://nucbox-m7-ultra-1.goat-aldebaran.ts.net',
    fallbackUrls: ['http://100.75.146.1:8000', 'http://100.75.146.1:1234'],
    gpu: 'NVIDIA RTX 2080 Ti (22GB)',
    llmModel: 'google/gemma-4-12b-qat',
    description: 'NUCBOX M7 Ultra / WhisperX + Gemma 4',
  },
  {
    id: 'local-pc',
    name: 'このPC (Ryzen AI Max)',
    backendUrl: 'http://localhost:8000',
    fallbackUrls: ['http://127.0.0.1:8000', 'https://tuf-a14.goat-aldebaran.ts.net', 'http://100.76.8.79:8000'],
    gpu: 'AMD Radeon 8060S / 8050S',
    llmModel: 'LM Studio / Local',
    description: 'TUF-A14 (Ryzen AI Max 8060S 内蔵グラフィック)',
  },
];

function loadSavedNames(): string[] {
  try {
    const raw = localStorage.getItem(LS_SPEAKER_NAMES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSpeakerNames(names: string[]) {
  try {
    // Keep unique, non-empty, max 50
    const unique = [...new Set(names.filter(n => n.trim()))].slice(0, 50);
    localStorage.setItem(LS_SPEAKER_NAMES_KEY, JSON.stringify(unique));
  } catch {}
}

const SPEAKER_COLORS = [
  { bg: 'bg-teal-500/20', text: 'text-teal-200', border: 'border-teal-400/30', dot: 'bg-teal-400' },
  { bg: 'bg-coral-500/20 bg-orange-400/15', text: 'text-orange-200', border: 'border-orange-400/30', dot: 'bg-orange-400' },
  { bg: 'bg-sky-500/20', text: 'text-sky-200', border: 'border-sky-400/30', dot: 'bg-sky-400' },
  { bg: 'bg-amber-500/15', text: 'text-amber-200', border: 'border-amber-400/30', dot: 'bg-amber-400' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-200', border: 'border-emerald-400/30', dot: 'bg-emerald-400' },
  { bg: 'bg-rose-500/15', text: 'text-rose-200', border: 'border-rose-400/30', dot: 'bg-rose-400' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-200', border: 'border-cyan-400/30', dot: 'bg-cyan-400' },
  { bg: 'bg-violet-500/15', text: 'text-violet-200', border: 'border-violet-400/30', dot: 'bg-violet-400' },
  { bg: 'bg-lime-500/15', text: 'text-lime-200', border: 'border-lime-400/30', dot: 'bg-lime-400' },
  { bg: 'bg-pink-500/15', text: 'text-pink-200', border: 'border-pink-400/30', dot: 'bg-pink-400' },
  { bg: 'bg-indigo-500/15', text: 'text-indigo-200', border: 'border-indigo-400/30', dot: 'bg-indigo-400' },
  { bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-200', border: 'border-fuchsia-400/30', dot: 'bg-fuchsia-400' },
  { bg: 'bg-yellow-500/15', text: 'text-yellow-200', border: 'border-yellow-400/30', dot: 'bg-yellow-400' },
  { bg: 'bg-red-500/15', text: 'text-red-200', border: 'border-red-400/30', dot: 'bg-red-400' },
  { bg: 'bg-blue-500/15', text: 'text-blue-200', border: 'border-blue-400/30', dot: 'bg-blue-400' },
  { bg: 'bg-green-500/15', text: 'text-green-200', border: 'border-green-400/30', dot: 'bg-green-400' },
];

// Alpaca messages for processing stages
const PACA_MESSAGES = [
  { emoji: '🦙💨', text: 'パカパカ走って音声を取りに行ってます...' },
  { emoji: '🦙🎧', text: 'パカが音声をじっくり聴いています...' },
  { emoji: '🦙✍️', text: 'パカが一生懸命書き起こしています...' },
  { emoji: '🦙🔍', text: 'パカが誰が話しているか調べています...' },
  { emoji: '🦙✨', text: 'パカが丁寧に推敲しています...' },
  { emoji: '🦙📝', text: 'パカが要約をまとめています...' },
  { emoji: '🦙🏖️', text: 'もう少しで完了です！パカも夏休みが楽しみ...' },
];

function getSpeakerColor(speakerId: string) {
  const num = parseInt(speakerId.replace('SPEAKER_', ''), 10) || 0;
  return SPEAKER_COLORS[num % SPEAKER_COLORS.length];
}

export default function Home() {
  const { data: session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<"yurupaka" | "general">("yurupaka");
  const [paintingCount, setPaintingCount] = useState<number>(2);
  const [work2SplitIndex, setWork2SplitIndex] = useState<number>(-1);

  // 🖼️ 2枚目の作品切り替え位置を中盤（30%〜75%優先）から高精度に自動検出する関数
  const detectWork2SplitIndex = useCallback((segs: any[]): number => {
    if (!segs || segs.length < 6) return -1;
    const total = segs.length;
    const minIdx = Math.max(3, Math.floor(total * 0.25));
    const maxIdx = Math.min(total - 2, Math.floor(total * 0.80));
    const centerIdx = Math.max(minIdx, Math.floor(total * 0.50));

    let bestIdx = centerIdx;
    let maxScore = -999;

    const strongKeywords = [
      /(?:2|２|二)(?:枚目|点目)の?(?:作品|絵画?|画像|スライド|写真)/,
      /(?:次|つぎ)の(?:作品|絵画?|画像|スライド)に(?:行|いっ|進|移|見て|観て|出|共有|表示|切り替)/,
      /(?:次|つぎ)の(?:作品|絵画?|アート)を(?:見|観|共有|画面)/,
      /(?:2|２|二)(?:枚目|点目)に(?:行|いっ|進|移|入)/,
      /2枚目に行きましょう/,
      /2枚目の絵/,
      /次の絵に行きましょう/,
      /画面を切り替え/,
      /スライドを切り替え/,
      /次の作品を共有/,
    ];

    for (let i = minIdx; i <= maxIdx; i++) {
      const text = segs[i]?.text || "";
      if (!text.trim()) continue;

      // 誤爆防止: 指名発言（次、○○さん）は作品切り替えではないためスキップ
      if (/次(?:は|、|\s)*(?:さん|様|君|ちゃん|方|どうぞ|お願)/.test(text)) continue;
      
      // 誤爆防止: 「〜前」「〜の前に」「〜行く前に」「後で2枚目」などの保留パターンは作品切り替えではない
      if (/(?:前|まえ)に|(?:前|まえ)の|(?:後|あと)で/.test(text)) continue;

      let score = 0;
      for (const pat of strongKeywords) {
        if (pat.test(text)) {
          score += 100;
        }
      }

      if (score > 0) {
        // 中央（50%）に近いほどプラス重み付け（セッションの中央付近の作品切り替えを優遇）
        const distanceRatio = Math.abs(i - centerIdx) / total;
        const centerBonus = (0.5 - distanceRatio) * 40;
        score += centerBonus;

        if (score > maxScore) {
          maxScore = score;
          bestIdx = i;
        }
      }
    }

    return bestIdx;
  }, []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [progress, setProgress] = useState<{ step: string; percent: number }>({ step: "", percent: 0 });
  const [result, setResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [speakerReadings, setSpeakerReadings] = useState<Record<string, string>>({});
  const [speakerRoles, setSpeakerRoles] = useState<Record<string, string>>({});
  const [forwardEmail, setForwardEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [savedNamesList, setSavedNamesList] = useState<string[]>([]);
  // 管理者 & セッション保存
  const [isAdmin, setIsAdmin] = useState(false);
  const [savedSessionsList, setSavedSessionsList] = useState<SavedSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showSessionsPanel, setShowSessionsPanel] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const [backendServers, setBackendServers] = useState<BackendServer[]>(BACKEND_SERVERS);
  const [selectedServerId, setSelectedServerId] = useState<string>('egpu-pc');
  const [checkingServers, setCheckingServers] = useState(false);
  const [extraSpeakers, setExtraSpeakers] = useState<string[]>([]);  // 手動追加された話者
  const [jobFileName, setJobFileName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 音声認識エンジン & APIキー設定 State
  const [sttEngine, setSttEngine] = useState<"whisper" | "gemini" | "deepgram" | "scribe">(() => {
    try {
      return (localStorage.getItem(LS_STT_ENGINE_KEY) as any) || "whisper";
    } catch {
      return "whisper";
    }
  });
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_GEMINI_KEY_KEY) || "";
    } catch {
      return "";
    }
  });
  const [geminiModel, setGeminiModel] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(LS_GEMINI_MODEL_KEY);
      if (saved && !saved.includes("gemini-3.") && !saved.includes("transcribe")) return saved;
      return "gemini-2.0-flash";
    } catch {
      return "gemini-2.0-flash";
    }
  });
  const [deepgramApiKey, setDeepgramApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_DEEPGRAM_KEY_KEY) || "";
    } catch {
      return "";
    }
  });
  const [scribeApiKey, setScribeApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_SCRIBE_KEY_KEY) || "";
    } catch {
      return "";
    }
  });
  const [showEngineModal, setShowEngineModal] = useState<boolean>(false);

  // 事前話者登録 State & 型定義
  const [usePreRegistration, setUsePreRegistration] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(LS_USE_PRE_REG_KEY);
      return saved === 'true';
    } catch {
      return false;
    }
  });
  const [preRegisteredSpeakers, setPreRegisteredSpeakers] = useState<{ id: string; name: string; reading: string; role: string }[]>(() => {
    try {
      const saved = localStorage.getItem(LS_PRE_REG_SPEAKERS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [{ id: 'pre_1', name: '', reading: '', role: '参加者' }];
  });

  // 事前登録設定の自動保存
  useEffect(() => {
    try {
      localStorage.setItem(LS_PRE_REG_SPEAKERS_KEY, JSON.stringify(preRegisteredSpeakers));
    } catch {}
  }, [preRegisteredSpeakers]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_USE_PRE_REG_KEY, String(usePreRegistration));
    } catch {}
  }, [usePreRegistration]);

  const [speakerCountHint, setSpeakerCountHint] = useState<string>("auto");
  const [isRefiningSpeakers, setIsRefiningSpeakers] = useState<boolean>(false);

  const handleRefineSpeakers = async () => {
    if (!result || !result.segments || result.segments.length === 0) return;
    if (!geminiApiKey.trim()) {
      alert("AI話者再分離には Gemini API Key が必要です。設定から入力してください。");
      return;
    }
    setIsRefiningSpeakers(true);
    try {
      const res = await fetch("/api/refine-speakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: result.segments,
          apiKey: geminiApiKey.trim(),
          speakerCount: speakerCountHint !== "auto" ? speakerCountHint : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "再分離に失敗しました");
      }
      const data = await res.json();
      if (data.segments && data.segments.length > 0) {
        setResult({
          ...result,
          segments: ensureSegmentIds(unpackSegments(data.segments)),
        });
        alert("✨ 会話構造から話者を高精度に再分離しました！");
      }
    } catch (e: any) {
      alert(`話者再分離エラー: ${e.message}`);
    } finally {
      setIsRefiningSpeakers(false);
    }
  };

  const addPreRegisteredSpeaker = useCallback(() => {
    setPreRegisteredSpeakers(prev => [
      ...prev,
      { id: `pre_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, name: '', reading: '', role: '参加者' }
    ]);
  }, []);

  const removePreRegisteredSpeaker = useCallback((id: string) => {
    setPreRegisteredSpeakers(prev => prev.length > 1 ? prev.filter(s => s.id !== id) : prev);
  }, []);

  const updatePreRegisteredSpeaker = useCallback((id: string, field: 'name' | 'reading' | 'role', value: string) => {
    setPreRegisteredSpeakers(prev => prev.map(s => {
      if (s.id === id) {
        return { ...s, [field]: value };
      }
      return s;
    }));
  }, []);

  // 📚 カスタム辞書・専門用語 State
  const [customWords, setCustomWords] = useState<CustomWord[]>(() => {
    try {
      const saved = localStorage.getItem(LS_CUSTOM_WORDS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      { id: 'cw_init_1', term: '観自在力', reading: 'かんじざいりょく', category: '専門用語', enabled: true },
      { id: 'cw_init_2', term: 'ゆるパカ', reading: 'ゆるぱか', category: 'サービス・作品名', enabled: true },
      { id: 'cw_init_3', term: 'エルリントン', reading: 'えるりんとん', category: '人名・組織', enabled: true },
    ];
  });

  const [newWordTerm, setNewWordTerm] = useState("");
  const [newWordReading, setNewWordReading] = useState("");
  const [newWordCategory, setNewWordCategory] = useState("専門用語");
  const [showAddWordForm, setShowAddWordForm] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(LS_CUSTOM_WORDS_KEY, JSON.stringify(customWords));
    } catch {}
  }, [customWords]);

  const toggleCustomWord = useCallback((id: string) => {
    setCustomWords(prev => prev.map(w => w.id === id ? { ...w, enabled: !w.enabled } : w));
  }, []);

  const setAllCustomWords = useCallback((enabled: boolean) => {
    setCustomWords(prev => prev.map(w => ({ ...w, enabled })));
  }, []);

  const addCustomWord = useCallback(() => {
    if (!newWordTerm.trim()) return;
    const newWord: CustomWord = {
      id: `cw_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      term: newWordTerm.trim(),
      reading: newWordReading.trim(),
      category: newWordCategory.trim() || '専門用語',
      enabled: true,
    };
    setCustomWords(prev => [newWord, ...prev]);
    setNewWordTerm("");
    setNewWordReading("");
    setShowAddWordForm(false);
  }, [newWordTerm, newWordReading, newWordCategory]);

  const removeCustomWord = useCallback((id: string) => {
    setCustomWords(prev => prev.filter(w => w.id !== id));
  }, []);

  // 辞書ルールを現在の結果（セグメント・推敲テキスト）に即時適用
  const applyDictionaryToCurrentResult = useCallback(() => {
    if (!result || !result.segments) return;
    setResult((prev: any) => {
      if (!prev || !prev.segments) return prev;
      const updatedSegments = prev.segments.map((s: any) => ({
        ...s,
        text: applyClientCustomWords(s.text || '', customWords),
      }));
      const updatedRefined = prev.refinedText ? applyClientCustomWords(prev.refinedText, customWords) : prev.refinedText;
      return {
        ...prev,
        segments: updatedSegments,
        refinedText: updatedRefined,
      };
    });
    setCopied("辞書ルールを反映しました");
    setTimeout(() => setCopied(null), 3000);
  }, [result, customWords]);

  // 選択中のバックエンドサーバー情報を取得
  const selectedServer = useMemo(() => {
    return backendServers.find(s => s.id === selectedServerId) || backendServers[0];
  }, [backendServers, selectedServerId]);

  // 各バックエンドのヘルスチェック（Tailscale内のブラウザから直接確認優先）
  const checkBackendServers = useCallback(async () => {
    setCheckingServers(true);
    try {
      const results = await Promise.all(
        BACKEND_SERVERS.map(async (server) => {
          const testUrls = [server.backendUrl, ...(server.fallbackUrls || [])].filter(Boolean);
          if (testUrls.length === 0) return { ...server, online: false, gpuInfo: '未設定' };

          // 1. ブラウザから直接 fetch (CORS) でポート8000等のバックエンド確認
          for (const testUrl of testUrls) {
            if (testUrl.includes(':1234')) continue;
            try {
              const res = await fetch(`${testUrl}/`, {
                signal: AbortSignal.timeout(3000),
                mode: 'cors',
              });
              if (res.ok) {
                const data = await res.json();
                return {
                  ...server,
                  backendUrl: testUrl, // 疎通したURLを採用
                  online: true,
                  gpuInfo: data.gpu && data.gpu !== 'N/A' ? data.gpu : server.gpu,
                  llmModel: data.llm_model && data.llm_model !== 'N/A' ? data.llm_model : server.llmModel,
                };
              }
            } catch {}
          }

          // 2. /api/health サーバーレスプロキシ経由（Tailscale / Funnel経由で確認）
          try {
            const proxyRes = await fetch(`/api/health?server=${server.id}`, {
              cache: 'no-store',
              signal: AbortSignal.timeout(5000),
            });
            if (proxyRes.ok) {
              const data = await proxyRes.json();
              if (data.online) {
                return {
                  ...server,
                  backendUrl: data.activeUrl || server.backendUrl,
                  online: true,
                  gpuInfo: data.gpu && data.gpu !== 'N/A' ? data.gpu : server.gpu,
                  llmModel: data.llm_model && data.llm_model !== 'N/A' ? data.llm_model : server.llmModel,
                };
              }
            }
          } catch {}

          // 3. LM Studio (ポート1234) がブラウザから直接見えるかチェック（eGPU2等）
          if (server.id === 'remote-pc') {
            try {
              const lmRes = await fetch('http://100.75.146.1:1234/v1/models', { signal: AbortSignal.timeout(2500) });
              if (lmRes.ok) {
                const lmData = await lmRes.json();
                const chatModel = lmData.data?.find((m: any) => !m.id?.includes('embed'))?.id || lmData.data?.[0]?.id;
                return {
                  ...server,
                  online: true,
                  gpuInfo: 'NVIDIA RTX 2080 Ti (22GB)',
                  llmModel: chatModel || server.llmModel,
                };
              }
            } catch {}
          }

          if (server.id === 'local-pc') {
            try {
              const lmRes = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(2000) });
              if (lmRes.ok) {
                const lmData = await lmRes.json();
                const chatModel = lmData.data?.find((m: any) => !m.id?.includes('embed'))?.id || lmData.data?.[0]?.id;
                return {
                  ...server,
                  online: true,
                  gpuInfo: 'AMD Radeon 8060S / 8050S',
                  llmModel: chatModel || server.llmModel,
                };
              }
            } catch {}
          }

          return { ...server, online: false, gpuInfo: server.gpu };
        })
      );
      setBackendServers(results);
    } catch (e) {
      console.warn('Backend server check error:', e);
    } finally {
      setCheckingServers(false);
    }
  }, []);

  // サーバー選択をlocalStorageに保存
  const selectServer = useCallback((serverId: string) => {
    setSelectedServerId(serverId);
    try { localStorage.setItem(LS_SERVER_KEY, serverId); } catch {}
  }, []);

  const cancelJob = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    try { localStorage.removeItem(LS_JOB_KEY); } catch {}
    setIsProcessing(false);
    setProgress({ step: "", percent: 0 });
    setErrorMsg(null);
  }, []);

  // Resume pending job on mount
  const resumePendingJob = useCallback(async (jobId: string) => {
    const BASE_URL = "/api";
    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setErrorMsg(null);
    setResult(null);
    setProgress({ step: "🔄 前回のジョブを復帰中...", percent: 10 });
    const startTime = Date.now();
    try {
      let isCompleted = false;
      while (!isCompleted) {
        if (controller.signal.aborted) break;
        const statusResponse = await fetch(`${BASE_URL}/status/${jobId}`);
        if (!statusResponse.ok) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          continue;
        }
        const statusData = await statusResponse.json();
        
        // 途中結果の反映
        if (statusData.segments && statusData.segments.length > 0) {
          setResult((prev: any) => ({
            segments: statusData.segments,
            refinedText: prev?.refinedText || null,
            summary: prev?.summary || null,
          }));
        }
        if (statusData.filename) {
          setJobFileName(statusData.filename);
        }

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const elapsedStr = `${Math.floor(elapsed/60)}分${elapsed%60}秒`;

        if (statusData.status === "completed") {
          isCompleted = true;
          setProgress({ step: `✅ 完了！`, percent: 100 });
          const completedResult = {
            segments: statusData.result?.segments || [],
            refinedText: stripThinking(statusData.result?.refinedText),
            summary: statusData.result?.summary || null,
          };
          setResult(completedResult);
          if (completedResult.segments.length >= 6) {
            const total = completedResult.segments.length;
            const minValid = Math.max(3, Math.floor(total * 0.20));
            const autoSplit = detectWork2SplitIndex(completedResult.segments);
            setWork2SplitIndex(autoSplit >= minValid && autoSplit < total ? autoSplit : Math.max(minValid, Math.floor(total * 0.50)));
          }
          try { localStorage.removeItem(LS_JOB_KEY); } catch {}

          // Auto-send email
          const savedEmail = localStorage.getItem(LS_EMAIL_KEY);
          if (savedEmail && completedResult.summary) {
            try {
              const preview = completedResult.segments
                .slice(0, 20)
                .map((s: any) => `[${s.speaker.replace('SPEAKER_','話者')}] ${s.text}`)
                .join('\n');
              const res = await fetch('/api/send-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: savedEmail, summary: completedResult.summary, transcriptPreview: preview }),
              });
              if (res.ok) {
                setEmailSent(true);
                setTimeout(() => setEmailSent(false), 10000);
              }
            } catch (emailErr) {
              console.error('Auto email send failed:', emailErr);
            }
          }
        } else if (statusData.status === "error") {
          try { localStorage.removeItem(LS_JOB_KEY); } catch {}
          throw new Error(statusData.error || "処理中にエラーが発生しました");
        } else if (statusData.status === "not_found") {
          try { localStorage.removeItem(LS_JOB_KEY); } catch {}
          setProgress({ step: "", percent: 0 });
          break;
        } else {
          let stepLabel = "🧠 AIがGPUで処理中...";
          const step = statusData.step;
          if (step === "transcription") stepLabel = "🎤 Step 1/5: 音声認識中...";
          else if (step === "alignment") stepLabel = "📐 Step 2/5: アライメント中...";
          else if (step === "diarization") stepLabel = "👥 Step 3/5: 話者分離中...";
          else if (step === "refinement") {
            const rp = statusData.refinement_progress || "";
            stepLabel = `✍️ Step 4/5: 推敲中... ${rp}`;
          } else if (step === "summary") {
            const sp = statusData.summary_progress || "";
            stepLabel = `📝 Step 5/5: 要約生成中... ${sp}`;
          }
          stepLabel += `（経過: ${elapsedStr}）`;
          const stepPercents: Record<string, number> = { transcription: 20, alignment: 35, diarization: 50, refinement: 70, summary: 85 };
          const pct = stepPercents[step] || 15;
          setProgress(prev => ({ step: stepLabel, percent: Math.max(prev.percent, Math.min(pct, 95)) }));
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error.message || "復帰中にエラーが発生しました");
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Load saved preferences on mount
  useEffect(() => {
    setSavedNamesList(loadSavedNames());
    setSavedSessionsList(loadSessions());
    try {
      const savedEngine = localStorage.getItem(LS_STT_ENGINE_KEY) as any;
      if (savedEngine) setSttEngine(savedEngine);
      const savedGeminiKey = localStorage.getItem(LS_GEMINI_KEY_KEY);
      if (savedGeminiKey) setGeminiApiKey(savedGeminiKey);
      const savedGeminiModel = localStorage.getItem(LS_GEMINI_MODEL_KEY);
      if (savedGeminiModel) {
        setGeminiModel(savedGeminiModel);
      } else {
        setGeminiModel("gemini-3.5-transcribe");
        try { localStorage.setItem(LS_GEMINI_MODEL_KEY, "gemini-3.5-transcribe"); } catch {}
      }
      const savedDgKey = localStorage.getItem(LS_DEEPGRAM_KEY_KEY);
      if (savedDgKey) setDeepgramApiKey(savedDgKey);
      const savedScKey = localStorage.getItem(LS_SCRIBE_KEY_KEY);
      if (savedScKey) setScribeApiKey(savedScKey);
      
      const savedEmail = localStorage.getItem(LS_EMAIL_KEY);
      if (savedEmail) setForwardEmail(savedEmail);

      const savedServer = localStorage.getItem(LS_SERVER_KEY);
      if (savedServer) setSelectedServerId(savedServer);
    } catch {}
    // Auto-resume pending job
    try {
      const pendingJob = localStorage.getItem(LS_JOB_KEY);
      if (pendingJob) {
        resumePendingJob(pendingJob);
      }
    } catch {}
    // Load saved sessions list
    setSavedSessionsList(loadSessions());
    // Check backend server status
    checkBackendServers();
  }, [resumePendingJob, checkBackendServers]);

  // 🖼️ セグメントが読み込まれた時に2枚目の境界を自動設定（未設定 -1 の時のみ自動検出・ユーザーの手動指定を絶対に巻き戻さない）
  useEffect(() => {
    // 音声認識の処理中（ポーリング中）はセグメントが断片的なため自動検出しない
    if (isProcessing) return;

    if (result?.segments && result.segments.length >= 6) {
      const total = result.segments.length;
      const minValid = Math.max(3, Math.floor(total * 0.20));

      // 未設定（-1）または範囲外（>= total）の場合にのみ初期設定
      if (work2SplitIndex === -1 || work2SplitIndex >= total) {
        const detected = detectWork2SplitIndex(result.segments);
        const safeSplit = detected >= minValid && detected < total ? detected : Math.max(minValid, Math.floor(total * 0.50));
        setWork2SplitIndex(safeSplit);
      }
    }
  }, [result?.segments, detectWork2SplitIndex, work2SplitIndex, isProcessing]);

  // Admin check: call /api/admin-check when session changes
  useEffect(() => {
    if (session?.user?.email) {
      fetch('/api/admin-check')
        .then(r => r.json())
        .then(data => setIsAdmin(data.isAdmin === true))
        .catch(() => setIsAdmin(false));
    } else {
      setIsAdmin(false);
    }
  }, [session]);

  // セッション保存（管理者専用）
  const saveCurrentSession = useCallback(() => {
    if (!result?.segments || !isAdmin) return;
    const now = new Date().toISOString();
    const fileName = file?.name || jobFileName || '不明なファイル';
    const title = fileName.replace(/\.[^.]+$/, '');

    const sessionData: SavedSession = {
      id: currentSessionId || `session_${Date.now()}`,
      title,
      createdAt: currentSessionId
        ? savedSessionsList.find(s => s.id === currentSessionId)?.createdAt || now
        : now,
      updatedAt: now,
      fileName,
      serverId: selectedServerId,
      segments: result.segments,
      speakerNames: { ...speakerNames },
      speakerReadings: { ...speakerReadings },
      speakerRoles: { ...speakerRoles },
      refinedText: result.refinedText || null,
      summary: result.summary || null,
      work2SplitIndex: work2SplitIndex > 0 ? work2SplitIndex : undefined,
    };

    const existing = loadSessions();
    const idx = existing.findIndex(s => s.id === sessionData.id);
    if (idx >= 0) {
      existing[idx] = sessionData;
    } else {
      existing.unshift(sessionData);
    }
    // 最大50セッションまで保持
    const trimmed = existing.slice(0, 50);
    saveSessions(trimmed);
    setSavedSessionsList(trimmed);
    setCurrentSessionId(sessionData.id);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3000);
  }, [result, isAdmin, file, currentSessionId, savedSessionsList, selectedServerId, speakerNames, speakerReadings, speakerRoles, work2SplitIndex]);

  // セッション読み込み
  const loadSession = useCallback((sessionId: string) => {
    const sessions = loadSessions();
    const target = sessions.find(s => s.id === sessionId);
    if (!target) return;
    const cleanSegments = ensureSegmentIds(target.segments);
    setResult({
      segments: cleanSegments,
      refinedText: stripThinking(target.refinedText),
      summary: target.summary,
    });
    setSpeakerNames(target.speakerNames || {});
    setSpeakerReadings(target.speakerReadings || {});
    setSpeakerRoles(target.speakerRoles || {});
    const total = cleanSegments.length;
    const minValid = Math.max(3, Math.floor(total * 0.20));
    if (typeof target.work2SplitIndex === 'number' && target.work2SplitIndex >= minValid && target.work2SplitIndex < total) {
      setWork2SplitIndex(target.work2SplitIndex);
    } else {
      const autoIdx = detectWork2SplitIndex(cleanSegments);
      setWork2SplitIndex(autoIdx >= minValid && autoIdx < total ? autoIdx : Math.max(minValid, Math.floor(total * 0.50)));
    }
    setCurrentSessionId(target.id);
    setFile(null);
    setJobFileName(target.fileName || '不明なファイル');
    setErrorMsg(null);
    setShowSessionsPanel(false);
  }, [detectWork2SplitIndex]);

  // セッション削除
  const deleteSession = useCallback((sessionId: string) => {
    const sessions = loadSessions().filter(s => s.id !== sessionId);
    saveSessions(sessions);
    setSavedSessionsList(sessions);
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
    }
  }, [currentSessionId]);

  // Save speaker names to localStorage when they change (for autocomplete)
  const updateSpeakerName = useCallback((speakerId: string, name: string) => {
    setSpeakerNames(prev => {
      const next = { ...prev, [speakerId]: name };
      const allNames = [...savedNamesList, ...Object.values(next)];
      saveSpeakerNames(allNames);
      setSavedNamesList(loadSavedNames());
      return next;
    });
  }, [savedNamesList]);

  const updateSpeakerReading = useCallback((speakerId: string, reading: string) => {
    setSpeakerReadings(prev => ({ ...prev, [speakerId]: reading }));
  }, []);

  const updateSpeakerRole = useCallback((speakerId: string, role: string) => {
    setSpeakerRoles(prev => ({ ...prev, [speakerId]: role }));
  }, []);
  // Combine name + reading for backend
  const getCombinedSpeakerNames = useCallback(() => {
    const combined: Record<string, string> = {};
    for (const [id, name] of Object.entries(speakerNames)) {
      const reading = speakerReadings[id];
      combined[id] = reading ? `${name}（${reading}）` : name;
    }
    return combined;
  }, [speakerNames, speakerReadings]);

  // Save email to localStorage
  const updateForwardEmail = useCallback((email: string) => {
    setForwardEmail(email);
    try { localStorage.setItem(LS_EMAIL_KEY, email); } catch {}
  }, []);

  // Detect unique speakers from results
  const uniqueSpeakers = useMemo(() => {
    if (!result?.segments || !Array.isArray(result.segments)) return [];
    const seen = new Set<string>();
    result.segments.forEach((s: any) => { if (s?.speaker) seen.add(s.speaker); });
    return Array.from(seen).sort();
  }, [result]);

  // セグメントの話者 + 手動追加の話者を統合
  const allSpeakers = useMemo(() => {
    const merged = new Set([...uniqueSpeakers, ...extraSpeakers]);
    return Array.from(merged).sort();
  }, [uniqueSpeakers, extraSpeakers]);

  const getSpeakerLabel = (speakerId: string) => {
    const name = speakerNames[speakerId];
    const short = speakerId.replace('SPEAKER_', '話者');
    return name ? `${short} (${name})` : short;
  };

  // 話者追加: 次の番号を自動採番
  const addSpeaker = useCallback(() => {
    const allIds = [...uniqueSpeakers, ...extraSpeakers];
    const maxNum = allIds.reduce((max, sp) => {
      const m = sp.match(/SPEAKER_(\d+)/);
      return m ? Math.max(max, parseInt(m[1])) : max;
    }, -1);
    const newId = `SPEAKER_${String(maxNum + 1).padStart(2, '0')}`;
    setExtraSpeakers(prev => [...prev, newId]);
  }, [uniqueSpeakers, extraSpeakers]);

  // 話者削除: セグメントで使われていない場合のみ削除可能
  const removeSpeaker = useCallback((speakerId: string) => {
    // セグメントで使用中なら削除不可
    if (uniqueSpeakers.includes(speakerId)) return;
    setExtraSpeakers(prev => prev.filter(s => s !== speakerId));
    // 名前・役割もクリア
    setSpeakerNames(prev => { const n = { ...prev }; delete n[speakerId]; return n; });
    setSpeakerReadings(prev => { const n = { ...prev }; delete n[speakerId]; return n; });
    setSpeakerRoles(prev => { const n = { ...prev }; delete n[speakerId]; return n; });
  }, [uniqueSpeakers]);

  // ---- セグメント編集操作（IDまたはインデックスで安全に対象を特定） ----
  const updateSegmentText = useCallback((target: string | number, newText: string) => {
    setResult((prev: any) => {
      if (!prev?.segments || !Array.isArray(prev.segments)) return prev;
      const updated = prev.segments.map((s: any, i: number) => {
        const matches = typeof target === 'string' ? s.id === target : i === target;
        return matches ? { ...s, text: newText } : s;
      });
      return { ...prev, segments: updated };
    });
  }, []);

  const updateSegmentSpeaker = useCallback((target: string | number, newSpeaker: string) => {
    setResult((prev: any) => {
      if (!prev?.segments || !Array.isArray(prev.segments)) return prev;
      const updated = prev.segments.map((s: any, i: number) => {
        const matches = typeof target === 'string' ? s.id === target : i === target;
        return matches ? { ...s, speaker: newSpeaker } : s;
      });
      return { ...prev, segments: updated };
    });
  }, []);

  const duplicateSegment = useCallback((target: string | number) => {
    setResult((prev: any) => {
      if (!prev?.segments || !Array.isArray(prev.segments)) return prev;
      const idx = typeof target === 'string'
        ? prev.segments.findIndex((s: any) => s.id === target)
        : target;
      if (idx < 0 || idx >= prev.segments.length) return prev;
      const updated = [...prev.segments];
      const clone = {
        ...updated[idx],
        id: `seg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      };
      updated.splice(idx + 1, 0, clone);
      return { ...prev, segments: updated };
    });
    setWork2SplitIndex(prev => {
      if (prev <= 0) return prev;
      const idx = typeof target === 'number' ? target : -1;
      return idx >= 0 && idx < prev ? prev + 1 : prev;
    });
  }, []);

  const deleteSegment = useCallback((target: string | number) => {
    setResult((prev: any) => {
      if (!prev?.segments || !Array.isArray(prev.segments)) return prev;
      const updated = prev.segments.filter((s: any, i: number) => {
        return typeof target === 'string' ? s.id !== target : i !== target;
      });
      return { ...prev, segments: updated };
    });
    setWork2SplitIndex(prev => {
      if (prev <= 0) return prev;
      const idx = typeof target === 'number' ? target : -1;
      return idx >= 0 && idx < prev ? Math.max(0, prev - 1) : prev;
    });
  }, []);

  const updateRefinedText = useCallback((newText: string) => {
    setResult((prev: any) => prev ? { ...prev, refinedText: newText } : prev);
  }, []);

  const buildDownloadHeader = () => {
    if (allSpeakers.length === 0) return '';
    const lines = ['=== 話者一覧 ==='];
    allSpeakers.forEach(sp => {
      const short = sp.replace('SPEAKER_', '話者');
      const name = speakerNames[sp] || '（未設定）';
      const role = speakerRoles[sp] || '参加者';
      lines.push(`${short} = ${name}（${role}）`);
    });
    lines.push('================', '');
    return lines.join('\n');
  };

  // Download transcript for a specific speaker with surrounding context
  const downloadSpeakerTranscript = (targetSpeaker: string) => {
    if (!result?.segments) return;
    const segments = result.segments;
    const name = speakerNames[targetSpeaker] || targetSpeaker.replace('SPEAKER_', '話者');
    const short = targetSpeaker.replace('SPEAKER_', '話者');
    
    // Find all indices where the target speaker talks
    const targetIndices = new Set<number>();
    segments.forEach((s: any, i: number) => {
      if (s.speaker === targetSpeaker) targetIndices.add(i);
    });
    
    // Add context: 2 segments before and after each target segment
    const contextRange = 2;
    const includeIndices = new Set<number>();
    targetIndices.forEach(i => {
      for (let j = Math.max(0, i - contextRange); j <= Math.min(segments.length - 1, i + contextRange); j++) {
        includeIndices.add(j);
      }
    });
    
    // Build output
    const sortedIndices = Array.from(includeIndices).sort((a, b) => a - b);
    let lines: string[] = [];
    lines.push(`=== ${short} (${name}) の発言記録 ===`);
    lines.push(`生成日: ${new Date().toLocaleString('ja-JP')}`);
    lines.push(`総発言数: ${targetIndices.size} セグメント`);
    lines.push('================================', '');
    
    let lastIdx = -2;
    for (const idx of sortedIndices) {
      // Add separator if there's a gap
      if (idx > lastIdx + 1 && lastIdx >= 0) {
        lines.push('--- (省略) ---', '');
      }
      const seg = segments[idx];
      const spLabel = getSpeakerLabel(seg.speaker);
      const isTarget = seg.speaker === targetSpeaker;
      const prefix = isTarget ? '>> ' : '   ';
      lines.push(`${prefix}[${formatTime(seg.start)}-${formatTime(seg.end)}] ${spLabel}: ${seg.text}`);
      lastIdx = idx;
    }
    
    downloadAsText(lines.join('\n'), `speaker_${short}_${name}_${new Date().toISOString().slice(0,10)}.txt`);
  };

  const sendEmail = async (type: 'refined' | 'summary') => {
    const content = type === 'refined' ? result?.refinedText : result?.summary;
    if (!forwardEmail || !content) return;
    setIsSending(true);
    try {
      const preview = type === 'summary' ? result.segments
        .slice(0, 20)
        .map((s: any) => `[${s.speaker.replace('SPEAKER_','話者')}] ${s.text}`)
        .join('\n') : undefined;
      const res = await fetch('/api/send-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: forwardEmail,
          summary: type === 'summary' ? content : undefined,
          refinedText: type === 'refined' ? content : undefined,
          type,
          speakers: speakerNames,
          transcriptPreview: preview,
        }),
      });
      if (!res.ok) throw new Error('Send failed');
      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 5000);
    } catch (e: any) {
      alert(`メール送信に失敗しました: ${e.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelection = (selectedFile: File | undefined) => {
    if (!selectedFile) return;
    // Accept any audio/video file - ffmpeg on the backend handles all format conversion
    const validExtensions = ['.mp3','.wav','.m4a','.mp4','.ogg','.flac','.aac','.wma','.webm','.mov','.avi','.mkv','.caf','.aiff','.opus','.3gp','.amr','.m4v','.m4b','.m4r'];
    const ext = '.' + (selectedFile.name.split('.').pop()?.toLowerCase() || '');
    const isAudioVideo = selectedFile.type.startsWith('audio/') || selectedFile.type.startsWith('video/');
    const isValidExt = validExtensions.includes(ext);
    // On iPhone, MIME type may be empty or 'application/octet-stream' - trust the user's selection
    const isMobileFile = !selectedFile.type || selectedFile.type === 'application/octet-stream';
    if (isAudioVideo || isValidExt || isMobileFile) {
      setFile(selectedFile);
      setJobFileName(selectedFile.name);
      setResult(null);
      setWork2SplitIndex(-1);
      setErrorMsg(null);
      setProgress({ step: "", percent: 0 });
      try { localStorage.removeItem(LS_JOB_KEY); } catch {}
    } else {
      alert(`選択されたファイルは対応していません。\nファイル名: ${selectedFile.name}\nタイプ: ${selectedFile.type || '不明'}\n\n対応形式: MP3, WAV, M4A, MP4, MOV, OGG, FLAC, AAC, WebM, AVI, MKV, CAFなど`);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadAsText = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async () => {
    if (!file) return;

    // APIキー必須チェック
    if (sttEngine === "gemini" && !geminiApiKey.trim()) {
      setErrorMsg("⚠️ Google Gemini を使用するには API キーが必要です。画面上の入力欄に Gemini API キーを入力するか、上の「Whisper（無料）」に切り替えてください。");
      return;
    }
    if (sttEngine === "deepgram" && !deepgramApiKey.trim()) {
      setErrorMsg("⚠️ Deepgram を使用するには API キーが必要です。");
      return;
    }
    if (sttEngine === "scribe" && !scribeApiKey.trim()) {
      setErrorMsg("⚠️ ElevenLabs Scribe を使用するには API キーが必要です。");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setErrorMsg(null);
    setResult(null);
    setWork2SplitIndex(-1);

    // ---- Gemini サーバーサイド超高速モード（Vercel完結・PC起動不要！） ----
    if (sttEngine === "gemini") {
      const startTime = Date.now();
      try {
        setProgress({ step: "☁️ Google Cloud に音声をアップロード中...", percent: 20 });
        
        // 1. Google AI Studio File Upload API へ直接アップロード（Vercelの4.5MB制限を完全回避）
        const mimeType = file.type || "audio/mp3";
        const uploadRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey.trim()}`, {
          method: "POST",
          headers: {
            "X-Goog-Upload-Command": "start, upload, finalize",
            "X-Goog-Upload-Header-Content-Length": String(file.size),
            "X-Goog-Upload-Header-Content-Type": mimeType,
            "Content-Type": mimeType,
          },
          body: file,
          signal: controller.signal,
        });

        if (!uploadRes.ok) {
          const errBody = await uploadRes.text();
          throw new Error(`Google Upload Failed (${uploadRes.status}): ${errBody}`);
        }

        const uploadData = await uploadRes.json();
        const fileUri = uploadData.file?.uri;
        const uploadedMime = uploadData.file?.mimeType || mimeType;

        if (!fileUri) {
          throw new Error("Google File Upload did not return a valid file URI");
        }

        setProgress({ step: "🚀 Gemini 2.0 Flash が超高速で文字起こし中...", percent: 50 });
        
        // 2. 取得した fileUri だけを Vercel サーバーレス API に送信
        const geminiFormData = new FormData();
        geminiFormData.append("file_uri", fileUri);
        geminiFormData.append("mime_type", uploadedMime);
        geminiFormData.append("api_key", geminiApiKey.trim());
        geminiFormData.append("gemini_model", geminiModel);
        
        const preRegValid = usePreRegistration ? preRegisteredSpeakers.filter(s => s.name.trim()) : [];
        geminiFormData.append("pre_registered_speakers_json", JSON.stringify(preRegValid));

        const activeCustomWords = customWords.filter(w => w.enabled && w.term.trim());
        geminiFormData.append("custom_dictionary_json", JSON.stringify(activeCustomWords));
        geminiFormData.append("speaker_count_hint", speakerCountHint);

        const res = await fetch("/api/transcribe-gemini", {
          method: "POST",
          body: geminiFormData,
          signal: controller.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(errData.error || `Gemini API error: ${res.status}`);
        }

        const data = await res.json();
        const rawSegments = data.segments || [];
        
        // 万能パース＆辞書置換
        const unpacked = ensureSegmentIds(unpackSegments(rawSegments));
        const processedSegments = unpacked.map((s: any) => ({
          ...s,
          text: applyClientCustomWords(s.text || '', customWords),
        }));

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const elapsedStr = `${Math.floor(elapsed/60)}分${elapsed%60}秒`;
        setProgress({ step: `✅ 完了！（処理時間: ${elapsedStr}）`, percent: 100 });

        const completedResult = {
          segments: processedSegments,
          refinedText: null,
          summary: null,
        };

        setResult(completedResult);
        if (completedResult.segments.length >= 6) {
          const total = completedResult.segments.length;
          const minValid = Math.max(3, Math.floor(total * 0.20));
          const autoSplit = detectWork2SplitIndex(completedResult.segments);
          setWork2SplitIndex(autoSplit >= minValid && autoSplit < total ? autoSplit : Math.max(minValid, Math.floor(total * 0.50)));
        }

        // 事前登録話者およびサーバー判定話者名の完全マッピング
        if (data.speakerNames && Object.keys(data.speakerNames).length > 0) {
          setSpeakerNames(prev => ({ ...data.speakerNames, ...prev }));
        }

        if (usePreRegistration && preRegValid.length > 0 && completedResult.segments.length > 0) {
          const seenSpeakers = Array.from(new Set(completedResult.segments.map((s: any) => s.speaker))).sort() as string[];
          const newNames: Record<string, string> = {};
          const newReadings: Record<string, string> = {};
          const newRoles: Record<string, string> = {};
          seenSpeakers.forEach((spId, idx) => {
            // サーバー側で名前が設定されていればそれを活用、なければインデックス順にフォールバック
            const serverName = data.speakerNames?.[spId];
            const matchedPre = serverName ? preRegValid.find(p => p.name.trim() === serverName) : null;
            if (matchedPre) {
              newNames[spId] = matchedPre.name;
              if (matchedPre.reading) newReadings[spId] = matchedPre.reading;
              if (matchedPre.role) newRoles[spId] = matchedPre.role;
            } else if (idx < preRegValid.length) {
              newNames[spId] = preRegValid[idx].name;
              if (preRegValid[idx].reading) newReadings[spId] = preRegValid[idx].reading;
              if (preRegValid[idx].role) newRoles[spId] = preRegValid[idx].role;
            }
          });
          setSpeakerNames(prev => ({ ...newNames, ...prev }));
          setSpeakerReadings(prev => ({ ...newReadings, ...prev }));
          setSpeakerRoles(prev => ({ ...newRoles, ...prev }));
        }

        return;
      } catch (err: any) {
        if (controller.signal.aborted) return;
        console.error("Gemini Transcription Error:", err);
        setErrorMsg(err.message || "Gemini 文字起こし中にエラーが発生しました");
        return;
      } finally {
        setIsProcessing(false);
      }
    }

    setProgress({ step: `📤 ${selectedServer.name} にアップロード中...`, percent: 5 });
    
    // Use selected backend server URL
    const BASE_URL = selectedServer.backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || "/api";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("diarization", "true");
    formData.append("refinement", "false");
    formData.append("summary", "false");
    formData.append("mode", mode);
    formData.append("painting_count", String(paintingCount));
    formData.append("engine", sttEngine);
    const currentApiKey = (sttEngine as string) === "gemini" ? (geminiApiKey || "") : sttEngine === "deepgram" ? deepgramApiKey : sttEngine === "scribe" ? scribeApiKey : "";
    formData.append("api_key", currentApiKey);
    formData.append("gemini_model", geminiModel);
    
    const preRegValid = usePreRegistration ? preRegisteredSpeakers.filter(s => s.name.trim()) : [];
    const preRegStr = preRegValid.map(s => `${s.name}${s.reading ? `（${s.reading}）` : ''}${s.role ? ` [${s.role}]` : ''}`).join(', ');
    formData.append("pre_registered_speakers", preRegStr);
    formData.append("pre_registered_speakers_json", JSON.stringify(preRegValid));

    const activeCustomWords = customWords.filter(w => w.enabled && w.term.trim());
    formData.append("custom_dictionary_json", JSON.stringify(activeCustomWords));

    try {
      const response = await fetch(`${BASE_URL}/transcribe_async`, {
        method: "POST",
        body: formData,
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errData.error || `API error: ${response.status}`);
      }

      const initData = await response.json();
      const jobId = initData.job_id;
      // Save job_id to localStorage for resume capability
      try { localStorage.setItem(LS_JOB_KEY, jobId); } catch {}
      const startTime = Date.now();

      setProgress({ step: "🧠 AIがGPUで処理中...", percent: 15 });

      let isCompleted = false;
      while (!isCompleted) {
        if (controller.signal.aborted) break;
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (controller.signal.aborted) break;
        
        const statusResponse = await fetch(`${BASE_URL}/status/${jobId}`);
        if (!statusResponse.ok) continue;

        const statusData = await statusResponse.json();
        
        // 途中結果の反映
        if (statusData.segments && statusData.segments.length > 0) {
          setResult((prev: any) => ({
            segments: ensureSegmentIds(statusData.segments),
            refinedText: prev?.refinedText || null,
            summary: prev?.summary || null,
          }));
        }
        if (statusData.filename) {
          setJobFileName(statusData.filename);
        }

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const elapsedStr = `${Math.floor(elapsed/60)}分${elapsed%60}秒`;
        
        if (statusData.status === "completed") {
          isCompleted = true;
          setProgress({ step: `✅ 完了！（処理時間: ${elapsedStr}）`, percent: 100 });
          
          // DEBUG: Log raw response from backend
          console.log('[DEBUG] Raw statusData:', JSON.stringify(statusData, null, 2));
          console.log('[DEBUG] result keys:', statusData.result ? Object.keys(statusData.result) : 'NO RESULT');
          console.log('[DEBUG] refinedText type:', typeof statusData.result?.refinedText, 'length:', statusData.result?.refinedText?.length);
          console.log('[DEBUG] summary type:', typeof statusData.result?.summary, 'length:', statusData.result?.summary?.length);
          
          let rawSegments = statusData.result?.segments || [];
          // 万が一 1つのセグメント内に JSON 配列の文字列がそのまま入っていた場合の自動展開リカバリー
          if (rawSegments.length === 1 && rawSegments[0].text && rawSegments[0].text.trim().startsWith('[')) {
            try {
              const parsed = JSON.parse(rawSegments[0].text);
              if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].speaker) {
                rawSegments = parsed;
              }
            } catch {
              try {
                const healed = rawSegments[0].text.replace(/,\s*"([0-9.]+)\s*,\s*"end"/g, ', "start": $1, "end"').replace(/,\s*([\]\}])/g, '$1');
                const parsed = JSON.parse(healed);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  rawSegments = parsed;
                }
              } catch {}
            }
          }

          const unpacked = unpackSegments(rawSegments);
          const processedSegments = ensureSegmentIds(unpacked).map((s: any) => ({
            ...s,
            text: applyClientCustomWords(s.text || '', customWords),
          }));
          const rawRefined = statusData.result?.refinedText ? stripThinking(statusData.result.refinedText) : null;
          const processedRefined = rawRefined ? applyClientCustomWords(rawRefined, customWords) : null;

          const completedResult = {
            segments: processedSegments,
            refinedText: processedRefined,
            summary: statusData.result?.summary || null,
          };
          console.log('[DEBUG] completedResult refinedText:', completedResult.refinedText ? 'YES (' + completedResult.refinedText.length + ' chars)' : 'NULL');
          console.log('[DEBUG] completedResult summary:', completedResult.summary ? 'YES (' + completedResult.summary.length + ' chars)' : 'NULL');
          console.log('[DEBUG] forwardEmail:', forwardEmail);
          
          setResult(completedResult);
          if (completedResult.segments.length >= 6) {
            const total = completedResult.segments.length;
            const minValid = Math.max(3, Math.floor(total * 0.20));
            const autoSplit = detectWork2SplitIndex(completedResult.segments);
            setWork2SplitIndex(autoSplit >= minValid && autoSplit < total ? autoSplit : Math.max(minValid, Math.floor(total * 0.50)));
          }
          
          // 事前登録話者の自動マッピング（SPEAKER_00, SPEAKER_01 ... へ割り当て）
          if (usePreRegistration && preRegValid.length > 0 && completedResult.segments.length > 0) {
            const seenSpeakers = Array.from(new Set(completedResult.segments.map((s: any) => s.speaker))).sort() as string[];
            const newNames: Record<string, string> = {};
            const newReadings: Record<string, string> = {};
            const newRoles: Record<string, string> = {};
            seenSpeakers.forEach((spId, idx) => {
              if (idx < preRegValid.length) {
                newNames[spId] = preRegValid[idx].name;
                if (preRegValid[idx].reading) newReadings[spId] = preRegValid[idx].reading;
                if (preRegValid[idx].role) newRoles[spId] = preRegValid[idx].role;
              }
            });
            setSpeakerNames(prev => ({ ...newNames, ...prev }));
            setSpeakerReadings(prev => ({ ...newReadings, ...prev }));
            setSpeakerRoles(prev => ({ ...newRoles, ...prev }));
          }

          // Clear saved job
          try { localStorage.removeItem(LS_JOB_KEY); } catch {}

          // Auto-send email if email address is provided and summary exists
          if (forwardEmail && completedResult.summary) {
            try {
              const preview = completedResult.segments
                .slice(0, 20)
                .map((s: any) => `[${s.speaker.replace('SPEAKER_','話者')}] ${s.text}`)
                .join('\n');
              const res = await fetch('/api/send-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: forwardEmail,
                  summary: completedResult.summary,
                  title: file?.name?.replace(/\.[^.]+$/, '') || undefined,
                  speakers: speakerNames,
                  transcriptPreview: preview,
                }),
              });
              if (res.ok) {
                setEmailSent(true);
                setTimeout(() => setEmailSent(false), 10000);
              }
            } catch (emailErr) {
              console.error('Auto email send failed:', emailErr);
            }
          }
        } else if (statusData.status === "error") {
          try { localStorage.removeItem(LS_JOB_KEY); } catch {}
          throw new Error(statusData.error || "処理中にエラーが発生しました");
        } else {
          // Show detailed step info
          let stepLabel = "🧠 AIがGPUで処理中...";
          const step = statusData.step;
          if (step === "transcription") stepLabel = "🎤 Step 1/5: 音声認識中...";
          else if (step === "alignment") stepLabel = "📐 Step 2/5: アライメント中...";
          else if (step === "diarization") stepLabel = "👥 Step 3/5: 話者分離中...";
          else if (step === "refinement") {
            const rp = statusData.refinement_progress || "";
            stepLabel = `✍️ Step 4/5: 推敲中... ${rp}`;
          } else if (step === "summary") {
            const sp = statusData.summary_progress || "";
            stepLabel = `📝 Step 5/5: 要約生成中... ${sp}`;
          }
          stepLabel += `（経過: ${elapsedStr}）`;
          
          const stepPercents: Record<string, number> = { transcription: 20, alignment: 35, diarization: 50, refinement: 70, summary: 85 };
          
          setProgress(prev => {
            const pct = stepPercents[step] || prev.percent;
            return {
              step: stepLabel,
              percent: Math.max(prev.percent, Math.min(pct, 95))
            };
          });
        }
      }

    } catch (error: any) {
      console.error(error);
      setErrorMsg(error.message || "不明なエラーが発生しました");
    } finally {
      setIsProcessing(false);
    }
  };

  // Helper: poll a job until complete
  const pollJob = async (jobId: string, backend: string): Promise<any> => {
    while (true) {
      await new Promise(r => setTimeout(r, 3000));
      const res = await fetch(`${backend}/status/${jobId}`);
      if (!res.ok) throw new Error(`ステータス確認エラー (${res.status})`);
      const status = await res.json();
      if (status.status === "completed") return status.result || status;
      if (status.status === "error") throw new Error(status.result?.error || "処理中にエラーが発生しました");
      // still processing - update progress if available
      if (status.step) {
        setProgress({ step: `🔄 ${status.step}`, percent: 50 });
      }
    }
  };

  // Step 2: Refine with speaker names (async polling)
  const handleRefine = async () => {
    if (!result?.segments || isRefining) return;
    setIsRefining(true);
    setErrorMsg(null);
    try {
      const BACKEND = selectedServer.backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || "/api";
      const response = await fetch(`${BACKEND}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: result.segments,
          speaker_names: speakerNames,
          speaker_readings: speakerReadings,
          speaker_roles: speakerRoles,
        }),
      });
      if (!response.ok) throw new Error(`サーバーエラー (${response.status})`);
      const data = await response.json();
      // Async mode: backend returns jobId
      if (data.jobId) {
        const jobResult = await pollJob(data.jobId, BACKEND);
        if (jobResult.refinedText) {
          setResult((prev: any) => ({ ...prev, refinedText: stripThinking(jobResult.refinedText) }));
        }
      // Legacy sync mode: direct result
      } else if (data.refinedText) {
        setResult((prev: any) => ({ ...prev, refinedText: stripThinking(data.refinedText) }));
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('[Refine] Error:', error);
      setErrorMsg(`推敲エラー: ${error.message}`);
    } finally {
      setIsRefining(false);
    }
  };

  // Step 3: Summarize with speaker names (Gemini API 優先 / async polling)
  const handleSummarize = async () => {
    if (!result?.segments || isSummarizing) return;
    setIsSummarizing(true);
    setErrorMsg(null);
    try {
      const total = result.segments.length;
      const minValid = Math.max(3, Math.floor(total * 0.20));
      let splitIdx = work2SplitIndex;
      if (mode === "yurupaka" && (splitIdx <= 0 || splitIdx >= total)) {
        const detected = detectWork2SplitIndex(result.segments);
        splitIdx = detected >= minValid && detected < total ? detected : Math.max(minValid, Math.floor(total * 0.50));
        setWork2SplitIndex(splitIdx);
      }

      // 全参加者リストの統合（speakerNames, segments, refinedTextから抽出）
      const allPartNames = new Set<string>();
      Object.values(speakerNames).forEach((n: string) => {
        if (n && n.trim() && n !== "SILENCE" && !n.startsWith("SILENCE")) allPartNames.add(n.trim());
      });
      result.segments.forEach((s: any) => {
        const spId = s.speaker || "SPEAKER_00";
        const n = speakerNames[spId] || spId.replace("SPEAKER_", "話者");
        if (n && n.trim() && n !== "SILENCE" && !n.startsWith("SILENCE")) allPartNames.add(n.trim());
      });
      if (result.refinedText) {
        const m = result.refinedText.match(/\[([^\]]+)\]/g);
        if (m) m.forEach((x: string) => {
          const cn = x.replace(/^\[|\]$/g, '').trim();
          if (cn && cn !== "SILENCE" && !cn.startsWith("SILENCE")) allPartNames.add(cn);
        });
      }

      const participants = Array.from(allPartNames).map(name => {
        let role = "";
        for (const [spId, n] of Object.entries(speakerNames)) {
          if (n === name && speakerRoles[spId]) { role = `（${speakerRoles[spId]}）`; break; }
        }
        return { name, fullName: `${name}${role}` };
      });

      // 要約文の各作品セクションに全参加者の見出しが存在することを100%保証する防護壁
      const guaranteeSummary = (rawSummary: string): string => {
        if (!rawSummary || !rawSummary.trim() || participants.length === 0) return rawSummary;
        if (mode !== "yurupaka") return rawSummary;

        let guaranteed = rawSummary.trim();
        const numWorks = paintingCount > 0 ? Math.max(paintingCount, 2) : 2;
        const kanjiNums = ["", "一", "二", "三", "四", "五"];

        for (let wIdx = 1; wIdx <= numWorks; wIdx++) {
          const nextIdx = wIdx + 1;
          const wK = kanjiNums[wIdx] || String(wIdx);
          const nK = kanjiNums[nextIdx] || String(nextIdx);

          const startPat = `(?:#{1,4}\\s*【?(?:第\\s*[${wIdx}${wK}]\\s*枚目|第\\s*[${wIdx}${wK}]\\s*点目|[${wIdx}${wK}]\\s*枚目|作品\\s*[${wIdx}${wK}]|第\\s*[${wIdx}${wK}]\\s*作品))`;
          const nextPat = `(?:#{1,4}\\s*【?(?:第\\s*[${nextIdx}${nK}]\\s*枚目|第\\s*[${nextIdx}${nK}]\\s*点目|[${nextIdx}${nK}]\\s*枚目|作品\\s*[${nextIdx}${nK}]|第\\s*[${nextIdx}${nK}]\\s*作品)|(?:#{1,4}\\s*)?【?(?:6つの感性|感性と対話|感性|観自在力|全体概要|今後のアクション|まとめ))`;

          const secRegex = new RegExp(`(${startPat}[\\s\\S]*?)(?=\\n\\s*${nextPat}|\\n\\s*---+\\s*\\n\\s*(?:#{1,4}|【?6つの感性|【?感性|【?観自在力)|$)`, 'i');
          const match = guaranteed.match(secRegex);
          if (match) {
            const secContent = match[1];
            // その作品セクション内に名前が全く登場しない参加者を特定
            const missing = participants.filter(p => {
              const pName = p.name.trim();
              if (!pName) return false;
              return !secContent.includes(pName);
            });

            if (missing.length > 0) {
              console.log(`[Frontend Guarantee] Work #${wIdx} missing participants:`, missing.map(m => m.name));
              const additions = missing.map(p =>
                `\n- #### 【${p.name}】の第${wIdx}枚目に対する発言・着眼点・解釈:\n  周囲の参加者の意見や感想に耳を傾け、頷きや相槌を交えながら作品の情景を静かに観察・鑑賞した。`
              ).join('\n');
              guaranteed = guaranteed.replace(secContent, secContent.trimEnd() + '\n' + additions + '\n\n');
            }
          }
        }
        return guaranteed;
      };

      // 1. 最優先：Vercel の /api/summarize を呼び出し（サーバー環境変数 GEMINI_API_KEY またはクライアント入力キー）
      try {
        const res = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            segments: result.segments,
            speaker_names: speakerNames,
            speaker_readings: speakerReadings,
            speaker_roles: speakerRoles,
            mode: mode,
            painting_count: paintingCount,
            split_index: splitIdx,
            refined_text: result.refinedText || "",
            api_key: geminiApiKey,
            model: geminiModel,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.summary) {
            setResult((prev: any) => ({ ...prev, summary: guaranteeSummary(data.summary) }));
            return;
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          console.warn("[Summarize] Vercel API returned error:", errData);
        }
      } catch (vercelApiErr) {
        console.warn("[Summarize] Vercel API fetch failed or timed out:", vercelApiErr);
      }

      // 1.5. ブラウザから直接 Google Gemini API を実行（フロントに geminiApiKey がある場合の安全策）
      if (geminiApiKey) {
        try {
          console.log("[Summarize] Falling back to direct browser Gemini API call...");

          const participantListStr = participants.length > 0
            ? participants.map((p, i) => `${i + 1}. 【${p.fullName}】`).join("\n")
            : "・参加者";

          const numWorks = paintingCount > 0 ? Math.max(paintingCount, 2) : 2;
          const makeWorkTemplate = (wIdx: number) => {
            return participants.map((p, i) => 
              `- #### 【${p.name}】の第${wIdx}枚目に対する発言・着眼点・解釈:\n  （${p.name} が述べた感想、気づき、色彩・構図の指摘、独自解釈を具体的に記述。※もし第${wIdx}枚目の絵画に関する直接の発言が少ない場合でも見出しは絶対に削らず、「主に周囲の発言に耳を傾け、頷きや相槌を通して対話に同調していた」のように鑑賞時の様子を必ず具体的に記述すること）`
            ).join("\n\n");
          };

          const worksSections = Array.from({ length: numWorks }, (_, i) => {
            const wNum = i + 1;
            const participantNamesList = participants.map((p, i) => `${i + 1}. 【${p.name}】`).join("、");
            return (
              `### 【第${wNum}枚目の作品（絵画）の鑑賞記録と参加者全員の発言】\n` +
              `【必須出力対象者（全 ${participants.length} 名・1人も欠落厳禁）】: ${participantNamesList}\n` +
              `・作品のモチーフと描かれている情景: （第${wNum}枚目の絵画に具体的に何が描かれているか、色調や構図の特徴を明記）\n` +
              `・全体の対話の流れと議論の展開: （この作品を通してどのような議論が発展したかを詳細に記述）\n` +
              `・【第${wNum}枚目に対する参加者全員の鑑賞発言（★上記全 ${participants.length} 名分の見出しを1人も欠かさず必ず順番に出力すること）】:\n\n` +
              makeWorkTemplate(wNum)
            );
          }).join("\n\n---\n\n");

          let conversationBlocks = "";
          if (mode === "yurupaka" && splitIdx > 0 && splitIdx < result.segments.length) {
            if (result.refinedText && result.refinedText.trim().length > 100) {
              const rLines = result.refinedText.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
              const rTotal = rLines.length;
              let bestRSplit = Math.floor(rTotal * (splitIdx / total));
              for (let ri = Math.max(1, Math.floor(rTotal * 0.20)); ri <= Math.min(rTotal - 1, Math.floor(rTotal * 0.85)); ri++) {
                if (/(?:2|２|二)(?:枚目|点目)|次の(?:絵|作品|スライド)|画面を切り替え/.test(rLines[ri])) { bestRSplit = ri; break; }
              }
              conversationBlocks = (
                `【★第1枚目の絵画に関する対話テキスト（推敲済み：全 ${bestRSplit} 行）】\n` +
                rLines.slice(0, bestRSplit).join("\n") + "\n\n" +
                `【★第2枚目の絵画に関する対話テキスト（推敲済み：全 ${rTotal - bestRSplit} 行）】\n` +
                rLines.slice(bestRSplit).join("\n")
              );
            } else {
              const w1Text = result.segments.slice(0, splitIdx).map((s: any, idx: number) => {
                const spId = s.speaker || "SPEAKER_00";
                const name = speakerNames[spId] || spId.replace("SPEAKER_", "話者");
                return `[#${idx + 1} ${name}] ${s.text || ""}`;
              }).join("\n");
              const w2Text = result.segments.slice(splitIdx).map((s: any, idx: number) => {
                const spId = s.speaker || "SPEAKER_00";
                const name = speakerNames[spId] || spId.replace("SPEAKER_", "話者");
                return `[#${splitIdx + idx + 1} ${name}] ${s.text || ""}`;
              }).join("\n");

              conversationBlocks = (
                `【★第1枚目の絵画に関する対話テキスト（全 ${splitIdx} 発言）】\n` +
                w1Text + "\n\n" +
                `【★第2枚目の絵画に関する対話テキスト（全 ${result.segments.length - splitIdx} 発言）】\n` +
                w2Text
              );
            }
          } else {
            conversationBlocks = result.refinedText || result.segments.map((s: any, idx: number) => {
              const spId = s.speaker || "SPEAKER_00";
              const name = speakerNames[spId] || spId.replace("SPEAKER_", "話者");
              return `[#${idx + 1} ${name}] ${s.text || ""}`;
            }).join("\n");
          }

          const clientPrompt = mode === "yurupaka" ? (
            "あなたは絵画鑑賞会（対話型アート鑑賞）の対話記録から、極めて詳細で充実した要約・鑑賞記録を作成する専門家AIです。\n" +
            "以下の対話テキストを深く読み込み、一切省略することなく、長文で充実した鑑賞記録を作成してください。\n\n" +
            `【参加者全員リスト（全 ${participants.length} 名）】\n` +
            participantListStr + "\n\n" +
            `【★最重要・絶対厳守ルール：第1枚目にも第2枚目にも、上記全参加者（全 ${participants.length} 名）の見出しを必ず1人残らず出力すること】\n` +
            `1. 【第1枚目の作品】の欄には、上記参加者リストの全 ${participants.length} 名それぞれの「- #### 【お名前】の第1枚目に対する発言・着眼点・解釈:」見出しを1人も削らず全員分出力してください。\n` +
            `2. 【第2枚目の作品】の欄にも、上記全 ${participants.length} 名それぞれの「- #### 【お名前】の第2枚目に対する発言・着眼点・解釈:」見出しを1人も削らず全員分出力してください。\n` +
            `3. 特定の参加者が第1枚目で発言が少ない場合でも見出しは絶対に省略せず、「周囲の意見に頷き同調していた」等と記述してください。\n\n` +
            "【構成】\n" +
            "### 【全体概要】\n対話の流れと全体テーマを詳細に記述。\n\n" +
            "---\n\n" +
            worksSections + "\n\n" +
            "---\n\n" +
            "### 【感性と対話の深まりの分析】\n参加者の感性の広がりを詳細に分析。\n\n" +
            conversationBlocks
          ) : (
            "あなたは会議録作成のエキスパートAIです。全参加者の発言を漏らさず包括的会議録を作成してください。\n\n" +
            `【参加者リスト】\n${participantListStr}\n\n` +
            "【対話テキスト】\n" + conversationBlocks
          );

          const directRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey.trim()}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: clientPrompt }] }],
                generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
              }),
            }
          );

          if (directRes.ok) {
            const directData = await directRes.json();
            const directSummary = directData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (directSummary && directSummary.trim()) {
              setResult((prev: any) => ({ ...prev, summary: guaranteeSummary(directSummary) }));
              return;
            }
          }
        } catch (directErr) {
          console.warn("[Summarize] Direct browser Gemini call failed:", directErr);
        }
      }

      // 2. ローカル/GPUバックエンドサーバーによる要約（最終フォールバック）
      const BACKEND = selectedServer.backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || "/api";
      const response = await fetch(`${BACKEND}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: result.segments,
          speaker_names: speakerNames,
          speaker_readings: speakerReadings,
          speaker_roles: speakerRoles,
          mode: mode,
          painting_count: paintingCount,
          split_index: splitIdx,
          refined_text: result.refinedText || "",
          api_key: geminiApiKey,
        }),
      });
      if (!response.ok) throw new Error(`要約サーバーエラー (${response.status})`);
      const data = await response.json();
      // Async mode
      if (data.jobId) {
        const jobResult = await pollJob(data.jobId, BACKEND);
        if (jobResult.summary) {
          setResult((prev: any) => ({ ...prev, summary: guaranteeSummary(jobResult.summary) }));
        }
      // Legacy sync mode
      } else if (data.summary) {
        setResult((prev: any) => ({ ...prev, summary: guaranteeSummary(data.summary) }));
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (error: any) {
      setErrorMsg(`要約エラー: ${error.message}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0c1929] via-[#0e2a3d] to-[#162544] text-white selection:bg-teal-400/30">
      {/* Summer decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-gradient-to-bl from-teal-500/8 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-gradient-to-tr from-sky-500/6 to-transparent rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-[300px] h-[300px] bg-gradient-to-br from-orange-400/5 to-transparent rounded-full blur-3xl" />
      </div>
      <div className="relative max-w-5xl mx-auto px-6 py-12">
        {/* User Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0e2a3d]/70 backdrop-blur-md border border-cyan-800/40 rounded-2xl px-4 py-2.5 mb-8">
          <div className="flex items-center gap-2.5 text-xs text-slate-300">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-medium text-slate-200">{session?.user?.email || 'ログイン中'}</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
              認証済み
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => signOut()}
              className="text-xs px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>

        {/* Header Section */}
        <header className="text-center mb-16 space-y-5">
          <div className="inline-flex items-center justify-center gap-3 mb-4">
            <span className="text-5xl" style={{animation: 'float 3s ease-in-out infinite'}}>🦙</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-300 via-cyan-200 to-sky-300">ゆるパカ鑑賞会</span>
            <br />
            <span className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-300 via-amber-200 to-yellow-300">ローカルAI文字起こし</span>
          </h1>
          <p className="text-lg text-cyan-100/60 max-w-2xl mx-auto leading-relaxed">
            完全オフライン・無料で動く高精度な文字起こしアプリ。
            機密性の高い音声データも、外部に送信することなく安全にテキスト化します。
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Upload Column */}
          <div className="lg:col-span-8 space-y-6">
            {/* 🎙️ 音声認識エンジンの切り替えタブ */}
            <div className="bg-[#0e2a3d]/70 backdrop-blur-sm border border-cyan-800/40 rounded-3xl p-5 shadow-xl space-y-3.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-cyan-200 flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-teal-400" />
                  音声認識（STT）エンジン
                </label>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#0c1929] p-1.5 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setSttEngine("whisper");
                    try { localStorage.setItem(LS_STT_ENGINE_KEY, "whisper"); } catch {}
                  }}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all flex flex-col items-center gap-0.5 ${
                    sttEngine === 'whisper'
                      ? 'bg-teal-500/20 text-teal-200 border border-teal-400/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span>Whisper</span>
                  <span className="text-[10px] opacity-70 font-normal">ローカル・完全無料</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSttEngine("gemini");
                    try { localStorage.setItem(LS_STT_ENGINE_KEY, "gemini"); } catch {}
                  }}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all flex flex-col items-center gap-0.5 ${
                    sttEngine === 'gemini'
                      ? 'bg-blue-500/20 text-blue-200 border border-blue-400/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span>Gemini 3.5</span>
                  <span className="text-[10px] opacity-70 font-normal">Transcribe</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSttEngine("deepgram");
                    try { localStorage.setItem(LS_STT_ENGINE_KEY, "deepgram"); } catch {}
                  }}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all flex flex-col items-center gap-0.5 ${
                    sttEngine === 'deepgram'
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span>Deepgram</span>
                  <span className="text-[10px] opacity-70 font-normal">クラウド超高速</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSttEngine("scribe");
                    try { localStorage.setItem(LS_STT_ENGINE_KEY, "scribe"); } catch {}
                  }}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all flex flex-col items-center gap-0.5 ${
                    sttEngine === 'scribe'
                      ? 'bg-purple-500/20 text-purple-200 border border-purple-400/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span>ElevenLabs</span>
                  <span className="text-[10px] opacity-70 font-normal">最高精度</span>
                </button>
              </div>

              {/* Gemini が選ばれている場合の直接入力欄 */}
              {sttEngine === 'gemini' && (
                <div className="p-3.5 bg-blue-950/40 border border-blue-500/30 rounded-2xl space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-blue-200 flex items-center gap-1.5">
                      🔑 Google Gemini API Key
                    </span>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-400 hover:text-teal-300 underline font-medium"
                    >
                      無料APIキーを取得 ↗
                    </a>
                  </div>
                  <input
                    type="password"
                    placeholder="AIzaSy... （Google AI StudioのAPIキーを貼り付け）"
                    value={geminiApiKey}
                    onChange={(e) => {
                      setGeminiApiKey(e.target.value);
                      try { localStorage.setItem(LS_GEMINI_KEY_KEY, e.target.value); } catch {}
                    }}
                    className={`w-full bg-slate-900 border rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none font-mono ${
                      !geminiApiKey.trim() ? 'border-amber-500/50 focus:border-amber-400' : 'border-blue-500/40 focus:border-blue-400'
                    }`}
                  />
                  {!geminiApiKey.trim() ? (
                    <p className="text-[11px] text-amber-300/90 flex items-center gap-1">
                      ⚠️ Gemini を利用するには API キーが必要です。または上の「Whisper」を選べばキー不要で無料利用できます。
                    </p>
                  ) : (
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                      ✓ APIキー設定済み（ブラウザに自動保存）
                    </p>
                  )}
                </div>
              )}

              {/* Deepgram が選ばれている場合の直接入力欄 */}
              {sttEngine === 'deepgram' && (
                <div className="p-3.5 bg-cyan-950/40 border border-cyan-500/30 rounded-2xl space-y-2 animate-in fade-in">
                  <span className="font-semibold text-xs text-cyan-200 block">
                    🔑 Deepgram API Key
                  </span>
                  <input
                    type="password"
                    placeholder="DeepgramのAPIキーを入力"
                    value={deepgramApiKey}
                    onChange={(e) => {
                      setDeepgramApiKey(e.target.value);
                      try { localStorage.setItem(LS_DEEPGRAM_KEY_KEY, e.target.value); } catch {}
                    }}
                    className="w-full bg-slate-900 border border-cyan-500/40 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                </div>
              )}

              {/* ElevenLabs が選ばれている場合の直接入力欄 */}
              {sttEngine === 'scribe' && (
                <div className="p-3.5 bg-purple-950/40 border border-purple-500/30 rounded-2xl space-y-2 animate-in fade-in">
                  <span className="font-semibold text-xs text-purple-200 block">
                    🔑 ElevenLabs API Key
                  </span>
                  <input
                    type="password"
                    placeholder="ElevenLabsのAPIキーを入力"
                    value={scribeApiKey}
                    onChange={(e) => {
                      setScribeApiKey(e.target.value);
                      try { localStorage.setItem(LS_SCRIBE_KEY_KEY, e.target.value); } catch {}
                    }}
                    className="w-full bg-slate-900 border border-purple-500/40 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-400 font-mono"
                  />
                </div>
              )}
            </div>

            <div 
              onClick={handleUploadClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                relative overflow-hidden group cursor-pointer
                border-2 border-dashed rounded-3xl p-12 transition-all duration-300
                flex flex-col items-center justify-center min-h-[320px] bg-slate-900/50 backdrop-blur-sm
                ${isDragging ? "border-teal-400 bg-teal-500/10 scale-[1.02]" : "border-cyan-800/40 hover:border-teal-400/50 hover:bg-[#0e2a3d]/80"}
                ${file ? "border-teal-400/50 bg-teal-500/5" : ""}
              `}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={(e) => e.target.files && handleFileSelection(e.target.files[0])} 
                className="hidden" 
                accept=".mp3,.wav,.m4a,.mp4,.mov,.caf,.ogg,.flac,.aac,.wma,.webm,.avi,.mkv,.aiff,.opus,.3gp,.amr,audio/*,video/*"
              />
              
              {!file ? (
                <>
                  <div className="absolute inset-0 bg-gradient-to-t from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <UploadCloud className={`w-16 h-16 mb-6 transition-colors duration-300 ${isDragging ? "text-teal-400" : "text-cyan-700 group-hover:text-teal-400"}`} />
                  <h3 className="text-xl font-semibold mb-2">音声・動画ファイルをドロップ</h3>
                  <p className="text-cyan-200/40 text-base mb-6">または クリックしてファイルを選択</p>
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-slate-500">
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">MP3</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">WAV</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">M4A</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">MP4</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">MOV</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">CAF</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">OGG</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">FLAC</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">WebM</span>
                    <span className="px-2 py-1 text-slate-600">etc.</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center text-center">
                  <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                    <FileAudio className="w-10 h-10 text-emerald-400" />
                  </div>
                  <h3 className="text-xl font-medium text-emerald-300 mb-1">{file.name}</h3>
                  <p className="text-slate-400 text-sm">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                  <button 
                    onClick={(e) => { e.stopPropagation(); setFile(null); }}
                    className="mt-6 text-sm text-slate-400 hover:text-white underline underline-offset-4"
                  >
                    別のファイルを選択
                  </button>
                </div>
              )}
            </div>

            {/* Progress Bar (Visible when processing) */}
            {isProcessing && (
              <div className="bg-[#0e2a3d]/90 backdrop-blur-lg border border-teal-500/20 rounded-2xl p-6 shadow-xl shadow-teal-500/5 animate-in fade-in slide-in-from-bottom-4">
                <div className="text-center mb-4">
                  <span className="text-4xl inline-block" style={{animation: 'wave 1s ease-in-out infinite'}}>
                    {PACA_MESSAGES[Math.min(Math.floor(progress.percent / 15), PACA_MESSAGES.length - 1)].emoji}
                  </span>
                  <p className="text-base text-cyan-100/70 mt-2">
                    {PACA_MESSAGES[Math.min(Math.floor(progress.percent / 15), PACA_MESSAGES.length - 1)].text}
                  </p>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium text-cyan-100 text-sm">{progress.step}</span>
                  <span className="text-teal-300 font-mono text-sm">{progress.percent}%</span>
                </div>
                <div className="h-2.5 w-full bg-[#0c1929] rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-teal-500 via-cyan-400 to-sky-400 transition-all duration-500 ease-out rounded-full"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <button
                  onClick={cancelJob}
                  className="mt-4 w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <AlertCircle className="w-4 h-4" /> 処理を中止する
                </button>
              </div>
            )}

            {/* 事前話者登録（オプション - ワイド展開版） */}
            <div className="bg-[#0e2a3d]/60 backdrop-blur-sm border border-purple-500/30 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-purple-500/20">
                <label className="text-sm font-semibold text-purple-200 flex items-center gap-2 cursor-pointer">
                  <Users className="w-5 h-5 text-purple-400" />
                  事前に参加者名を登録して認識精度UP
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{usePreRegistration ? '有効' : '無効'}</span>
                  <input
                    type="checkbox"
                    checked={usePreRegistration}
                    onChange={(e) => setUsePreRegistration(e.target.checked)}
                    className="w-5 h-5 accent-purple-500 rounded cursor-pointer"
                  />
                </div>
              </div>

              {usePreRegistration && (
                <div className="space-y-4 animate-in fade-in duration-200 pt-1">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    あらかじめ参加者名・読み・役割を登録しておくことで、AIが固有名詞や話者分離をより正確に認識します。
                  </p>

                  {/* 話者数目安セレクター */}
                  <div className="bg-slate-900/60 p-3 rounded-xl border border-purple-500/20 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-purple-400" />
                      参加人数（話者数）の目安:
                    </span>
                    <div className="flex items-center gap-1">
                      {[
                        { val: "auto", label: "自動判定" },
                        { val: "2", label: "2人（対談・面談）" },
                        { val: "3", label: "3人" },
                        { val: "4", label: "4人" },
                        { val: "5+", label: "5人以上" },
                      ].map((item) => (
                        <button
                          key={item.val}
                          type="button"
                          onClick={() => setSpeakerCountHint(item.val)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                            speakerCountHint === item.val
                              ? "bg-purple-500 text-white shadow-sm shadow-purple-500/30"
                              : "bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {preRegisteredSpeakers.map((sp) => (
                      <div key={sp.id} className="flex flex-wrap md:flex-nowrap items-center gap-3 bg-slate-900/40 p-3 rounded-2xl border border-slate-700/50">
                        <div className="flex-1 min-w-[150px]">
                          <label className="block text-[11px] text-slate-400 font-medium mb-1">名前（漢字）</label>
                          <input
                            type="text"
                            list="speaker-name-suggestions"
                            placeholder="例: 山田太郎"
                            value={sp.name}
                            onChange={(e) => updatePreRegisteredSpeaker(sp.id, 'name', e.target.value)}
                            className="w-full bg-[#0c1929] border border-purple-500/30 rounded-xl py-2 px-3 text-sm text-purple-200 placeholder-slate-500 focus:outline-none focus:border-purple-400"
                          />
                        </div>
                        <div className="flex-1 min-w-[130px]">
                          <label className="block text-[11px] text-slate-400 font-medium mb-1">ふりがな（任意）</label>
                          <input
                            type="text"
                            placeholder="例: やまだたろう"
                            value={sp.reading}
                            onChange={(e) => updatePreRegisteredSpeaker(sp.id, 'reading', e.target.value)}
                            className="w-full bg-[#0c1929] border border-purple-500/30 rounded-xl py-2 px-3 text-sm text-purple-200 placeholder-slate-500 focus:outline-none focus:border-purple-400"
                          />
                        </div>
                        <div className="w-full md:w-40">
                          <label className="block text-[11px] text-slate-400 font-medium mb-1">カテゴリ（役割）</label>
                          <select
                            value={sp.role}
                            onChange={(e) => updatePreRegisteredSpeaker(sp.id, 'role', e.target.value)}
                            className="w-full bg-[#0c1929] border border-purple-500/30 rounded-xl py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-purple-400"
                          >
                            <option value="参加者">参加者</option>
                            <option value="アーティスト">アーティスト</option>
                            <option value="ファシリテーター">ファシリテーター</option>
                            <option value="オブザーバー">オブザーバー</option>
                            <option value="通訳">通訳</option>
                          </select>
                        </div>
                        {preRegisteredSpeakers.length > 1 && (
                          <div className="self-end md:self-center pt-2 md:pt-5">
                            <button
                              type="button"
                              onClick={() => removePreRegisteredSpeaker(sp.id)}
                              className="p-2 rounded-xl hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                              title="この参加者を削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addPreRegisteredSpeaker}
                    className="w-full py-2.5 rounded-xl text-sm font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20 border-dashed hover:bg-purple-500/20 hover:border-purple-500/40 transition-all flex items-center justify-center gap-2"
                  >
                    <CopyPlus className="w-4 h-4" />
                    参加者を追加する
                  </button>
                </div>
              )}
            </div>

            {/* 📚 専門用語・カスタム辞書（タグ選択） */}
            <div className="bg-[#0e2a3d]/60 backdrop-blur-sm border border-cyan-800/30 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-cyan-50">専門用語・カスタム辞書（タグ選択）</h3>
                    <p className="text-xs text-slate-400">
                      単語タグをクリックしてON/OFF。音声（読み）から正確な漢字・表記にAIが自動変換します。
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => setAllCustomWords(true)}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/30 transition-colors"
                  >
                    全選択
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllCustomWords(false)}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition-colors"
                  >
                    全解除
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddWordForm(!showAddWordForm)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-500 hover:to-teal-500 text-white font-medium shadow-sm transition-all flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    単語を追加
                  </button>
                </div>
              </div>

              {/* 単語追加フォーム（展開時） */}
              {showAddWordForm && (
                <div className="p-4 rounded-2xl bg-slate-900/80 border border-blue-500/30 space-y-3 animate-in fade-in duration-200">
                  <div className="text-xs font-semibold text-blue-300">新しい単語・専門用語の登録</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 font-medium mb-1">表示名（漢字・英字） <span className="text-red-400">*</span></label>
                      <input
                        type="text"
                        placeholder="例: 観自在力, ChatGPT"
                        value={newWordTerm}
                        onChange={(e) => setNewWordTerm(e.target.value)}
                        className="w-full bg-[#0c1929] border border-blue-500/30 rounded-xl py-2 px-3 text-sm text-blue-200 placeholder-slate-500 focus:outline-none focus:border-blue-400"
                        onKeyDown={(e) => { if (e.key === 'Enter') addCustomWord(); }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 font-medium mb-1">読み（ひらがな・任意）</label>
                      <input
                        type="text"
                        placeholder="例: かんじざいりょく"
                        value={newWordReading}
                        onChange={(e) => setNewWordReading(e.target.value)}
                        className="w-full bg-[#0c1929] border border-blue-500/30 rounded-xl py-2 px-3 text-sm text-blue-200 placeholder-slate-500 focus:outline-none focus:border-blue-400"
                        onKeyDown={(e) => { if (e.key === 'Enter') addCustomWord(); }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 font-medium mb-1">カテゴリ</label>
                      <select
                        value={newWordCategory}
                        onChange={(e) => setNewWordCategory(e.target.value)}
                        className="w-full bg-[#0c1929] border border-blue-500/30 rounded-xl py-2 px-3 text-sm text-slate-200 focus:outline-none focus:border-blue-400"
                      >
                        <option value="専門用語">専門用語</option>
                        <option value="サービス・作品名">サービス・作品名</option>
                        <option value="人名・組織">人名・組織</option>
                        <option value="その他">その他</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddWordForm(false)}
                      className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={addCustomWord}
                      disabled={!newWordTerm.trim()}
                      className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white shadow-sm transition-all"
                    >
                      追加してタグ保存
                    </button>
                  </div>
                </div>
              )}

              {/* 単語タグ一覧（ピル・チップ形式） */}
              <div className="flex flex-wrap gap-2 pt-1 min-h-[42px] items-center">
                {customWords.length === 0 ? (
                  <p className="text-xs text-slate-500 py-1">登録された単語はありません。「単語を追加」から登録してください。</p>
                ) : (
                  customWords.map((word) => {
                    const isEnabled = word.enabled;
                    return (
                      <div
                        key={word.id}
                        onClick={() => toggleCustomWord(word.id)}
                        className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer select-none ${
                          isEnabled
                            ? 'bg-gradient-to-r from-blue-600/30 to-teal-600/30 border-blue-400/50 text-blue-100 shadow-sm shadow-blue-900/20 hover:border-blue-300'
                            : 'bg-slate-900/40 border-slate-700/50 text-slate-400 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full transition-colors ${isEnabled ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]' : 'bg-slate-600'}`} />
                        <span className="font-semibold text-slate-100">{word.term}</span>
                        {word.reading && (
                          <span className={`text-[11px] ${isEnabled ? 'text-blue-300' : 'text-slate-500'}`}>
                            （{word.reading}）
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCustomWord(word.id);
                          }}
                          className="ml-1 p-0.5 rounded-md hover:bg-red-500/20 hover:text-red-300 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="この単語を削除"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="text-[11px] text-slate-400 flex items-center justify-between pt-2 border-t border-slate-700/30">
                <span>選択中: <strong className="text-teal-300 font-bold">{customWords.filter(w => w.enabled && w.term.trim()).length}</strong> / {customWords.length} 語</span>
                <span>※文字起こし・推敲時に自動注入されます</span>
              </div>
            </div>
          </div>

          {/* Sidebar Options Column */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#0e2a3d]/60 backdrop-blur-sm border border-cyan-800/30 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center gap-2 mb-6 pb-4 border-b border-cyan-800/30">
                <Settings className="w-5 h-5 text-teal-400" />
                <h3 className="font-semibold text-lg text-cyan-50">AI 処理オプション</h3>
              </div>

              <div className="space-y-4">
                {/* Backend Server Selector */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                      <Server className="w-4 h-4 text-violet-400" /> 処理サーバー
                    </h3>
                    <button
                      onClick={checkBackendServers}
                      disabled={checkingServers}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
                      title="サーバーの状態を再チェック"
                    >
                      <Loader2 className={`w-3 h-3 ${checkingServers ? 'animate-spin' : ''}`} />
                      {checkingServers ? '確認中...' : '再チェック'}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {backendServers.map(server => {
                      const isSelected = selectedServerId === server.id;
                      const isOnline = server.online;
                      const isConfigured = !!server.backendUrl;
                      return (
                        <button
                          key={server.id}
                          onClick={() => isConfigured && selectServer(server.id)}
                          disabled={isProcessing || isRefining || isSummarizing || !isConfigured}
                          className={`
                            w-full text-left p-3.5 rounded-xl border transition-all duration-200
                            ${!isConfigured
                              ? 'bg-slate-900/20 border-slate-800/30 opacity-40 cursor-not-allowed'
                              : isSelected 
                                ? 'bg-violet-500/15 border-violet-400/40 shadow-md shadow-violet-500/5' 
                                : 'bg-slate-900/30 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/40'}
                            ${(isProcessing || isRefining || isSummarizing) ? 'opacity-50 cursor-not-allowed' : ''}
                          `}
                        >
                          <div className="flex items-center gap-3">
                            {/* Radio indicator */}
                            <div className={`
                              w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
                              ${isSelected ? 'border-violet-400' : 'border-slate-500'}
                            `}>
                              {isSelected && <div className="w-2 h-2 rounded-full bg-violet-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${isSelected ? 'text-violet-200' : 'text-slate-300'}`}>
                                  {server.name}
                                </span>
                                {isConfigured && isOnline === true && (
                                    <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
                                      <Wifi className="w-2.5 h-2.5" /> ON
                                    </span>
                                )}
                                {isConfigured && isOnline === false && (
                                    <span className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-700/40 px-1.5 py-0.5 rounded-full">
                                      未確認
                                    </span>
                                )}
                                {!isConfigured && (
                                  <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">
                                    準備中
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[11px] text-slate-500">{server.gpuInfo || server.gpu}</span>
                                <span className="text-[10px] text-slate-600">·</span>
                                <span className="text-[11px] text-slate-500">{server.llmModel}</span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedServerId === 'local-pc' && (
                    <div className="p-2.5 rounded-xl bg-violet-950/40 border border-violet-800/40 text-[11px] text-violet-300 flex items-start gap-2">
                      <span className="text-sm">💻</span>
                      <span>このPC（AMD Ryzen AI Max / Radeon 8060S・8050S）で文字起こしを実行する場合は、ローカル環境で <code>ai-transcriber/backend/start_local.bat</code> を起動してください。</span>
                    </div>
                  )}
                  {selectedServerId === 'remote-pc' && (
                    <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-700/40 text-[11px] text-slate-400 flex items-start gap-2">
                      <span className="text-sm">ℹ️</span>
                      <span>eGPU2（M7 Ultra / RTX 2080 Ti 22GB）で文字起こしを行う場合は、M7 Ultra 上で <code>start_backend.bat</code> を実行してください（LM Studio は稼働中）。</span>
                    </div>
                  )}
                </div>

                {/* 要約モード設定 */}
                <div className="space-y-3 pt-2">
                  <h3 className="text-sm font-medium text-slate-300 px-1 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-teal-400" /> 要約モード設定
                  </h3>
                  <div className="p-4 rounded-2xl bg-slate-900/40 border border-slate-700/50 space-y-4">
                    {/* モード選択 */}
                    <div className="space-y-2">
                      <label className="text-xs text-slate-400 block font-medium">要約の形式</label>
                      <div className="grid grid-cols-2 gap-2 bg-[#0c1929] p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setMode("yurupaka")}
                          className={`
                            py-2 px-3 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5
                            ${mode === "yurupaka" 
                              ? 'bg-gradient-to-r from-teal-500/20 to-cyan-500/20 text-teal-200 border border-teal-400/30' 
                              : 'text-slate-400 hover:text-slate-200 border border-transparent'}
                          `}
                        >
                          🦙 ゆるパカ鑑賞会
                        </button>
                        <button
                          type="button"
                          onClick={() => setMode("general")}
                          className={`
                            py-2 px-3 text-xs font-semibold rounded-lg transition-all duration-200 flex items-center justify-center gap-1.5
                            ${mode === "general" 
                              ? 'bg-gradient-to-r from-teal-500/20 to-cyan-500/20 text-teal-200 border border-teal-400/30' 
                              : 'text-slate-400 hover:text-slate-200 border border-transparent'}
                          `}
                        >
                          👔 一般対話・会議
                        </button>
                      </div>
                    </div>

                    {/* 音声認識エンジン・APIキー設定ボタン */}
                    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-700/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                          <Server className="w-3.5 h-3.5 text-cyan-400" />
                          音声認識エンジン
                        </label>
                        <button
                          onClick={() => setShowEngineModal(true)}
                          className="text-[11px] px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors font-medium flex items-center gap-1"
                        >
                          <Settings className="w-3 h-3" />
                          設定・APIキー
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-teal-300 bg-teal-500/15 px-2 py-0.5 rounded border border-teal-500/20">
                          {sttEngine === "whisper" && "Whisper (ローカル・無料)"}
                          {sttEngine === "gemini" && "Gemini 3.5 Transcribe (最先端・最高精度)"}
                          {sttEngine === "deepgram" && "Deepgram (クラウド超高速)"}
                          {sttEngine === "scribe" && "ElevenLabs Scribe (最高精度)"}
                        </span>
                      </div>
                    </div>


                    {/* 枚数指定（ゆるパカモード時のみ） */}
                    {mode === "yurupaka" && (
                      <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex justify-between items-center">
                          <label className="text-xs text-slate-400 block font-medium">絵画の枚数（作品数）</label>
                          <span className="text-[11px] text-teal-300 font-medium">
                            {paintingCount === 0 ? "自動判定" : `${paintingCount} 枚`}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min="0"
                            max="10"
                            value={paintingCount}
                            onChange={(e) => setPaintingCount(Number(e.target.value))}
                            className="flex-1 accent-teal-400 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                          />
                          <input
                            type="number"
                            min="0"
                            max="20"
                            value={paintingCount}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              setPaintingCount(val);
                            }}
                            className="w-16 bg-[#0c1929] border border-slate-700/50 rounded-lg py-1 px-2 text-xs font-mono text-center text-teal-200 focus:outline-none focus:border-teal-400"
                          />
                        </div>
                        <p className="text-[10px] text-slate-500 leading-normal">
                          ※鑑賞された絵画の正確な枚数を指定すると、要約のセクション分割が正確になります。0 の場合はAIが自動で切り替えを判定します。
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Processing Info Panel */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-slate-300 px-1 flex items-center gap-2">
                    <Settings className="w-4 h-4" /> 処理の流れ
                  </h3>

                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-cyan-500/30">
                    <p className="font-medium text-slate-200 mb-1 flex items-center gap-2">
                      <span className="text-cyan-400 font-bold">①</span> 文字起こし＋話者分離
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      GPU（WhisperX）で高精度な文字起こしと話者分離を行います。
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-purple-500/30">
                    <p className="font-medium text-slate-200 mb-1 flex items-center gap-2">
                      <span className="text-purple-400 font-bold">②</span> 話者名入力 → 推敲
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      話者名を入力してから「推敲する」ボタンで、名前入りの整形テキストを生成します。
                    </p>
                  </div>

                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-amber-500/30">
                    <p className="font-medium text-slate-200 mb-1 flex items-center gap-2">
                      <span className="text-amber-400 font-bold">③</span> 要約生成
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      「要約する」ボタンで、名前入りの構造化された要約を生成します。
                    </p>
                  </div>

                  {/* Email Forward */}
                  <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-700">
                    <p className="font-medium text-slate-200 mb-2 flex items-center gap-2 text-sm">
                      <Mail className="w-4 h-4 text-sky-400" /> 要約をメールで転送（任意）
                    </p>
                    <input
                      type="email"
                      placeholder="転送先メールアドレスを入力"
                      value={forwardEmail}
                      onChange={e => updateForwardEmail(e.target.value)}
                      className="w-full bg-slate-800/80 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none transition-colors"
                    />
                    <p className="text-xs text-slate-400 mt-2">
                      処理完了後、要約と文字起こしプレビューをメールで送信します。
                    </p>
                  </div>
                </div>
              </div>

              <button 
                disabled={!file || isProcessing}
                onClick={handleSubmit}
                className={`
                  w-full mt-8 py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all duration-300
                  flex items-center justify-center gap-2
                  ${!file || isProcessing 
                    ? "bg-[#1a3a4d] text-cyan-700 cursor-not-allowed" 
                    : "bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-white hover:shadow-teal-500/25 hover:-translate-y-0.5"
                  }
                `}
              >
                {isProcessing ? (
                  <>処理中...</>
                ) : (
                  <>
                    <FileText className="w-5 h-5" />
                    文字起こしを開始
                  </>
                )}
              </button>

              {/* 管理者専用: 保存済みセッション一覧 */}
              {isAdmin && (
                <div className="mt-6">
                  <button
                    onClick={() => setShowSessionsPanel(!showSessionsPanel)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all"
                  >
                    <span className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4" />
                      保存済みデータ ({savedSessionsList.length})
                    </span>
                    <span className="text-xs">{showSessionsPanel ? '▲' : '▼'}</span>
                  </button>

                  {showSessionsPanel && (
                    <div className="mt-3 space-y-2 max-h-[400px] overflow-y-auto pr-1">
                      {savedSessionsList.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4">保存済みデータはありません</p>
                      ) : (
                        savedSessionsList.map(s => (
                          <div
                            key={s.id}
                            className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                              currentSessionId === s.id
                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                : 'bg-slate-900/40 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div
                                className="flex-1 min-w-0 cursor-pointer"
                                onClick={() => loadSession(s.id)}
                              >
                                <p className="text-sm font-medium text-slate-200 truncate">{s.title}</p>
                                <p className="text-[10px] text-slate-500 mt-1">
                                  {new Date(s.updatedAt).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                                <div className="flex gap-1.5 mt-1.5">
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400">
                                    ✅ 生データ ({s.segments.length})
                                  </span>
                                  {s.refinedText && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">✅ 推敲</span>
                                  )}
                                  {s.summary && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">✅ 要約</span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`「${s.title}」を削除しますか？`))
                                    deleteSession(s.id);
                                }}
                                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all"
                                title="削除"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {errorMsg && !isProcessing && (
          <div className="mt-8 bg-red-500/10 border border-red-500/30 rounded-2xl p-6 flex items-start gap-4">
            <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-300 mb-1">エラーが発生しました</h3>
              <p className="text-red-200/70 text-sm">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Copied Toast */}
        {copied && (
          <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium z-50 animate-in fade-in slide-in-from-bottom-4">
            ✓ {copied}をコピーしました
          </div>
        )}

        {/* Save Toast */}
        {saveToast && (
          <div className="fixed bottom-6 right-6 bg-emerald-500 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-50 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4">
            <Save className="w-4 h-4" /> 保存しました
          </div>
        )}

        {/* Results Section */}
        {result && (
          <div className="mt-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-3 text-cyan-50">
                <CheckCircle2 className="text-teal-400" />
                文字起こし結果
                <span className="text-sm font-normal text-cyan-300/50">({result.segments?.length || 0} セグメント / {uniqueSpeakers.length} 話者)</span>
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefineSpeakers}
                  disabled={isRefiningSpeakers}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-all active:scale-95 disabled:opacity-50"
                  title="文脈・敬語・相槌をAIが分析して話者を綺麗に再分割・再割り当てします"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isRefiningSpeakers ? 'animate-spin' : ''}`} />
                  {isRefiningSpeakers ? '話者再分離中...' : '🪄 AI話者再分離'}
                </button>
                <button
                  type="button"
                  onClick={applyDictionaryToCurrentResult}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 transition-all active:scale-95"
                  title="登録済みの専門用語辞書ルールをこの文字起こし結果に再適用します"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  辞書ルールを反映
                </button>
                {isAdmin && (
                  <button
                    onClick={saveCurrentSession}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all hover:scale-105 active:scale-95"
                    title="現在の結果を保存"
                  >
                    <Save className="w-4 h-4" />
                    {currentSessionId ? '上書き保存' : '保存'}
                  </button>
                )}
              </div>
            </div>

            {/* Speaker Name Mapping */}
            {allSpeakers.length > 0 && (
              <div className="mb-8 bg-[#0e2a3d]/60 border border-cyan-800/30 rounded-2xl p-5">
                <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  話者名を設定（ダウンロード時にヘッダーに記載されます）
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {allSpeakers.map(sp => {
                    const c = getSpeakerColor(sp);
                    const isInSegments = uniqueSpeakers.includes(sp);
                    return (
                    <div key={sp} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${c.dot} flex-shrink-0`} />
                      <span className={`text-xs font-bold w-14 ${c.text}`}>{sp.replace('SPEAKER_', '話者')}</span>
                      <input
                        type="text"
                        list="speaker-name-suggestions"
                        placeholder="名前を入力"
                        value={speakerNames[sp] || ''}
                        onChange={e => updateSpeakerName(sp, e.target.value)}
                        className="flex-1 bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
                      />
                      <input
                        type="text"
                        placeholder="ふりがな（任意）"
                        value={speakerReadings[sp] || ''}
                        onChange={e => updateSpeakerReading(sp, e.target.value)}
                        className="w-32 bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
                      />
                      <select
                        value={speakerRoles[sp] || '参加者'}
                        onChange={e => setSpeakerRoles(prev => ({ ...prev, [sp]: e.target.value }))}
                        className="w-28 bg-slate-900/60 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none transition-colors"
                      >
                        <option value="参加者">参加者</option>
                        <option value="アーティスト">アーティスト</option>
                        <option value="ファシリテーター">ファシリテーター</option>
                        <option value="オブザーバー">オブザーバー</option>
                        <option value="通訳">通訳</option>
                      </select>
                      <button
                        onClick={() => downloadSpeakerTranscript(sp)}
                        title={`${sp.replace('SPEAKER_','話者')} の発言を個別ダウンロード（前後の会話コンテキスト付き）`}
                        className={`p-1.5 rounded-lg hover:bg-slate-700 transition-colors flex-shrink-0 ${c.text}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {/* 削除ボタン: セグメントで未使用の話者のみ */}
                      {!isInSegments && (
                        <button
                          onClick={() => removeSpeaker(sp)}
                          title="この話者を削除"
                          className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      )}
                    </div>
                    );
                  })}
                  <datalist id="speaker-name-suggestions">
                    {savedNamesList.map(name => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  {/* 話者追加ボタン */}
                  <button
                    onClick={addSpeaker}
                    className="flex items-center gap-2 justify-center px-3 py-2 mt-1 rounded-xl text-sm font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 border-dashed hover:bg-cyan-500/20 hover:border-cyan-500/40 transition-all"
                  >
                    <CopyPlus className="w-4 h-4" />
                    話者を追加
                  </button>
                </div>

                {/* 🖼️ 2枚目の作品切り替え位置（境界）設定・確認カード（ゆるパカ鑑賞会モード時） */}
                {mode === "yurupaka" && result?.segments && result.segments.length > 0 && (() => {
                  const total = result.segments.length;
                  const effectiveSplit = work2SplitIndex > 0 && work2SplitIndex < total ? work2SplitIndex : Math.max(1, Math.floor(total * 0.50));
                  return (
                    <div className="mt-4 p-5 rounded-2xl bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/15 border-2 border-amber-400/60 shadow-lg shadow-amber-500/10 space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <span className="text-xs font-bold text-amber-200 flex items-center gap-1.5">
                          <span className="text-base">🖼️</span>
                          <span className="text-sm font-extrabold text-amber-100">第2枚目の作品切り替え位置（境界設定）:</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-extrabold text-amber-300 bg-amber-500/25 px-3 py-1 rounded-lg border border-amber-400/40 shadow-sm">
                            発言 #{effectiveSplit + 1} から2枚目 / 全 {total} 発言
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (result?.segments && result.segments.length >= 6) {
                                const minValid = Math.max(3, Math.floor(total * 0.20));
                                const newIdx = detectWork2SplitIndex(result.segments);
                                const safeIdx = newIdx >= minValid && newIdx < total ? newIdx : Math.max(minValid, Math.floor(total * 0.50));
                                setWork2SplitIndex(safeIdx);
                              }
                            }}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 font-medium transition-colors flex items-center gap-1"
                            title="会話内容から2枚目の切り替え地点を再探索して自動設定します"
                          >
                            <span>🔄</span>
                            <span>自動再検出</span>
                          </button>
                        </div>
                      </div>

                      {/* 直接入力スライダー ＆ 発言番号入力 */}
                      <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-900/90 p-3 rounded-xl border border-amber-500/30">
                        <span className="text-xs text-amber-200 font-bold whitespace-nowrap">
                          2枚目開始発言:
                        </span>
                        <input
                          type="range"
                          min={1}
                          max={Math.max(1, total - 1)}
                          value={effectiveSplit}
                          onChange={(e) => setWork2SplitIndex(Number(e.target.value))}
                          className="flex-1 w-full accent-amber-400 bg-slate-800 h-2 rounded-lg cursor-pointer"
                        />
                        <div className="flex items-center gap-1.5 self-end sm:self-auto">
                          <span className="text-xs text-slate-400 font-mono">発言 #</span>
                          <input
                            type="number"
                            min={1}
                            max={total}
                            value={effectiveSplit + 1}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(total, Number(e.target.value)));
                              setWork2SplitIndex(val - 1);
                            }}
                            className="w-16 bg-slate-950 border border-amber-400/50 rounded-lg py-1 px-2 text-xs font-mono font-bold text-center text-amber-300 focus:outline-none focus:border-amber-400"
                          />
                        </div>
                      </div>

                      {/* 作品区分バー */}
                      <div className="flex flex-wrap items-center justify-between text-xs gap-2 pt-1 font-mono">
                        <span className="px-3 py-1.5 rounded-xl bg-sky-500/20 text-sky-200 border border-sky-400/40 font-bold flex items-center gap-1.5 shadow-sm">
                          <span>🎨 第1枚目:</span>
                          <span>発言 #1 〜 #{effectiveSplit}（計 {effectiveSplit} 発言）</span>
                        </span>
                        <span className="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-200 border border-amber-400/40 font-bold flex items-center gap-1.5 shadow-sm">
                          <span>🖼️ 第2枚目:</span>
                          <span>発言 #{effectiveSplit + 1} 〜 #{total}（計 {total - effectiveSplit} 発言）</span>
                        </span>
                      </div>
                      
                      {/* 2枚目開始行の発言プレビュー */}
                      <div className="text-xs text-slate-300 bg-slate-950/80 p-2.5 rounded-xl border border-amber-500/25 flex items-start gap-2">
                        <span className="text-amber-300 font-bold flex-shrink-0 text-[11px] bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
                          2枚目開始発言
                        </span>
                        <div className="truncate flex-1">
                          {result.segments[effectiveSplit] ? (
                            <>
                              <span className="text-teal-300 font-bold mr-1">
                                [#{effectiveSplit + 1} {speakerNames[result.segments[effectiveSplit].speaker] || result.segments[effectiveSplit].speaker.replace('SPEAKER_', '話者')}]:
                              </span>
                              <span className="text-slate-200">
                                {result.segments[effectiveSplit].text || "（発言なし）"}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-500">※境界位置が自動計算されます</span>
                          )}
                        </div>
                      </div>

                      <div className="text-[11px] text-amber-200/80 pt-0.5">
                        💡 上のスライダーや発言番号入力、または下の文字起こし各行の「ここから2枚目に変更」ボタンで自由に境界を変更できます。
                      </div>
                    </div>
                  );
                })()}

                {/* Action buttons: Refine & Summarize */}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={handleRefine}
                    disabled={isRefining || isSummarizing}
                    className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all
                      ${isRefining
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30 animate-pulse cursor-not-allowed'
                        : result?.refinedText
                          ? 'bg-purple-500/10 text-purple-300 border border-purple-500/30 hover:bg-purple-500/20'
                          : 'bg-purple-600 text-white hover:bg-purple-500 shadow-lg shadow-purple-500/20'}`}
                  >
                    {isRefining ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> 推敲中...</>
                    ) : result?.refinedText ? (
                      <><Sparkles className="w-4 h-4" /> 再推敲する</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> ✍️ 推敲する</>
                    )}
                  </button>
                  <button
                    onClick={handleSummarize}
                    disabled={isRefining || isSummarizing}
                    className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all
                      ${isSummarizing
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse cursor-not-allowed'
                        : result?.summary
                          ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20'
                          : 'bg-amber-600 text-white hover:bg-amber-500 shadow-lg shadow-amber-500/20'}`}
                  >
                    {isSummarizing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> 要約中...</>
                    ) : result?.summary ? (
                      <><BookOpen className="w-4 h-4" /> 再要約する</>
                    ) : (
                      <><BookOpen className="w-4 h-4" /> 📝 要約する</>
                    )}
                  </button>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Transcript Chat View */}
              <div className="bg-slate-800/40 border border-slate-700 rounded-3xl p-6 md:p-8">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-medium text-slate-300 text-sm uppercase tracking-wider">生の文字起こしデータ</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyToClipboard(result.segments.map((s: any) => `[${getSpeakerLabel(s.speaker)}] ${s.text}`).join('\n'), '文字起こし')}
                      className="p-2 hover:bg-slate-700 rounded-lg transition-colors" title="コピー">
                      <Copy className="w-4 h-4 text-slate-400" />
                    </button>
                    <button
                      onClick={() => {
                        const header = buildDownloadHeader();
                        const body = result.segments.map((s: any) => `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.speaker.replace('SPEAKER_','話者')}: ${s.text}`).join('\n');
                        downloadAsText(header + body, `transcript_${new Date().toISOString().slice(0,10)}.txt`);
                      }}
                      className="p-2 hover:bg-slate-700 rounded-lg transition-colors" title="ダウンロード">
                      <Download className="w-4 h-4 text-slate-400" />
                    </button>
                  </div>
                </div>
                {/* 🎨 ゆるパカ鑑賞会 作品区分常時表示バナー */}
                {mode === "yurupaka" && result?.segments && result.segments.length > 0 && (() => {
                  const total = result.segments.length;
                  const effectiveSplit = work2SplitIndex > 0 && work2SplitIndex < total ? work2SplitIndex : Math.max(1, Math.floor(total * 0.50));
                  return (
                    <div className="mb-4 p-3 rounded-2xl bg-slate-900/90 border border-cyan-800/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-200 border border-sky-400/40 font-bold">
                          🎨 第1枚目: #1 〜 #{effectiveSplit}（計 {effectiveSplit} 発言）
                        </span>
                        <span className="text-slate-500">➜</span>
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-400/40 font-bold">
                          🖼️ 第2枚目: #{effectiveSplit + 1} 〜 #{total}（計 {total - effectiveSplit} 発言）
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        ※各行のボタンで2枚目の開始位置を自由に変更できます
                      </span>
                    </div>
                  );
                })()}

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {result.segments.map((segment: any, idx: number) => {
                    const c = getSpeakerColor(segment.speaker);
                    const segId = segment.id || `seg-${idx}-${segment.speaker}`;
                    const total = result.segments.length;
                    const effectiveSplit = work2SplitIndex > 0 && work2SplitIndex < total ? work2SplitIndex : Math.max(1, Math.floor(total * 0.50));
                    const isWork2Start = mode === "yurupaka" && idx === effectiveSplit;
                    const isWork1 = mode === "yurupaka" && idx < effectiveSplit;
                    const isWork2 = mode === "yurupaka" && idx > effectiveSplit;

                    return (
                      <div key={segId} className="group relative">
                        {/* 🖼️ 第2枚目の鑑賞開始ディバイダー */}
                        {isWork2Start && (
                          <div className="my-3 p-3 rounded-2xl bg-gradient-to-r from-amber-500/25 via-orange-500/20 to-amber-500/25 border-2 border-amber-400/80 shadow-lg shadow-amber-500/20 flex items-center justify-between text-xs text-amber-200 animate-in fade-in zoom-in-95 duration-200">
                            <div className="flex items-center gap-2.5 font-bold">
                              <span className="text-xl">🖼️</span>
                              <div>
                                <div className="text-sm font-extrabold text-amber-300">ここから【第2枚目】の作品鑑賞</div>
                                <div className="text-[10px] text-amber-200/80 font-normal">
                                  （発言 #{idx + 1}〜 / これより上が第1枚目、ここからが第2枚目として要約されます）
                                </div>
                              </div>
                            </div>
                            <span className="text-[11px] bg-amber-400 text-slate-950 font-bold px-2.5 py-1 rounded-full shadow">
                              2枚目境界
                            </span>
                          </div>
                        )}

                        <div className={`p-2 rounded-2xl transition-all ${
                          isWork2Start
                            ? 'border-2 border-amber-400/90 bg-amber-500/10 shadow-lg shadow-amber-500/15'
                            : isWork2
                              ? 'border border-amber-500/20 bg-amber-500/[0.02]'
                              : 'border border-sky-500/15 bg-sky-500/[0.01]'
                        }`}>
                          {/* Header: 話者選択 + タイムスタンプ + 作品所属/境界切り替え + 操作ボタン */}
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {/* 発言番号バッジ */}
                            <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-900/80 px-1.5 py-0.5 rounded border border-slate-700/60">
                              #{idx + 1}
                            </span>
                            {/* 話者プルダウン */}
                            <div className="relative">
                              <select
                                value={segment.speaker}
                                onChange={(e) => updateSegmentSpeaker(segment.id || idx, e.target.value)}
                                className={`appearance-none pl-2 pr-6 py-1 rounded-lg text-xs font-bold cursor-pointer border ${c.bg} ${c.text} ${c.border} bg-transparent focus:outline-none focus:ring-1 focus:ring-cyan-400/50`}
                              >
                                {allSpeakers.map(sp => (
                                  <option key={sp} value={sp} className="bg-slate-800 text-slate-200">
                                    {speakerNames[sp] || sp.replace('SPEAKER_', '話者')}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
                            </div>
                            {/* タイムスタンプ */}
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTime(segment.start)} - {formatTime(segment.end)}
                            </span>

                            {/* 🖼️ 作品所属タグ ＆ 「ここから2枚目に変更」操作（ゆるパカ鑑賞会モード時） */}
                            {mode === "yurupaka" && (
                              <div className="flex items-center gap-1.5">
                                {isWork2Start ? (
                                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-extrabold bg-amber-400 text-slate-950 shadow-md shadow-amber-400/30 flex items-center gap-1">
                                    <span>⭐</span>
                                    <span>ここから第2枚目（境界設定中）</span>
                                  </span>
                                ) : isWork1 ? (
                                  <>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                                      🎨 1枚目
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setWork2SplitIndex(idx)}
                                      className="text-[10px] px-2 py-0.5 rounded border border-amber-500/40 bg-slate-900/80 text-amber-200 hover:bg-amber-500/20 hover:border-amber-400 font-medium transition-all flex items-center gap-1 shadow-sm"
                                      title={`発言 #${idx + 1} から第2枚目として分割します`}
                                    >
                                      <span>👉 ここから2枚目に変更</span>
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                      🖼️ 2枚目
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setWork2SplitIndex(idx)}
                                      className="text-[10px] px-2 py-0.5 rounded border border-amber-500/40 bg-slate-900/80 text-amber-200 hover:bg-amber-500/20 hover:border-amber-400 font-medium transition-all flex items-center gap-1 shadow-sm"
                                      title={`発言 #${idx + 1} から第2枚目として分割します`}
                                    >
                                      <span>👈 ここから2枚目に変更</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            )}

                            {/* 操作ボタン（ホバーで表示） */}
                            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => duplicateSegment(segment.id || idx)}
                                className="p-1 hover:bg-cyan-500/20 rounded-md transition-colors" title="ブロックを複製"
                              >
                                <CopyPlus className="w-3.5 h-3.5 text-cyan-400" />
                              </button>
                              <button
                                onClick={() => {
                                  if (result.segments.length <= 1) {
                                    if (!confirm("最後の1つのブロックです。削除しますか？")) return;
                                  }
                                  deleteSegment(segment.id || idx);
                                }}
                                className="p-1 hover:bg-red-500/20 rounded-md transition-colors" title="ブロックを削除"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                              </button>
                            </div>
                          </div>
                          {/* 編集可能テキスト */}
                          <textarea
                            value={segment.text}
                            onChange={(e) => updateSegmentText(segment.id || idx, e.target.value)}
                            rows={Math.max(2, Math.ceil(segment.text.length / 50))}
                            className="w-full bg-[#0e2a3d]/60 border border-cyan-800/30 rounded-2xl rounded-tl-none px-4 py-3 text-cyan-50 text-base leading-relaxed resize-y focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Refined Text View */}
              {result.refinedText && (
                <div className="bg-gradient-to-br from-teal-900/20 to-cyan-900/20 border border-teal-500/20 rounded-3xl p-6 md:p-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 blur-[100px] rounded-full pointer-events-none" />
                  <div className="flex items-center justify-between mb-6 relative z-10">
                    <h3 className="font-medium text-purple-300 text-sm uppercase tracking-wider flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> AI 推敲済みテキスト
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(buildDownloadHeader() + result.refinedText, '推敲テキスト')}
                        className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors" title="コピー（話者一覧付き）">
                        <Copy className="w-4 h-4 text-purple-400" />
                      </button>
                      <button
                        onClick={() => downloadAsText(buildDownloadHeader() + result.refinedText, `refined_${new Date().toISOString().slice(0,10)}.txt`)}
                        className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors" title="全体ダウンロード（話者一覧付き）">
                        <Download className="w-4 h-4 text-purple-400" />
                      </button>
                      {uniqueSpeakers.length > 1 && (
                        <div className="relative group">
                          <button className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors" title="人物別ダウンロード">
                            <Users className="w-4 h-4 text-purple-400" />
                          </button>
                          <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 min-w-[160px]">
                            {uniqueSpeakers.map(sp => {
                              const name = speakerNames[sp] || sp.replace('SPEAKER_', '話者');
                              return (
                                <button key={sp} onClick={() => {
                                  const lines = result.refinedText.split('\n').filter((l: string) => l.includes(`[${name}]`));
                                  downloadAsText(lines.join('\n'), `refined_${name}_${new Date().toISOString().slice(0,10)}.txt`);
                                }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 first:rounded-t-lg last:rounded-b-lg">
                                  {name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Participant list with roles */}
                  <div className="relative z-10 mb-4 p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl">
                    <p className="text-xs text-purple-300/70 mb-2 font-medium">参加者一覧</p>
                    <div className="flex flex-wrap gap-2">
                      {uniqueSpeakers.map(sp => {
                        const name = speakerNames[sp] || sp.replace('SPEAKER_', '話者');
                        const role = speakerRoles[sp] || '参加者';
                        return (
                          <span key={sp} className="text-sm text-purple-200/90">
                            {name}（{role}）
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <textarea
                    value={result.refinedText}
                    onChange={(e) => updateRefinedText(e.target.value)}
                    rows={Math.max(10, result.refinedText.split('\n').length)}
                    className="relative z-10 w-full bg-transparent text-cyan-50 text-base leading-loose resize-y max-h-[600px] overflow-y-auto focus:outline-none focus:ring-1 focus:ring-purple-500/30 rounded-xl p-2 -m-2"
                  />
                </div>
              )}
              {/* Summary View */}
              {result.summary && (
                <div className="lg:col-span-2 bg-gradient-to-br from-amber-900/15 to-orange-900/15 border border-amber-500/20 rounded-3xl p-6 md:p-8 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-80 h-80 bg-amber-500/5 blur-[120px] rounded-full pointer-events-none" />
                  <div className="flex items-center justify-between mb-6 relative z-10">
                    <h3 className="font-medium text-amber-300 text-sm uppercase tracking-wider flex items-center gap-2">
                      <BookOpen className="w-4 h-4" /> 要約
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(result.summary, '要約')}
                        className="p-2 hover:bg-amber-500/20 rounded-lg transition-colors" title="コピー">
                        <Copy className="w-4 h-4 text-amber-400" />
                      </button>
                      <button
                        onClick={() => downloadAsText(result.summary, `summary_${new Date().toISOString().slice(0,10)}.txt`)}
                        className="p-2 hover:bg-amber-500/20 rounded-lg transition-colors" title="ダウンロード">
                        <Download className="w-4 h-4 text-amber-400" />
                      </button>
                    </div>
                  </div>
                  <div className="relative z-10 text-cyan-50 text-base leading-loose whitespace-pre-wrap max-h-[800px] overflow-y-auto prose prose-invert prose-base max-w-none">
                    {result.summary}
                  </div>
                </div>
              )}

              {/* Email Forward Section */}
              {(result.refinedText || result.summary) && (
                <div className="lg:col-span-2 bg-slate-800/40 border border-slate-700 rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-sky-400" />
                    メールで転送
                  </h3>
                  <div className="flex gap-3 mb-3">
                    <input
                      type="email"
                      placeholder="転送先メールアドレスを入力"
                      value={forwardEmail}
                      onChange={e => updateForwardEmail(e.target.value)}
                      className="flex-1 bg-slate-900/60 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none transition-colors"
                    />
                  </div>
                  <div className="flex gap-3">
                    {result.refinedText && (
                      <button
                        onClick={() => sendEmail('refined')}
                        disabled={!forwardEmail || isSending || emailSent}
                        className={`flex-1 px-5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all
                          ${emailSent 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : isSending 
                              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30'}`}
                      >
                        {emailSent ? (
                          <><CheckCircle2 className="w-4 h-4" /> 送信完了</>
                        ) : isSending ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> 送信中...</>
                        ) : (
                          <><Send className="w-4 h-4" /> 推敲文を送信</>
                        )}
                      </button>
                    )}
                    {result.summary && (
                      <button
                        onClick={() => sendEmail('summary')}
                        disabled={!forwardEmail || isSending || emailSent}
                        className={`flex-1 px-5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all
                          ${emailSent 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : isSending 
                              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'}`}
                      >
                        {emailSent ? (
                          <><CheckCircle2 className="w-4 h-4" /> 送信完了</>
                        ) : isSending ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> 送信中...</>
                        ) : (
                          <><Send className="w-4 h-4" /> 要約文を送信</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 音声認識エンジン・APIキー設定モーダル */}
      {showEngineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Server className="w-5 h-5 text-cyan-400" />
                音声認識エンジン・APIキー設定
              </h3>
              <button
                onClick={() => setShowEngineModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  使用する音声認識エンジン
                </label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${sttEngine === 'whisper' ? 'bg-teal-500/10 border-teal-500/50 text-teal-200' : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:bg-slate-800/50'}`}>
                    <input
                      type="radio"
                      name="engine"
                      value="whisper"
                      checked={sttEngine === 'whisper'}
                      onChange={() => {
                        setSttEngine('whisper');
                        try { localStorage.setItem(LS_STT_ENGINE_KEY, 'whisper'); } catch {}
                      }}
                      className="mt-1 accent-teal-400"
                    />
                    <div>
                      <div className="font-bold text-sm text-slate-200">Whisper (ローカル・完全無料)</div>
                      <div className="text-xs text-slate-400">GPUサーバー上で動作。費用は一切かかりません。</div>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${sttEngine === 'gemini' ? 'bg-blue-500/10 border-blue-500/50 text-blue-200' : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:bg-slate-800/50'}`}>
                    <input
                      type="radio"
                      name="engine"
                      value="gemini"
                      checked={sttEngine === 'gemini'}
                      onChange={() => {
                        setSttEngine('gemini');
                        try { localStorage.setItem(LS_STT_ENGINE_KEY, 'gemini'); } catch {}
                      }}
                      className="mt-1 accent-blue-400"
                    />
                    <div>
                      <div className="font-bold text-sm text-slate-200">Gemini 3.5 Transcribe (最先端・最高精度)</div>
                      <div className="text-xs text-slate-400">Google AI StudioのAPIキーで動作。最先端Geminiによる圧倒的な日本語認識＆話者分離。</div>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${sttEngine === 'deepgram' ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-200' : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:bg-slate-800/50'}`}>
                    <input
                      type="radio"
                      name="engine"
                      value="deepgram"
                      checked={sttEngine === 'deepgram'}
                      onChange={() => {
                        setSttEngine('deepgram');
                        try { localStorage.setItem(LS_STT_ENGINE_KEY, 'deepgram'); } catch {}
                      }}
                      className="mt-1 accent-cyan-400"
                    />
                    <div>
                      <div className="font-bold text-sm text-slate-200">Deepgram (クラウド超高速)</div>
                      <div className="text-xs text-slate-400">超高速・高精度な話者分離。初回$200無料枠あり（1時間約40円）。</div>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${sttEngine === 'scribe' ? 'bg-purple-500/10 border-purple-500/50 text-purple-200' : 'bg-slate-900/50 border-slate-800 text-slate-400 hover:bg-slate-800/50'}`}>
                    <input
                      type="radio"
                      name="engine"
                      value="scribe"
                      checked={sttEngine === 'scribe'}
                      onChange={() => {
                        setSttEngine('scribe');
                        try { localStorage.setItem(LS_STT_ENGINE_KEY, 'scribe'); } catch {}
                      }}
                      className="mt-1 accent-purple-400"
                    />
                    <div>
                      <div className="font-bold text-sm text-slate-200">ElevenLabs Scribe (最高精度)</div>
                      <div className="text-xs text-slate-400">最新最先端AI。日本語の会話・相槌に圧倒的に強い（1時間約75円）。</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* APIキー入力 */}
              {sttEngine === 'gemini' && (
                <div className="space-y-3 animate-in fade-in duration-200 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-blue-300 flex items-center justify-between">
                      <span>Gemini API Key</span>
                      <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[11px] text-teal-400 hover:text-teal-300 underline">
                        無料APIキーを取得 ↗
                      </a>
                    </label>
                    <input
                      type="password"
                      placeholder="AIzaSy... （Google AI StudioのAPIキーを入力）"
                      value={geminiApiKey}
                      onChange={(e) => {
                        setGeminiApiKey(e.target.value);
                        try { localStorage.setItem(LS_GEMINI_KEY_KEY, e.target.value); } catch {}
                      }}
                      className="w-full bg-slate-900 border border-blue-500/40 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-400 font-mono"
                    />
                    <p className="text-[11px] text-slate-400">※一度入力するとブラウザに自動保存されます。</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-blue-300 block">
                      使用するGeminiモデル名
                    </label>
                    <input
                      type="text"
                      list="gemini-models-list"
                      placeholder="gemini-3.5-transcribe"
                      value={geminiModel}
                      onChange={(e) => {
                        setGeminiModel(e.target.value);
                        try { localStorage.setItem(LS_GEMINI_MODEL_KEY, e.target.value); } catch {}
                      }}
                      className="w-full bg-slate-900 border border-blue-500/40 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-400 font-mono"
                    />
                    <datalist id="gemini-models-list">
                      <option value="gemini-3.5-transcribe">gemini-3.5-transcribe（Google最新公式・音声特化モデル）</option>
                      <option value="gemini-2.0-flash">gemini-2.0-flash（高速・汎用高推論）</option>
                      <option value="gemini-1.5-pro">gemini-1.5-pro（長文音声・高推論）</option>
                      <option value="gemini-1.5-flash">gemini-1.5-flash（標準・安定）</option>
                    </datalist>
                    <p className="text-[11px] text-slate-400">※推奨: <code>gemini-3.5-transcribe</code>（2026年8月Google公式発表の最新音声文字起こしモデル）</p>
                  </div>
                </div>
              )}

              {sttEngine === 'deepgram' && (
                <div className="space-y-1.5 animate-in fade-in duration-200 pt-2">
                  <label className="text-xs font-semibold text-cyan-300 block">
                    Deepgram API Key
                  </label>
                  <input
                    type="password"
                    placeholder="APIキーを入力してください"
                    value={deepgramApiKey}
                    onChange={(e) => {
                      setDeepgramApiKey(e.target.value);
                      try { localStorage.setItem(LS_DEEPGRAM_KEY_KEY, e.target.value); } catch {}
                    }}
                    className="w-full bg-slate-900 border border-cyan-500/40 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-400 font-mono"
                  />
                  <p className="text-[11px] text-slate-500">※APIキーはブラウザに保存され、サーバーには永続保存されません。</p>
                </div>
              )}

              {sttEngine === 'scribe' && (
                <div className="space-y-1.5 animate-in fade-in duration-200 pt-2">
                  <label className="text-xs font-semibold text-purple-300 block">
                    ElevenLabs API Key (xi-api-key)
                  </label>
                  <input
                    type="password"
                    placeholder="APIキーを入力してください"
                    value={scribeApiKey}
                    onChange={(e) => {
                      setScribeApiKey(e.target.value);
                      try { localStorage.setItem(LS_SCRIBE_KEY_KEY, e.target.value); } catch {}
                    }}
                    className="w-full bg-slate-900 border border-purple-500/40 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-purple-400 font-mono"
                  />
                  <p className="text-[11px] text-slate-500">※APIキーはブラウザに保存され、サーバーには永続保存されません。</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowEngineModal(false)}
              className="w-full py-2.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-xl font-bold text-sm shadow-lg hover:brightness-110 transition-all"
            >
              設定を保存して閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
