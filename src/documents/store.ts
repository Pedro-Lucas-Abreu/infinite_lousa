import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { Scene } from "../core/scene";
import { type BoardChange, type BoardObject, type Stroke, isPageObject } from "../core/types";
import type { BoardAsset, PortableBoard } from "./archive";

const DEFAULT_DB_NAME = "whiteboard-local";
const CURRENT = "current";

export type SaveStatus = "saved" | "saving" | "error";

interface Revision {
  revision: number;
  cursor: number;
  historyLength: number;
}

type Command =
  | { type: "add"; stroke: Stroke }
  | { type: "changes"; changes: readonly BoardChange[] };

type Edit = {
  type: "edit";
  revision: Revision;
  changes: readonly BoardChange[];
  assets?: readonly BoardAsset[];
  insertCommand?: { index: number; command: Command; prune: boolean };
};

type Replacement = { type: "replace"; revision: Revision; board: PortableBoard };

interface DocumentDB extends DBSchema {
  meta: { key: typeof CURRENT; value: Revision };
  objects: { key: string; value: BoardObject };
  commands: { key: number; value: Command };
  assets: { key: string; value: BoardAsset };
}

const stores = ["meta", "objects", "commands", "assets"] as const;

function emptyRevision(): Revision {
  return { revision: 0, cursor: 0, historyLength: 0 };
}

function commandChanges(command: Command): readonly BoardChange[] {
  return command.type === "add" ? [{ after: command.stroke }] : command.changes;
}

export class BoardDocument {
  #pending: Edit[] = [];
  #writer: Promise<void> | undefined;
  #history: Command[];
  #revision: Revision;
  #assets: Map<string, BoardAsset>;
  #replacing = false;
  #persistenceRequested = false;
  #status: SaveStatus;
  #openError: unknown;

  private constructor(
    private readonly scene: Scene,
    private readonly db: IDBPDatabase<DocumentDB> | undefined,
    private readonly onStatus: ((status: SaveStatus) => void) | undefined,
    revision = emptyRevision(),
    history: Command[] = [],
    assets: readonly BoardAsset[] = [],
    openError?: unknown,
  ) {
    this.#revision = revision;
    this.#history = history;
    this.#assets = new Map(assets.map((asset) => [asset.id, asset]));
    this.#openError = openError;
    this.#status = db ? "saved" : "error";
    onStatus?.(this.#status);
  }

  static async open(
    scene: Scene,
    onStatus?: (status: SaveStatus) => void,
    options: { name?: string } = {},
  ): Promise<BoardDocument> {
    let db: IDBPDatabase<DocumentDB> | undefined;
    try {
      db = await openDB<DocumentDB>(options.name ?? DEFAULT_DB_NAME, 1, {
        upgrade(database) {
          database.createObjectStore("meta");
          database.createObjectStore("objects");
          database.createObjectStore("commands");
          database.createObjectStore("assets");
        },
      });
      const transaction = db.transaction(stores);
      const [revision, objects, commands, assets] = await Promise.all([
        transaction.objectStore("meta").get(CURRENT),
        transaction.objectStore("objects").getAll(),
        transaction.objectStore("commands").getAll(),
        transaction.objectStore("assets").getAll(),
        transaction.done,
      ]);
      if (revision) {
        if (revision.cursor < 0 || revision.cursor > revision.historyLength ||
            commands.length !== revision.historyLength) {
          throw new Error("The local board history is inconsistent.");
        }
        scene.replace(objects);
      }
      return new BoardDocument(scene, db, onStatus, revision, commands, assets);
    } catch (error) {
      db?.close();
      return new BoardDocument(scene, undefined, onStatus, emptyRevision(), [], [], error);
    }
  }

  get status(): SaveStatus {
    return this.#status;
  }

  get canUndo(): boolean {
    return this.#revision.cursor > 0 && !this.#replacing;
  }

  get canRedo(): boolean {
    return this.#revision.cursor < this.#history.length && !this.#replacing;
  }

  recordStroke(stroke: Stroke): void {
    if (this.#replacing) throw new Error("A board replacement is in progress.");
    this.#record({ type: "add", stroke });
  }

  applyChanges(changes: readonly BoardChange[], assets: readonly BoardAsset[] = []): void {
    if (this.#replacing) throw new Error("A board replacement is in progress.");
    if (!changes.length) return;

    const newAssets = new Map<string, BoardAsset>();
    for (const asset of assets) {
      if (this.#assets.has(asset.id) || newAssets.has(asset.id)) throw new Error("Duplicate board asset.");
      newAssets.set(asset.id, asset);
    }

    const edited = new Map<string, BoardObject | undefined>();
    for (const { before, after } of changes) {
      if (before || after) edited.set((before ?? after!).id, after);
    }
    const objectAfterChange = (id: string) => edited.has(id) ? edited.get(id) : this.scene.get(id);
    for (const { after } of changes) {
      if (!after) continue;
      if (isPageObject(after)) {
        const { assetId } = after.props;
        const mime = (newAssets.get(assetId) ?? this.#assets.get(assetId))?.mime;
        if (after.type === "pdfPage" ? mime !== "application/pdf" : !mime?.startsWith("image/")) {
          throw new Error("Missing or incompatible board asset.");
        }
      } else if (after.parentId && !isPageObject(objectAfterChange(after.parentId))) {
        throw new Error("Missing attachment parent.");
      }
    }
    if (changes.some(({ before, after }) => isPageObject(before) && !after)) {
      for (const current of this.scene.all()) {
        const object = objectAfterChange(current.id);
        if (object && !isPageObject(object) && object.parentId &&
            !isPageObject(objectAfterChange(object.parentId))) {
          throw new Error("Detach dependent objects in the same edit before removing their page.");
        }
      }
    }

    this.scene.applyChanges(changes);
    for (const [id, asset] of newAssets) this.#assets.set(id, asset);
    this.#record({ type: "changes", changes }, assets);
  }

  asset(id: string): BoardAsset | undefined {
    return this.#assets.get(id);
  }

  #record(command: Command, assets?: readonly BoardAsset[]): void {
    if (this.db && !this.#persistenceRequested) {
      this.#persistenceRequested = true;
      void globalThis.navigator?.storage?.persist?.().catch(() => undefined);
    }
    const index = this.#revision.cursor;
    const prune = index < this.#history.length;
    if (prune) this.#history.length = index;
    this.#history.push(command);
    this.#queue({
      type: "edit",
      changes: commandChanges(command),
      assets,
      insertCommand: { index, command, prune },
      revision: this.#nextRevision(index + 1),
    });
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const cursor = this.#revision.cursor - 1;
    const changes = commandChanges(this.#history[cursor]).map(({ before, after }) => ({
      before: after, after: before,
    }));
    this.scene.applyChanges(changes);
    this.#queue({ type: "edit", changes, revision: this.#nextRevision(cursor) });
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    const cursor = this.#revision.cursor;
    const changes = commandChanges(this.#history[cursor]);
    this.scene.applyChanges(changes);
    this.#queue({ type: "edit", changes, revision: this.#nextRevision(cursor + 1) });
    return true;
  }

  portable(): PortableBoard {
    return { scene: this.scene.snapshot(), assets: Array.from(this.#assets.values()) };
  }

  async replace(board: PortableBoard): Promise<void> {
    if (this.#replacing) throw new Error("A board replacement is already in progress.");
    this.#replacing = true;
    try {
      // Check geometry and index construction before changing either the database or the visible scene.
      const inspected = new Scene(board.scene.objects);
      const revision = { revision: this.#revision.revision + 1, cursor: 0, historyLength: 0 };
      if (this.db) {
        await this.flush();
        this.#setStatus("saving");
        try {
          await this.#write({ type: "replace", revision, board });
        } catch (error) {
          this.#setStatus("error");
          throw error;
        }
      }
      this.scene.replace(inspected.all());
      this.#history = [];
      this.#assets = new Map(board.assets.map((asset) => [asset.id, asset]));
      this.#revision = revision;
      if (this.db) this.#setStatus("saved");
    } finally {
      this.#replacing = false;
    }
  }

  flush(): Promise<void> {
    if (!this.db) return Promise.reject(this.#openError ?? new Error("Local storage is unavailable."));
    if (this.#writer) return this.#writer;
    if (this.#pending.length === 0) return Promise.resolve();

    this.#setStatus("saving");
    this.#writer = this.#drain().finally(() => { this.#writer = undefined; });
    return this.#writer;
  }

  close(): void {
    void this.flush().catch(() => undefined).finally(() => this.db?.close());
  }

  #nextRevision(cursor: number): Revision {
    return { revision: this.#revision.revision + 1, cursor, historyLength: this.#history.length };
  }

  #queue(edit: Edit): void {
    this.#revision = edit.revision;
    if (!this.db) return;
    this.#pending.push(edit);
    void this.flush().catch(() => undefined);
  }

  #setStatus(status: SaveStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.onStatus?.(status);
  }

  async #drain(): Promise<void> {
    try {
      while (this.#pending.length > 0) {
        await this.#write(this.#pending[0]);
        this.#pending.shift();
      }
      this.#setStatus("saved");
    } catch (error) {
      this.#setStatus("error");
      throw error;
    }
  }

  async #write(operation: Edit | Replacement): Promise<void> {
    if (!this.db) throw new Error("Local storage is unavailable.");
    const transaction = this.db.transaction(stores, "readwrite", { durability: "strict" });
    const objects = transaction.objectStore("objects");
    const commands = transaction.objectStore("commands");
    const assets = transaction.objectStore("assets");
    const requests: Promise<unknown>[] = [transaction.done];
    try {
      if (operation.type === "replace") {
        requests.push(objects.clear(), commands.clear(), assets.clear());
        for (const object of operation.board.scene.objects) requests.push(objects.put(object, object.id));
        for (const asset of operation.board.assets) requests.push(assets.put(asset, asset.id));
      } else {
        const { changes, insertCommand } = operation;
        for (const { before, after } of changes) {
          if (after) requests.push(objects.put(after, after.id));
          else if (before) requests.push(objects.delete(before.id));
        }
        for (const asset of operation.assets ?? []) requests.push(assets.put(asset, asset.id));
        if (insertCommand) {
          const { prune, index, command } = insertCommand;
          if (prune) requests.push(commands.delete(IDBKeyRange.lowerBound(index)));
          requests.push(commands.put(command, index));
        }
      }
      requests.push(transaction.objectStore("meta").put(operation.revision, CURRENT));
      await Promise.all(requests);
    } catch (error) {
      try { transaction.abort(); } catch { /* The request may already have aborted it. */ }
      await Promise.allSettled(requests);
      throw error;
    }
  }
}
