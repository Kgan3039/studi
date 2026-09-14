import Image from "next/image";

export const APP_STORE_URL = "https://apps.apple.com/us/app/studi-study-together/id6804290285";
export const APP_STORE_ID = "6804290285";

export default function AppStoreButton({ className }: { className?: string }) {
  return (
    <a
      aria-label="Download Studi: Study Together on the App Store"
      className={className ? `app-store-button ${className}` : "app-store-button"}
      href={APP_STORE_URL}
      rel="noopener noreferrer"
      target="_blank">
      {/* Unmodified artwork from developer.apple.com/assets/elements/badges/download-on-the-app-store.svg. */}
      <Image
        alt="Download on the App Store"
        src="/app-store-badge.svg"
        width={119.66407}
        height={40}
        unoptimized
      />
    </a>
  );
}
