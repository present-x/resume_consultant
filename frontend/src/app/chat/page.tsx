"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { useTheme } from "next-themes";

interface StreamEvent {
    type: "conversation_start" | "step_start" | "content" | "step_end" | "complete" | "stopped" | "error";
    conversation_id?: number;
    step?: number;
    title?: string;
    description?: string;
    content?: string;
    message?: string;
    created_at?: string | null;
}

interface HistoryItem {
    id: number;
    title: string;
    created_at: string | null;
    status: "in_progress" | "completed" | "stopped";
}

interface ResumeItem {
    id: number;
    filename: string;
    uploaded_at: string | null;
    is_active: boolean;
}

type SessionStatus = "starting" | "in_progress" | "completed" | "stopped" | "error";

type AnalysisSession = {
    key: string;
    startedAt: number;
    abortController: AbortController;
    conversationId: number | null;
    status: SessionStatus;
    title: string;
    created_at: string | null;
    jobDescription: string;
    streamed: {
        currentStep: number | null;
        completedSteps: number[];
        stepContents: Record<number, string>;
    };
};

const WORKFLOW_STEPS = [
    { step: 1, title: "第一印象与初步诊断", icon: "👁️" },
    { step: 2, title: "地毯式深度审计与指导", icon: "🔍" },
    { step: 3, title: "战略性修改蓝图", icon: "🗺️" },
    { step: 4, title: "重构与展示", icon: "✨" },
    { step: 5, title: "最终裁决与行动清单", icon: "🎯" },
];

const MAX_CONCURRENT_ANALYSIS = 1;

export default function ChatPage() {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const { resolvedTheme, setTheme } = useTheme();

    // Data State
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [resumes, setResumes] = useState<ResumeItem[]>([]);
    const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);
    const [viewConversationId, setViewConversationId] = useState<number | null>(null);
    const [analysisSessions, setAnalysisSessions] = useState<AnalysisSession[]>([]);

    // Form State
    const [jobDescription, setJobDescription] = useState("");

    // Analysis State
    const [currentStep, setCurrentStep] = useState<number | null>(null);
    const [completedSteps, setCompletedSteps] = useState<number[]>([]);
    const [stepContents, setStepContents] = useState<Record<number, string>>({});
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    // UI State
    const [expandedStep, setExpandedStep] = useState<number | null>(null);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [copiedStep, setCopiedStep] = useState<number | null>(null);

    // Refs
    const viewConversationIdRef = useRef<number | null>(null);
    const sessionStreamRef = useRef<Record<string, AnalysisSession["streamed"]>>({});
    const noticeTimerRef = useRef<number | null>(null);

    // Initial Load & Auth Check
    useEffect(() => {
        setMounted(true);
        const token = localStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }

        // Load persisted JD
        const savedJD = localStorage.getItem("resume_consultant_jd");
        if (savedJD) {
            setJobDescription(savedJD);
        }

        // Fetch History
        fetchHistory(token);

        // Fetch Resumes
        fetchResumes(token);
    }, [router]);

    // Persist JD on change
    useEffect(() => {
        if (jobDescription) {
            localStorage.setItem("resume_consultant_jd", jobDescription);
        }
    }, [jobDescription]);

    // Auto-expand current step
    useEffect(() => {
        if (currentStep) {
            setExpandedStep(currentStep);
        }
    }, [currentStep]);

    useEffect(() => {
        viewConversationIdRef.current = viewConversationId;
    }, [viewConversationId]);

    const showNotice = (message: string) => {
        setNotice(message);
        if (noticeTimerRef.current) {
            window.clearTimeout(noticeTimerRef.current);
        }
        noticeTimerRef.current = window.setTimeout(() => {
            setNotice((prev) => (prev === message ? "" : prev));
        }, 2600);
    };

    const fetchHistory = async (token: string) => {
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/chat/history`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setHistory(data);
            }
        } catch (e) {
            console.error("Failed to fetch history", e);
        }
    };

    const formatUploadedAt = (iso: string | null) => {
        if (!iso) return "";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return "";
        return new Intl.DateTimeFormat("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        }).format(date);
    };

    const fetchResumes = async (token: string) => {
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume/list`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data: ResumeItem[] = await res.json();
                setResumes(data);
                const active = data.find((r) => r.is_active);
                setSelectedResumeId((prev) => {
                    if (prev && data.some((r) => r.id === prev)) return prev;
                    return active?.id ?? data[0]?.id ?? null;
                });
            }
        } catch (e) {
            console.error("Failed to fetch resumes", e);
        }
    };

    const setActiveResume = async (resumeId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume/${resumeId}/active`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return;
            setResumes((prev) => prev.map((r) => ({ ...r, is_active: r.id === resumeId })));
        } catch {
        }
    };

    const handleDeleteHistory = async (id: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/chat/conversation/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                // Remove from list
                setHistory(prev => prev.filter(item => item.id !== id));
                // If deleted item is currently viewed, clear view?
                // Optional.
            } else {
                alert("删除失败");
            }
        } catch (e) {
            console.error("Failed to delete history", e);
            alert("删除出错");
        }
    };

    const reconnectToConversation = async (
        id: number,
        token: string,
        initialData: { contents: Record<number, string>; completed: number[]; jobDescription: string; title: string; createdAt: string }
    ) => {
        if (analysisSessions.some(s => s.conversationId === id && (s.status === 'starting' || s.status === 'in_progress'))) {
            return;
        }

        const now = Date.now();
        const key = `${now}-reconnect-${id}`;
        const abortController = new AbortController();

        sessionStreamRef.current[key] = {
            currentStep: null,
            completedSteps: initialData.completed,
            stepContents: initialData.contents,
        };

        setAnalysisSessions(prev => [
            ...prev,
            {
                key,
                startedAt: now,
                abortController,
                conversationId: id,
                status: "in_progress",
                title: initialData.title,
                created_at: initialData.createdAt,
                jobDescription: initialData.jobDescription,
                streamed: sessionStreamRef.current[key]
            }
        ]);

        try {
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/chat/stream/${id}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: abortController.signal,
                }
            );

            if (response.status === 404) {
                setAnalysisSessions(prev => prev.filter(s => s.key !== key));
                delete sessionStreamRef.current[key];
                loadConversation(id);
                return;
            }

            if (!response.ok) throw new Error("Failed to reconnect");

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (!reader) throw new Error("No body");

            let buffer = "";
            let streamError: string | null = null;
            const conversationId = id;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                while (true) {
                    const idx = buffer.indexOf("\n\n");
                    if (idx === -1) break;
                    const rawEvent = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);

                    const dataLines = rawEvent
                        .split("\n")
                        .filter((l) => l.startsWith("data: "))
                        .map((l) => l.slice(6));
                    if (dataLines.length === 0) continue;

                    const payload = dataLines.join("\n");
                    let data: StreamEvent | null = null;
                    try {
                        data = JSON.parse(payload) as StreamEvent;
                    } catch {
                        continue;
                    }

                    if (data.type === "step_start") {
                        if (!data.step) continue;
                        const snap = sessionStreamRef.current[key];
                        if (!snap) continue;
                        snap.currentStep = data.step;
                        if (viewConversationIdRef.current === conversationId) {
                            setCurrentStep(data.step);
                        }
                    } else if (data.type === "content" && data.step) {
                        const snap = sessionStreamRef.current[key];
                        if (!snap) continue;
                        snap.stepContents[data.step] = (snap.stepContents[data.step] || "") + (data.content || "");
                        if (viewConversationIdRef.current === conversationId) {
                            setStepContents((prev) => ({
                                ...prev,
                                [data.step!]: (prev[data.step!] || "") + (data.content || ""),
                            }));
                        }
                    } else if (data.type === "step_end" && data.step) {
                        const snap = sessionStreamRef.current[key];
                        if (!snap) continue;

                        if (data.content) {
                            snap.stepContents[data.step] = data.content;
                            if (viewConversationIdRef.current === conversationId) {
                                setStepContents((prev) => ({
                                    ...prev,
                                    [data.step!]: data.content!,
                                }));
                            }
                        }

                        if (!snap.completedSteps.includes(data.step)) {
                            snap.completedSteps = [...snap.completedSteps, data.step];
                        }
                        if (viewConversationIdRef.current === conversationId) {
                            setCompletedSteps((prev) => [...prev, data.step!]);
                        }
                    } else if (data.type === "complete") {
                        setHistory((prev) =>
                            prev.map((h) => (h.id === conversationId ? { ...h, status: "completed" } : h))
                        );
                        setAnalysisSessions((prev) => prev.filter((s) => s.key !== key));
                        delete sessionStreamRef.current[key];
                    } else if (data.type === "stopped") {
                        setHistory((prev) =>
                            prev.map((h) => (h.id === conversationId ? { ...h, status: "stopped" } : h))
                        );
                        setAnalysisSessions((prev) => prev.filter((s) => s.key !== key));
                        delete sessionStreamRef.current[key];
                    } else if (data.type === "error") {
                        streamError = data.message || "Analysis failed";
                        break;
                    }
                }
                if (streamError) break;
            }
            if (streamError) throw new Error(streamError);
            if (token) fetchHistory(token);

        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                setAnalysisSessions((prev) => prev.filter((s) => s.key !== key));
                delete sessionStreamRef.current[key];
                return;
            }
            console.error("Reconnect error", err);
        } finally {
            setAnalysisSessions((prev) => prev.filter((s) => s.key !== key));
        }
    };

    const loadConversation = async (id: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        setViewConversationId(id);

        const streamingSession = analysisSessions.find(
            (s) => s.conversationId === id && (s.status === "starting" || s.status === "in_progress")
        );
        setError("");
        if (streamingSession) {
            const snap = sessionStreamRef.current[streamingSession.key] ?? streamingSession.streamed;
            setJobDescription(streamingSession.jobDescription);
            setStepContents({ ...snap.stepContents });
            setCompletedSteps([...snap.completedSteps]);
            setCurrentStep(snap.currentStep);
            return;
        } else {
            setStepContents({});
            setCompletedSteps([]);
            const status = history.find((h) => h.id === id)?.status;
            if (status === "in_progress") {
                // Let inferredCurrentStep handle it based on completed steps
                setCurrentStep(null);
                setExpandedStep(null);
            } else {
                setCurrentStep(null);
                setExpandedStep(null);
            }
        }

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/chat/conversation/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) throw new Error("Failed to load conversation");

            const data: {
                job_description?: string;
                messages: Array<{ role: string; step?: number | null; content: string }>;
            } = await res.json();

            // Restore state
            setJobDescription(data.job_description || "");

            // Reconstruct steps
            const contents: Record<number, string> = {};
            const completed: number[] = [];
            let isStoppedFromMessages = false;

            data.messages.forEach((msg) => {
                if (msg.role === "system" && msg.content === "[STOPPED]") {
                    isStoppedFromMessages = true;
                }
                if (msg.step) {
                    if (!contents[msg.step]) contents[msg.step] = "";
                    contents[msg.step] += msg.content;
                    if (!completed.includes(msg.step)) completed.push(msg.step);
                }
            });

            setStepContents(contents);
            setCompletedSteps(completed);

            const status: HistoryItem["status"] = completed.includes(5) ? "completed" : (isStoppedFromMessages ? "stopped" : "in_progress");
            setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, status } : h)));

            if (status === "in_progress") {
                const maxCompleted = completed.length > 0 ? Math.max(...completed) : 0;
                const nextStep = Math.min(maxCompleted + 1, 5);
                setCurrentStep(nextStep);
                setExpandedStep(nextStep);

                const item = history.find(h => h.id === id);
                reconnectToConversation(id, token, {
                    contents,
                    completed,
                    jobDescription: data.job_description || "",
                    title: item?.title || "简历分析",
                    createdAt: item?.created_at || new Date().toISOString()
                });
            }

            // Expand the last completed step or step 4 if available
            if (completed.includes(4)) {
                setExpandedStep(4);
            } else if (completed.length > 0) {
                setExpandedStep(completed[completed.length - 1]);
            }

        } catch {
            setError("Cannot load conversation");
        }
    };

    const handlePreviewResume = async () => {
        const token = localStorage.getItem("token");
        if (!token) return;
        if (!selectedResumeId) return;

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume/${selectedResumeId}/preview`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) throw new Error("Failed to load file");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            window.open(url, '_blank');
        } catch {
            setError("Cannot preview file");
        }
    };

    const copyText = async (text: string) => {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
    };

    const handleAnalyze = async () => {
        if (!selectedResumeId) {
            setError("请先在「简历管理」上传简历");
            return;
        }

        const now = Date.now();
        const runningSessions = analysisSessions
            .filter((s) => s.status === "starting" || s.status === "in_progress")
            .sort((a, b) => a.startedAt - b.startedAt);
        if (runningSessions.length >= MAX_CONCURRENT_ANALYSIS) {
            const oldest = runningSessions[0];
            if (oldest.conversationId) {
                setHistory((prev) =>
                    prev.map((h) => (h.id === oldest.conversationId ? { ...h, status: "stopped" } : h))
                );
                markConversationStopped(oldest.conversationId);
            }
            oldest.abortController.abort();
            delete sessionStreamRef.current[oldest.key];
            setAnalysisSessions((prev) => prev.filter((s) => s.key !== oldest.key));
        }

        const key = `${now}-${Math.random().toString(16).slice(2)}`;
        const abortController = new AbortController();
        sessionStreamRef.current[key] = {
            currentStep: null,
            completedSteps: [],
            stepContents: {},
        };
        setAnalysisSessions((prev) => [
            ...prev,
            {
                key,
                startedAt: now,
                abortController,
                conversationId: null,
                status: "starting",
                title: "简历分析",
                created_at: null,
                jobDescription,
                streamed: {
                    currentStep: null,
                    completedSteps: [],
                    stepContents: {},
                },
            },
        ]);

        setError("");
        setExpandedStep(1);

        const formData = new FormData();
        formData.append("job_description", jobDescription);
        formData.append("resume_id", String(selectedResumeId));

        try {
            const token = localStorage.getItem("token");
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/chat/analyze`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                    body: formData,
                    signal: abortController.signal,
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || "Analysis failed");
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) throw new Error("No response body");

            let conversationId: number | null = null;
            let buffer = "";
            let streamError: string | null = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                while (true) {
                    const idx = buffer.indexOf("\n\n");
                    if (idx === -1) break;
                    const rawEvent = buffer.slice(0, idx);
                    buffer = buffer.slice(idx + 2);

                    const dataLines = rawEvent
                        .split("\n")
                        .filter((l) => l.startsWith("data: "))
                        .map((l) => l.slice(6));
                    if (dataLines.length === 0) continue;

                    const payload = dataLines.join("\n");
                    let data: StreamEvent | null = null;
                    try {
                        data = JSON.parse(payload) as StreamEvent;
                    } catch {
                        continue;
                    }

                    if (data.type === "conversation_start" && data.conversation_id) {
                        conversationId = data.conversation_id;
                        setAnalysisSessions((prev) =>
                            prev.map((s) =>
                                s.key === key
                                    ? {
                                        ...s,
                                        conversationId,
                                        status: "in_progress",
                                        title: data.title || "简历分析",
                                        created_at: data.created_at ?? new Date().toISOString(),
                                    }
                                    : s
                            )
                        );
                        setHistory((prev) => {
                            const nextItem: HistoryItem = {
                                id: data.conversation_id!,
                                title: data.title || "简历分析",
                                created_at: data.created_at ?? new Date().toISOString(),
                                status: "in_progress",
                            };
                            const withoutDup = prev.filter((h) => h.id !== nextItem.id);
                            return [nextItem, ...withoutDup].slice(0, 10);
                        });
                        if (viewConversationIdRef.current === null) {
                            setViewConversationId(conversationId);
                            setStepContents({});
                            setCompletedSteps([]);
                            setCurrentStep(null);
                            setExpandedStep(1);
                        }
                    } else if (data.type === "step_start") {
                        if (!conversationId || !data.step) continue;
                        const snap = sessionStreamRef.current[key];
                        if (!snap) continue;
                        snap.currentStep = data.step;
                        if (viewConversationIdRef.current === conversationId) {
                            setCurrentStep(data.step);
                        }
                    } else if (data.type === "content" && data.step) {
                        if (!conversationId) continue;
                        const snap = sessionStreamRef.current[key];
                        if (!snap) continue;
                        snap.stepContents[data.step] = (snap.stepContents[data.step] || "") + (data.content || "");
                        if (viewConversationIdRef.current === conversationId) {
                            setStepContents((prev) => ({
                                ...prev,
                                [data.step!]: (prev[data.step!] || "") + (data.content || ""),
                            }));
                        }
                    } else if (data.type === "step_end" && data.step) {
                        if (!conversationId) continue;
                        const snap = sessionStreamRef.current[key];
                        if (!snap) continue;

                        if (data.content) {
                            snap.stepContents[data.step] = data.content;
                            if (viewConversationIdRef.current === conversationId) {
                                setStepContents((prev) => ({
                                    ...prev,
                                    [data.step!]: data.content!,
                                }));
                            }
                        }

                        if (!snap.completedSteps.includes(data.step)) {
                            snap.completedSteps = [...snap.completedSteps, data.step];
                        }
                        if (viewConversationIdRef.current === conversationId) {
                            setCompletedSteps((prev) => [...prev, data.step!]);
                        }
                    } else if (data.type === "complete") {
                        if (conversationId) {
                            setHistory((prev) =>
                                prev.map((h) => (h.id === conversationId ? { ...h, status: "completed" } : h))
                            );
                        }
                        setAnalysisSessions((prev) => prev.filter((s) => s.key !== key));
                        delete sessionStreamRef.current[key];
                    } else if (data.type === "stopped") {
                        if (conversationId) {
                            setHistory((prev) =>
                                prev.map((h) => (h.id === conversationId ? { ...h, status: "stopped" } : h))
                            );
                        }
                        setAnalysisSessions((prev) => prev.filter((s) => s.key !== key));
                        delete sessionStreamRef.current[key];
                    } else if (data.type === "error") {
                        streamError = data.message || "Analysis failed";
                        break;
                    }
                }

                if (streamError) break;
            }

            if (streamError) {
                throw new Error(streamError);
            }

            if (token) fetchHistory(token);

        } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
                setAnalysisSessions((prev) => prev.filter((s) => s.key !== key));
                delete sessionStreamRef.current[key];
                return;
            }
            setError(err instanceof Error ? err.message : "Analysis failed");
        } finally {
            setAnalysisSessions((prev) => prev.map((s) => (s.key === key && s.status === "starting" ? { ...s, status: "error" } : s)));
        }
    };

    const markConversationStopped = async (conversationId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;
        try {
            await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/chat/conversation/${conversationId}/stop`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch {
        }
    };

    const handleStopAnalyze = (conversationId: number) => {
        const target = analysisSessions.find(
            (s) => s.conversationId === conversationId && (s.status === "starting" || s.status === "in_progress")
        );
        setHistory((prev) => prev.map((h) => (h.id === conversationId ? { ...h, status: "stopped" } : h)));
        markConversationStopped(conversationId);
        if (viewConversationIdRef.current === conversationId) {
            setCurrentStep(null);
        }
        if (target) {
            target.abortController.abort();
            setAnalysisSessions((prev) => prev.filter((s) => s.key !== target.key));
            delete sessionStreamRef.current[target.key];
        }
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        router.push("/");
    };

    const handleNewAnalysisView = () => {
        setViewConversationId(null);
        setError("");
        setNotice("");
        setStepContents({});
        setCompletedSteps([]);
        setCurrentStep(null);
        setExpandedStep(null);
    };

    // Derived state for analyze button
    const canAnalyze = !!selectedResumeId;
    const showAnalyzeButton = viewConversationId === null;
    const isConversationAnalyzing = (conversationId: number) =>
        analysisSessions.some(
            (s) => s.conversationId === conversationId && (s.status === "starting" || s.status === "in_progress")
        );
    const historyRunningCount = history.filter((h) => h.status === "in_progress").length;
    const localStartingCount = analysisSessions.filter((s) => s.status === "starting" && s.conversationId === null).length;
    const runningSessionsCount = historyRunningCount + localStartingCount;
    const viewingStatus = viewConversationId !== null ? history.find((h) => h.id === viewConversationId)?.status : null;
    const showStopButton =
        viewConversationId !== null && (isConversationAnalyzing(viewConversationId) || viewingStatus === "in_progress");
    const totalStepsCount = WORKFLOW_STEPS.length;
    const completedStepsCount = completedSteps.length;
    const inferredCurrentStep = (() => {
        if (currentStep) return currentStep;
        if (viewConversationId === null) return null;
        if (!(isConversationAnalyzing(viewConversationId) || viewingStatus === "in_progress")) return null;
        if (completedSteps.length === 0) return 1;
        const maxCompleted = Math.max(...completedSteps);
        return Math.min(maxCompleted + 1, totalStepsCount);
    })();
    const progressPercent = Math.max(
        0,
        Math.min(
            100,
            (viewingStatus === "completed"
                ? 100
                : Math.round((completedStepsCount / totalStepsCount) * 100))
        )
    );
    const renderHistoryStatusIcon = (item: HistoryItem) => {
        const isActive = item.status === "in_progress" || isConversationAnalyzing(item.id);
        if (isActive) {
            return (
                <svg className="w-4 h-4 text-emerald-500 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                </svg>
            );
        }

        if (item.status === "completed") {
            return (
                <svg className="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
            );
        }

        if (item.status === "stopped") {
            return (
                <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <rect x="7" y="7" width="10" height="10" rx="2" strokeWidth="2" />
                </svg>
            );
        }

        return (
            <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="9" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
        );
    };

    if (!mounted) return null;
    const isDark = resolvedTheme === "dark";

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
            {/* Sidebar */}
            <div className={`${isSidebarCollapsed ? "w-20" : "w-64"} bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col h-screen sticky top-0 transition-[width] duration-200`}>
                <div className="p-4 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                        {!isSidebarCollapsed && (
                            <div className="min-w-0">
                                <h1 className="text-slate-900 dark:text-slate-100 font-semibold">简历教练</h1>
                                <p className="text-slate-500 dark:text-slate-400 text-xs">AI Resume Coach</p>
                            </div>
                        )}
                        <button
                            onClick={() => setIsSidebarCollapsed((v) => !v)}
                            className="ml-auto p-2 rounded-lg text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                            title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isSidebarCollapsed ? "M9 5l7 7-7 7" : "M15 19l-7-7 7-7"} />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="p-4 flex-1 flex flex-col overflow-y-auto">
                    <div className="space-y-1 mb-6">
                        <button
                            type="button"
                            onClick={handleNewAnalysisView}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 font-medium ${isSidebarCollapsed ? "justify-center w-full" : "w-full"}`}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            {!isSidebarCollapsed && "简历分析"}
                        </button>
                        <Link
                            href="/resume"
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${isSidebarCollapsed ? "justify-center" : ""}`}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            {!isSidebarCollapsed && "简历管理"}
                        </Link>
                        <Link
                            href="/admin"
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${isSidebarCollapsed ? "justify-center" : ""}`}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {!isSidebarCollapsed && "模型配置"}
                        </Link>
                    </div>

                    <div className="flex-1">
                        {!isSidebarCollapsed && (
                            <>
                                <div className="flex items-center justify-between mb-3 px-1">
                                    <h3 className="text-xs font-semibold text-slate-400 dark:text-slate-400 uppercase tracking-wider">历史分析</h3>
                                    <span
                                        className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800"
                                        title={`同时最多可运行 ${MAX_CONCURRENT_ANALYSIS} 个分析任务，超过将自动停止最早任务`}
                                    >
                                        {runningSessionsCount}/{MAX_CONCURRENT_ANALYSIS}
                                    </span>
                                </div>
                                <div className="space-y-1">
                                    {history.map((item) => (
                                                <div key={item.id} className="group relative">
                                            <button
                                                onClick={() => loadConversation(item.id)}
                                                className={`w-full text-left px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors truncate pr-24 ${viewConversationId === item.id ? "bg-slate-100/70 dark:bg-slate-700/60" : ""}`}
                                            >
                                                {item.title}
                                            </button>
                                            <div
                                                className="absolute right-8 top-1/2 -translate-y-1/2"
                                                title={
                                                    item.status === "completed"
                                                        ? "已完成"
                                                        : item.status === "stopped"
                                                            ? "已终止"
                                                            : (item.status === "in_progress" || isConversationAnalyzing(item.id) ? "分析中" : "未完成")
                                                }
                                            >
                                                {renderHistoryStatusIcon(item)}
                                            </div>
                                            {(item.status === "in_progress" || isConversationAnalyzing(item.id)) && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStopAnalyze(item.id);
                                                    }}
                                                    className="absolute right-14 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition-colors p-1"
                                                    title="停止分析"
                                                >
                                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                        <rect x="7" y="7" width="10" height="10" rx="2" strokeWidth="2" />
                                                    </svg>
                                                </button>
                                            )}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteHistory(item.id);
                                                }}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                                title="删除"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                    {!isSidebarCollapsed && (
                        <div className="flex items-center justify-end px-2">
                            <button
                                onClick={() => setTheme(isDark ? "light" : "dark")}
                                className="relative h-9 w-32 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-inner p-1 transition-colors"
                                aria-label="切换主题"
                            >
                                <span
                                    className={`absolute top-1 left-1 h-7 w-[60px] rounded-full bg-slate-100 dark:bg-slate-700 shadow-sm transition-transform ${isDark ? "translate-x-[60px]" : "translate-x-0"}`}
                                />
                                <span className="relative z-10 flex items-center justify-between h-full px-3">
                                    <svg className={`w-4 h-4 ${isDark ? "text-slate-400" : "text-slate-700"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <circle cx="12" cy="12" r="4" strokeWidth="2" />
                                        <path strokeWidth="2" strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                                    </svg>
                                    <svg className={`w-4 h-4 ${isDark ? "text-slate-700" : "text-slate-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M21 12.8A8.5 8.5 0 1111.2 3a6.5 6.5 0 009.8 9.8z" />
                                    </svg>
                                </span>
                            </button>
                        </div>
                    )}
                    <button
                        onClick={handleLogout}
                        className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${isSidebarCollapsed ? "justify-center" : ""}`}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        {!isSidebarCollapsed && "退出登录"}
                    </button>

                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
                {/* Content area */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Input panel - Fixed Width, scrollable if needed */}
                    <div className="w-96 border-r border-slate-200 dark:border-slate-700 p-6 overflow-y-auto bg-white dark:bg-slate-900 flex-shrink-0">
                        <h2 className="text-slate-900 dark:text-slate-100 font-semibold mb-4">简历</h2>

                        <div className="flex flex-col gap-4">
                            {resumes.length > 0 ? (
                                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="text-2xl">📄</div>
                                            <div>
                                                <p className="text-xs text-slate-500 dark:text-slate-400">选择用于本次分析的简历</p>
                                                <select
                                                    value={selectedResumeId ?? ""}
                                                    onChange={(e) => {
                                                        const nextId = e.target.value ? Number(e.target.value) : null;
                                                        setSelectedResumeId(nextId);
                                                        if (nextId) {
                                                            setActiveResume(nextId);
                                                        }
                                                    }}
                                                    className="mt-2 w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                                                >
                                                    {resumes.map((r) => (
                                                        <option key={r.id} value={r.id}>
                                                            {r.filename}{r.uploaded_at ? ` · ${formatUploadedAt(r.uploaded_at)}` : ""}{r.is_active ? " · 当前" : ""}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 mt-3">
                                        <button
                                            onClick={handlePreviewResume}
                                            className="text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                                        >
                                            预览
                                        </button>
                                        <Link
                                            href="/resume"
                                            className="text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                                        >
                                            去管理
                                        </Link>
                                    </div>
                                </div>
                            ) : (
                                <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-6 bg-white dark:bg-slate-800">
                                    <div className="text-center">
                                        <div className="text-4xl mb-3">📁</div>
                                        <p className="text-slate-700 dark:text-slate-100 font-medium">未上传简历</p>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">请先在简历管理中上传</p>
                                        <Link
                                            href="/resume"
                                            className="inline-flex items-center justify-center mt-4 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-colors"
                                        >
                                            去简历管理
                                        </Link>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-6">
                            <label className="block text-slate-900 dark:text-slate-100 font-semibold mb-2">
                                目标岗位 JD <span className="text-slate-400 dark:text-slate-400 font-normal text-sm">(可选)</span>
                            </label>
                            <textarea
                                value={jobDescription}
                                onChange={(e) => setJobDescription(e.target.value)}
                                placeholder="粘贴目标岗位的职位描述..."
                                className="w-full h-56 px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 rounded-xl resize-none transition-colors"
                            />
                        </div>

                        {error && (
                            <div className="mt-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm">
                                {error}
                            </div>
                        )}
                        {notice && !error && (
                            <div className="mt-4 p-3 bg-sky-50 text-sky-700 border border-sky-200 rounded-lg text-sm">
                                {notice}
                            </div>
                        )}

                        <div className="mt-6 flex gap-3">
                            {showAnalyzeButton && (
                                <button
                                    onClick={handleAnalyze}
                                    disabled={!canAnalyze}
                                    className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium rounded-xl hover:from-emerald-600 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/25"
                                >
                                    {analysisSessions.some((s) => s.status === "starting" && s.conversationId === null) ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            分析中...
                                        </span>
                                    ) : (
                                        "开始分析"
                                    )}
                                </button>
                            )}
                            {showStopButton && (
                                <button
                                    onClick={() => handleStopAnalyze(viewConversationId!)}
                                    className={`${showAnalyzeButton ? "" : "flex-1"} px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    停止
                                </button>
                            )}
                        </div>
                        {showAnalyzeButton && (
                            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                同时最多可运行 {MAX_CONCURRENT_ANALYSIS} 个历史分析任务，超过将自动停止最早任务（当前 {runningSessionsCount}/{MAX_CONCURRENT_ANALYSIS}）
                            </div>
                        )}
                    </div>

                    {/* Results panel - Accordion Layout */}
                    <div className="flex-1 bg-slate-50 dark:bg-slate-900 p-6 overflow-y-auto scroll-smooth">
                        {viewConversationId !== null && (
                            <div className="max-w-4xl mx-auto mb-4">
                                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                                    <span>
                                        进度 {Math.min(completedStepsCount, totalStepsCount)}/{totalStepsCount}
                                    </span>
                                    <span>{progressPercent}%</span>
                                </div>
                                <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full bg-gradient-to-r from-emerald-500 to-cyan-500 ${viewingStatus === "in_progress" ? "animate-pulse" : ""}`}
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                                {(isConversationAnalyzing(viewConversationId) || viewingStatus === "in_progress") && inferredCurrentStep && (
                                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                        正在进行第 {inferredCurrentStep} 步：{WORKFLOW_STEPS.find((s) => s.step === inferredCurrentStep)?.title}
                                    </div>
                                )}
                            </div>
                        )}
                        {Object.keys(stepContents).length === 0 && !(viewConversationId !== null && (isConversationAnalyzing(viewConversationId) || viewingStatus === "in_progress")) && (
                            <div className="h-full flex items-center justify-center text-slate-400">
                                <div className="text-center">
                                    <div className="text-6xl mb-4">📝</div>
                                    <p className="text-lg text-slate-600">准备就绪</p>
                                    <p className="text-sm mt-2">AI 诊断报告将在此处显示</p>
                                </div>
                            </div>
                        )}

                        <div className="space-y-4 max-w-4xl mx-auto">
                            {WORKFLOW_STEPS.map((step) => {
                                const isOpen = expandedStep === step.step;
                                const hasContent = !!stepContents[step.step];
                                const isCompleted = completedSteps.includes(step.step);
                                const isViewingAnalyzing = viewConversationId !== null && (isConversationAnalyzing(viewConversationId) || viewingStatus === "in_progress");

                                if (!hasContent && !isViewingAnalyzing) return null;
                                if (!hasContent && isViewingAnalyzing && currentStep !== step.step) return null;

                                return (
                                    <div key={step.step} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden transition-all duration-300">
                                        <button
                                            onClick={() => setExpandedStep(isOpen ? null : step.step)}
                                            className={`w-full flex items-center justify-between p-4 ${isOpen ? 'border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-2xl">{step.icon}</span>
                                                <h3 className="text-slate-900 dark:text-slate-100 font-semibold">{step.title}</h3>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                {hasContent && (
                                                    <button
                                                        onClick={async (e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            const text = stepContents[step.step] || "";
                                                            if (!text) return;
                                                            try {
                                                                await copyText(text);
                                                                setCopiedStep(step.step);
                                                                window.setTimeout(() => {
                                                                    setCopiedStep((prev) => (prev === step.step ? null : prev));
                                                                }, 1200);
                                                            } catch {
                                                            }
                                                        }}
                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                                        title="复制"
                                                    >
                                                        {copiedStep === step.step ? (
                                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        ) : (
                                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                )}
                                                {isCompleted && <span className="text-emerald-500 text-sm font-medium">✓ 完成</span>}
                                                {currentStep === step.step && viewConversationId !== null && (isConversationAnalyzing(viewConversationId) || viewingStatus === "in_progress") && (
                                                    <span className="text-blue-500 text-sm font-medium animate-pulse">分析中...</span>
                                                )}
                                                <svg
                                                    className={`w-5 h-5 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </div>
                                        </button>

                                        {isOpen && (
                                            <div className="p-6">
                                                <div className="prose prose-sm max-w-none 
                                                    text-slate-700 dark:text-slate-200
                                                    prose-headings:text-slate-900 
                                                    prose-strong:text-slate-900 
                                                    prose-a:text-blue-600
                                                    prose-code:text-pink-600
                                                    prose-pre:bg-slate-800 prose-pre:text-white
                                                    prose-pre:overflow-x-auto
                                                    prose-table:overflow-x-auto
                                                    break-words
                                                ">
                                                    <ReactMarkdown>{stepContents[step.step]}</ReactMarkdown>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
