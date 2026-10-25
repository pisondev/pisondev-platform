// Shapes returned by the Go API (services/api/internal/finance).

export type User = { email: string; role: "main" | "backup" };

export type Transaction = {
  id: string;
  date: string | null; // YYYY-MM-DD or YYYY-MM-DDTHH:mm, WIB
  name: string;
  type: "Masuk" | "Keluar" | "Saldo Awal" | string;
  category: string;
  account: string;
  amount: number | null;
  reportedAmount: number | null;
  reportedDate: string | null;
  status: string;
  notes: string;
};

export type Summary = { balance: number; account: string; asOf: string };

export type CashflowPoint = {
  label: string;
  start: string;
  end: string;
  income: number;
  outcome: number;
  net: number;
};

export type Cashflow = { granularity: "monthly" | "weekly"; points: CashflowPoint[] };

export type SubItem = {
  id: string;
  name: string;
  price: number;
  cycle: string;
  billingDay: number | null;
  nextBilling: string | null;
  notes: string;
};

export type Subscriptions = {
  monthly: { items: SubItem[]; total: number };
  yearly: { items: SubItem[]; total: number };
  roster: { month: string; items: (SubItem & { paid: boolean })[]; total: number };
  savings: number;
  status: "safe" | "short";
};

export type ExpenseItem = { id: string; date: string; name: string; amount: number; notes: string };

export type SavingsRow = {
  label: string;
  start?: string;
  end?: string;
  amount: number | null;
  notes: string;
  estimated: boolean;
  genesis: boolean;
};

export type Quota = {
  today: string;
  period: { start: string; end: string };
  balance: number;
  max: number;
  spent: number;
  remaining: number;
  percent: number;
  level: "empty" | "green" | "yellow" | "red";
  nextWeekMax: number;
  breakdown: {
    deadline: string;
    deadlineSource: string;
    weeksToDeadline: number;
    depositsExpected: number;
    subscriptionsDue: number;
    freeFunds: number;
    weeklyAllowance: number;
    minBalance: number;
  };
  expenses: ExpenseItem[];
  savings: {
    save: number;
    target: number;
    gap: number;
    status: "safe" | "short";
    cycleStart: string;
    rows: SavingsRow[];
  };
};

export type Options = Record<string, string[]>;

// Shapes returned by the link shortener (services/api/internal/links).

export type ShortLink = {
  id: string;
  slug: string;
  shortUrl: string;
  target: string;
  title: string;
  notes: string;
  enabled: boolean;
  expiresAt: string | null; // RFC 3339 instant
  clicks: number; // human visits; bots are logged, not counted
  lastClickedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export type LinkConfig = { baseUrl: string };

export type LinkCount = { key: string; count: number };

export type LinkStats = {
  days: number;
  total: number;
  bots: number;
  daily: LinkCount[]; // key: YYYY-MM-DD in WIB, every day present
  referrers: LinkCount[];
  countries: LinkCount[];
  devices: LinkCount[];
};
