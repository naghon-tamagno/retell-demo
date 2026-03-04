"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RetellWebClient } from "retell-client-js-sdk";

type Segment = {
  id: string;
  speaker: "agent" | "user" | "system";
  text: string;
  ts: number;
};

function now() {
  return Date.now();
}

function formatDurationMs(ms?: number | null) {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export default function VoiceDemo() {
  const clientRef = useRef<RetellWebClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<any>(null);
  const startLockRef = useRef(false);
  const [agents, setAgents] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  const [status, setStatus] =
    useState<"idle" | "starting" | "in_call" | "processing">("idle");

  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);

  const [bestEvent, setBestEvent] = useState<string | null>(null);
  const [eventsCount, setEventsCount] = useState<number | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [successful, setSuccessful] = useState<boolean | null>(null);
  const [duration, setDuration] = useState<string>("—");
  const [customFields, setCustomFields] = useState<Record<string, any>>({});

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop =
        transcriptRef.current.scrollHeight;
    }
  }, [segments.length]);

  function stopPolling() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }

  function resetPostCall() {
    setBestEvent(null);
    setEventsCount(null);
    setSummary(null);
    setSentiment(null);
    setSuccessful(null);
    setDuration("—");
    setCustomFields({});
  }

  function parsePostCall(data: any) {
    setBestEvent(data?.best_event ?? null);
    setEventsCount(data?.events_count ?? null);

    const durMs = data?.duration_ms ?? null;
    setDuration(
      typeof durMs === "number" && durMs > 0
        ? formatDurationMs(durMs)
        : "—"
    );

    const ca = data?.call_analysis ?? null;

    setSummary(ca?.call_summary ?? null);
    setSentiment(ca?.user_sentiment ?? null);
    setSuccessful(
      typeof ca?.call_successful === "boolean"
        ? ca.call_successful
        : null
    );
    setCustomFields(ca?.custom_analysis_data ?? {});
  }

  function startPolling(id: string) {
    stopPolling();

    const startedAt = Date.now();
    pollTimerRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/calls/${id}`, {
          cache: "no-store",
        });
        const data = await r.json();

        if (data?.status === "ready") {
          parsePostCall(data);

          if (data?.has_analysis) {
            stopPolling();
            setStatus("idle");
            return;
          }
        }

        if (Date.now() - startedAt > 30000) {
          stopPolling();
          setStatus("idle");
        }
      } catch {}
    }, 1200);
  }

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/agents", { cache: "no-store" });
        const j = await r.json();
        const list = j?.agents ?? [];
        setAgents(list);
        if (list.length && !selectedAgentId) setSelectedAgentId(list[0].id);
      } catch {
        // si falla, lo dejamos vacío
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = new RetellWebClient();
    clientRef.current = c;

    c.on("call_started", () => setStatus("in_call"));

    c.on("call_ended", () => {
      setStatus("processing");
      const id = callIdRef.current;
      if (id) startPolling(id);
      startLockRef.current = false;
    });

    c.on("error", (e: any) => {
      setError(e?.message ?? "Error");
      setStatus("idle");
      startLockRef.current = false;
    });

    c.on("update", (u: any) => {
      try {
        // 1) Infer speaker
        const speakerRaw =
          u?.speaker ??
          u?.from ??
          u?.role ??
          (u?.is_agent ? "agent" : u?.is_user ? "user" : "system");

        const speaker: Segment["speaker"] =
          speakerRaw === "agent" ? "agent" : speakerRaw === "user" ? "user" : "system";

        // 2) Candidate payload (puede ser string / obj / array)
        const candidate =
          u?.text ??
          u?.transcript ??
          u?.partial_transcript ??
          u?.data?.text ??
          u?.data?.transcript ??
          u?.delta ??
          u;

        let text = "";
        let role: any = null;

        if (Array.isArray(candidate)) {
          // muchos SDKs mandan array de piezas
          const last = candidate[candidate.length - 1];
          role = last?.role ?? last?.speaker ?? null;
          text = last?.content ?? last?.text ?? last?.transcript ?? "";
        } else if (typeof candidate === "string") {
          text = candidate;
        } else if (candidate && typeof candidate === "object") {
          role = candidate.role ?? candidate.speaker ?? null;
          text =
            candidate.content ??
            candidate.text ??
            candidate.transcript ??
            candidate.partial_transcript ??
            candidate.delta ??
            "";
        }

        text = String(text ?? "").trim();
        if (!text) return;

        // si el rol viene explícito, lo respetamos
        const inferredSpeaker: Segment["speaker"] =
          role === "agent" ? "agent" : role === "user" ? "user" : speaker;

        // 3) Coalescing: en vez de spamear palabra por palabra
        setSegments((prev) => {
          const last = prev[prev.length - 1];

          // si es el mismo speaker, y parece refinamiento/partial, reemplazamos el último
          if (last && last.speaker === inferredSpeaker) {
            const newerLooksLikeUpdate =
              text.includes(last.text) || last.text.includes(text) || text.length >= last.text.length;

            if (newerLooksLikeUpdate) {
              return [...prev.slice(0, -1), { ...last, text, ts: now() }];
            }
          }

          return [
            ...prev,
            { id: `${now()}-${Math.random()}`, speaker: inferredSpeaker, text, ts: now() },
          ];
        });
      } catch {
        // ignore
      }
    });
    return () => {
      stopPolling();
      try {
        c.stopCall();
      } catch {}
    };
  }, []);

  async function start() {
    if (startLockRef.current) return;
    if (status !== "idle") return;

    startLockRef.current = true;

    setSegments([]);
    resetPostCall();
    setCallId(null);
    callIdRef.current = null;
    setStatus("starting");

    try {
      const resp = await fetch("/api/create-web-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: selectedAgentId }),
      });
      const { access_token, call_id } = await resp.json();

      callIdRef.current = call_id;
      setCallId(call_id);

      await clientRef.current?.startCall({
        accessToken: access_token,
      });
    } catch (e: any) {
      setError(e?.message ?? "Error");
      setStatus("idle");
      startLockRef.current = false;
    }
  }

  async function stop() {
    stopPolling();
    startLockRef.current = false;
    try {
      await clientRef.current?.stopCall();
    } catch {}
    setStatus("idle");
  }

  const handleStartOrStop = async () => {
    if (status === "in_call") {
      await stop();
    } else {
      await start();
    }
  };

  const statusLabel = useMemo(() => {
    if (status === "idle") return "Listo";
    if (status === "starting") return "Iniciando…";
    if (status === "in_call") return "En llamada";
    return "Procesando…";
  }, [status]);

  return (
    <section className="card">
      <div className="cardHeader">
        <div className="titleBlock">
          <h2>Voz (Web Call)</h2>
          <div className="meta">
            <span className="pill">Estado: {statusLabel}</span>
            <span className="pill">call_id: {callId ?? "—"}</span>
            <span className="pill">evento: {bestEvent ?? "—"}</span>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="pill">Agente</span>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="pill"
            style={{
              background: "rgba(255,255,255,0.03)",
              color: "rgba(255,255,255,0.92)",
              outline: "none",
              cursor: "pointer",
            }}
            disabled={status !== "idle"} // para no cambiar en medio de la llamada
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id} style={{ color: "#0b0c10" }}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn primary"
          onClick={handleStartOrStop}
          disabled={status === "starting"}
        >
          {status === "in_call" ? "Finalizar" : "Iniciar voz"}
        </button>
      </div>

      <div className="grid">
        <div className="panel">
          <div className="panelHeader">
            <span>Transcripción realtime</span>
            <span>{segments.length}</span>
          </div>

          <div ref={transcriptRef} className="scroll">
            {segments.map((s) => (
              <div key={s.id} className="bubbleRow">
                <div className="roleTag">{s.speaker}</div>
                <div className="bubble">{s.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panelHeader">
            <span>Post Call Metrics</span>
          </div>

          <div className="metricsGrid">
            <div className="metric">
              <div className="k">Duración</div>
              <div className="v">{duration}</div>
            </div>

            <div className="metric">
              <div className="k">Eventos</div>
              <div className="v">{eventsCount ?? "—"}</div>
            </div>

            <div className="metric">
              <div className="k">Call Successful</div>
              <div className="v">
                {successful === null ? "—" : successful ? "Sí" : "No"}
              </div>
            </div>

            <div className="metric">
              <div className="k">Sentiment</div>
              <div className="v">{sentiment ?? "—"}</div>
            </div>
          </div>

          <div className="summary">
            <div className="k">Call Summary</div>
            <div className="v">{summary ?? "—"}</div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(customFields).length > 0 ? (
                Object.entries(customFields).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{String(v)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}>—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 10, color: "red" }}>
          {error}
        </div>
      )}
    </section>
  );
}