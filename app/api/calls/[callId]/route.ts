import { NextResponse } from "next/server";
import { getCallEvents } from "../../_store";

const PRIORITY = ["call_analyzed", "call_ended", "call_started", "transcript_updated"];

function score(eventName?: string) {
  const i = PRIORITY.indexOf(eventName ?? "");
  return i === -1 ? 999 : i;
}

function pickBest(events: any[]) {
  if (!events.length) return null;
  let best = events[0];
  for (const e of events) {
    const better = score(e.event) < score(best.event);
    const same = score(e.event) === score(best.event);
    if (better || (same && e.received_at > best.received_at)) best = e;
  }
  return best;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ callId: string }> }
) {
  const { callId } = await ctx.params;

  const events = getCallEvents(callId);
  if (!events.length) return NextResponse.json({ status: "pending" }, { status: 200 });

  const best = pickBest(events);

  // Preferimos SIEMPRE el call_analyzed para métricas
  const analyzedEvt = [...events].reverse().find((e) => e.event === "call_analyzed") ?? null;

  const analyzedPayload = analyzedEvt?.payload ?? null;
  const analyzedCall = analyzedPayload?.call ?? analyzedPayload ?? null;

  const bestPayload = best?.payload ?? null;
  const bestCall = bestPayload?.call ?? bestPayload ?? null;

  const c = analyzedCall ?? bestCall ?? null;

  const call_analysis = c?.call_analysis ?? null;

  const duration_ms =
    c?.duration_ms ??
    c?.durationMs ??
    (typeof c?.start_timestamp === "number" &&
    typeof c?.end_timestamp === "number" &&
    c.end_timestamp >= c.start_timestamp
      ? c.end_timestamp - c.start_timestamp
      : null);

  return NextResponse.json(
    {
      status: "ready",
      call_id: c?.call_id || bestCall?.call_id || callId,
      best_event: best?.event,
      analyzed_event_received_at: analyzedEvt?.received_at ?? null,

      // ✅ duración normalizada
      duration_ms: typeof duration_ms === "number" ? duration_ms : null,
      start_timestamp: typeof c?.start_timestamp === "number" ? c.start_timestamp : null,
      end_timestamp: typeof c?.end_timestamp === "number" ? c.end_timestamp : null,

      // ✅ métricas
      has_analysis: Boolean(call_analysis),
      call_analysis,

      // transcript (final)
      transcript: c?.transcript ?? null,
      transcript_object: c?.transcript_object ?? null,

      // debug
      events_count: events.length,
      events: events.map((e) => ({ event: e.event, received_at: e.received_at })),
    },
    { status: 200 }
  );
}