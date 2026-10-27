/**
 * Offline capture queue for the field app (browser-only, IndexedDB).
 *
 * A capture is written here FIRST — before any network call — so a field
 * worker with no signal loses nothing. Sync sends each one to
 * POST /api/field/evidence; the device-generated clientId makes a resend safe.
 */

export interface QueuedCapture {
  clientId: string;
  taskId: string;
  taskTitle: string;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  note: string;
  containsPeople: boolean;
  photo: Blob | null;
  feedback: null | {
    beneficiaryRef: string;
    consentMethod: "VERBAL" | "WRITTEN" | "THUMBPRINT";
    consentToRecord: boolean;
    consentToSharePhoto: boolean;
    rating: number | null;
    feedbackText: string;
  };
  /** Set when the server refused it for a reason a retry will not fix. */
  error?: string;
  /** Last transient failure (offline, 5xx, storage outage) — shown, and retried. */
  lastAttemptError?: string;
  /** Structured error code from the server, e.g. STORAGE_UPLOAD_FAILED. */
  errorCode?: string;
}

/**
 * What to do with a queued capture after a sync attempt.
 *  - done:   stored (201) or already stored (200 replay) → remove from queue.
 *  - failed: a 4xx the same request will always get → keep, show the error.
 *  - retry:  offline, timeout, rate limit, auth expired, 5xx → leave queued.
 */
export function syncOutcome(status: number | "network-error"): "done" | "failed" | "retry" {
  if (status === "network-error") return "retry";
  if (status === 200 || status === 201) return "done";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  return "failed";
}

const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
};

export interface UploadResult {
  status: number | "network-error";
  body: { error?: string; code?: string; retryable?: boolean } & Record<string, unknown>;
}

/**
 * POSTs one capture with upload progress (fetch has no upload progress).
 * Never throws: a network failure is reported as "network-error".
 */
export function uploadCapture(c: QueuedCapture, onProgress?: (fraction: number) => void): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/field/evidence");
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: UploadResult["body"] = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {}
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => resolve({ status: "network-error", body: {} });
    xhr.ontimeout = () => resolve({ status: "network-error", body: {} });
    xhr.send(toFormData(c));
  });
}

/** One line for the field worker, from a failed attempt. */
export function describeFailure(r: UploadResult): string {
  if (r.status === "network-error") return "No connection — will retry.";
  const base = r.body.error || `Error ${r.status}`;
  return r.body.code ? `${base} (${r.body.code})` : base;
}

export function toFormData(c: QueuedCapture): FormData {
  const fd = new FormData();
  fd.set("clientId", c.clientId);
  fd.set("taskId", c.taskId);
  fd.set("capturedAt", c.capturedAt);
  if (c.latitude !== null && c.longitude !== null) {
    fd.set("latitude", String(c.latitude));
    fd.set("longitude", String(c.longitude));
    if (c.accuracyM !== null) fd.set("accuracyM", String(c.accuracyM));
  }
  if (c.note) fd.set("note", c.note);
  fd.set("containsPeople", String(c.containsPeople));
  if (c.photo) fd.set("photo", c.photo, `capture.${PHOTO_EXT[c.photo.type] ?? "jpg"}`);
  if (c.feedback) {
    fd.set("hasFeedback", "true");
    fd.set("beneficiaryRef", c.feedback.beneficiaryRef);
    fd.set("consentMethod", c.feedback.consentMethod);
    fd.set("consentToRecord", String(c.feedback.consentToRecord));
    fd.set("consentToSharePhoto", String(c.feedback.consentToSharePhoto));
    if (c.feedback.rating !== null) fd.set("rating", String(c.feedback.rating));
    if (c.feedback.feedbackText) fd.set("feedbackText", c.feedback.feedbackText);
  }
  return fd;
}

// ─── IndexedDB ───────────────────────────────────────────────────────────────

const DB = "impactbridge-field";
const STORE = "captures";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export const queue = {
  all: () => run<QueuedCapture[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedCapture[]>),
  put: (c: QueuedCapture) => run("readwrite", (s) => s.put(c)),
  remove: (clientId: string) => run("readwrite", (s) => s.delete(clientId)),
};

/**
 * Downscale to at most 1600px and re-encode as JPEG. Smaller uploads on a weak
 * signal, and re-encoding through a canvas drops EXIF — including the phone's
 * own embedded location and device details — so only the GPS the worker
 * explicitly captured is sent. Falls back to the original file.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}
