import { type PortableBoard, readArchive, writeArchive } from "./archive";

type Request = { action: "decode"; bytes: Uint8Array } | { action: "encode"; board: PortableBoard };

self.addEventListener("message", (event: MessageEvent<Request>) => {
  try {
    if (event.data.action === "decode") {
      const value = readArchive(event.data.bytes);
      self.postMessage({ ok: true, value }, { transfer: value.assets.map(({ bytes }) => bytes.buffer) });
    } else {
      const value = writeArchive(event.data.board);
      self.postMessage({ ok: true, value }, { transfer: [value.buffer] });
    }
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : "Invalid board archive." });
  }
});
