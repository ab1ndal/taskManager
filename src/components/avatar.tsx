export function Avatar({ name, email, size = "sm" }: {
  name: string;
  email: string;
  size?: "sm" | "lg";
}) {
  const initials = (name || email).charAt(0).toUpperCase();
  const sizeClasses = size === "lg"
    ? "w-14 h-14 text-2xl"
    : "w-[30px] h-[30px] text-xs";

  return (
    <div
      className={`${sizeClasses} rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent-text)] font-semibold flex items-center justify-center flex-shrink-0`}
      aria-label={`Avatar for ${name || email}`}
    >
      {initials}
    </div>
  );
}
