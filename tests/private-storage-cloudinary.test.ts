import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * D2 root cause (acceptance v2): with STORAGE_PROVIDER=cloudinary, private
 * uploads (field-evidence photos) silently fell back to LOCAL disk, which is
 * read-only on the serverless host — every photo sync died with EROFS and the
 * route answered a generic 500. These tests pin:
 *   1. cloudinary is a private provider: authenticated raw upload, no local write;
 *   2. reads go through a short-lived signed download URL, server-side;
 *   3. a local write that cannot happen is a StorageError with a code.
 */

const cld = vi.hoisted(() => ({
  upload_stream: vi.fn(),
  destroy: vi.fn().mockResolvedValue({ result: "ok" }),
  private_download_url: vi.fn((id: string) => `https://api.cloudinary.com/v1_1/test/raw/download?public_id=${encodeURIComponent(id)}&signature=x`),
}));
vi.mock("cloudinary", () => ({
  v2: { config: vi.fn(), uploader: { upload_stream: cld.upload_stream, destroy: cld.destroy }, utils: { private_download_url: cld.private_download_url } },
}));

const fsMock = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn(), readFile: vi.fn(), unlink: vi.fn() }));
vi.mock("fs/promises", () => ({ default: fsMock, ...fsMock }));

import { uploadPrivateFile, readPrivateFile, deletePrivateFile, privateProvider, StorageError, isStorageError } from "@/lib/storage";

const KEY_RE = /^field-evidence\/[0-9a-f-]{36}\.jpg$/;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  cld.upload_stream.mockImplementation((opts: any, cb: any) => ({ end: () => cb(null, { public_id: opts.public_id }) }));
});
afterEach(() => vi.unstubAllEnvs());

function cloudinaryEnv() {
  vi.stubEnv("STORAGE_PROVIDER", "cloudinary");
  vi.stubEnv("PRIVATE_STORAGE_PROVIDER", "");
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "c");
  vi.stubEnv("CLOUDINARY_API_KEY", "k");
  vi.stubEnv("CLOUDINARY_API_SECRET", "s");
}

describe("private storage on Cloudinary (staging configuration)", () => {
  it("STORAGE_PROVIDER=cloudinary makes cloudinary the PRIVATE provider (was: local disk)", () => {
    cloudinaryEnv();
    expect(privateProvider()).toBe("cloudinary");
  });

  it("uploads as an authenticated raw asset and never touches the local filesystem", async () => {
    cloudinaryEnv();
    // Simulate the read-only serverless filesystem: any local write would throw.
    fsMock.mkdir.mockRejectedValue(Object.assign(new Error("EROFS"), { code: "EROFS" }));
    const key = await uploadPrivateFile(JPEG, ".jpg", "field-evidence");
    expect(key).toMatch(KEY_RE);
    const opts = cld.upload_stream.mock.calls[0][0];
    expect(opts).toMatchObject({ resource_type: "raw", type: "authenticated", public_id: `private-files/${key}` });
    expect(fsMock.mkdir).not.toHaveBeenCalled();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("a Cloudinary failure is a retryable STORAGE_UPLOAD_FAILED, not a raw error", async () => {
    cloudinaryEnv();
    cld.upload_stream.mockImplementation((_o: any, cb: any) => ({ end: () => cb({ http_code: 500, message: "boom" }) }));
    const err = await uploadPrivateFile(JPEG, ".jpg", "field-evidence").catch((e) => e);
    expect(isStorageError(err)).toBe(true);
    expect(err).toMatchObject({ code: "STORAGE_UPLOAD_FAILED", retryable: true });
  });

  it("bad credentials are STORAGE_NOT_CONFIGURED", async () => {
    cloudinaryEnv();
    cld.upload_stream.mockImplementation((_o: any, cb: any) => ({ end: () => cb({ http_code: 401, message: "Invalid api_key" }) }));
    await expect(uploadPrivateFile(JPEG, ".jpg", "field-evidence")).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED" });
  });

  it("missing credentials refuse before any network call", async () => {
    cloudinaryEnv();
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    await expect(uploadPrivateFile(JPEG, ".jpg", "field-evidence")).rejects.toMatchObject({ code: "STORAGE_NOT_CONFIGURED" });
    expect(cld.upload_stream).not.toHaveBeenCalled();
  });

  it("reads through a short-lived signed private download URL (server-side only)", async () => {
    cloudinaryEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([9, 8, 7]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const key = "field-evidence/00000000-0000-0000-0000-000000000000.jpg";
    const bytes = await readPrivateFile(key);
    expect(Array.from(bytes)).toEqual([9, 8, 7]);
    const [publicId, format, opts] = cld.private_download_url.mock.calls[0] as any[];
    expect(publicId).toBe(`private-files/${key}`);
    expect(format).toBe("");
    expect(opts).toMatchObject({ resource_type: "raw", type: "authenticated" });
    expect(opts.expires_at).toBeGreaterThan(Date.now() / 1000);
    expect(opts.expires_at).toBeLessThanOrEqual(Date.now() / 1000 + 120);
    vi.unstubAllGlobals();
  });

  it("a missing asset is STORAGE_NOT_FOUND", async () => {
    cloudinaryEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await expect(readPrivateFile("field-evidence/00000000-0000-0000-0000-000000000000.jpg")).rejects.toMatchObject({ code: "STORAGE_NOT_FOUND" });
    vi.unstubAllGlobals();
  });

  it("deletes the authenticated asset", async () => {
    cloudinaryEnv();
    await deletePrivateFile("field-evidence/00000000-0000-0000-0000-000000000000.jpg");
    expect(cld.destroy).toHaveBeenCalledWith(
      "private-files/field-evidence/00000000-0000-0000-0000-000000000000.jpg",
      expect.objectContaining({ resource_type: "raw", type: "authenticated" }),
    );
  });

  it("rejects keys this module did not generate (no traversal)", async () => {
    cloudinaryEnv();
    await expect(readPrivateFile("../secrets.jpg")).rejects.toThrow("Invalid private storage key");
  });
});

describe("private storage on local disk", () => {
  it("a read-only filesystem (the old staging failure) is STORAGE_NOT_CONFIGURED, not a raw EROFS", async () => {
    vi.stubEnv("PRIVATE_STORAGE_PROVIDER", "local");
    fsMock.mkdir.mockRejectedValue(Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" }));
    const err = await uploadPrivateFile(JPEG, ".jpg", "field-evidence").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err.code).toBe("STORAGE_NOT_CONFIGURED");
    expect(err.message).not.toMatch(/\/var\/task|\/Users\//);
  });

  it("a transient write failure is retryable STORAGE_UPLOAD_FAILED", async () => {
    vi.stubEnv("PRIVATE_STORAGE_PROVIDER", "local");
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockRejectedValue(Object.assign(new Error("EIO"), { code: "EIO" }));
    await expect(uploadPrivateFile(JPEG, ".jpg", "field-evidence")).rejects.toMatchObject({ code: "STORAGE_UPLOAD_FAILED", retryable: true });
  });
});
