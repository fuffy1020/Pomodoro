import { Pomodoro } from "@/components/pomodoro";

// Keep timer, audio, and synchronization alive while moving between pages.
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Pomodoro />
      {children}
    </>
  );
}
