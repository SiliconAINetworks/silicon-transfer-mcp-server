/**
 * Beweis-Maschine: erst beweisen, dann behaupten.
 * Jeder Transfer bekommt sein Urteil - PROVEN nur bei identischem SHA-256.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export type ProofMode = "hash" | "size" | "none";
export type Verdict = "PROVEN" | "SIZE_MATCH" | "UNVERIFIED" | "MISMATCH";

export interface TransferProof {
  verdict: Verdict;
  detail: string;
  local_sha256?: string;
  remote_sha256?: string;
  local_bytes?: number;
  remote_bytes?: number;
}

export function localSha256(path: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const rs = createReadStream(path);
    rs.on("data", (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    rs.on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
    rs.on("error", reject);
  });
}

export function judge(
  local: { sha256?: string; bytes?: number },
  remote: { sha256?: string; bytes?: number },
  mode: ProofMode
): TransferProof {
  if (mode === "none") {
    return { verdict: "UNVERIFIED", detail: "Beweis abgewaehlt (proof=none) - Transfer ohne Urteil." };
  }
  if (mode === "size") {
    const ok = local.bytes !== undefined && local.bytes === remote.bytes;
    return {
      verdict: ok ? "SIZE_MATCH" : "MISMATCH",
      detail: ok
        ? `Groessen identisch (${local.bytes} Bytes) - schwacher Beweis, fuer harte Faelle proof=hash nutzen.`
        : `Groessen weichen ab: lokal ${local.bytes} vs remote ${remote.bytes} Bytes.`,
      local_bytes: local.bytes,
      remote_bytes: remote.bytes,
    };
  }
  const ok = !!local.sha256 && local.sha256 === remote.sha256;
  return {
    verdict: ok ? "PROVEN" : "MISMATCH",
    detail: ok
      ? "SHA-256 identisch - Transfer bewiesen."
      : "SHA-256 weicht ab - Transfer NICHT vertrauen, erneut uebertragen.",
    local_sha256: local.sha256,
    remote_sha256: remote.sha256,
    local_bytes: local.bytes,
    remote_bytes: remote.bytes,
  };
}
