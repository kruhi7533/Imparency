import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("cloudinary", () => {
  const upload_stream = vi.fn((opts: any, cb: any) => ({
    end: (buf: Buffer) => {
      cb(null, {
        public_id: opts.public_id,
        resource_type: opts.resource_type || "auto",
        type: opts.type || "upload",
        secure_url: `https://res.cloudinary.com/test/${opts.resource_type || "image"}/${opts.type || "upload"}/v1/${opts.public_id}`,
      });
    },
  }));
  const destroy = vi.fn().mockResolvedValue({ result: "ok" });
  const private_download_url = vi.fn((id: string, format: string, opts: any) => {
    return `https://api.cloudinary.com/v1_1/test/raw/download?public_id=${encodeURIComponent(id)}`;
  });

  return {
    v2: {
      config: vi.fn(),
      uploader: { upload_stream, destroy },
      utils: { private_download_url },
    },
  };
});

import { uploadFile, readPrivateDocument, deleteFile, PRIVATE_UPLOAD_ROOT } from "@/lib/storage";
import { v2 as cloudinary } from "cloudinary";

describe("Cloudinary private file upload and delivery", () => {
  const origEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...origEnv,
      STORAGE_PROVIDER: "cloudinary",
      CLOUDINARY_CLOUD_NAME: "test-cloud",
      CLOUDINARY_API_KEY: "test-key",
      CLOUDINARY_API_SECRET: "test-secret",
    };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("uploads private documents to Cloudinary as authenticated raw assets and returns /api/documents/ path", async () => {
    const file = Buffer.from("%PDF-1.4 sample");
    const resultUrl = await uploadFile(file, "certificate.pdf", "documents", { private: true });

    expect(resultUrl).toMatch(/^\/api\/documents\/documents\/[0-9a-f-]{36}\.pdf$/);
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        public_id: expect.stringMatching(new RegExp(`^${PRIVATE_UPLOAD_ROOT}/documents/[0-9a-f-]{36}\\.pdf$`)),
        resource_type: "raw",
        type: "authenticated",
      }),
      expect.any(Function)
    );
  });

  it("uploads public files to Cloudinary normally and returns secure_url", async () => {
    const file = Buffer.from("image bytes");
    const resultUrl = await uploadFile(file, "cover.jpg", "covers");

    expect(resultUrl).toContain("https://res.cloudinary.com");
    expect(cloudinary.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: "auto",
      }),
      expect.any(Function)
    );
  });

  it("deletes private Cloudinary assets using authenticated type", async () => {
    const docUrl = "/api/documents/documents/12345678-1234-1234-1234-123456789abc.pdf";
    await deleteFile(docUrl);

    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
      `${PRIVATE_UPLOAD_ROOT}/documents/12345678-1234-1234-1234-123456789abc.pdf`,
      { resource_type: "raw", type: "authenticated" }
    );
  });
});
