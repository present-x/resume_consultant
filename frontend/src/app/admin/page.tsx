"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { useTheme } from "next-themes";

interface Provider {
    id: string;
    name: string;
    icon: string;
    default_model: string;
    base_url: string | null;
}

interface LLMConfig {
    id: number;
    provider: string;
    name: string;
    model_name: string;
    base_url: string | null;
    is_default: boolean;
}

const PROVIDER_ICONS: Record<string, { logo: string; color: string }> = {
    deepseek: { logo: "🔷", color: "from-blue-500 to-blue-600" },
    kimi: { logo: "🌙", color: "from-purple-500 to-purple-600" },
    gemini: { logo: "✨", color: "from-cyan-500 to-blue-500" },
};

export default function AdminPage() {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const { resolvedTheme, setTheme } = useTheme();
    const [providers, setProviders] = useState<Provider[]>([]);
    const [configs, setConfigs] = useState<LLMConfig[]>([]);
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
    const [, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    // Form state
    const [formName, setFormName] = useState("");
    const [formApiKey, setFormApiKey] = useState("");
    const [formModel, setFormModel] = useState("");
    const [formBaseUrl, setFormBaseUrl] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setMounted(true);
        const token = localStorage.getItem("token");
        if (!token) {
            router.push("/");
            return;
        }
        loadData();
    }, [router]);

    const loadData = async () => {
        try {
            const [providersData, configsData] = await Promise.all([
                apiFetch<Provider[]>("/api/llm/providers"),
                apiFetch<LLMConfig[]>("/api/llm/configs"),
            ]);
            setProviders(providersData);
            setConfigs(configsData);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load data");
        } finally {
            setLoading(false);
        }
    };

    const handleSelectProvider = (provider: Provider) => {
        setSelectedProvider(provider);
        setFormName(provider.name);
        setFormModel(provider.default_model);
        setFormBaseUrl(provider.base_url || "");
        setFormApiKey("");
        setShowAddModal(true);
    };

    const handleSaveConfig = async () => {
        if (!selectedProvider) return;

        setSaving(true);
        try {
            await apiFetch("/api/llm/configs", {
                method: "POST",
                body: JSON.stringify({
                    provider: selectedProvider.id,
                    name: formName,
                    api_key: formApiKey,
                    model_name: formModel,
                    base_url: formBaseUrl || null,
                }),
            });
            setShowAddModal(false);
            loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save");
        } finally {
            setSaving(false);
        }
    };

    const handleSetDefault = async (configId: number) => {
        try {
            await apiFetch(`/api/llm/configs/${configId}/default`, { method: "PUT" });
            loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to set default");
        }
    };

    const handleDelete = async (configId: number) => {
        if (!confirm("确定要删除这个配置吗？")) return;
        try {
            await apiFetch(`/api/llm/configs/${configId}`, { method: "DELETE" });
            loadData();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete");
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

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
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
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${isSidebarCollapsed ? "justify-center" : ""}`}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {!isSidebarCollapsed && "简历管理"}
                    </Link>
                    <Link
                        href="/admin"
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 font-medium ${isSidebarCollapsed ? "justify-center" : ""}`}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {!isSidebarCollapsed && "模型配置"}
                    </Link>
                </nav>

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
            <div className="flex-1 p-8 overflow-y-auto">
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">AI 模型配置</h1>
                    <p className="text-slate-500 dark:text-slate-400 mb-8">配置大语言模型以启用简历分析功能</p>

                    {error && (
                        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
                            {error}
                        </div>
                    )}

                    {/* Current configs */}
                    {configs.length > 0 && (
                        <div className="mb-8">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">已配置的模型</h2>
                            <div className="space-y-3">
                                {configs.map((config) => {
                                    const providerInfo = PROVIDER_ICONS[config.provider] || { logo: "🤖", color: "from-gray-500 to-gray-600" };
                                    return (
                                        <div
                                            key={config.id}
                                            className={`p-4 bg-white dark:bg-slate-900 border rounded-xl flex items-center gap-4 shadow-sm ${config.is_default ? "border-emerald-300" : "border-slate-200 dark:border-slate-700"
                                                }`}
                                        >
                                            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${providerInfo.color} flex items-center justify-center text-2xl`}>
                                                {providerInfo.logo}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-900 dark:text-slate-100 font-medium">{config.name}</span>
                                                    {config.is_default && (
                                                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs rounded-full border border-emerald-200">默认</span>
                                                    )}
                                                </div>
                                                <p className="text-slate-500 dark:text-slate-400 text-sm">{config.model_name}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {!config.is_default && (
                                                    <button
                                                        onClick={() => handleSetDefault(config.id)}
                                                        className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                                                    >
                                                        设为默认
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDelete(config.id)}
                                                    className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Add new config */}
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">添加新模型</h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">选择供应商</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {providers.map((provider) => {
                                const providerInfo = PROVIDER_ICONS[provider.id] || { logo: "🤖", color: "from-gray-500 to-gray-600" };
                                return (
                                    <button
                                        key={provider.id}
                                        onClick={() => handleSelectProvider(provider)}
                                        className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all text-left group shadow-sm"
                                    >
                                        <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${providerInfo.color} flex items-center justify-center text-3xl mb-4 group-hover:scale-110 transition-transform`}>
                                            {providerInfo.logo}
                                        </div>
                                        <h3 className="text-slate-900 dark:text-slate-100 font-medium">{provider.name}</h3>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{provider.default_model}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Add config modal */}
            {showAddModal && selectedProvider && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-xl">
                        <div className="flex items-center gap-4 mb-6">
                            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${PROVIDER_ICONS[selectedProvider.id]?.color || "from-gray-500 to-gray-600"} flex items-center justify-center text-2xl`}>
                                {PROVIDER_ICONS[selectedProvider.id]?.logo || "🤖"}
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">配置 {selectedProvider.name}</h2>
                                <p className="text-slate-500 dark:text-slate-400 text-sm">填写 API 密钥和模型信息</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">配置名称</label>
                                <input
                                    type="text"
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">API Key</label>
                                <input
                                    type="password"
                                    value={formApiKey}
                                    onChange={(e) => setFormApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">模型名称</label>
                                <input
                                    type="text"
                                    value={formModel}
                                    onChange={(e) => setFormModel(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                                />
                            </div>

                            {selectedProvider.base_url && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Base URL (可选)</label>
                                    <input
                                        type="text"
                                        value={formBaseUrl}
                                        onChange={(e) => setFormBaseUrl(e.target.value)}
                                        placeholder={selectedProvider.base_url}
                                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="flex-1 py-2.5 px-4 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSaveConfig}
                                disabled={!formName || !formApiKey || !formModel || saving}
                                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium rounded-lg hover:from-emerald-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {saving ? "保存中..." : "保存"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
