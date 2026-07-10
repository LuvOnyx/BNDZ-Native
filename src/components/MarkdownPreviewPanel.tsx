import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownPreviewPanelProps {
  content: string;
}

export default function MarkdownPreviewPanel({ content }: MarkdownPreviewPanelProps) {
  return (
    <div className="w-full h-full overflow-y-auto bndz-scrollbar bndz-preview-stage p-4 prose prose-invert prose-sm max-w-none
      prose-headings:text-gray-100 prose-p:text-gray-300 prose-a:text-[#7eb8e8] prose-code:text-violet-300
      prose-pre:bg-[#1a1a1a] prose-pre:border prose-pre:border-[#333] prose-table:text-gray-300
      prose-th:border-[#444] prose-td:border-[#333] prose-blockquote:border-[#0078d4]/40 prose-blockquote:text-gray-400">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
