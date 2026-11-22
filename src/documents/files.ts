import type { PortableBoard } from "./archive";

declare const __DOCUMENT_WORKER__: string;

const BOARD_MIME = "application/zip";
const MAX_FILE_SIZE = 128 * 1024 * 1024;
const types = [{ description: "Lousa", accept: { [BOARD_MIME]: [".board"] } }];

interface ReadHandle {
  name: string;
  getFile(): Promise<File>;
}

interface WriteHandle {
  name: string;
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

interface PickerWindow extends Window {
  showOpenFilePicker?(options: { types: typeof types; multiple: boolean }): Promise<ReadHandle[]>;
  showSaveFilePicker?(options: { types: typeof types; suggestedName: string }): Promise<WriteHandle>;
}

type Request = { action: "decode"; bytes: Uint8Array } | { action: "encode"; board: PortableBoard };
type WorkerResponse<T> = { ok: true; value: T } | { ok: false; message: string };

export type OpenBoardResult =
  | { kind: "opened"; board: PortableBoard; filename: string }
  | { kind: "upload" }
  | { kind: "cancelled" };

export type SaveBoardResult = { kind: "saved" | "downloaded"; filename: string } | { kind: "cancelled" };

function useArchiveWorker<T>(request: Request, transfers: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(__DOCUMENT_WORKER__, import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse<T>>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.value);
      else reject(new Error(event.data.message));
    }, { once: true });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message || "The board archive worker could not run."));
    }, { once: true });
    worker.addEventListener("messageerror", () => {
      worker.terminate();
      reject(new Error("The board archive worker returned unreadable data."));
    }, { once: true });
    try {
      worker.postMessage(request, transfers);
    } catch (error) {
      worker.terminate();
      reject(error);
    }
  });
}

export function encodeBoard(board: PortableBoard): Promise<Uint8Array> {
  return useArchiveWorker({ action: "encode", board });
}

export function decodeBoard(input: ArrayBuffer | Uint8Array): Promise<PortableBoard> {
  if (input.byteLength > MAX_FILE_SIZE) return Promise.reject(new Error("Board file is too large."));
  const bytes = input instanceof Uint8Array ? input.slice() : new Uint8Array(input.slice(0));
  return useArchiveWorker({ action: "decode", bytes }, [bytes.buffer]);
}

export async function decodeFromFile(file: File): Promise<PortableBoard> {
  if (file.size > MAX_FILE_SIZE) throw new Error("Board file is too large.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return useArchiveWorker({ action: "decode", bytes }, [bytes.buffer]);
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function pickerUnavailable(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotSupportedError");
}

export async function openBoardFile(fallbackInput: HTMLInputElement): Promise<OpenBoardResult> {
  const picker = window as PickerWindow;
  if (!picker.showOpenFilePicker) {
    fallbackInput.click();
    return { kind: "upload" };
  }

  let handles: ReadHandle[];
  try {
    handles = await picker.showOpenFilePicker({ types, multiple: false });
  } catch (error) {
    if (cancelled(error)) return { kind: "cancelled" };
    if (pickerUnavailable(error) && navigator.userActivation?.isActive) {
      fallbackInput.click();
      return { kind: "upload" };
    }
    throw error;
  }
  const handle = handles[0];
  if (!handle) return { kind: "cancelled" };
  const board = await decodeFromFile(await handle.getFile());
  return { kind: "opened", board, filename: handle.name };
}

async function archiveBlob(board: PortableBoard): Promise<Blob> {
  const bytes = await encodeBoard(board);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: BOARD_MIME });
}

export async function saveBoardFile(
  board: PortableBoard,
  suggestedName = "lousa.board",
  forceDownload = false,
): Promise<SaveBoardResult> {
  const picker = window as PickerWindow;
  let handle: WriteHandle | undefined;
  if (!forceDownload && picker.showSaveFilePicker) {
    try {
      handle = await picker.showSaveFilePicker({ types, suggestedName });
    } catch (error) {
      if (cancelled(error)) return { kind: "cancelled" };
      if (!pickerUnavailable(error)) throw error;
    }
  }
  if (handle) {
    const blob = await archiveBlob(board);
    const stream = await handle.createWritable();
    try {
      await stream.write(blob);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
    return { kind: "saved", filename: handle.name };
  }

  const url = URL.createObjectURL(await archiveBlob(board));
  const anchor = document.createElement("a");
  anchor.download = suggestedName;
  anchor.href = url;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return { kind: "downloaded", filename: suggestedName };
}
