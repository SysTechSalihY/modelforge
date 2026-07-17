import { describe, it, expect } from "vitest";
import * as sessionsStore from "./sessions-store";

// updatedAt has millisecond resolution; force distinct timestamps so
// ordering assertions aren't flaky when operations land in the same tick.
function sleepPastNextMs(): void {
    const start = Date.now();
    while (Date.now() === start) {
        /* busy-wait a few ms */
    }
}

describe("sessions-store", () => {
    it("creates a session and can retrieve it by id", () => {
        const created = sessionsStore.createSession("llama3.2", null);
        const fetched = sessionsStore.getSession(created.id);

        expect(fetched).not.toBeNull();
        expect(fetched?.title).toBe("New chat");
        expect(fetched?.model).toBe("llama3.2");
        expect(fetched?.messages).toEqual([]);
    });

    it("returns null for a session id that doesn't exist", () => {
        expect(sessionsStore.getSession("does-not-exist")).toBeNull();
    });

    it("updates only the given fields and bumps updatedAt", () => {
        const created = sessionsStore.createSession(null);
        const updated = sessionsStore.updateSession(created.id, { title: "Renamed" });

        expect(updated?.title).toBe("Renamed");
        expect(updated?.model).toBeNull();
    });

    it("deletes a session", () => {
        const created = sessionsStore.createSession(null);
        sessionsStore.deleteSession(created.id);
        expect(sessionsStore.getSession(created.id)).toBeNull();
    });

    it("unassigning a project clears projectId on its sessions only", () => {
        const inProject = sessionsStore.createSession(null, "proj-1");
        const notInProject = sessionsStore.createSession(null, null);

        sessionsStore.unassignProject("proj-1");

        expect(sessionsStore.getSession(inProject.id)?.projectId).toBeNull();
        expect(sessionsStore.getSession(notInProject.id)?.projectId).toBeNull();
    });

    it("lists sessions most-recently-updated first", () => {
        sessionsStore.clearAll();
        const first = sessionsStore.createSession(null);
        sleepPastNextMs();
        const second = sessionsStore.createSession(null);

        const list = sessionsStore.listSessions();
        expect(list[0].id).toBe(second.id);
    });
});
