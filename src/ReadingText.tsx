/** Render model text as text, never HTML. Small Markdown vocabulary keeps reports readable. */
export default function ReadingText({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return (
    <div className="reading-prose">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((block, index) => (
          <div key={index}>
            {block.split("\n").map((line, i) =>
              /^#{1,6}\s/.test(line) ? (
                <h3 key={i}>{inline(line.replace(/^#+\s/, ""))}</h3>
              ) : /^[-*]\s/.test(line) ? (
                <p className="reading-list-line" key={i}>
                  <span>·</span>
                  {inline(line.replace(/^[-*]\s/, ""))}
                </p>
              ) : (
                <p key={i}>{inline(line)}</p>
              ),
            )}
          </div>
        ))}
    </div>
  );
}
