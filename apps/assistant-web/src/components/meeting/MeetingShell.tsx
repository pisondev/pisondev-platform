import Link from "next/link";
import { MEETING_PATH } from "@/lib/meeting";
import { Icon } from "./Icon";

export function MeetingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="meeting-app" lang="id">
      <header className="m-topbar">
        <div className="m-topbar-inner">
          <Link
            href={MEETING_PATH}
            className="m-brand"
            aria-label="Pison Meet home"
          >
            <span className="m-brand-mark">
              <Icon name="calendar" size={23} />
            </span>
            <span>
              pison<span className="m-brand-divider">/</span>
              <strong>meet</strong>
            </span>
          </Link>
          <nav aria-label="Meeting navigation">
            <Link href={MEETING_PATH} className="m-nav-active">
              Find a time
            </Link>
            <Link href={`${MEETING_PATH}/demo`}>
              Try the demo <Icon name="arrow" size={15} />
            </Link>
          </nav>
          <Link className="m-workspace-link" href="/">
            My workspace <Icon name="grid" size={16} />
          </Link>
        </div>
      </header>
      <main className="m-main">{children}</main>
      <footer className="m-footer">
        <Link href={MEETING_PATH} className="m-footer-brand">
          pison / meet
        </Link>
        <span>A little less planning. A lot more meeting.</span>
        <span>
          Made for time together <span className="m-footer-dot" />
        </span>
      </footer>
    </div>
  );
}
