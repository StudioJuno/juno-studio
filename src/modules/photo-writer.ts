import { modifyPhoto, modifyPhotoBatch } from "../db";
import type { Photo } from "../model";

export type PhotoUpdate = (photo: Photo) => Photo;
type Entry = {
  id: string;
  update: PhotoUpdate;
  group?: string;
  waiters: { resolve: (p: Photo) => void; reject: (e: Error) => void }[];
};
/**
 * `blockedId` : la photo de l'écriture qui a échoué, en tête de file.
 * `blocked` : combien de changements en file la visent.
 */
export type WriteState = {
  pending: number;
  error: string;
  blockedId?: string;
  blocked?: number;
};
/** Le message de modifyPhoto quand la fiche n'existe plus. */
const FICHE_DISPARUE = "Photo introuvable.";

/** Keep failed commands in order; retry must never apply an old edit after a newer one. */
export class PhotoWriter {
  private queue: Entry[] = [];
  private projection: Map<string, Entry[]> | undefined;
  private activeEntries = new Set<Entry>();
  private running = false;
  private executing: Entry | undefined;
  private error: Error | undefined;
  private idle: { resolve: () => void; reject: (e: Error) => void }[] = [];
  constructor(
    private onState: (state: WriteState) => void,
    private onSaved: (photo: Photo) => void,
    private apply = modifyPhoto,
    private onSavedBatch?: (photos: Photo[]) => void,
  ) {}
  /** Present pending edits immediately without claiming that they are saved. */
  project(photo: Photo): Photo {
    if (!this.projection) {
      this.projection = new Map();
      for (const entry of this.queue) {
        const list = this.projection.get(entry.id) || [];
        list.push(entry);
        this.projection.set(entry.id, list);
      }
    }
    return (this.projection.get(photo.id) || []).reduce(
      (p, entry) => entry.update(p),
      photo,
    );
  }
  write(id: string, update: PhotoUpdate, group?: string): Promise<Photo> {
    return new Promise((resolve, reject) => {
      const tail = this.queue.at(-1);
      if (
        group &&
        tail &&
        !this.activeEntries.has(tail) &&
        tail !== this.executing &&
        tail.id === id &&
        tail.group === group
      ) {
        tail.update = update;
        tail.waiters.push({ resolve, reject });
      } else
        this.queue.push({ id, update, group, waiters: [{ resolve, reject }] });
      this.publish();
      if (this.error) reject(this.error);
      else void this.drain();
    });
  }
  async retry() {
    if (this.running) return this.flush();
    this.error = undefined;
    this.publish();
    void this.drain();
    return this.flush();
  }
  /**
   * La sortie quand la reprise échoue encore : une fiche disparue ferait
   * échouer la même écriture pour toujours et bloquerait toute la file. On
   * retire seulement l'entrée fautive, en tête ; les suivantes repartent dans
   * leur ordre. Ses promesses ont déjà été rejetées au moment de l'échec.
   */
  async abandon() {
    if (this.running || !this.error) return this.flush();
    const tete = this.queue.shift()!;
    // Une fiche disparue fera échouer tous ses changements, l'un après
    // l'autre : ils partent ensemble, sans redemander pour chacun (relecture
    // du 29/09/2026). Une autre erreur ne retire que l'entrée de tête.
    if (this.error.message === FICHE_DISPARUE) {
      const perdus = this.queue.filter((e) => e.id === tete.id);
      this.queue = this.queue.filter((e) => e.id !== tete.id);
      for (const e of perdus) for (const w of e.waiters) w.reject(this.error);
    }
    this.error = undefined;
    this.publish();
    void this.drain();
    return this.flush();
  }
  flush(): Promise<void> {
    if (this.error) return Promise.reject(this.error);
    if (!this.queue.length && !this.running) return Promise.resolve();
    return new Promise((resolve, reject) =>
      this.idle.push({ resolve, reject }),
    );
  }
  private publish() {
    this.projection = undefined;
    const state: WriteState = {
      pending: this.queue.length,
      error: this.error?.message || "",
    };
    // En échec, l'entrée fautive n'a pas quitté la tête de file.
    if (this.error && this.queue.length) {
      state.blockedId = this.queue[0].id;
      state.blocked =
        this.error.message === FICHE_DISPARUE
          ? this.queue.filter((e) => e.id === state.blockedId).length
          : 1;
    }
    this.onState(state);
  }
  private async drain() {
    if (this.running || this.error) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const entry = this.queue[0];
        this.executing = entry;
        let entries =
          this.apply === modifyPhoto ? this.queue.slice(0, 100) : [entry];
        this.activeEntries = new Set(entries);
        let photos: Photo[];
        if (entries.length > 1) {
          try {
            photos = await modifyPhotoBatch(entries);
          } catch {
            // The atomic batch wrote nothing: locate the first failing command.
            entries = [entry];
            photos = [await this.apply(entry.id, entry.update)];
          }
        } else photos = [await this.apply(entry.id, entry.update)];
        this.activeEntries.clear();
        this.queue.splice(0, entries.length);
        this.executing = undefined;
        for (let i = 0; i < entries.length; i++)
          for (const waiter of entries[i].waiters) waiter.resolve(photos[i]);
        if (this.onSavedBatch) this.onSavedBatch(photos);
        else for (const photo of photos) this.onSaved(photo);
        this.publish();
      }
    } catch (e) {
      this.error = e instanceof Error ? e : Error(String(e));
      for (const entry of this.queue)
        for (const waiter of entry.waiters) waiter.reject(this.error);
      this.publish();
    } finally {
      this.activeEntries.clear();
      this.running = false;
      this.executing = undefined;
      for (const waiter of this.idle.splice(0)) {
        if (this.error) waiter.reject(this.error);
        else waiter.resolve();
      }
    }
  }
}
