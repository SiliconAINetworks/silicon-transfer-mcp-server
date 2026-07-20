/**
 * Verzeichnis-Werkzeuge: rename, upload_dir, download_dir.
 * Auch Verzeichnisse liefern Urteile - pro Datei, mit Mismatch-Liste.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ConnectionManager } from "../services/connection.js";
import { localSha256 } from "../services/proof.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(output: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
  };
}

function fail(err: unknown, hint: string): ToolResult {
  const msg = err instanceof Error ? err.message : String(err);
  const output = { error: msg, hint };
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
    isError: true,
  };
}

/** Alle Dateien unter dir, als relative Pfade mit / als Trenner. */
function walkLocal(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkLocal(full, base));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

export function registerDirTools(server: McpServer, cm: ConnectionManager): void {
  server.registerTool(
    "silicon_rename",
    {
      title: "Umbenennen / Verschieben",
      description: "Benennt eine Remote-Datei oder ein Verzeichnis um bzw. verschiebt es.",
      inputSchema: {
        fromPath: z.string().describe("Aktueller Remote-Pfad"),
        toPath: z.string().describe("Neuer Remote-Pfad"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ fromPath, toPath }) => {
      try {
        await cm.rename(fromPath, toPath);
        return ok({ status: "umbenannt", fromPath, toPath });
      } catch (e) {
        return fail(e, "Quelle vorhanden? Ziel frei? Rechte pruefen.");
      }
    }
  );

  server.registerTool(
    "silicon_upload_dir",
    {
      title: "Verzeichnis hochladen (mit Beweis-Wanderung)",
      description:
        "Laedt ein lokales Verzeichnis rekursiv hoch. Danach wird jede Datei einzeln verglichen: proof=hash prueft SHA-256 pro Datei (gruendlich, langsamer), proof=size vergleicht Groessen (schnell), none ueberspringt.",
      inputSchema: {
        localDir: z.string().describe("Lokales Quellverzeichnis"),
        remoteDir: z.string().describe("Remote-Zielverzeichnis"),
        proof: z.enum(["hash", "size", "none"]).default("size").describe("Beweisstufe pro Datei (Standard: size)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ localDir, remoteDir, proof }) => {
      try {
        const t0 = Date.now();
        const files = walkLocal(localDir);
        await cm.uploadDir(localDir, remoteDir);
        const mismatches: Array<Record<string, unknown>> = [];
        let checked = 0;

        if (proof !== "none") {
          for (const rel of files) {
            const lp = join(localDir, rel);
            const rp = `${remoteDir.replace(/\/$/, "")}/${rel}`;
            if (proof === "hash") {
              const [l, r] = await Promise.all([localSha256(lp), cm.remoteSha256(rp)]);
              checked++;
              if (l.sha256 !== r.sha256) mismatches.push({ file: rel, local_sha256: l.sha256, remote_sha256: r.sha256 });
            } else {
              const lb = statSync(lp).size;
              const rb = await cm.remoteSize(rp);
              checked++;
              if (lb !== rb) mismatches.push({ file: rel, local_bytes: lb, remote_bytes: rb });
            }
          }
        }
        const verdict =
          proof === "none" ? "UNVERIFIED" : mismatches.length === 0 ? (proof === "hash" ? "PROVEN" : "SIZE_MATCH") : "MISMATCH";
        return ok({
          localDir,
          remoteDir,
          files_total: files.length,
          files_checked: checked,
          duration_ms: Date.now() - t0,
          proof: { verdict, mismatches },
        });
      } catch (e) {
        return fail(e, "Lokales Verzeichnis vorhanden? Remote-Rechte? Bei grossen Baeumen proof=size nutzen.");
      }
    }
  );

  server.registerTool(
    "silicon_download_dir",
    {
      title: "Verzeichnis herunterladen (mit Beweis-Wanderung)",
      description:
        "Laedt ein Remote-Verzeichnis rekursiv herunter. Danach wird jede lokale Datei gegen die Remote-Quelle verglichen (hash/size/none, Standard size).",
      inputSchema: {
        remoteDir: z.string().describe("Remote-Quellverzeichnis"),
        localDir: z.string().describe("Lokales Zielverzeichnis"),
        proof: z.enum(["hash", "size", "none"]).default("size").describe("Beweisstufe pro Datei (Standard: size)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },

    async ({ remoteDir, localDir, proof }) => {
      try {
        const t0 = Date.now();
        await cm.downloadDir(remoteDir, localDir);
        const files = walkLocal(localDir);
        const mismatches: Array<Record<string, unknown>> = [];
        let checked = 0;
        if (proof !== "none") {
          for (const rel of files) {
            const lp = join(localDir, rel);
            const rp = `${remoteDir.replace(/\/$/, "")}/${rel}`;
            if (proof === "hash") {
              const [l, r] = await Promise.all([localSha256(lp), cm.remoteSha256(rp)]);
              checked++;
              if (l.sha256 !== r.sha256) mismatches.push({ file: rel, local_sha256: l.sha256, remote_sha256: r.sha256 });
            } else {
              const lb = statSync(lp).size;
              const rb = await cm.remoteSize(rp);
              checked++;
              if (lb !== rb) mismatches.push({ file: rel, local_bytes: lb, remote_bytes: rb });
            }
          }
        }
        const verdict =
          proof === "none" ? "UNVERIFIED" : mismatches.length === 0 ? (proof === "hash" ? "PROVEN" : "SIZE_MATCH") : "MISMATCH";
        return ok({
          remoteDir,
          localDir,
          files_total: files.length,
          files_checked: checked,
          duration_ms: Date.now() - t0,
          proof: { verdict, mismatches },
        });
      } catch (e) {
        return fail(e, "Remote-Verzeichnis vorhanden? Lokale Schreibrechte? Bei grossen Baeumen proof=size nutzen.");
      }
    }
  );
}
