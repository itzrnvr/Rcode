/*
 * PURPOSE: In-app annotate/feedback mode.
 *
 * Toggle (titlebar highlighter button or Ctrl+Shift+A) freezes the UI under a
 * transparent canvas. Draw pen / arrow / box in red, write a note, press
 * "Save & copy": the renderer asks main for a window capture, composites the
 * annotation over it, and main writes feedback-<ts>.png/.txt + latest.md into
 * <userData>/feedback and copies the annotated image to the clipboard.
 * Then just tell the agent "read the feedback" — it reads latest.md.
 */

import { useEffect, useRef, useState, useCallback } from "react";

import { api } from "../../api/client";
import { PenIcon, ArrowUpRightIcon, SquareIcon, Undo2Icon, TrashIcon, XIcon } from "../common/Icons";

type Tool = "pen" | "arrow" | "box";
interface Point { x: number; y: number }
interface Shape { tool: Tool; points: Point[] }

const COLOR = "#ff3b30";

export function FeedbackOverlay({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [current, setCurrent] = useState<Shape | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dpr = window.devicePixelRatio || 1;

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, s: Shape) => {
    if (s.points.length === 0) return;
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const [a] = s.points;
    const b = s.points[s.points.length - 1];
    if (s.tool === "pen") {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (const p of s.points) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (s.tool === "box") {
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else {
      // arrow with head
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 12;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6));
      ctx.stroke();
    }
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of shapes) drawShape(ctx, s);
    if (current) drawShape(ctx, current);
  }, [shapes, current, drawShape, dpr]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    redraw();
  }, [redraw, dpr]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const getPos = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
    setCurrent({ tool, points: [getPos(e)] });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!current) return;
    setCurrent({ ...current, points: [...current.points, getPos(e)] });
  };
  const onPointerUp = () => {
    if (!current) return;
    if (current.points.length > 1) setShapes(prev => [...prev, current]);
    setCurrent(null);
  };

  const save = async () => {
    setSaving(true);
    setStatus("Capturing…");
    try {
      const shot = await api.captureForFeedback();
      // Composite base capture + annotation canvas
      const off = document.createElement("canvas");
      off.width = shot.width;
      off.height = shot.height;
      const ctx = off.getContext("2d")!;
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("image load failed"));
        img.src = shot.dataUrl;
      });
      ctx.drawImage(img, 0, 0, shot.width, shot.height);
      if (canvasRef.current) {
        ctx.drawImage(canvasRef.current, 0, 0, shot.width, shot.height);
      }
      const dataUrl = off.toDataURL("image/png");
      setStatus("Saving…");
      const result = await api.saveFeedback({ dataUrl, note });
      setStatus(`Saved + copied to clipboard: ${result.pngPath}`);
    } catch (e) {
      setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="feedback-overlay">
      <canvas
        ref={canvasRef}
        className="feedback-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      <div className="feedback-toolbar" onPointerDown={e => e.stopPropagation()}>
        <button className={`feedback-tool ${tool === "pen" ? "active" : ""}`} onClick={() => setTool("pen")} title="Pen"><PenIcon size={14} /></button>
        <button className={`feedback-tool ${tool === "arrow" ? "active" : ""}`} onClick={() => setTool("arrow")} title="Arrow"><ArrowUpRightIcon size={14} /></button>
        <button className={`feedback-tool ${tool === "box" ? "active" : ""}`} onClick={() => setTool("box")} title="Box"><SquareIcon size={14} /></button>
        <span className="feedback-sep" />
        <button className="feedback-tool" onClick={() => setShapes(s => s.slice(0, -1))} title="Undo"><Undo2Icon size={14} /></button>
        <button className="feedback-tool" onClick={() => setShapes([])} title="Clear all"><TrashIcon size={14} /></button>
        <span className="feedback-sep" />
        <button className="feedback-tool" onClick={onExit} title="Exit (Esc)"><XIcon size={14} /></button>
      </div>

      <div className="feedback-bottom" onPointerDown={e => e.stopPropagation()}>
        <textarea
          className="feedback-note"
          placeholder="What should I look at? (saved with the screenshot)"
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
        />
        <button className="feedback-save" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save & copy"}
        </button>
        {status && <div className="feedback-status">{status}</div>}
      </div>
    </div>
  );
}
