"use client";

import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { UploadCloud, FileAudio, CheckCircle2, Settings, Loader2, PlayCircle, FileText, Sparkles, Volume2, Copy, Download, Clock, AlertCircle, Users, BookOpen, Mail, Send, Server, Wifi, WifiOff, Save, FolderOpen, Trash2 } from "lucide-react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const LS_SPEAKER_NAMES_KEY = 'ai-transcriber-speaker-names';
const LS_EMAIL_KEY = 'ai-transcriber-forward-email';
const LS_JOB_KEY = 'ai-transcriber-pending-job';
const LS_SERVER_KEY = 'ai-transcriber-backend-server';
const LS_SESSIONS_KEY = 'ai-transcriber-sessions';

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
  backendUrl: string;  // FastAPI の Tailscale Funnel URL
  gpu: string;
  llmModel: string;
  description: string;
  online?: boolean;
  gpuInfo?: string;    // ヘルスチェックで取得
}

const BACKEND_SERVERS: BackendServer[] = [
  {
    id: 'egpu-pc',
    name: 'eGPU',
    backendUrl: 'https://nucboxm7.goat-aldebaran.ts.net',
    gpu: 'RTX 5060 Ti (16GB)',
    llmModel: 'Gemma 4 e4b',
    description: 'WhisperX + Gemma 4',
  },
  {
    id: 'remote-pc',
    name: 'eGPU2（予備）',
    backendUrl: 'https://nucbox-m8.goat-aldebaran.ts.net',
    gpu: 'RTX2080 Ti (22GB)',
    llmModel: 'Gemma 4 e4b',
    description: 'WhisperX + Gemma 4',
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
  const abortRef = useRef<AbortController | null>(null);

  // 選択中のバックエンドサーバー情報を取得
  const selectedServer = useMemo(() => {
    return backendServers.find(s => s.id === selectedServerId) || backendServers[0];
  }, [backendServers, selectedServerId]);

  // 各バックエンドのヘルスチェック（ブラウザから直接）
  const checkBackendServers = useCallback(async () => {
    setCheckingServers(true);
    const updated = await Promise.all(
      BACKEND_SERVERS.map(async (server) => {
        if (!server.backendUrl) return { ...server, online: false, gpuInfo: '未設定' };
        try {
          const res = await fetch(`${server.backendUrl}/`, {
            signal: AbortSignal.timeout(10000),
            mode: 'cors',
          });
          if (res.ok) {
            const data = await res.json();
            return {
              ...server,
              online: true,
              gpuInfo: server.gpu,
            };
          }
          return { ...server, online: false, gpuInfo: server.gpu };
        } catch {
          // CORS error still means server is reachable - try no-cors ping
          try {
            const ping = await fetch(`${server.backendUrl}/`, {
              signal: AbortSignal.timeout(5000),
              mode: 'no-cors',
            });
            // no-cors returns opaque response (status 0) but means server is up
            return { ...server, online: true, gpuInfo: server.gpu };
          } catch {
            return { ...server, online: false, gpuInfo: server.gpu };
          }
        }
      })
    );
    setBackendServers(updated);
    setCheckingServers(false);
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
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const elapsedStr = `${Math.floor(elapsed/60)}分${elapsed%60}秒`;

        if (statusData.status === "completed") {
          isCompleted = true;
          setProgress({ step: `✅ 完了！`, percent: 100 });
          const completedResult = {
            segments: statusData.result?.segments || [],
            refinedText: statusData.result?.refinedText || null,
            summary: statusData.result?.summary || null,
          };
          setResult(completedResult);
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

  // Load saved names, email, server selection, and pending job from localStorage on mount
  useEffect(() => {
    setSavedNamesList(loadSavedNames());
    try {
      const savedEmail = localStorage.getItem(LS_EMAIL_KEY);
      if (savedEmail) setForwardEmail(savedEmail);
    } catch {}
    // Load saved LM server selection
    try {
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
    const fileName = file?.name || '不明なファイル';
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
  }, [result, isAdmin, file, currentSessionId, savedSessionsList, selectedServerId, speakerNames, speakerReadings, speakerRoles]);

  // セッション読み込み
  const loadSession = useCallback((sessionId: string) => {
    const sessions = loadSessions();
    const target = sessions.find(s => s.id === sessionId);
    if (!target) return;
    setResult({
      segments: target.segments,
      refinedText: target.refinedText,
      summary: target.summary,
    });
    setSpeakerNames(target.speakerNames || {});
    setSpeakerReadings(target.speakerReadings || {});
    setSpeakerRoles(target.speakerRoles || {});
    setCurrentSessionId(target.id);
    setFile(null);
    setErrorMsg(null);
    setShowSessionsPanel(false);
  }, []);

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
    if (!result?.segments) return [];
    const seen = new Set<string>();
    result.segments.forEach((s: any) => { if (s.speaker) seen.add(s.speaker); });
    return Array.from(seen).sort();
  }, [result]);

  const getSpeakerLabel = (speakerId: string) => {
    const name = speakerNames[speakerId];
    const short = speakerId.replace('SPEAKER_', '話者');
    return name ? `${short} (${name})` : short;
  };

  const buildDownloadHeader = () => {
    if (uniqueSpeakers.length === 0) return '';
    const lines = ['=== 話者一覧 ==='];
    uniqueSpeakers.forEach(sp => {
      const short = sp.replace('SPEAKER_', '話者');
      const name = speakerNames[sp] || '（未設定）';
      lines.push(`${short} = ${name}`);
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

    const controller = new AbortController();
    abortRef.current = controller;
    setIsProcessing(true);
    setErrorMsg(null);
    setResult(null);
    setProgress({ step: `📤 ${selectedServer.name} にアップロード中...`, percent: 5 });
    
    // Use selected backend server URL
    const BASE_URL = selectedServer.backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || "/api";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("diarization", "true");
    formData.append("refinement", "false");
    formData.append("summary", "false");

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
          
          const completedResult = {
            segments: statusData.result?.segments || [],
            refinedText: statusData.result?.refinedText || null,
            summary: statusData.result?.summary || null,
          };
          console.log('[DEBUG] completedResult refinedText:', completedResult.refinedText ? 'YES (' + completedResult.refinedText.length + ' chars)' : 'NULL');
          console.log('[DEBUG] completedResult summary:', completedResult.summary ? 'YES (' + completedResult.summary.length + ' chars)' : 'NULL');
          console.log('[DEBUG] forwardEmail:', forwardEmail);
          
          setResult(completedResult);
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
          setResult((prev: any) => ({ ...prev, refinedText: jobResult.refinedText }));
        }
      // Legacy sync mode: direct result
      } else if (data.refinedText) {
        setResult((prev: any) => ({ ...prev, refinedText: data.refinedText }));
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

  // Step 3: Summarize with speaker names (async polling)
  const handleSummarize = async () => {
    if (!result?.segments || isSummarizing) return;
    setIsSummarizing(true);
    setErrorMsg(null);
    try {
      const BACKEND = selectedServer.backendUrl || process.env.NEXT_PUBLIC_BACKEND_URL || "/api";
      const response = await fetch(`${BACKEND}/summarize`, {
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
      // Async mode
      if (data.jobId) {
        const jobResult = await pollJob(data.jobId, BACKEND);
        if (jobResult.summary) {
          setResult((prev: any) => ({ ...prev, summary: jobResult.summary }));
        }
      // Legacy sync mode
      } else if (data.summary) {
        setResult((prev: any) => ({ ...prev, summary: data.summary }));
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
                <span className="text-sm font-normal text-cyan-300/50">({result.segments.length} セグメント / {uniqueSpeakers.length} 話者)</span>
              </h2>
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

            {/* Speaker Name Mapping */}
            {uniqueSpeakers.length > 1 && (
              <div className="mb-8 bg-[#0e2a3d]/60 border border-cyan-800/30 rounded-2xl p-5">
                <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  話者名を設定（ダウンロード時にヘッダーに記載されます）
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {uniqueSpeakers.map(sp => {
                    const c = getSpeakerColor(sp);
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
                    </div>
                    );
                  })}
                  <datalist id="speaker-name-suggestions">
                    {savedNamesList.map(name => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>

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
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                  {result.segments.map((segment: any, idx: number) => (
                    <div key={idx} className="flex gap-3 group">
                      <div className="flex-shrink-0 mt-1">
                        {(() => {
                          const c = getSpeakerColor(segment.speaker);
                          return (
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${c.bg} ${c.text} border ${c.border}`}
                              title={speakerNames[segment.speaker] || segment.speaker}
                            >
                              {segment.speaker.replace('SPEAKER_', '話者')}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500 mb-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Clock className="w-3 h-3" />
                          {formatTime(segment.start)} - {formatTime(segment.end)}
                        </div>
                        <div className="bg-[#0e2a3d]/60 border border-cyan-800/30 rounded-2xl rounded-tl-none px-4 py-3 text-cyan-50 text-base leading-relaxed">
                          {segment.text}
                        </div>
                      </div>
                    </div>
                  ))}
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
                        onClick={() => copyToClipboard(result.refinedText, '推敲テキスト')}
                        className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors" title="コピー">
                        <Copy className="w-4 h-4 text-purple-400" />
                      </button>
                      <button
                        onClick={() => downloadAsText(result.refinedText, `refined_${new Date().toISOString().slice(0,10)}.txt`)}
                        className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors" title="全体ダウンロード">
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
                  <div className="relative z-10 text-cyan-50 text-base leading-loose whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                    {result.refinedText}
                  </div>
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
    </div>
  );
}
