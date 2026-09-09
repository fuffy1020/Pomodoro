import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "專注之間 · Pomodoro",
  icons: { icon: "/icon.svg" },
  description: "留一段時間，給一件重要的事。番茄鐘與每日、每週專注紀錄。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
