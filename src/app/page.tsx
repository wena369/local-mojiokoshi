"use client";

import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { UploadCloud, FileAudio, CheckCircle2, Settings, Loader2, PlayCircle, FileText, Sparkles, Volume2, Copy, Download, Clock, AlertCircle, Users, BookOpen, Mail, Send } from "lucide-react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const LS_SPEAKER_NAMES_KEY = 'ai-transcriber-speaker-names';
const LS_EMAIL_KEY = 'ai-transcriber-forward-email';
const LS_JOB_KEY = 'ai-transcriber-pending-job';

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
  { bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/30', dot: 'bg-indigo-400' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  { bg: 'bg-rose-500/20', text: 'text-rose-300', border: 'border-rose-500/30', dot: 'bg-rose-400' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-300', border: 'border-cyan-500/30', dot: 'bg-cyan-400' },
  { bg: 'bg-violet-500/20', text: 'text-violet-300', border: 'border-violet-500/30', dot: 'bg-violet-400' },
  { bg: 'bg-lime-500/20', text: 'text-lime-300', border: 'border-lime-500/30', dot: 'bg-lime-400' },
  { bg: 'bg-pink-500/20', text: 'text-pink-300', border: 'border-pink-500/30', dot: 'bg-pink-400' },
  { bg: 'bg-teal-500/20', text: 'text-teal-300', border: 'border-teal-500/30', dot: 'bg-teal-400' },
  { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30', dot: 'bg-orange-400' },
  { bg: 'bg-sky-500/20', text: 'text-sky-300', border: 'border-sky-500/30', dot: 'bg-sky-400' },
  { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-300', border: 'border-fuchsia-500/30', dot: 'bg-fuchsia-400' },
  { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/30', dot: 'bg-yellow-400' },
  { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/30', dot: 'bg-red-400' },
  { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/30', dot: 'bg-green-400' },
];

function getSpeakerColor(speakerId: string) {
  const num = parseInt(speakerId.replace('SPEAKER_', ''), 10) || 0;
  return SPEAKER_COLORS[num % SPEAKER_COLORS.length];
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [useDiarization, setUseDiarization] = useState(true);
  const [useRefinement, setUseRefinement] = useState(false);
  const [useSummary, setUseSummary] = useState(false);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ step: string; percent: number }>({ step: "", percent: 0 });
  const [result, setResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [speakerNames, setSpeakerNames] = useState<Record<string, string>>({});
  const [forwardEmail, setForwardEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [savedNamesList, setSavedNamesList] = useState<string[]>([]);

  // Resume pending job on mount
  const resumePendingJob = useCallback(async (jobId: string) => {
    const BASE_URL = "/api";
    setIsProcessing(true);
    setErrorMsg(null);
    setResult(null);
    setProgress({ step: "🔄 前回のジョブを復帰中...", percent: 10 });
    const startTime = Date.now();
    try {
      let isCompleted = false;
      while (!isCompleted) {
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
                .map((s: any) => `[${s.speaker.replace('SPEAKER_','S')}] ${s.text}`)
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

  // Load saved names, email, and pending job from localStorage on mount
  useEffect(() => {
    setSavedNamesList(loadSavedNames());
    try {
      const savedEmail = localStorage.getItem(LS_EMAIL_KEY);
      if (savedEmail) setForwardEmail(savedEmail);
    } catch {}
    // Auto-resume pending job
    try {
      const pendingJob = localStorage.getItem(LS_JOB_KEY);
      if (pendingJob) {
        resumePendingJob(pendingJob);
      }
    } catch {}
  }, [resumePendingJob]);

  // Save speaker names to localStorage when they change
  const updateSpeakerName = useCallback((speakerId: string, name: string) => {
    setSpeakerNames(prev => {
      const next = { ...prev, [speakerId]: name };
      // Save all non-empty names to the saved list
      const allNames = [...savedNamesList, ...Object.values(next)];
      saveSpeakerNames(allNames);
      setSavedNamesList(loadSavedNames());
      return next;
    });
  }, [savedNamesList]);

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
    const short = speakerId.replace('SPEAKER_', 'S');
    return name ? `${short} (${name})` : short;
  };

  const buildDownloadHeader = () => {
    if (uniqueSpeakers.length === 0) return '';
    const lines = ['=== 話者一覧 ==='];
    uniqueSpeakers.forEach(sp => {
      const short = sp.replace('SPEAKER_', 'S');
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
    const name = speakerNames[targetSpeaker] || targetSpeaker.replace('SPEAKER_', 'S');
    const short = targetSpeaker.replace('SPEAKER_', 'S');
    
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

  const sendSummaryEmail = async () => {
    if (!forwardEmail || !result?.summary) return;
    setIsSending(true);
    try {
      const preview = result.segments
        .slice(0, 20)
        .map((s: any) => `[${s.speaker.replace('SPEAKER_','S')}] ${s.text}`)
        .join('\n');
      const res = await fetch('/api/send-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: forwardEmail,
          summary: result.summary,
          title: file?.name?.replace(/\.[^.]+$/, '') || undefined,
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
    if (selectedFile.type.startsWith("audio/") || selectedFile.type.startsWith("video/")) {
      setFile(selectedFile);
    } else {
      alert("音声または動画ファイルを選択してください。");
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

    setIsProcessing(true);
    setErrorMsg(null);
    setResult(null);
    setProgress({ step: "📤 ファイルをeGPUにアップロード中...", percent: 5 });
    
    // Use direct backend URL to bypass Vercel's 4.5MB body limit
    const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "/api";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("diarization", useDiarization.toString());
    formData.append("refinement", useRefinement.toString());
    formData.append("summary", useSummary.toString());

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
        await new Promise(resolve => setTimeout(resolve, 3000));
        
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
                .map((s: any) => `[${s.speaker.replace('SPEAKER_','S')}] ${s.text}`)
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white selection:bg-indigo-500/30">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Header Section */}
        <header className="text-center mb-16 space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-indigo-500/10 rounded-2xl mb-4 border border-indigo-500/20 shadow-[0_0_30px_-5px_rgba(99,102,241,0.3)]">
            <Volume2 className="w-8 h-8 text-indigo-400" />
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 via-white to-indigo-200">
            ローカルAI文字起こし
          </h1>
          <p className="text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
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
                ${isDragging ? "border-indigo-400 bg-indigo-500/10 scale-[1.02]" : "border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800/80"}
                ${file ? "border-emerald-500/50 bg-emerald-500/5" : ""}
              `}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={(e) => e.target.files && handleFileSelection(e.target.files[0])} 
                className="hidden" 
                accept="audio/*,video/*"
              />
              
              {!file ? (
                <>
                  <div className="absolute inset-0 bg-gradient-to-t from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <UploadCloud className={`w-16 h-16 mb-6 transition-colors duration-300 ${isDragging ? "text-indigo-400" : "text-slate-500 group-hover:text-indigo-400"}`} />
                  <h3 className="text-xl font-semibold mb-2">音声・動画ファイルをドロップ</h3>
                  <p className="text-slate-400 text-sm mb-6">または クリックしてファイルを選択</p>
                  <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">MP3</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">WAV</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">M4A</span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full border border-slate-700">MP4</span>
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
              <div className="bg-slate-800/80 backdrop-blur border border-slate-700 rounded-2xl p-6 shadow-xl animate-in fade-in slide-in-from-bottom-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                    <span className="font-medium text-slate-200">{progress.step}</span>
                  </div>
                  <span className="text-indigo-300 font-mono text-sm">{progress.percent}%</span>
                </div>
                <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500 ease-out"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Options Column */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-3xl p-6 shadow-xl">
              <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-700">
                <Settings className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-lg">AI 処理オプション</h3>
              </div>

              <div className="space-y-4">
                {/* Diarization Toggle */}
                <label className="flex items-start gap-4 p-4 rounded-2xl bg-slate-900/50 border border-slate-700 cursor-pointer hover:border-indigo-500/50 transition-colors group">
                  <div className="flex-shrink-0 pt-1">
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${useDiarization ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600 group-hover:border-indigo-400'}`}>
                      {useDiarization && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <input type="checkbox" className="hidden" checked={useDiarization} onChange={(e) => setUseDiarization(e.target.checked)} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-200 mb-1 flex items-center gap-2">
                      <PlayCircle className="w-4 h-4 text-emerald-400" /> 話者を識別する
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      誰が話したかを「話者A」「話者B」のように分離します。会議の議事録などに最適です。
                    </p>
                  </div>
                </label>

                {/* Refinement Toggle */}
                <label className="flex items-start gap-4 p-4 rounded-2xl bg-slate-900/50 border border-slate-700 cursor-pointer hover:border-purple-500/50 transition-colors group">
                  <div className="flex-shrink-0 pt-1">
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${useRefinement ? 'bg-purple-500 border-purple-500' : 'border-slate-600 group-hover:border-purple-400'}`}>
                      {useRefinement && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <input type="checkbox" className="hidden" checked={useRefinement} onChange={(e) => setUseRefinement(e.target.checked)} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-200 mb-1 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" /> 日本語を推敲・整形
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      ローカルLLMを使用して、「えー」「あの」などのケバを取り除き、自然な文章に修正します。
                    </p>
                  </div>
                </label>

                {/* Summary Toggle */}
                <label className="flex items-start gap-4 p-4 rounded-2xl bg-slate-900/50 border border-slate-700 cursor-pointer hover:border-amber-500/50 transition-colors group">
                  <div className="flex-shrink-0 pt-1">
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${useSummary ? 'bg-amber-500 border-amber-500' : 'border-slate-600 group-hover:border-amber-400'}`}>
                      {useSummary && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <input type="checkbox" className="hidden" checked={useSummary} onChange={(e) => setUseSummary(e.target.checked)} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-200 mb-1 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-amber-400" /> 要約を生成
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      会議の内容をトピックごとに構造化して要約します。議事録やレポート作成に最適です。
                    </p>
                  </div>
                </label>

                {/* Email Forward (shown when summary is enabled) */}
                {useSummary && (
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
                )}
              </div>

              <button 
                disabled={!file || isProcessing}
                onClick={handleSubmit}
                className={`
                  w-full mt-8 py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all duration-300
                  flex items-center justify-center gap-2
                  ${!file || isProcessing 
                    ? "bg-slate-700 text-slate-400 cursor-not-allowed" 
                    : "bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white hover:shadow-indigo-500/25 hover:-translate-y-0.5"
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

        {/* Results Section */}
        {result && (
          <div className="mt-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
            {/* DEBUG INFO - visible on page */}
            <div className="mb-4 p-4 bg-yellow-900/30 border border-yellow-500/50 rounded-xl text-xs font-mono text-yellow-200 space-y-1">
              <p className="font-bold text-yellow-400">🔍 デバッグ情報（問題解決後に削除）</p>
              <p>result keys: {Object.keys(result).join(', ')}</p>
              <p>segments: {result.segments?.length ?? 'undefined'} 件</p>
              <p>refinedText: {result.refinedText === null ? '❌ null' : result.refinedText === undefined ? '❌ undefined' : result.refinedText === '' ? '⚠️ 空文字' : `✅ あり (${result.refinedText.length}文字)`}</p>
              <p>summary: {result.summary === null ? '❌ null' : result.summary === undefined ? '❌ undefined' : result.summary === '' ? '⚠️ 空文字' : `✅ あり (${result.summary.length}文字)`}</p>
              <p>forwardEmail: {forwardEmail ? `✅ ${forwardEmail}` : '❌ 未設定'}</p>
              <p>emailSent: {emailSent ? '✅ 送信済み' : '❌ 未送信'}</p>
              {result.refinedText && <p className="text-green-300">refinedText先頭50文字: {result.refinedText.slice(0, 50)}...</p>}
              {result.summary && <p className="text-green-300">summary先頭50文字: {result.summary.slice(0, 50)}...</p>}
            </div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-3">
                <CheckCircle2 className="text-emerald-400" />
                文字起こし結果
                <span className="text-sm font-normal text-slate-400">({result.segments.length} セグメント / {uniqueSpeakers.length} 話者)</span>
              </h2>
            </div>

            {/* Speaker Name Mapping */}
            {uniqueSpeakers.length > 1 && (
              <div className="mb-8 bg-slate-800/40 border border-slate-700 rounded-2xl p-5">
                <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  話者名を設定（ダウンロード時にヘッダーに記載されます）
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {uniqueSpeakers.map(sp => {
                    const c = getSpeakerColor(sp);
                    return (
                    <div key={sp} className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${c.dot} flex-shrink-0`} />
                      <span className={`text-xs font-bold w-7 ${c.text}`}>{sp.replace('SPEAKER_', 'S')}</span>
                      <input
                        type="text"
                        list="speaker-name-suggestions"
                        placeholder="名前を入力"
                        value={speakerNames[sp] || ''}
                        onChange={e => updateSpeakerName(sp, e.target.value)}
                        className="flex-1 bg-slate-900/60 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
                      />
                      <button
                        onClick={() => downloadSpeakerTranscript(sp)}
                        title={`${sp.replace('SPEAKER_','S')} の発言を個別ダウンロード（前後の会話コンテキスト付き）`}
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
                        const body = result.segments.map((s: any) => `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.speaker.replace('SPEAKER_','S')}: ${s.text}`).join('\n');
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
                              {segment.speaker.replace('SPEAKER_', 'S')}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex-1">
                        <div className="text-[10px] text-slate-500 mb-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Clock className="w-3 h-3" />
                          {formatTime(segment.start)} - {formatTime(segment.end)}
                        </div>
                        <div className="bg-slate-900/60 border border-slate-700 rounded-2xl rounded-tl-none px-4 py-3 text-slate-200 text-sm leading-relaxed">
                          {segment.text}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Refined Text View */}
              {result.refinedText && (
                <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border border-purple-500/20 rounded-3xl p-6 md:p-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-purple-500/10 blur-[100px] rounded-full" />
                  <div className="flex items-center justify-between mb-6">
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
                        className="p-2 hover:bg-purple-500/20 rounded-lg transition-colors" title="ダウンロード">
                        <Download className="w-4 h-4 text-purple-400" />
                      </button>
                    </div>
                  </div>
                  <div className="relative z-10 text-slate-200 leading-loose whitespace-pre-wrap max-h-[600px] overflow-y-auto">
                    {result.refinedText}
                  </div>
                </div>
              )}
              {/* Summary View */}
              {result.summary && (
                <div className="lg:col-span-2 bg-gradient-to-br from-amber-900/15 to-orange-900/15 border border-amber-500/20 rounded-3xl p-6 md:p-8 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-80 h-80 bg-amber-500/5 blur-[120px] rounded-full" />
                  <div className="flex items-center justify-between mb-6">
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
                  <div className="relative z-10 text-slate-200 leading-loose whitespace-pre-wrap max-h-[800px] overflow-y-auto prose prose-invert prose-sm max-w-none">
                    {result.summary}
                  </div>
                </div>
              )}

              {/* Email Forward Section */}
              {result.summary && (
                <div className="lg:col-span-2 bg-slate-800/40 border border-slate-700 rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-sky-400" />
                    要約をメールで転送
                  </h3>
                  <div className="flex gap-3">
                    <input
                      type="email"
                      placeholder="転送先メールアドレスを入力"
                      value={forwardEmail}
                      onChange={e => updateForwardEmail(e.target.value)}
                      className="flex-1 bg-slate-900/60 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-sky-500 focus:outline-none transition-colors"
                    />
                    <button
                      onClick={sendSummaryEmail}
                      disabled={!forwardEmail || isSending || emailSent}
                      className={`px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all
                        ${emailSent 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                          : isSending 
                            ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                            : 'bg-sky-500/20 text-sky-300 border border-sky-500/30 hover:bg-sky-500/30'}`}
                    >
                      {emailSent ? (
                        <><CheckCircle2 className="w-4 h-4" /> 送信完了</>
                      ) : isSending ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> 送信中...</>
                      ) : (
                        <><Send className="w-4 h-4" /> 送信</>
                      )}
                    </button>
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
