<template>
  <div class="rich-editor" :class="{ 'is-source': sourceMode }">
    <div class="rich-editor__toolbar">
      <ClientOnly>
        <template v-if="!sourceMode && editor">
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('bold') }" @click="editor.chain().focus().toggleBold().run()" title="Bold (⌘B)">
            <strong>B</strong>
          </button>
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('italic') }" @click="editor.chain().focus().toggleItalic().run()" title="Italic (⌘I)">
            <em>I</em>
          </button>
          <span class="tb-sep"></span>
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('heading', { level: 2 }) }" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()" title="Heading 2">
            H2
          </button>
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('heading', { level: 3 }) }" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()" title="Heading 3">
            H3
          </button>
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('paragraph') }" @click="editor.chain().focus().setParagraph().run()" title="Paragraph">
            P
          </button>
          <span class="tb-sep"></span>
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('bulletList') }" @click="editor.chain().focus().toggleBulletList().run()" title="Bulleted list">
            • List
          </button>
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('orderedList') }" @click="editor.chain().focus().toggleOrderedList().run()" title="Numbered list">
            1. List
          </button>
          <span class="tb-sep"></span>
          <button type="button" class="tb-btn" :class="{ active: editor.isActive('link') }" @click="setLink" title="Add/edit link">
            🔗 Link
          </button>
          <button type="button" class="tb-btn" :disabled="!editor.isActive('link')" @click="editor.chain().focus().unsetLink().run()" title="Remove link">
            Unlink
          </button>
          <span class="tb-sep"></span>
          <button type="button" class="tb-btn" @click="editor.chain().focus().undo().run()" :disabled="!editor.can().undo()" title="Undo (⌘Z)">
            ↶
          </button>
          <button type="button" class="tb-btn" @click="editor.chain().focus().redo().run()" :disabled="!editor.can().redo()" title="Redo (⌘⇧Z)">
            ↷
          </button>
        </template>
      </ClientOnly>
      <span class="tb-spacer"></span>
      <button type="button" class="tb-btn tb-source-toggle" :class="{ active: sourceMode }" @click="toggleSource" :title="sourceMode ? 'Back to visual editor' : 'View/edit HTML source'">
        {{ sourceMode ? '✎ Visual' : '&lt;/&gt; Source' }}
      </button>
    </div>

    <ClientOnly>
      <div v-show="!sourceMode" class="rich-editor__surface">
        <EditorContent :editor="editor" />
      </div>
      <template #fallback>
        <div class="rich-editor__surface rich-editor__surface--fallback">
          <div class="rich-editor__loading">Loading editor…</div>
        </div>
      </template>
    </ClientOnly>

    <textarea
      v-show="sourceMode"
      class="rich-editor__source"
      :value="modelValue"
      :rows="rows"
      spellcheck="false"
      @input="onSourceInput"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'

const props = withDefaults(
  defineProps<{
    modelValue: string
    rows?: number
    placeholder?: string
  }>(),
  {
    rows: 10,
    placeholder: '',
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const sourceMode = ref(false)

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
  ],
  editorProps: {
    attributes: {
      class: 'rich-editor__content',
    },
  },
  onUpdate: ({ editor: e }) => {
    const html = e.getHTML()
    // TipTap represents empty content as "<p></p>" — normalize to empty string
    const normalized = html === '<p></p>' ? '' : html
    if (normalized !== props.modelValue) {
      emit('update:modelValue', normalized)
    }
  },
})

// Keep editor in sync when parent replaces the value externally (e.g., form load)
watch(
  () => props.modelValue,
  (newVal) => {
    if (!editor.value || sourceMode.value) return
    const current = editor.value.getHTML()
    const currentNormalized = current === '<p></p>' ? '' : current
    if (newVal !== currentNormalized) {
      editor.value.commands.setContent(newVal || '', { emitUpdate: false })
    }
  }
)

function toggleSource() {
  // Leaving source mode: push the edited HTML back into the editor
  if (sourceMode.value && editor.value) {
    editor.value.commands.setContent(props.modelValue || '', { emitUpdate: false })
  }
  sourceMode.value = !sourceMode.value
}

function onSourceInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
}

function setLink() {
  if (!editor.value) return
  const previousUrl = editor.value.getAttributes('link').href as string | undefined
  const url = window.prompt('URL', previousUrl || 'https://')
  if (url === null) return // cancelled
  if (url === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<style scoped>
.rich-editor {
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: white;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.rich-editor:focus-within {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.rich-editor__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid #e2e8f0;
  background: #f7fafc;
  border-radius: 6px 6px 0 0;
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.85rem;
  height: 1.85rem;
  padding: 0 0.45rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  font-size: 0.8rem;
  font-family: system-ui, sans-serif;
  color: #4a5568;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.tb-btn:hover:not(:disabled) {
  background: #edf2f7;
  border-color: #cbd5e0;
}

.tb-btn.active {
  background: #e2e8f0;
  border-color: #cbd5e0;
  color: #2d3748;
}

.tb-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tb-sep {
  width: 1px;
  height: 1.1rem;
  background: #cbd5e0;
  margin: 0 0.2rem;
}

.tb-spacer { flex: 1; }

.tb-source-toggle {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
}

.rich-editor__surface {
  padding: 0.5rem 0.75rem;
  min-height: 10rem;
  font-size: 0.9rem;
  line-height: 1.6;
  color: #2d3748;
}

.rich-editor__surface--fallback {
  color: #a0aec0;
  font-style: italic;
}

.rich-editor__loading {
  padding: 0.25rem 0;
}

:deep(.rich-editor__content) {
  outline: none;
  min-height: 9rem;
}

:deep(.rich-editor__content p) {
  margin: 0 0 0.75rem;
}
:deep(.rich-editor__content p:last-child) { margin-bottom: 0; }

:deep(.rich-editor__content h2) {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
  color: #1a202c;
}

:deep(.rich-editor__content h3) {
  font-size: 1rem;
  font-weight: 600;
  margin: 0.875rem 0 0.45rem;
  color: #1a202c;
}

:deep(.rich-editor__content ul),
:deep(.rich-editor__content ol) {
  padding-left: 1.5rem;
  margin: 0 0 0.75rem;
}

:deep(.rich-editor__content li) {
  margin: 0.2rem 0;
}

:deep(.rich-editor__content a) {
  color: #667eea;
  text-decoration: underline;
}

:deep(.rich-editor__content code) {
  background: #edf2f7;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.85em;
}

:deep(.rich-editor__content blockquote) {
  border-left: 3px solid #cbd5e0;
  padding-left: 0.75rem;
  margin: 0.5rem 0;
  color: #4a5568;
}

.rich-editor__source {
  display: block;
  width: 100%;
  border: none;
  border-radius: 0 0 6px 6px;
  padding: 0.5rem 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  color: #2d3748;
  background: #fafbfc;
  resize: vertical;
  outline: none;
}
</style>
