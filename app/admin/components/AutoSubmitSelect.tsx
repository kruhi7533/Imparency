"use client";

/**
 * A <select> that submits its parent <form> on change, for GET filter forms
 * (donors, NGOs, projects) that otherwise only apply once "Search" is
 * clicked. Reported as "filter is not functional" — it was functional (the
 * server-side query was always correct), it just required a second click
 * nobody was making, which reads identically to broken from the outside.
 *
 * A plain <select onChange> was deliberately not used here: this keeps the
 * URL query string as the single source of truth (the page stays a Server
 * Component doing a real GET, no client-side fetch or router.push state to
 * keep in sync), and degrades correctly with JS disabled — the existing
 * Search button still works, this is pure progressive enhancement.
 */
export default function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      onChange={(e) => {
        props.onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
