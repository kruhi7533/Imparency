import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import {
  uploadPrivateFile,
  readPrivateFile,
  deletePrivateFile,
  isValidPrivateKey,
  privateStorageRoot,
} from "@/lib/storage";
import { detectRequirementFileType, safeDownloadName } from "@/lib/requirements/file-types";

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "csr-private-"));
  vi.stubEnv("PRIVATE_STORAGE_DIR", root);
  vi.stubEnv("PRIVATE_STORAGE_PROVIDER", "local");
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("private CSR document storage", () => {
  it("stores under a generated key outside public/ and reads it back", async () => {
    const bytes = Buffer.from("%PDF-1.4 confidential");
    const key = await uploadPrivateFile(bytes, ".pdf", "requirements");

    expect(key).toMatch(/^requirements\/[0-9a-f-]{36}\.pdf$/);
    const onDisk = path.join(root, key);
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(onDisk.startsWith(path.resolve(process.cwd(), "public"))).toBe(false);
    expect((await readPrivateFile(key)).equals(bytes)).toBe(true);

    await deletePrivateFile(key);
    expect(fs.existsSync(onDisk)).toBe(false);
  });

  it("rejects path traversal and anything that is not a generated key", async () => {
    for (const bad of ["../../etc/passwd", "requirements/../../secret.pdf", "/etc/passwd", "requirements/report.pdf", "public/x.pdf"]) {
      expect(isValidPrivateKey(bad)).toBe(false);
      await expect(readPrivateFile(bad)).rejects.toThrow("Invalid private storage key");
    }
    await expect(uploadPrivateFile(Buffer.from("x"), ".pdf", "../evil")).rejects.toThrow();
    await expect(uploadPrivateFile(Buffer.from("x"), ".pdf/../../x", "requirements")).rejects.toThrow();
  });

  it("refuses a private directory inside public/", () => {
    vi.stubEnv("PRIVATE_STORAGE_DIR", path.join(process.cwd(), "public", "uploads", "private"));
    expect(() => privateStorageRoot()).toThrow(/must not be inside public/);
    vi.stubEnv("PRIVATE_STORAGE_DIR", root);
  });
});

describe("CSR upload type validation", () => {
  it("accepts files whose content matches the extension", () => {
    expect(detectRequirementFileType("rfp.pdf", Buffer.from("%PDF-1.7 ..."))).toEqual({ ext: "pdf", mime: "application/pdf" });
    expect(detectRequirementFileType("rfp.DOCX", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]))?.ext).toBe("docx");
    expect(detectRequirementFileType("scan.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe("image/png");
    expect(detectRequirementFileType("scan.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
  });

  it("rejects renamed or unsupported files regardless of the claimed type", () => {
    expect(detectRequirementFileType("rfp.pdf", Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
    expect(detectRequirementFileType("payload.exe", Buffer.from("MZ..."))).toBeNull();
    expect(detectRequirementFileType("image.svg", Buffer.from("<svg/>"))).toBeNull();
  });

  it("never lets a stored filename break the Content-Disposition header", () => {
    const n = safeDownloadName('evil"\r\nSet-Cookie: x=1.pdf');
    expect(n.ascii).not.toMatch(/["\r\n]/);
  });
});
