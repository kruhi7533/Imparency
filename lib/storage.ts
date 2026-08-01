import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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

/**
 * Uploads a file buffer to the configured storage provider (local, S3/R2, or Cloudinary).
 * Returns the public URL of the uploaded file.
 */
export async function uploadFile(
  file: Buffer,
  originalName: string,
  folder: string
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
