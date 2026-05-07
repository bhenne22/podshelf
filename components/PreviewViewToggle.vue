<template>
  <div class="view-toggle" role="group" aria-label="Preview view">
    <button
      type="button"
      :class="['toggle-btn', { active: modelValue === 'desktop' }]"
      @click="$emit('update:modelValue', 'desktop')"
      :aria-pressed="modelValue === 'desktop'"
    >
      <span class="toggle-icon">▭</span>
      Desktop
    </button>
    <button
      type="button"
      :class="['toggle-btn', { active: modelValue === 'mobile' }]"
      @click="$emit('update:modelValue', 'mobile')"
      :aria-pressed="modelValue === 'mobile'"
    >
      <span class="toggle-icon mobile">▯</span>
      Mobile
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: 'desktop' | 'mobile' }>()
defineEmits<{ (e: 'update:modelValue', v: 'desktop' | 'mobile'): void }>()
</script>

<style scoped>
.view-toggle {
  display: inline-flex;
  background: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 3px;
}
.toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: none;
  color: #4a5568;
  padding: 0.4rem 0.875rem;
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}
.toggle-btn:hover { color: #2d3748; }
.toggle-btn.active {
  background: white;
  color: #4c51bf;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.toggle-icon {
  display: inline-block;
  font-size: 0.95rem;
  line-height: 1;
}
.toggle-icon.mobile {
  /* portrait orientation hint */
  transform: scale(0.85, 1.1);
}
</style>
