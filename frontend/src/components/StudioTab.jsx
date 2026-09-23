import React, { useState, useEffect, useRef } from "react";

const formatLocalDate = (dateStr) => {
  if (!dateStr) return "";
  try {
    let raw = String(dateStr).trim();
    if (!raw.endsWith("Z") && !raw.includes("+") && !raw.includes("T")) {
      raw = raw.replace(" ", "T") + "Z";
    }
    const dateObj = new Date(raw);
    if (isNaN(dateObj.getTime())) return dateStr;

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (e) {
    return dateStr;
  }
};

const cleanDisplayMessage = (msgText) => {
  if (!msgText) return "";
  if (String(msgText).startsWith("↪ Replying to")) {
    const parts = String(msgText).split("\n\n");
    if (parts.length > 1) {
      return parts.slice(1).join("\n\n").trim();
    }
    return "";
  }
  return msgText;
};

const createInitialPipeline = (settings = {}) => ({
  id: "pipe_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
  name: "Channel Rule 1",
  enabled: settings.enabled ?? true,
  source_channels: settings.source_channel_id ? [String(settings.source_channel_id)] : ["all"],
  destination_channels: settings.destination_channel_id ? [String(settings.destination_channel_id)] : [],
  auto_post_telegram: settings.auto_post_telegram ?? true,
  auto_post_n8n: settings.auto_post_n8n ?? true,
  webhook_url: settings.webhook_url || "https://n8n.getaipilot.in/webhook/telegram_sync",
  text_prefix: settings.text_prefix ?? "",
  text_suffix: settings.text_suffix ?? "",
  find_text: settings.find_text || "",
  replace_text: settings.replace_text || "",
  replacement_rules: Array.isArray(settings.replacement_rules) && settings.replacement_rules.length > 0
    ? settings.replacement_rules.map((r, i) => ({ id: r.id || i + 1, find: r.find || "", replace: r.replace || "" }))
    : [{ id: 1, find: "", replace: "" }],
  override_all_links: settings.override_all_links ?? false,
  custom_link_url: settings.custom_link_url || "",
  remove_all_links: settings.remove_all_links ?? false,
  override_media_image: settings.override_media_image ?? false,
  custom_image_url: settings.custom_image_url || "",
  strip_media_images: settings.strip_media_images ?? false,
  keyword_filter: settings.keyword_filter || "",
  filter_mode: settings.filter_mode || "all"
});

export default function StudioTab({
  status,
  channels,
  sourceMessages = [],
  destinationMessages = [],
  onSaveRules,
  onFetchSourceMessages,
  onFetchDestinationMessages,
  onOpenLogin,
  onRefresh
}) {
  const isAuthorized = status?.authorized;
  const settings = status?.settings || {};

  // Multi-Pipeline State with instant localStorage cache fallback
  const [pipelines, setPipelines] = useState(() => {
    try {
      const cached = localStorage.getItem("cached_routing_pipelines");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    if (Array.isArray(status?.settings?.routing_pipelines) && status.settings.routing_pipelines.length > 0) {
      return status.settings.routing_pipelines;
    }
    return [createInitialPipeline(status?.settings || {})];
  });
  const [activePipelineIndex, setActivePipelineIndex] = useState(0);

  // Sync pipelines whenever backend status updates with valid pipelines
  useEffect(() => {
    if (Array.isArray(status?.settings?.routing_pipelines) && status.settings.routing_pipelines.length > 0) {
      const normalized = status.settings.routing_pipelines.map((p, idx) => ({
        ...createInitialPipeline(),
        ...p,
        id: p.id || `pipe_${idx + 1}`,
        name: p.name || `Channel Rule ${idx + 1}`,
        source_channels: p.source_channels || (p.source_channel_id ? [p.source_channel_id] : ["all"]),
        destination_channels: p.destination_channels || (p.destination_channel_id ? [p.destination_channel_id] : []),
        replacement_rules: Array.isArray(p.replacement_rules) && p.replacement_rules.length > 0
          ? p.replacement_rules.map((r, i) => ({ id: r.id || i + 1, find: r.find || "", replace: r.replace || "" }))
          : [{ id: 1, find: "", replace: "" }]
      }));
      setPipelines(normalized);
      try {
        localStorage.setItem("cached_routing_pipelines", JSON.stringify(normalized));
      } catch (e) {}
    }
  }, [JSON.stringify(status?.settings?.routing_pipelines)]);

  // Save to localStorage whenever pipelines change
  const persistPipelines = (newList) => {
    setPipelines(newList);
    try {
      localStorage.setItem("cached_routing_pipelines", JSON.stringify(newList));
    } catch (e) {}
  };

  // Ensure there's always at least one pipeline
  const currentPipelines = pipelines.length > 0 ? pipelines : [createInitialPipeline(settings)];
  const safeActiveIndex = Math.min(activePipelineIndex, currentPipelines.length - 1);
  const activePipe = currentPipelines[safeActiveIndex] || createInitialPipeline(settings);

  // Helper to update active pipeline
  const updateActivePipe = (fields) => {
    const copy = [...(pipelines.length > 0 ? pipelines : [createInitialPipeline(settings)])];
    copy[safeActiveIndex] = { ...copy[safeActiveIndex], ...fields };
    persistPipelines(copy);
  };

  // Add new pipeline
  const handleAddPipeline = () => {
    const newPipe = {
      ...createInitialPipeline(),
      name: `Channel Rule ${pipelines.length + 1}`
    };
    const next = [...pipelines, newPipe];
    persistPipelines(next);
    setActivePipelineIndex(pipelines.length);
  };

  // Duplicate pipeline
  const handleDuplicatePipeline = (idx) => {
    const target = currentPipelines[idx];
    const cloned = {
      ...JSON.parse(JSON.stringify(target)),
      id: "pipe_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      name: `${target.name} (Copy)`
    };
    const next = [...currentPipelines, cloned];
    persistPipelines(next);
    setActivePipelineIndex(currentPipelines.length);
  };

  // Delete pipeline
  const handleDeletePipeline = (idx) => {
    if (currentPipelines.length <= 1) return;
    const next = currentPipelines.filter((_, i) => i !== idx);
    persistPipelines(next);
    setActivePipelineIndex((prev) => (prev >= idx ? Math.max(0, prev - 1) : prev));
  };

  // Channel helper
  const isChannelMatch = (idA, idB) => {
    if (!idA || !idB) return false;
    if (String(idA) === String(idB)) return true;
    const cleanA = String(idA).replace("-100", "").replace("-", "").trim();
    const cleanB = String(idB).replace("-100", "").replace("-", "").trim();
    return cleanA === cleanB;
  };

  const getChannelName = (chId) => {
    if (!chId || chId === "all") return "All Chats (Global Extract)";
    const ch = channels.find((c) => isChannelMatch(c.id, chId));
    return ch ? ch.name : String(chId);
  };

  const formatChannelBadge = (chId) => {
    if (!chId || chId === "all") return "Global";
    const str = String(chId).trim();
    return str.startsWith("-") ? str : `-${str}`;
  };

  // Source & Destination message trigger whenever active rule or channels change
  useEffect(() => {
    if (onFetchSourceMessages && activePipe?.source_channels?.length > 0) {
      const firstSrc = activePipe.source_channels[0];
      onFetchSourceMessages(firstSrc || "all");
    }
  }, [safeActiveIndex, JSON.stringify(activePipe?.source_channels)]);

  useEffect(() => {
    if (onFetchDestinationMessages && activePipe?.destination_channels?.length > 0) {
      const firstDest = activePipe.destination_channels[0];
      onFetchDestinationMessages(firstDest || "");
    }
  }, [safeActiveIndex, JSON.stringify(activePipe?.destination_channels)]);

  // Toast state
  const [showSavedToast, setShowSavedToast] = useState(false);

  // Save handler
  const handleSave = () => {
    const cleanedPipelines = currentPipelines.map((p) => ({
      ...p,
      replacement_rules: (p.replacement_rules || []).filter((r) => r.find && r.find.trim() !== "")
    }));

    // Extract primary legacy fields from active pipeline for 100% backward compatibility
    const legacyPrimary = activePipe;
    const firstSrc = legacyPrimary.source_channels?.[0] || "all";
    const firstDest = legacyPrimary.destination_channels?.[0] || "";

    setShowSavedToast(true);
    setTimeout(() => setShowSavedToast(false), 3000);

    onSaveRules({
      routing_pipelines: cleanedPipelines,
      // Legacy backwards-compatible top-level properties
      source_channel_id: firstSrc,
      destination_channel_id: firstDest,
      auto_post_telegram: legacyPrimary.auto_post_telegram,
      auto_post_n8n: legacyPrimary.auto_post_n8n,
      webhook_url: legacyPrimary.webhook_url,
      text_prefix: legacyPrimary.text_prefix,
      text_suffix: legacyPrimary.text_suffix,
      find_text: legacyPrimary.find_text,
      replace_text: legacyPrimary.replace_text,
      replacement_rules: legacyPrimary.replacement_rules?.filter((r) => r.find && r.find.trim() !== ""),
      override_all_links: legacyPrimary.override_all_links,
      custom_link_url: legacyPrimary.custom_link_url,
      remove_all_links: legacyPrimary.remove_all_links,
      override_media_image: legacyPrimary.override_media_image,
      custom_image_url: legacyPrimary.custom_image_url,
      strip_media_images: legacyPrimary.strip_media_images,
      keyword_filter: legacyPrimary.keyword_filter,
      filter_mode: legacyPrimary.filter_mode,
      enabled: true
    });
  };

  // Sample test transformation state
  const [testInput, setTestInput] = useState("Check out our telegram update: contact info@oldbrand.com or @oldbrand at https://t.me/oldbrand");
  const [testOutput, setTestOutput] = useState("");

  const runLocalTransform = (text, pipe) => {
    if (!text) return "";
    let res = text;

    // Keyword Filter
    if (pipe.filter_mode === "allow_only" && pipe.keyword_filter) {
      const kw = pipe.keyword_filter.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
      if (!kw.some((k) => res.toLowerCase().includes(k))) return "[FILTERED: Message missing allowed keywords]";
    } else if (pipe.filter_mode === "block_if" && pipe.keyword_filter) {
      const kw = pipe.keyword_filter.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
      if (kw.some((k) => res.toLowerCase().includes(k))) return "[FILTERED: Message contains blocked keywords]";
    }

    // Individual rules
    if (Array.isArray(pipe.replacement_rules)) {
      for (const rule of pipe.replacement_rules) {
        if (rule.find && rule.find.trim()) {
          const esc = rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          res = res.replace(new RegExp(esc, "gi"), rule.replace || "");
        }
      }
    }

    // Bulk rules
    if (pipe.find_text && pipe.replace_text) {
      const finds = pipe.find_text.split(",").map((s) => s.trim());
      const reps = pipe.replace_text.split(",").map((s) => s.trim());
      for (let i = 0; i < finds.length; i++) {
        if (finds[i]) {
          const esc = finds[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          res = res.replace(new RegExp(esc, "gi"), reps[i] || "");
        }
      }
    }

    // Links
    if (pipe.remove_all_links) {
      res = res.replace(/https?:\/\/[^\s]+/gi, "").trim();
    } else if (pipe.override_all_links && pipe.custom_link_url) {
      res = res.replace(/https?:\/\/[^\s]+/gi, pipe.custom_link_url);
    }

    // Prefix & Suffix
    if (pipe.text_prefix) res = `${pipe.text_prefix} ${res}`;
    if (pipe.text_suffix) res = `${res} ${pipe.text_suffix}`;

    return res.trim();
  };

  useEffect(() => {
    setTestOutput(runLocalTransform(testInput, activePipe));
  }, [testInput, activePipe]);

  return (
    <section className="tab-content active" id="tab-studio">
      {/* Toast Notification */}
      {showSavedToast && (
        <div style={{
          position: "fixed",
          top: "20px",
          right: "20px",
          zIndex: 9999,
          background: "linear-gradient(135deg, #10b981, #059669)",
          color: "#ffffff",
          padding: "12px 20px",
          borderRadius: "10px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontWeight: "600",
          fontSize: "13px"
        }}>
          <i className="fa-solid fa-circle-check font-18"></i>
          <span>All Channel Rules & Pipelines Saved Successfully!</span>
        </div>
      )}

      {/* Telegram Not Connected / Expired Warning Banner */}
      {(!status?.authorized || status?.session_expired) && (
        <div
          className="card"
          style={{
            marginBottom: "16px",
            background: status?.status_code === "RECONNECTING" || status?.status_code === "DISCONNECTED_TEMPORARILY"
              ? "rgba(245, 158, 11, 0.08)"
              : "rgba(239, 68, 68, 0.08)",
            border: status?.status_code === "RECONNECTING" || status?.status_code === "DISCONNECTED_TEMPORARILY"
              ? "1px solid rgba(245, 158, 11, 0.3)"
              : "1px solid rgba(239, 68, 68, 0.3)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
            <i className={`fa-solid ${status?.status_code === "RECONNECTING" || status?.status_code === "DISCONNECTED_TEMPORARILY" ? "fa-spinner fa-spin text-orange" : "fa-triangle-exclamation text-red"} font-18`} style={{ flexShrink: 0 }}></i>
            <span style={{ fontSize: "12px", lineHeight: "1.4" }}>
              {status?.status_code === "RECONNECTING" ? (
                <><strong>Reconnecting Telegram Session:</strong> Re-establishing connection in background...</>
              ) : status?.status_code === "DISCONNECTED_TEMPORARILY" ? (
                <><strong>Connection Temporarily Offline:</strong> Retrying background connection...</>
              ) : status?.session_expired ? (
                <><strong>Session Key Revoked:</strong> Re-enter 5-digit Telegram code to reconnect.</>
              ) : (
                <><strong>Telegram Account Not Connected:</strong> Connect your account to enable live channel routing.</>
              )}
            </span>
          </div>
          {!(status?.status_code === "RECONNECTING" || status?.status_code === "DISCONNECTED_TEMPORARILY") && (
            <button className="btn btn-primary btn-sm" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={onOpenLogin}>
              <i className="fa-paper-plane fa-solid"></i> Connect Telegram Account
            </button>
          )}
        </div>
      )}

      {/* 🚀 MULTI-CHANNEL ROUTING STREAMS BAR */}
      <div
        style={{
          background: "linear-gradient(180deg, rgba(20, 27, 45, 0.95), rgba(13, 18, 31, 0.95))",
          border: "1px solid rgba(59, 130, 246, 0.3)",
          borderRadius: "14px",
          padding: "16px 20px",
          marginBottom: "16px",
          backdropFilter: "blur(12px)",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)"
        }}
      >
        {/* Header & Stream Switcher */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "30px", height: "30px", borderRadius: "8px",
              background: "rgba(59, 130, 246, 0.2)", color: "var(--primary-blue)",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px"
            }}>
              <i className="fa-solid fa-arrows-split-up-and-left"></i>
            </div>
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: "700", margin: 0, color: "#ffffff" }}>
                Channel Routing Streams ({currentPipelines.length})
              </h3>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Configure multiple source channels → custom modifications → multiple destination channels
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              className="btn btn-outline btn-sm"
              onClick={handleAddPipeline}
              style={{
                background: "rgba(59, 130, 246, 0.15)",
                borderColor: "var(--primary-blue)",
                color: "#60a5fa",
                fontSize: "12px",
                padding: "6px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <i className="fa-solid fa-plus"></i> Add Channel Rule
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              style={{ fontSize: "12px", padding: "6px 16px", display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <i className="fa-solid fa-floppy-disk"></i> Save All Rules
            </button>
          </div>
        </div>

        {/* Stream Pills List */}
        <div style={{ display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "6px", marginBottom: "14px" }}>
          {currentPipelines.map((pipe, idx) => {
            const isActive = idx === safeActiveIndex;
            const srcCount = (pipe.source_channels || []).length;
            const destCount = (pipe.destination_channels || []).length;
            const isAll = pipe.source_channels?.includes("all");

            return (
              <div
                key={pipe.id || idx}
                onClick={() => setActivePipelineIndex(idx)}
                style={{
                  background: isActive ? "rgba(59, 130, 246, 0.25)" : "rgba(0, 0, 0, 0.4)",
                  border: isActive ? "2px solid #3b82f6" : "1px solid var(--border-color)",
                  borderRadius: "10px",
                  padding: "8px 14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  minWidth: "190px",
                  transition: "all 0.2s ease"
                }}
              >
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  backgroundColor: pipe.enabled ? "#10b981" : "#6b7280"
                }}></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: isActive ? "#ffffff" : "#d1d5db", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {pipe.name || `Rule ${idx + 1}`}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>{isAll ? "All Sources" : `${srcCount} src`}</span>
                    <i className="fa-solid fa-arrow-right" style={{ fontSize: "8px" }}></i>
                    <span>{destCount} dest</span>
                  </div>
                </div>
                {isActive && (
                  <span style={{ fontSize: "10px", background: "rgba(59, 130, 246, 0.4)", color: "#93c5fd", padding: "1px 6px", borderRadius: "4px", fontWeight: "600" }}>
                    Active
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Active Rule Details & Channel Connector */}
        <div style={{
          background: "rgba(0, 0, 0, 0.45)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "12px",
          padding: "14px 16px"
        }}>
          {/* Active Rule Metadata Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "260px" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Rule Name:</label>
              <input
                type="text"
                className="form-control"
                style={{ height: "34px", maxWidth: "260px", fontWeight: "600", fontSize: "12px" }}
                value={activePipe.name || ""}
                onChange={(e) => updateActivePipe({ name: e.target.value })}
                placeholder="e.g. VIP Signals Pipeline"
              />
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#ffffff", cursor: "pointer", marginLeft: "8px" }}>
                <input
                  type="checkbox"
                  checked={activePipe.enabled ?? true}
                  onChange={(e) => updateActivePipe({ enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => handleDuplicatePipeline(safeActiveIndex)}
                title="Duplicate this Rule"
                style={{ fontSize: "11px", padding: "4px 10px" }}
              >
                <i className="fa-regular fa-copy"></i> Clone
              </button>
              {currentPipelines.length > 1 && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleDeletePipeline(safeActiveIndex)}
                  title="Delete this Rule"
                  style={{ fontSize: "11px", padding: "4px 10px", color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.4)" }}
                >
                  <i className="fa-solid fa-trash"></i> Delete
                </button>
              )}
            </div>
          </div>

          {/* Source & Destination Channel Selectors Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "16px", alignItems: "start" }}>
            {/* Source Channels Picker */}
            <div>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                <i className="fa-solid fa-square-poll-vertical text-blue"></i> Source Channel(s) for this Rule
              </label>
              <select
                className="form-select"
                style={{ width: "100%", height: "38px", background: "rgba(0, 0, 0, 0.6)", border: "1px solid var(--border-color)", fontWeight: "600", fontSize: "13px" }}
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  const current = activePipe.source_channels || [];
                  if (val === "all") {
                    updateActivePipe({ source_channels: ["all"] });
                  } else {
                    const filtered = current.filter((c) => c !== "all");
                    if (!filtered.some((c) => isChannelMatch(c, val))) {
                      updateActivePipe({ source_channels: [...filtered, val] });
                    }
                  }
                }}
              >
                <option value="">+ Add Source Channel...</option>
                <option value="all">⚡ All Incoming Chats (Global Extract)</option>
                {channels.map((ch, idx) => (
                  <option key={`src-ch-${ch.id}-${idx}`} value={ch.id}>
                    {ch.name} ({ch.type === "channel" ? "Channel" : ch.type})
                  </option>
                ))}
              </select>

              {/* Selected Source Channel Tags */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                {(activePipe.source_channels || ["all"]).map((chId) => (
                  <span
                    key={`tag-src-${chId}`}
                    style={{
                      background: "rgba(59, 130, 246, 0.2)",
                      border: "1px solid rgba(59, 130, 246, 0.4)",
                      color: "#93c5fd",
                      padding: "3px 8px",
                      borderRadius: "6px",
                      fontSize: "11px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <span>{getChannelName(chId)}</span>
                    <i
                      className="fa-solid fa-xmark"
                      style={{ cursor: "pointer", fontSize: "10px", color: "#ef4444" }}
                      onClick={() => {
                        const next = (activePipe.source_channels || []).filter((c) => c !== chId);
                        updateActivePipe({ source_channels: next.length > 0 ? next : ["all"] });
                      }}
                    ></i>
                  </span>
                ))}
              </div>
            </div>

            {/* Middle Auto-Post Relay Switch */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "center" }}>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>Auto-Relay</label>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(0, 0, 0, 0.4)", padding: "0 14px", height: "38px", borderRadius: "30px", border: "1px solid var(--border-color)" }}>
                <i className="fa-solid fa-arrow-right text-blue"></i>
                <label className="switch" style={{ position: "relative", display: "inline-block", width: "36px", height: "20px", margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={activePipe.auto_post_telegram ?? true}
                    onChange={(e) => updateActivePipe({ auto_post_telegram: e.target.checked })}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span
                    style={{
                      position: "absolute", cursor: "pointer", top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: activePipe.auto_post_telegram ? "var(--primary-blue)" : "#374151",
                      transition: ".3s", borderRadius: "20px"
                    }}
                  >
                    <span
                      style={{
                        position: "absolute", height: "14px", width: "14px",
                        left: activePipe.auto_post_telegram ? "18px" : "3px", bottom: "3px",
                        backgroundColor: "white", transition: ".3s", borderRadius: "50%"
                      }}
                    ></span>
                  </span>
                </label>
              </div>
            </div>

            {/* Destination Channels Picker */}
            <div>
              <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                <i className="fa-paper-plane fa-solid text-green"></i> Destination Channel(s) for this Rule
              </label>
              <select
                className="form-select"
                style={{ width: "100%", height: "38px", background: "rgba(0, 0, 0, 0.6)", border: "1px solid var(--border-color)", fontWeight: "600", fontSize: "13px" }}
                value=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  const current = activePipe.destination_channels || [];
                  if (!current.some((c) => isChannelMatch(c, val))) {
                    updateActivePipe({ destination_channels: [...current, val] });
                  }
                }}
              >
                <option value="">+ Add Destination Channel...</option>
                {channels.map((ch, idx) => (
                  <option key={`dest-ch-${ch.id}-${idx}`} value={ch.id}>
                    {ch.name} ({ch.type === "channel" ? "Channel" : ch.type})
                  </option>
                ))}
              </select>

              {/* Selected Destination Channel Tags */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                {(activePipe.destination_channels || []).length === 0 ? (
                  <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>
                    No destination channels added yet
                  </span>
                ) : (
                  (activePipe.destination_channels || []).map((chId) => (
                    <span
                      key={`tag-dest-${chId}`}
                      style={{
                        background: "rgba(16, 185, 129, 0.2)",
                        border: "1px solid rgba(16, 185, 129, 0.4)",
                        color: "#6ee7b7",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        fontSize: "11px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px"
                      }}
                    >
                      <span>{getChannelName(chId)}</span>
                      <i
                        className="fa-solid fa-xmark"
                        style={{ cursor: "pointer", fontSize: "10px", color: "#ef4444" }}
                        onClick={() => {
                          const next = (activePipe.destination_channels || []).filter((c) => c !== chId);
                          updateActivePipe({ destination_channels: next });
                        }}
                      ></i>
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3-COLUMN STUDIO WORKSPACE */}
      <div className="studio-grid-3cols">
        {/* Column 1: Source Messages Stream */}
        <div className="studio-col card">
          <div className="studio-col-header" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="col-title" style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(0, 136, 204, 0.2)", color: "var(--primary-blue)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>
                <i className="fa-solid fa-square-poll-vertical"></i>
              </div>
              <div style={{ overflow: "hidden" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "700", margin: 0 }}>1. Source Stream</h3>
                <span className="sub-text" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                  {activePipe.source_channels?.includes("all") ? "All Incoming Chats" : `${activePipe.source_channels?.length || 0} Filtered Sources`}
                </span>
              </div>
            </div>
            <button
              className="btn-logout-icon"
              onClick={() => {
                if (onFetchSourceMessages && activePipe?.source_channels?.length > 0) {
                  onFetchSourceMessages(activePipe.source_channels[0] || "all");
                }
                if (onRefresh) onRefresh();
              }}
              title="Refresh Source Feed"
            >
              <i className="fa-solid fa-arrows-rotate text-muted"></i>
            </button>
          </div>

          <div className="studio-col-body" style={{ padding: "14px" }}>
            {!isAuthorized ? (
              <div className="empty-state" style={{ padding: "60px 20px" }}>
                <i className="fa-solid fa-comments font-24 mb-10" style={{ fontSize: "32px", display: "block", margin: "0 auto 12px" }}></i>
                <h4 style={{ color: "#ffffff", fontSize: "14px", fontWeight: "600", marginBottom: "4px" }}>Telegram Not Connected</h4>
                <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Connect your Telegram account to inspect live messages.</p>
                <button className="btn btn-primary btn-sm" onClick={onOpenLogin}>
                  <i className="fa-paper-plane fa-solid"></i> Connect Telegram Account
                </button>
              </div>
            ) : sourceMessages.length === 0 ? (
              <div className="empty-state" style={{ padding: "60px 20px" }}>
                <i className="fa-solid fa-comments font-24 mb-10" style={{ fontSize: "32px", display: "block", margin: "0 auto 12px" }}></i>
                <p style={{ fontSize: "12px" }}>No messages received yet in source channel.</p>
              </div>
            ) : (
              <div className="stream-feed" style={{ maxHeight: "540px", overflowY: "auto", paddingRight: "4px" }}>
                {sourceMessages.map((m, idx) => (
                  <div
                    className="msg-card"
                    key={`src-msg-${m.chat_id || 'all'}-${m.id || idx}-${idx}`}
                    style={{ background: "rgba(13, 18, 31, 0.8)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px", marginBottom: "10px" }}
                  >
                    <div className="msg-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontWeight: "700", color: "#ffffff", fontSize: "12px" }}>
                        <i className="fa-regular fa-square"></i> {m.chat_name}
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{formatLocalDate(m.date)}</span>
                    </div>

                    <div className="msg-body" style={{ fontSize: "13px", fontWeight: "600", color: "#ffffff", margin: "8px 0", lineHeight: "1.4" }}>
                      {m.raw_message}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", paddingTop: "8px", borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
                      <span className="badge" style={{ background: "rgba(0, 136, 204, 0.15)", color: "var(--primary-blue)", fontSize: "10px" }}>
                        ID: {m.id || idx + 1}
                      </span>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: "10px", padding: "2px 6px" }}
                        onClick={() => setTestInput(m.raw_message || "")}
                        title="Load this message into the Interactive Rule Tester"
                      >
                        <i className="fa-solid fa-percent"></i> Load into Modifier
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Modifier Engine for the Active Rule */}
        <div className="studio-col card">
          <div className="studio-col-header" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="col-title" style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(139, 92, 246, 0.2)", color: "var(--accent-purple)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>
                <i className="fa-solid fa-wand-magic-sparkles"></i>
              </div>
              <div style={{ overflow: "hidden" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "700", margin: 0 }}>2. Modifier Engine</h3>
                <span className="sub-text" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                  Rules for: {activePipe.name}
                </span>
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleSave} style={{ background: "var(--primary-blue)", padding: "6px 12px", fontSize: "12px" }}>
              <i className="fa-solid fa-floppy-disk"></i> Save Rules
            </button>
          </div>

          <div className="studio-col-body" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "600px", overflowY: "auto" }}>
            {/* n8n Webhook Target */}
            <div className="modifier-section" style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <h4 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                  <i className="fa-solid fa-globe text-orange"></i> Webhook / n8n Dispatch
                </h4>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-muted)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={activePipe.auto_post_n8n ?? true}
                    onChange={(e) => updateActivePipe({ auto_post_n8n: e.target.checked })}
                  />
                  Post to Webhook
                </label>
              </div>
              <input
                type="url"
                className="form-control"
                placeholder="https://n8n.getaipilot.in/webhook/telegram_sync"
                value={activePipe.webhook_url || ""}
                onChange={(e) => updateActivePipe({ webhook_url: e.target.value })}
              />
            </div>

            {/* Prefix & Suffix Customizer */}
            <div className="modifier-section" style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px" }}>
              <h4 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                <i className="fa-solid fa-font text-blue"></i> Prefix & Suffix Customizer
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Text Prefix</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="[MIRROR]"
                    value={activePipe.text_prefix || ""}
                    onChange={(e) => updateActivePipe({ text_prefix: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Text Suffix</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="#Sync"
                    value={activePipe.text_suffix || ""}
                    onChange={(e) => updateActivePipe({ text_suffix: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Multiple Find & Replace Rules (Emails, Usernames, URLs, Text) */}
            <div className="modifier-section" style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <h4 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                  <i className="fa-solid fa-pen-to-square text-purple"></i> Find & Replace (Emails, Usernames, URLs)
                </h4>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    const currentRules = activePipe.replacement_rules || [];
                    updateActivePipe({ replacement_rules: [...currentRules, { id: Date.now(), find: "", replace: "" }] });
                  }}
                  style={{ fontSize: "10px", padding: "2px 6px" }}
                >
                  + Add Rule
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(activePipe.replacement_rules || [{ id: 1, find: "", replace: "" }]).map((rule, rIdx) => (
                  <div key={rule.id || rIdx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: "6px", alignItems: "center" }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Find (e.g. @old_user, email, url)..."
                      value={rule.find || ""}
                      onChange={(e) => {
                        const nextRules = (activePipe.replacement_rules || []).map((r) =>
                          r.id === rule.id ? { ...r, find: e.target.value } : r
                        );
                        updateActivePipe({ replacement_rules: nextRules });
                      }}
                    />
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Replace with (@new_user)..."
                      value={rule.replace || ""}
                      onChange={(e) => {
                        const nextRules = (activePipe.replacement_rules || []).map((r) =>
                          r.id === rule.id ? { ...r, replace: e.target.value } : r
                        );
                        updateActivePipe({ replacement_rules: nextRules });
                      }}
                    />
                    <button
                      className="btn-logout-icon"
                      onClick={() => {
                        const nextRules = (activePipe.replacement_rules || []).filter((r) => r.id !== rule.id);
                        updateActivePipe({ replacement_rules: nextRules.length > 0 ? nextRules : [{ id: 1, find: "", replace: "" }] });
                      }}
                      style={{ color: "#ef4444", padding: "4px" }}
                      title="Remove Rule"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Bulk Replacement (Quick Mode) */}
            <div className="modifier-section" style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px" }}>
              <h4 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", marginBottom: "2px", display: "flex", alignItems: "center", gap: "8px" }}>
                <i className="fa-solid fa-bolt text-yellow"></i> Bulk Replacement (Comma-Separated)
              </h4>
              <p style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "8px" }}>Target words matched 1-to-1</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="crypto, urgent, Loot"
                  value={activePipe.find_text || ""}
                  onChange={(e) => updateActivePipe({ find_text: e.target.value })}
                />
                <input
                  type="text"
                  className="form-control"
                  placeholder="web3, now, Deal"
                  value={activePipe.replace_text || ""}
                  onChange={(e) => updateActivePipe({ replace_text: e.target.value })}
                />
              </div>
            </div>

            {/* Smart Universal Link Replacement */}
            <div className="modifier-section" style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px" }}>
              <h4 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                <i className="fa-solid fa-link text-blue"></i> Universal Link Replacement
              </h4>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", marginBottom: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={activePipe.remove_all_links ?? false}
                  onChange={(e) => updateActivePipe({ remove_all_links: e.target.checked })}
                />
                Remove all links from message text
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", marginBottom: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={activePipe.override_all_links ?? false}
                  onChange={(e) => updateActivePipe({ override_all_links: e.target.checked })}
                />
                Replace all links with custom promotional URL
              </label>
              <input
                type="url"
                className="form-control"
                placeholder="https://t.me/your_promotional_channel"
                disabled={!activePipe.override_all_links}
                value={activePipe.custom_link_url || ""}
                onChange={(e) => updateActivePipe({ custom_link_url: e.target.value })}
              />
            </div>

            {/* Smart Media & Custom Image Replacement */}
            <div className="modifier-section" style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px" }}>
              <h4 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                <i className="fa-solid fa-image text-green"></i> Media Options
              </h4>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", marginBottom: "6px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={activePipe.override_media_image ?? false}
                  onChange={(e) => updateActivePipe({ override_media_image: e.target.checked })}
                />
                Replace original message image with custom Image URL
              </label>
              <input
                type="url"
                className="form-control"
                placeholder="https://example.com/banner.jpg"
                disabled={!activePipe.override_media_image}
                value={activePipe.custom_image_url || ""}
                onChange={(e) => updateActivePipe({ custom_image_url: e.target.value })}
              />
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", marginTop: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={activePipe.strip_media_images ?? false}
                  onChange={(e) => updateActivePipe({ strip_media_images: e.target.checked })}
                />
                Strip media attachments & send text-only
              </label>
            </div>

            {/* Keyword Filtering */}
            <div className="modifier-section" style={{ background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "12px" }}>
              <h4 style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                <i className="fa-solid fa-filter text-yellow"></i> Keyword Filtering
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "8px" }}>
                <select
                  className="form-select"
                  value={activePipe.filter_mode || "all"}
                  onChange={(e) => updateActivePipe({ filter_mode: e.target.value })}
                >
                  <option value="all">Allow All Messages</option>
                  <option value="allow_only">Forward Only If Contains Keywords</option>
                  <option value="block_if">Block If Contains Keywords</option>
                </select>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. promo, crypto, update"
                  value={activePipe.keyword_filter || ""}
                  onChange={(e) => updateActivePipe({ keyword_filter: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Column 3: Destination Feeds & Live Test Box */}
        <div className="studio-col card">
          <div className="studio-col-header" style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="col-title" style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(16, 185, 129, 0.2)", color: "var(--accent-green)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>
                <i className="fa-solid fa-circle-arrow-up"></i>
              </div>
              <div style={{ overflow: "hidden" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "700", margin: 0 }}>3. Live Preview & Destination</h3>
                <span className="sub-text" style={{ color: "var(--accent-green)", fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                  {(activePipe.destination_channels || []).length} Destination Target(s)
                </span>
              </div>
            </div>
            <button
              className="btn-logout-icon"
              onClick={() => {
                if (onFetchDestinationMessages && activePipe?.destination_channels?.length > 0) {
                  onFetchDestinationMessages(activePipe.destination_channels[0]);
                }
                if (onRefresh) onRefresh();
              }}
              title="Refresh Destination Feed"
            >
              <i className="fa-solid fa-arrows-rotate text-muted"></i>
            </button>
          </div>

          <div className="studio-col-body" style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* 🧪 Real-time Interactive Test Transformation Box */}
            <div style={{
              background: "rgba(16, 185, 129, 0.08)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: "10px",
              padding: "12px"
            }}>
              <h4 style={{ fontSize: "12px", fontWeight: "700", color: "#6ee7b7", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <i className="fa-solid fa-vial"></i> Live Rule Tester ({activePipe.name})
              </h4>
              <textarea
                className="form-control"
                rows={2}
                style={{ fontSize: "12px", marginBottom: "8px", background: "rgba(0,0,0,0.4)" }}
                placeholder="Type sample message here..."
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
              />
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Output Result:</div>
              <div style={{
                background: "rgba(0, 0, 0, 0.6)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                padding: "8px 10px",
                fontSize: "12px",
                fontWeight: "600",
                color: "#ffffff",
                minHeight: "36px",
                wordBreak: "break-word"
              }}>
                {testOutput || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No output</span>}
              </div>
            </div>

            {/* Destination Stream Messages */}
            <div style={{ flex: 1, minHeight: "260px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>
                Destination Chat Feed
              </div>
              {!isAuthorized ? (
                <div className="empty-state" style={{ padding: "30px 10px" }}>
                  <i className="fa-solid fa-paper-plane font-24 mb-10" style={{ fontSize: "28px", color: "var(--accent-green)", display: "block", margin: "0 auto 8px" }}></i>
                  <p style={{ fontSize: "12px" }}>Connect Telegram to view destination messages.</p>
                </div>
              ) : destinationMessages.length === 0 ? (
                <div className="empty-state" style={{ padding: "30px 10px" }}>
                  <i className="fa-solid fa-paper-plane font-24 mb-10" style={{ fontSize: "28px", color: "var(--accent-green)", display: "block", margin: "0 auto 8px" }}></i>
                  <p style={{ fontSize: "12px" }}>No forwarded messages recorded yet for this destination.</p>
                </div>
              ) : (
                <div className="stream-feed" style={{ maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
                  {destinationMessages.map((m, idx) => (
                    <div
                      className="msg-card"
                      key={`dest-msg-${m.chat_id || 'dest'}-${m.id || idx}-${idx}`}
                      style={{ background: "rgba(13, 18, 31, 0.8)", border: "1px solid var(--border-color)", borderLeft: "3px solid var(--accent-green)", borderRadius: "10px", padding: "10px", marginBottom: "8px" }}
                    >
                      <div className="msg-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <strong style={{ color: "var(--accent-green)", fontSize: "11px" }}>
                          <i className="fa-solid fa-circle-check"></i> Destination Feed
                        </strong>
                        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{formatLocalDate(m.date)}</span>
                      </div>
                      <div className="msg-body" style={{ fontSize: "12px", fontWeight: "600", color: "#ffffff", margin: "6px 0", lineHeight: "1.3" }}>
                        {cleanDisplayMessage(m.transformed_message || m.raw_message)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
