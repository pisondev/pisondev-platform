export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] bg-page pb-120">
      {children}
    </main>
  );
}
