import React, { useState, useEffect, useRef } from "react";
import { authFetch } from "./api";
import { supabase } from "./supabase";

import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import StudioTab from "./components/StudioTab";
import OverviewTab from "./components/OverviewTab";
import ChannelsTab from "./components/ChannelsTab";
import PricingTab from "./components/PricingTab";
import AuthModal from "./components/AuthModal";
import LoginPage from "./components/LoginPage";
import ResetPasswordPage from "./components/ResetPasswordPage";
import Toast from "./components/Toast";

export default function App() {
  const [activeTab, setActiveTab] = useState("tab-studio");
  const [status, setStatus] = useState(null);
  const [channels, setChannels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [showLoginPage, setShowLoginPage] = useState(false);
  const [isResetPasswordView, setIsResetPasswordView] = useState(
    window.location.pathname === "/reset-password" || window.location.hash.includes("type=recovery")
  );

  const [sourceMessages, setSourceMessages] = useState([]);
  const [destinationMessages, setDestinationMessages] = useState([]);

  // Independent Channel State (null until settings loaded from backend)
  const [activeSourceId, setActiveSourceId] = useState(null);
  const [activeDestId, setActiveDestId] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const activeSourceIdRef = useRef(activeSourceId);
  const activeDestIdRef = useRef(activeDestId);
  const sourceRequestIdRef = useRef(0);
  const destRequestIdRef = useRef(0);

  const sourceAbortRef = useRef(null);
  const destAbortRef = useRef(null);
  const isPollingRef = useRef(false);

  useEffect(() => { activeSourceIdRef.current = activeSourceId; }, [activeSourceId]);
  useEffect(() => { activeDestIdRef.current = activeDestId; }, [activeDestId]);

  const isSameChannelId = (idA, idB) => {
    if (!idA || !idB) return false;
    if (String(idA) === String(idB)) return true;
    const cleanA = String(idA).replace("-100", "").replace("-", "").trim();
    const cleanB = String(idB).replace("-100", "").replace("-", "").trim();
    return cleanA === cleanB;
  };

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
  };

  useEffect(() => {
    let mounted = true;

    // Detect recovery link hash
    if (window.location.hash.includes("type=recovery")) {
      setIsResetPasswordView(true);
    }

    // Detect Razorpay Payment Link return
    const checkAndVerifyPaymentReturn = async (currentSession) => {
      const urlParams = new URLSearchParams(window.location.search);
      const paymentStatus = urlParams.get("payment");
      const plinkId = urlParams.get("razorpay_payment_link_id") || urlParams.get("payment_link_id");
      const planIdParam = urlParams.get("plan_id") || "plan_599";
      const paymentId = urlParams.get("razorpay_payment_id");

      if (paymentStatus === "success" && (plinkId || paymentId)) {
        console.info("[PAYMENT] Return detected:", { plinkId, paymentId, planId: planIdParam });
        showToast("Verifying your payment...", "info");

        const token = currentSession?.access_token || localStorage.getItem("sb_access_token");
        const userId = currentSession?.user?.id;
        const sbUrl = import.meta.env.VITE_SUPABASE_URL;
        const sbAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

        let verified = false;
        let resultMsg = "";

        // 1. Direct Edge Function verification (runs on Supabase Cloud, zero VPS dependency)
        if (sbUrl && sbAnonKey) {
          try {
            const edgeRes = await fetch(`${sbUrl}/functions/v1/verify-razorpay-payment`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": sbAnonKey,
                ...(token ? { "Authorization": `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                payment_link_id: plinkId,
                razorpay_payment_link_id: plinkId,
                razorpay_payment_id: paymentId,
                plan_id: planIdParam,
                user_id: userId
              })
            });
            const edgeData = await edgeRes.json();
            if (edgeRes.ok && edgeData.success) {
              verified = true;
              resultMsg = edgeData.message;
            } else if (edgeData.error) {
              resultMsg = edgeData.error;
            }
          } catch (edgeErr) {
            console.warn("[PAYMENT] Edge verify notice:", edgeErr);
          }
        }

        // 2. Fallback to backend API
        if (!verified) {
          try {
            const res = await authFetch("/api/subscription/verify-payment-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ payment_link_id: plinkId, plan_id: planIdParam })
            });
            if (res.ok) {
              const data = await res.json();
              if (data.success) {
                verified = true;
                resultMsg = data.message;
              }
            }
          } catch (backendErr) {
            console.warn("[PAYMENT] Backend verify notice:", backendErr);
          }
        }

        if (verified) {
          showToast(resultMsg || "🎉 Payment verified! Your subscription is now active!", "success");
          fetchStatus();
        } else {
          showToast(resultMsg || "Payment verification checked.", "info");
        }

        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const s = data.session;
      if (s) {
        setSession(s);
        if (s?.access_token) {
          localStorage.setItem("sb_access_token", s.access_token);
          console.info("[AUTH] Session restored from Supabase.");
        }
        checkAndVerifyPaymentReturn(s);
      } else {
        const localToken = localStorage.getItem("sb_access_token");
        if (localToken) {
          setSession({ access_token: localToken });
          setShowLoginPage(false);
          console.info("[AUTH] Session restored from local token.");
          checkAndVerifyPaymentReturn({ access_token: localToken });
        } else {
          checkAndVerifyPaymentReturn(null);
        }
      }
      setAuthLoading(false);
    }).catch(err => {
      console.error("[AUTH] Error getting session:", err);
      const localToken = localStorage.getItem("sb_access_token");
      if (localToken) {
        setSession({ access_token: localToken });
        setShowLoginPage(false);
        checkAndVerifyPaymentReturn({ access_token: localToken });
      }
      if (mounted) setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;

      if (event === "PASSWORD_RECOVERY") {
        setIsResetPasswordView(true);
      }

      if (newSession?.access_token) {
        setSession(newSession);
        localStorage.setItem("sb_access_token", newSession.access_token);
        setShowLoginPage(false);
      } else if (event === "SIGNED_OUT") {
        setSession(null);
        localStorage.removeItem("sb_access_token");
        setShowLoginPage(true);
        setSettingsLoaded(false);
        setActiveSourceId(null);
        setActiveDestId(null);
        setChannels([]);
        setSourceMessages([]);
        setDestinationMessages([]);
      }
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem("sb_access_token") || session?.access_token;
      if (!token) return;
      const res = await authFetch("/api/status");
      if (res.status === 401) {
        setShowLoginPage(true);
        return;
      }
      const data = await res.json();

      // Query latest real-time subscription directly from Supabase Cloud
      try {
        const targetUserId = data?.account?.id || session?.user?.id;
        if (targetUserId) {
          const { data: dbSub, error: subErr } = await supabase
            .from("subscriptions")
            .select("*")
            .eq("user_id", targetUserId)
            .maybeSingle();

          if (dbSub && !subErr) {
            const isExpired = dbSub.status === "expired" || (dbSub.current_period_end && new Date(dbSub.current_period_end).getTime() < Date.now());
            const planTitles = {
              plan_599: "Basic Plan (₹599)",
              plan_799: "Pro Plan (₹799)",
              plan_1499: "AI Translation & Multi-Channel Plan (₹1499)"
            };

            data.subscription = {
              ...dbSub,
              status: isExpired ? "expired" : dbSub.status,
              is_expired: isExpired,
              plan_name: dbSub.plan_name || planTitles[dbSub.plan_id] || "Active Plan"
            };
          }

          // Query latest real-time user_settings directly from Supabase Cloud
          const { data: dbSettings, error: settErr } = await supabase
            .from("user_settings")
            .select("*")
            .eq("user_id", targetUserId)
            .maybeSingle();

          if (dbSettings && !settErr) {
            data.settings = { ...(data.settings || {}), ...dbSettings };
          }
        }
      } catch (eSub) {
        console.warn("[SUB] Real-time Supabase check notice:", eSub);
      }

      setStatus(data);

      if (data?.settings) {
        const savedSource = data.settings.source_channel_id ?? "all";
        const savedDest = data.settings.destination_channel_id ?? "";

        if (activeSourceIdRef.current === null) {
          setActiveSourceId(savedSource);
          activeSourceIdRef.current = savedSource;
        }
        if (activeDestIdRef.current === null) {
          setActiveDestId(savedDest);
          activeDestIdRef.current = savedDest;
        }
        setSettingsLoaded(true);
      }
    } catch (err) {
      console.error("Error fetching status:", err);
    }
  };

  useEffect(() => {
    const token = session?.access_token || localStorage.getItem("sb_access_token");
    if (token && !showLoginPage) {
      fetchStatus();
      fetchChannels(true);
    }
  }, [session?.access_token, showLoginPage]);

  useEffect(() => {
    if (status?.connected) {
      fetchChannels(channels.length === 0);
    }
  }, [status?.connected]);

  const fetchChannels = async (forceRefresh = false) => {
    try {
      const token = localStorage.getItem("sb_access_token") || session?.access_token;
      if (!token) return;
      const url = `/api/channels${forceRefresh ? "?refresh=true" : ""}`;
      const res = await authFetch(url);
      if (res.status === 401) {
        setShowLoginPage(true);
        return;
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.channels)) {
        setChannels(data.channels);
      } else {
        console.warn("[fetchChannels] API returned non-success:", data.detail || data.error || "No channels available");
      }
    } catch (err) {
      console.error("Error fetching channels:", err);
    }
  };

  const fetchSourceMessages = async (channelId) => {
    try {
      const token = localStorage.getItem("sb_access_token") || session?.access_token;
      if (!token) return;

      const targetId = channelId !== undefined && channelId !== null
        ? String(channelId)
        : (activeSourceIdRef.current || status?.settings?.source_channel_id || "all");

      if (channelId !== undefined && channelId !== null) {
        setActiveSourceId(targetId);
        activeSourceIdRef.current = targetId;
      }

      if (!targetId || targetId === "undefined" || targetId === "null") {
        return;
      }

      if (sourceAbortRef.current) {
        sourceAbortRef.current.abort();
      }
      sourceAbortRef.current = new AbortController();

      const requestId = ++sourceRequestIdRef.current;
      const requestedChannelId = String(targetId);

      const url = `/api/messages?channel_id=${encodeURIComponent(requestedChannelId)}`;
      const res = await authFetch(url, { signal: sourceAbortRef.current.signal });
      if (res.status === 401) { setShowLoginPage(true); return; }
      const data = await res.json();

      if (requestId !== sourceRequestIdRef.current) {
        return;
      }

      const currentActive = activeSourceIdRef.current || status?.settings?.source_channel_id || "all";
      if (!isSameChannelId(currentActive, requestedChannelId)) {
        return;
      }

      if (res.ok && data.success && Array.isArray(data.messages)) {
        setSourceMessages(data.messages);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[SOURCE FETCH] Request failed:", err);
      }
    }
  };

  const fetchDestinationMessages = async (channelId) => {
    try {
      const token = localStorage.getItem("sb_access_token") || session?.access_token;
      if (!token) return;

      const targetId = channelId !== undefined && channelId !== null
        ? String(channelId)
        : (activeDestIdRef.current || status?.settings?.destination_channel_id || "");

      if (channelId !== undefined && channelId !== null) {
        setActiveDestId(targetId);
        activeDestIdRef.current = targetId;
      }

      if (!targetId || targetId === "undefined" || targetId === "null" || targetId === "all") {
        return;
      }

      if (destAbortRef.current) {
        destAbortRef.current.abort();
      }
      destAbortRef.current = new AbortController();

      const requestId = ++destRequestIdRef.current;
      const requestedChannelId = String(targetId);

      const url = `/api/messages?channel_id=${encodeURIComponent(requestedChannelId)}`;
      const res = await authFetch(url, { signal: destAbortRef.current.signal });
      if (res.status === 401) { setShowLoginPage(true); return; }
      const data = await res.json();

      if (requestId !== destRequestIdRef.current) {
        return;
      }

      const currentActive = activeDestIdRef.current || status?.settings?.destination_channel_id || "";
      if (!isSameChannelId(currentActive, requestedChannelId)) {
        return;
      }

      if (res.ok && data.success && Array.isArray(data.messages)) {
        setDestinationMessages(data.messages);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[DEST FETCH] Request failed:", err);
      }
    }
  };

  // Controlled Non-Overlapping Polling Loop
  useEffect(() => {
    if (!session || authLoading || showLoginPage || !settingsLoaded) return;

    const loadAllData = async () => {
      if (isPollingRef.current || document.hidden) {
        return;
      }
      isPollingRef.current = true;

      try {
        await fetchStatus();
        await fetchChannels(false);

        const currentSrc = activeSourceIdRef.current || "all";
        const currentDest = activeDestIdRef.current || "";

        if (currentSrc) await fetchSourceMessages(currentSrc);
        if (currentDest) await fetchDestinationMessages(currentDest);
      } catch (e) {
        console.warn("[POLLING] Cycle error:", e);
      } finally {
        isPollingRef.current = false;
      }
    };

    loadAllData();
    const intervalId = window.setInterval(loadAllData, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [session?.access_token, authLoading, showLoginPage, settingsLoaded]);

  const handleSaveRules = async (payload) => {
    try {
      const currentUserId = session?.user?.id || status?.account?.id;
      const userKey = currentUserId ? `cached_routing_pipelines_${currentUserId}` : "cached_routing_pipelines";

      if (Array.isArray(payload.routing_pipelines)) {
        try {
          localStorage.setItem(userKey, JSON.stringify(payload.routing_pipelines));
        } catch (e) {}
      }

      // 1. Direct Supabase Cloud persistence (zero data loss across reloads)
      if (currentUserId) {
        try {
          const dbRow = {
            user_id: currentUserId,
            source_channel_id: payload.source_channel_id,
            destination_channel_id: payload.destination_channel_id,
            routing_pipelines: payload.routing_pipelines,
            webhook_url: payload.webhook_url,
            auto_post_telegram: payload.auto_post_telegram,
            auto_post_n8n: payload.auto_post_n8n,
            text_prefix: payload.text_prefix,
            text_suffix: payload.text_suffix,
            find_text: payload.find_text,
            replace_text: payload.replace_text,
            replacement_rules: payload.replacement_rules,
            override_all_links: payload.override_all_links,
            custom_link_url: payload.custom_link_url,
            remove_all_links: payload.remove_all_links,
            override_media_image: payload.override_media_image,
            custom_image_url: payload.custom_image_url,
            strip_media_images: payload.strip_media_images,
            keyword_filter: payload.keyword_filter,
            filter_mode: payload.filter_mode,
            enable_translation: payload.enable_translation,
            source_language: payload.source_language,
            target_language: payload.target_language,
            enabled: payload.enabled ?? true,
            updated_at: new Date().toISOString()
          };
          const cleanRow = Object.fromEntries(Object.entries(dbRow).filter(([_, v]) => v !== undefined));
          await supabase.from("user_settings").upsert(cleanRow, { onConflict: "user_id" });
        } catch (dbErr) {
          console.warn("[SETTINGS] Direct Supabase upsert notice:", dbErr);
        }
      }

      // 2. Also send to VPS backend so listener picks it up in memory
      let savedSettings = null;
      try {
        const res = await authFetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data?.settings) {
          savedSettings = data.settings;
        }
      } catch (apiErr) {
        console.warn("[SETTINGS] Backend API notice:", apiErr);
      }

      showToast("Engine Settings & Rules Saved Successfully!", "success");

      if (payload.source_channel_id !== undefined) {
        setActiveSourceId(payload.source_channel_id);
        activeSourceIdRef.current = payload.source_channel_id;
      }
      if (payload.destination_channel_id !== undefined) {
        setActiveDestId(payload.destination_channel_id);
        activeDestIdRef.current = payload.destination_channel_id;
      }

      if (savedSettings) {
        setStatus((prev) => ({ ...prev, settings: savedSettings }));
      }
      await fetchStatus();
    } catch (err) {
      console.error("[saveSettings] Error saving settings:", err);
      showToast("Save error: " + err, "error");
    }
  };

  const handleLogoutUser = async () => {
    if (sourceAbortRef.current) sourceAbortRef.current.abort();
    if (destAbortRef.current) destAbortRef.current.abort();

    localStorage.removeItem("sb_access_token");
    localStorage.removeItem("cached_routing_pipelines");
    if (session?.user?.id) {
      localStorage.removeItem(`cached_routing_pipelines_${session.user.id}`);
    }
    setSession(null);
    setShowLoginPage(true);
    setStatus(null);
    setSettingsLoaded(false);
    setActiveSourceId(null);
    setActiveDestId(null);
    setChannels([]);
    setSourceMessages([]);
    setDestinationMessages([]);
    await supabase.auth.signOut().catch(() => {});
  };

  const handleDisconnectTelegram = async () => {
    try {
      const res = await authFetch("/api/auth/logout", { method: "POST" });
      const data = await res.json();
      if (res.ok && (data.success || data.connected === false)) {
        showToast("Telegram account disconnected successfully!", "info");
        setChannels([]);
        setSourceMessages([]);
        setDestinationMessages([]);
        fetchStatus();
      } else {
        showToast(data.detail || "Failed to disconnect Telegram account", "error");
      }
    } catch (err) {
      console.error("Error disconnecting Telegram:", err);
      showToast("Error disconnecting Telegram: " + err.message, "error");
    }
  };

  // 1. Loading Splash Screen
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#090d16", color: "#ffffff", gap: "16px" }}>
        <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "36px", color: "var(--primary-yellow)" }}></i>
        <span style={{ fontSize: "14px", color: "var(--text-muted)", letterSpacing: "0.5px" }}>Checking session & security gate...</span>
      </div>
    );
  }

  // 2. Password Recovery View
  if (isResetPasswordView) {
    return (
      <ResetPasswordPage
        onResetComplete={() => {
          setIsResetPasswordView(false);
          window.history.replaceState({}, document.title, window.location.pathname);
          fetchStatus();
        }}
      />
    );
  }

  // 3. Unauthenticated Login Gate
  const hasValidAuth = !!(session?.access_token || localStorage.getItem("sb_access_token"));
  if (showLoginPage || !hasValidAuth) {
    return (
      <LoginPage
        onLoginSuccess={(newSession) => {
          setShowLoginPage(false);
          if (newSession) {
            setSession(newSession);
          }
          supabase.auth.getSession().then(({ data }) => {
            if (data?.session) setSession(data.session);
          }).catch(() => {});
        }}
      />
    );
  }

  // 4. Authenticated Dashboard Layout
  return (
    <div className="app-container">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        status={status}
        onLogoutUser={handleLogoutUser}
      />

      <main className="main-content">
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          status={status}
          onOpenLogin={() => setIsAuthModalOpen(true)}
          onRefresh={() => {
            fetchStatus();
            fetchChannels(true);
            if (activeSourceId) fetchSourceMessages(activeSourceId);
            if (activeDestId) fetchDestinationMessages(activeDestId);
          }}
          onLogoutUser={handleLogoutUser}
          onDisconnectTelegram={handleDisconnectTelegram}
        />

        {activeTab === "tab-studio" && (
          <StudioTab
            status={status}
            channels={channels}
            sourceMessages={sourceMessages}
            destinationMessages={destinationMessages}
            onSaveRules={handleSaveRules}
            onFetchSourceMessages={fetchSourceMessages}
            onFetchDestinationMessages={fetchDestinationMessages}
            onOpenLogin={() => setIsAuthModalOpen(true)}
            onRefresh={() => {
              fetchStatus();
              fetchChannels(true);
              if (activeSourceId) fetchSourceMessages(activeSourceId);
              if (activeDestId) fetchDestinationMessages(activeDestId);
            }}
          />
        )}

        {activeTab === "tab-overview" && (
          <OverviewTab
            status={status}
            messages={messages}
            setActiveTab={setActiveTab}
            onOpenLogin={() => setIsAuthModalOpen(true)}
            onDisconnectTelegram={handleDisconnectTelegram}
          />
        )}

        {activeTab === "tab-channels" && (
          <ChannelsTab
            channels={channels}
            onFetchChannels={() => fetchChannels(true)}
            status={status}
            onOpenLogin={() => setIsAuthModalOpen(true)}
          />
        )}

        {activeTab === "tab-pricing" && (
          <PricingTab
            status={status}
            onRefresh={fetchStatus}
            showToast={showToast}
            setActiveTab={setActiveTab}
          />
        )}
      </main>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onRefresh={fetchStatus}
        status={status}
      />

      <Toast
        message={toast?.message}
        type={toast?.type}
        onClose={() => setToast(null)}
      />
    </div>
  );
}
