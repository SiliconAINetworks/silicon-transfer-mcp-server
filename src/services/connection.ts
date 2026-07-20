/**
 * Verbindungs-Schicht: FTP / FTPS / SFTP hinter einer einheitlichen Fassade.
 * Ein aktiver Kanal pro Server-Instanz - bewusst simpel, bewusst nachvollziehbar.
 */
import { Client as FtpClient } from "basic-ftp";
import SftpClient from "ssh2-sftp-client";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";

export type Protocol = "ftp" | "ftps" | "sftp";

export interface ConnectOptions {
  protocol: Protocol;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

export interface RemoteEntry {
  name: string;
  type: "file" | "dir" | "link";
  size: number;
  modifiedAt?: string;
}

export class ConnectionManager {
  private ftp: FtpClient | null = null;
  private sftp: SftpClient | null = null;
  private opts: ConnectOptions | null = null;

  get connected(): boolean {
    return this.ftp !== null || this.sftp !== null;
  }

  get target(): string {
    if (!this.opts) return "nicht verbunden";
    const p = this.opts.port ?? (this.opts.protocol === "sftp" ? 22 : 21);
    return `${this.opts.protocol}://${this.opts.username}@${this.opts.host}:${p}`;
  }

  async connect(o: ConnectOptions): Promise<void> {
    await this.disconnect();
    if (o.protocol === "sftp") {
      const c = new SftpClient();
      await c.connect({
        host: o.host,
        port: o.port ?? 22,
        username: o.username,
        password: o.password,
        privateKey: o.privateKeyPath ? readFileSync(o.privateKeyPath) : undefined,
      });
      this.sftp = c;
    } else {
      const c = new FtpClient();
      await c.access({
        host: o.host,
        port: o.port ?? 21,
        user: o.username,
        password: o.password,
        secure: o.protocol === "ftps",
      });
      this.ftp = c;
    }
    this.opts = o;
  }

  async disconnect(): Promise<void> {
    if (this.ftp) { this.ftp.close(); this.ftp = null; }
    if (this.sftp) { await this.sftp.end().catch(() => undefined); this.sftp = null; }
    this.opts = null;
  }

  private ensure(): void {
    if (!this.connected) {
      throw new Error("Keine aktive Verbindung - zuerst silicon_connect aufrufen.");
    }
  }

  async list(path: string): Promise<RemoteEntry[]> {
    this.ensure();
    if (this.sftp) {
      const entries = await this.sftp.list(path);
      return entries.map((e) => ({
        name: e.name,
        type: e.type === "d" ? "dir" : e.type === "l" ? "link" : "file",
        size: e.size,
        modifiedAt: new Date(e.modifyTime).toISOString(),
      }));
    }
    const entries = await this.ftp!.list(path);
    return entries.map((e) => ({
      name: e.name,
      type: e.isDirectory ? "dir" : e.isSymbolicLink ? "link" : "file",
      size: e.size,
      modifiedAt: e.modifiedAt ? e.modifiedAt.toISOString() : undefined,
    }));
  }

  async upload(localPath: string, remotePath: string): Promise<void> {
    this.ensure();
    if (this.sftp) { await this.sftp.fastPut(localPath, remotePath); return; }
    await this.ftp!.uploadFrom(localPath, remotePath);
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    this.ensure();
    if (this.sftp) { await this.sftp.fastGet(remotePath, localPath); return; }
    await this.ftp!.downloadTo(localPath, remotePath);
  }

  async remove(remotePath: string): Promise<void> {
    this.ensure();
    if (this.sftp) { await this.sftp.delete(remotePath); return; }
    await this.ftp!.remove(remotePath);
  }

  async mkdir(remotePath: string, recursive: boolean): Promise<void> {
    this.ensure();
    if (this.sftp) { await this.sftp.mkdir(remotePath, recursive); return; }
    await this.ftp!.ensureDir(remotePath);
    await this.ftp!.cd("/");
  }

  async remoteSize(remotePath: string): Promise<number> {
    this.ensure();
    if (this.sftp) {
      const s = await this.sftp.stat(remotePath);
      return s.size;
    }
    return this.ftp!.size(remotePath);
  }

  /**
   * Herzstueck der Beweis-DNA: liest die Remote-Datei als Strom zurueck
   * und berechnet ihren SHA-256 - ohne sie auf Platte zu speichern.
   */
  async remoteSha256(remotePath: string): Promise<{ sha256: string; bytes: number }> {
    this.ensure();
    const hash = createHash("sha256");
    let bytes = 0;
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        bytes += chunk.length;
        cb();
      },
    });
    if (this.sftp) {
      await this.sftp.get(remotePath, sink);
    } else {
      await this.ftp!.downloadTo(sink, remotePath);
    }
    return { sha256: hash.digest("hex"), bytes };
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    this.ensure();
    if (this.sftp) { await this.sftp.rename(fromPath, toPath); return; }
    await this.ftp!.rename(fromPath, toPath);
  }

  async uploadDir(localDir: string, remoteDir: string): Promise<void> {
    this.ensure();
    if (this.sftp) { await this.sftp.uploadDir(localDir, remoteDir); return; }
    await this.ftp!.uploadFromDir(localDir, remoteDir);
    await this.ftp!.cd("/");
  }

  async downloadDir(remoteDir: string, localDir: string): Promise<void> {
    this.ensure();
    if (this.sftp) { await this.sftp.downloadDir(remoteDir, localDir); return; }
    await this.ftp!.downloadToDir(localDir, remoteDir);
  }
}
