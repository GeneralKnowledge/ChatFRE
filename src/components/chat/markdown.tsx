"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className ?? "");
          const isBlock = Boolean(match) || String(children).includes("\n");
          if (!isBlock) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return (
            <CodeBlock className={className} language={match?.[1]}>
              {children}
            </CodeBlock>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function CodeBlock({
  children,
  className,
  language,
}: {
  children: React.ReactNode;
  className?: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");

  return (
    <div className="group/code relative overflow-hidden rounded-xl border border-[#2a3330] bg-[#161b19]">
      <div className="flex items-center justify-between border-b border-[#2a3330] px-3 py-1.5 text-[11px] text-[#9aa89f]">
        <span className="uppercase tracking-wider text-[#8b9a92]">
          {language ?? "code"}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[#b7c4bd] hover:bg-white/5"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="!m-0 !rounded-none !border-0 !bg-transparent">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}
