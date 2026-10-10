// Rich-text editor — Phase 2.1 TipTap integration.
//
// Replaces the Phase-1 <textarea> with a WYSIWYG surface backed by
// TipTap (ProseMirror underneath). Headings / bold / italic /
// underline / lists / blockquote / inline links / typographic
// corrections.
//
// Collaborative cursors (Phase 2.3) will plug in later as a
// Collaboration + CollaborationCursor extension; the extensions list
// is kept in one place (defaultExtensions) so the swap is additive.
//
// Public surface:
//   - defaultExtensions() — returns the extension list used by the
//     editor. Takes a placeholder override.
//   - useRichTextEditor() — thin wrapper over TipTap's useEditor that
//     also keeps the editor DOM synced when the `content` prop changes
//     (e.g. the user switches active section).
//   - EditorContent — re-exported from @tiptap/react.

import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef } from 'react'

export { EditorContent }
export type { Editor }

export function defaultExtensions(placeholder = 'Start writing this section…') {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer', class: 'text-blue-600 underline' },
    }),
    Placeholder.configure({ placeholder }),
  ]
}

interface UseRichTextEditorArgs {
  content: string
  editable: boolean
  onChange?: (html: string) => void
  onBlur?: (html: string) => void
  placeholder?: string
}

/**
 * TipTap doesn't auto-sync the editor DOM when the `content` prop
 * changes after mount. When the parent passes new content (e.g. the
 * user switches active section) we mirror it into the editor.
 */
export function useRichTextEditor({ content, editable, onChange, onBlur, placeholder }: UseRichTextEditorArgs): Editor | null {
  const editor = useEditor({
    extensions: defaultExtensions(placeholder),
    content,
    editable,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    onBlur:   ({ editor }) => onBlur?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'tiptap-editor prose prose-sm max-w-none focus:outline-none font-serif leading-[1.8] text-[15px] text-slate-900 min-h-[320px]',
        spellcheck: 'true',
      },
    },
  }, [editable])

  // Hydrate on external content change.
  const lastSetRef = useRef<string>(content)
  useEffect(() => {
    if (!editor) return
    if (lastSetRef.current === content) return
    if (editor.getHTML() === content) {
      lastSetRef.current = content
      return
    }
    editor.commands.setContent(content, { emitUpdate: false })
    lastSetRef.current = content
  }, [editor, content])

  return editor
}
