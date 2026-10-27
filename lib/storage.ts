import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Initialize S3 Client only if config is provided
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
  ...(process.env.AWS_ENDPOINT && { endpoint: process.env.AWS_ENDPOINT }), // Custom endpoint for Cloudflare R2
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** Where private uploads live. Deliberately NOT under `public/`. */
export const PRIVATE_UPLOAD_ROOT = "private-uploads";

/**
 * Uploads a file buffer to the configured storage provider (local, S3/R2, or Cloudinary).
 * Returns the URL of the uploaded file.
 *
 * Pass `{ private: true }` for anything that must not be world-readable —
 * NGO registration certificates, PAN/12A/80G, FCRA certificates, bank proofs.
 * A private upload is written OUTSIDE `public/` and addressed through
 * `/api/documents/...`, which checks the session before serving a byte.
 *
 * Without that flag, local uploads land in `public/uploads/` — and Next serves
 * everything under `public/` as a static asset with no authentication at all.
 * That is correct for project cover images and donor-facing proof photos, and
 * completely wrong for a scanned PAN card.
 */
export interface UploadOptions {
  /** Store outside the public web root and serve only through an authorised route. */
  private?: boolean;
}

export async function uploadFile(
  file: Buffer,
  originalName: string,
  folder: string,
  options: UploadOptions = {}
): Promise<string> {
  const ext = path.extname(originalName) || ".bin";
  const filename = `${uuidv4()}${ext}`;
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

  if (provider === "cloudinary") {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error(
        `STORAGE_PROVIDER is "cloudinary" but CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET are not fully set — refusing to upload to an unconfigured account.`
      );
    }

    if (options.private) {
      // Store confidential file as authenticated raw asset in Cloudinary
      // and serve only through authorised /api/documents route.
      const publicId = `${PRIVATE_UPLOAD_ROOT}/${folder}/${filename}`;
      await new Promise<any>((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            { public_id: publicId, resource_type: "raw", type: "authenticated" },
            (err, res) => (err || !res ? reject(err ?? new Error("Cloudinary upload returned no result")) : resolve(res))
          )
          .end(file);
      });

      // Best-effort local write for cache / dev environments
      try {
        const uploadDir = path.join(process.cwd(), PRIVATE_UPLOAD_ROOT, folder);
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, filename), file);
      } catch {
        // Ephemeral or read-only filesystem (e.g. Vercel)
      }

      return `/api/documents/${folder}/${filename}`;
    }

    const publicId = `${folder}/${filename.replace(ext, "")}`;
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { public_id: publicId, resource_type: "auto" },
          (err, res) => (err || !res ? reject(err ?? new Error("Cloudinary upload returned no result")) : resolve(res))
        )
        .end(file);
    });

    return result.secure_url;
  } else if (provider === "s3" || provider === "r2") {
    const bucketName = options.private ? privateBucket() : process.env.AWS_BUCKET_NAME;
    const cdnUrl = process.env.AWS_CDN_URL;

    if (!bucketName) {
      throw new Error(
        `STORAGE_PROVIDER is "${provider}" but AWS_BUCKET_NAME is not set — refusing to upload to an unconfigured bucket.`
      );
    }

    if (options.private) {
      const key = `${PRIVATE_UPLOAD_ROOT}/${folder}/${filename}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: file,
          ContentType: getContentType(ext),
        })
      );

      try {
        const uploadDir = path.join(process.cwd(), PRIVATE_UPLOAD_ROOT, folder);
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, filename), file);
      } catch {
        // Ephemeral or read-only filesystem
      }

      return `/api/documents/${folder}/${filename}`;
    }

    // R2 has no S3-style default public URL (unlike AWS S3), so without a
    // CDN/public URL configured, uploads would "succeed" but be unreachable.
    if (provider === "r2" && !cdnUrl) {
      throw new Error(
        `STORAGE_PROVIDER is "r2" but AWS_CDN_URL is not set — set it to your R2 public bucket URL (r2.dev subdomain or custom domain) so uploaded files are actually reachable.`
      );
    }

    const key = `${folder}/${filename}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file,
        ContentType: getContentType(ext),
      })
    );

    // Return custom CDN URL if defined, otherwise the region-qualified
    // virtual-hosted-style S3 URL (the region-less `bucket.s3.amazonaws.com`
    // form only reliably resolves for us-east-1 buckets).
    if (cdnUrl) {
      return `${cdnUrl.replace(/\/$/, "")}/${key}`;
    }
    const region = process.env.AWS_REGION || "us-east-1";
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  } else {
    // Default: Local Storage
    if (options.private) {
      // Outside public/ — unreachable by the static file server, so the only
      // way in is /api/documents, which authorises first.
      const uploadDir = path.join(process.cwd(), PRIVATE_UPLOAD_ROOT, folder);
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.writeFile(path.join(uploadDir, filename), file);
      return `/api/documents/${folder}/${filename}`;
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", folder);

    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });
    
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, file);

    return `/uploads/${folder}/${filename}`;
  }
}

/**
 * Reads a private document by its relative path under PRIVATE_UPLOAD_ROOT
 * (e.g. "documents/<uuid>.pdf").
 * Tries local disk first (for local storage or local cache), and falls back
 * to Cloudinary (authenticated download) or S3/R2.
 */
export async function readPrivateDocument(relativePath: string): Promise<Buffer> {
  const root = path.resolve(process.cwd(), PRIVATE_UPLOAD_ROOT);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Invalid document path traversal");
  }

  // 1. Try local disk first
  try {
    return await fs.readFile(resolved);
  } catch (err: any) {
    if (err && typeof err === "object" && err.code !== "ENOENT") throw err;
  }

  // 2. Cloudinary authenticated download
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (provider === "cloudinary") {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      const err: any = new Error("Cloudinary credentials not configured for private document retrieval");
      err.code = "ENOENT";
      throw err;
    }
    const publicId = `${PRIVATE_UPLOAD_ROOT}/${relativePath}`;
    const downloadUrl = cloudinary.utils.private_download_url(publicId, "", {
      resource_type: "raw",
      type: "authenticated",
    });
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      const notFoundErr: any = new Error(`Document not found on Cloudinary (${res.status})`);
      notFoundErr.code = "ENOENT";
      throw notFoundErr;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // 3. S3 / R2 download
  if (provider === "s3" || provider === "r2") {
    const key = `${PRIVATE_UPLOAD_ROOT}/${relativePath}`;
    try {
      const result = await s3Client.send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }));
      if (!result.Body) {
        const notFoundErr: any = new Error("Private file body empty in S3");
        notFoundErr.code = "ENOENT";
        throw notFoundErr;
      }
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (err: any) {
      if (err?.name === "NoSuchKey") {
        const notFoundErr: any = new Error("Document not found in S3");
        notFoundErr.code = "ENOENT";
        throw notFoundErr;
      }
      throw err;
    }
  }

  const notFoundErr: any = new Error("Document not found");
  notFoundErr.code = "ENOENT";
  throw notFoundErr;
}

/**
 * Deletes a file from the configured storage provider using its URL.
 */
export async function deleteFile(fileUrl: string): Promise<void> {
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

  if (fileUrl.startsWith("/api/documents/")) {
    const rel = fileUrl.slice("/api/documents/".length);
    const filePath = path.join(process.cwd(), PRIVATE_UPLOAD_ROOT, rel);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err && typeof err === "object" && err.code !== "ENOENT") {
        throw err;
      }
    }

    if (provider === "cloudinary") {
      try {
        const publicId = `${PRIVATE_UPLOAD_ROOT}/${rel}`;
        await cloudinary.uploader.destroy(publicId, { resource_type: "raw", type: "authenticated" });
      } catch (err) {
        console.error("Failed to delete private Cloudinary asset:", fileUrl, err);
      }
    } else if (provider === "s3" || provider === "r2") {
      try {
        const key = `${PRIVATE_UPLOAD_ROOT}/${rel}`;
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: privateBucket(),
            Key: key,
          })
        );
      } catch (err) {
        console.error("Failed to delete private S3 asset:", fileUrl, err);
      }
    }
    return;
  }

  if (provider === "cloudinary") {
    // e.g. https://res.cloudinary.com/<cloud>/image/upload/v.../folder/filename.jpg
    // or https://res.cloudinary.com/<cloud>/raw/authenticated/s--...--/v.../folder/filename
    try {
      const parsedUrl = new URL(fileUrl);
      const parts = parsedUrl.pathname.split("/");
      const versionIdx = parts.findIndex((p) => /^v\d+$/.test(p));
      if (versionIdx === -1) return;
      const publicIdWithExt = parts.slice(versionIdx + 1).join("/");
      const publicId = publicIdWithExt.replace(path.extname(publicIdWithExt), "");
      if (!publicId) return;
      const isAuthenticated = parts.includes("authenticated");
      const resourceType = ["image", "raw", "video"].includes(parts[2]) ? parts[2] : "image";
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        ...(isAuthenticated ? { type: "authenticated" } : {}),
      });
    } catch (err) {
      console.error("Failed to delete Cloudinary asset:", fileUrl, err);
    }
  } else if (provider === "s3" || provider === "r2") {
    const bucketName = process.env.AWS_BUCKET_NAME || "";
    
    // Extract key from URL
    // e.g. https://bucket.s3.amazonaws.com/folder/filename.jpg or https://cdn.com/folder/filename.jpg
    let key = "";
    try {
      const parsedUrl = new URL(fileUrl);
      const pathname = parsedUrl.pathname; // starts with "/"
      key = pathname.startsWith("/") ? pathname.substring(1) : pathname;
    } catch {
      // Fallback if URL is malformed or relative
      key = fileUrl.replace(/^\//, "");
    }

    if (!key) return;

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      })
    );
  } else {
    // Default: Local Storage
    // e.g. /uploads/folder/filename.jpg
    // Check if the URL is relative to public uploads
    if (fileUrl.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), "public", fileUrl);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        // If file already deleted or doesn't exist, ignore
        if (err && typeof err === "object" && "code" in err && err.code !== "ENOENT") {
          throw err;
        }
      }
    }
  }
}

// ─── Private document storage ────────────────────────────────────────────────
// For confidential documents (CSR/RFP files, field evidence photos). Unlike
// uploadFile(), nothing here ever produces a URL: callers get an opaque storage
// key, and bytes are only served through an authenticated route that checks
// ownership first.
//
//   local (default)  files under PRIVATE_STORAGE_DIR (default ./storage/private),
//                    outside public/ so Next.js never serves them statically
//   s3 / r2          objects in AWS_PRIVATE_BUCKET_NAME (falls back to
//                    AWS_BUCKET_NAME) — that bucket must not allow public reads
//   cloudinary       `type: "authenticated"`, `resource_type: "raw"` assets.
//                    Authenticated delivery has no public URL: bytes are fetched
//                    server-side with a short-lived signed download URL and
//                    streamed through the app's own authorised route.
//
// Provider: PRIVATE_STORAGE_PROVIDER, else STORAGE_PROVIDER when it is
// s3/r2/cloudinary, else local.
//
// D2 (acceptance v2): this used to fall back to LOCAL disk whenever
// STORAGE_PROVIDER was "cloudinary", because Cloudinary was not a private
// provider. On a serverless host the project directory is read-only, so every
// field-photo upload on staging died in fs.mkdir/writeFile (EROFS) and the
// route answered a generic 500 "Failed to sync capture" — while feedback-only
// syncs, which store no file, kept working. Cloudinary is now a first-class
// private provider, and a local write that cannot happen raises a
// StorageError with a code the route can report.

const PRIVATE_KEY_PATTERN = /^[a-z0-9-]+\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;
const PRIVATE_FOLDER_PATTERN = /^[a-z0-9-]+$/;
const PRIVATE_EXT_PATTERN = /^\.[a-z0-9]{1,8}$/;

/** Folder prefix for private Cloudinary assets, so they never mix with public ones. */
export const CLOUDINARY_PRIVATE_PREFIX = "private-files";

export type StorageErrorCode = "STORAGE_NOT_CONFIGURED" | "STORAGE_UPLOAD_FAILED" | "STORAGE_READ_FAILED" | "STORAGE_NOT_FOUND";

/**
 * A storage failure the caller can name to the client without leaking the
 * provider's raw message. `retryable` is true for transient provider errors.
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;
  constructor(code: StorageErrorCode, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export function isStorageError(err: unknown): err is StorageError {
  return err instanceof StorageError;
}

export type PrivateProvider = "local" | "s3" | "r2" | "cloudinary";

export function privateProvider(): PrivateProvider {
  const explicit = process.env.PRIVATE_STORAGE_PROVIDER?.toLowerCase();
  if (explicit === "local" || explicit === "s3" || explicit === "r2" || explicit === "cloudinary") return explicit;
  const general = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  return general === "s3" || general === "r2" || general === "cloudinary" ? general : "local";
}

function privateBucket(): string {
  const bucket = process.env.AWS_PRIVATE_BUCKET_NAME || process.env.AWS_BUCKET_NAME;
  if (!bucket) {
    throw new StorageError(
      "STORAGE_NOT_CONFIGURED",
      "Private storage is S3/R2 but neither AWS_PRIVATE_BUCKET_NAME nor AWS_BUCKET_NAME is set."
    );
  }
  return bucket;
}

function requireCloudinaryConfig(): void {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new StorageError(
      "STORAGE_NOT_CONFIGURED",
      "Private storage is Cloudinary but CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET are not fully set."
    );
  }
}

/** The Cloudinary public_id for a private key. Raw assets keep their extension. */
export function cloudinaryPrivatePublicId(key: string): string {
  return `${CLOUDINARY_PRIVATE_PREFIX}/${key}`;
}

const CLOUDINARY_PRIVATE_OPTS = { resource_type: "raw" as const, type: "authenticated" as const };

export function privateStorageRoot(): string {
  const root = path.resolve(process.env.PRIVATE_STORAGE_DIR || path.join(process.cwd(), "storage", "private"));
  const publicDir = path.resolve(process.cwd(), "public");
  if (root === publicDir || root.startsWith(publicDir + path.sep)) {
    throw new Error("PRIVATE_STORAGE_DIR must not be inside public/ — files there are publicly downloadable.");
  }
  return root;
}

/** Rejects anything that is not a key this module generated (blocks path traversal). */
export function isValidPrivateKey(key: string): boolean {
  return PRIVATE_KEY_PATTERN.test(key);
}

function localPathForKey(key: string): string {
  if (!isValidPrivateKey(key)) throw new Error("Invalid private storage key.");
  const root = privateStorageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid private storage key.");
  return full;
}

/** Filesystem errors that mean "this host cannot store files here at all". */
const READ_ONLY_FS_CODES = new Set(["EROFS", "EACCES", "EPERM", "ENOSPC"]);

/**
 * Stores a confidential file under a generated name and returns its storage key
 * (e.g. "requirements/<uuid>.pdf"). The original filename is never used on disk.
 *
 * Throws StorageError (STORAGE_NOT_CONFIGURED / STORAGE_UPLOAD_FAILED) on any
 * provider failure, so a route can tell the client which stage failed.
 */
export async function uploadPrivateFile(file: Buffer, extension: string, folder: string): Promise<string> {
  const ext = extension.toLowerCase();
  if (!PRIVATE_FOLDER_PATTERN.test(folder) || !PRIVATE_EXT_PATTERN.test(ext)) {
    throw new Error("Invalid folder or extension for private upload.");
  }
  const key = `${folder}/${uuidv4()}${ext}`;
  const provider = privateProvider();

  if (provider === "local") {
    const fullPath = localPathForKey(key);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file, { mode: 0o600 });
    } catch (err: any) {
      if (err && READ_ONLY_FS_CODES.has(err.code)) {
        throw new StorageError(
          "STORAGE_NOT_CONFIGURED",
          `Private storage is local disk but this host cannot write to it (${err.code}). ` +
            "Set PRIVATE_STORAGE_PROVIDER to cloudinary, s3 or r2.",
          { cause: err }
        );
      }
      throw new StorageError("STORAGE_UPLOAD_FAILED", "Could not write the file to private storage.", { retryable: true, cause: err });
    }
    return key;
  }

  if (provider === "cloudinary") {
    requireCloudinaryConfig();
    try {
      await new Promise<unknown>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { public_id: cloudinaryPrivatePublicId(key), ...CLOUDINARY_PRIVATE_OPTS, overwrite: false },
          (err, res) => (err || !res ? reject(err ?? new Error("Cloudinary upload returned no result")) : resolve(res))
        );
        stream.end(file);
      });
    } catch (err) {
      const status = (err as { http_code?: number } | null)?.http_code;
      throw new StorageError(
        status === 401 || status === 403 ? "STORAGE_NOT_CONFIGURED" : "STORAGE_UPLOAD_FAILED",
        "Cloudinary refused the private upload.",
        { retryable: status === undefined || status >= 500 || status === 420 || status === 429, cause: err }
      );
    }
    return key;
  }

  try {
    await s3Client.send(
      new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: file, ContentType: getContentType(ext) })
    );
  } catch (err) {
    if (isStorageError(err)) throw err;
    throw new StorageError("STORAGE_UPLOAD_FAILED", "Object storage refused the private upload.", { retryable: true, cause: err });
  }
  return key;
}

export async function readPrivateFile(key: string): Promise<Buffer> {
  const provider = privateProvider();
  if (provider === "local") {
    return fs.readFile(localPathForKey(key));
  }
  if (!isValidPrivateKey(key)) throw new Error("Invalid private storage key.");

  if (provider === "cloudinary") {
    requireCloudinaryConfig();
    // A one-minute signed API download URL, used server-side only and never
    // handed to a browser: the client gets the app's own signed route instead.
    const url = cloudinary.utils.private_download_url(cloudinaryPrivatePublicId(key), "", {
      ...CLOUDINARY_PRIVATE_OPTS,
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new StorageError("STORAGE_READ_FAILED", "Could not reach Cloudinary.", { retryable: true, cause: err });
    }
    if (res.status === 404) throw new StorageError("STORAGE_NOT_FOUND", "Private file not found.");
    if (!res.ok) throw new StorageError("STORAGE_READ_FAILED", `Cloudinary download failed (${res.status}).`, { retryable: res.status >= 500 });
    return Buffer.from(await res.arrayBuffer());
  }

  const result = await s3Client.send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }));
  if (!result.Body) throw new Error("Private file not found.");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deletePrivateFile(key: string): Promise<void> {
  const provider = privateProvider();
  if (provider === "local") {
    try {
      await fs.unlink(localPathForKey(key));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    return;
  }
  if (!isValidPrivateKey(key)) throw new Error("Invalid private storage key.");
  if (provider === "cloudinary") {
    requireCloudinaryConfig();
    await cloudinary.uploader.destroy(cloudinaryPrivatePublicId(key), { ...CLOUDINARY_PRIVATE_OPTS, invalidate: true });
    return;
  }
  await s3Client.send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key }));
}

/**
 * Simple mime-type mapping for standard uploads
 */
function getContentType(ext: string): string {
  const mimeTypes: { [key: string]: string } = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return mimeTypes[ext.toLowerCase()] || "application/octet-stream";
}
