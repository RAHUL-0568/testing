"use client";

import { useRef, useState } from "react";

export interface ProfileSetupData {
  firstName: string;
  lastName: string;
  picture?: string | null;
}

export interface ProfileSetupProps {
  initialData?: Partial<ProfileSetupData>;
  onComplete?: (data: ProfileSetupData) => void | Promise<void>;
  isSubmitting?: boolean;
  error?: string | null;
}

export default function ProfileSetup({ initialData, onComplete, isSubmitting, error }: ProfileSetupProps) {
  const [firstName, setFirstName] = useState(initialData?.firstName ?? "");
  const [lastName, setLastName] = useState(initialData?.lastName ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialData?.picture ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      setPreviewUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = onComplete?.({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      picture: previewUrl ?? undefined,
    });
    if (result && typeof (result as Promise<unknown>)?.then === "function") {
      (result as Promise<void>).catch(() => {});
    }
  };

  return (
    <div className="flex w-full max-w-5xl flex-col gap-8 md:flex-row md:items-center md:justify-center">
      {/* Left: illustration + copy */}
      <div className="flex flex-1 flex-col items-center md:items-start">
        <div className="mb-4 flex h-40 w-40 items-center justify-center rounded-2xl bg-amber-100 text-7xl">
          🦊
        </div>
        <span className="mb-2 inline-block rounded-full bg-red-100 px-4 py-1 text-sm font-medium text-red-700">
          Profile Setup
        </span>
        <h2 className="text-2xl font-bold text-gray-900 md:text-3xl">
          Complete your profile
        </h2>
        <p className="mt-3 max-w-sm text-gray-600">
          It is a long established fact that a reader will be distracted by the
          readable content of a page when looking at its layout. The point of
          using Lorem Ipsum is that it has a more-or-less normal distribution of
          letters.
        </p>
      </div>

      {/* Right: form card */}
      <div className="w-full max-w-md flex-shrink-0 rounded-2xl border border-gray-200 bg-gray-50 p-8 shadow-sm">
        <h3 className="mb-6 text-xl font-bold text-gray-900">Profile Setup</h3>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white py-10 transition hover:border-red-400 hover:bg-red-50/50"
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="h-24 w-24 rounded-lg object-cover"
                />
              ) : (
                <>
                  <svg
                    className="mb-2 h-12 w-12 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <span className="text-sm font-medium text-gray-600">
                    Upload Image
                  </span>
                </>
              )}
            </button>
          </div>

          <input
            type="text"
            placeholder="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
          <input
            type="text"
            placeholder="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 h-12 w-full rounded-xl bg-red-600 font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {isSubmitting ? "Updating…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
