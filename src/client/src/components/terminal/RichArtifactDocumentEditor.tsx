import { useEffect, useMemo, useRef, useState } from "react";
import { Extension, getExtensionField, Node } from "@tiptap/core";
import type { Extensions, JSONContent } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Plugin } from "@tiptap/pm/state";
import type { ArtifactContent } from "@shared/artifactContracts";
import { fromTiptapDocumentProjection, reconcileReportBlockSections, readRecordedDocumentTable, recordedDocumentTablePreview, recordedDocumentValue, safeRichDocumentHref, toTiptapDocumentProjection } from "@shared/richArtifactDocument";
import { chartArtifactContentSchema } from "@shared/artifactContracts";
import { artifactImageDataUri, readArtifactImage } from "@shared/artifactImage";
import ArtifactChart from "./ArtifactChart";

type DocumentContent = Extract<ArtifactContent, { kind: "research" | "report" }>;
const blockTypes = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "canonicalBlock"];
const newBlockId = () => `block:${crypto.randomUUID()}`;

function editableProjection(content: DocumentContent): JSONContent {
  const projection = toTiptapDocumentProjection(content);
  for (const block of projection.content) {
    if (block.type !== "blockquote" && block.type !== "bulletList" && block.type !== "orderedList") continue;
    const inheritIdentity = (node: JSONContent) => {
      if (node.type === "paragraph") node.attrs = { ...node.attrs, canonicalId: block.attrs?.canonicalId };
      node.content?.forEach(inheritIdentity);
    };
    block.content?.forEach(inheritIdentity);
  }
  return projection;
}

// Canonical metadata never becomes HTML attributes or an alternate persistence store.
const CanonicalIdentity = Extension.create({
  name: "canonicalIdentity",
  addGlobalAttributes() {
    return [{ types: blockTypes, attributes: { canonicalId: { default: null, rendered: false } } }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(transaction => transaction.docChanged)) return null;
        const seen = new Set<string>();
        const transaction = state.tr;
        state.doc.forEach((node, position) => {
          if (!blockTypes.includes(node.type.name)) return;
          let id = node.attrs.canonicalId;
          if (typeof id !== "string" || !id) node.descendants(child => {
            if (typeof id === "string" && id) return false;
            if (typeof child.attrs.canonicalId === "string" && child.attrs.canonicalId && !seen.has(child.attrs.canonicalId)) {
              id = child.attrs.canonicalId;
              return false;
            }
            return typeof id !== "string";
          });
          if (typeof id !== "string" || !id || seen.has(id)) id = newBlockId();
          if (node.attrs.canonicalId !== id) transaction.setNodeMarkup(position, undefined, { ...node.attrs, canonicalId: id });
          seen.add(id);
          if (node.type.name === "blockquote" || node.type.name === "bulletList" || node.type.name === "orderedList") node.descendants((child, childPosition) => {
            if (child.type.name === "paragraph" && child.attrs.canonicalId !== id) transaction.setNodeMarkup(position + childPosition + 1, undefined, { ...child.attrs, canonicalId: id });
          });
        });
        return transaction.docChanged ? transaction : null;
      },
    })];
  },
});

function RecordedBlock({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const type = String(node.attrs.canonicalType);
  const attrs = node.attrs.canonicalAttrs as Record<string, unknown> | null;
  const text = String(node.attrs.canonicalText ?? "");
  const tableResult = useMemo(() => type === "table" ? readRecordedDocumentTable(attrs) : null, [type, attrs]);
  const preview = useMemo(() => tableResult?.status === "recognized" ? recordedDocumentTablePreview(tableResult.table) : null, [tableResult]);
  const displayedAttrs = useMemo(() => tableResult?.status === "recognized" && preview ? { ...attrs, table: { ...tableResult.table, rows: preview.rows } } : attrs, [attrs, tableResult, preview]);
  const chart = useMemo(() => type === "chart_ref" ? chartArtifactContentSchema.safeParse(attrs?.chart) : null, [type, attrs]);
  const image = useMemo(() => {
    if (type !== "image") return null;
    try { return { value: readArtifactImage(attrs?.image) }; }
    catch (error) { return { error: error instanceof Error ? error.message : "Invalid captured image." }; }
  }, [type, attrs]);
  const reference = attrs?.artifactRef ?? attrs?.chartRef ?? attrs?.ref ?? null;
  const href = typeof attrs?.href === "string" ? safeRichDocumentHref(attrs.href) : null;
  return <NodeViewWrapper contentEditable={false} data-testid="rich-document-recorded-block" data-block-id={node.attrs.canonicalId} className={`rich-document-recorded-block ${selected ? "is-selected" : ""}`}>
    <div className="rich-document-block-identity font-terminal">{type} · {node.attrs.canonicalId}</div>
    {tableResult?.status === "recognized" && preview ? <div data-testid="rich-document-recorded-table">
      <p className="rich-document-evidence-note" data-testid="rich-document-table-count">Showing {preview.shown} of {preview.total} recorded rows{preview.shown < preview.total ? " (read-only preview; remaining rows retained in the Artifact)" : ""}.</p>
      <div className="rich-document-table-scroll" tabIndex={0} aria-label="Recorded document table">
        <table className="rich-document-table">
          <thead><tr>{tableResult.table.columns.map(column => <th key={column.key} scope="col" data-column-type={column.type}>{column.label}</th>)}</tr></thead>
          <tbody>{preview.rows.map((row, index) => <tr key={index}>{tableResult.table.columns.map(column => <td key={column.key} data-column-type={column.type}>{Object.hasOwn(row, column.key) ? recordedDocumentValue(row[column.key]) : "Not recorded"}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div> : tableResult?.status === "legacy" ? <p role="status" data-testid="rich-document-legacy-table" className="rich-document-evidence-note text-amber-200">{tableResult.reason}</p> : null}
    {chart?.success ? <ArtifactChart content={chart.data} readOnly /> : type === "chart_ref" ? <p role="status">Recorded chart payload unavailable; no remote content fetched.</p> : null}
    {image && "value" in image ? <figure className="rich-document-source-image" data-testid="rich-document-recorded-image"><img src={artifactImageDataUri(image.value!)} alt={text || "Captured Project image"} width={image.value!.width} height={image.value!.height} /><figcaption className="rich-document-evidence-note">Captured source: {image.value!.sourceRef} · SHA-256 {image.value!.sha256}</figcaption></figure> : image && "error" in image ? <p role="alert">{image.error}</p> : null}
    {reference != null && <p className="rich-document-evidence-note font-terminal">Recorded reference: {typeof reference === "object" ? JSON.stringify(reference) : String(reference)}</p>}
    {href && <a href={href} target="_blank" rel="noopener noreferrer" className="rich-document-reference-link">Open recorded reference</a>}
    <label className="rich-document-block-text"><span className="sr-only">{type} block text</span><textarea aria-label={`${type} block text`} value={text} disabled={!editor.isEditable} onFocus={() => { const position = getPos(); if (typeof position === "number" && editor.isEditable) editor.commands.setNodeSelection(position); }} onChange={event => { if (editor.isEditable) updateAttributes({ canonicalText: event.target.value }); }} className="font-ui" /></label>
    {!!attrs && Object.keys(attrs).length > 0 && <details className="rich-document-metadata"><summary>Recorded block metadata</summary>{preview && preview.shown < preview.total ? <p className="rich-document-evidence-note">Table rows in this metadata view are also limited to the preview; all {preview.total} rows remain recorded in the canonical Artifact.</p> : null}<pre className="font-terminal">{recordedDocumentValue(image && "value" in image ? { ...displayedAttrs, image: { ...image.value, dataBase64: "(captured bytes retained in canonical Artifact)" } } : displayedAttrs)}</pre></details>}
  </NodeViewWrapper>;
}

const CanonicalBlock = Node.create({
  name: "canonicalBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      canonicalType: { default: "callout", rendered: false },
      canonicalAttrs: { default: {}, rendered: false },
      canonicalText: { default: "", rendered: false },
    };
  },
  // No arbitrary HTML import and no recorded payload injected into a DOM attribute.
  parseHTML() { return []; },
  renderHTML({ node }) { return ["div", { "data-recorded-block": "true" }, String(node.attrs.canonicalText ?? "")]; },
  addNodeView() { return ReactNodeViewRenderer(RecordedBlock); },
});

// P4 lists and quotes contain plain paragraphs, not nested donor documents.
const CanonicalStarterKit = StarterKit.extend({
  addExtensions() {
    const donorExtensions = getExtensionField<() => Extensions>(StarterKit, "addExtensions", {
      name: this.name, options: this.options, storage: this.storage,
    })();
    return donorExtensions.map(extension =>
      extension instanceof Node && (extension.name === "listItem" || extension.name === "blockquote")
        ? extension.extend({ content: "paragraph+" })
        : extension);
  },
});

const extensions = [
  CanonicalStarterKit.configure({
    trailingNode: false,
    horizontalRule: false,
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      isAllowedUri: url => safeRichDocumentHref(url) !== null,
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    },
  }),
  CanonicalIdentity,
  CanonicalBlock,
];

export default function RichArtifactDocumentEditor({ content, onChange, onError, disabled = false }: {
  content: DocumentContent;
  onChange: (content: DocumentContent) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const contentRef = useRef(content);
  contentRef.current = content;
  const [initialBlocks] = useState(() => JSON.stringify(content.blocks));
  const emittedBlocks = useRef(initialBlocks);
  const [initialProjection] = useState(() => editableProjection(content));
  // Local undo metadata only: revisions still serialize the parent's single P4 draft.
  const [undoMetadata] = useState(() => ({ blocks: new Map(content.blocks.map(block => [block.id, block])), sections: content.kind === "report" ? content.sections : [] }));
  const knownBlocks = useRef(undoMetadata.blocks);
  const knownSections = useRef(undoMetadata.sections);
  const savedBlockIds = useRef(content.blocks.map(block => block.id));
  for (const block of content.blocks) knownBlocks.current.set(block.id, block);
  const editor = useEditor({
    extensions,
    content: initialProjection,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    enableContentCheck: true,
    editorProps: {
      attributes: { "aria-label": "Rich Artifact document", "data-testid": "rich-artifact-document", class: "rich-document-prose font-ui" },
      handlePaste(view, event) {
        // Clipboard HTML cannot impersonate block IDs, inject media, or bring an alternate document schema.
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        view.dispatch(view.state.tr.insertText(text));
        return true;
      },
      handleDrop(_view, event) { event.preventDefault(); return true; },
    },
    onUpdate({ editor: updated }) {
      try {
        const current = contentRef.current;
        const projection = updated.getJSON();
        const liveIds = new Set((projection.content ?? []).map(node => node.attrs?.canonicalId));
        const canonical = {
          ...current,
          blocks: (projection.content ?? []).flatMap(node => { const block = knownBlocks.current.get(node.attrs?.canonicalId); return block ? [block] : []; }),
          ...(current.kind === "report" ? { sections: knownSections.current.map(section => ({ ...section, blockIds: section.blockIds.filter(id => !knownBlocks.current.has(id) || liveIds.has(id)) })) } : {}),
        };
        const decoded = fromTiptapDocumentProjection(projection, canonical);
        const next = decoded.kind === "report"
          ? { ...decoded, sections: reconcileReportBlockSections(knownSections.current, savedBlockIds.current, decoded.blocks.map(block => block.id)) }
          : decoded;
        for (const block of next.blocks) knownBlocks.current.set(block.id, block);
        if (next.kind === "report") knownSections.current = next.sections;
        contentRef.current = next;
        emittedBlocks.current = JSON.stringify(next.blocks);
        onChange(next);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Rich document conversion failed. Your last canonical draft is retained.");
      }
    },
    onContentError({ error }) { onError(`Rich document unavailable: ${error.message}. Your canonical draft is retained.`); },
  });
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    bold: current.isActive("bold"), italic: current.isActive("italic"), underline: current.isActive("underline"),
    heading: current.isActive("heading"), bulletList: current.isActive("bulletList"), orderedList: current.isActive("orderedList"),
    blockquote: current.isActive("blockquote"), codeBlock: current.isActive("codeBlock"),
    undo: current.can().undo(), redo: current.can().redo(),
  } : null });
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    const incoming = JSON.stringify(content.blocks);
    if (!editor) return;
    // Sections can change without block text/order changing (e.g. a newly
    // reviewed report outline). Never project edits using stale sections.
    if (incoming === emittedBlocks.current) {
      knownSections.current = content.kind === "report" ? content.sections : [];
      return;
    }
    try {
      editor.commands.setContent(editableProjection(content), { emitUpdate: false, errorOnInvalidContent: true });
      knownBlocks.current = new Map(content.blocks.map(block => [block.id, block]));
      knownSections.current = content.kind === "report" ? content.sections : [];
      savedBlockIds.current = content.blocks.map(block => block.id);
      emittedBlocks.current = incoming;
    } catch (cause) { onError(cause instanceof Error ? cause.message : "Rich document could not be loaded. Canonical draft retained."); }
  }, [editor, content, onError]);
  if (!editor || !state) return <p role="status">Loading rich document editor…</p>;
  const buttonClass = "rounded border border-border/60 px-2 py-1 text-[13px] aria-pressed:bg-amber-300/15 disabled:opacity-40";
  const addBlock = (type: "paragraph" | "table" | "callout" | "chart_ref" | "artifact_ref") => {
    const id = newBlockId();
    const original = contentRef.current;
    const seeded = { id, type, text: "", attrs: type === "table" ? { rows: [["Column 1"], [""]] } : {} };
    knownBlocks.current.set(id, seeded);
    const node = type === "paragraph" ? { type: "paragraph", attrs: { canonicalId: id } }
      : { type: "canonicalBlock", attrs: { canonicalId: id, canonicalType: type, canonicalAttrs: seeded.attrs, canonicalText: "" } };
    if (!editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run()) {
      knownBlocks.current.delete(id);
      contentRef.current = original;
    }
  };
  const deleteBlock = () => {
    const { $from } = editor.state.selection;
    const from = $from.depth ? $from.before(1) : $from.pos;
    const node = editor.state.doc.nodeAt(from);
    if (node) editor.chain().focus().deleteRange({ from, to: from + node.nodeSize }).run();
  };
  return <div data-testid="rich-artifact-editor" className="rich-artifact-editor space-y-2">
    <div role="toolbar" aria-label="Document formatting" className="flex flex-wrap gap-1">
      <button type="button" aria-label="Bold" aria-pressed={state.bold} disabled={disabled || !editor.can().toggleBold()} onClick={() => editor.chain().focus().toggleBold().run()} className={buttonClass}>Bold</button>
      <button type="button" aria-label="Italic" aria-pressed={state.italic} disabled={disabled || !editor.can().toggleItalic()} onClick={() => editor.chain().focus().toggleItalic().run()} className={buttonClass}>Italic</button>
      <button type="button" aria-label="Underline" aria-pressed={state.underline} disabled={disabled || !editor.can().toggleUnderline()} onClick={() => editor.chain().focus().toggleUnderline().run()} className={buttonClass}>Underline</button>
      <button type="button" aria-label="Heading" aria-pressed={state.heading} disabled={disabled || !editor.can().toggleHeading({ level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={buttonClass}>Heading</button>
      <button type="button" aria-label="Bullet list" aria-pressed={state.bulletList} disabled={disabled || !editor.can().toggleBulletList()} onClick={() => editor.chain().focus().toggleBulletList().run()} className={buttonClass}>Bullets</button>
      <button type="button" aria-label="Ordered list" aria-pressed={state.orderedList} disabled={disabled || !editor.can().toggleOrderedList()} onClick={() => editor.chain().focus().toggleOrderedList().run()} className={buttonClass}>Numbered list</button>
      <button type="button" aria-label="Quote" aria-pressed={state.blockquote} disabled={disabled || !editor.can().toggleBlockquote()} onClick={() => editor.chain().focus().toggleBlockquote().run()} className={buttonClass}>Quote</button>
      <button type="button" aria-label="Code block" aria-pressed={state.codeBlock} disabled={disabled || !editor.can().toggleCodeBlock()} onClick={() => editor.chain().focus().toggleCodeBlock().run()} className={buttonClass}>Code</button>
      <button type="button" aria-label="Undo document edit" disabled={disabled || !state.undo} onClick={() => editor.chain().focus().undo().run()} className={buttonClass}>Undo</button>
      <button type="button" aria-label="Redo document edit" disabled={disabled || !state.redo} onClick={() => editor.chain().focus().redo().run()} className={buttonClass}>Redo</button>
      <button type="button" aria-label="Delete selected block" disabled={disabled} onClick={deleteBlock} className={buttonClass}>Delete block</button>
      <select aria-label="Insert document block" value="" disabled={disabled} onChange={event => addBlock(event.target.value as Parameters<typeof addBlock>[0])} className={`${buttonClass} bg-background`}>
        <option value="" disabled>Insert block…</option><option value="paragraph">Paragraph</option><option value="table">Recorded table</option><option value="callout">Callout</option><option value="chart_ref">Chart reference</option><option value="artifact_ref">Artifact reference</option>
      </select>
    </div>
    <p className="rich-document-evidence-note">Edits here are saved as new versions. Pasted text stays plain text and references never load outside content.</p>
    <fieldset disabled={disabled} className="rich-document-surface"><legend className="sr-only">Rich document content</legend><EditorContent editor={editor} /></fieldset>
  </div>;
}
