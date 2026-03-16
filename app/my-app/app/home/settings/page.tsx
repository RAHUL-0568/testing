"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { VerifyResponseBody } from "../../components/VerificationCodeBox";
import { getStoredProfilePicture, setStoredProfilePicture } from "../../lib/profilePicture";
import { trackEvent } from "../../lib/analytics";

type AuthData = NonNullable<VerifyResponseBody["data"]>;
type SettingsSection = "edit-profile" | "change-phone" | "help-report" | "delete-account";
const AUTH_STORAGE_KEY = "cray_auth_data";
const PROFILE_COMPLETE_KEY = "cray_profile_complete";
const SETTINGS_SECTION_KEY = "cray_settings_section";

export default function SettingsPage() {
  const router = useRouter();
  const hasCheckedAuth = useRef(false);
  const [authData, setAuthData] = useState<AuthData | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [oldCountryCode, setOldCountryCode] = useState("+1");
  const [oldPhone, setOldPhone] = useState("");
  const [newCountryCode, setNewCountryCode] = useState("+1");
  const [newPhone, setNewPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [updateMobileSession, setUpdateMobileSession] = useState<{
    session: string;
    challengeName?: string;
    newPhone: string;
    countryCode: string;
  } | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", ""]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("edit-profile");
  const [editFullName, setEditFullName] = useState("");
  const [editPicture, setEditPicture] = useState<string | null>(null);
  const [isEditProfileSubmitting, setIsEditProfileSubmitting] = useState(false);
  const [editProfileMessage, setEditProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const [helpCategory, setHelpCategory] = useState<"bug" | "security" | "other">("bug");
  const [helpDescription, setHelpDescription] = useState("");
  const [helpMessage, setHelpMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isHelpSubmitting, setIsHelpSubmitting] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountMessage, setDeleteAccountMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    if (hasCheckedAuth.current) return;
    hasCheckedAuth.current = true;
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
      const savedSection = sessionStorage.getItem(SETTINGS_SECTION_KEY) as SettingsSection | null;
      if (
        savedSection === "edit-profile" ||
        savedSection === "help-report" ||
        savedSection === "change-phone" ||
        savedSection === "delete-account"
      ) {
        setActiveSection(savedSection);
      }
    } catch {
      router.replace("/");
      return;
    }
    setIsReady(true);
  }, [router]);

  useEffect(() => {
    sessionStorage.setItem(SETTINGS_SECTION_KEY, activeSection);
  }, [activeSection]);

  useEffect(() => {
    if (!isReady || !authData) return;
    const screenName =
      activeSection === "edit-profile"
        ? "Edit Profile Screen"
        : activeSection === "change-phone"
          ? "Change Phone Number Screen"
          : activeSection === "help-report"
            ? "Report Screen"
            : activeSection === "delete-account"
              ? "Account Screen"
              : "Settings Screen";
    trackEvent("Page Viewed", { screen_name: screenName }, authData as any);
  }, [isReady, authData, activeSection]);

  const getAccessToken = useCallback((auth: AuthData["auth"]) => {
    const a = auth as { AccessToken?: string; accessToken?: string };
    return (a?.AccessToken ?? a?.accessToken ?? "").trim();
  }, []);

  const handleLogout = useCallback(async () => {
    if (authData) {
      trackEvent("Logged Out", {}, authData as any);
    }
    const token = authData ? getAccessToken(authData.auth) : "";
    if (token) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: token }),
        });
      } catch {}
    }
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(PROFILE_COMPLETE_KEY);
    localStorage.removeItem("cray_session");
    localStorage.removeItem("cray_auth_token");
    setAuthData(null);
    router.replace("/");
  }, [router, authData, getAccessToken]);

  const handleDeleteAccountConfirm = useCallback(async () => {
    if (!authData) return;
    const token = getAccessToken(authData.auth);
    if (!token) {
      setDeleteAccountMessage({ type: "error", text: "Session expired. Please log in again." });
      return;
    }
    setIsDeletingAccount(true);
    setDeleteAccountMessage(null);
    try {
      const res = await fetch("/api/auth/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteAccount", accessToken: token }),
      });
      const data = await res.json().catch(() => ({}));
      const body = data?.body ?? data;
      if (res.ok && data.statusCode === 200 && body?.status === "success") {
        trackEvent("Account Deleted", {}, authData as any);
        try {
          localStorage.removeItem(AUTH_STORAGE_KEY);
          localStorage.removeItem(PROFILE_COMPLETE_KEY);
          localStorage.removeItem("cray_session");
          localStorage.removeItem("cray_auth_token");
          sessionStorage.removeItem(SETTINGS_SECTION_KEY);
          sessionStorage.removeItem("cray_overview_session");
        } catch {
          // ignore storage errors
        }
        setAuthData(null);
        router.replace("/");
      } else {
        setDeleteAccountMessage({
          type: "error",
          text: (body as { message?: string })?.message ?? "Could not delete account. Please try again.",
        });
      }
    } catch {
      setDeleteAccountMessage({
        type: "error",
        text: "Could not delete account. Please try again.",
      });
    } finally {
      setIsDeletingAccount(false);
    }
  }, [authData, getAccessToken, router]);

  const handleUpdatePhone = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authData) return;
    const token = getAccessToken(authData.auth);
    if (!token) {
      setMessage({ type: "error", text: "Session expired. Please log in again." });
      return;
    }
    const phone = newPhone.trim();
    const country = newCountryCode.trim();
    if (!phone || !country) {
      setMessage({ type: "error", text: "Please enter new phone number and country code." });
      return;
    }
    setMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/update-mobile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, newPhone: phone, countryCode: country }),
      });
      const data = await res.json();
      const body = data?.body;
      if (res.ok && data.statusCode === 200 && body?.status === "success") {
        setMessage({ type: "success", text: body?.message ?? "OTP sent to the new phone number." });
        const dataPayload = (body as { data?: { session?: string; challengeName?: string } })?.data;
        if (dataPayload?.session) {
          setUpdateMobileSession({
            session: dataPayload.session,
            challengeName: dataPayload.challengeName ?? "CUSTOM_CHALLENGE",
            newPhone: phone,
            countryCode: country,
          });
          setOtpDigits(["", "", "", ""]);
        } else setNewPhone("");
      } else {
        setMessage({ type: "error", text: (body as { message?: string })?.message ?? "Update failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Update failed." });
    } finally {
      setIsSubmitting(false);
    }
  }, [authData, newPhone, newCountryCode, getAccessToken]);

  const handleVerifyOtp = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authData || !updateMobileSession) return;
    const token = getAccessToken(authData.auth);
    if (!token) {
      setMessage({ type: "error", text: "Session expired. Please log in again." });
      return;
    }
    const otp = otpDigits.join("");
    if (otp.length !== 4) return;
    setMessage(null);
    setIsVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-update-mobile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: token,
          session: updateMobileSession.session,
          challengeName: updateMobileSession.challengeName ?? "CUSTOM_CHALLENGE",
          newPhone: updateMobileSession.newPhone,
          countryCode: updateMobileSession.countryCode,
          otp,
        }),
      });
      const data = await res.json();
      const body = data?.body;
      if (res.ok && data.statusCode === 200 && body?.status === "success") {
        const responseData = body as {
          message?: string;
          data?: { accessToken?: string; refreshToken?: string; idToken?: string; formattedPhone?: string };
        };
        const newAuth = responseData?.data;
        let authForTrack: AuthData = authData;
        if (newAuth?.accessToken) {
          const prev = authData.auth as { RefreshToken?: string; IdToken?: string };
          const updated: AuthData = {
            ...authData,
            auth: {
              ...authData.auth,
              AccessToken: newAuth.accessToken,
              RefreshToken: newAuth.refreshToken ?? prev.RefreshToken ?? "",
              IdToken: newAuth.idToken ?? prev.IdToken ?? "",
            },
          };
          setAuthData(updated);
          authForTrack = updated;
          try {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
        }
        const formattedPhone = newAuth?.formattedPhone ?? (updateMobileSession ? `${updateMobileSession.countryCode}${updateMobileSession.newPhone}` : "");
        const successText = formattedPhone
          ? `Phone number updated successfully. Your registered number is ${formattedPhone}.`
          : (responseData?.message ?? "Phone number updated successfully.");
        setMessage({ type: "success", text: successText });
        trackEvent(
          "Phone Number Updated",
          {
            old_country_code: oldCountryCode,
            old_phone_number: oldPhone,
            country_code: updateMobileSession?.countryCode,
            phone_number: updateMobileSession ? `${updateMobileSession.countryCode}${updateMobileSession.newPhone}` : "",
          },
          authForTrack as any
        );
        setUpdateMobileSession(null);
        setOtpDigits(["", "", "", ""]);
        setNewPhone("");
      } else {
        setMessage({ type: "error", text: (body as { message?: string })?.message ?? "Verification failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Verification failed." });
    } finally {
      setIsVerifying(false);
    }
  }, [authData, updateMobileSession, otpDigits, getAccessToken]);

  const setOtpDigit = useCallback((index: number, value: string) => {
    const v = value.replace(/\D/g, "").slice(-1);
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = v;
      return next;
    });
  }, []);

  // Load decrypted name when opening Edit Profile (only show plain text, not encrypted)
  const isPlainName = (s: string) => s.trim() && !s.includes("=");

  useEffect(() => {
    if (activeSection !== "edit-profile" || !authData?.user) return;
    const first = (authData.user.firstName ?? "").trim();
    const last = (authData.user.lastName ?? "").trim();
    if (!first && !last) {
      setEditFullName("");
      return;
    }
    fetch("/api/auth/decrypt-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: first || undefined, lastName: last || undefined }),
    })
      .then((r) => r.json())
      .then((data) => {
        const f = (data?.firstName ?? "").trim();
        const l = (data?.lastName ?? "").trim();
        const plain = [f, l].filter(isPlainName).join(" ");
        setEditFullName(plain);
      })
      .catch(() => setEditFullName(""));
  }, [activeSection, authData?.user?.firstName, authData?.user?.lastName]);

  const handleProfileImageChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl === "string") setEditPicture(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const handleUpdateProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!authData) return;
      const token = getAccessToken(authData.auth);
      if (!token) {
        setEditProfileMessage({ type: "error", text: "Session expired. Please log in again." });
        return;
      }
      const parts = editFullName.trim().split(/\s+/);
      const firstName = parts[0] ?? "";
      const lastName = parts.slice(1).join(" ") ?? "";
      const newPictureForDisplay = editPicture ?? authData.user.picture ?? "";
      setEditProfileMessage(null);
      setIsEditProfileSubmitting(true);
      try {
        const res = await fetch("/api/auth/update-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: token,
            firstName,
            lastName,
            picture: "",
          }),
        });
        const data = await res.json();
        const body = data?.body;
        if (res.ok && data.statusCode === 200 && body?.status === "success") {
          setEditProfileMessage({ type: "success", text: body?.message ?? "User profile updated successfully." });
          const hadPicture = Boolean(authData.user?.picture);
          const updated: AuthData = {
            ...authData,
            user: {
              ...authData.user,
              firstName,
              lastName,
              picture: newPictureForDisplay || authData.user.picture || "",
            },
          };
          setAuthData(updated);
          setEditPicture(null);
          if (newPictureForDisplay) {
            setStoredProfilePicture(authData.auth, newPictureForDisplay);
          }
          try {
            localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          trackEvent(
            "Profile Updated",
            { is_picture_updated: Boolean(newPictureForDisplay) !== hadPicture },
            updated as any
          );
        } else {
          setEditProfileMessage({ type: "error", text: (body as { message?: string })?.message ?? "Update failed." });
        }
      } catch {
        setEditProfileMessage({ type: "error", text: "Update failed." });
      } finally {
        setIsEditProfileSubmitting(false);
      }
    },
    [authData, editFullName, editPicture, getAccessToken]
  );

  const helpCategoryTitles: Record<"bug" | "security" | "other", string> = {
    bug: "Bug or Glitch",
    security: "Security Issues",
    other: "Other",
  };

  const handleSubmitHelp = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!authData) return;
      const token = getAccessToken(authData.auth);
      if (!token) {
        setHelpMessage({ type: "error", text: "Session expired. Please log in again." });
        return;
      }
      setHelpMessage(null);
      setIsHelpSubmitting(true);
      try {
        const res = await fetch("/api/auth/help", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: token,
            title: helpCategoryTitles[helpCategory] ?? "help",
            description: helpDescription.trim() || "help description",
          }),
        });
        const data = await res.json();
        const body = data?.body;
        if (res.ok && data.statusCode === 200 && body?.status === "success") {
          setHelpMessage({ type: "success", text: body?.message ?? "Send successfully." });
          setHelpDescription("");
          trackEvent("Bug Reported", { bug_type: helpCategory }, authData as any);
        } else {
          setHelpMessage({ type: "error", text: (body as { message?: string })?.message ?? "Send failed." });
        }
      } catch {
        setHelpMessage({ type: "error", text: "Send failed." });
      } finally {
        setIsHelpSubmitting(false);
      }
    },
    [authData, helpCategory, helpDescription, getAccessToken]
  );

  if (!isReady || !authData) return null;

  return (
    <div className="min-h-screen bg-gray-200 p-6 md:p-10">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-xl border border-gray-300 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-lg">🦊</div>
            <span className="text-xl font-bold text-red-600">Cray App</span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-gray-600">
            <Link href="/home" className="hover:text-gray-900">Home</Link>
            <button type="button" className="hover:text-gray-900">Contacts</button>
            <Link href="/home/settings" className="font-semibold text-red-600">Settings</Link>
            <div className="flex items-center gap-2">
              <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white overflow-hidden">
                {(authData.user.picture || getStoredProfilePicture(authData.auth)) ? (
                  <img src={authData.user.picture || getStoredProfilePicture(authData.auth) || ""} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  "👤"
                )}
              </button>
              <span className="text-gray-400">▾</span>
            </div>
          </nav>
          <button
            type="button"
            onClick={handleLogout}
            className="ml-4 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Logout
          </button>
        </header>

        <div className="flex">
          <aside className="w-64 border-r border-gray-200 bg-gray-50 p-6">
            <Link href="/home" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">← Back</Link>
            <h2 className="text-lg font-bold text-gray-900">Account</h2>
            <div className="mt-4 border-l-2 border-red-500 pl-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Services</p>
            </div>
            <nav className="mt-4 space-y-1">
              <button
                type="button"
                onClick={() => setActiveSection("edit-profile")}
                className={`flex w-full items-center gap-3 rounded-lg py-2.5 pr-2 text-left ${activeSection === "edit-profile" ? "bg-red-50/50 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-100"}`}
              >
                <span className="text-xl">✏️</span>
                <div className="text-left">
                  <p className="font-medium text-gray-900">Edit Profile</p>
                  <p className="text-xs text-gray-500">Manage Your Personal Info</p>
                </div>
                <span className="ml-auto text-gray-400">→</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("change-phone")}
                className={`flex w-full items-center gap-3 rounded-lg py-2.5 pr-2 text-left ${activeSection === "change-phone" ? "bg-red-50/50 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-100"}`}
              >
                <span className="text-xl">📞</span>
                <div className="text-left">
                  <p className="font-medium text-gray-900">Change Phone Number</p>
                  <p className="text-xs text-gray-500">Edit Your Phone Details</p>
                </div>
                <span className="ml-auto text-gray-400">→</span>
              </button>
              <button type="button" className="flex w-full items-center gap-3 rounded-lg py-2.5 pr-2 text-left text-gray-700 hover:bg-gray-100">
                <span className="text-xl">👥</span>
                <div className="text-left">
                  <p className="font-medium text-gray-900">Invite A Friend</p>
                  <p className="text-xs text-gray-500">Send An Invite, Spread The Word</p>
                </div>
                <span className="ml-auto text-gray-400">→</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("help-report")}
                className={`flex w-full items-center gap-3 rounded-lg py-2.5 pr-2 text-left ${activeSection === "help-report" ? "bg-red-50/50 font-medium text-gray-900" : "text-gray-700 hover:bg-gray-100"}`}
              >
                <span className="text-xl">❓</span>
                <div className="text-left">
                  <p className="font-medium text-gray-900">Help And Report</p>
                  <p className="text-xs text-gray-500">Support Resources & Issue Reporting</p>
                </div>
                <span className="ml-auto text-gray-400">→</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("delete-account")}
                className={`flex w-full items-center gap-3 rounded-lg py-2.5 pr-2 text-left ${
                  activeSection === "delete-account"
                    ? "bg-red-50/50 font-medium text-gray-900"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span className="text-xl">🗑</span>
                <div className="text-left">
                  <p className="font-medium text-gray-900">Delete My Account</p>
                  <p className="text-xs text-gray-500">Say Goodbye To Your Account</p>
                </div>
                <span className="ml-auto text-gray-400">→</span>
              </button>
            </nav>
          </aside>

          <main className="flex-1 p-8">
            {activeSection === "edit-profile" ? (
              <>
                <div className="border-l-4 border-red-500 pl-4">
                  <h1 className="text-xl font-bold text-gray-900">Edit Profile</h1>
                  <p className="text-sm text-gray-500">Manage Personal Info</p>
                </div>
                <form onSubmit={handleUpdateProfile} className="mt-6 max-w-md space-y-6">
                  <input
                    ref={profileImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleProfileImageChange}
                    className="hidden"
                    aria-hidden
                  />
                  <div className="flex items-start gap-4">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 text-4xl text-gray-400">
                      {(editPicture || authData.user.picture || getStoredProfilePicture(authData.auth)) ? (
                        <img
                          src={editPicture || authData.user.picture || getStoredProfilePicture(authData.auth) || ""}
                          alt="Profile"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        "👤"
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-gray-700">Profile Pic</span>
                      <button
                        type="button"
                        onClick={() => profileImageInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        📷 Update Image
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Your Name</label>
                    <input
                      type="text"
                      value={editFullName}
                      onChange={(e) => setEditFullName(e.target.value)}
                      placeholder="e.g. Jack Doyle"
                      className="w-full rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                    />
                  </div>
                  {editProfileMessage && (
                    <p className={`text-sm ${editProfileMessage.type === "success" ? "text-green-700" : "text-red-700"}`}>
                      {editProfileMessage.text}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={isEditProfileSubmitting}
                    className="rounded-lg bg-red-600 px-6 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {isEditProfileSubmitting ? "Updating…" : "Update"}
                  </button>
                </form>
              </>
            ) : activeSection === "help-report" ? (
              <>
                <div className="border-l-4 border-red-500 pl-4">
                  <h1 className="text-xl font-bold text-gray-900">Help And report</h1>
                  <p className="text-sm text-gray-500">Support Resources & Issue Reporting</p>
                </div>
                <form onSubmit={handleSubmitHelp} className="mt-6 max-w-2xl space-y-6">
                  <div className="space-y-3">
                    {(["bug", "security", "other"] as const).map((key) => (
                      <label
                        key={key}
                        className={`flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition ${
                          helpCategory === key ? "border-red-500 bg-red-50/30" : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="helpCategory"
                          checked={helpCategory === key}
                          onChange={() => setHelpCategory(key)}
                          className="mt-1 h-4 w-4 shrink-0 border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="border-l-2 border-red-500 pl-2">
                            <p className="font-medium text-gray-900">{helpCategoryTitles[key]}</p>
                          </div>
                          <ul className="mt-2 grid list-inside list-disc grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-gray-600">
                            <li>App crashes unexpectedly</li>
                            <li>Errors in loading content</li>
                            <li>Buttons or features not working</li>
                            <li>Inconsistent app performance</li>
                          </ul>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="border-l-2 border-red-500 pl-2">
                    <label className="mb-2 block text-sm font-medium text-gray-700">Describe here</label>
                    <textarea
                      value={helpDescription}
                      onChange={(e) => setHelpDescription(e.target.value)}
                      placeholder="Enter here..."
                      rows={4}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400"
                    />
                  </div>
                  {helpMessage && (
                    <p className={`text-sm ${helpMessage.type === "success" ? "text-green-700" : "text-red-700"}`}>
                      {helpMessage.text}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={isHelpSubmitting}
                    className="rounded-lg bg-red-600 px-6 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {isHelpSubmitting ? "Submitting…" : "Submit"}
                  </button>
                </form>
              </>
            ) : activeSection === "delete-account" ? (
              <>
                <div className="border-l-4 border-red-500 pl-4">
                  <h1 className="text-xl font-bold text-gray-900">Delete My Account</h1>
                  <p className="text-sm text-gray-500">Say Goodbye To Your Account</p>
                </div>
                <div className="mt-6 max-w-2xl rounded-2xl border border-orange-200 bg-orange-50 p-6">
                  <h2 className="text-lg font-semibold text-gray-900">Delete your account?</h2>
                  <p className="mt-2 text-sm text-gray-700">
                    You will lose all your data by deleting your account. This action cannot be undone.
                  </p>
                  {deleteAccountMessage && (
                    <p
                      className={`mt-3 text-sm ${
                        deleteAccountMessage.type === "success" ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {deleteAccountMessage.text}
                    </p>
                  )}
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleDeleteAccountConfirm}
                      disabled={isDeletingAccount}
                      className="rounded-lg bg-red-600 px-6 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {isDeletingAccount ? "Deleting…" : "Delete my Account"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSection("edit-profile")}
                      className="rounded-lg border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      No! I&apos;ve changed my mind
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="border-l-4 border-red-500 pl-4">
                  <h1 className="text-xl font-bold text-gray-900">Change Phone Number</h1>
                  <p className="text-sm text-gray-500">Edit Your Phone Details</p>
                </div>
                <p className="mt-4 font-medium text-gray-700">Keep your contact info up to date for account safety.</p>

                <form onSubmit={handleUpdatePhone} className="mt-6 max-w-md space-y-6">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Confirm Old Number</label>
                <div className="flex gap-2">
                  <select value={oldCountryCode} onChange={(e) => setOldCountryCode(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900">
                    <option value="+1">+1</option>
                    <option value="+91">+91</option>
                    <option value="+44">+44</option>
                  </select>
                  <input type="tel" placeholder="Phone Number" value={oldPhone} onChange={(e) => setOldPhone(e.target.value)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">New Number</label>
                <div className="flex gap-2">
                  <select
                    value={newCountryCode}
                    onChange={(e) => {
                      setNewCountryCode(e.target.value);
                      setMessage(null);
                    }}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"
                  >
                    <option value="+1">+1</option>
                    <option value="+91">+91</option>
                    <option value="+44">+44</option>
                  </select>
                  <input
                    type="tel"
                    placeholder="Phone Number"
                    value={newPhone}
                    onChange={(e) => {
                      setNewPhone(e.target.value);
                      setMessage(null);
                    }}
                    onFocus={() => setMessage(null)}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-900 placeholder:text-gray-400"
                    required
                  />
                </div>
              </div>
              {message && <p className={`text-sm ${message.type === "success" ? "text-green-700" : "text-red-700"}`}>{message.text}</p>}
              <button type="submit" disabled={isSubmitting} className="rounded-lg bg-red-600 px-6 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {isSubmitting ? "Sending…" : "Update"}
              </button>
            </form>

                {updateMobileSession && (
                  <form onSubmit={handleVerifyOtp} className="mt-8 max-w-md space-y-4 border-t border-gray-200 pt-8">
                    <p className="font-medium text-gray-700">Enter the 4-digit OTP sent to your new number</p>
                    <div className="flex gap-2">
                      {[0, 1, 2, 3].map((i) => (
                        <input key={i} type="text" inputMode="numeric" maxLength={1} value={otpDigits[i]} onChange={(e) => setOtpDigit(i, e.target.value)} className="h-12 w-12 rounded-lg border border-gray-300 text-center text-lg font-semibold text-gray-900" />
                      ))}
                    </div>
                    <button type="submit" disabled={isVerifying || otpDigits.join("").length !== 4} className="rounded-lg bg-red-600 px-6 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50">
                      {isVerifying ? "Verifying…" : "Verify"}
                    </button>
                  </form>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
