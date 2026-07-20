/**
 * Werkzeug-Registratur: alle Silicon-Transfer-Tools an den MCP-Server anmelden.
 * Transfers liefern ihr Urteil (proof) direkt im Ergebnis mit.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectionManager } from "../services/connection.js";
import { localSha256, judge, type ProofMode } from "../services/proof.js";

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

const proofSchema = z
  .enum(["hash", "size", "none"])
  .default("hash")
  .describe("Beweisstufe: hash = SHA-256-Rueckvergleich (Standard), size = nur Groesse, none = ohne Urteil");

export function registerAll(server: McpServer, cm: ConnectionManager): void {
  server.registerTool(
    "silicon_connect",
    {
      title: "Verbindung aufbauen",
      description:
        "Verbindet zu einem FTP-, FTPS- oder SFTP-Server. SFTP unterstuetzt Passwort oder SSH-Key (privateKeyPath).",
      inputSchema: {
        protocol: z.enum(["ftp", "ftps", "sftp"]).describe("Uebertragungsprotokoll"),
        host: z.string().describe("Hostname oder IP"),
        port: z.number().int().optional().describe("Port (Standard: 21 fuer ftp/ftps, 22 fuer sftp)"),
        username: z.string().describe("Benutzername"),
        password: z.string().optional().describe("Passwort (bei SSH-Key optional)"),
        privateKeyPath: z.string().optional().describe("Pfad zu einem privaten SSH-Key (nur sftp)"),
        passphrase: z.string().optional().describe("Passphrase des SSH-Keys, falls verschluesselt"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (a) => {
      try {
        await cm.connect(a);
        return ok({ status: "verbunden", target: cm.target });
      } catch (e) {
        return fail(e, "Host, Port, Zugangsdaten und Protokoll pruefen.");
      }
    }
  );

  server.registerTool(
    "silicon_disconnect",
    {
      title: "Verbindung trennen",
      description: "Trennt die aktive Verbindung sauber.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const was = cm.target;
      await cm.disconnect();
      return ok({ status: "getrennt", war: was });
    }
  );

  server.registerTool(
    "silicon_status",
    {
      title: "Verbindungsstatus",
      description: "Zeigt, ob und wohin aktuell eine Verbindung besteht.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ok({ verbunden: cm.connected, target: cm.target })
  );

  server.registerTool(
    "silicon_list_dir",
    {
      title: "Verzeichnis auflisten",
      description: "Listet ein Remote-Verzeichnis mit Typ, Groesse und Aenderungsdatum.",
      inputSchema: { path: z.string().describe("Remote-Pfad, z.B. /home/user/www") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ path }) => {
      try {
        const entries = await cm.list(path);
        return ok({ path, count: entries.length, entries });
      } catch (e) {
        return fail(e, "Pfad pruefen; fuehrender / noetig? Verbindung aktiv?");
      }
    }
  );

  server.registerTool(
    "silicon_upload_file",
    {
      title: "Datei hochladen (mit Beweis)",
      description:
        "Laedt eine lokale Datei hoch und liefert das Transfer-Urteil mit: PROVEN nur, wenn der SHA-256 der Remote-Datei nach dem Upload dem lokalen entspricht.",
      inputSchema: {
        localPath: z.string().describe("Lokaler Quellpfad"),
        remotePath: z.string().describe("Remote-Zielpfad inkl. Dateiname"),
        proof: proofSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ localPath, remotePath, proof }) => {
      try {
        const t0 = Date.now();
        const local = await localSha256(localPath);
        await cm.upload(localPath, remotePath);
        const remote =
          proof === "hash"
            ? await cm.remoteSha256(remotePath)
            : proof === "size"
              ? { sha256: undefined, bytes: await cm.remoteSize(remotePath) }
              : { sha256: undefined, bytes: undefined };
        const urteil = judge(local, remote, proof as ProofMode);
        return ok({ localPath, remotePath, duration_ms: Date.now() - t0, proof: urteil });
      } catch (e) {
        return fail(e, "Lokalen Pfad, Remote-Rechte und Verbindung pruefen.");
      }
    }
  );

  server.registerTool(
    "silicon_download_file",
    {
      title: "Datei herunterladen (mit Beweis)",
      description:
        "Laedt eine Remote-Datei herunter und liefert das Transfer-Urteil mit: PROVEN nur bei identischem SHA-256 zwischen Remote-Quelle und lokaler Kopie.",
      inputSchema: {
        remotePath: z.string().describe("Remote-Quellpfad"),
        localPath: z.string().describe("Lokaler Zielpfad inkl. Dateiname"),
        proof: proofSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ remotePath, localPath, proof }) => {
      try {
        const t0 = Date.now();
        await cm.download(remotePath, localPath);
        const local = await localSha256(localPath);
        const remote =
          proof === "hash"
            ? await cm.remoteSha256(remotePath)
            : proof === "size"
              ? { sha256: undefined, bytes: await cm.remoteSize(remotePath) }
              : { sha256: undefined, bytes: undefined };
        const urteil = judge(local, remote, proof as ProofMode);
        return ok({ remotePath, localPath, duration_ms: Date.now() - t0, proof: urteil });
      } catch (e) {
        return fail(e, "Remote-Pfad, lokale Schreibrechte und Verbindung pruefen.");
      }
    }
  );

  server.registerTool(
    "silicon_delete_file",
    {
      title: "Remote-Datei loeschen",
      description: "Loescht eine Datei auf dem Server. Endgueltig - vorher mit silicon_list_dir pruefen.",
      inputSchema: { remotePath: z.string().describe("Remote-Pfad der zu loeschenden Datei") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ remotePath }) => {
      try {
        await cm.remove(remotePath);
        return ok({ status: "geloescht", remotePath });
      } catch (e) {
        return fail(e, "Existiert die Datei? Rechte vorhanden?");
      }
    }
  );

  server.registerTool(
    "silicon_make_dir",
    {
      title: "Remote-Verzeichnis anlegen",
      description: "Legt ein Verzeichnis auf dem Server an (rekursiv moeglich).",
      inputSchema: {
        remotePath: z.string().describe("Anzulegender Remote-Pfad"),
        recursive: z.boolean().default(true).describe("Elternverzeichnisse mit anlegen"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ remotePath, recursive }) => {
      try {
        await cm.mkdir(remotePath, recursive);
        return ok({ status: "angelegt", remotePath });
      } catch (e) {
        return fail(e, "Rechte pruefen; existiert der Pfad bereits?");
      }
    }
  );

  server.registerTool(
    "silicon_file_info",
    {
      title: "Datei-Steckbrief",
      description: "Groesse und SHA-256 einer Remote-Datei - der Fingerabdruck ohne Download auf Platte.",
      inputSchema: { remotePath: z.string().describe("Remote-Pfad der Datei") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ remotePath }) => {
      try {
        const r = await cm.remoteSha256(remotePath);
        return ok({ remotePath, bytes: r.bytes, sha256: r.sha256 });
      } catch (e) {
        return fail(e, "Existiert die Datei? Verbindung aktiv?");
      }
    }
  );
}
