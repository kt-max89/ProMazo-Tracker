import ReactMarkdown from "react-markdown";

/**
 * Safe, shared Markdown presentation for project-authored content. Raw HTML is
 * intentionally not enabled; long URLs and code are constrained to the panel.
 */
export function ProjectMarkdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <article className={`project-markdown prose prose-slate max-w-none break-words dark:prose-invert [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto ${className}`}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </article>
  );
}