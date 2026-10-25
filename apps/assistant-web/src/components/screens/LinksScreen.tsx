"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, del, patch, post } from "@/lib/api";
import { fromWIB, shortDate, toWIB } from "@/lib/format";
import type { LinkConfig, LinkCount, LinkStats, ShortLink } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { QrCode } from "../QrCode";
import { Button, Card, PageHeader, Panel } from "../ui";

type Announce = (message: string) => void;
type FieldErrors = Record<string, string>;

const bare = (url: string) => url.replace(/^https?:\/\//, "");
const visits = (n: number) => `${n} ${n === 1 ? "visit" : "visits"}`;
const expired = (l: ShortLink) => l.expiresAt !== null && new Date(l.expiresAt) <= new Date();

/** Field messages from an API error; a taken slug is reported on the slug field. */
function fieldErrors(e: ApiError): FieldErrors {
  if (e.code === "slug_taken") return { slug: "This slug is already used." };
  if (e.code !== "invalid_input" || !e.details) return {};
  return Object.fromEntries(Object.entries(e.details).map(([k, v]) => [k, String(v)]));
}

async function copy(link: ShortLink, announce: Announce) {
  try {
    await navigator.clipboard.writeText(link.shortUrl);
    announce(`Copied ${bare(link.shortUrl)}`);
  } catch {
    announce("Copy failed. Select the link and copy it by hand.");
  }
}

export function LinksScreen() {
  const config = useApi<LinkConfig>("/links/config");
  const links = useApi<ShortLink[]>("/links?limit=500");
  const [open, setOpen] = useState<string>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const base = config.data ? bare(config.data.baseUrl) : "";

  const q = query.trim().toLowerCase();
  const shown = (links.data ?? []).filter(
    (l) => !q || l.slug.includes(q) || l.title.toLowerCase().includes(q) || l.target.toLowerCase().includes(q),
  );

  return (
    <>
      <PageHeader title="Links" subtitle={base ? `Short links on ${base}` : "Your short links"} back="/" />
      {/* One polite region for copy, save and delete results; focus never moves. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      <Panel className="mt-38">
        <h2 className="text-heading-green px-10 pb-16 text-heading">New link</h2>
        <CreateForm
          base={base}
          announce={setStatus}
          onCreated={(l) => {
            setOpen(l.id);
            links.reload();
          }}
        />
      </Panel>

      <Panel className="mt-56">
        <div className="flex items-baseline justify-between gap-16 px-10 pb-16">
          <h2 className="text-heading-green text-heading">Your links</h2>
          <span className="text-small text-muted">
            {links.refreshing ? "Refreshing..." : links.data ? `${links.data.length} in total` : ""}
          </span>
        </div>

        {links.data && links.data.length > 0 ? (
          <label className="mb-24 block">
            <span className="sr-only">Search links</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search slug, title or URL"
              className={input}
            />
          </label>
        ) : null}

        {links.error ? (
          <div className="mb-24 flex flex-wrap items-center justify-between gap-16 rounded-card bg-card px-24 py-16 text-body text-maroon">
            <span>{links.data ? `Could not refresh: ${links.error.message}` : links.error.message}</span>
            <Button variant="text" onClick={links.reload} busy={links.refreshing || links.loading}>
              Try again
            </Button>
          </div>
        ) : null}

        {links.loading ? (
          <Card>
            <p role="status" className="px-24 py-24 text-body text-muted">
              Loading links...
            </p>
          </Card>
        ) : links.data ? (
          shown.length === 0 ? (
            <Card>
              <p className="px-24 py-24 text-body text-muted">
                {links.data.length === 0 ? "No links yet. Make the first one above." : `No link matches “${query.trim()}”.`}
              </p>
            </Card>
          ) : (
            <ul className="grid gap-24">
              {shown.map((l) => (
                <LinkItem
                  key={l.id}
                  link={l}
                  open={open === l.id}
                  onToggle={() => setOpen(open === l.id ? undefined : l.id)}
                  onChanged={links.reload}
                  onDeleted={() => {
                    setOpen(undefined);
                    links.reload();
                  }}
                  announce={setStatus}
                />
              ))}
            </ul>
          )
        ) : null}
      </Panel>
    </>
  );
}

function CreateForm({ base, announce, onCreated }: { base: string; announce: Announce; onCreated: (l: ShortLink) => void }) {
  const [target, setTarget] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const [created, setCreated] = useState<ShortLink>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFailure("");
    try {
      const l = await post<ShortLink>("/links", { target, slug, title });
      setTarget("");
      setSlug("");
      setTitle("");
      setCreated(l);
      announce(`Created ${bare(l.shortUrl)}`);
      onCreated(l);
    } catch (err) {
      const a = err as ApiError;
      const fields = fieldErrors(a);
      setErrors(fields);
      setFailure(Object.keys(fields).length ? "" : a.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-28">
      <form onSubmit={submit} className="grid gap-28" noValidate>
        <Field label="Long URL" error={errors.target}>
          {(a) => (
            <input
              {...a}
              type="url"
              required
              inputMode="url"
              autoComplete="off"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://example.com/a/long/page"
              className={input}
            />
          )}
        </Field>
        <Field label="Custom slug (optional, random when empty)" error={errors.slug}>
          {(a) => (
            <div className={`${input} flex items-center gap-4 focus-within:border-green focus-within:ring-2 focus-within:ring-green/20`}>
              {base ? <span className="shrink-0 text-muted">{base}/</span> : null}
              <input
                {...a}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="cv"
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </div>
          )}
        </Field>
        <Field label="Title (optional, only you see it)" error={errors.title}>
          {(a) => <input {...a} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />}
        </Field>
        {failure ? <p className="text-body text-maroon">{failure}</p> : null}
        <Button type="submit" variant="primary" busy={busy}>
          {busy ? "Shortening..." : "Shorten"}
        </Button>
      </form>

      {created ? (
        <div className="mt-28 flex flex-wrap items-center justify-between gap-16 rounded-card bg-mint px-24 py-16">
          <span className="min-w-0 text-body">
            Ready: <span className="font-bold break-all text-green">{bare(created.shortUrl)}</span>
          </span>
          <Button variant="secondary" onClick={() => copy(created, announce)}>
            Copy
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function LinkItem({
  link,
  open,
  onToggle,
  onChanged,
  onDeleted,
  announce,
}: {
  link: ShortLink;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  announce: Announce;
}) {
  const detailsId = useId();
  const state = !link.enabled ? "Paused" : expired(link) ? "Expired" : "";
  return (
    <li>
      <Card className="px-28 py-24">
        <div className="flex items-start justify-between gap-16">
          <div className="min-w-0">
            <p className="text-body font-bold break-all text-blue">{bare(link.shortUrl)}</p>
            <p className="truncate text-small text-muted" title={link.target}>
              {link.title || bare(link.target)}
            </p>
            <p className="text-small text-ink">
              {visits(link.clicks)}
              {state ? <span className="ml-12 rounded-card bg-panel px-12 text-maroon">{state}</span> : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <Button variant="text" onClick={() => copy(link, announce)}>
              Copy
            </Button>
            <Button variant="text" aria-expanded={open} aria-controls={detailsId} onClick={onToggle}>
              {open ? "Close" : "Details"}
            </Button>
          </div>
        </div>
        {open ? (
          <div id={detailsId} className="mt-24 grid gap-40 border-t border-line pt-28">
            <a href={link.target} target="_blank" rel="noopener noreferrer" className="text-small break-all text-blue underline">
              {link.target}
            </a>
            <QrCode value={link.shortUrl} name={link.slug} />
            <Stats link={link} />
            <EditForm key={link.updatedAt} link={link} onSaved={onChanged} announce={announce} />
            <Danger link={link} onChanged={onChanged} onDeleted={onDeleted} announce={announce} />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function Stats({ link }: { link: ShortLink }) {
  const stats = useApi<LinkStats>(`/links/${link.id}/stats?days=30`);
  return (
    <section aria-label="Visits in the last 30 days">
      <h3 className="text-heading-green text-body font-bold">Last 30 days</h3>
      {stats.loading ? <p className="text-small text-muted">Loading visits...</p> : null}
      {stats.error && !stats.data ? (
        <p className="text-small text-maroon">
          {stats.error.message}{" "}
          <Button variant="text" onClick={stats.reload}>
            Try again
          </Button>
        </p>
      ) : null}
      {stats.data ? (
        <>
          <p className="text-small text-muted">
            {visits(stats.data.total)}
            {stats.data.bots ? `, plus ${stats.data.bots} from link previews and bots, not counted` : ""}
            {link.lastClickedAt ? `. Last visit ${shortDate(toWIB(link.lastClickedAt))}.` : "."}
          </p>
          <DailyBars daily={stats.data.daily} />
          <div className="mt-16 grid grid-cols-3 gap-40 text-small">
            <Breakdown title="From" rows={stats.data.referrers} blank="Direct" />
            <Breakdown title="Country" rows={stats.data.countries} blank="Unknown" name={countryName} />
            <Breakdown title="Device" rows={stats.data.devices} blank="Unknown" name={(d) => d.charAt(0).toUpperCase() + d.slice(1)} />
          </div>
        </>
      ) : null}
    </section>
  );
}

const regions = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : undefined;
const countryName = (code: string) => {
  try {
    return regions?.of(code) ?? code;
  } catch {
    return code;
  }
};

/** Bars per day; a day without visits has no bar, never a fake minimum. */
function DailyBars({ daily }: { daily: LinkCount[] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const w = 300 / Math.max(1, daily.length);
  const busiest = daily.reduce((b, d) => (d.count > b.count ? d : b), { key: "", count: 0 });
  const summary = busiest.count
    ? `Visits per day. Busiest day ${shortDate(busiest.key)} with ${visits(busiest.count)}.`
    : "Visits per day. No visits in this period.";
  return (
    <figure className="mt-16">
      <svg viewBox="0 0 300 64" role="img" aria-label={summary} className="h-auto w-full" preserveAspectRatio="none">
        <line x1="0" y1="63.5" x2="300" y2="63.5" stroke="var(--color-line)" strokeWidth="1" />
        {daily.map((d, i) =>
          d.count ? (
            <rect key={d.key} x={i * w + w * 0.15} width={w * 0.7} y={64 - (d.count / max) * 60} height={(d.count / max) * 60} rx="1.5" fill="var(--color-leaf)" />
          ) : null,
        )}
      </svg>
      {daily.length ? (
        <figcaption className="flex justify-between text-small text-muted">
          <span>{shortDate(daily[0].key)}</span>
          <span>{shortDate(daily[daily.length - 1].key)}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}

function Breakdown({ title, rows, blank, name = (k) => k }: { title: string; rows: LinkCount[]; blank: string; name?: (k: string) => string }) {
  return (
    <div className="min-w-0">
      <h4 className="text-muted">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-muted">-</p>
      ) : (
        <ul>
          {rows.slice(0, 5).map((r) => (
            <li key={r.key} className="flex justify-between gap-8">
              <span className="truncate" title={r.key ? name(r.key) : blank}>
                {r.key ? name(r.key) : blank}
              </span>
              <span className="shrink-0 font-bold">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditForm({ link, onSaved, announce }: { link: ShortLink; onSaved: () => void; announce: Announce }) {
  const [target, setTarget] = useState(link.target);
  const [slug, setSlug] = useState(link.slug);
  const [title, setTitle] = useState(link.title);
  const [notes, setNotes] = useState(link.notes);
  const [expires, setExpires] = useState(link.expiresAt ? toWIB(link.expiresAt) : "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState("");
  const slugLocked = link.clicks > 0;

  const changes: Record<string, string> = {};
  if (target.trim() !== link.target) changes.target = target;
  if (!slugLocked && slug.trim().toLowerCase() !== link.slug) changes.slug = slug;
  if (title.trim() !== link.title) changes.title = title;
  if (notes.trim() !== link.notes) changes.notes = notes;
  if (expires !== (link.expiresAt ? toWIB(link.expiresAt) : "")) changes.expiresAt = expires ? fromWIB(expires) : "";
  const dirty = Object.keys(changes).length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setErrors({});
    setFailure("");
    try {
      const l = await patch<ShortLink>(`/links/${link.id}`, changes);
      announce(`Saved ${bare(l.shortUrl)}`);
      onSaved();
    } catch (err) {
      const a = err as ApiError;
      const fields = fieldErrors(a);
      setErrors(fields);
      setFailure(Object.keys(fields).length ? "" : a.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-28" noValidate>
      <h3 className="text-heading-green text-body font-bold">Edit</h3>
      <Field label="Long URL" error={errors.target}>
        {(a) => <input {...a} type="url" inputMode="url" value={target} onChange={(e) => setTarget(e.target.value)} className={input} />}
      </Field>
      <Field
        label="Slug"
        error={errors.slug}
        hint={slugLocked ? "Fixed: the link already has visits. Make a new link for a new slug." : undefined}
      >
        {(a) => (
          <input
            {...a}
            disabled={slugLocked}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className={`${input} disabled:text-muted`}
          />
        )}
      </Field>
      <Field label="Title" error={errors.title}>
        {(a) => <input {...a} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />}
      </Field>
      <Field label="Notes" error={errors.notes}>
        {(a) => <textarea {...a} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${input} resize-none`} />}
      </Field>
      <Field label="Expires (WIB, empty for never)" error={errors.expiresAt}>
        {(a) => <input {...a} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} className={input} />}
      </Field>
      {failure ? <p className="text-body text-maroon">{failure}</p> : null}
      <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>
        {busy ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}

function Danger({ link, onChanged, onDeleted, announce }: { link: ShortLink; onChanged: () => void; onDeleted: () => void; announce: Announce }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function run(action: () => Promise<unknown>, done: string, after: () => void) {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      await action();
      announce(done);
      after();
    } catch (err) {
      setFailure((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const name = bare(link.shortUrl);
  const toggle = () =>
    run(() => patch(`/links/${link.id}`, { enabled: !link.enabled }), `${link.enabled ? "Paused" : "Resumed"} ${name}`, onChanged);
  const remove = () => run(() => del(`/links/${link.id}`), `Deleted ${name}`, onDeleted);

  return (
    <div className="grid gap-16">
      <p className="text-small text-muted">
        {link.enabled ? "A paused link shows “Link not found” until you resume it." : "Paused: visitors see “Link not found”."}
      </p>
      {confirming ? (
        <div className="grid gap-16 rounded-card bg-panel p-24">
          <p className="text-body text-maroon">Delete {name} for good? The slug stays reserved and cannot be used again.</p>
          <div className="flex gap-16">
            <Button variant="danger" busy={busy} onClick={remove} className="flex-1">
              {busy ? "Deleting..." : "Delete"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy} className="flex-1">
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-16">
          <Button variant="secondary" busy={busy} onClick={toggle} className="flex-1">
            {link.enabled ? "Pause link" : "Resume link"}
          </Button>
          <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy} className="flex-1">
            Delete
          </Button>
        </div>
      )}
      {failure ? <p className="text-body text-maroon">{failure}</p> : null}
    </div>
  );
}

const input =
  "w-full rounded-card border border-line bg-card px-24 py-16 text-body text-ink outline-none focus:border-green focus:ring-2 focus:ring-green/20 aria-invalid:border-maroon";

/** Label, control and an error or hint tied to the control for assistive technology. */
function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (a: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="grid gap-8">
      <label htmlFor={id} className="text-small text-muted">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": note ? noteId : undefined })}
      {note ? (
        <span id={noteId} className={`text-small ${error ? "text-maroon" : "text-muted"}`}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

