// app/VoiceDemo.tsx
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

/**
 * iOS/Safari + algunos Android bloquean audio hasta "unlock" explícito
 * en el mismo gesto del usuario. Esto reduce muchísimo casos de:
 * - se ve transcripción pero no se oye / no te oye
 */
async function unlockAudio() {
  try {
    const AudioCtx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();

    // Reanudar explícitamente
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    // "Beep" ultra-silencioso para habilitar output
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.01);

    // no cerramos ctx a propósito: en algunos iOS cerrar rompe el unlock
  } catch {
    // ignore
  }
}

/**
 * Probe del mic: si esto falla => permisos / https / política browser
 */
async function probeMicOnce() {
  if (!navigator?.mediaDevices?.getUserMedia) {
    throw new Error("El navegador no soporta getUserMedia(audio).");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // liberar
  stream.getTracks().forEach((t) => t.stop());
}

export default function VoiceDemo() {
  const clientRef = useRef<RetellWebClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<any>(null);
  const startLockRef = useRef(false);

  const [agents, setAgents] = useState<Array<{ id: string; label: string }>>(
    []
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  const [status, setStatus] = useState<
    "idle" | "starting" | "in_call" | "processing"
  >("idle");
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
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
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
      typeof durMs === "number" && durMs > 0 ? formatDurationMs(durMs) : "—"
    );

    const ca = data?.call_analysis ?? null;

    setSummary(ca?.call_summary ?? null);
    setSentiment(ca?.user_sentiment ?? null);
    setSuccessful(
      typeof ca?.call_successful === "boolean" ? ca.call_successful : null
    );
    setCustomFields(ca?.custom_analysis_data ?? {});
  }

  function startPolling(id: string) {
    stopPolling();

    const startedAt = Date.now();
    pollTimerRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/calls/${id}`, { cache: "no-store" });
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
        const speakerRaw =
          u?.speaker ??
          u?.from ??
          u?.role ??
          (u?.is_agent ? "agent" : u?.is_user ? "user" : "system");

        const speaker: Segment["speaker"] =
          speakerRaw === "agent"
            ? "agent"
            : speakerRaw === "user"
            ? "user"
            : "system";

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

        // IMPORTANT: evitar "[object Object]"
        if (text && typeof text !== "string") {
          try {
            text = JSON.stringify(text);
          } catch {
            text = String(text);
          }
        }

        text = String(text ?? "").trim();
        if (!text) return;

        const inferredSpeaker: Segment["speaker"] =
          role === "agent" ? "agent" : role === "user" ? "user" : speaker;

        setSegments((prev) => {
          const last = prev[prev.length - 1];

          if (last && last.speaker === inferredSpeaker) {
            const newerLooksLikeUpdate =
              text.includes(last.text) ||
              last.text.includes(text) ||
              text.length >= last.text.length;

            if (newerLooksLikeUpdate) {
              return [...prev.slice(0, -1), { ...last, text, ts: now() }];
            }
          }

          return [
            ...prev,
            {
              id: `${now()}-${Math.random()}`,
              speaker: inferredSpeaker,
              text,
              ts: now(),
            },
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

    setError(null);
    setSegments([]);
    resetPostCall();
    setCallId(null);
    callIdRef.current = null;
    setStatus("starting");

    try {
      // ✅ 1) Unlock audio (iOS)
      await unlockAudio();

      // ✅ 2) Probe mic (permiso real)
      await probeMicOnce();

      // ✅ 3) Crear llamada
      const resp = await fetch("/api/create-web-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: selectedAgentId }),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`create-web-call failed: ${resp.status} ${t}`);
      }

      const { access_token, call_id } = await resp.json();

      if (!access_token) throw new Error("Missing access_token");
      if (!call_id) throw new Error("Missing call_id");

      callIdRef.current = call_id;
      setCallId(call_id);

      // ✅ 4) Start call
      const client = clientRef.current;
      if (!client) throw new Error("Retell client not ready");

      await client.startCall({ accessToken: access_token });
    } catch (e: any) {
      // Errores típicos: NotAllowedError / NotFoundError / NotReadableError
      const msg = String(e?.message ?? e ?? "Error");

      // Mensaje más útil para mobile
      if (
        /NotAllowedError|Permission|denied|Permission denied/i.test(msg)
      ) {
        setError(
          "El navegador bloqueó el micrófono. En iPhone: Ajustes → Safari → Micrófono (Permitir) y recargá la página. En Chrome: candado → Permisos → Micrófono."
        );
      } else if (/NotFoundError/i.test(msg)) {
        setError(
          "No se encontró micrófono disponible (o está ocupado). Probá desconectar BT/auriculares y reintentar."
        );
      } else {
        setError(msg);
      }

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
    if (status === "in_call") await stop();
    else await start();
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

        {/* ✅ agrupar selector + botón para que en mobile sean 2 filas prolijas */}
        <div className="headerActions">
          <div className="toolbar">
            <span className="pill">Agente</span>

            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="agentSelect"
              disabled={status !== "idle"}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
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
                    <td style={{ whiteSpace: "pre-wrap" }}>{String(v)}</td>
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

      {error && <div className="errorBanner">{error}</div>}
    </section>
  );
}