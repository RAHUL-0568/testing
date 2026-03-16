"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "../lib/analytics";

function getAuthForTracking(): { user?: unknown } | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem("cray_auth_data");
    return raw ? (JSON.parse(raw) as { user?: unknown }) : undefined;
  } catch {
    return undefined;
  }
}

const DISCLAIMER_DONT_SHOW_KEY = "cray_disclaimer_dont_show";
const OVERVIEW_SESSION_KEY = "cray_overview_session";
const SAVED_REPORTS_KEY = "cray_saved_reports";
/** Background Check form (First Name, Last Name, State) saved in localStorage so it persists across sessions */
const BACKGROUND_CHECK_FORM_KEY = "cray_background_check_form";

interface BackgroundCheckFormLocal {
  firstName: string;
  lastName: string;
  state: string;
}

function getBackgroundCheckFormFromLocal(): BackgroundCheckFormLocal | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BACKGROUND_CHECK_FORM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BackgroundCheckFormLocal;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setBackgroundCheckFormToLocal(form: BackgroundCheckFormLocal): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BACKGROUND_CHECK_FORM_KEY, JSON.stringify(form));
  } catch {
    // ignore
  }
}

type OverviewView =
  | "dashboard"
  | "no-contacts"
  | "scan-options"
  | "connection-type"
  | "step3-details"
  | "questions"
  | "report"
  | "catfish"
  | "catfish-run"
  | "background-check"
  | "background-check-run"
  | "background-check-details";

interface OverviewSession {
  view: OverviewView;
  // Optional source to know where the user started this flow from (e.g. Contacts)
  source?: "contacts";
  // True when user opened a report via "View Score" from Contacts
  fromViewScore?: boolean;
  selectedCardId?: string | null;
  scanOption?: "quick" | "medium" | "full";
  connectionType?: "in-person" | "online";
  knownDurationValue?: number;
  knownDurationUnit?: "days" | "weeks" | "months" | "years";
  lastAddedContactName?: string;
  lastAddedContactPhone?: string;
  currentQuestionIndex?: number;
  questionAnswers?: Record<string, "yes" | "no" | "notSure">;
  quitSummary?: QuitSummary | null;
  reportAnswerFilter?: "all" | "yes" | "no" | "notSure";
  reportExpandedCategory?: string | null;
  // Background Check flow only
  backgroundCheckFirstName?: string;
  backgroundCheckLastName?: string;
  backgroundCheckState?: string;
  selectedBackgroundContactIndex?: number | null;
}

function loadOverviewSession(): OverviewSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(OVERVIEW_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OverviewSession;
    if (!parsed?.view) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveOverviewSession(session: OverviewSession): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(OVERVIEW_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export interface OverviewProps {
  firstName: string;
  lastName: string;
  accessToken?: string;
  /** When true, user returned from successful Background Check payment; show details view and call getBackgroundVerification */
  backgroundCheckPaymentSuccess?: boolean;
  /** Called after handling payment return (navigate to details + call API); use to e.g. clear success query param */
  onBackgroundCheckPaymentReturn?: () => void;
}

const cards = [
  {
    id: "crayscore",
    title: "CrayScore™",
    description:
      "Respond to statements about your partner and relationship with them to check for possible red flags.",
    icon: "✓",
    iconBg: "bg-red-600",
  },
  {
    id: "schemerscore",
    title: "SchemerScore™",
    description:
      "Respond to statements to see if your partner might be subtly manipulating you for their own gain.",
    icon: "🎭",
    iconBg: "bg-red-600",
  },
  {
    id: "catfish",
    title: "Catfish Check",
    description:
      "Respond to statements to see if your partner might be subtly manipulating you for their own gain.",
    icon: "🐟",
    iconBg: "bg-red-600",
  },
  {
    id: "background",
    title: "Background Check",
    description:
      "Check to make sure the person you're dating is who they say they are and see if they have a clean record.",
    icon: "👤",
    iconBg: "bg-red-600",
  },
];

// Exclude encrypted/base64 or non-name values from display (e.g. empty lastName from backend)
function isDisplayableName(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (t.includes("=")) return false;
  return true;
}

type Contact = { name: string; countryCode: string; phone: string; email?: string; source?: "crayscore" | "schemerscore" };

/** Normalize to digits only; strip leading country code from phone to get national number */
function getNationalDigits(countryCode: string, phone: string): string {
  const ccDigits = countryCode.replace(/\D/g, "");
  let pDigits = phone.replace(/\D/g, "");
  if (ccDigits && pDigits.startsWith(ccDigits)) pDigits = pDigits.slice(ccDigits.length);
  return pDigits;
}

/** Full number digits only, for duplicate check */
function normalizePhoneForCompare(countryCode: string, phone: string): string {
  const national = getNationalDigits(countryCode, phone);
  const ccDigits = countryCode.replace(/\D/g, "");
  return (ccDigits + national).replace(/\D/g, "");
}

/** Format for display: "+91 6230071420" (no duplicated country code) */
function formatContactPhone(countryCode: string, phone: string): string {
  const national = getNationalDigits(countryCode, phone);
  if (!national) return phone?.trim() || "—";
  const cc = countryCode.trim() || "+1";
  return `${cc} ${national}`;
}

/** Validate mobile: national number 7–15 digits */
function isValidPhoneNumber(countryCode: string, phone: string): { valid: boolean; message?: string } {
  const national = getNationalDigits(countryCode, phone);
  if (!national || national.length < 7) return { valid: false, message: "Enter a valid mobile number (at least 7 digits)." };
  if (national.length > 15) return { valid: false, message: "Mobile number is too long." };
  if (!/^\d+$/.test(national)) return { valid: false, message: "Mobile number can only contain digits." };
  return { valid: true };
}

export interface QuestionItem {
  _id: string;
  question: string;
  description?: string;
  questionNotmet?: string;
  points?: number;
  category?: string;
  subcategory?: string;
  [key: string]: unknown;
}

export type SavedAnswer = {
  questionId: string;
  questionText: string;
  answer: "yes" | "no" | "notSure";
  category?: string;
  subcategory?: string;
  description?: string;
  points?: number;
  weight?: number;
};

export type QuitSummary = {
  answers: SavedAnswer[];
  reviewType: "quick" | "medium" | "full";
  categoryCounts: Record<string, number>;
  reportType?: "schemerscore" | "crayscore";
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Legal History": ["legal", "minor", "police", "court", "arrest", "conviction", "charged", "inappropriate circumstances"],
  "Substance Use": ["substance", "alcohol", "drug", "drinking", "drunk", "intoxicated"],
  "Empathy & Selfishness": ["empathy", "selfish", "self-centered"],
  "Violence & Safety Risks": ["violence", "abuse", "harm", "physical", "hit", "hurt", "psychological", "consent boundaries", "sexual abuse"],
  "Control & Coercion": ["control", "coercion", "domineering", "power-seeking", "boundaries"],
};

// CrayScore report: five categories for "How you answered"
const REPORT_CATEGORY_ORDER = ["Control & Coercion", "Empathy & Selfishness", "Legal History", "Substance Use", "Violence & Safety Risks"] as const;

// Schemer report: five categories (user-requested; no Control & Coercion / Legal History in list)
const SCHEMER_REPORT_CATEGORY_ORDER = ["Attention Seeking", "Deception", "Exploitation", "Manipulation", "Sexual Opportunism"] as const;

// Map SchemerScore API subcategories to Schemer report categories
const SCHEMER_SUBCATEGORY_TO_REPORT: Record<string, string> = {
  "domineering / power-seeking behavior": "Manipulation",
  "power-seeking": "Manipulation",
  "emotional": "Manipulation",
  "financial fraud": "Deception",
  "urgent plans": "Attention Seeking",
  "evasion": "Deception",
  "lack of emotional inv.": "Manipulation",
  "image crafting": "Attention Seeking",
  "financial solicitation": "Exploitation",
  "transactional intent": "Exploitation",
  "financial entitlement": "Exploitation",
  "attention_seeking": "Attention Seeking",
  "attention seeking": "Attention Seeking",
  "deception": "Deception",
  "exploitation": "Exploitation",
  "manipulation": "Manipulation",
  "sexual opportunism": "Sexual Opportunism",
};

// When Schemer question has no category/subcategory from API, infer from question text
const SCHEMER_KEYWORDS: Record<string, string[]> = {
  "Deception": ["deceit", "deception", "lie", "lying", "evasion", "evasive", "fraud", "dishonest", "conceal", "mislead", "false", "fabricat"],
  "Exploitation": ["exploit", "exploitation", "solicit", "solicitation", "transactional", "entitlement", "financial gain", "use you", "take advantage"],
  "Manipulation": ["manipulat", "control", "domineering", "power-seeking", "emotional inv", "guilt", "pressure", "coerc"],
  "Sexual Opportunism": ["sexual", "sex ", "intimacy", "physical advance", "opportunism", "romantic", "flirt", "boundary"],
  "Attention Seeking": ["attention", "image", "craft", "urgent", "dramat", "center of attention", "show off", "impress"],
};

function getCategoryFromQuestion(q: QuestionItem, isSchemerScore?: boolean): string | undefined {
  const cat = (q.category || q.subcategory) as string | undefined;
  if (cat && typeof cat === "string" && cat.trim()) {
    const trimmed = cat.trim();
    const lower = trimmed.toLowerCase();
    if (isSchemerScore) {
      const schemerOrder = SCHEMER_REPORT_CATEGORY_ORDER as unknown as readonly string[];
      if (schemerOrder.some((c) => c.toLowerCase() === lower)) return schemerOrder.find((c) => c.toLowerCase() === lower)!;
      if (SCHEMER_SUBCATEGORY_TO_REPORT[lower]) return SCHEMER_SUBCATEGORY_TO_REPORT[lower];
      for (const [sub, category] of Object.entries(SCHEMER_SUBCATEGORY_TO_REPORT)) {
        if (lower.includes(sub)) return category;
      }
      return SCHEMER_REPORT_CATEGORY_ORDER[0];
    }
    if (REPORT_CATEGORY_ORDER.some((c) => c.toLowerCase() === lower)) return REPORT_CATEGORY_ORDER.find((c) => c.toLowerCase() === lower)!;
    return trimmed;
  }
  const text = `${q.question || ""} ${q.questionNotmet || ""} ${q.description || ""}`.toLowerCase();
  if (isSchemerScore) {
    for (const [category, keywords] of Object.entries(SCHEMER_KEYWORDS)) {
      if (keywords.some((kw) => text.includes(kw))) return category;
    }
    return SCHEMER_REPORT_CATEGORY_ORDER[0];
  }
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return category;
  }
  return undefined;
}

/** Map API result/schemerResult items (primaryCategory, subCategory, question, questionNotmet) to QuestionItem shape. */
function mapApiQuestionsToQuestionItems(raw: unknown[]): QuestionItem[] {
  return raw.map((item: unknown) => {
    const o = item as Record<string, unknown>;
    return {
      _id: String(o._id ?? ""),
      question: String(o.question ?? ""),
      questionNotmet: o.questionNotmet != null ? String(o.questionNotmet) : undefined,
      description: o.description != null ? String(o.description) : undefined,
      points: typeof o.points === "number" ? o.points : undefined,
      category: o.primaryCategory != null ? String(o.primaryCategory) : (o.category != null ? String(o.category) : undefined),
      subcategory: o.subCategory != null ? String(o.subCategory) : (o.subcategory != null ? String(o.subcategory) : undefined),
      ...o,
    } as QuestionItem;
  });
}

export default function Overview({
  firstName,
  lastName,
  accessToken,
  backgroundCheckPaymentSuccess,
  onBackgroundCheckPaymentReturn,
}: OverviewProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [view, setViewState] = useState<OverviewView>(() => {
    const session = loadOverviewSession();
    return (session?.view && session.view !== "dashboard" ? session.view : "dashboard") as OverviewView;
  });
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactCountryCode, setContactCountryCode] = useState("+1");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [catfishInlineAdd, setCatfishInlineAdd] = useState(false);
  const [selectedCatfishContactIndices, setSelectedCatfishContactIndices] = useState<Set<number>>(new Set());
  const [catfishCheckModalOpen, setCatfishCheckModalOpen] = useState(false);
  const [catfishCheckoutError, setCatfishCheckoutError] = useState<string | null>(null);
  const [catfishCheckoutLoading, setCatfishCheckoutLoading] = useState(false);
  const [selectedBackgroundContactIndex, setSelectedBackgroundContactIndex] = useState<number | null>(
    () => loadOverviewSession()?.selectedBackgroundContactIndex ?? null
  );
  const [backgroundCheckoutModalOpen, setBackgroundCheckoutModalOpen] = useState(false);
  const [backgroundCheckoutLoading, setBackgroundCheckoutLoading] = useState(false);
  const [backgroundCheckoutError, setBackgroundCheckoutError] = useState<string | null>(null);
  const [backgroundCheckFirstName, setBackgroundCheckFirstName] = useState(() => {
    const session = loadOverviewSession();
    const local = getBackgroundCheckFormFromLocal();
    return session?.backgroundCheckFirstName ?? local?.firstName ?? "";
  });
  const [backgroundCheckLastName, setBackgroundCheckLastName] = useState(() => {
    const session = loadOverviewSession();
    const local = getBackgroundCheckFormFromLocal();
    return session?.backgroundCheckLastName ?? local?.lastName ?? "";
  });
  const [backgroundCheckState, setBackgroundCheckState] = useState(() => {
    const session = loadOverviewSession();
    const local = getBackgroundCheckFormFromLocal();
    return session?.backgroundCheckState ?? local?.state ?? "";
  });
  const [backgroundStates, setBackgroundStates] = useState<{ name: string; code: string }[]>([]);
  const [backgroundStatesLoading, setBackgroundStatesLoading] = useState(false);
  const [backgroundStatesError, setBackgroundStatesError] = useState<string | null>(null);
  const [showBackgroundCheckPaymentSuccessBanner, setShowBackgroundCheckPaymentSuccessBanner] = useState(false);
  const [backgroundVerificationListFetched, setBackgroundVerificationListFetched] = useState<boolean | null>(null);
  const [addContactLoading, setAddContactLoading] = useState(false);
  const [addContactError, setAddContactError] = useState<string | null>(null);
  const [disclaimerModalOpen, setDisclaimerModalOpen] = useState(false);
  const [disclaimerDontShowAgain, setDisclaimerDontShowAgain] = useState(false);
  const [lastAddedContactName, setLastAddedContactName] = useState(() => loadOverviewSession()?.lastAddedContactName ?? "");
  const [lastAddedContactPhone, setLastAddedContactPhone] = useState(() => loadOverviewSession()?.lastAddedContactPhone ?? "");
  const [scanOption, setScanOption] = useState<"quick" | "medium" | "full">(() => loadOverviewSession()?.scanOption ?? "quick");
  const [connectionType, setConnectionType] = useState<"in-person" | "online">(() => loadOverviewSession()?.connectionType ?? "online");
  const [knownDurationModalOpen, setKnownDurationModalOpen] = useState(false);
  const validDurationUnits = ["days", "weeks", "months", "years"] as const;
  const getMaxDurationForUnit = (unit: "days" | "weeks" | "months" | "years") =>
    unit === "days" ? 31 : unit === "weeks" ? 52 : unit === "months" ? 12 : 99;
  const clampDurationValueForUnit = (n: number, unit: "days" | "weeks" | "months" | "years") => {
    const max = getMaxDurationForUnit(unit);
    const num = Number.isFinite(n) ? Math.floor(n) : 1;
    return Math.min(max, Math.max(1, num));
  };
  const [knownDurationUnit, setKnownDurationUnit] = useState<"days" | "weeks" | "months" | "years">(() => {
    const u = loadOverviewSession()?.knownDurationUnit ?? "weeks";
    return validDurationUnits.includes(u) ? u : "weeks";
  });
  const [knownDurationValue, setKnownDurationValue] = useState(() => {
    const session = loadOverviewSession();
    const unit = session?.knownDurationUnit && validDurationUnits.includes(session.knownDurationUnit) ? session.knownDurationUnit : "weeks";
    return clampDurationValueForUnit(session?.knownDurationValue ?? 4, unit);
  });
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(() => loadOverviewSession()?.currentQuestionIndex ?? 0);
  // Do not restore previous answers automatically; start each session with no pre-selected options
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, "yes" | "no" | "notSure">>({});
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [reviewProgressModalOpen, setReviewProgressModalOpen] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [restoringQuestions, setRestoringQuestions] = useState(false);
  const [contactListLoading, setContactListLoading] = useState(false);
  const [quitSummary, setQuitSummary] = useState<QuitSummary | null>(() => {
    const session = loadOverviewSession();
    if (session?.view === "report" && session.quitSummary) return session.quitSummary;
    return null;
  });
  const [reportExpandedCategory, setReportExpandedCategory] = useState<string | null>(() => {
    const session = loadOverviewSession();
    return session?.reportExpandedCategory ?? null;
  });
  const [reportFilterModalOpen, setReportFilterModalOpen] = useState(false);
  const [reportAnswerFilter, setReportAnswerFilter] = useState<"all" | "yes" | "no" | "notSure">(() => {
    const session = loadOverviewSession();
    return session?.reportAnswerFilter ?? "all";
  });
  const [reportFilterModalSelection, setReportFilterModalSelection] = useState<"all" | "yes" | "no" | "notSure">("all");
  const [saveReportLoading, setSaveReportLoading] = useState(false);
  const [saveReportError, setSaveReportError] = useState<string | null>(null);
  const [reportEditingQuestionId, setReportEditingQuestionId] = useState<string | null>(null);
  const reportInitialExpandedDone = useRef(false);
  const autoSchemerFromContactsStarted = useRef(false);
  const [selectedContactIndex, setSelectedContactIndex] = useState<number | null>(null);
  const [sessionSource] = useState<"contacts" | undefined>(() => {
    const session = loadOverviewSession();
    return session?.source === "contacts" ? "contacts" : undefined;
  });
  const [sessionFromViewScore] = useState<boolean>(() => {
    const session = loadOverviewSession();
    return session?.fromViewScore === true;
  });
  const router = useRouter();

  const fetchContactList = useCallback(async () => {
    if (!accessToken) return;
    setContactListLoading(true);
    try {
      const res = await fetch("/api/auth/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Use the same Get Contacts API as Contacts page so new contacts appear here too.
        body: JSON.stringify({ accessToken, action: "getContacts" }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      const rawList = Array.isArray(body?.contacts)
        ? body.contacts
        : Array.isArray(body?.result)
        ? body.result
        : Array.isArray(body?.data)
        ? body.data
        : [];
      if (body?.status === "success" && rawList.length >= 0) {
        const mapped = (rawList as { name?: string; phone?: string; email?: string; countryCode?: string; source?: string }[]).map((c): Contact => {
          const cc = c.countryCode ?? "+1";
          const rawPhone = String(c.phone ?? "").trim();
          const national = getNationalDigits(cc, rawPhone) || rawPhone.replace(/\D/g, "");
          return {
            name: c.name ?? "",
            countryCode: cc,
            phone: national,
            email: c.email ?? "",
            source: c.source === "schemerscore" ? "schemerscore" : "crayscore",
          };
        });
        const seen = new Set<string>();
        const list = mapped.filter((c) => {
          const key = normalizePhoneForCompare(c.countryCode, c.phone);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setContacts(list);
        if (list.length > 0) {
          const screenName = view === "no-contacts" ? "Home Screen" : "Settings Screen";
          trackEvent("Contacts Synced", { screen_name: screenName }, getAuthForTracking());
        }
      }
    } catch {
      // keep existing contacts on error
    } finally {
      setContactListLoading(false);
    }
  }, [accessToken, view]);

  useEffect(() => {
    if (
      accessToken &&
      (view === "dashboard" ||
        view === "no-contacts" ||
        view === "catfish" ||
        view === "catfish-run" ||
        view === "background-check" ||
        view === "background-check-run" ||
        view === "background-check-details")
    ) {
      fetchContactList();
    }
  }, [accessToken, view, fetchContactList]);

  const overviewScreenNames: Partial<Record<OverviewView, string>> = {
    questions: "Questions Screen",
    report: "Report Screen",
    "step3-details": "Score Review Screen",
    "background-check-details": "Background Verification Details Screen",
  };
  useEffect(() => {
    const screenName = overviewScreenNames[view];
    if (screenName) {
      trackEvent("Page Viewed", { screen_name: screenName }, getAuthForTracking());
    }
  }, [view]);

  const setView = useCallback((next: OverviewView | ((prev: OverviewView) => OverviewView)) => {
    setViewState(next);
  }, []);

  // CrayScore: total 74 questions across all levels:
  // Quick = 10 (Q1-10), Medium = 28 (Q11-38), Full = 36 (Q39-74)
  const questionLimitByScan = { quick: 10, medium: 28, full: 36 };
  const CRAY_TOTAL_MAX = 74;

  /** Shuffle array (Fisher–Yates) without mutating original. */
  const shuffle = useCallback(<T,>(arr: T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }, []);

  /** Get question weight for prioritization; default 1 if missing. */
  const getQuestionWeight = useCallback((q: QuestionItem): number => {
    const w = (q as Record<string, unknown>).weight;
    return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 1;
  }, []);

  /**
   * Weighted shuffle: order items so higher-weight items are more likely to appear earlier.
   * Keeps order dynamic per contact while prioritizing important (high-weight) questions.
   */
  const weightedShuffle = useCallback(
    <T,>(arr: T[], getWeight: (item: T) => number): T[] => {
      const items = arr.map((item) => ({ item, weight: getWeight(item) }));
      const result: T[] = [];
      while (items.length > 0) {
        const totalWeight = items.reduce((sum, { weight }) => sum + weight, 0);
        let r = Math.random() * totalWeight;
        for (let i = 0; i < items.length; i++) {
          r -= items[i].weight;
          if (r <= 0) {
            result.push(items[i].item);
            items.splice(i, 1);
            break;
          }
        }
      }
      if (typeof window !== "undefined" && result.length > 0) {
        const firstWeights = result.slice(0, 5).map((item) => getWeight(item));
        console.log("[Weighted shuffle] First 5 questions’ weights in order:", firstWeights);
      }
      return result;
    },
    []
  );

  /** For Cray: Quick = tier4 (10). Medium = tier3-only then pad with rest to reach 28 (Q11–Q38). Full = rest (36, Q39–Q74). Weight is used to shuffle/prioritize so important questions tend to appear earlier. */
  const getShuffledCrayQuestions = useCallback(
    (all: QuestionItem[], option: "quick" | "medium" | "full"): QuestionItem[] => {
      const tier4 = all.filter((q) => {
        const v = (q as Record<string, unknown>).tier4;
        return v != null && v !== 0 && String(v).trim() !== "";
      });
      const tier3 = all.filter((q) => {
        const v = (q as Record<string, unknown>).tier3;
        return v != null && v !== 0 && String(v).trim() !== "";
      });
      const tier4Ids = new Set(tier4.map((q) => q._id));
      const tier3Ids = new Set(tier3.map((q) => q._id));
      const tier3Only = tier3.filter((q) => !tier4Ids.has(q._id));
      const rest = all.filter((q) => !tier4Ids.has(q._id) && !tier3Ids.has(q._id));
      if (option === "quick") {
        return weightedShuffle(tier4, getQuestionWeight).slice(0, questionLimitByScan.quick);
      }
      if (option === "medium") {
        const need = questionLimitByScan.medium;
        const mediumPool = [
          ...weightedShuffle(tier3Only, getQuestionWeight),
          ...weightedShuffle(rest, getQuestionWeight),
        ];
        return mediumPool.slice(0, need);
      }
      return weightedShuffle(rest, getQuestionWeight).slice(0, questionLimitByScan.full);
    },
    [weightedShuffle, getQuestionWeight]
  );

  const handleQuit = useCallback(() => {
    // Build report only from questions the user actually answered
    const isSchemer = selectedCardId === "schemerscore";
    const questionMap = new Map(questions.map((q) => [q._id, q]));
    const questionOrder = new Map(questions.map((q, i) => [q._id, i]));
    const fallbackCategory = isSchemer ? SCHEMER_REPORT_CATEGORY_ORDER[0] : REPORT_CATEGORY_ORDER[0];
    const answers: SavedAnswer[] = [];
    for (const [questionId, rawAnswer] of Object.entries(questionAnswers)) {
      const q = questionMap.get(questionId);
      if (!q) continue;
      const answer = rawAnswer;
      let category = getCategoryFromQuestion(q, isSchemer);
      if (!category) category = fallbackCategory;
      answers.push({
        questionId: q._id,
        questionText:
          (connectionType === "online" && q.questionNotmet ? q.questionNotmet : q.question) || "",
        answer,
        category,
        subcategory: (q.subcategory as string) || undefined,
        description: (q.description as string) || undefined,
        points: typeof q.points === "number" ? q.points : undefined,
        weight:
          typeof (q as Record<string, unknown>).weight === "number"
            ? ((q as Record<string, unknown>).weight as number)
            : undefined,
      });
    }
    answers.sort((a, b) => (questionOrder.get(a.questionId) ?? 0) - (questionOrder.get(b.questionId) ?? 0));
    const categoryCounts: Record<string, number> = {};
    for (const a of answers) {
      const cat = a.category || fallbackCategory;
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }
    const yesCount = answers.filter((a) => a.answer === "yes").length;
    const noCount = answers.filter((a) => a.answer === "no").length;
    const notSureCount = answers.filter((a) => a.answer === "notSure").length;
    const score = answers.reduce((sum, a) => {
      if (a.answer !== "yes") return sum;
      const pts = typeof a.points === "number" ? a.points : 0;
      const w = typeof (a as { weight?: number }).weight === "number" ? (a as { weight: number }).weight : 1;
      return sum + pts * w;
    }, 0);
    trackEvent("Quit Verification", {
      is_allowed: true,
      quit_at_number: currentQuestionIndex + 1,
      verification_user_phone_number: lastAddedContactPhone || "",
      verification_user_full_name: lastAddedContactName || "Contact",
    }, getAuthForTracking());
    setQuitSummary({
      answers,
      reviewType: scanOption,
      categoryCounts,
      reportType: isSchemer ? "schemerscore" : "crayscore",
    });
    setViewState("report");
    trackEvent("Score Calculated", {
      is_allowed: true,
      verification_user_phone_number: lastAddedContactPhone || "",
      verification_user_full_name: lastAddedContactName || "Contact",
      total_question_count: answers.length,
      score: Math.round(score),
      yes_answer_count: yesCount,
      no_answer_count: noCount,
      not_sure_answer_count: notSureCount,
    }, getAuthForTracking());
  }, [scanOption, selectedCardId, questions, questionAnswers, connectionType, currentQuestionIndex, lastAddedContactPhone, lastAddedContactName]);

  const handleContinueToDeeperAssessment = useCallback(async () => {
    const nextOption: "medium" | "full" = scanOption === "quick" ? "medium" : "full";
    if (!accessToken || selectedCardId === "schemerscore") return;
    setQuestionsLoading(true);
    setQuestionsError(null);
    try {
      const res = await fetch("/api/auth/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          action: "getQuestionsV3",
          connectionType: connectionType === "in-person" ? "inPerson" : "online",
        }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      if (body?.status !== "success") {
        setQuestionsError(body?.message ?? "Failed to load questions");
        return;
      }
      const mainQuestions = Array.isArray(body.result) ? mapApiQuestionsToQuestionItems(body.result as unknown[]) : [];
      const filteredOnline = mainQuestions.filter((q) => q.questionNotmet && String(q.questionNotmet).trim());
      const questionsList =
        connectionType === "in-person"
          ? mainQuestions
          : filteredOnline.length > 0
            ? filteredOnline
            : mainQuestions;
      const limit = questionLimitByScan[nextOption];
      const toSet = getShuffledCrayQuestions(questionsList, nextOption);
      const final = toSet.length > 0 ? toSet : shuffle(questionsList).slice(0, limit);
      setQuestions((prev) => {
        const startIndex = prev.length;
        setCurrentQuestionIndex(startIndex);
        return [...prev, ...final];
      });
      setScanOption(nextOption);
      setReviewProgressModalOpen(false);
    } catch (e) {
      setQuestionsError(e instanceof Error ? e.message : "Network error");
    } finally {
      setQuestionsLoading(false);
    }
  }, [accessToken, connectionType, scanOption, selectedCardId, getShuffledCrayQuestions, shuffle]);

  const updateReportAnswer = useCallback((questionId: string, newAnswer: "yes" | "no" | "notSure") => {
    setQuitSummary((prev) => {
      if (!prev) return null;
      const answers = prev.answers.map((a) =>
        a.questionId === questionId ? { ...a, answer: newAnswer } : a
      );
      return { ...prev, answers };
    });
    setQuestionAnswers((prev) => ({ ...prev, [questionId]: newAnswer }));
    setReportEditingQuestionId(null);
  }, []);

  const handleSaveReport = useCallback(async () => {
    if (!quitSummary || !accessToken) {
      setSaveReportError("No report data or session. Sign in again.");
      return;
    }
    setSaveReportError(null);
    setSaveReportLoading(true);
    try {
      const nameParts = (lastAddedContactName || "").trim().split(/\s+/);
      const contactFirstName = nameParts[0] ?? "";
      const contactLastName = nameParts.slice(1).join(" ") ?? "";
      const noCount = quitSummary.answers.filter((a) => a.answer === "no").length;
      const weightedScore = quitSummary.answers.reduce((sum, a) => {
        // CrayScore score is based on points of questions answered "Yes"
        if (a.answer !== "yes") return sum;
        const pts = typeof a.points === "number" ? a.points : 0;
        const w = typeof a.weight === "number" ? a.weight : 1;
        return sum + pts * w;
      }, 0);
      const payload = {
        action: "saveQuestionAnswer",
        accessToken,
        reviewId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `rev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        phoneNumber: (lastAddedContactPhone || "").replace(/\D/g, "") || "0",
        firstName: contactFirstName,
        lastName: contactLastName,
        progress: quitSummary.answers.length,
        score: weightedScore,
        position: 0,
        reviewed: true,
        questionArray: JSON.stringify(quitSummary.answers),
        blockerAnsCount: noCount,
        blockerQuestionCount: quitSummary.answers.length,
        dateTime: Date.now(),
      };
      const res = await fetch("/api/auth/save-question-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      if (!res.ok || body?.status !== "success") {
        setSaveReportError(body?.message ?? "Failed to save report.");
        return;
      }
      setSaveReportError(null);
      // Store report locally so details can be shown when API returns empty
      const phoneDigits = (lastAddedContactPhone || "").replace(/\D/g, "") || "";
      if (phoneDigits && typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem(SAVED_REPORTS_KEY);
          const stored = raw ? (JSON.parse(raw) as Record<string, unknown[]>) : {};
          const list = stored[phoneDigits] ?? [];
          list.push({
            _id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            dateTime: Date.now(),
            reportType: quitSummary.reportType ?? "crayscore",
            reviewType: quitSummary.reviewType ?? "quick",
            answers: quitSummary.answers,
            progress: quitSummary.answers.length,
            score: weightedScore,
          });
          stored[phoneDigits] = list;
          localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(stored));
        } catch {
          // ignore
        }
      }
      router.push("/home?view=recent");
    } catch (err) {
      setSaveReportError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaveReportLoading(false);
    }
  }, [quitSummary, accessToken, lastAddedContactName, lastAddedContactPhone, router]);

  // Restore full session on mount (other state beyond initializers)
  useEffect(() => {
    const session = loadOverviewSession();
    if (!session?.view || session.view === "dashboard") {
      setSessionRestored(true);
      return;
    }
    if (session.selectedCardId != null) setSelectedCardId(session.selectedCardId);
    if (session.scanOption) setScanOption(session.scanOption);
    if (session.connectionType) setConnectionType(session.connectionType);
    if (session.knownDurationUnit && validDurationUnits.includes(session.knownDurationUnit))
      setKnownDurationUnit(session.knownDurationUnit);
    if (session.knownDurationValue != null && session.knownDurationUnit && validDurationUnits.includes(session.knownDurationUnit))
      setKnownDurationValue(clampDurationValueForUnit(session.knownDurationValue, session.knownDurationUnit));
    if (session.lastAddedContactName != null) setLastAddedContactName(session.lastAddedContactName);
    if (session.lastAddedContactPhone != null) setLastAddedContactPhone(session.lastAddedContactPhone);
    if (session.view === "questions" && session.currentQuestionIndex != null) {
      setCurrentQuestionIndex(session.currentQuestionIndex);
      setRestoringQuestions(true);
    }
    setSessionRestored(true);
  }, []);

  // When we restored to "questions", re-fetch question list then clear restoring flag
  useEffect(() => {
    if (!restoringQuestions || view !== "questions" || !accessToken) return;
    setQuestionsLoading(true);
    setQuestionsError(null);
    fetch("/api/auth/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken,
        action: "getQuestionsV3",
        connectionType: connectionType === "in-person" ? "inPerson" : "online",
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        const body = data?.body ?? data;
        if (body?.status === "success") {
          const mainQuestions = Array.isArray(body.result) ? mapApiQuestionsToQuestionItems(body.result as unknown[]) : [];
          const schemerQuestions = Array.isArray(body.schemerResult) ? mapApiQuestionsToQuestionItems(body.schemerResult as unknown[]) : [];
          const filteredOnline = mainQuestions.filter((q) => q.questionNotmet && String(q.questionNotmet).trim());
          const questionsList =
            selectedCardId === "schemerscore"
              ? schemerQuestions
              : connectionType === "in-person"
                ? mainQuestions
                : filteredOnline.length > 0
                  ? filteredOnline
                  : mainQuestions;
          if (selectedCardId === "schemerscore") {
            setQuestions(weightedShuffle(questionsList, getQuestionWeight));
          } else {
            const limit = questionLimitByScan[scanOption];
            const toSet = getShuffledCrayQuestions(questionsList, scanOption);
            const final = toSet.length > 0 ? toSet : shuffle(questionsList).slice(0, limit);
            setQuestions(final);
          }
        }
      })
      .catch((e) => setQuestionsError(e instanceof Error ? e.message : "Network error"))
      .finally(() => {
        setQuestionsLoading(false);
        setRestoringQuestions(false);
      });
  }, [restoringQuestions, view, accessToken, connectionType, selectedCardId, scanOption, getShuffledCrayQuestions, shuffle, weightedShuffle, getQuestionWeight]);

  useEffect(() => {
    if (view !== "no-contacts") setSelectedContactIndex(null);
  }, [view]);

  // Persist session when state changes (after initial restore)
  useEffect(() => {
    if (!sessionRestored) return;
    saveOverviewSession({
      view,
      selectedCardId,
      scanOption,
      connectionType,
      knownDurationValue,
      knownDurationUnit,
      lastAddedContactName,
      lastAddedContactPhone,
      ...(view === "background-check-run" || view === "background-check-details"
        ? {
            backgroundCheckFirstName,
            backgroundCheckLastName,
            backgroundCheckState,
            selectedBackgroundContactIndex,
          }
        : {}),
      ...(view === "questions" ? { currentQuestionIndex } : {}),
      ...(view === "report"
        ? {
            quitSummary,
            reportAnswerFilter,
            reportExpandedCategory,
          }
        : {}),
    });
  }, [
    sessionRestored,
    view,
    selectedCardId,
    scanOption,
    connectionType,
    knownDurationValue,
    knownDurationUnit,
    lastAddedContactName,
    lastAddedContactPhone,
    backgroundCheckFirstName,
    backgroundCheckLastName,
    backgroundCheckState,
    selectedBackgroundContactIndex,
    currentQuestionIndex,
    questionAnswers,
    quitSummary,
    reportAnswerFilter,
    reportExpandedCategory,
  ]);

  // Persist Background Check form to localStorage (survives browser close / new tab)
  useEffect(() => {
    setBackgroundCheckFormToLocal({
      firstName: backgroundCheckFirstName.trim(),
      lastName: backgroundCheckLastName.trim(),
      state: backgroundCheckState,
    });
  }, [backgroundCheckFirstName, backgroundCheckLastName, backgroundCheckState]);

  // When returning from successful Background Check payment: show details page and hit Get background verification list API
  const backgroundCheckReturnHandled = useRef(false);
  useEffect(() => {
    if (!backgroundCheckPaymentSuccess || !accessToken || backgroundCheckReturnHandled.current) return;
    backgroundCheckReturnHandled.current = true;
    trackEvent("Payment Completed", {
      transaction_id: `bg-${Date.now()}`,
      price: "7.99",
      product_Id: "com.cray.crayapp.backgroundverification",
      type: "background",
    }, getAuthForTracking());
    setViewState("background-check-details");
    setShowBackgroundCheckPaymentSuccessBanner(true);
    (async () => {
      try {
        const res = await fetch("/api/auth/background-verification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getBackgroundVerification",
            page: 1,
            limit: 5,
            accessToken,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const body = data?.body ?? data;
        setBackgroundVerificationListFetched(res.ok && (body as { status?: string })?.status === "success");
      } catch {
        setBackgroundVerificationListFetched(false);
      }
      if (onBackgroundCheckPaymentReturn) {
        requestAnimationFrame(() => onBackgroundCheckPaymentReturn());
      }
    })();
  }, [backgroundCheckPaymentSuccess, accessToken, onBackgroundCheckPaymentReturn]);

  // Hide "Payment successful" banner after a few seconds when on Background Check details
  useEffect(() => {
    if (!showBackgroundCheckPaymentSuccessBanner || view !== "background-check-details") return;
    const t = setTimeout(() => setShowBackgroundCheckPaymentSuccessBanner(false), 5000);
    return () => clearTimeout(t);
  }, [showBackgroundCheckPaymentSuccessBanner, view]);

  useEffect(() => {
    if (view === "report" && !quitSummary) setViewState("step3-details");
  }, [view, quitSummary]);

  // When first opening the report, expand the first category if none restored from session; allow user to collapse it (including via arrow)
  useEffect(() => {
    if (view === "report" && quitSummary && !reportInitialExpandedDone.current) {
      if (reportExpandedCategory == null) {
        const categoryOrder = quitSummary.reportType === "schemerscore"
          ? [...SCHEMER_REPORT_CATEGORY_ORDER]
          : ["Control & Coercion", "Empathy & Selfishness", "Legal History", "Substance Use", "Violence & Safety Risks"];
        const first = categoryOrder.find((cat) => quitSummary.answers.some((a) => (a.category || "Other") === cat));
        if (first) setReportExpandedCategory(first);
      }
      reportInitialExpandedDone.current = true;
    }
    if (view !== "report") reportInitialExpandedDone.current = false;
  }, [view, quitSummary, reportExpandedCategory]);

  const displayName =
    [firstName, lastName].filter(isDisplayableName).join(" ").trim() || "there";
  const isContinueEnabled =
    selectedCardId === "crayscore" ||
    selectedCardId === "schemerscore" ||
    selectedCardId === "catfish" ||
    selectedCardId === "background";

  const handleContinue = () => {
    if (!isContinueEnabled) return;
    if (selectedCardId === "catfish") {
      setView("catfish");
      return;
    }
    if (selectedCardId === "background") {
      setView("background-check");
      return;
    }
    setView("no-contacts");
  };

  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = contactName.trim();
    const phone = contactPhone.trim();
    const email = contactEmail.trim();
    if (!name && !phone) return;
    if (!accessToken) {
      setAddContactError("Please sign in again.");
      return;
    }

    if (name) {
      const isDuplicateName = contacts.some(
        (c) => c.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (isDuplicateName) {
        setAddContactError("A contact with this name already exists.");
        return;
      }
    }

    const validation = isValidPhoneNumber(contactCountryCode, phone);
    if (!validation.valid) {
      setAddContactError(validation.message ?? "Invalid mobile number.");
      return;
    }

    const nationalDigits = getNationalDigits(contactCountryCode, phone);
    const fullPhoneForApi = contactCountryCode.replace(/\D/g, "") + nationalDigits;
    const normalizedNew = fullPhoneForApi.replace(/\D/g, "");
    const isDuplicate = contacts.some(
      (c) => normalizePhoneForCompare(c.countryCode, c.phone) === normalizedNew
    );
    if (isDuplicate) {
      setAddContactError("This mobile number is already in your contacts.");
      return;
    }

    setAddContactError(null);
    const contactPayload = [{ name: name || "Unknown", phone: contactCountryCode + nationalDigits, email: email || "" }];
    const sourceForApi = selectedCardId === "schemerscore" ? "schemerscore" : "crayscore";

    setAddContactLoading(true);
    try {
      const res = await fetch("/api/auth/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          action: "addContacts",
          contacts: JSON.stringify(contactPayload),
          source: sourceForApi,
        }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      if (!res.ok || body?.status !== "success") {
        setAddContactError(body?.message ?? "Failed to add contact.");
        return;
      }
    } catch (err) {
      setAddContactError(err instanceof Error ? err.message : "Network error");
      return;
    } finally {
      setAddContactLoading(false);
    }

    setContacts((prev) => {
      const key = normalizePhoneForCompare(contactCountryCode, nationalDigits);
      if (prev.some((c) => normalizePhoneForCompare(c.countryCode, c.phone) === key)) return prev;
      return [...prev, { name, countryCode: contactCountryCode, phone: nationalDigits, source: sourceForApi }];
    });
    setContactModalOpen(false);
    setLastAddedContactName(name || "this person");
    setLastAddedContactPhone(contactCountryCode + nationalDigits);
    setContactName("");
    setContactPhone("");
    setContactEmail("");
    setContactCountryCode("+1");
    fetchContactList();

    // For Catfish flow, just save the contact and stay on the current Catfish view.
    if (selectedCardId === "catfish" || view === "catfish" || view === "catfish-run") {
      setCatfishInlineAdd(false);
      return;
    }

    if (selectedCardId === "schemerscore") {
      setQuestionsLoading(true);
      setQuestionsError(null);
      try {
        const qRes = await fetch("/api/auth/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken,
            action: "getQuestionsV3",
            connectionType: "online",
          }),
        });
        const qData = await qRes.json();
        const qBody = qData?.body ?? qData;
        if (qBody?.status === "success" && Array.isArray(qBody.schemerResult)) {
          const schemerList = mapApiQuestionsToQuestionItems(qBody.schemerResult as unknown[]);
          if (schemerList.length > 0) {
setQuestions(weightedShuffle(schemerList, getQuestionWeight));
          setCurrentQuestionIndex(0);
          setQuestionAnswers({});
          setReviewProgressModalOpen(false);
          trackEvent("Started Verification", { is_allowed: true, verification_user_phone_number: lastAddedContactPhone || "", verification_user_full_name: lastAddedContactName || "Contact" }, getAuthForTracking());
          setView("questions");
            return;
          }
        }
        setQuestionsError(qBody?.message ?? "No schemer questions available.");
      } catch (e) {
        setQuestionsError(e instanceof Error ? e.message : "Network error");
      } finally {
        setQuestionsLoading(false);
      }
    }

    if (contacts.length === 0) setView("dashboard");
    setView("scan-options");
    const dontShowDisclaimer = typeof window !== "undefined" && localStorage.getItem(DISCLAIMER_DONT_SHOW_KEY) === "true";
    if (!dontShowDisclaimer) setDisclaimerModalOpen(true);
  };

  const handleDisclaimerProceed = () => {
    if (disclaimerDontShowAgain && typeof window !== "undefined") {
      localStorage.setItem(DISCLAIMER_DONT_SHOW_KEY, "true");
    }
    setDisclaimerModalOpen(false);
    setDisclaimerDontShowAgain(false);
    setView("scan-options");
  };

  const handleNoContactsContinue = async () => {
    const selectedContact =
      selectedContactIndex != null && contacts[selectedContactIndex]
        ? contacts[selectedContactIndex]
        : null;
    if (selectedContact) {
      setLastAddedContactName(selectedContact.name || "Contact");
      setLastAddedContactPhone(selectedContact.countryCode + selectedContact.phone);
      // Register this contact for the current product so both Cray + Schemer icons can show dark when used in both
      if (
        accessToken &&
        (selectedCardId === "crayscore" || selectedCardId === "schemerscore")
      ) {
        const sourceForApi = selectedCardId === "schemerscore" ? "schemerscore" : "crayscore";
        const contactPayload = [
          {
            name: selectedContact.name || "Unknown",
            phone: selectedContact.countryCode + selectedContact.phone,
            email: selectedContact.email ?? "",
          },
        ];
        try {
          await fetch("/api/auth/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accessToken,
              action: "addContacts",
              contacts: JSON.stringify(contactPayload),
              source: sourceForApi,
            }),
          });
        } catch {
          // proceed anyway; icon state may update after next contact list fetch
        }
      }
    }
    if (selectedCardId === "schemerscore" && accessToken && contacts.length > 0) {
      setQuestionsLoading(true);
      setQuestionsError(null);
      try {
        const qRes = await fetch("/api/auth/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken,
            action: "getQuestionsV3",
            connectionType: "online",
          }),
        });
        const qData = await qRes.json();
        const qBody = qData?.body ?? qData;
        if (qBody?.status === "success" && Array.isArray(qBody.schemerResult) && (qBody.schemerResult as unknown[]).length > 0) {
          const schemerList = mapApiQuestionsToQuestionItems(qBody.schemerResult as unknown[]);
          setQuestions(weightedShuffle(schemerList, getQuestionWeight));
          setCurrentQuestionIndex(0);
          setQuestionAnswers({});
          setQuestionsError(null);
          if (selectedContact) {
            setLastAddedContactName(selectedContact.name || "Contact");
            setLastAddedContactPhone(selectedContact.countryCode + selectedContact.phone);
          } else if (contacts[0]) {
            setLastAddedContactName(contacts[0].name || "Contact");
            setLastAddedContactPhone(contacts[0].countryCode + contacts[0].phone);
          }
          const vPhone = selectedContact ? selectedContact.countryCode + selectedContact.phone : contacts[0] ? contacts[0].countryCode + contacts[0].phone : "";
          const vName = selectedContact?.name || contacts[0]?.name || "Contact";
          trackEvent("Started Verification", { is_allowed: true, verification_user_phone_number: vPhone, verification_user_full_name: vName }, getAuthForTracking());
          setView("questions");
          return;
        }
        setQuestionsError(qBody?.message ?? "No schemer questions available.");
        return;
      } catch (e) {
        setQuestionsError(e instanceof Error ? e.message : "Network error");
        return;
      } finally {
        setQuestionsLoading(false);
      }
    }
    setView("scan-options");
    const dontShowDisclaimer = typeof window !== "undefined" && localStorage.getItem(DISCLAIMER_DONT_SHOW_KEY) === "true";
    if (!dontShowDisclaimer) setDisclaimerModalOpen(true);
  };

  // If user came from Contacts and chose SchemerScore, skip the intermediate
  // "Your contacts" screen and immediately start the Schemer questions flow.
  useEffect(() => {
    if (
      !sessionRestored ||
      autoSchemerFromContactsStarted.current ||
      sessionSource !== "contacts" ||
      selectedCardId !== "schemerscore" ||
      view !== "no-contacts" ||
      contacts.length === 0
    ) {
      return;
    }
    autoSchemerFromContactsStarted.current = true;
    void handleNoContactsContinue();
  }, [sessionRestored, sessionSource, selectedCardId, view, handleNoContactsContinue]);

  const scanOptions = [
    {
      id: "quick" as const,
      title: "Quick",
      icon: "◐",
      description:
        "Think of it as Cray's greatest hits... just the 10 biggest red flags. This quick check pulls only the most serious items (Level 4) to give you a quick safety snapshot.",
    },
    {
      id: "medium" as const,
      title: "Medium",
      icon: "◐",
      description:
        "A deeper dive without going full submarine, just 28 items. This version checks all high risk items (Major & Moderate) to catch more...",
    },
    {
      id: "full" as const,
      title: "Full",
      icon: "◐",
      description:
        "The whole Cray experience—no red flag left behind. This covers all 74 items across every risk level for the most complete picture of your partner's patterns.",
    },
  ];

  if (view === "background-check") {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-10">
        <button
          type="button"
          onClick={() => setView("dashboard")}
          className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900">How Background Check Work</h2>
          <p className="mt-2 text-sm text-gray-600">
            Get a comprehensive safety and trust evaluation based on behavioral patterns, interaction signals, and potential risk
            indicators. The Background Check analyzes key factors to provide a clear overview of a person&apos;s reliability and
            trustworthiness. This helps you make informed decisions, recognize possible concerns early, and engage with greater
            confidence and peace of mind.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-purple-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">◆</div>
              <p className="text-sm font-semibold text-gray-900">Spot red flags early</p>
              <p className="mt-1 text-sm text-gray-600">
                Quickly recognize emotional, behavioral, or safety red flags with our smart assessment system - before they put you at risk.
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">✕</div>
              <p className="text-sm font-semibold text-gray-900">Why red flags matter</p>
              <p className="mt-1 text-sm text-gray-600">
                We explain how ignoring certain signs can lead to harm - and how staying informed keeps you protected and empowered.
              </p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">◉</div>
              <p className="text-sm font-semibold text-gray-900">Verified. Safe. In control.</p>
              <p className="mt-1 text-sm text-gray-600">
                With secure identity checks and anti-catfish protection, you always know who you&apos;re talking to - and have the tools to stay one step ahead.
              </p>
            </div>
          </div>

          <p className="mt-8 text-sm font-medium text-gray-900">Would you like to run a Background Check</p>
          {backgroundStatesError && (
            <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{backgroundStatesError}</div>
          )}
          <div className="mt-3">
            <button
              type="button"
              disabled={backgroundStatesLoading || !accessToken}
              onClick={async () => {
                if (!accessToken) return;
                setBackgroundStatesError(null);
                setBackgroundStatesLoading(true);
                try {
                  const res = await fetch("/api/auth/states", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "states", accessToken }),
                  });
                  const data = await res.json().catch(() => ({}));
                  const body = data?.body ?? data;
                  if (!res.ok || body?.status !== "success") {
                    setBackgroundStatesError(
                      (body as { message?: string })?.message ?? "Could not load states. Please try again."
                    );
                    return;
                  }
                  const result = Array.isArray((body as { result?: unknown[] }).result)
                    ? ((body as { result: { name?: string; code?: string }[] }).result as { name: string; code: string }[])
                    : [];
                  setBackgroundStates(
                    result.map((s) => ({ name: String(s.name ?? "").trim(), code: String(s.code ?? "").trim() })).filter((s) => s.code)
                  );
                  setView("background-check-details");
                } catch (err) {
                  setBackgroundStatesError(err instanceof Error ? err.message : "Network error");
                } finally {
                  setBackgroundStatesLoading(false);
                }
              }}
              className="rounded-xl bg-red-600 px-8 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {backgroundStatesLoading ? "Loading…" : "Yes"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-xl font-bold text-gray-900">Recent Activity</h3>
          <div className="mt-4 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
              <input
                type="text"
                placeholder="Search contact"
                className="w-full rounded-full border border-gray-200 py-2 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400"
                readOnly
              />
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="w-10 pb-3 pr-2" />
                  <th className="pb-3 pr-4 font-medium">Contact name</th>
                  <th className="pb-3 pr-4 font-medium">Last Check</th>
                  <th className="pb-3 pr-4 font-medium">Type</th>
                  <th className="pb-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-sm text-gray-500">
                      No recent activity.
                    </td>
                  </tr>
                ) : (
                  contacts.map((c, idx) => (
                    <tr key={idx} className="border-b border-gray-100 last:border-0">
                      <td className="py-3 pr-2">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300" readOnly />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">{c.name || "Contact"}</span>
                          <span className="text-xs text-gray-500">
                            {formatContactPhone(c.countryCode, c.phone)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-gray-500">—</td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-gray-400" />
                          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                            {(c.source ?? "crayscore") === "schemerscore" ? "Schemer Score" : "Cray Score"}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                          aria-label="View details"
                        >
                          👁
                        </button>
                        <button
                          type="button"
                          className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50"
                          aria-label="Delete"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (view === "background-check-details" || view === "background-check-run") {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-10">
        <button
          type="button"
          onClick={() => setView("background-check")}
          className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>

        {showBackgroundCheckPaymentSuccessBanner && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
            <span className="font-semibold">Payment successful.</span> You’re back on the Background Check page.
            {backgroundVerificationListFetched === true && (
              <span className="mt-1 block">Verification list updated.</span>
            )}
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-gray-900">
              You are running a <span className="text-red-600">Background Check™</span>
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Get an overall safety and trust evaluation based on available behavioral and risk indicators. The Background Check
              helps you quickly understand how reliable and safe a person may be before engaging further.
            </p>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">First Name</label>
                <input
                  type="text"
                  value={backgroundCheckFirstName}
                  onChange={(e) => setBackgroundCheckFirstName(e.target.value)}
                  placeholder="enter here"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Last Name</label>
                <input
                  type="text"
                  value={backgroundCheckLastName}
                  onChange={(e) => setBackgroundCheckLastName(e.target.value)}
                  placeholder="enter here"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">State</label>
                <select
                  value={backgroundCheckState}
                  onChange={(e) => setBackgroundCheckState(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900"
                >
                  <option value="">select</option>
                  {backgroundStates.length > 0
                    ? backgroundStates.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))
                    : (
                      <>
                        <option value="AL">Alabama</option>
                        <option value="CA">California</option>
                        <option value="FL">Florida</option>
                        <option value="NY">New York</option>
                        <option value="TX">Texas</option>
                      </>
                    )}
                </select>
              </div>
            </div>
            {(backgroundCheckFirstName.trim() || backgroundCheckLastName.trim() || backgroundCheckState) && (
              <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="mt-2 text-sm text-gray-900">
                  <span className="font-medium">Name:</span>{" "}
                  {[backgroundCheckFirstName.trim(), backgroundCheckLastName.trim()].filter(Boolean).join(" ") || "—"}
                  {backgroundCheckState && (
                    <>
                      {" · "}
                      <span className="font-medium">State:</span>{" "}
                      {backgroundStates.find((s) => s.code === backgroundCheckState)?.name ?? backgroundCheckState}
                    </>
                  )}
                </p>
              </div>
            )}
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                disabled={backgroundCheckoutLoading}
                onClick={async () => {
                  if (!accessToken) return;
                  setBackgroundCheckoutError(null);
                  setBackgroundCheckoutLoading(true);
                  try {
                    const res = await fetch("/api/auth/background-verification", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "getBackgroundVerification",
                        page: 1,
                        limit: 5,
                        accessToken,
                      }),
                    });
                    const data = await res.json().catch(() => ({}));
                    const body = data?.body ?? data;
                    if (!res.ok || body?.status !== "success") {
                      setBackgroundCheckoutError(
                        body?.message ?? "Unable to load background verification list."
                      );
                    } else {
                      setBackgroundCheckoutModalOpen(true);
                    }
                  } catch (err) {
                    setBackgroundCheckoutError(
                      err instanceof Error ? err.message : "Network error"
                    );
                  } finally {
                    setBackgroundCheckoutLoading(false);
                  }
                }}
                className="rounded-xl bg-red-600 px-8 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {backgroundCheckoutLoading ? "Loading…" : "Next"}
              </button>
            </div>
          </section>
        </div>

        {backgroundCheckoutModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="relative w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
              <button
                type="button"
                onClick={() => setBackgroundCheckoutModalOpen(false)}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
              <div className="grid gap-6 md:grid-cols-[auto,1fr,auto] md:items-start">
                <div className="hidden md:block">
                  <div className="flex h-20 w-20 items-center justify-center">
                    🐾
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">BackgroundCheck™</h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Tap &apos;Purchase&apos; below to check if someone has a legal history.
                  </p>
                  <div className="mt-4 grid gap-2 text-sm text-gray-700 md:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span> Picture
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span> Physical Description
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span> Location
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span> Criminal History
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span> Legal History
                    </div>
                  </div>
                  <p className="mt-4 flex items-center gap-2 text-xs text-gray-500">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-[10px] text-green-600">
                      🛡
                    </span>
                    This transaction is protected and guaranteed according to our Terms and Conditions.
                  </p>
                  {backgroundCheckoutError && (
                    <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                      {backgroundCheckoutError}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex flex-col items-end justify-between gap-4 md:mt-0">
                  <div className="text-right">
                    <p className="text-2xl font-bold text-red-600">$7.99</p>
                    <p className="text-xs text-gray-500">Payment Amount</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!accessToken) return;
                      setBackgroundCheckoutError(null);
                      trackEvent("Started Background Verification", {
                        is_allowed: true,
                        verification_user_phone_number: "",
                        verification_user_full_name: `${backgroundCheckFirstName || ""} ${backgroundCheckLastName || ""}`.trim() || "Contact",
                      }, getAuthForTracking());
                      // Fire-and-forget call to Family Watchdog background verification API
                      try {
                        const stateCode = backgroundCheckState || "IL";
                        const stateNames: Record<string, string> = {
                          AL: "Alabama",
                          CA: "California",
                          FL: "Florida",
                          NY: "New York",
                          TX: "Texas",
                          IL: "Illinois",
                        };
                        const stateName = stateNames[stateCode] ?? stateCode;
                        const now = Date.now();
                        await fetch("/api/auth/family-watchdog-verification", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            status: "done",
                            accessToken,
                            dateTime: now,
                            productId: "com.cray.crayapp.backgroundverification",
                            transactionId: `fw_${now}`,
                            purchaseToken: `fw_${now}`,
                            environment: "Sandbox",
                            currency: "usd",
                            action: "familywatchdogbackgroundVerificationV1",
                            lname: "",
                            stateName,
                            stateCode,
                            amount: "4.99",
                            originalTransactionId: `fw_${now}`,
                            fname: backgroundCheckFirstName || "",
                          }),
                        });
                      } catch {
                        // ignore network errors here; Stripe redirect is primary
                      }
                      let stripeUrl: string | null = null;
                      try {
                        const checkoutRes = await fetch("/api/auth/background-checkout", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                        });
                        const checkoutData = await checkoutRes.json().catch(() => ({}));
                        if (checkoutRes.ok && typeof checkoutData?.url === "string" && checkoutData.url) {
                          stripeUrl = checkoutData.url;
                        }
                      } catch {
                        // fall back to static URL
                      }
                      if (!stripeUrl &&
                        typeof process.env.NEXT_PUBLIC_STRIPE_BACKGROUND_CHECKOUT_URL === "string" &&
                        process.env.NEXT_PUBLIC_STRIPE_BACKGROUND_CHECKOUT_URL.trim()) {
                        stripeUrl = process.env.NEXT_PUBLIC_STRIPE_BACKGROUND_CHECKOUT_URL.trim();
                      }
                      if (!stripeUrl) {
                        setBackgroundCheckoutError(
                          "Stripe is not configured. Set STRIPE_SECRET_KEY in .env.local so payment redirects back to this page after success."
                        );
                        return;
                      }
                      window.location.href = stripeUrl;
                    }}
                    className="w-full rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700 md:w-auto"
                  >
                    Purchase
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "catfish") {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-10">
        <button
          type="button"
          onClick={() => setView("dashboard")}
          className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>

        <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-red-600">Catfish Score</h2>
          <p className="mt-1 text-sm text-gray-600">
            Check to make sure the person you&apos;re dating is who they say they are and see if they have a clean record.
          </p>

          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50/40 p-6">
            <h3 className="text-lg font-semibold text-gray-900">How Catfish Score Works</h3>
            <p className="mt-2 text-sm text-gray-600">
              Get a comprehensive safety and trust evaluation based on behavioral patterns, interaction signals, and potential risk
              indicators. This helps you make informed decisions, recognize possible concerns early, and engage with greater
              confidence and peace of mind.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
                  Spot red flags early
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  Quickly recognize emotional, behavioral, or safety red flags before they put you at risk.
                </p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
                  Why red flags matter
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  See how certain patterns and inconsistencies can point to catfishing or identity concerns.
                </p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
                  Verified. Safe. In control.
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  Stay in control with tools that help you decide who to trust and when to walk away.
                </p>
              </div>
            </div>

            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => setView("catfish-run")}
                className="rounded-xl bg-red-600 px-8 py-3 text-sm font-bold text-white hover:bg-red-700"
              >
                Yes, run a Catfish score
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
            <div className="relative w-full max-w-xs">
              <input
                type="text"
                placeholder="Search contact"
                className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400"
                readOnly
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="pb-3 pr-4 font-medium">Contact name</th>
                  <th className="pb-3 pr-4 font-medium">Phone</th>
                  <th className="pb-3 pr-4 font-medium">Last check</th>
                  <th className="pb-3 pr-4 font-medium">Type</th>
                  <th className="pb-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-6 text-center text-sm text-gray-500"
                    >
                      No contacts yet. Add a contact from the dashboard to run a Catfish score.
                    </td>
                  </tr>
                ) : (
                  contacts.map((c, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-gray-100 last:border-0"
                    >
                      <td className="py-3 pr-4 font-medium text-gray-900">
                        {c.name || "Contact"}
                      </td>
                      <td className="py-3 pr-4 text-gray-700">
                        {formatContactPhone(c.countryCode, c.phone)}
                      </td>
                      <td className="py-3 pr-4 text-gray-500">
                        —
                      </td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-600">
                          Catfish Score
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs text-gray-700 hover:bg-gray-50"
                          aria-label="View details"
                        >
                          👁
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  if (view === "catfish-run") {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-10">
        <button
          type="button"
          onClick={() => setView("catfish")}
          className="mb-2 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900">
            You are running a <span className="text-red-600">Catfish Score</span>
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Get an overall safety and trust evaluation based on available behavioral and risk indicators. The Catfish
            Score helps you quickly understand how reliable and safe a person may be before engaging further.
          </p>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {catfishInlineAdd && (
            <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50/60 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Add New Contact</h3>
                <button
                  type="button"
                  onClick={() => {
                    setCatfishInlineAdd(false);
                    setAddContactError(null);
                  }}
                  className="text-sm text-gray-500 hover:text-gray-800"
                >
                  ✕
                </button>
              </div>
              {addContactError && (
                <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {addContactError}
                </div>
              )}
              <form onSubmit={handleAddContactSubmit} className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g. Addison Herwitz"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Country</label>
                    <input
                      type="text"
                      value={contactCountryCode}
                      onChange={(e) => setContactCountryCode(e.target.value)}
                      className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">Phone number</label>
                    <input
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="enter here"
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                    />
                  </div>
                </div>
                <div className="md:col-span-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setCatfishInlineAdd(false);
                      setAddContactError(null);
                    }}
                    className="rounded-xl border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addContactLoading}
                    className="rounded-xl bg-red-600 px-6 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {addContactLoading ? "Saving…" : "Save contact"}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-500">
                {contacts.length.toString().padStart(2, "0")} Past Contacts
              </p>
              <h3 className="text-lg font-semibold text-gray-900">Past Contacts</h3>
            </div>
            {!catfishInlineAdd && (
              <button
                type="button"
                onClick={() => setCatfishInlineAdd(true)}
                className="inline-flex items-center justify-center rounded-xl border border-red-600 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                + Add a New Contact
              </button>
            )}
            <div className="relative w-full max-w-xs">
              <input
                type="text"
                placeholder="Search contact"
                className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400"
                readOnly
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="w-10 pb-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={selectedCatfishContactIndices.size > 0}
                      onChange={() => setSelectedCatfishContactIndices(new Set())}
                      title="Clear selection"
                    />
                  </th>
                  <th className="pb-3 pr-4 font-medium">Contact name</th>
                  <th className="pb-3 pr-4 font-medium">Last check</th>
                  <th className="pb-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-sm text-gray-500"
                    >
                      No contacts yet. Add a contact from the dashboard to run a Catfish score.
                    </td>
                  </tr>
                ) : (
                  contacts.map((c, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-gray-100 last:border-0"
                    >
                      <td className="py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300"
                          checked={selectedCatfishContactIndices.has(idx)}
                          onChange={() => {
                            setSelectedCatfishContactIndices((prev) =>
                              prev.has(idx) ? new Set<number>() : new Set([idx])
                            );
                          }}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-900">{c.name || "Contact"}</span>
                          <span className="text-xs text-gray-500">
                            {formatContactPhone(c.countryCode, c.phone)}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-gray-500">—</td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-xs text-gray-700 hover:bg-gray-50"
                          aria-label="Delete contact"
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {contacts.length > 0 && (
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                disabled={selectedCatfishContactIndices.size === 0}
                onClick={() => {
                  setCatfishCheckoutError(null);
                  setCatfishCheckModalOpen(true);
                }}
                className="rounded-xl bg-red-600 px-6 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600"
              >
                Next
              </button>
            </div>
          )}
        </section>

        {/* Catfish Check modal: $1.99, Purchase → card details */}
        {catfishCheckModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setCatfishCheckModalOpen(false);
                  setCatfishCheckoutError(null);
                }}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
              <h3 className="pr-8 text-xl font-bold text-gray-900">Catfish Check</h3>
              <p className="mt-2 text-sm text-gray-600">
                Tap &apos;Purchase&apos; below to verify someone&apos;s identity.
              </p>
              {catfishCheckoutError && (
                <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {catfishCheckoutError}
                </div>
              )}
              <ul className="mt-4 space-y-2 text-sm text-gray-700">
                <li className="flex items-center gap-2">
                  <span className="text-green-600">✓</span> Check phone number validity
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600">✓</span> City/State
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600">✓</span> Region
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600">✓</span> Fraud Score
                </li>
              </ul>
              <p className="mt-4 flex items-center gap-2 text-xs text-gray-500">
                <span className="inline-block h-4 w-4 rounded-full bg-green-100 text-green-600">🛡</span>
                This transaction is protected and guaranteed according to our Terms and Conditions.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-6">
                <div>
                  <p className="text-2xl font-bold text-red-600">$1.99</p>
                  <p className="text-xs text-gray-500">Payment Amount</p>
                </div>
                <button
                  type="button"
                  disabled={catfishCheckoutLoading}
                  onClick={async () => {
                    setCatfishCheckoutError(null);
                    setCatfishCheckoutLoading(true);
                    trackEvent("Catfish Verification", { is_allowed: true }, getAuthForTracking());
                    try {
                      const res = await fetch("/api/auth/catfish-checkout", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                      });
                      const data = await res.json().catch(() => ({}));
                      let url = data?.url;
                      if (!url && typeof process.env.NEXT_PUBLIC_STRIPE_CATFISH_CHECKOUT_URL === "string") {
                        const link = process.env.NEXT_PUBLIC_STRIPE_CATFISH_CHECKOUT_URL.trim();
                        if (link) url = link;
                      }
                      if (url && typeof url === "string") {
                        setCatfishCheckModalOpen(false);
                        window.location.href = url;
                        return;
                      }
                      setCatfishCheckoutError(
                        data?.error ?? "Add STRIPE_SECRET_KEY to .env.local (Stripe Dashboard → Developers → API keys) and restart the dev server. Or set NEXT_PUBLIC_STRIPE_CATFISH_CHECKOUT_URL to a Stripe Payment Link."
                      );
                    } catch (err) {
                      setCatfishCheckoutError(
                        err instanceof Error ? err.message : "Network error"
                      );
                    } finally {
                      setCatfishCheckoutLoading(false);
                    }
                  }}
                  className="w-full rounded-xl bg-red-600 px-6 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 sm:w-auto"
                >
                  {catfishCheckoutLoading ? "Redirecting…" : "Purchase"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "scan-options") {
    return (
      <div className="flex w-full max-w-4xl flex-col">
        <button
          type="button"
          onClick={() => setView("dashboard")}
          className="mb-6 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-200 text-2xl text-gray-500">👤</div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{lastAddedContactName || "Contact"}</p>
            <p className="text-sm text-gray-600">Please choose an option below to proceed</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {scanOptions.map((opt) => {
            const isSelected = scanOption === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScanOption(opt.id)}
                className={`relative rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md ${
                  isSelected ? "border-red-500 bg-red-50/30 ring-1 ring-red-500" : "border-gray-200 bg-white hover:border-red-200"
                }`}
              >
                <span
                  className={`absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                    isSelected ? "border-red-500 bg-red-500" : "border-gray-300 bg-white"
                  }`}
                >
                  {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="text-xl text-red-600">{opt.icon}</span>
                <h3 className="mt-2 font-bold text-gray-900">{opt.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{opt.description}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={() => setView("connection-type")}
            className="rounded-xl bg-red-600 px-8 py-3 font-bold text-white hover:bg-red-700"
          >
            Proceed
          </button>
        </div>
      </div>
    );
  }

  const connectionOptions = [
    { id: "in-person" as const, title: "We've Met in Person", icon: "👤", description: "You've spent meaningful time together — in real life. You've observed how they act, respond, and carry themselves face-to-face.", hint: "Choose this if you've hung out multiple times, dated, worked together, or interacted significantly offline." },
    { id: "online" as const, title: "We've Only Connected Online", icon: "👤", description: "You've only talked through messages, calls, or social media. You've never met in person or only had brief contact.", hint: "Choose this if you're talking to someone from a dating app, social media, or texting but haven't really spent time together in person." },
  ];

  if (view === "connection-type") {
    return (
      <div className="flex w-full max-w-4xl flex-col">
        <button type="button" onClick={() => setView("scan-options")} className="mb-6 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">← Back</button>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-200 text-2xl text-gray-500">👤</div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{lastAddedContactName || "Contact"}</p>
            <p className="text-sm text-gray-600">Please choose an option below to proceed</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {connectionOptions.map((opt) => {
            const isSelected = connectionType === opt.id;
            return (
              <button key={opt.id} type="button" onClick={() => setConnectionType(opt.id)} className={`relative rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md ${isSelected ? "border-red-500 bg-red-50/30 ring-1 ring-red-500" : "border-gray-200 bg-white hover:border-red-200"}`}>
                <span className={`absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border-2 ${isSelected ? "border-red-500 bg-red-500" : "border-gray-300 bg-white"}`}>{isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}</span>
                <span className="text-xl text-red-600">{opt.icon}</span>
                <h3 className="mt-2 font-bold text-gray-900">{opt.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{opt.description}</p>
                <p className="mt-2 text-xs text-gray-500">{opt.hint}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-8 flex justify-end">
          <button type="button" onClick={() => setView("step3-details")} className="rounded-xl bg-red-600 px-8 py-3 font-bold text-white hover:bg-red-700">Proceed</button>
        </div>
      </div>
    );
  }

  const handleStep3Continue = async () => {
    if (!accessToken) return;
    setQuestionsLoading(true);
    setQuestionsError(null);
    try {
      const res = await fetch("/api/auth/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          action: "getQuestionsV3",
          connectionType: connectionType === "in-person" ? "inPerson" : "online",
        }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      if (body?.status !== "success") {
        setQuestionsError(body?.message ?? "Failed to load questions");
        return;
      }
      const mainQuestions = Array.isArray(body.result) ? mapApiQuestionsToQuestionItems(body.result as unknown[]) : [];
      const filteredOnline = mainQuestions.filter((q) => q.questionNotmet && String(q.questionNotmet).trim());
      const questionsList =
        connectionType === "in-person"
          ? mainQuestions
          : filteredOnline.length > 0
            ? filteredOnline
            : mainQuestions;
      if (questionsList.length === 0) {
        setQuestionsError(
          body?.message && body.message !== "Question listing."
            ? body.message
            : "No questions available for this connection type."
        );
        return;
      }
      const limit = questionLimitByScan[scanOption];
      const toSet =
        selectedCardId === "schemerscore"
          ? weightedShuffle(questionsList, getQuestionWeight)
          : getShuffledCrayQuestions(questionsList, scanOption);
      const final = toSet.length > 0 ? toSet : shuffle(questionsList).slice(0, limit);
      setQuestions(final);
      setCurrentQuestionIndex(0);
      setQuestionAnswers({});
      setReviewProgressModalOpen(false);
      trackEvent("Started Verification", { is_allowed: true, verification_user_phone_number: lastAddedContactPhone || "", verification_user_full_name: lastAddedContactName || "Contact" }, getAuthForTracking());
      setView("questions");
    } catch (e) {
      setQuestionsError(e instanceof Error ? e.message : "Network error");
    } finally {
      setQuestionsLoading(false);
    }
  };

  if (view === "step3-details") {
    return (
      <div className="flex w-full max-w-4xl flex-col">
        <h2 className="mb-2 text-xl font-bold text-gray-900">Step 3 Details</h2>
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="flex items-center gap-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">1</span>
            <span className="text-sm font-medium text-gray-600">Step</span>
          </div>
          <div className="h-0.5 w-8 bg-red-600" />
          <div className="flex items-center gap-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">2</span>
            <span className="text-sm font-medium text-gray-600">Step</span>
          </div>
          <div className="h-0.5 w-8 bg-red-600" />
          <div className="flex items-center gap-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">3</span>
            <span className="text-sm font-medium text-gray-600">Step</span>
          </div>
        </div>
        <button type="button" onClick={() => setView("connection-type")} className="mb-6 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">← Back</button>
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500">
            <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
          </div>
          <p className="text-2xl font-bold text-gray-900">{lastAddedContactName || "Contact"}</p>
        </div>
        <p className="mb-4 text-base font-medium text-gray-900">How long have you known this person?</p>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="known-duration-value" className="text-sm font-medium text-gray-700">Duration</label>
            <select
              id="known-duration-value"
              value={String(knownDurationValue)}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setKnownDurationValue(clampDurationValueForUnit(v, knownDurationUnit));
              }}
              className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 focus:border-red-500 focus:ring-1 focus:ring-red-500 min-w-[100px]"
              aria-label="Number of units"
            >
              {Array.from({ length: getMaxDurationForUnit(knownDurationUnit) }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{String(n).padStart(2, "0")}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Unit</p>
            <div className="flex flex-wrap gap-4">
              {validDurationUnits.map((unit) => (
                <label key={unit} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="knownDurationUnitStep3"
                    checked={knownDurationUnit === unit}
                    onChange={() => {
                      setKnownDurationUnit(unit);
                      setKnownDurationValue((prev) => clampDurationValueForUnit(prev, unit));
                    }}
                    className="h-4 w-4 border-gray-300 text-red-600 focus:ring-red-500"
                    aria-label={`${unit.charAt(0).toUpperCase() + unit.slice(1)}`}
                  />
                  <span className="text-sm font-medium text-gray-900">{unit.charAt(0).toUpperCase() + unit.slice(1)}(s)</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <p className="mb-8 text-sm text-gray-600">
          You selected: <span className="font-medium text-gray-900">{knownDurationValue} {knownDurationUnit}</span>
        </p>
        {questionsError && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <p>{questionsError}</p>
            {(questionsError.toLowerCase().includes("expired") || questionsError.toLowerCase().includes("refresh your token")) && (
              <a href="/" className="mt-2 inline-block font-medium text-red-700 underline hover:text-red-800">Sign in again</a>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleStep3Continue}
            disabled={questionsLoading}
            className="rounded-xl bg-red-600 px-8 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {questionsLoading ? "Loading…" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  if (view === "report" && quitSummary) {
    const yesCount = quitSummary.answers.filter((a) => a.answer === "yes").length;
    const noCount = quitSummary.answers.filter((a) => a.answer === "no").length;
    const notSureCount = quitSummary.answers.filter((a) => a.answer === "notSure").length;
    const connectionLabel = connectionType === "in-person" ? "We've Met in Person" : "Online";
    const isSchemerReport = quitSummary.reportType === "schemerscore";
    const reportScore = quitSummary.answers.reduce((sum, a) => {
      if (a.answer !== "yes") return sum;
      const pts = typeof a.points === "number" ? a.points : 0;
      const w = typeof a.weight === "number" ? a.weight : 1;
      return sum + pts * w;
    }, 0);
    const scoreRounded = Math.round(reportScore);
    // SchemerScore risk levels (0–4.4, 4.5–9.4, 9.5–15, 15+)
    let schemerRiskLevel: "low" | "moderate" | "high" | "severe" | null = null;
    let schemerRiskLabel = "";
    let schemerRiskDescription = "";
    const schemerCategoryYesCounts: Record<string, number> = {
      Manipulation: 0,
      Deception: 0,
      Exploitation: 0,
    };
    const schemerSubcategoryYesCounts: Record<string, number> = {};
    const schemerBreakdownConfig: Record<string, { category: "Manipulation" | "Deception" | "Exploitation"; label: string }> = {
      emotional: { category: "Manipulation", label: "Emotional" },
      "financial fraud": { category: "Manipulation", label: "Financial Fraud" },
      "urgent plans": { category: "Manipulation", label: "Urgent Plans of Manipulation" },
      "image crafting": { category: "Deception", label: "Image Crafting" },
      "lack of emotional inv.": { category: "Deception", label: "Lack of Emotional Involvement" },
      evasion: { category: "Deception", label: "Evasion" },
      "financial solicitation": { category: "Exploitation", label: "Financial Solicitation" },
      "transactional intent": { category: "Exploitation", label: "Transactional Intent" },
      "financial entitlement": { category: "Exploitation", label: "Financial Entitlement" },
    };
    if (isSchemerReport) {
      quitSummary.answers.forEach((a) => {
        if (a.answer !== "yes") return;
        const rawSub = (a.subcategory || "").trim().toLowerCase();
        if (!rawSub) return;
        const cfg = schemerBreakdownConfig[rawSub];
        if (!cfg) return;
        schemerCategoryYesCounts[cfg.category] = (schemerCategoryYesCounts[cfg.category] ?? 0) + 1;
        schemerSubcategoryYesCounts[cfg.label] = (schemerSubcategoryYesCounts[cfg.label] ?? 0) + 1;
      });
    }
    if (isSchemerReport) {
      const s = reportScore;
      if (s <= 4.4) {
        schemerRiskLevel = "low";
        schemerRiskLabel = "Low Risk";
        schemerRiskDescription =
          "Very few red flags. Unlikely to be a schemer. Proceed normally, but stay alert.";
      } else if (s <= 9.4) {
        schemerRiskLevel = "moderate";
        schemerRiskLabel = "Moderate Risk";
        schemerRiskDescription =
          "Some signs suggest manipulation or opportunism. Be cautious and monitor consistency over time.";
      } else if (s <= 15) {
        schemerRiskLevel = "high";
        schemerRiskLabel = "High Risk";
        schemerRiskDescription =
          "Clear pattern of behavior that aligns with emotional or financial exploitation. Trust your gut and slow things down.";
      } else {
        schemerRiskLevel = "severe";
        schemerRiskLabel = "Severe Risk";
        schemerRiskDescription =""
      }
    }
    const hasFlaggedHigh = quitSummary.answers.some(
      (a) => a.answer === "yes" && typeof a.points === "number" && a.points === 5
    );
    const hasFlaggedMed = quitSummary.answers.some(
      (a) => a.answer === "yes" && typeof a.points === "number" && (a.points === 3 || a.points === 4)
    );
    const schemerIconSrc =
      !isSchemerReport || !schemerRiskLevel
        ? null
        : schemerRiskLevel === "low"
        ? "/cray-level/level-0.png"
        : schemerRiskLevel === "moderate"
        ? "/cray-level/level-1.png"
        : schemerRiskLevel === "high"
        ? "/cray-level/level-3.png"
        : "/cray-level/level-4.png";

    const crayLevel =
      scoreRounded === 0 && !hasFlaggedHigh && !hasFlaggedMed
        ? 0
        : hasFlaggedHigh || scoreRounded >= 90
          ? 4
          : hasFlaggedMed || (scoreRounded >= 60 && scoreRounded <= 89)
            ? 3
            : scoreRounded >= 30 && scoreRounded <= 59
              ? 2
              : scoreRounded >= 1 && scoreRounded <= 29
                ? 1
                : 0;
    const crayLevelLabel =
      crayLevel === 0
        ? "No Concern"
        : crayLevel === 1
          ? "Slight Concern"
          : crayLevel === 2
            ? "Moderate Concern"
            : crayLevel === 3
              ? "Consider Leaving (Strong Concern)"
              : "Run Away";
    const showSoftWarning = !isSchemerReport && (hasFlaggedMed || hasFlaggedHigh);
    // Red-flag breakdown groups: Major (Quick), Moderate (Medium), Other (remaining questions)
    const yesCountsByCategory: Record<string, number> = {};
    quitSummary.answers.forEach((a) => {
      if (a.answer !== "yes") return;
      const key = (a.category || "").trim() || "Other";
      yesCountsByCategory[key] = (yesCountsByCategory[key] ?? 0) + 1;
    });
    const majorCategoryLabels = ["Values & Maturity", "Control & Coercion", "Anger & Temper"];
    const moderateCategoryLabels = [
      "Validation Seeking",
      "Sexual Boundaries/Values",
      "Deception & Infidelity",
    ];
    const otherCategoryLabels = ["Empathy & Selfishness", "Legal History", "Responsibility"];
    const getYesCountForLabel = (label: string) => {
      const lowerLabel = label.toLowerCase();
      let total = 0;
      for (const [cat, count] of Object.entries(yesCountsByCategory)) {
        const lowerCat = cat.toLowerCase();
        if (lowerCat === lowerLabel) total += count;
      }
      return total;
    };
    const crayLevelIconSrc = !isSchemerReport
      ? ({
          0: "/cray-level/level-0.png",
          1: "/cray-level/level-1.png",
          2: "/cray-level/level-2.png",
          3: "/cray-level/level-3.png",
          4: "/cray-level/level-4.png",
        } as const)[crayLevel]
      : null;
    const reviewLabel = isSchemerReport
      ? "Schemer Review"
      : `${quitSummary.reviewType.charAt(0).toUpperCase() + quitSummary.reviewType.slice(1)} Review`;
    const categoryOrder = [...(isSchemerReport ? SCHEMER_REPORT_CATEGORY_ORDER : REPORT_CATEGORY_ORDER)];
    // "How you answered": show all answers when expanded; bracket count = Yes only; display order Yes, No, Not Sure
    const answersByCategory = categoryOrder.reduce(
      (acc, cat) => {
        acc[cat] = quitSummary.answers.filter((a) => (a.category || "Other") === cat);
        return acc;
      },
      {} as Record<string, SavedAnswer[]>
    );
    const answerOrder: Record<string, number> = { yes: 0, no: 1, notSure: 2 };
    const categoriesToShow = categoryOrder.map((cat) => {
      const answers = answersByCategory[cat] ?? [];
      const yesCount = answers.filter((a) => a.answer === "yes").length;
      const sorted = [...answers].sort((a, b) => (answerOrder[a.answer] ?? 3) - (answerOrder[b.answer] ?? 3));
      return [cat, sorted, yesCount] as [string, SavedAnswer[], number];
    });

    // Helper to build per-category sections for a given answer list
    const buildCategorySections = (answersAll: SavedAnswer[]) => {
      const byCategory = categoryOrder.reduce(
        (acc, cat) => {
          acc[cat] = answersAll.filter((a) => (a.category || "Other") === cat);
          return acc;
        },
        {} as Record<string, SavedAnswer[]>
      );
      return categoryOrder.map((cat) => {
        const ans = byCategory[cat] ?? [];
        const yesOnlyCount = ans.filter((a) => a.answer === "yes").length;
        const sorted = [...ans].sort(
          (a, b) => (answerOrder[a.answer] ?? 3) - (answerOrder[b.answer] ?? 3)
        );
        return [cat, sorted, yesOnlyCount] as [string, SavedAnswer[], number];
      });
    };

    // For CrayScore report: split by review type into Major / Moderate / Other bands
    const majorAnswers =
      !isSchemerReport && quitSummary.reviewType === "quick" ? quitSummary.answers : [];
    const moderateAnswers =
      !isSchemerReport && quitSummary.reviewType === "medium" ? quitSummary.answers : [];
    const otherAnswers =
      !isSchemerReport && quitSummary.reviewType === "full" ? quitSummary.answers : [];
    const majorSections = buildCategorySections(majorAnswers);
    const moderateSections = buildCategorySections(moderateAnswers);
    const otherSections = buildCategorySections(otherAnswers);

    return (
      <div className="flex w-full max-w-5xl flex-col">
        <button type="button" onClick={() => { setQuitSummary(null); setView(selectedCardId === "schemerscore" ? "no-contacts" : "step3-details"); }} className="mb-6 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
          ← Back
        </button>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Report</h1>
            <span className="text-gray-500">·</span>
            <span className="text-lg font-medium text-gray-900">{lastAddedContactName || "Contact"} ({connectionLabel})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setReportFilterModalSelection(reportAnswerFilter);
                setReportFilterModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-red-600 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Filters
              <span className="text-red-500" aria-hidden>▼</span>
            </button>
          </div>
        </div>
        {!isSchemerReport && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-r from-red-700 via-red-600 to-red-500 shadow-sm">
            <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-center gap-4 lg:w-1/3">
                <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  {crayLevelIconSrc ? (
                    <img
                      src={crayLevelIconSrc}
                      alt={`CrayScore level ${crayLevel}`}
                      className="h-16 w-16 object-contain"
                      onError={(e) => {
                        // If icon is missing, keep layout intact without breaking the page
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : null}
                </div>
                <div className="text-white">
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Cray Score Result</p>
                  <p className="mt-1 text-lg font-bold leading-tight">{crayLevelLabel}</p>
                  <p className="mt-1 text-sm text-white/90">Level {crayLevel} · Score {scoreRounded}</p>
                </div>
              </div>

              <div className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-xs text-white ring-1 ring-white/20">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide">Red-flag breakdown</p>
                  <div className="flex h-10 w-10 flex-col items-center justify-center rounded-lg bg-white text-gray-900 shadow-sm">
                    <span className="text-lg font-extrabold leading-none">{String(scoreRounded)}</span>
                    <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600">Score</span>
                  </div>
                </div>
                <div className="mt-1 grid gap-4 md:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-red-100">
                      Major
                    </p>
                    {majorCategoryLabels.map((label) => (
                      <div key={label} className="mt-0.5 flex items-center justify-between text-[11px]">
                        <span>{label}</span>
                        <span className="ml-2 rounded-full bg-red-50/90 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                          {getYesCountForLabel(label)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-100">
                      Moderate
                    </p>
                    {moderateCategoryLabels.map((label) => (
                      <div key={label} className="mt-0.5 flex items-center justify-between text-[11px]">
                        <span>{label}</span>
                        <span className="ml-2 rounded-full bg-amber-50/90 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          {getYesCountForLabel(label)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-white">
                      Other
                    </p>
                    {otherCategoryLabels.map((label) => (
                      <div key={label} className="mt-0.5 flex items-center justify-between text-[11px]">
                        <span>{label}</span>
                        <span className="ml-2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-gray-900">
                          {getYesCountForLabel(label)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {isSchemerReport && schemerRiskLevel && (
          <div className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-slate-900 text-slate-50 shadow-sm">
            <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
              <div className="flex items-center gap-4 md:w-1/3 lg:w-1/4">
                <div className="flex h-28 w-28 items-center justify-center rounded-xl bg-slate-800 ring-1 ring-slate-700">
                  {schemerIconSrc && (
                    <img
                      src={schemerIconSrc}
                      alt="SchemerScore risk"
                      className="h-28 w-28 object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    SchemerScore Result
                  </p>
                  <p className="text-lg font-bold leading-tight">{schemerRiskLabel}</p>
                  <p className="text-xs text-slate-300">Score {reportScore.toFixed(1)}</p>
                  <p className="mt-2 text-[11px] text-slate-200">
                    {schemerRiskDescription}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex-1 md:mt-0">
                <div className="border-b border-slate-700 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-200">
                  Score Breakdown
                </div>
                <div className="mt-3 grid gap-6 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                      MANIPULATION [{schemerCategoryYesCounts.Manipulation}]
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-slate-200">
                      <li>Emotional</li>
                      <li>Financial Fraud</li>
                      <li>Urgent Plans of Manipulation</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                      DECEPTION [{schemerCategoryYesCounts.Deception}]
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-slate-200">
                      <li>Image Crafting</li>
                      <li>Lack of Emotional Involvement</li>
                      <li>Evasion</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-200">
                      EXPLOITATION [{schemerCategoryYesCounts.Exploitation}]
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-slate-200">
                      <li>Financial Solicitation</li>
                      <li>Transactional Intent</li>
                      <li>Financial Entitlement</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {showSoftWarning && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Soft warning: at least one answered “Yes” item is medium/high severity (points {hasFlaggedHigh ? "5" : "3–4"}), which can raise your level to {hasFlaggedHigh ? "4 (Run Away)" : "3 (Consider Leaving)"} even if the total score is lower.
          </div>
        )}
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-center text-sm font-medium uppercase tracking-wide text-gray-500">Answer summary for &quot;{reviewLabel}&quot;</p>
            <div className={`mt-4 gap-3 ${reportAnswerFilter === "all" ? "grid grid-cols-3" : "flex justify-center"}`}>
              {(reportAnswerFilter === "all" || reportAnswerFilter === "yes") && (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-green-200 bg-green-50 py-4 min-w-0">
                  <span className="text-2xl font-bold text-green-700">{String(yesCount).padStart(2, "0")}</span>
                  <span className="mt-1 text-xs font-medium text-green-800">Yes Count</span>
                  <span className="text-green-600" aria-hidden>✓</span>
                </div>
              )}
              {(reportAnswerFilter === "all" || reportAnswerFilter === "no") && (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-red-200 bg-red-50 py-4 min-w-0">
                  <span className="text-2xl font-bold text-red-700">{String(noCount).padStart(2, "0")}</span>
                  <span className="mt-1 text-xs font-medium text-red-800">No Count</span>
                  <span className="text-red-600" aria-hidden>✕</span>
                </div>
              )}
              {(reportAnswerFilter === "all" || reportAnswerFilter === "notSure") && (
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-gray-200 bg-gray-100 py-4 min-w-0">
                  <span className="text-2xl font-bold text-gray-700">{String(notSureCount).padStart(2, "0")}</span>
                  <span className="mt-1 text-xs font-medium text-gray-800">Not Sure Count</span>
                  <span className="text-gray-500" aria-hidden>?</span>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900">How you answered</h2>
            <p className="mt-1 text-sm text-gray-600">Expand a category to see questions and your answers.</p>

            <div className="mt-4 space-y-2">
              {categoriesToShow.map(([category, answers, yesCount]) => {
                const isExpanded = reportExpandedCategory === category;
                return (
                  <div key={category} className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/50">
                    <button
                      type="button"
                      onClick={() => setReportExpandedCategory(isExpanded ? null : category)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left font-medium text-gray-900 hover:bg-gray-100"
                    >
                      <span>{category} [{yesCount}]</span>
                      <span className="text-gray-500" style={{ transform: isExpanded ? "rotate(180deg)" : undefined }}>▼</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-white px-4 py-3">
                        {answers.length === 0 ? (
                          <p className="py-4 text-center text-sm text-gray-500">No answers in this category.</p>
                        ) : (
                          <ul className="space-y-4">
                            {answers.map((a, i) => (
                              <li key={`${a.questionId}-${i}`} className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
                                <p className="text-sm font-medium text-gray-900">{a.questionText}</p>
                                {a.description && (
                                  <p className="mt-2 text-sm text-gray-600">{a.description}</p>
                                )}
                                <div className="mt-3 flex flex-wrap gap-3">
                                  {a.subcategory && (
                                    <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-3">
                                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Subcategory</p>
                                      <p className="mt-1 text-sm font-medium text-red-600">{a.subcategory}</p>
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-3">
                                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Answered</p>
                                    {reportEditingQuestionId === a.questionId ? (
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {(["yes", "no", "notSure"] as const).map((opt) => (
                                          <button
                                            key={opt}
                                            type="button"
                                            onClick={() => updateReportAnswer(a.questionId, opt)}
                                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium capitalize ${
                                              a.answer === opt
                                                ? "border-red-600 bg-red-50 text-red-700"
                                                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                                            }`}
                                          >
                                            {opt === "notSure" ? "Not Sure" : opt}
                                          </button>
                                        ))}
                                        <button
                                          type="button"
                                          onClick={() => setReportEditingQuestionId(null)}
                                          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="mt-1 flex flex-wrap items-center gap-2">
                                        <p className="text-sm font-medium text-red-600 capitalize">{a.answer === "notSure" ? "Not Sure" : a.answer}</p>
                                        <button
                                          type="button"
                                          onClick={() => setReportEditingQuestionId(a.questionId)}
                                          className="text-sm font-medium text-gray-500 underline hover:text-gray-900"
                                        >
                                          Edit
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {reportFilterModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
              <button
                type="button"
                onClick={() => setReportFilterModalOpen(false)}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
              <h3 className="text-lg font-bold text-gray-900">Filter</h3>
              <p className="mt-2 text-sm text-gray-600">Choose from the four available filters to move forward.</p>
              <div className="mt-6 space-y-2">
                {[
                  { value: "all" as const, label: "All Answers", icon: "🐦", count: quitSummary.answers.length },
                  { value: "yes" as const, label: "Yes Answered", icon: "✓", count: yesCount, color: "text-green-600" },
                  { value: "no" as const, label: "No Answered", icon: "✕", count: noCount, color: "text-red-600" },
                  { value: "notSure" as const, label: "Not Sure Answered", icon: "?", count: notSureCount, color: "text-gray-600" },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition-colors ${
                      reportFilterModalSelection === opt.value ? "border-red-500 bg-red-50/50" : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="reportFilter"
                      checked={reportFilterModalSelection === opt.value}
                      onChange={() => setReportFilterModalSelection(opt.value)}
                      className="h-4 w-4 border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className={opt.color ?? "text-gray-700"}>{opt.icon === "✓" ? "✓" : opt.icon === "✕" ? "✕" : opt.icon === "?" ? "?" : opt.icon}</span>
                    <span className="flex-1 font-medium text-gray-900">
                      {opt.label} {opt.value !== "all" ? String(opt.count).padStart(2, "0") : ""}
                    </span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setReportAnswerFilter(reportFilterModalSelection);
                  setReportFilterModalOpen(false);
                  trackEvent("Filter Applied", {
                    verification_user_phone_number: lastAddedContactPhone || "",
                    verification_user_full_name: lastAddedContactName || "Contact",
                    filter_type: reportFilterModalSelection === "yes" ? "Yes" : reportFilterModalSelection === "no" ? "No" : reportFilterModalSelection === "notSure" ? "Not Sure" : "All",
                  }, getAuthForTracking());
                }}
                className="mt-6 w-full rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-end gap-3">
          {saveReportError && !sessionFromViewScore && (
            <p className="mr-auto self-center text-sm text-red-600">{saveReportError}</p>
          )}
          <button
            type="button"
            onClick={() => {
              setQuitSummary(null);
              // When coming from Contacts -> View Score, always go back to Contacts
              if (sessionSource === "contacts") {
                router.push("/contacts");
              } else {
                setView(selectedCardId === "schemerscore" ? "no-contacts" : "step3-details");
              }
            }}
            className="rounded-xl border border-gray-300 bg-white px-6 py-3 font-medium text-gray-900 hover:bg-gray-50"
          >
            Close
          </button>
          {!sessionFromViewScore && (
            <button
              type="button"
              onClick={handleSaveReport}
              disabled={saveReportLoading}
              className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {saveReportLoading ? "Saving…" : "Save Report"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const questionLimit = questionLimitByScan[scanOption];
  // When user continued to deeper assessment, questions array has more than the current tier limit; show all so they can complete the new section
  const visibleQuestions =
    selectedCardId === "schemerscore"
      ? questions
      : questions.slice(0, Math.max(questionLimit, questions.length));

  const QUESTIONS_PER_PAGE = 1;

  if (view === "questions") {
    const totalQuestions = visibleQuestions.length;
    const effectiveStart =
      totalQuestions > 0
        ? Math.min(currentQuestionIndex, Math.max(0, totalQuestions - QUESTIONS_PER_PAGE))
        : 0;
    const questionsOnPage = visibleQuestions.slice(
      effectiveStart,
      effectiveStart + QUESTIONS_PER_PAGE
    );
    const endIndex = Math.min(effectiveStart + QUESTIONS_PER_PAGE, totalQuestions);
    const isCombinedList = selectedCardId !== "schemerscore" && visibleQuestions.length > questionLimit;
    const questionNumberOffset =
      selectedCardId !== "schemerscore"
        ? scanOption === "quick"
          ? 0
          : scanOption === "medium"
            ? questionLimitByScan.quick // 10
            : questionLimitByScan.quick + questionLimitByScan.medium // 38
        : 0;
    const progressLabel =
      totalQuestions > 0
        ? isCombinedList
          ? `${effectiveStart + 1}-${endIndex} of ${CRAY_TOTAL_MAX}`
          : `${questionNumberOffset + effectiveStart + 1}-${questionNumberOffset + endIndex} of ${
              selectedCardId !== "schemerscore" ? CRAY_TOTAL_MAX : totalQuestions
            }`
        : "0/0";
    const isOnLastPage =
      totalQuestions > 0 && effectiveStart + QUESTIONS_PER_PAGE >= totalQuestions;

    return (
      <div className="flex w-full max-w-5xl gap-8">
        {/* Left: steps + Continue */}
        <div className="flex w-48 flex-shrink-0 flex-col rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">1</span>
            <span className="text-sm font-medium text-gray-900">Step 1</span>
          </div>
          <div className="my-2 h-6 w-px bg-gray-200 ml-4" />
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-300 bg-white text-sm font-medium text-gray-500">2</span>
            <span className="text-sm font-medium text-gray-500">Step 2</span>
          </div>
          <div className="my-2 h-6 w-px bg-gray-200 ml-4" />
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-300 bg-white text-sm font-medium text-gray-500">3</span>
            <span className="text-sm font-medium text-gray-500">Step 3</span>
          </div>
          <div className="mt-8">
            <button type="button" className="w-full rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700">Continue</button>
          </div>
        </div>

        {/* Right: questionnaire */}
        <div className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-gray-100/50 p-6">
          <button type="button" onClick={() => setView(selectedCardId === "schemerscore" ? "no-contacts" : "step3-details")} className="mb-4 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">← Back</button>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-300 text-gray-600">👤</div>
              <span className="font-semibold text-gray-900">{lastAddedContactName || "Contact"}</span>
            </div>
            <span className="text-sm font-medium text-gray-600">{progressLabel}</span>
          </div>
          <p className="mb-6 text-sm font-medium text-gray-700">Please select an option above that best fits the statement.</p>

          {questionsError && (
            <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
              <p>{questionsError}</p>
              {(questionsError.toLowerCase().includes("expired") || questionsError.toLowerCase().includes("refresh your token")) && (
                <a href="/" className="mt-2 inline-block font-medium text-red-700 underline hover:text-red-800">Sign in again</a>
              )}
            </div>
          )}

          {(restoringQuestions || questionsLoading) && visibleQuestions.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Restoring your progress…</div>
          )}
          {totalQuestions === 0 && !questionsLoading && !restoringQuestions && !questionsError && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">No questions available.</div>
          )}

          {questionsOnPage.length > 0 && (
            <div className="space-y-6">
              {questionsOnPage.map((q, idx) => {
                const questionNumber = isCombinedList ? effectiveStart + idx + 1 : questionNumberOffset + effectiveStart + idx + 1;
                const answer = questionAnswers[q._id];
                return (
                  <div key={q._id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <p className="text-sm font-medium text-gray-500">Q{questionNumber}.</p>
                    <p className="mt-1 font-medium text-gray-900">
                      {connectionType === "online" && q.questionNotmet
                        ? q.questionNotmet
                        : q.question}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-4">
                      {[
                        { value: "yes" as const, label: "Yes", icon: "✓", desc: "You agree or say 'Yes' to the question.", color: "green" },
                        { value: "no" as const, label: "No", icon: "✕", desc: "You disagree or say 'No' to the question.", color: "red" },
                        { value: "notSure" as const, label: "Not Sure", icon: "?", desc: "You are unsure or neutral.", color: "blue" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setQuestionAnswers((prev) => ({ ...prev, [q._id]: opt.value }));
                            if (selectedCardId === "crayscore" && opt.value === "yes") {
                              const pts = typeof (q as { points?: number }).points === "number" ? (q as { points: number }).points : 0;
                              if (pts === 3 || pts === 4) {
                                const audio = new Audio("/audio/warning_tone.wav");
                                audio.play().catch(() => {});
                              }
                            }
                          }}
                          className={`flex flex-col items-start rounded-xl border-2 p-4 text-left transition-colors ${
                            answer === opt.value
                              ? "border-red-600 bg-red-50"
                              : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                        >
                          <span className="flex items-center gap-2 font-medium text-gray-900">
                            {opt.color === "green" && <span className="text-green-600">✓</span>}
                            {opt.color === "red" && <span className="text-red-600">✕</span>}
                            {opt.color === "blue" && <span className="text-blue-600">?</span>}
                            {opt.label}
                          </span>
                          <span className="mt-1 text-xs text-gray-500">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                    {q.description && (
                      <p className="mt-4 text-sm text-gray-600">{q.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-8 flex justify-between">
            <button
              type="button"
              onClick={() => {
                // If the user has answered at least one question, show the report.
                // If no answers have been given, go back to the previous page.
                const hasAnyAnswer = Object.keys(questionAnswers).length > 0;
                if (hasAnyAnswer) {
                  handleQuit();
                } else {
                  setQuitSummary(null);
                  setView(selectedCardId === "schemerscore" ? "no-contacts" : "step3-details");
                }
              }}
              className="rounded-xl border border-gray-300 bg-white px-6 py-3 font-medium text-gray-900 hover:bg-gray-50"
            >
              Quit
            </button>
            <button
              type="button"
              onClick={() => {
                if (isOnLastPage) {
                  if (selectedCardId === "schemerscore") {
                    handleQuit();
                  } else if (scanOption === "quick" && totalQuestions === 10) {
                    setReviewProgressModalOpen(true);
                  } else if (scanOption === "medium" && (totalQuestions === 28 || totalQuestions === 38)) {
                    setReviewProgressModalOpen(true);
                  } else {
                    handleQuit();
                  }
                } else {
                  setCurrentQuestionIndex((i) => i + QUESTIONS_PER_PAGE);
                }
              }}
              disabled={questionsOnPage.length === 0}
              className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

        {/* Review progress modal: after 10 (quick), 38 (medium), or 74 (full) questions - CrayScore only; SchemerScore goes straight to report */}
        {reviewProgressModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl text-blue-600">
                📊
              </div>
              <h3 className="mt-4 text-lg font-bold text-gray-900">
                {scanOption === "quick" && "Quick Review Progress"}
                {scanOption === "medium" && "Medium Review Progress"}
                {scanOption === "full" && "Full Review Progress"}
              </h3>
              <p className="mt-3 text-sm text-gray-600">
                You&apos;ve completed the {scanOption} review. Tap &apos;Continue&apos; to explore a deeper assessment, or close this window if you&apos;re done.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (scanOption === "full") {
                    setReviewProgressModalOpen(false);
                    handleQuit();
                  } else {
                    handleContinueToDeeperAssessment();
                  }
                }}
                disabled={questionsLoading}
                className="mt-6 w-full rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {questionsLoading ? "Loading…" : "Continue"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReviewProgressModalOpen(false);
                  handleQuit();
                }}
                className="mt-3 block w-full text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "no-contacts") {
    return (
      <div className="flex w-full max-w-4xl flex-col">
        <button
          type="button"
          onClick={() => setView("dashboard")}
          className="mb-6 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Back
        </button>
        {contactListLoading ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 py-16">
            <p className="text-gray-600">Loading contacts…</p>
          </div>
        ) : contacts.length > 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            {questionsError && selectedCardId === "schemerscore" && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <p>{questionsError}</p>
                {(questionsError.toLowerCase().includes("expired") || questionsError.toLowerCase().includes("refresh your token")) && (
                  <a href="/" className="mt-2 inline-block font-medium text-red-700 underline hover:text-red-800">Sign in again</a>
                )}
              </div>
            )}
            <div className="mb-4 flex items-center justify-between">
              <p className="text-lg font-bold text-gray-900">Your contacts</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setContactModalOpen(true)}
                  className="rounded-xl border border-red-600 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Add contact
                </button>
                <button
                  type="button"
                  onClick={handleNoContactsContinue}
                  disabled={questionsLoading || selectedContactIndex === null}
                  className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {questionsLoading ? "Loading…" : "Continue"}
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[320px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 pr-4 font-medium">Phone</th>
                    <th className="pb-3 font-medium">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c, i) => (
                    <tr
                      key={i}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedContactIndex(i)}
                      onKeyDown={(e) => e.key === "Enter" && setSelectedContactIndex(i)}
                      className={`cursor-pointer border-b border-gray-100 last:border-0 transition-colors ${
                        selectedContactIndex === i ? "bg-red-50 ring-1 ring-inset ring-red-200" : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="py-3 pr-4 font-medium text-gray-900">{c.name || "—"}</td>
                      <td className="py-3 pr-4 text-gray-700">{formatContactPhone(c.countryCode, c.phone)}</td>
                      <td className="py-3 text-gray-600">{c.email || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 py-16">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-gray-400 text-4xl text-gray-400">
              +
            </div>
            <p className="mt-6 text-xl font-bold text-gray-900">You don&apos;t have any contacts</p>
            <button
              type="button"
              onClick={() => setContactModalOpen(true)}
              className="mt-6 rounded-xl bg-red-600 px-8 py-3 font-bold text-white hover:bg-red-700"
            >
              Add Contacts
            </button>
          </div>
        )}
        {contactModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
              <button
                type="button"
                onClick={() => { setAddContactError(null); setContactModalOpen(false); }}
                className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
              <h3 className="text-lg font-bold text-gray-900">Enter Contact Information</h3>
              {addContactError && (
                <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{addContactError}</div>
              )}
              <form onSubmit={handleAddContactSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="e.g. Aurora Scott"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Phone Number</label>
                  <div className="flex gap-2">
                    <select
                      value={contactCountryCode}
                      onChange={(e) => setContactCountryCode(e.target.value)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
                    >
                      <option value="+1">+1</option>
                      <option value="+91">+91</option>
                      <option value="+44">+44</option>
                    </select>
                    <input
                      type="tel"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="(555) 000-0000"
                      className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Email (optional)</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="email@example.com"
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                  />
                </div>
                <div className="flex flex-col gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={addContactLoading}
                    className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {addContactLoading ? "Saving…" : "Save & Next"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddContactError(null); setContactModalOpen(false); }}
                    disabled={addContactLoading}
                    className="text-gray-600 hover:text-gray-900 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {disclaimerModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-3xl text-blue-600">🌐</div>
              <h3 className="mt-4 text-lg font-bold uppercase tracking-tight text-gray-900">Private & for entertainment purposes only</h3>
              <p className="mt-4 text-left text-sm text-gray-700">
                The person ({lastAddedContactName}) you&apos;re reviewing will <strong>NEVER</strong> see your feedback or be notified that they were reviewed.
              </p>
              <p className="mt-2 text-left text-sm text-gray-700">
                All reviews are confidential and intended to be used only for your personal entertainment purposes.
              </p>
              <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={disclaimerDontShowAgain}
                  onChange={(e) => setDisclaimerDontShowAgain(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                Don&apos;t show this again
              </label>
              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleDisclaimerProceed}
                  className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700"
                >
                  Proceed Review
                </button>
                <button type="button" onClick={() => setDisclaimerModalOpen(false)} className="text-gray-600 hover:text-gray-900">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-4xl flex-col">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">
          Welcome to your overview!
        </h2>
        <p className="mt-2 text-3xl font-bold text-gray-900">
          Hello, {displayName}
        </p>
        <p className="mt-2 flex items-center gap-2 text-gray-600">
          <span className="h-4 w-1 shrink-0 bg-red-500" />
          Please choose an option below to proceed
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => {
          const isSelected = selectedCardId === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setSelectedCardId(card.id)}
              className={`relative flex gap-4 rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md ${
                isSelected
                  ? "border-red-500 bg-red-50/30 ring-1 ring-red-500"
                  : "border-gray-200 bg-white hover:border-red-200"
              }`}
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${card.iconBg} text-xl text-white`}>
                {card.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-gray-900">{card.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{card.description}</p>
              </div>
              <span className="absolute right-4 top-4 text-gray-400">→</span>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!isContinueEnabled}
          className={`rounded-xl px-8 py-3 font-bold transition ${
            isContinueEnabled
              ? "bg-red-600 text-white hover:bg-red-700"
              : "cursor-not-allowed bg-red-200 text-white/90"
          }`}
        >
          Continue
        </button>
      </div>

      {contactModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <button
              type="button"
              onClick={() => { setAddContactError(null); setContactModalOpen(false); }}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              ✕
            </button>
            <h3 className="text-lg font-bold text-gray-900">Enter Contact Information</h3>
            {addContactError && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{addContactError}</div>
            )}
            <form onSubmit={handleAddContactSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="e.g. Aurora Scott"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Phone Number</label>
                <div className="flex gap-2">
                  <select
                    value={contactCountryCode}
                    onChange={(e) => setContactCountryCode(e.target.value)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
                  >
                    <option value="+1">+1</option>
                    <option value="+91">+91</option>
                    <option value="+44">+44</option>
                  </select>
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="(555) 000-0000"
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email (optional)</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                />
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="submit"
                  disabled={addContactLoading}
                  className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {addContactLoading ? "Saving…" : "Save & Next"}
                </button>
                <button
                  type="button"
                  onClick={() => { setAddContactError(null); setContactModalOpen(false); }}
                  disabled={addContactLoading}
                  className="text-gray-600 hover:text-gray-900 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {disclaimerModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-3xl text-blue-600">🌐</div>
            <h3 className="mt-4 text-lg font-bold uppercase tracking-tight text-gray-900">Private & for entertainment purposes only</h3>
            <p className="mt-4 text-left text-sm text-gray-700">
              The person ({lastAddedContactName}) you&apos;re reviewing will <strong>NEVER</strong> see your feedback or be notified that they were reviewed.
            </p>
            <p className="mt-2 text-left text-sm text-gray-700">
              All reviews are confidential and intended to be used only for your personal entertainment purposes.
            </p>
            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={disclaimerDontShowAgain}
                onChange={(e) => setDisclaimerDontShowAgain(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              Don&apos;t show this again
            </label>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleDisclaimerProceed}
                className="rounded-xl bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-700"
              >
                Proceed Review
              </button>
              <button type="button" onClick={() => setDisclaimerModalOpen(false)} className="text-gray-600 hover:text-gray-900">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
