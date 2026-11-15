import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// The browser module under test is plain ES-module JavaScript (see tsconfig: allowJs).
import { DocumentError, docxToText, extractDocumentText, fileExtension, isDocumentFile, readZipEntry, wordXmlToText } from "../../frontend/js/docExtract.js";

/** A minimal zip writer for tests: `entries` maps file name -> [content, "stored" | "deflate"]. */
function makeZip(entries: Record<string, [string, "stored" | "deflate"]>): ArrayBuffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, [content, mode]] of Object.entries(entries)) {
    const raw = Buffer.from(content, "utf8");
    const data = mode === "deflate" ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(mode === "deflate" ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(mode === "deflate" ? 8 : 0, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...parts, directory, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const para = (...runs: string[]) => `<w:p>${runs.map((t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join("")}</w:p>`;
const body = (inner: string) => `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${inner}</w:body></w:document>`;

describe("wordXmlToText", () => {
  it("puts paragraphs on their own lines and joins runs", () => {
    expect(wordXmlToText(body(para("Midterm: ", "Friday") + para("Project due Nov 24")))).toBe("Midterm: Friday\nProject due Nov 24\n");
  });

  it("separates table cells with ' | ' and rows with newlines", () => {
    const row = (...cells: string[]) => `<w:tr>${cells.map((c) => `<w:tc>${para(c)}</w:tc>`).join("")}</w:tr>`;
    const text = wordXmlToText(body(`<w:tbl>${row("Week", "Topic", "Due")}${row("3", "Graphs", "HW 2")}</w:tbl>`));
    expect(text.split("\n").filter(Boolean)).toEqual(["Week | Topic | Due", "3 | Graphs | HW 2"]);
  });

  it("decodes entities, tabs and line breaks", () => {
    expect(wordXmlToText(body(`<w:p><w:r><w:t>Q&amp;A &lt;3&gt; &#169; &#x4e2d;</w:t><w:tab/><w:t>x</w:t><w:br/><w:t>y</w:t></w:r></w:p>`))).toBe("Q&A <3> © 中\tx\ny\n");
  });
});

describe("readZipEntry / docxToText", () => {
  it("reads deflated and stored entries and returns null for a missing one", async () => {
    const zip = makeZip({ "a.txt": ["hello world ".repeat(50), "deflate"], "b.txt": ["plain", "stored"] });
    expect(new TextDecoder().decode((await readZipEntry(zip, "a.txt"))!)).toBe("hello world ".repeat(50));
    expect(new TextDecoder().decode((await readZipEntry(zip, "b.txt"))!)).toBe("plain");
    expect(await readZipEntry(zip, "nope.txt")).toBeNull();
  });

  it("extracts the text of a .docx, including non-ASCII", async () => {
    const zip = makeZip({
      "[Content_Types].xml": ["<Types/>", "deflate"],
      "word/document.xml": [body(para("统计学 400 大纲") + para("期中考试：11月19日 下午3点")), "deflate"],
    });
    expect(await docxToText(zip)).toBe("统计学 400 大纲\n期中考试：11月19日 下午3点\n");
  });

  it("rejects something that is not a zip, and a zip that is not a .docx", async () => {
    await expect(readZipEntry(new TextEncoder().encode("not a zip at all, just some text").buffer as ArrayBuffer, "x")).rejects.toThrow(DocumentError);
    await expect(docxToText(makeZip({ "other.xml": ["<a/>", "stored"] }))).rejects.toThrow(/document\.xml/);
  });
});

describe("extractDocumentText", () => {
  const file = (name: string, content: string | ArrayBuffer) => new File([content], name);

  it("reads text and markdown files and tidies the whitespace", async () => {
    const text = await extractDocumentText(file("notes.md", "Quiz   on Friday  \n\n\n\n  Bring a calculator, please."));
    expect(text).toBe("Quiz on Friday\n\nBring a calculator, please.");
  });

  it("reads a .docx", async () => {
    const zip = makeZip({ "word/document.xml": [body(para("Midterm exam: Friday, November 19 at 3 pm")), "deflate"] });
    expect(await extractDocumentText(file("syllabus.docx", zip))).toBe("Midterm exam: Friday, November 19 at 3 pm");
  });

  it("explains why it cannot read a file", async () => {
    const code = async (f: File) => extractDocumentText(f).catch((e: DocumentError) => e.code);
    expect(await code(file("slides.pptx", "x".repeat(100)))).toBe("unsupported");
    expect(await code(file("old.doc", "x".repeat(100)))).toBe("unsupported");
    expect(await code(file("empty.txt", "  "))).toBe("empty");
    expect(await code(file("broken.docx", "this is not a zip file, sorry about that"))).toBe("unreadable");
    expect(await code(new File([new Uint8Array(16 * 1024 * 1024)], "huge.txt"))).toBe("tooLarge");
  });

  it("cuts very long text to what the server accepts", async () => {
    const text = await extractDocumentText(file("long.txt", "word ".repeat(200_000)));
    expect(text.length).toBeLessThanOrEqual(380_000);
  });

  it("recognises document extensions", () => {
    expect(fileExtension("Syllabus.FINAL.PDF")).toBe("pdf");
    expect(fileExtension("noext")).toBe("");
    expect(isDocumentFile(file("a.docx", ""))).toBe(true);
    expect(isDocumentFile(file("term.ics", ""))).toBe(false);
  });
});
