// Rich-text editor — Phase 2.1 (TipTap base) + Phase 2.3 (collab).
//
// Solo mode: StarterKit's history is on, content hydrates from the
// `content` prop, saves go via onChange → PATCH.
//
// Collab mode: when a `collab` provider is passed, we disable
// StarterKit history (Yjs replaces it) and mount the Collaboration +
// CollaborationCaret extensions. Content hydration flips off too — the
// Y.Doc becomes the source of truth and the sidecar's own hydration
// (from the API) seeds the shared doc.

import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { useEffect, useRef } from 'react'
import type { CollabProvider } from './useCollabProvider'

export { EditorContent }
export type { Editor }

interface User {
  name:   string
  color?: { fg: string; bg: string }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyExt = any

export function defaultExtensions(opts: {
  placeholder?: string
  collab?:      CollabProvider | null
  user?:        User
}): AnyExt[] {
  // When collab is active, Yjs owns history — the Collaboration
  // extension manages undo/redo and StarterKit's bundled undoRedo
  // conflicts (double-undo). TipTap v3 renamed `history` → `undoRedo`.
  const base: AnyExt[] = [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      ...(opts.collab ? { undoRedo: false } : {}),
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer', class: 'text-blue-600 underline' },
    }),
    Placeholder.configure({ placeholder: opts.placeholder ?? 'Start writing this section…' }),
  ]

  if (opts.collab) {
    base.push(
      Collaboration.configure({
        document: opts.collab.doc,
      }),
      CollaborationCaret.configure({
        provider: opts.collab.provider,
        user: {
          name:  opts.user?.name  ?? 'Anonymous',
          color: opts.user?.color?.fg ?? '#2563EB',
        },
      }),
    )
  }

  return base
}

interface UseRichTextEditorArgs {
  content:  string
  editable: boolean
  onChange?: (html: string) => void
  onBlur?:   (html: string) => void
  placeholder?: string
  collab?:  CollabProvider | null
  user?:    User
}

/**
 * TipTap doesn't auto-sync the editor DOM when the `content` prop
 * changes after mount. When the parent passes new content (e.g. the
 * user switches active section), we mirror it into the editor — but
 * only in SOLO mode. In collab mode, the Y.Doc is the source of
 * truth and the sidecar seeds it from the API when the room spawns.
 */
export function useRichTextEditor({
  content,
  editable,
  onChange,
  onBlur,
  placeholder,
  collab,
  user,
}: UseRichTextEditorArgs): Editor | null {
  const extensions = defaultExtensions({ placeholder, collab, user })

  const editor = useEditor({
    extensions,
    // Only pass initial content in solo mode. In collab mode, Yjs
    // syncs the doc from the room; passing content here would race
    // with the first sync message.
    content: collab ? '' : content,
    editable,
    onUpdate: ({ editor }) => onChange?.(editor.getHTML()),
    onBlur:   ({ editor }) => onBlur?.(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'tiptap-editor prose prose-sm max-w-none focus:outline-none font-serif leading-[1.8] text-[15px] text-slate-900 min-h-[320px]',
        spellcheck: 'true',
      },
    },
  }, [editable, collab?.roomId])

  // Solo-mode-only hydration on external content change.
  const lastSetRef = useRef<string>(content)
  useEffect(() => {
    if (!editor || collab) return
    if (lastSetRef.current === content) return
    if (editor.getHTML() === content) {
      lastSetRef.current = content
      return
    }
    editor.commands.setContent(content, { emitUpdate: false })
    lastSetRef.current = content
  }, [editor, content, collab])

  return editor
}
