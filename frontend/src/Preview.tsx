import { useMemo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkAdmonitions from "./remarkAdmonitions";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeImages from "./rehypeImagesPlugin";
import rehypeStringify from "rehype-stringify";

export default function Preview({ content, currentDocPath }) {
  const html = useMemo(() => {
    if (!content) return "";

    try {
      const file = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkDirective)
        .use(remarkAdmonitions)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeImages, currentDocPath)
        .use(rehypeStringify)
        .processSync(content);

      return String(file);
    } catch (err) {
      console.error("Markdown render error:", err);
      return content;
    }
  }, [content, currentDocPath]);

  return (
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
