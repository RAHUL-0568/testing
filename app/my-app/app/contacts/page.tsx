"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getStoredProfilePicture } from "../lib/profilePicture";
import { trackEvent } from "../lib/analytics";
import type { VerifyResponseBody } from "../components/VerificationCodeBox";

type AuthData = NonNullable<VerifyResponseBody["data"]>;

type ContactItem = {
  _id: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  isNumberAvailable?: boolean;
  createdAt?: string | Date;
};

const AUTH_STORAGE_KEY = "cray_auth_data";
const PROFILE_COMPLETE_KEY = "cray_profile_complete";
const OVERVIEW_SESSION_KEY = "cray_overview_session";
const SAVED_REPORTS_KEY = "cray_saved_reports";

const COUNTRY_CODES = [
  { code: "+1", label: "United States", flag: "🇺🇸" },
  { code: "+44", label: "United Kingdom", flag: "🇬🇧" },
  { code: "+91", label: "India", flag: "🇮🇳" },
  { code: "+61", label: "Australia", flag: "🇦🇺" },
  { code: "+81", label: "Japan", flag: "🇯🇵" },
  { code: "+49", label: "Germany", flag: "🇩🇪" },
  { code: "+33", label: "France", flag: "🇫🇷" },
  { code: "+86", label: "China", flag: "🇨🇳" },
  { code: "+971", label: "UAE", flag: "🇦🇪" },
  { code: "+966", label: "Saudi Arabia", flag: "🇸🇦" },
];

function formatCreatedDate(raw: string | Date | undefined): string {
  if (!raw) return "—";
  const d = typeof raw === "string" ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Avoid showing encrypted/hashed values (e.g. base64) as name; treat as missing. */
function isLikelyHash(s: string | undefined): boolean {
  if (!s || typeof s !== "string") return true;
  const t = s.trim();
  return t.length > 20 && /^[A-Za-z0-9+/]+=*$/.test(t);
}

export default function ContactsPage() {
  const router = useRouter();
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "createdAt">("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [showCreateView, setShowCreateView] = useState(false);
  const [selectedContactForReview, setSelectedContactForReview] = useState<ContactItem | null>(null);
  const [selectedProductForReview, setSelectedProductForReview] = useState<"cray" | "schemer" | "catfish">("cray");
  const [createFirstName, setCreateFirstName] = useState("");
  const [createCountryCode, setCreateCountryCode] = useState("+1");
  const [createPhoneNumber, setCreatePhoneNumber] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [displayNames, setDisplayNames] = useState<{ firstName: string; lastName: string } | null>(null);
  const [reviewPromptOpen, setReviewPromptOpen] = useState(false);
  const [reviewPromptLoading, setReviewPromptLoading] = useState(false);
  const [reviewPromptHasExisting, setReviewPromptHasExisting] = useState(false);
  const [reviewPromptError, setReviewPromptError] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Decrypt profile names when backend returns encrypted firstName/lastName (same as home page)
  useEffect(() => {
    if (!isReady || !authData?.user) return;
    const first = (authData.user.firstName ?? "").trim();
    const last = (authData.user.lastName ?? "").trim();
    if (!first && !last) {
      setDisplayNames({ firstName: "", lastName: "" });
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/auth/decrypt-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firstName: first || undefined, lastName: last || undefined }),
        });
        const data = await res.json();
        setDisplayNames({
          firstName: data?.firstName ?? first,
          lastName: data?.lastName ?? last,
        });
      } catch {
        setDisplayNames({ firstName: first, lastName: last });
      }
    })();
  }, [isReady, authData?.user?.firstName, authData?.user?.lastName]);

  // Best-effort: primary contact for this user (used under the Self Check name)
  const primaryContact = contacts[0];
  const selfContactLine =
    (primaryContact?.phone && primaryContact.phone.trim()) ||
    (primaryContact?.email && primaryContact.email.trim()) ||
    ((authData?.user as { phone?: string })?.phone ?? "");

  // Start a Cray/Schemer review flow for the selected contact
  const startReviewFlow = useCallback(() => {
    if (!selectedContactForReview) return;
    const isSchemer = selectedProductForReview === "schemer";
    const session: Record<string, unknown> = {
      source: "contacts",
      // For Schemer, jump into its own flow instead of the Cray scan-options screen
      view: isSchemer ? "no-contacts" : "scan-options",
      selectedCardId: isSchemer ? "schemerscore" : "crayscore",
      lastAddedContactName: selectedContactForReview.name || "Contact",
      lastAddedContactPhone: selectedContactForReview.phone || "",
      scanOption: "quick",
      connectionType: "online",
    };
    try {
      sessionStorage.setItem(OVERVIEW_SESSION_KEY, JSON.stringify(session));
    } catch {
      // ignore storage errors
    }
    setReviewPromptOpen(false);
    setSelectedContactForReview(null);
    router.push("/home?view=dashboard");
  }, [router, selectedContactForReview, selectedProductForReview]);

  const checkExistingReviewForSelected = useCallback(async () => {
    const token = authData?.auth?.AccessToken;
    if (!token || !selectedContactForReview?.phone) {
      // No token or phone: just start a fresh review without showing the prompt
      startReviewFlow();
      return;
    }
    setReviewPromptLoading(true);
    setReviewPromptError(null);
    try {
      const res = await fetch("/api/auth/home-review-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token,
          action: "getUserHomeReviewDetailsV1",
          page: 1,
          limit: 10,
          phoneNumber: selectedContactForReview.phone,
        }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      let items: any[] = Array.isArray(body?.data) ? (body.data as any[]) : [];
      if (selectedProductForReview === "cray") {
        items = items.filter(
          (d) =>
            (d.moduleType === "review" && !d.isSchemerReview) ||
            d.moduleType === "crayscore"
        );
      } else if (selectedProductForReview === "schemer") {
        items = items.filter(
          (d) => d.isSchemerReview === true || d.moduleType === "schemerscore"
        );
      }

      // If API did not return any items, fall back to locally saved reports (like Home page)
      if (items.length === 0 && typeof window !== "undefined" && selectedContactForReview.phone) {
        try {
          const raw = localStorage.getItem(SAVED_REPORTS_KEY);
          const stored = raw ? (JSON.parse(raw) as Record<string, any[]>) : {};
          const phoneDigits = (selectedContactForReview.phone || "").replace(/\D/g, "");
          const localList = stored[phoneDigits] ?? [];
          if (selectedProductForReview === "cray") {
            items = localList.filter((d) => (d.reportType || "crayscore") !== "schemerscore");
          } else if (selectedProductForReview === "schemer") {
            items = localList.filter((d) => (d.reportType || "") === "schemerscore");
          }
        } catch {
          // ignore localStorage errors
        }
      }
      const hasExisting = items.length > 0;
      setReviewPromptHasExisting(hasExisting);
      if (hasExisting) {
        // Only show the Review Again / View Score prompt when there is an existing review
        setReviewPromptOpen(true);
      } else {
        startReviewFlow();
      }
    } catch (e) {
      setReviewPromptError(
        e instanceof Error ? e.message : "Failed to check previous reviews."
      );
      setReviewPromptHasExisting(false);
    } finally {
      setReviewPromptLoading(false);
    }
  }, [authData?.auth?.AccessToken, selectedContactForReview, selectedProductForReview, startReviewFlow]);

  // When user taps "View Score" in the prompt, try to open the full report view for that contact/product.
  const handleViewScoreFromPrompt = useCallback(() => {
    if (!selectedContactForReview) return;

    let openedFullReport = false;

    if (typeof window !== "undefined") {
      try {
        const phoneDigits = (selectedContactForReview.phone || "").replace(/\D/g, "");
        if (phoneDigits) {
          const raw = localStorage.getItem(SAVED_REPORTS_KEY);
          const stored = raw ? (JSON.parse(raw) as Record<string, any[]>) : {};
          const list = stored[phoneDigits] ?? [];
          const productType =
            selectedProductForReview === "schemer" ? "schemerscore" : "crayscore";

          const matching = list.filter(
            (item) => (item.reportType || "crayscore") === productType
          );

          if (matching.length > 0) {
            // Use the latest saved report for this contact + product
            const latest = matching.reduce((a, b) =>
              (a.dateTime || a.createdAt || 0) > (b.dateTime || b.createdAt || 0) ? a : b
            );

            const answers = Array.isArray(latest.answers) ? latest.answers : [];
            const categoryCounts: Record<string, number> = {};
            for (const ans of answers as Array<{ category?: string }>) {
              const cat = ans.category || "Other";
              categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
            }

            const session: Record<string, unknown> = {
              source: "contacts",
              fromViewScore: true,
              view: "report",
              selectedCardId: productType === "schemerscore" ? "schemerscore" : "crayscore",
              lastAddedContactName: selectedContactForReview.name || "Contact",
              lastAddedContactPhone: selectedContactForReview.phone || "",
              reportAnswerFilter: "all",
              reportExpandedCategory: null,
              quitSummary: {
                answers,
                reviewType: (latest.reviewType as "quick" | "medium" | "full") || "quick",
                categoryCounts,
                reportType: productType,
              },
            };

            sessionStorage.setItem(OVERVIEW_SESSION_KEY, JSON.stringify(session));
            openedFullReport = true;
          }
        }
      } catch {
        // fall back to recent activity list
      }
    }

    setReviewPromptOpen(false);
    setSelectedContactForReview(null);

    if (openedFullReport) {
      router.push("/home?view=dashboard");
    } else {
      router.push("/home?view=recent");
    }
  }, [router, selectedContactForReview, selectedProductForReview]);

  useEffect(() => {
    try {
      const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
      const isProfileComplete = localStorage.getItem(PROFILE_COMPLETE_KEY) === "true";
      if (!savedAuth || !isProfileComplete) {
        window.location.href = "/";
        return;
      }
      const parsed = JSON.parse(savedAuth) as AuthData;
      if (!parsed?.user) {
        window.location.href = "/";
        return;
      }
      setAuthData(parsed);
    } catch {
      window.location.href = "/";
      return;
    }
    setIsReady(true);
  }, []);

  // Track Contacts screen view
  useEffect(() => {
    if (!isReady || !authData) return;
    trackEvent(
      "Page Viewed",
      {
        screen_name: "Contacts Screen",
      },
      authData as any
    );
  }, [isReady, authData]);

  const fetchContacts = useCallback(async () => {
    const token = authData?.auth?.AccessToken;
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, action: "getContacts" }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      if (body?.status === "success" && Array.isArray(body.contacts)) {
        const raw = body.contacts as ContactItem[];
        const seen = new Set<string>();
        const unique: ContactItem[] = [];
        for (const c of raw) {
          const nameKey = (c.name || "").trim().toLowerCase();
          const phoneKey = (c.phone || "").replace(/\D/g, "");
          const key = `${nameKey}|${phoneKey}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(c);
        }
        setContacts(unique);
      } else {
        setContacts([]);
        setError(body?.message ?? "Failed to load contacts.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts.");
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [authData?.auth?.AccessToken]);

  useEffect(() => {
    if (!isReady || !authData) return;
    fetchContacts();
  }, [isReady, authData, fetchContacts]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCreateContact = useCallback(async () => {
    const token = authData?.auth?.AccessToken;
    if (!token) return;
    setCreateError(null);
    const name = createFirstName.trim();
    const number = createPhoneNumber.trim().replace(/\D/g, "");
    const phone = number ? `${createCountryCode}${number}` : "";
    if (!name) {
      setCreateError("Enter first name.");
      return;
    }
    setCreateSubmitting(true);
    try {
      const payload = JSON.stringify([
        { name: name || "Unknown", phone, email: "" },
      ]);
      const res = await fetch("/api/auth/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token,
          action: "addContacts",
          contacts: payload,
        }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      if (body?.status === "success") {
        trackEvent(
          "Contact Added",
          { added_name: name, added_phone_number: phone },
          authData as any
        );
        setShowCreateView(false);
        setCreateFirstName("");
        setCreateCountryCode("+1");
        setCreatePhoneNumber("");
        fetchContacts();
      } else {
        setCreateError(body?.message ?? "Failed to add contact.");
      }
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to add contact.");
    } finally {
      setCreateSubmitting(false);
    }
  }, [authData?.auth?.AccessToken, fetchContacts]);

  const filteredContacts = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q)
    );
  });

  const sortedContacts = [...filteredContacts].sort((a, b) => {
    if (sortBy === "name") {
      const na = (a.name || "").toLowerCase();
      const nb = (b.name || "").toLowerCase();
      return sortAsc ? na.localeCompare(nb) : nb.localeCompare(na);
    }
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return sortAsc ? ta - tb : tb - ta;
  });

  const toggleSort = (field: "name" | "createdAt") => {
    if (sortBy === field) setSortAsc((prev) => !prev);
    else setSortBy(field);
  };

  if (!isReady || !authData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="border-b border-gray-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/home" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-lg">
              🦊
            </div>
            <span className="text-xl font-bold text-red-600">CRAY</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-gray-600">
            <Link href="/home" className="hover:text-gray-900">
              Dashboard
            </Link>
            <Link href="/contacts" className="font-semibold text-red-600">
              Contacts
            </Link>
            <Link href="/home/settings" className="hover:text-gray-900">
              Settings
            </Link>
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                className="flex h-8 w-8 overflow-hidden rounded-full border border-gray-300 bg-white"
              >
                {(authData.user.picture || getStoredProfilePicture(authData.auth)) ? (
                  <img
                    src={authData.user.picture || getStoredProfilePicture(authData.auth) || ""}
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  "👤"
                )}
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <Link
                    href="/home"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    My Profile
                  </Link>
                  <Link
                    href="/home/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Settings
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        {selectedContactForReview ? (
          <div className="flex flex-col gap-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:flex-row">
            {/* Left panel - selected contact details */}
            <div className="lg:w-2/5">
              <button
                type="button"
                onClick={() => setSelectedContactForReview(null)}
                className="mb-6 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                <span aria-hidden>←</span> Back
              </button>
              <h2 className="text-xl font-bold text-gray-900">
                You&apos;ve chosen to review this contact
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">
                Choose a check to run for this person so you can better understand risk, manipulation, or catfishing concerns.
              </p>

              <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-xl">
                    👤
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {selectedContactForReview.name || "Contact"}
                    </p>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {selectedContactForReview.phone || selectedContactForReview.email || "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right panel - product choices (no Background Check) */}
            <div className="flex-1 space-y-6">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                  Step 1
                </p>
                <h3 className="mt-1 text-xl font-bold text-gray-900">
                  What Would You Like to Check?
                </h3>
                <p className="mt-2 text-sm text-gray-600">
                  Choose one of the options below to continue with this contact.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  {
                    id: "cray" as const,
                    title: "Cray Score",
                    description:
                      "Respond to statements to see if your partner shows concerning or unstable behavior.",
                  },
                  {
                    id: "schemer" as const,
                    title: "Schemer Score",
                    description:
                      "Check for manipulation or opportunism — are they using you for money, sex, or status?",
                  },
                  {
                    id: "catfish" as const,
                    title: "Catfish Score",
                    description:
                      "Verify if this person is who they say they are and spot catfishing red flags.",
                  },
                ].map((opt) => {
                  const isSelected = selectedProductForReview === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelectedProductForReview(opt.id)}
                      className={`flex flex-col rounded-2xl border p-4 text-left shadow-sm transition hover:shadow-md ${
                        isSelected
                          ? "border-red-500 bg-red-50/40 ring-1 ring-red-500"
                          : "border-gray-200 bg-white hover:border-red-200"
                      }`}
                    >
                      <span className="text-sm font-semibold text-gray-900">
                        {opt.title}
                      </span>
                      <span className="mt-1 text-xs text-gray-600">
                        {opt.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedContactForReview) return;
                    if (selectedProductForReview === "cray" || selectedProductForReview === "schemer") {
                      checkExistingReviewForSelected();
                    } else {
                      setSelectedContactForReview(null);
                    }
                  }}
                  disabled={!selectedProductForReview}
                  className={`rounded-xl px-8 py-3 text-sm font-bold ${
                    selectedProductForReview
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "cursor-not-allowed bg-red-200 text-white/90"
                  }`}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : showCreateView ? (
          <div className="flex flex-col gap-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:flex-row">
            {/* Left panel - Self-review context */}
            <div className="lg:w-2/5">
              <button
                type="button"
                onClick={() => {
                  setShowCreateView(false);
                  setCreateError(null);
                }}
                className="mb-6 flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                <span aria-hidden>←</span> Back
              </button>
              <h2 className="text-xl font-bold text-gray-900">
                You&apos;ve chosen to do a self-review
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-gray-600">
                This check analyzes your own contact information to provide insights into validity, risk indicators, and verification status.
              </p>
            </div>

            {/* Right panel - Your Contact Details + Add New Contact */}
            <div className="flex-1 space-y-6">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Your Contact Details</h3>
                <div className="mt-3 flex items-center gap-4 rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-4">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-xl">
                    👤
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {[
                        displayNames?.firstName ?? (isLikelyHash(authData?.user?.firstName) ? "" : authData?.user?.firstName),
                        displayNames?.lastName ?? (isLikelyHash(authData?.user?.lastName) ? "" : authData?.user?.lastName),
                      ]
                        .map((part) => (part && !isLikelyHash(part) ? part : ""))
                        .filter(Boolean)
                        .join(" ") || "—"}{" "}
                      <span className="text-gray-500">(Self Check)</span>
                    </p>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {selfContactLine || "—"}
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-center text-sm font-medium text-gray-500">Or</p>

              <div>
                <h3 className="text-base font-semibold text-gray-900">Add New Contact</h3>
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="create-first-name" className="block text-sm font-medium text-gray-700">
                      First Name
                    </label>
                    <input
                      id="create-first-name"
                      type="text"
                      value={createFirstName}
                      onChange={(e) => {
                        setCreateFirstName(e.target.value);
                        if (createError) setCreateError(null);
                      }}
                      placeholder="enter here"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="create-phone-number" className="block text-sm font-medium text-gray-700">
                      Phone Number
                    </label>
                    <div className="mt-1 flex gap-2">
                      <select
                        value={createCountryCode}
                        onChange={(e) => setCreateCountryCode(e.target.value)}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                        aria-label="Country code"
                      >
                        {COUNTRY_CODES.map((cc) => (
                          <option key={cc.code} value={cc.code}>
                            {cc.flag} {cc.code}
                          </option>
                        ))}
                      </select>
                      <input
                        id="create-phone-number"
                        type="tel"
                        value={createPhoneNumber}
                        onChange={(e) => setCreatePhoneNumber(e.target.value)}
                        placeholder="enter here"
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                      />
                    </div>
                  </div>
                </div>
                {createError && !createFirstName.trim() && (
                  <p className="mt-3 text-sm text-red-600">{createError}</p>
                )}
                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={handleCreateContact}
                    disabled={createSubmitting}
                    className="rounded-xl bg-red-600 px-6 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {createSubmitting ? "Saving…" : "Save & Next"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-2xl font-bold text-gray-900">
                {contacts.length} Contact{contacts.length !== 1 ? "s" : ""}
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/home"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <span aria-hidden>👤</span>
                  Self Review
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setCreateError(null);
                    setShowCreateView(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700"
                >
                  <span aria-hidden>+</span>
                  Create new contact
                </button>
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="contacts-search" className="sr-only">
                Search contact
              </label>
              <input
                id="contacts-search"
                type="search"
                placeholder="Search contact"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2.5 text-sm placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
          </div>

          {error && (
            <div className="mx-6 mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="w-12 px-6 py-3">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col" className="px-6 py-3 text-left">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-900"
                    >
                      Contact name
                      <span aria-hidden>{sortBy === "name" ? (sortAsc ? "↑" : "↓") : "↕"}</span>
                    </button>
                  </th>
                  <th scope="col" className="px-6 py-3 text-left">
                    <button
                      type="button"
                      onClick={() => toggleSort("createdAt")}
                      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-900"
                    >
                      Created Date
                      <span aria-hidden>{sortBy === "createdAt" ? (sortAsc ? "↑" : "↓") : "↕"}</span>
                    </button>
                  </th>
                  <th scope="col" className="px-6 py-3 text-right">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Action
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500">
                      Loading contacts…
                    </td>
                  </tr>
                ) : sortedContacts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500">
                      No contacts yet. Create one to get started.
                    </td>
                  </tr>
                ) : (
                  sortedContacts.map((contact) => (
                    <tr key={contact._id} className="hover:bg-gray-50">
                      <td className="w-12 px-6 py-4">
                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300" aria-label={`Select ${contact.name}`} />
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => setSelectedContactForReview(contact)}
                          className="block w-full text-left"
                        >
                          <div>
                            <p className="font-medium text-gray-900">{contact.name || "—"}</p>
                            {contact.phone ? (
                              <p className="text-xs text-gray-500">{contact.phone}</p>
                            ) : null}
                          </div>
                        </button>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatCreatedDate(contact.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                            aria-label={`Edit ${contact.name}`}
                            title="Edit"
                          >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Delete ${contact.name}`}
                            title="Delete"
                          >
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </main>

      {reviewPromptOpen && selectedContactForReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              {selectedContactForReview.name || "Contact"}
            </h2>
            <p className="mb-1 text-xs text-gray-500">
              {selectedContactForReview.phone || selectedContactForReview.email || "—"}
            </p>
            {reviewPromptLoading ? (
              <p className="mt-4 text-sm text-gray-600">Checking previous reviews…</p>
            ) : (
              <p className="mt-4 text-sm text-gray-700">
                {reviewPromptHasExisting
                  ? "This contact has already been reviewed by you. Would you like to review it again or just view the score?"
                  : "Would you like to start a new review for this contact or view scores from Recent Activity?"}
              </p>
            )}
            {reviewPromptError && (
              <p className="mt-2 text-xs text-red-600">{reviewPromptError}</p>
            )}
            <div className="mt-6 space-y-2">
              <button
                type="button"
                disabled={reviewPromptLoading}
                onClick={() => {
                  startReviewFlow();
                }}
                className="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Review Again
              </button>
              <button
                type="button"
                disabled={reviewPromptLoading}
                onClick={handleViewScoreFromPrompt}
                className="inline-flex w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                View Score
              </button>
              <button
                type="button"
                onClick={() => {
                  setReviewPromptOpen(false);
                }}
                className="mt-1 inline-flex w-full items-center justify-center rounded-xl bg-transparent px-4 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
