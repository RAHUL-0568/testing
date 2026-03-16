"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Overview from "../components/Overview";
import type { VerifyResponseBody } from "../components/VerificationCodeBox";
import { getStoredProfilePicture } from "../lib/profilePicture";
import { identifyUser, trackEvent } from "../lib/analytics";

type AuthData = NonNullable<VerifyResponseBody["data"]>;

type HomeReviewItem = {
  _id: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  progress?: number;
  score?: number;
  isSchemerReview?: boolean;
  isCatfishReview?: boolean;
  reviewType?: string;
  questionType?: number;
  dateTime?: number;
  moduleType?: string;
};

/** True if two phone strings refer to the same contact (handles with/without country code) */
function sameContactPhone(a: string | undefined, b: string | undefined): boolean {
  const ad = (a ?? "").replace(/\D/g, "");
  const bd = (b ?? "").replace(/\D/g, "");
  if (!ad || !bd) return ad === bd;
  if (ad === bd) return true;
  const minLen = Math.min(ad.length, bd.length);
  if (minLen >= 7 && (ad.endsWith(bd) || bd.endsWith(ad))) return true;
  return false;
}

/** Map: normalized phone digits -> list of sources that contact was added from (from getContactList) */
type ContactSourcesByPhone = Record<string, ("crayscore" | "schemerscore")[]>;

/** Basic contact info keyed by normalized phone digits (from getContactList) */
type ContactMetaByPhone = Record<string, { name: string; phone: string }>;

/** For a contact (by phone), which scores exist (from review list and/or contact list source) */
function getContactScoreFlags(
  phoneNumber: string | undefined,
  allReviews: HomeReviewItem[],
  contactSourcesByPhone?: ContactSourcesByPhone | null
): { hasCray: boolean; hasSchemer: boolean; hasCatfish: boolean } {
  const phone = (phoneNumber ?? "").replace(/\D/g, "");
  if (!phone) return { hasCray: false, hasSchemer: false, hasCatfish: false };
  const forContact = allReviews.filter((r) => sameContactPhone(r.phoneNumber, phoneNumber));
  const isSchemer = (r: HomeReviewItem) => {
    if (Boolean(r.isSchemerReview)) return true;
    if (r.moduleType === "schemerscore" || r.moduleType === "schemer") return true;
    const rt = typeof r.reviewType === "string" ? r.reviewType.toLowerCase() : "";
    if (rt === "schemer" || rt === "schemerscore") return true;
    const raw = r as Record<string, unknown>;
    if (raw.isSchemer === true || raw.is_schemer_review === true) return true;
    const pt = String(raw.productType ?? raw.type ?? raw.source ?? "").toLowerCase();
    if (pt === "schemer" || pt === "schemerscore") return true;
    const arr = Array.isArray(raw.reviewTypes) ? raw.reviewTypes : Array.isArray(raw.scores) ? raw.scores : [];
    if (arr.some((x) => String(x).toLowerCase() === "schemer" || String(x).toLowerCase() === "schemerscore")) return true;
    return false;
  };
  const isCatfish = (r: HomeReviewItem) => Boolean(r.isCatfishReview) || r.moduleType === "catfishnew";
  const isCrayReview = (r: HomeReviewItem) => {
    // Explicit Schemer or Catfish reviews are never Cray.
    if (isSchemer(r) || isCatfish(r)) return false;
    // Positive evidence from backend fields.
    if (r.moduleType === "crayscore" || r.moduleType === "review") return true;
    if (r.isSchemerReview === false && !r.isCatfishReview) return true;
    const raw = r as Record<string, unknown>;
    const pt = String(raw.productType ?? raw.type ?? raw.source ?? "").toLowerCase();
    if (pt === "crayscore" || pt === "cray") return true;
    return false;
  };
  // Icons should reflect which scores were actually calculated for this contact,
  // not just which product they were added from, so we rely only on review data here.
  const hasCray = forContact.some(isCrayReview);
  const hasSchemer = forContact.some(isSchemer);
  const hasCatfish = forContact.some(isCatfish);
  return { hasCray, hasSchemer, hasCatfish };
}

const AUTH_STORAGE_KEY = "cray_auth_data";
const PROFILE_COMPLETE_KEY = "cray_profile_complete";
const BOOT_ID_KEY = "cray_boot_id";
const HOME_VIEW_KEY = "cray_home_view";
const SAVED_REPORTS_KEY = "cray_saved_reports";
const OVERVIEW_SESSION_KEY = "cray_overview_session";

export default function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [displayNames, setDisplayNames] = useState<{ firstName: string; lastName: string } | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [homeReviews, setHomeReviews] = useState<HomeReviewItem[] | null>(null);
  const [homeReviewsLoading, setHomeReviewsLoading] = useState(false);
  const [homeReviewsError, setHomeReviewsError] = useState<string | null>(null);
  const [contactPhones, setContactPhones] = useState<string[]>([]);
  const [contactSourcesByPhone, setContactSourcesByPhone] =
    useState<ContactSourcesByPhone>({});
  const [contactMetaByPhone, setContactMetaByPhone] =
    useState<ContactMetaByPhone>({});
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewModalContact, setReviewModalContact] = useState<{ name: string; phone: string } | null>(null);
  const [reviewModalProduct, setReviewModalProduct] = useState<"cray" | "schemer" | "catfish">("cray");
  const [reviewModalLoading, setReviewModalLoading] = useState(false);
  const [reviewModalError, setReviewModalError] = useState<string | null>(null);
  const [reviewDetails, setReviewDetails] = useState<any[] | null>(null);
  const [productListModal, setProductListModal] = useState<"cray" | "schemer" | null>(null);
  const [showDashboard, setShowDashboard] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const viewFromUrl = searchParams.get("view");
    if (viewFromUrl === "recent") return false;
    if (viewFromUrl === "dashboard") return true;
    const stored = window.localStorage.getItem(HOME_VIEW_KEY);
    if (stored === "recent") return false;
    if (stored === "dashboard") return true;
    return true;
  });
  const userMenuRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(async () => {
    if (authData) {
      trackEvent("Logged Out", {}, authData as any);
    }
    const accessToken = authData?.auth?.AccessToken;
    if (accessToken) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
      } catch {
        // continue with local logout even if API fails
      }
    }
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(PROFILE_COMPLETE_KEY);
    localStorage.removeItem("cray_session");
    localStorage.removeItem("cray_auth_token");
    sessionStorage.removeItem(BOOT_ID_KEY);
    setAuthData(null);
    setIsUserMenuOpen(false);
    router.replace("/");
  }, [router, authData?.auth?.AccessToken]);

  useEffect(() => {
    try {
      const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
      const isProfileComplete = localStorage.getItem(PROFILE_COMPLETE_KEY) === "true";
      if (!savedAuth || !isProfileComplete) {
        router.replace("/");
        return;
      }
      const parsed = JSON.parse(savedAuth) as AuthData;
      if (!parsed?.user) {
        router.replace("/");
        return;
      }
      setAuthData(parsed);
      // Identify user for Mixpanel once auth is available
      identifyUser(parsed as any);
    } catch {
      router.replace("/");
      return;
    }
    setIsReady(true);
  }, [router]);

  // Load recent reviews (Get Home Review new)
  useEffect(() => {
    const token = authData?.auth?.AccessToken;
    if (!isReady || !token) return;
    setHomeReviewsLoading(true);
    setHomeReviewsError(null);
    fetch("/api/auth/home-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token, action: "getUserHomeReview", page: 1, limit: 500 }),
    })
      .then((res) => res.json())
      .then((data) => {
        const body = data?.body ?? data;
        if (body?.status === "success" && Array.isArray(body.data)) {
          setHomeReviews(body.data as HomeReviewItem[]);
        } else {
          setHomeReviews([]);
          if (body?.message && typeof body.message === "string") {
            setHomeReviewsError(body.message);
          }
        }
      })
      .catch((e: unknown) => {
        setHomeReviews([]);
        setHomeReviewsError(e instanceof Error ? e.message : "Failed to load recent reviews.");
      })
      .finally(() => {
        setHomeReviewsLoading(false);
      });
  }, [isReady, authData?.auth?.AccessToken]);

  // Load contact phone numbers and source (crayscore/schemerscore) from Contacts API for icon logic
  useEffect(() => {
    const token = authData?.auth?.AccessToken;
    if (!isReady || !token) return;
    fetch("/api/auth/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Use same Get Contacts API as Contacts page / Overview so the sets match
      body: JSON.stringify({ accessToken: token, action: "getContacts" }),
    })
      .then((res) => res.json())
      .then((data) => {
        const body = data?.body ?? data;
        const rawList = Array.isArray(body?.contacts)
          ? body.contacts
          : Array.isArray(body?.result)
          ? body.result
          : Array.isArray(body?.data)
          ? body.data
          : [];

        if (body?.status === "success" && rawList.length > 0) {
          const list = rawList as {
            name?: string;
            phone?: string;
            countryCode?: string;
            source?: string;
          }[];
          const byPhone: ContactSourcesByPhone = {};
          const metaByPhone: ContactMetaByPhone = {};
          const allDigits = new Set<string>();
          for (const c of list) {
            const name = (c.name ?? "").trim() || "Contact";
            const rawPhone = (c.phone ?? "").trim();
            const cc = (c.countryCode ?? "").replace(/\D/g, "");
            const digitsFull = (cc + rawPhone).replace(/\D/g, "");
            const digitsPhone = rawPhone.replace(/\D/g, "");
            const source =
              c.source === "schemerscore" ? "schemerscore" : "crayscore";
            const displayPhone =
              (c.countryCode ?? "+1") +
              (rawPhone.replace(/\D/g, "") || rawPhone || "");
            for (const key of [digitsFull, digitsPhone].filter(
              (k) => k.length >= 7
            )) {
              if (!byPhone[key]) byPhone[key] = [];
              if (!byPhone[key].includes(source)) byPhone[key].push(source);
              if (!metaByPhone[key]) {
                metaByPhone[key] = { name, phone: displayPhone };
              }
              allDigits.add(key);
            }
          }
          setContactPhones(Array.from(allDigits));
          setContactSourcesByPhone(byPhone);
          setContactMetaByPhone(metaByPhone);
        }
      })
      .catch(() => {
        // ignore contact load errors; fallback to showing all reviews
      });
  }, [isReady, authData?.auth?.AccessToken]);

  const handleOpenReviewDetails = useCallback(
    async (phoneNumber?: string) => {
      const token = authData?.auth?.AccessToken;
      if (!token || !phoneNumber) return;
      try {
        await fetch("/api/auth/home-review-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: token,
            action: "getUserHomeReviewDetailsV1",
            page: 1,
            limit: 10,
            phoneNumber,
          }),
        });
      } catch {
        // swallow errors for now; UI behaviour will be added later
      }
    },
    [authData?.auth?.AccessToken]
  );

  const handleOpenReviewModal = useCallback((name: string, phoneNumber: string) => {
    setReviewModalContact({ name, phone: phoneNumber });
    setReviewModalProduct("cray");
    setReviewModalError(null);
    setReviewDetails(null);
    setReviewModalOpen(true);
  }, []);

  const handleCheckReviewFromModal = useCallback(async () => {
    if (!reviewModalContact || !authData?.auth?.AccessToken) return;
    setReviewModalLoading(true);
    setReviewModalError(null);
    try {
      const res = await fetch("/api/auth/home-review-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: authData.auth.AccessToken,
          action: "getUserHomeReviewDetailsV1",
          page: 1,
          limit: 10,
          phoneNumber: reviewModalContact.phone,
        }),
      });
      const data = await res.json();
      const body = data?.body ?? data;
      if (!res.ok || body?.status !== "success") {
        setReviewModalError(body?.message ?? "Failed to load review details.");
        return;
      }
      let items = (Array.isArray(body.data) ? body.data : []) as any[];
      if (reviewModalProduct === "cray") {
        items = items.filter(
          (d) =>
            (d.moduleType === "review" && !d.isSchemerReview) ||
            d.moduleType === "crayscore"
        );
      } else if (reviewModalProduct === "schemer") {
        items = items.filter(
          (d) => d.isSchemerReview === true || d.moduleType === "schemerscore"
        );
      } else if (reviewModalProduct === "catfish") {
        items = items.filter(
          (d) => d.moduleType === "catfishnew" || d.isCatfishReview === true
        );
      }
      // If API returned no items, use locally saved reports (from Save Report)
      if (items.length === 0 && typeof window !== "undefined" && reviewModalContact.phone) {
        try {
          const raw = localStorage.getItem(SAVED_REPORTS_KEY);
          const stored = raw ? (JSON.parse(raw) as Record<string, any[]>) : {};
          const phoneDigits = (reviewModalContact.phone || "").replace(/\D/g, "");
          const localList = stored[phoneDigits] ?? [];
          if (reviewModalProduct === "cray") {
            items = localList.filter((d) => (d.reportType || "crayscore") !== "schemerscore");
          } else if (reviewModalProduct === "schemer") {
            items = localList.filter((d) => (d.reportType || "") === "schemerscore");
          }
          // else catfish: no local fallback
        } catch {
          // ignore
        }
      }
      setReviewDetails(items);
    } catch (e) {
      setReviewModalError(
        e instanceof Error ? e.message : "Failed to load review details. Please try again."
      );
    } finally {
      setReviewModalLoading(false);
    }
  }, [authData?.auth?.AccessToken, reviewModalContact, reviewModalProduct]);

  // Decide initial view based on URL, then stored preference, then data. Sync URL so reload keeps current page.
  useEffect(() => {
    if (!isReady) return;
    const viewFromUrl = searchParams.get("view");

    if (viewFromUrl === "recent") {
      setShowDashboard(false);
      if (typeof window !== "undefined") {
        localStorage.setItem(HOME_VIEW_KEY, "recent");
      }
      return;
    }
    if (viewFromUrl === "dashboard") {
      setShowDashboard(true);
      if (typeof window !== "undefined") {
        localStorage.setItem(HOME_VIEW_KEY, "dashboard");
      }
      return;
    }

    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(HOME_VIEW_KEY);
    if (stored === "recent") {
      setShowDashboard(false);
      router.replace("/home?view=recent", { scroll: false });
    } else if (stored === "dashboard") {
      setShowDashboard(true);
      router.replace("/home?view=dashboard", { scroll: false });
    } else if (homeReviews && homeReviews.length > 0) {
      setShowDashboard(false);
      router.replace("/home?view=recent", { scroll: false });
    } else {
      setShowDashboard(true);
      router.replace("/home?view=dashboard", { scroll: false });
    }
  }, [isReady, searchParams, homeReviews, router]);

  // Track page view for Home (Dashboard / History)
  useEffect(() => {
    if (!isReady || !authData) return;
    const viewFromUrl = searchParams.get("view");
    const screenName =
      viewFromUrl === "recent" ? "History Screen" : "Home Screen";
    trackEvent(
      "Page Viewed",
      {
        screen_name: screenName,
      },
      authData as any
    );
  }, [isReady, authData, searchParams]);

  // Decrypt profile names when backend returns encrypted firstName/lastName
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!isReady || !authData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-200 p-6 md:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-xl border border-gray-300 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-lg">
              🦊
            </div>
            <span className="text-xl font-bold text-red-600">CRAY</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-gray-600">
            <Link href="/home" className="font-semibold text-red-600">
              Home
            </Link>
            <Link href="/contacts" className="hover:text-gray-900">
              Contacts
            </Link>
            <Link href="/home/settings" className="hover:text-gray-900">
              Settings
            </Link>
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsUserMenuOpen((prev) => !prev)}
                className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-gray-300 bg-white"
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
              {isUserMenuOpen && (
                <div className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    My Profile
                  </button>
                  <Link
                    href="/home/settings"
                    onClick={() => setIsUserMenuOpen(false)}
                    className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </nav>
        </header>

        <main className="bg-gray-50 px-6 py-8 md:px-10">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">Home | Dashboard</span>
            {(!showDashboard || (homeReviews && homeReviews.length > 0)) && (
              <div className="flex gap-2">
                {!showDashboard ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        localStorage.setItem(HOME_VIEW_KEY, "dashboard");
                        try {
                          const raw = sessionStorage.getItem(OVERVIEW_SESSION_KEY);
                          if (raw) {
                            const session = JSON.parse(raw) as { view?: string; [key: string]: unknown };
                            session.view = "dashboard";
                            sessionStorage.setItem(OVERVIEW_SESSION_KEY, JSON.stringify(session));
                          }
                        } catch {
                          // ignore
                        }
                      }
                      router.replace("/home?view=dashboard", { scroll: false });
                      setShowDashboard(true);
                    }}
                    className="rounded-lg border border-red-600 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Dashboard
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowDashboard(false);
                      if (typeof window !== "undefined") {
                        localStorage.setItem(HOME_VIEW_KEY, "recent");
                      }
                      router.replace("/home?view=recent", { scroll: false });
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Recent activity
                  </button>
                )}
              </div>
            )}
          </div>

          {showDashboard || searchParams.get("background_check_success") === "1" ? (
            <Overview
              firstName={displayNames?.firstName ?? authData.user.firstName ?? ""}
              lastName={displayNames?.lastName ?? authData.user.lastName ?? ""}
              accessToken={authData.auth?.AccessToken}
              backgroundCheckPaymentSuccess={searchParams.get("background_check_success") === "1"}
              onBackgroundCheckPaymentReturn={() => router.replace("/home")}
            />
          ) : (
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    Welcome to your overview!
                  </h1>
                  <p className="mt-1 text-xl font-semibold text-gray-900">
                    Hello, {displayNames?.firstName ?? authData.user.firstName ?? "there"}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    Recent activity from your CrayScore and SchemerScore reviews.
                  </p>
                </div>
              </div>

              {homeReviewsError && (
                <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {homeReviewsError}
                </div>
              )}

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex flex-wrap gap-2 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                  <span className="rounded-full bg-white px-3 py-1 shadow-sm">All Score</span>
                  <button
                    type="button"
                    onClick={() => setProductListModal("cray")}
                    className="rounded-full px-3 py-1 hover:bg-white hover:shadow-sm"
                  >
                    CrayScore
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductListModal("schemer")}
                    className="rounded-full px-3 py-1 hover:bg-white hover:shadow-sm"
                  >
                    SchemerScore
                  </button>
                  <span className="rounded-full px-3 py-1">Catfish Check</span>
                  <span className="rounded-full px-3 py-1">Background Check</span>
                </div>
                <div className="relative w-full max-w-xs">
                  <input
                    type="text"
                    placeholder="Search"
                    className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400"
                    readOnly
                  />
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {homeReviewsLoading && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                    Loading recent reviews…
                  </div>
                )}
                {!homeReviewsLoading && (() => {
                  // Build Recent activity rows from Contacts list + latest review for each contact.
                  const rows: {
                    id: string;
                    name: string;
                    phone: string;
                    review?: HomeReviewItem;
                  }[] = [];

                  const seenPhones = new Set<string>();

                  for (const [digits, meta] of Object.entries(contactMetaByPhone)) {
                    const phoneDigits = (meta.phone ?? "").replace(/\D/g, "");
                    if (!phoneDigits || seenPhones.has(phoneDigits)) continue;
                    seenPhones.add(phoneDigits);

                    // Find latest review for this contact phone
                    let latest: HomeReviewItem | undefined;
                    for (const r of homeReviews ?? []) {
                      if (!sameContactPhone(r.phoneNumber, meta.phone)) continue;
                      if (!latest || (r.dateTime ?? 0) > (latest.dateTime ?? 0)) {
                        latest = r;
                      }
                    }
                    rows.push({
                      id: latest?._id ?? digits,
                      name: meta.name,
                      phone: meta.phone,
                      review: latest,
                    });
                  }

                  // Sort: contacts with reviews first (latest date desc), then by name
                  rows.sort((a, b) => {
                    const at = a.review?.dateTime ?? 0;
                    const bt = b.review?.dateTime ?? 0;
                    if (at !== bt) return bt - at;
                    return a.name.localeCompare(b.name);
                  });

                  return rows.map((row, index) => {
                    const r = row.review;
                    const displayName = row.name || row.phone || "Contact";
                    const flags = getContactScoreFlags(
                      row.phone,
                      homeReviews ?? [],
                      contactSourcesByPhone
                    );
                    const crayDark = flags.hasCray;
                    const schemerDark = flags.hasSchemer;
                    const catfishDark = flags.hasCatfish;
                    return (
                      <div
                        key={`${row.id}-${index}`}
                        className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenReviewModal(displayName, row.phone)
                          }
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                            👤
                          </div>
                          <div>
                            <p className="font-medium">{displayName}</p>
                            <p className="text-xs text-gray-500">
                              {r
                                ? <>
                                    Review {r.reviewType || ""} · Score {r.score ?? 0} ·{" "}
                                    {r.isSchemerReview ? "SchemerScore" : "CrayScore"} ·{" "}
                                    {r.progress ?? 0}% complete
                                  </>
                                : "No reviews yet for this contact"}
                            </p>
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenReviewDetails(row.phone)}
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                              crayDark
                                ? "border border-gray-700 bg-gray-700 text-white hover:bg-gray-800"
                                : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                            }`}
                            aria-label="CrayScore details"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              className="h-5 w-5"
                            >
                              <circle
                                cx="12"
                                cy="12"
                                r="7"
                                fill={crayDark ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="1.7"
                              />
                              <path
                                d="M9.5 12.5 11 14l3.5-4.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenReviewDetails(row.phone)}
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                              schemerDark
                                ? "border border-gray-700 bg-gray-700 text-white hover:bg-gray-800"
                                : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                            }`}
                            aria-label="SchemerScore details"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              className="h-5 w-5"
                            >
                              <path
                                d="M4 11c2.5-2 5.5-3 8-3s5.5 1 8 3c-2.5 2-5.5 3-8 3s-5.5-1-8-3Z"
                                fill={schemerDark ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <circle
                                cx="9"
                                cy="11"
                                r="1.2"
                                fill={schemerDark ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="1.4"
                              />
                              <circle
                                cx="15"
                                cy="11"
                                r="1.2"
                                fill={schemerDark ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="1.4"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenReviewDetails(row.phone)}
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                              catfishDark
                                ? "border border-gray-700 bg-gray-700 text-white hover:bg-gray-800"
                                : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                            }`}
                            aria-label="Catfish Check details"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              className="h-5 w-5"
                            >
                              <path
                                d="M4 12c2-2 4.5-3 7.5-3 2.2 0 3.8.6 5.5 1.7L20 9v6l-3-1.7C15.3 14.4 13.7 15 11.5 15 8.5 15 6 14 4 12Z"
                                fill={catfishDark ? "currentColor" : "none"}
                                stroke="currentColor"
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <circle
                                cx="13.5"
                                cy="11.5"
                                r="0.7"
                                fill="currentColor"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
          )}
        </main>
      </div>

      {productListModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {productListModal === "cray" ? "CrayScore" : "SchemerScore"}
              </h2>
              <button
                type="button"
                onClick={() => setProductListModal(null)}
                className="text-gray-500 hover:text-gray-800"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-gray-500">
              {productListModal === "cray"
                ? "Contacts you added in CrayScore"
                : "Contacts you added in SchemerScore"}
            </p>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {(() => {
                const baseList = (homeReviews ?? []).filter((r) => {
                  const first = (r.firstName ?? "").trim();
                  const last = (r.lastName ?? "").trim();
                  const phoneDigits = (r.phoneNumber ?? "").replace(/\D/g, "");
                  const hasContactInfo = Boolean(first || last || phoneDigits);
                  if (!hasContactInfo) return false;
                  if (!contactPhones.length) return true;
                  return phoneDigits && contactPhones.includes(phoneDigits);
                });
                const isCray = productListModal === "cray";
                const items = baseList.filter((r) =>
                  isCray ? !r.isSchemerReview : Boolean(r.isSchemerReview)
                );
                if (items.length === 0) {
                  try {
                    const raw = typeof window !== "undefined" ? localStorage.getItem(SAVED_REPORTS_KEY) : null;
                    const stored = raw ? (JSON.parse(raw) as Record<string, any[]>) : {};
                    const merged: { _id: string; name: string; dateTime: number }[] = [];
                    Object.entries(stored).forEach(([phone, list]) => {
                      const reports = (list || []).filter((d) =>
                        isCray ? (d.reportType || "crayscore") !== "schemerscore" : (d.reportType || "") === "schemerscore"
                      );
                      const name = baseList.find((r) => (r.phoneNumber ?? "").replace(/\D/g, "") === phone)
                        ? [baseList.find((r) => (r.phoneNumber ?? "").replace(/\D/g, "") === phone)!?.firstName, baseList.find((r) => (r.phoneNumber ?? "").replace(/\D/g, "") === phone)!?.lastName].filter(Boolean).join(" ") || phone
                        : phone || "Contact";
                      reports.forEach((r) =>
                        merged.push({
                          _id: r._id || `local-${phone}-${r.dateTime}`,
                          name,
                          dateTime: r.dateTime || 0,
                        })
                      );
                    });
                    if (merged.length === 0) {
                      return (
                        <p className="py-6 text-center text-sm text-gray-500">
                          No {isCray ? "CrayScore" : "SchemerScore"} contacts yet.
                        </p>
                      );
                    }
                    return merged
                      .sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0))
                      .map((item) => (
                        <div
                          key={item._id}
                          className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100">
                              👤
                            </div>
                            <span className="font-medium">{item.name}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {item.dateTime ? new Date(item.dateTime).toLocaleDateString() : "—"}
                          </span>
                        </div>
                      ));
                  } catch {
                    return (
                      <p className="py-6 text-center text-sm text-gray-500">
                        No {isCray ? "CrayScore" : "SchemerScore"} contacts yet.
                      </p>
                    );
                  }
                }
                return items
                  .sort((a, b) => (b.dateTime || 0) - (a.dateTime || 0))
                  .map((r) => {
                    const displayName =
                      [r.firstName, r.lastName].filter(Boolean).join(" ") || r.phoneNumber || "Contact";
                    return (
                      <div
                        key={r._id}
                        className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100">
                            👤
                          </div>
                          <span className="font-medium">{displayName}</span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {r.dateTime ? new Date(r.dateTime).toLocaleDateString() : "—"}
                        </span>
                      </div>
                    );
                  });
              })()}
            </div>
          </div>
        </div>
      )}

      {reviewModalOpen && reviewModalContact && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            {!reviewDetails && (
              <>
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  {reviewModalContact.name}
                </h2>
                {reviewModalLoading ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    Loading report…
                  </p>
                ) : (
                  <>
                    <p className="mb-4 text-xs text-gray-500">
                      Select which review you want to check.
                    </p>

                    <div className="space-y-3">
                      {[
                        { id: "cray" as const, label: "CrayScore" },
                        { id: "schemer" as const, label: "SchemerScore" },
                        { id: "catfish" as const, label: "Catfish Check" },
                      ].map((opt) => {
                        const selected = reviewModalProduct === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setReviewModalProduct(opt.id)}
                            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                              selected
                                ? "border-red-500 bg-red-50 text-gray-900"
                                : "border-gray-200 bg-white text-gray-800"
                            }`}
                          >
                            <span>{opt.label}</span>
                            <span
                              className={`h-4 w-4 rounded-full border ${
                                selected ? "border-red-500 bg-red-500" : "border-gray-300"
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>

                    {reviewModalError && (
                      <p className="mt-3 text-xs text-red-600">{reviewModalError}</p>
                    )}

                    <div className="mt-6 flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setReviewModalOpen(false)}
                        className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleCheckReviewFromModal}
                        disabled={reviewModalLoading}
                        className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        Check Review
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {reviewDetails && (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    {reviewModalProduct === "cray"
                      ? "CrayScore"
                      : reviewModalProduct === "schemer"
                      ? "SchemerScore"
                      : "Catfish Check"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setReviewDetails(null);
                      setReviewModalOpen(false);
                    }}
                    className="text-sm text-gray-500 hover:text-gray-800"
                  >
                    ✕
                  </button>
                </div>
                {reviewDetails.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-500">
                    No reviews yet for this contact. The API returned no data for this phone number.
                  </p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto pt-2">
                    {reviewDetails.map((item) => (
                      <div
                        key={item._id}
                        className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100">
                            👤
                          </div>
                          <span className="font-medium">
                            {reviewModalContact.name}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {new Date(item.dateTime || item.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
