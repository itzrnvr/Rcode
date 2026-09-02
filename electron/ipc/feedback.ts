/*
 * PURPOSE: In-app UI feedback mode backend.
 *
 * The renderer draws annotations on a transparent canvas overlay. On save it
 * asks main for a window capture (capturePage), composites annotation over it,
 * and sends the final PNG dataURL + a note here. We write:
 *   <userData>/feedback/feedback-<timestamp>.png   (annotated screenshot)
 *   <userData>/feedback/feedback-<timestamp>.txt   (the note)
 *   <userData>/feedback/latest.md                  (note + png path, overwritten)
 * and copy the annotated image to the system clipboard so it can be pasted
 * anywhere. The agent reads latest.md / the png when the user says "read it".
 */

import { ipcMain, clipboard, nativeImage, app, ClipboardItem } from "electron";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";

export function feedbackDir(): string {
  return join(app.getPath("userData"), "feedback");
}

export function registerFeedbackHandlers(): void {
  ipcMain.handle("feedback:capture", async (event) => {
    const image = await event.sender.capturePage();
    return { dataUrl: image.toDataURL(), dpr: event.sender.getZoomFactor() || 1, width: image.getSize().width, height: image.getSize().height };
  });

  ipcMain.handle("feedback:save", async (_event, payload: { dataUrl: string; note: string }) => {
    const dir = feedbackDir();
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const pngPath = join(dir, `feedback-${ts}.png`);
    const txtPath = join(dir, `feedback-${ts}.txt`);
    const latestPath = join(dir, "latest.md");

    const image = nativeImage.createFromDataURL(payload.dataUrl);
    writeFileSync(pngPath, image.toPNG());
    const note = payload.note?.trim() ?? "";
    if (note) writeFileSync(txtPath, note, "utf8");
    writeFileSync(
      latestPath,
      `# Latest UI feedback\n\nsaved: ${new Date().toISOString()}\nimage: ${pngPath}\nnote file: ${txtPath}\n\n## note\n\n${note || "(no note)"}\n`,
      "utf8",
    );

    // Electron 44: clipboard is async + item-based (writeImage was removed).
    await clipboard.write([
      new ClipboardItem({ "image/png": new Blob([image.toPNG()], { type: "image/png" }) }),
    ]);
    return { pngPath, txtPath, latestPath };
  });
}
