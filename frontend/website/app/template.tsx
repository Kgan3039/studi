import ScrollReveal from "./scroll-reveal";

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="route-frame">
      <ScrollReveal />
      {children}
    </div>
  );
}
