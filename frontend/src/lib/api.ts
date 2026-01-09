const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface FetchOptions extends RequestInit {
    auth?: boolean;
}

export async function apiFetch<T>(
    endpoint: string,
    options: FetchOptions = {}
): Promise<T> {
    const { auth = true, ...fetchOptions } = options;

    const headers: HeadersInit = {
        ...(fetchOptions.headers || {}),
    };

    if (auth) {
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        if (token) {
            (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
        }
    }

    // Don't set Content-Type for FormData
    if (!(fetchOptions.body instanceof FormData)) {
        (headers as Record<string, string>)["Content-Type"] = "application/json";
    }

    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...fetchOptions,
        headers,
    });

    if (!res.ok) {
        if (res.status === 401) {
            // Clear auth and redirect
            if (typeof window !== "undefined") {
                localStorage.removeItem("token");
                localStorage.removeItem("user");
                window.location.href = "/";
            }
        }
        const error = await res.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(error.detail || "Request failed");
    }

    return res.json();
}

export function getStreamUrl(endpoint: string): string {
    return `${API_BASE_URL}${endpoint}`;
}

export function getAuthHeaders(): HeadersInit {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
}
