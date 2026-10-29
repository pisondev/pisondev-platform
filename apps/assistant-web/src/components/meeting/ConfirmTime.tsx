"use client";

import { useEffect, useRef } from "react";
import {
  slotLabel,
  zoneLabel,
  type Poll,
  type Recommendation,
} from "@/lib/meeting";
import { Icon } from "./Icon";

export function ConfirmTime({
  poll,
  recommendation,
  timezone,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  poll: Poll;
  recommendation: Recommendation;
  timezone: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = ref.current;
    dialog?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previous;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLButtonElement>(".m-final-banner button")
          ?.focus({ preventScroll: true });
    };
  }, []);
  const unavailable = poll.participants.filter(
    (p) => !recommendation.participantIds.includes(p.id),
  );
  return (
    <dialog
      ref={ref}
      className="m-confirm-dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="m-confirm-content">
        <div className="m-section-row">
          <span className="m-icon-tile">
            <Icon name="calendar" size={24} />
          </span>
          <button
            className="m-icon-button"
            type="button"
            aria-label="Close confirmation"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="confirm-title">Make it a date?</h2>
        <p id="confirm-description">
          Jadwal ini akan dikonfirmasi dan pengisian jawaban ditutup. Kamu bisa
          membukanya kembali nanti.
        </p>
        <div className="m-confirm-summary">
          <strong>{poll.title}</strong>
          <p>{slotLabel(recommendation.start, timezone, poll.duration)}</p>
          <span>
            {zoneLabel(recommendation.start, timezone)} · {recommendation.count}
            /{poll.participants.length} peserta tersedia sepanjang meeting
          </span>
        </div>
        {unavailable.length > 0 && (
          <p className="m-alert m-alert-warning">
            Belum cocok untuk: {unavailable.map((p) => p.name).join(", ")}.
            Pastikan mereka sudah diajak berkoordinasi.
          </p>
        )}
        {error && (
          <p className="m-alert m-alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="m-dialog-actions">
          <button
            className="m-button m-button-secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Keep exploring
          </button>
          <button
            className="m-button m-button-primary"
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? "Confirming…" : "Confirm this time"}
            <Icon name="check" size={16} />
          </button>
        </div>
      </div>
    </dialog>
  );
}
