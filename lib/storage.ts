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

  // Fail closed. Cloudinary and S3/R2 return world-readable URLs here; private
  // delivery on those needs signed, expiring URLs, which is not built yet.
  // Refusing is deliberate — silently storing a PAN card at a public URL
  // because the provider changed is exactly the failure this flag exists to
  // prevent, and an unguessable URL is not access control.
  if (options.private && provider !== "local") {
    throw new Error(
      `Refusing to upload a private file: STORAGE_PROVIDER is "${provider}", which returns public URLs. ` +
        `Private delivery needs signed URLs (not yet implemented). Use STORAGE_PROVIDER="local" or implement signing before storing sensitive documents.`
    );
  }

  if (provider === "cloudinary") {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new Error(
        `STORAGE_PROVIDER is "cloudinary" but CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET are not fully set — refusing to upload to an unconfigured account.`
      );
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
    const bucketName = process.env.AWS_BUCKET_NAME;
    const cdnUrl = process.env.AWS_CDN_URL;

    if (!bucketName) {
      throw new Error(
        `STORAGE_PROVIDER is "${provider}" but AWS_BUCKET_NAME is not set — refusing to upload to an unconfigured bucket.`
      );
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
 * Deletes a file from the configured storage provider using its URL.
 */
export async function deleteFile(fileUrl: string): Promise<void> {
  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

  if (provider === "cloudinary") {
    // e.g. https://res.cloudinary.com/<cloud>/image/upload/v.../folder/filename.jpg
    // The public_id is everything after the version segment, without the extension.
    // resource_type (image/video/raw) must be read from the URL and passed to
    // destroy() explicitly — it defaults to "image" otherwise, which silently
    // no-ops (returns "not found" rather than throwing) for non-image uploads
    // like PDFs/docs, which upload as "raw" via resource_type: "auto".
    try {
      const parsedUrl = new URL(fileUrl);
      const parts = parsedUrl.pathname.split("/");
      const versionIdx = parts.findIndex((p) => /^v\d+$/.test(p));
      if (versionIdx === -1) return;
      const publicIdWithExt = parts.slice(versionIdx + 1).join("/");
      const publicId = publicIdWithExt.replace(path.extname(publicIdWithExt), "");
      if (!publicId) return;
      const resourceType = parts[versionIdx - 2] || "image"; // .../<resource_type>/upload/v.../...
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
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
    if (fileUrl.startsWith("/api/documents/")) {
      const rel = fileUrl.slice("/api/documents/".length);
      const filePath = path.join(process.cwd(), PRIVATE_UPLOAD_ROOT, rel);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code !== "ENOENT") {
          throw err;
        }
      }
      return;
    }

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
// For confidential documents (CSR/RFP files). Unlike uploadFile(), nothing here
// ever produces a URL: callers get an opaque storage key, and bytes are only
// served through an authenticated route that checks ownership first.
//
//   local (default)  files under PRIVATE_STORAGE_DIR (default ./storage/private),
//                    outside public/ so Next.js never serves them statically
//   s3 / r2          objects in AWS_PRIVATE_BUCKET_NAME (falls back to
//                    AWS_BUCKET_NAME) — that bucket must not allow public reads
//
// Provider: PRIVATE_STORAGE_PROVIDER, else STORAGE_PROVIDER when it is s3/r2,
// else local. Cloudinary is never used for private files (its URLs are public).

const PRIVATE_KEY_PATTERN = /^[a-z0-9-]+\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;
const PRIVATE_FOLDER_PATTERN = /^[a-z0-9-]+$/;
const PRIVATE_EXT_PATTERN = /^\.[a-z0-9]{1,8}$/;

function privateProvider(): "local" | "s3" | "r2" {
  const explicit = process.env.PRIVATE_STORAGE_PROVIDER?.toLowerCase();
  if (explicit === "local" || explicit === "s3" || explicit === "r2") return explicit;
  const general = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  return general === "s3" || general === "r2" ? general : "local";
}

function privateBucket(): string {
  const bucket = process.env.AWS_PRIVATE_BUCKET_NAME || process.env.AWS_BUCKET_NAME;
  if (!bucket) {
    throw new Error("Private storage is S3/R2 but neither AWS_PRIVATE_BUCKET_NAME nor AWS_BUCKET_NAME is set.");
  }
  return bucket;
}

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

/**
 * Stores a confidential file under a generated name and returns its storage key
 * (e.g. "requirements/<uuid>.pdf"). The original filename is never used on disk.
 */
export async function uploadPrivateFile(file: Buffer, extension: string, folder: string): Promise<string> {
  const ext = extension.toLowerCase();
  if (!PRIVATE_FOLDER_PATTERN.test(folder) || !PRIVATE_EXT_PATTERN.test(ext)) {
    throw new Error("Invalid folder or extension for private upload.");
  }
  const key = `${folder}/${uuidv4()}${ext}`;

  if (privateProvider() === "local") {
    const fullPath = localPathForKey(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, file, { mode: 0o600 });
    return key;
  }

  await s3Client.send(
    new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: file, ContentType: getContentType(ext) })
  );
  return key;
}

export async function readPrivateFile(key: string): Promise<Buffer> {
  if (privateProvider() === "local") {
    return fs.readFile(localPathForKey(key));
  }
  if (!isValidPrivateKey(key)) throw new Error("Invalid private storage key.");
  const result = await s3Client.send(new GetObjectCommand({ Bucket: privateBucket(), Key: key }));
  if (!result.Body) throw new Error("Private file not found.");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deletePrivateFile(key: string): Promise<void> {
  if (privateProvider() === "local") {
    try {
      await fs.unlink(localPathForKey(key));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    return;
  }
  if (!isValidPrivateKey(key)) throw new Error("Invalid private storage key.");
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
    ".gif": "image/gif",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return mimeTypes[ext.toLowerCase()] || "application/octet-stream";
}
