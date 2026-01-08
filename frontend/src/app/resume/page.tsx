"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";

interface ResumeItem {
    id: number;
    filename: string;
    uploaded_at: string | null;
    is_active: boolean;
}

export default function ResumePage() {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const { resolvedTheme, setTheme } = useTheme();
    const [resumes, setResumes] = useState<ResumeItem[]>([]);
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setMounted(true);
        const token = localStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }
        fetchResumes(token);
    }, [router]);

    const fetchResumes = async (token: string) => {
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume/list`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setResumes(data);
            }
        } catch {
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

    const handlePreviewResume = async (resumeId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume/${resumeId}/preview`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) throw new Error("Failed to load file");

            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            window.open(url, "_blank");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Cannot preview file");
        }
    };

    const handleSetActive = async (resumeId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;

        setError("");
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume/${resumeId}/active`, {
                method: "PUT",
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail || "Failed to set active");
            }
            await fetchResumes(token);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to set active");
        }
    };

    const handleDeleteResume = async (resumeId: number) => {
        const token = localStorage.getItem("token");
        if (!token) return;
        if (!confirm("确定要删除这份简历吗？")) return;

        setError("");
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume/${resumeId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail || "Failed to delete");
            }
            await fetchResumes(token);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to delete");
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) setFile(selectedFile);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) setFile(droppedFile);
    };

    const handleUpload = async () => {
        if (!file) return;
        const token = localStorage.getItem("token");
        if (!token) return;

        setSaving(true);
        setError("");

        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002"}/api/resume`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail || "Upload failed");
            }

            await fetchResumes(token);
            setFile(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        } catch (e) {
            setError(e instanceof Error ? e.message : "Upload failed");
        } finally {
            setSaving(false);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        router.push("/");
    };

    if (!mounted) return null;
    const isDark = resolvedTheme === "dark";

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
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
                        <Link
                            href="/chat"
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${isSidebarCollapsed ? "justify-center" : ""}`}
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            {!isSidebarCollapsed && "简历分析"}
                        </Link>
                        <Link
                            href="/resume"
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 font-medium ${isSidebarCollapsed ? "justify-center" : ""}`}
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

            <div className="flex-1 p-8 overflow-y-auto">
                <div className="max-w-3xl mx-auto">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">简历管理</h1>
                    <p className="text-slate-500 dark:text-slate-400 mb-8">上传并存放你的个人简历，用于后续分析</p>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                            {error}
                        </div>
                    )}

                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">简历列表</h2>
                                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">最多 5 份 · 支持 PDF / DOCX / DOC / TXT / MD</p>
                            </div>
                        </div>

                        <div className="mt-5">
                            {resumes.length === 0 ? (
                                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                    <p className="text-slate-600 dark:text-slate-200 text-sm">暂无存档简历</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {resumes.map((r) => (
                                        <div key={r.id} className={`border rounded-xl p-4 flex items-start gap-3 ${r.is_active ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-500/10 dark:border-emerald-500/20" : "border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700"}`}>
                                            <div className="text-2xl">📄</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-medium text-slate-800 dark:text-slate-100 text-sm break-all">{r.filename}</p>
                                                    {r.is_active && (
                                                        <span className="px-2 py-0.5 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 text-xs rounded-full border border-emerald-200 dark:border-emerald-500/20">
                                                            当前用于分析
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{formatUploadedAt(r.uploaded_at)}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {!r.is_active && (
                                                    <button
                                                        onClick={() => handleSetActive(r.id)}
                                                        className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                                                    >
                                                        设为当前
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handlePreviewResume(r.id)}
                                                    className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                                                >
                                                    预览
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteResume(r.id)}
                                                    className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-red-700 hover:bg-red-50 dark:hover:bg-red-500/10"
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-6">
                            <div
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${file
                                    ? "border-emerald-400 bg-emerald-50"
                                    : "border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
                                    }`}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pdf,.docx,.doc,.txt,.md"
                                    onChange={handleFileChange}
                                    className="hidden"
                                />
                                <div className="text-4xl mb-3">{file ? "📄" : "📁"}</div>
                                {file ? (
                                    <div>
                                        <p className="text-emerald-700 font-medium break-all">{file.name}</p>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">点击更换文件</p>
                                    </div>
                                ) : (
                                    <div>
                                        <p className="text-slate-600 dark:text-slate-200">拖拽文件到此处</p>
                                        <p className="text-slate-400 dark:text-slate-400 text-sm mt-1">或点击选择文件</p>
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 flex gap-3">
                                <button
                                    onClick={handleUpload}
                                    disabled={!file || saving}
                                    className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium rounded-xl hover:from-emerald-600 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/25"
                                >
                                    {saving ? "上传中..." : "上传简历"}
                                </button>
                                <Link
                                    href="/chat"
                                    className="px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                                >
                                    去分析
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
