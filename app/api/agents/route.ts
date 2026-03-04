import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type AgentItem = { id: string; label: string };

function loadAgents(): AgentItem[] {
  const filePath = path.join(process.cwd(), "config", "agents.txt");
  const raw = fs.readFileSync(filePath, "utf8");

  const items: AgentItem[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;

    const parts = t.split("|");
    const id = (parts[0] ?? "").trim();
    const label = (parts[1] ?? "").trim();

    if (!id) continue;
    items.push({ id, label: label || id });
  }
  return items;
}

export async function GET() {
  try {
    const agents = loadAgents();
    return NextResponse.json({ agents }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "No se pudo leer config/agents.txt", detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}