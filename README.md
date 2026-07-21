# Silicon Transfer MCP Server

[![npm version](https://img.shields.io/npm/v/silicon-transfer-mcp-server.svg)](https://www.npmjs.com/package/silicon-transfer-mcp-server) [![npm downloads](https://img.shields.io/npm/dm/silicon-transfer-mcp-server.svg)](https://www.npmjs.com/package/silicon-transfer-mcp-server) [![license](https://img.shields.io/npm/l/silicon-transfer-mcp-server.svg)](./LICENSE) [![node](https://img.shields.io/node/v/silicon-transfer-mcp-server.svg)](https://nodejs.org)

**FTP / FTPS / SFTP for Claude and other MCP clients - with built-in transfer proofs.**

Every upload and download returns a verdict: `PROVEN` only when the SHA-256 of the
remote file matches your local file. No more "transfer complete" on blind trust.

> Philosophy: *prove it, then claim it.* Built from scratch by
> [Silicon Networks](https://siliconnetworks.ch) - the makers of [AEGIS Shield](https://aegis888.com).

## Why this one?

| | Typical FTP tools | Silicon Transfer |
|---|---|---|
| Upload result | "done" | verdict + SHA-256 of both sides |
| Directory sync check | manual | per-file proof walk with mismatch list |
| Remote file fingerprint | download first | streamed SHA-256, no disk contact |
| Protocols | often FTP only | FTP, FTPS, SFTP (password or SSH key) |

## Tools (13)

**Connection:** `silicon_connect`, `silicon_disconnect`, `silicon_status`, `silicon_server_info`
**Files:** `silicon_upload_file`, `silicon_download_file`, `silicon_delete_file`, `silicon_file_info`
**Directories:** `silicon_list_dir`, `silicon_make_dir`, `silicon_upload_dir`, `silicon_download_dir`, `silicon_rename`

Transfers accept `proof: "hash" | "size" | "none"` - hash is the default for single
files, size for directory trees (switch to hash when it matters).

## Install

```bash
npm install -g silicon-transfer-mcp-server
```

That's it - [live on npm](https://www.npmjs.com/package/silicon-transfer-mcp-server). Or run it without installing via `npx` (see config below).

<details>
<summary>From source</summary>

```bash
git clone https://github.com/SiliconAINetworks/silicon-transfer-mcp-server.git
cd silicon-transfer-mcp-server
npm install
npm run build
```
</details>

## Claude Desktop configuration

Add to your `claude_desktop_config.json` (no credentials in the config - you pass
them at runtime through `silicon_connect`, for **your own server**):

```json
{
  "mcpServers": {
    "silicon-transfer": {
      "command": "npx",
      "args": ["-y", "silicon-transfer-mcp-server"]
    }
  }
}
```

<details>
<summary>Running from source instead</summary>

```json
{
  "mcpServers": {
    "silicon-transfer": {
      "command": "node",
      "args": ["C:/path/to/silicon-transfer-mcp-server/dist/index.js"]
    }
  }
}
```
</details>

## Usage example

Ask your AI assistant:

> "Connect to my server via SFTP (host example.com, user deploy, key at ~/.ssh/id_ed25519)
> and upload dist/app.js to /var/www/app.js - with hash proof."

The assistant calls `silicon_connect`, then `silicon_upload_file` and answers with the
verdict:

```json
{
  "proof": {
    "verdict": "PROVEN",
    "detail": "SHA-256 identisch - Transfer bewiesen.",
    "local_sha256": "9f2a...",
    "remote_sha256": "9f2a..."
  }
}
```

If the hashes ever differ you get `MISMATCH` with both fingerprints - retry instead
of trusting a broken deploy.

## Security notes

- Credentials are **runtime-only tool parameters** for your own server. This project
  ships no server addresses, no defaults, no config files with secrets.
- SFTP supports password or private key (`privateKeyPath`).
- `silicon_delete_file` is destructive - list first, delete second.

## License

MIT (c) 2026 Silicon Networks. Built from scratch - single-author codebase.
